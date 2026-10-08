-- ============================================================
-- ربط الأصول الثابتة والإهلاك بدفتر اليومية
--
-- قبل هذا الترحيل كان سجل الأصول منفصلًا عن الدفاتر: مجمع الإهلاك يُكتب
-- يدويًا ولا يُرحَّل، والإهلاك الشهري لا يُسجَّل فيبقى الربح أعلى من حقيقته.
--
-- 1) اقتناء الأصل (fixed_assets.acquisition_source):
--      purchase  اشتُري بفاتورة مشتريات مرحّلة على حساب الأصل: لا قيد جديد
--                (القيد موجود من فاتورة المشتريات)، ويُربط بها purchase_id.
--      cash/bank مدين حساب الأصل / دائن الصندوق أو البنك.
--      capital   قدّمه المالك: مدين حساب الأصل / دائن رأس المال.
--      opening   مملوك قبل بداية التشغيل: بتاريخ بداية التشغيل، مدين حساب الأصل
--                بالتكلفة / دائن مجمع الإهلاك بالإهلاك السابق / دائن رأس المال
--                بالصافي.
-- 2) الإهلاك: قسط ثابت شهري = (التكلفة − الخردة) ÷ (العمر بالسنوات × 12)،
--    يبدأ من شهر الشراء كاملًا (أو شهر بداية التشغيل للرصيد الافتتاحي)، ولا
--    إهلاك في شهر البيع أو الاستبعاد، ويتوقف عند بلوغ التكلفة − الخردة. الأصل
--    بلا عمر إنتاجي (الأراضي) لا يُهلَك.
--    قيد لكل شهر بتاريخ آخر يوم فيه: مدين مصروف الإهلاك / دائن مجمع إهلاك كل أصل.
--    كل قسط محفوظ في asset_depreciation (أصل × شهر مرة واحدة فقط ما لم يُعكس).
--    التراجع لا يحذف الأقساط بل يعلّمها reversed، فيبقى أثرها للتدقيق.
--    fn_run_depreciation يرحّل ما لم يُرحَّل حتى تاريخ، ومهمة pg_cron تشغّله أول
--    كل شهر. fn_undo_last_depreciation يعكس آخر شهر لتصحيح خطأ.
-- 3) البيع أو الاستبعاد (status = sold / disposed): يُرحَّل إهلاك الأصل حتى
--    الشهر السابق للبيع، ثم: مدين مجمع الإهلاك + مدين النقدية بالمتحصّل /
--    دائن حساب الأصل بالتكلفة، والفرق أرباح (4920) أو خسائر (5950) بيع أصول.
--    إعادة الأصل «نشطًا» تعكس قيد البيع.
-- 4) بعد ترحيل أي إهلاك أو بيع لا تتغيّر بيانات الأصل المحاسبية (FA01)؛
--    التصحيح بالتراجع عن الإهلاك أولًا. accumulated_depreciation محسوب دائمًا.
-- ============================================================

-- ---------- حسابات أرباح وخسائر بيع الأصول ----------
insert into public.accounts (code, name, type, subtype, parent_id, normal_balance)
select '4920', 'أرباح بيع الأصول الثابتة', 'revenue', 'إيرادات',
       (select id from public.accounts where code = '4900'), 'credit'
 where not exists (select 1 from public.accounts where code = '4920');

insert into public.accounts (code, name, type, subtype, parent_id, normal_balance)
select '5950', 'خسائر بيع واستبعاد الأصول الثابتة', 'expense', 'مصروفات',
       (select id from public.accounts where code = '5000'), 'debit'
 where not exists (select 1 from public.accounts where code = '5950');

insert into public.account_map (map_key, account_id, description)
values ('ASSET_DISPOSAL_GAIN', (select id from public.accounts where code = '4920'), 'أرباح بيع الأصول الثابتة'),
       ('ASSET_DISPOSAL_LOSS', (select id from public.accounts where code = '5950'), 'خسائر بيع واستبعاد الأصول الثابتة')
on conflict (map_key) do nothing;

