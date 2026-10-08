-- ============================================================
-- ترحيل الفواتير إلى دفتر اليومية
--
-- قبل هذا الترحيل كانت الفاتورة تُحدِّث رصيد العميل فقط، ولا يصل
-- أثرها إلى الحسابات: العملاء (1130) والإيرادات بصفر مهما صدر من فواتير.
--
-- القاعدة: كل فاتورة خرجت من المسودة ولم تُلغَ لها قيد مرحّل واحد
-- (invoices.journal_entry_id):
--   مدين  العملاء (ACCOUNTS_RECEIVABLE) بالإجمالي، والطرف هو العميل
--   دائن  إيراد الباقة (service_plans.revenue_account_id) أو SERVICE_REVENUE
--         بالإجمالي ناقص الضريبة
--   دائن  ضريبة المخرجات (VAT_OUTPUT) بالضريبة
--
-- - الإلغاء أو الرجوع لمسودة أو الحذف: يُعكس القيد بـ fn_reverse_entry.
-- - تعديل أي حقل مالي في فاتورة مرحّلة: يُعكس القيد القديم ويُرحَّل جديد.
--   المحاسبة لا تُمحى أبداً؛ كل تصحيح أثره قيد عكسي ظاهر.
-- - الدفاتر بالجنيه فقط (V15)، فالفاتورة بعملة أخرى تُحوَّل بـ
--   invoices.exchange_rate، ولا تُرحَّل ما دام السعر غير محدد.
-- - فاتورة تاريخها قبل بداية التشغيل (go_live_date) إيرادها يخص فترة
--   سابقة: تُرحَّل بتاريخ بداية التشغيل كرصيد افتتاحي، مدين العملاء
--   ودائن رأس المال (المنشأة فردية، فلا أرباح محتجزة — 3200 معطّل).
--   لا تُستعمل خانة القيد الافتتاحي الوحيد (V18) حتى تبقى متاحة
--   لأرصدة الافتتاح الأخرى.
-- ============================================================

alter table public.invoices
  add column if not exists exchange_rate    numeric(14,6),
  add column if not exists journal_entry_id uuid references public.journal_entries (id) on delete restrict;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'invoices_exchange_rate_check') then
    alter table public.invoices
      add constraint invoices_exchange_rate_check check (exchange_rate is null or exchange_rate > 0);
  end if;
end $$;

comment on column public.invoices.exchange_rate is
  'جنيه مصري لكل وحدة من عملة الفاتورة. فارغ للفواتير بالجنيه. بدونه لا تُرحَّل فاتورة بعملة أخرى';
comment on column public.invoices.journal_entry_id is
  'قيد اليومية المرحّل الحالي للفاتورة، يكتبه المحفز invoice_posting وحده';

create index if not exists invoices_journal_entry_idx
  on public.invoices (journal_entry_id) where journal_entry_id is not null;

-- ---------- الترحيل ----------
create or replace function public.fn_invoice_post(inv public.invoices)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_golive   date;
  v_rate     numeric;
  v_total    numeric(14,2);
  v_tax      numeric(14,2);
  v_ar       uuid;
  v_credit   uuid;
  v_vat      uuid;
  v_date     date;
  v_opening  boolean;
  v_entry    uuid;
begin
  select coalesce(min(go_live_date), date '2026-07-01') into v_golive from public.company_settings;

  v_rate := case when coalesce(inv.currency, 'EGP') = 'EGP' then 1 else inv.exchange_rate end;

  v_total := round(inv.total * v_rate, 2);
  v_tax   := round(inv.tax_amount * v_rate, 2);
  if v_total = 0 then
    return null;   -- الخطة المجانية: لا أثر محاسبي
  end if;

  select account_id into v_ar  from public.account_map where map_key = 'ACCOUNTS_RECEIVABLE';
  select account_id into v_vat from public.account_map where map_key = 'VAT_OUTPUT';

  v_opening := inv.issue_date < v_golive;
  v_date    := greatest(inv.issue_date, v_golive);

  if v_opening then
    select account_id into v_credit from public.account_map where map_key = 'CAPITAL';
  else
    select sp.revenue_account_id into v_credit from public.service_plans sp where sp.id = inv.plan_id;
    if v_credit is null then
      select account_id into v_credit from public.account_map where map_key = 'SERVICE_REVENUE';
    end if;
  end if;

  insert into public.journal_entries
        (entry_date, description, reference, status, source, transaction_type, document_type, document_id)
  values (v_date,
          case when v_opening
               then 'رصيد افتتاحي — فاتورة ' || inv.invoice_number || ' بتاريخ ' || inv.issue_date
               else 'فاتورة ' || inv.invoice_number end,
          inv.invoice_number, 'draft', 'system', 'sales_invoice', 'invoice', inv.id)
  returning id into v_entry;

  insert into public.journal_entry_lines (entry_id, account_id, description, debit, credit, party_type, party_id)
  values (v_entry, v_ar, 'فاتورة ' || inv.invoice_number, v_total, 0, 'customer', inv.customer_id);

  if v_total - v_tax > 0 then
    insert into public.journal_entry_lines (entry_id, account_id, description, debit, credit)
    values (v_entry, v_credit,
            case when v_opening then 'رصيد افتتاحي' else 'إيراد الفاتورة' end,
            0, v_total - v_tax);
  end if;

  if v_tax > 0 then
    insert into public.journal_entry_lines (entry_id, account_id, description, debit, credit)
    values (v_entry, v_vat, 'ضريبة القيمة المضافة', 0, v_tax);
  end if;

  perform public.fn_post_entry(v_entry);
  return v_entry;
end;
$$;

-- ---------- المحفز ----------
create or replace function public.tg_invoice_posting()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_want    boolean;
  v_changed boolean;
