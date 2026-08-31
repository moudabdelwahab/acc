-- Phase 1 / Step 1: functional attributes on accounts. Additive only.
alter table public.accounts
  add column if not exists normal_balance  text,
  add column if not exists is_postable     boolean not null default true,
  add column if not exists is_control      boolean not null default false,
  add column if not exists subledger       text,
  add column if not exists is_contra       boolean not null default false,
  add column if not exists statement_line  text,
  add column if not exists requires_party  boolean not null default false,
  add column if not exists is_cash_account boolean not null default false;

-- derive normal balance from type, then flip it for contra accounts
update public.accounts
   set normal_balance = case when type in ('asset','expense') then 'debit' else 'credit' end
 where normal_balance is null;

-- contra accounts present in the current chart
update public.accounts set is_contra = true, normal_balance = 'credit' where code = '1290';
update public.accounts set is_contra = true, normal_balance = 'debit'  where code = '3300';

-- parents are never postable
update public.accounts a
   set is_postable = false
 where exists (select 1 from public.accounts c where c.parent_id = a.id);

-- control accounts and their subledgers
update public.accounts
   set is_control = true, requires_party = true, subledger = 'customers'
 where code = '1130';
update public.accounts
   set is_control = true, requires_party = true, subledger = 'suppliers'
 where code = '2110';

-- cash accounts: the basis of the cash-flow statement
update public.accounts set is_cash_account = true where code in ('1110','1120');

alter table public.accounts alter column normal_balance set not null;

do $$
begin
  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.accounts'::regclass and conname = 'accounts_normal_balance_check') then
    alter table public.accounts
      add constraint accounts_normal_balance_check check (normal_balance in ('debit','credit'));
  end if;
  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.accounts'::regclass and conname = 'accounts_subledger_check') then
    alter table public.accounts
      add constraint accounts_subledger_check check (subledger is null or subledger in ('customers','suppliers'));
  end if;
  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.accounts'::regclass and conname = 'accounts_control_needs_subledger_check') then
    alter table public.accounts
      add constraint accounts_control_needs_subledger_check check (is_control = false or subledger is not null);
  end if;
end $$;

comment on column public.accounts.normal_balance  is 'الطبيعة: debit / credit — مقلوبة للحسابات العكسية';
comment on column public.accounts.is_postable     is 'قابل للترحيل — false لكل حساب أب (V03)';
comment on column public.accounts.is_control      is 'حساب مراقبة يقابله دفتر مساعد';
comment on column public.accounts.subledger       is 'اسم الدفتر المساعد: customers / suppliers';
comment on column public.accounts.is_contra       is 'حساب عكسي يُطرح من مجموعته';
comment on column public.accounts.statement_line  is 'بند القائمة المالية — يُملأ عند بناء القوائم';
comment on column public.accounts.requires_party  is 'يستلزم طرفاً على البند (V06)';
comment on column public.accounts.is_cash_account is 'حساب نقدي — أساس قائمة التدفقات النقدية';
