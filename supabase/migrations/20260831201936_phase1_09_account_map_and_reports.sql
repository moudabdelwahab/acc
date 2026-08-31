-- Phase 1 / Step 9: the default posting map, and the detection reports V09 / V10 / V11.
create table if not exists public.account_map (
  id          uuid primary key default gen_random_uuid(),
  map_key     text not null unique,
  account_id  uuid references public.accounts(id) on delete restrict,
  description text,
  is_default  boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

drop trigger if exists set_updated_at on public.account_map;
create trigger set_updated_at before update on public.account_map
  for each row execute function public.set_updated_at();

drop trigger if exists audit_row on public.account_map;
create trigger audit_row after insert or update or delete on public.account_map
  for each row execute function public.tg_audit_row();

alter table public.account_map enable row level security;

do $$
begin
  if not exists (select 1 from pg_policy where polrelid='public.account_map'::regclass and polname='authenticated_select') then
    create policy authenticated_select on public.account_map for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policy where polrelid='public.account_map'::regclass and polname='authenticated_update') then
    create policy authenticated_update on public.account_map for update to authenticated using (true) with check (true);
  end if;
end $$;

revoke insert, delete on public.account_map from anon, authenticated;

-- default mapping, pointing only at accounts that already exist. Configuration, not accounting data.
insert into public.account_map (map_key, account_id, description)
select v.k, a.id, v.d
  from (values
    ('CASH',                  '1110','النقدية بالصندوق'),
    ('BANK',                  '1120','النقدية بالبنك'),
    ('ACCOUNTS_RECEIVABLE',   '1130','حساب مراقبة العملاء'),
    ('ACCOUNTS_PAYABLE',      '2110','حساب مراقبة الموردين'),
    ('VAT_INPUT',             '1150','ضريبة القيمة المضافة - مدخلات'),
    ('VAT_OUTPUT',            '2130','ضريبة القيمة المضافة - مخرجات'),
    ('DEFERRED_REVENUE',      '2150','الإيرادات المقدمة'),
    ('ASSET_PURCHASE_PAYABLE','2160','دائنو شراء الأصول'),
    ('ACCRUED_EXPENSES',      '2120','مصروفات مستحقة'),
    ('CAPITAL',               '3100','رأس المال'),
    ('DRAWINGS',              '3300','المسحوبات الشخصية'),
    ('INCOME_SUMMARY',        '3900','ملخص الدخل'),
    ('SALES_REVENUE',         '4100','إيرادات المبيعات'),
    ('SERVICE_REVENUE',       '4200','إيرادات الخدمات'),
    ('SUBSCRIPTION_REVENUE',  '4300','إيرادات الاشتراكات'),
    ('SALES_RETURNS',         '4400','مردودات المبيعات'),
    ('DISCOUNT_ALLOWED',      '4500','الخصم المسموح به'),
    ('DISCOUNT_EARNED',       '4910','الخصم المكتسب'),
    ('DEPRECIATION_EXPENSE',  '5850','مصروف الإهلاك'),
    ('ACCUM_DEP_BUILDINGS',   '1291','مجمع إهلاك المباني'),
    ('ACCUM_DEP_FURNITURE',   '1292','مجمع إهلاك الأثاث والتجهيزات'),
    ('ACCUM_DEP_VEHICLES',    '1293','مجمع إهلاك السيارات'),
    ('ACCUM_DEP_COMPUTERS',   '1294','مجمع إهلاك أجهزة الحاسب')
  ) as v(k, code, d)
  join public.accounts a on a.code = v.code
 where not exists (select 1 from public.account_map m where m.map_key = v.k);

-- ------------------------------------------------------------------ reports
-- V09: a posted entry that does not balance
create or replace view public.v_unbalanced_entries with (security_invoker = true) as
select e.id, e.entry_number, e.entry_date, e.status,
       coalesce(sum(l.debit), 0)  as total_debit,
       coalesce(sum(l.credit), 0) as total_credit,
       coalesce(sum(l.debit), 0) - coalesce(sum(l.credit), 0) as difference
  from public.journal_entries e
  left join public.journal_entry_lines l on l.entry_id = e.id
 where e.status = 'posted'
 group by e.id, e.entry_number, e.entry_date, e.status
having coalesce(sum(l.debit), 0) <> coalesce(sum(l.credit), 0);

-- V10: an account whose balance contradicts its normal balance
create or replace view public.v_unnatural_balances with (security_invoker = true) as
select a.id, a.code, a.name, a.type, a.normal_balance, a.is_contra,
       coalesce(sum(l.debit), 0)  as total_debit,
       coalesce(sum(l.credit), 0) as total_credit,
       coalesce(sum(l.debit), 0) - coalesce(sum(l.credit), 0) as net_debit
  from public.accounts a
  left join public.journal_entry_lines l on l.account_id = a.id
  left join public.journal_entries e on e.id = l.entry_id and e.status = 'posted'
 where a.is_postable
 group by a.id, a.code, a.name, a.type, a.normal_balance, a.is_contra
having (a.normal_balance = 'debit'  and coalesce(sum(l.debit), 0) - coalesce(sum(l.credit), 0) < 0)
    or (a.normal_balance = 'credit' and coalesce(sum(l.credit), 0) - coalesce(sum(l.debit), 0) < 0);

-- V11: a cash account gone negative
create or replace view public.v_negative_cash with (security_invoker = true) as
select a.id, a.code, a.name,
       coalesce(sum(l.debit), 0) - coalesce(sum(l.credit), 0) as cash_balance
  from public.accounts a
  left join public.journal_entry_lines l on l.account_id = a.id
  left join public.journal_entries e on e.id = l.entry_id and e.status = 'posted'
 where a.is_cash_account
 group by a.id, a.code, a.name
having coalesce(sum(l.debit), 0) - coalesce(sum(l.credit), 0) < 0;

grant select on public.v_unbalanced_entries, public.v_unnatural_balances, public.v_negative_cash to authenticated;

comment on table public.account_map is 'الخريطة الافتراضية: مفتاح ← حساب. يقرؤها محرّك القواعد في المراحل اللاحقة';