begin
  if tg_op = 'DELETE' then
    if old.journal_entry_id is not null then
      perform public.fn_reverse_entry(old.journal_entry_id, 'حذف الفاتورة ' || old.invoice_number);
    end if;
    return old;
  end if;

  -- القيد يُكتب هنا وحده
  if tg_op = 'UPDATE' then
    new.journal_entry_id := old.journal_entry_id;
  else
    new.journal_entry_id := null;
  end if;

  v_want := new.status not in ('draft', 'cancelled')
            and new.customer_id is not null
            and (coalesce(new.currency, 'EGP') = 'EGP' or new.exchange_rate is not null);

  if tg_op = 'UPDATE' and old.journal_entry_id is not null then
    v_changed := (new.total, new.tax_amount, new.customer_id, new.issue_date,
                  coalesce(new.currency, 'EGP'), new.exchange_rate, new.plan_id, new.invoice_number)
                 is distinct from
                 (old.total, old.tax_amount, old.customer_id, old.issue_date,
                  coalesce(old.currency, 'EGP'), old.exchange_rate, old.plan_id, old.invoice_number);

    if not v_want or v_changed then
      perform public.fn_reverse_entry(old.journal_entry_id,
        case
          when new.status = 'cancelled' then 'إلغاء الفاتورة ' || new.invoice_number
          when new.status = 'draft'     then 'إرجاع الفاتورة ' || new.invoice_number || ' إلى مسودة'
          else 'تعديل الفاتورة ' || new.invoice_number
        end);
      new.journal_entry_id := null;
    end if;
  end if;

  if v_want and new.journal_entry_id is null then
    new.journal_entry_id := public.fn_invoice_post(new);
  end if;

  return new;
end;
$$;

-- الاسم بعد invoice_number أبجدياً: الرقم يُولَّد قبل الترحيل
create or replace trigger invoice_posting
before insert or update or delete on public.invoices
for each row execute function public.tg_invoice_posting();

revoke all on function public.fn_invoice_post(public.invoices) from public, anon, authenticated;
revoke all on function public.tg_invoice_posting() from public, anon, authenticated;

-- ---------- الحدث الصادر لمدعوم: العملة الافتراضية صارت الجنيه ----------
create or replace function public.tg_invoice_outbox()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_issued boolean;
begin
  -- «الإصدار» = خروج الفاتورة من حالة المسودة
  if tg_op = 'INSERT' then
    v_issued := new.status <> 'draft';
  else
    v_issued := old.status = 'draft' and new.status <> 'draft';
  end if;

  if not v_issued or new.external_ticket_id is null then
    return null;
  end if;

  insert into public.integration_outbox (event_type, invoice_id, payload)
  values (
    'invoice.issued',
    new.id,
    jsonb_build_object(
      'invoice_id',       new.id,
      'invoice_number',   new.invoice_number,
      'issue_date',       new.issue_date,
      'due_date',         new.due_date,
      'subtotal',         new.subtotal,
      'tax_amount',       new.tax_amount,
      'total',            new.total,
      'currency',         coalesce(new.currency, 'EGP'),
      'status',           new.status,
      'ticket_id',        new.external_ticket_id,
      'ticket_number',    new.external_ticket_number,
      'subscription_id',  new.external_subscription_id,
      'customer_external_id', (
        select c.external_id from public.customers c where c.id = new.customer_id
      )
    )
  );

  return null;
end;
$$;

-- ---------- باقات مدعوم بالجنيه ----------
-- مطابقة لترحيل مدعوم 065 (2026-10-05): كل الخطط بالجنيه، و«الدعم الفني»
-- صار «الخطة المتقدمة» بنفس المفتاح، و«الفائقة» مفتاح جديد. accounting-sync
-- يأخذ سعر الفاتورة وعملتها من هنا، فبقاؤها بالدولار كان يُصدر فواتير بالدولار.
alter table public.service_plans alter column currency set default 'EGP';

insert into public.service_plans (code, billing_cycle, name, price, currency, revenue_account_id)
select v.code, v.cycle, v.name, v.price, 'EGP',
       (select account_id from public.account_map where map_key = 'SERVICE_REVENUE')
  from (values
    ('free',     'none',    'الخطة المجانية',                0),
    ('support',  'monthly', 'الخطة المتقدمة — شهري',          999),
    ('support',  'yearly',  'الخطة المتقدمة — سنوي',          9999),
    ('ultimate', 'monthly', 'الخطة الفائقة — شهري',           1999),
    ('ultimate', 'yearly',  'الخطة الفائقة — سنوي',           19999),
    ('whatsapp', 'monthly', 'واتساب — شهري',                  1299),
    ('whatsapp', 'yearly',  'واتساب — سنوي',                  12999),
    ('bundle',   'monthly', 'دعم فني + واتساب — شهري',        2099),
    ('bundle',   'yearly',  'دعم فني + واتساب — سنوي',        22999)
  ) as v(code, cycle, name, price)
on conflict (code, billing_cycle) do update
  set name = excluded.name, price = excluded.price, currency = 'EGP', is_active = true;

-- ---------- ترحيل الفواتير القائمة ----------
-- الفواتير التي صدرت بالدولار قبل التحويل تُرحَّل بسعر 52.50 جنيه للدولار،
-- وهو سعر التحويل المعتمد في ترحيل مدعوم 065.
update public.invoices
   set exchange_rate = 52.50
 where currency = 'USD' and exchange_rate is null;

-- كل فاتورة صادرة بلا قيد تمر على المحفز فتُرحَّل
update public.invoices
   set status = status
 where status not in ('draft', 'cancelled') and journal_entry_id is null;