-- ---------- أعمدة سجل الأصول ----------
alter table public.fixed_assets
  add column if not exists asset_account_id       uuid references public.accounts (id) on delete restrict,
  add column if not exists accumulated_account_id uuid references public.accounts (id) on delete restrict,
  add column if not exists salvage_value          numeric(14,2) not null default 0,
  add column if not exists acquisition_source     text,
  add column if not exists purchase_id            uuid references public.purchases (id) on delete restrict,
  add column if not exists opening_accumulated    numeric(14,2) not null default 0,
  add column if not exists acquisition_entry_id   uuid references public.journal_entries (id) on delete restrict,
  add column if not exists disposal_date          date,
  add column if not exists disposal_proceeds      numeric(14,2) not null default 0,
  add column if not exists disposal_method        text,
  add column if not exists disposal_entry_id      uuid references public.journal_entries (id) on delete restrict,
  add column if not exists notes                  text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'fixed_assets_source_check') then
    alter table public.fixed_assets add constraint fixed_assets_source_check
      check (acquisition_source is null or acquisition_source in ('purchase', 'cash', 'bank', 'capital', 'opening'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'fixed_assets_method_check') then
    alter table public.fixed_assets add constraint fixed_assets_method_check
      check (depreciation_method = 'straight_line');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'fixed_assets_disposal_method_check') then
    alter table public.fixed_assets add constraint fixed_assets_disposal_method_check
      check (disposal_method is null or disposal_method in ('cash', 'bank'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'fixed_assets_amounts_check') then
    alter table public.fixed_assets add constraint fixed_assets_amounts_check
      check (salvage_value >= 0 and opening_accumulated >= 0 and disposal_proceeds >= 0);
  end if;
end $$;

comment on column public.fixed_assets.accumulated_depreciation is
  'محسوب: الإهلاك الافتتاحي + أقساط asset_depreciation. لا يُكتب يدويًا';

create index if not exists fixed_assets_asset_account_idx       on public.fixed_assets (asset_account_id);
create index if not exists fixed_assets_accumulated_account_idx on public.fixed_assets (accumulated_account_id);
create index if not exists fixed_assets_purchase_idx            on public.fixed_assets (purchase_id);
create index if not exists fixed_assets_acquisition_entry_idx   on public.fixed_assets (acquisition_entry_id);
create index if not exists fixed_assets_disposal_entry_idx      on public.fixed_assets (disposal_entry_id);

-- ---------- أقساط الإهلاك المرحّلة ----------
create table if not exists public.asset_depreciation (
  id               uuid primary key default gen_random_uuid(),
  asset_id         uuid not null references public.fixed_assets (id) on delete restrict,
  period_month     date not null check (period_month = date_trunc('month', period_month)::date),
  amount           numeric(14,2) not null check (amount > 0),
  journal_entry_id uuid not null references public.journal_entries (id) on delete restrict,
  reversed         boolean not null default false,
  created_at       timestamptz not null default now()
);

-- قسط واحد قائم لكل أصل في كل شهر
create unique index if not exists asset_depreciation_live_uidx
  on public.asset_depreciation (asset_id, period_month) where not reversed;
create index if not exists asset_depreciation_entry_idx on public.asset_depreciation (journal_entry_id);

alter table public.asset_depreciation enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'asset_depreciation' and policyname = 'authenticated_select') then
    create policy authenticated_select on public.asset_depreciation for select to authenticated using (true);
  end if;
end $$;
-- يُكتب من دوال الإهلاك وحدها
revoke all on table public.asset_depreciation from anon, authenticated;
grant select on table public.asset_depreciation to authenticated;

-- ---------- مساعدات ----------
create or replace function public.fn_asset_start_month(a public.fixed_assets)
returns date
language sql
stable
set search_path = ''
as $$
  select date_trunc('month', case when a.acquisition_source = 'opening'
                                  then (select coalesce(min(go_live_date), date '2026-07-01') from public.company_settings)
                                  else a.purchase_date end)::date;
$$;

-- قيد الاقتناء (فارغ لمصدر purchase: القيد من فاتورة المشتريات)
create or replace function public.fn_asset_acquire(a public.fixed_assets)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_golive date;
  v_credit uuid;
  v_entry  uuid;
  v_label  text := 'اقتناء أصل ' || a.code || ' — ' || a.name;
begin
  if a.acquisition_source = 'purchase' then
    return null;
  end if;

  select coalesce(min(go_live_date), date '2026-07-01') into v_golive from public.company_settings;

  select account_id into v_credit from public.account_map
   where map_key = case a.acquisition_source when 'cash' then 'CASH' when 'bank' then 'BANK' else 'CAPITAL' end;

  insert into public.journal_entries
        (entry_date, description, reference, status, source, transaction_type, document_type, document_id)
  values (case when a.acquisition_source = 'opening' then v_golive else a.purchase_date end,
          case when a.acquisition_source = 'opening' then 'رصيد افتتاحي — ' || v_label else v_label end,
          a.code, 'draft', 'system', 'asset_acquisition', 'fixed_asset', a.id)
  returning id into v_entry;

  insert into public.journal_entry_lines (entry_id, account_id, description, debit, credit)
  values (v_entry, a.asset_account_id, v_label, a.purchase_cost, 0);

  if a.acquisition_source = 'opening' and a.opening_accumulated > 0 then
    insert into public.journal_entry_lines (entry_id, account_id, description, debit, credit)
    values (v_entry, a.accumulated_account_id, 'مجمع إهلاك افتتاحي — ' || a.code, 0, a.opening_accumulated);
  end if;

  if (a.purchase_cost - (case when a.acquisition_source = 'opening' then a.opening_accumulated else 0 end)) > 0 then
    insert into public.journal_entry_lines (entry_id, account_id, description, debit, credit, cash_flow_category)
    values (v_entry, v_credit, v_label, 0,
            a.purchase_cost - case when a.acquisition_source = 'opening' then a.opening_accumulated else 0 end,
            case when a.acquisition_source in ('cash', 'bank') then 'investing' end);
  end if;

  perform public.fn_post_entry(v_entry);
  return v_entry;
end;
$$;

-- قيد البيع أو الاستبعاد؛ p_accumulated = مجمع الإهلاك بعد ترحيل ما قبل البيع
create or replace function public.fn_asset_dispose(a public.fixed_assets, p_accumulated numeric)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cash   uuid;
  v_entry  uuid;
  v_diff   numeric(14,2);
  v_label  text := case a.status when 'sold' then 'بيع أصل ' else 'استبعاد أصل ' end || a.code || ' — ' || a.name;
begin
  insert into public.journal_entries
        (entry_date, description, reference, status, source, transaction_type, document_type, document_id)
  values (a.disposal_date, v_label, a.code, 'draft', 'system', 'asset_disposal', 'fixed_asset_disposal', a.id)
  returning id into v_entry;

  if p_accumulated > 0 then
    insert into public.journal_entry_lines (entry_id, account_id, description, debit, credit)
    values (v_entry, a.accumulated_account_id, 'إقفال مجمع الإهلاك — ' || a.code, p_accumulated, 0);
  end if;

  if a.disposal_proceeds > 0 then
    select account_id into v_cash from public.account_map
     where map_key = case a.disposal_method when 'cash' then 'CASH' else 'BANK' end;
    insert into public.journal_entry_lines (entry_id, account_id, description, debit, credit, cash_flow_category)
    values (v_entry, v_cash, 'متحصّلات ' || v_label, a.disposal_proceeds, 0, 'investing');
  end if;

  insert into public.journal_entry_lines (entry_id, account_id, description, debit, credit)
  values (v_entry, a.asset_account_id, v_label, 0, a.purchase_cost);

  v_diff := a.disposal_proceeds + p_accumulated - a.purchase_cost;
  if v_diff > 0 then
    insert into public.journal_entry_lines (entry_id, account_id, description, debit, credit)
    values (v_entry, (select account_id from public.account_map where map_key = 'ASSET_DISPOSAL_GAIN'),
            'ربح ' || v_label, 0, v_diff);
  elsif v_diff < 0 then
    insert into public.journal_entry_lines (entry_id, account_id, description, debit, credit)
    values (v_entry, (select account_id from public.account_map where map_key = 'ASSET_DISPOSAL_LOSS'),
            'خسارة ' || v_label, -v_diff, 0);
  end if;

  perform public.fn_post_entry(v_entry);
  return v_entry;
end;
$$;

-- ---------- ترحيل الإهلاك ----------
-- يرحّل كل قسط لم يُرحَّل لكل شهر انتهى حتى p_through (أو لأصل واحد).
-- p_touch = false عند ندائه من محفز الأصل نفسه (لا يعدّل صف الأصل).
create or replace function public.fn_post_depreciation(p_through date, p_asset uuid default null, p_touch boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_last    date;
  v_first   date;
  v_m       date;
  v_end     date;
  v_entry   uuid;
  v_total   numeric(14,2);
  v_amt     numeric(14,2);
  v_rem     numeric(14,2);
  v_exp     uuid;
  v_entries integer := 0;
  v_sum     numeric(14,2) := 0;
  a         public.fixed_assets%rowtype;
  v_touched uuid[] := '{}';
begin
  if p_through is null then
    raise exception 'FA11: حدد تاريخ ترحيل الإهلاك' using errcode = '23514';
  end if;

  -- آخر شهر انتهى في p_through أو قبله، ولا يُرحَّل شهر قبل انتهائه
  v_last := date_trunc('month', p_through)::date;
  if (v_last + interval '1 month' - interval '1 day')::date > p_through then
    v_last := (v_last - interval '1 month')::date;
  end if;
  if (v_last + interval '1 month' - interval '1 day')::date > current_date then
    raise exception 'FA11: لا يُرحَّل إهلاك شهر قبل انتهائه' using errcode = '23514';
  end if;

  select min(public.fn_asset_start_month(fa)) into v_first
    from public.fixed_assets fa
   where fa.useful_life_years > 0 and (p_asset is null or fa.id = p_asset);
  if v_first is null or v_first > v_last then
    return jsonb_build_object('entries', 0, 'amount', 0);
  end if;

  select account_id into v_exp from public.account_map where map_key = 'DEPRECIATION_EXPENSE';
  perform set_config('app.document_posting', 'on', true);

  for v_m in select generate_series(v_first, v_last, interval '1 month')::date loop
    v_end := (v_m + interval '1 month' - interval '1 day')::date;
    v_entry := null;
    v_total := 0;

    for a in
      select fa.* from public.fixed_assets fa
       where fa.useful_life_years > 0
         and (p_asset is null or fa.id = p_asset)
         and public.fn_asset_start_month(fa) <= v_m
         and (fa.disposal_date is null or v_m < date_trunc('month', fa.disposal_date)::date)
         and not exists (select 1 from public.asset_depreciation d
                          where d.asset_id = fa.id and d.period_month = v_m and not d.reversed)
       order by fa.code
    loop
      v_rem := a.purchase_cost - a.salvage_value - a.opening_accumulated
               - coalesce((select sum(d.amount) from public.asset_depreciation d where d.asset_id = a.id and not d.reversed), 0);
      if v_rem <= 0 then
        continue;
      end if;
      v_amt := least(round((a.purchase_cost - a.salvage_value) / (a.useful_life_years * 12), 2), v_rem);
      if v_amt <= 0 then
        continue;
      end if;

      if v_entry is null then
        insert into public.journal_entries
              (entry_date, description, reference, status, source, transaction_type, document_type)
        values (v_end, 'إهلاك الأصول الثابتة — ' || to_char(v_m, 'YYYY-MM'), 'DEP-' || to_char(v_m, 'YYYY-MM'),
                'draft', 'system', 'depreciation', 'depreciation')
        returning id into v_entry;
      end if;

      insert into public.journal_entry_lines (entry_id, account_id, description, debit, credit)
      values (v_entry, a.accumulated_account_id, 'إهلاك ' || a.code || ' — ' || a.name, 0, v_amt);

      insert into public.asset_depreciation (asset_id, period_month, amount, journal_entry_id)
      values (a.id, v_m, v_amt, v_entry);

      v_total := v_total + v_amt;
      v_touched := array_append(v_touched, a.id);
    end loop;

    if v_entry is not null then
      insert into public.journal_entry_lines (entry_id, account_id, description, debit, credit)
      values (v_entry, v_exp, 'مصروف الإهلاك — ' || to_char(v_m, 'YYYY-MM'), v_total, 0);
      perform public.fn_post_entry(v_entry);
      v_entries := v_entries + 1;
      v_sum := v_sum + v_total;
    end if;
  end loop;

  perform set_config('app.document_posting', '', true);

  if p_touch and array_length(v_touched, 1) > 0 then
    update public.fixed_assets set accumulated_depreciation = accumulated_depreciation
     where id = any (v_touched);
  end if;

  return jsonb_build_object('entries', v_entries, 'amount', v_sum);
end;
$$;

-- نداء الواجهة والمهمة المجدولة: كل الأصول حتى تاريخ
create or replace function public.fn_run_depreciation(p_through date default null)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.fn_post_depreciation(
    coalesce(p_through, (date_trunc('month', current_date) - interval '1 day')::date));
$$;

-- التراجع عن آخر شهر مرحّل (لتصحيح بيانات أصل ثم إعادة الترحيل)
create or replace function public.fn_undo_last_depreciation()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_m       date;
  v_entry   uuid;
  v_count   integer := 0;
  v_assets  uuid[];
begin
  select max(period_month) into v_m from public.asset_depreciation where not reversed;
  if v_m is null then
    raise exception 'FA10: لا يوجد إهلاك مرحّل' using errcode = '23514';
  end if;

  select array_agg(distinct asset_id) into v_assets from public.asset_depreciation where period_month = v_m and not reversed;
  if exists (select 1 from public.fixed_assets where id = any (v_assets) and disposal_entry_id is not null) then
    raise exception 'FA10: إهلاك % يخص أصلًا بِيع أو استُبعد بعده — أعد الأصل نشطًا أولًا', to_char(v_m, 'YYYY-MM')
      using errcode = '23514';
  end if;

  perform set_config('app.document_posting', 'on', true);
  for v_entry in select distinct journal_entry_id from public.asset_depreciation where period_month = v_m and not reversed loop
    perform public.fn_document_reverse(v_entry, 'التراجع عن إهلاك ' || to_char(v_m, 'YYYY-MM'));
    v_count := v_count + 1;
  end loop;
  update public.asset_depreciation set reversed = true where period_month = v_m and not reversed;
  perform set_config('app.document_posting', '', true);

  update public.fixed_assets set accumulated_depreciation = accumulated_depreciation where id = any (v_assets);

  return jsonb_build_object('month', to_char(v_m, 'YYYY-MM'), 'entries', v_count);
end;
$$;

-- ---------- محفز الأصل ----------
create or replace function public.tg_fixed_asset_posting()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_golive   date;
  v_acc      public.accounts%rowtype;
  v_cum      public.accounts%rowtype;
  v_pur      public.purchases%rowtype;
  v_has_dep  boolean;
  v_acct_chg boolean;
  v_accum    numeric(14,2);
  v_map      text;
begin
  perform set_config('app.document_posting', 'on', true);

  if tg_op = 'DELETE' then
    -- FA03: أصل عليه إهلاك أو بيع مرحّل لا يُحذف
    if exists (select 1 from public.asset_depreciation where asset_id = old.id and not reversed) or old.disposal_entry_id is not null then
      raise exception 'FA03: الأصل % عليه إهلاك أو بيع مرحّل — لا يُحذف. استبعده، أو تراجع عن الإهلاك أولًا', old.code
        using errcode = '23514';
    end if;
    if old.acquisition_entry_id is not null then
      perform public.fn_document_reverse(old.acquisition_entry_id, 'حذف الأصل ' || old.code);
    end if;
    perform set_config('app.document_posting', '', true);
    return old;
  end if;

  select coalesce(min(go_live_date), date '2026-07-01') into v_golive from public.company_settings;

  if tg_op = 'UPDATE' then
    v_acct_chg := (new.purchase_cost, new.salvage_value, new.useful_life_years, new.purchase_date,
                   new.asset_account_id, new.accumulated_account_id, new.acquisition_source,
                   new.purchase_id, new.opening_accumulated, new.depreciation_method)
                  is distinct from
                  (old.purchase_cost, old.salvage_value, old.useful_life_years, old.purchase_date,
                   old.asset_account_id, old.accumulated_account_id, old.acquisition_source,
                   old.purchase_id, old.opening_accumulated, old.depreciation_method);
  end if;

  -- التحقق من البيانات المحاسبية عند الإنشاء أو تعديلها فقط: تحديث المجمع بعد
  -- ترحيل الإهلاك لا يعيد فحص ما لم يتغيّر.
  if tg_op = 'INSERT' or v_acct_chg then

  -- FA00: المبالغ والعمر
  if new.purchase_cost is null or new.purchase_cost <= 0 then
    raise exception 'FA00: تكلفة الأصل يجب أن تكون أكبر من صفر' using errcode = '23514';
  end if;
  if new.useful_life_years is not null and new.useful_life_years <= 0 then
    raise exception 'FA00: العمر الإنتاجي يجب أن يكون سنة أو أكثر، أو فارغًا للأصل الذي لا يُهلَك' using errcode = '23514';
  end if;
  if new.salvage_value >= new.purchase_cost then
    raise exception 'FA00: قيمة الخردة يجب أن تكون أقل من التكلفة' using errcode = '23514';
  end if;

  -- FA05: حساب الأصل ومجمع إهلاكه
  select * into v_acc from public.accounts where id = new.asset_account_id;
  if not found or v_acc.type <> 'asset' or v_acc.is_contra or v_acc.is_control or v_acc.is_cash_account
     or not v_acc.is_postable or not v_acc.is_active then
    raise exception 'FA05: اختر حساب الأصل الثابت (مثل 1240 أجهزة حاسب آلي)' using errcode = '23514';
  end if;
  if new.accumulated_account_id is null then
    v_map := case v_acc.code when '1210' then 'ACCUM_DEP_BUILDINGS' when '1220' then 'ACCUM_DEP_FURNITURE'
                             when '1230' then 'ACCUM_DEP_VEHICLES' when '1240' then 'ACCUM_DEP_COMPUTERS' end;
    select account_id into new.accumulated_account_id from public.account_map where map_key = v_map;
  end if;
  select * into v_cum from public.accounts where id = new.accumulated_account_id;
  if not found or v_cum.type <> 'asset' or not v_cum.is_contra or not v_cum.is_postable or not v_cum.is_active then
    raise exception 'FA05: اختر حساب مجمع الإهلاك المقابل للأصل' using errcode = '23514';
  end if;

  -- FA06/FA04: مصدر الاقتناء وتاريخه
  if new.acquisition_source is null then
    raise exception 'FA06: اختر طريقة اقتناء الأصل' using errcode = '23514';
  end if;
  if new.acquisition_source = 'opening' and new.purchase_date >= v_golive then
    raise exception 'FA04: الرصيد الافتتاحي للأصول المملوكة قبل بداية التشغيل (%) فقط', v_golive using errcode = '23514';
  end if;
  if new.acquisition_source <> 'opening' and new.purchase_date < v_golive then
    raise exception 'FA04: أصل مملوك قبل بداية التشغيل (%) يُسجَّل كرصيد افتتاحي', v_golive using errcode = '23514';
  end if;
  if new.acquisition_source <> 'opening' then
    new.opening_accumulated := 0;
  elsif new.opening_accumulated > new.purchase_cost - new.salvage_value then
    raise exception 'FA00: الإهلاك الافتتاحي أكبر من القيمة القابلة للإهلاك' using errcode = '23514';
  end if;

  -- FA07: الاقتناء بفاتورة مشتريات مرحّلة على حساب الأصل نفسه
  if new.acquisition_source = 'purchase' then
    select * into v_pur from public.purchases where id = new.purchase_id;
    if not found or v_pur.status not in ('received', 'paid') then
      raise exception 'FA07: اختر فاتورة المشتريات المستلمة التي اشتُري بها الأصل' using errcode = '23514';
    end if;
    if v_pur.account_id is distinct from new.asset_account_id then
      raise exception 'FA07: فاتورة المشتريات % مرحّلة على حساب آخر — يجب أن تكون على حساب الأصل %',
        v_pur.purchase_number, v_acc.code using errcode = '23514';
    end if;
    if new.purchase_cost + coalesce((select sum(purchase_cost) from public.fixed_assets
                                      where purchase_id = new.purchase_id and id <> new.id), 0)
       > v_pur.subtotal then
      raise exception 'FA07: تكلفة الأصول المسجّلة على فاتورة المشتريات % تتجاوز قيمتها قبل الضريبة', v_pur.purchase_number
        using errcode = '23514';
    end if;
  else
    new.purchase_id := null;
  end if;

  end if;  -- التحقق

  if tg_op = 'INSERT' then
    -- FA09: الأصل يُسجَّل نشطًا؛ البيع والاستبعاد بعده
    if new.status <> 'active' then
      raise exception 'FA09: سجّل الأصل نشطًا أولًا، ثم بِعه أو استبعده' using errcode = '23514';
    end if;
    new.disposal_date := null; new.disposal_proceeds := 0; new.disposal_method := null;
    new.disposal_entry_id := null;
    new.accumulated_depreciation := new.opening_accumulated;
    new.acquisition_entry_id := public.fn_asset_acquire(new);
    perform set_config('app.document_posting', '', true);
    return new;
  end if;

  -- ===== UPDATE =====
  new.acquisition_entry_id := old.acquisition_entry_id;
  new.disposal_entry_id := old.disposal_entry_id;
  v_has_dep := exists (select 1 from public.asset_depreciation where asset_id = new.id and not reversed);

  -- FA01: بعد الإهلاك أو البيع لا تتغيّر البيانات المحاسبية
  if v_acct_chg and (v_has_dep or old.disposal_entry_id is not null) then
    raise exception 'FA01: الأصل % عليه إهلاك أو بيع مرحّل — لا تُعدَّل تكلفته ولا عمره ولا حساباته. تراجع عن الإهلاك أولًا', old.code
      using errcode = '23514';
  end if;

  -- إعادة ترحيل الاقتناء عند تعديل بياناته
  if v_acct_chg then
    if old.acquisition_entry_id is not null then
      perform public.fn_document_reverse(old.acquisition_entry_id, 'تعديل الأصل ' || new.code);
    end if;
    new.acquisition_entry_id := public.fn_asset_acquire(new);
  end if;

  -- البيع أو الاستبعاد
  if new.status in ('sold', 'disposed') and old.status = 'active' then
    if v_acct_chg then
      raise exception 'FA08: احفظ تعديلات الأصل أولًا، ثم بِعه أو استبعده' using errcode = '23514';
    end if;
    if new.disposal_date is null or new.disposal_date < new.purchase_date or new.disposal_date > current_date then
      raise exception 'FA08: حدد تاريخ البيع أو الاستبعاد (بين تاريخ الشراء واليوم)' using errcode = '23514';
    end if;
    -- لا إهلاك في شهر البيع: إن رُحّل شهره أو ما بعده يُتراجع عنه أولًا
    if exists (select 1 from public.asset_depreciation
                where asset_id = new.id and not reversed and period_month >= date_trunc('month', new.disposal_date)::date) then
      raise exception 'FA08: الأصل % عليه إهلاك مرحّل لشهر البيع أو بعده — تراجع عن إهلاك تلك الشهور أولًا', new.code
        using errcode = '23514';
    end if;
    if new.status = 'sold' and (new.disposal_proceeds <= 0 or new.disposal_method is null) then
      raise exception 'FA08: البيع يحتاج المبلغ المتحصّل وطريقة استلامه (نقدي أو بنك)' using errcode = '23514';
    end if;
    if new.status = 'disposed' then
      new.disposal_proceeds := 0; new.disposal_method := null;
    end if;

    -- إهلاك الأصل حتى الشهر السابق للبيع، ثم قيد البيع بمجمع الإهلاك الفعلي
    if new.useful_life_years > 0 and date_trunc('month', new.disposal_date)::date > public.fn_asset_start_month(new) then
      perform public.fn_post_depreciation((date_trunc('month', new.disposal_date) - interval '1 day')::date, new.id, false);
      perform set_config('app.document_posting', 'on', true);
    end if;
    v_accum := new.opening_accumulated
               + coalesce((select sum(amount) from public.asset_depreciation where asset_id = new.id and not reversed), 0);
    new.disposal_entry_id := public.fn_asset_dispose(new, v_accum);

  elsif new.status = 'active' and old.status in ('sold', 'disposed') then
    -- التراجع عن البيع
    if old.disposal_entry_id is not null then
      perform public.fn_document_reverse(old.disposal_entry_id, 'التراجع عن بيع/استبعاد الأصل ' || new.code);
    end if;
    new.disposal_entry_id := null; new.disposal_date := null;
    new.disposal_proceeds := 0; new.disposal_method := null;

  elsif new.status in ('sold', 'disposed')
        and (new.status, new.disposal_date, new.disposal_proceeds, new.disposal_method)
            is distinct from (old.status, old.disposal_date, old.disposal_proceeds, old.disposal_method) then
    raise exception 'FA08: لتعديل بيانات البيع أعد الأصل نشطًا ثم بِعه من جديد' using errcode = '23514';
  end if;

  new.accumulated_depreciation := new.opening_accumulated
    + coalesce((select sum(amount) from public.asset_depreciation where asset_id = new.id and not reversed), 0);

  perform set_config('app.document_posting', '', true);
  return new;
end;
$$;

create or replace trigger fixed_asset_posting
before insert or update or delete on public.fixed_assets
for each row execute function public.tg_fixed_asset_posting();

-- ---------- P04: فاتورة مشتريات مرتبطة بأصل ----------
create or replace function public.tg_purchase_asset_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cost numeric(14,2);
begin
  select sum(purchase_cost) into v_cost from public.fixed_assets where purchase_id = old.id;
  if v_cost is null then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'DELETE'
     or new.status in ('draft', 'cancelled')
     or new.account_id is distinct from old.account_id
     or new.subtotal < v_cost then
    raise exception 'P04: فاتورة المشتريات % مسجّل عليها أصول ثابتة بتكلفة % — عدّل الأصول أو احذفها أولًا',
      old.purchase_number, v_cost using errcode = '23514';
  end if;
  return new;
end;
$$;

-- الاسم قبل purchase_number و purchase_posting أبجديًا: يُفحص أولًا
create or replace trigger purchase_asset_guard
before update or delete on public.purchases
for each row execute function public.tg_purchase_asset_guard();

-- ---------- الصلاحيات ----------
revoke all on function public.fn_asset_start_month(public.fixed_assets)            from public, anon;
revoke all on function public.fn_asset_acquire(public.fixed_assets)                from public, anon, authenticated;
revoke all on function public.fn_asset_dispose(public.fixed_assets, numeric)       from public, anon, authenticated;
revoke all on function public.fn_post_depreciation(date, uuid, boolean)            from public, anon, authenticated;
revoke all on function public.tg_fixed_asset_posting()                             from public, anon, authenticated;
revoke all on function public.tg_purchase_asset_guard()                            from public, anon, authenticated;
revoke all on function public.fn_run_depreciation(date)                            from public, anon;
revoke all on function public.fn_undo_last_depreciation()                          from public, anon;
grant execute on function public.fn_asset_start_month(public.fixed_assets) to authenticated;
grant execute on function public.fn_run_depreciation(date)                  to authenticated;
grant execute on function public.fn_undo_last_depreciation()                to authenticated;

-- الترحيل الشهري التلقائي في 20261008235100_depreciation_schedule.
