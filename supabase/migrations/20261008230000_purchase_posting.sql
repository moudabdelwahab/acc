-- ============================================================
-- ترحيل المشتريات ومدفوعات الموردين إلى دفتر اليومية
--
-- مكمّل لترحيل الفواتير والمقبوضات، بنفس الأسلوب:
--
-- فاتورة المشتريات (status = received أو paid) لها قيد مرحّل واحد:
--   مدين  الحساب المختار في purchases.account_id (مصروف، أو أصل كالمخزون
--         أو الأصول الثابتة) بالإجمالي ناقص الضريبة
--   مدين  ضريبة المدخلات (VAT_INPUT) بالضريبة
--   دائن  الموردين (ACCOUNTS_PAYABLE) بالإجمالي، والطرف هو المورد
--
-- الدفع لمورد (payments.party_type = supplier) له قيد مرحّل واحد:
--   مدين  الموردين، والطرف هو المورد
--   دائن  الصندوق (نقدي) أو البنك (غيره) — أو payments.cash_account_id
--
-- - الإلغاء أو الرجوع لمسودة أو الحذف يعكس القيد، والتعديل يعكسه ويرحّل جديدًا.
-- - الدفع المربوط بفاتورة مشتريات (payments.purchase_id) يجعلها «مدفوعة»
--   متى غطّت مدفوعاتها إجماليها، ويعيدها «مستلمة» إن نقصت.
-- - لا تُلغى ولا تُحذف ولا تعود لمسودة فاتورة مشتريات عليها مدفوعات.
-- - المشتريات بالجنيه فقط، مثل الدفاتر (V15).
-- ============================================================

-- القيود المنشأة من المستندات تُعلَّم بهذا الإعداد داخل المعاملة؛
-- ترحيل 20261008230200_accounting_safeguards يمنع ما سواها من إنشاء
-- قيد system أو عكسه.

alter table public.purchases
  add column if not exists description      text,
  add column if not exists due_date         date,
  add column if not exists account_id       uuid references public.accounts (id) on delete restrict,
  add column if not exists journal_entry_id uuid references public.journal_entries (id) on delete restrict;

comment on column public.purchases.account_id is
  'الحساب المدين: مصروف، أو أصل (مخزون / أصل ثابت). إلزامي قبل الاستلام';
comment on column public.purchases.journal_entry_id is
  'قيد اليومية المرحّل الحالي لفاتورة المشتريات، يكتبه المحفز purchase_posting وحده';

create index if not exists purchases_account_id_idx       on public.purchases (account_id);
create index if not exists purchases_journal_entry_id_idx on public.purchases (journal_entry_id);

alter table public.payments
  add column if not exists purchase_id uuid references public.purchases (id) on delete restrict;

comment on column public.payments.purchase_id is
  'فاتورة المشتريات التي يسددها الدفع (اختياري). تصير مدفوعة متى غطّت مدفوعاتها إجماليها';

create index if not exists payments_purchase_id_idx on public.payments (purchase_id);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'payments_single_document_check') then
    alter table public.payments
      add constraint payments_single_document_check check (invoice_id is null or purchase_id is null);
  end if;
end $$;

-- ---------- عكس قيد مستند في فترته ----------
-- تصحيح المستند (تعديله أو حذفه أو إلغاؤه) يُعكس بتاريخ القيد الأصلي ما دامت
-- فترته مفتوحة، فتبقى أرقام كل شهر كأن المستند صدر صحيحًا من البداية. بغيرها
-- كان تعديل فاتورة أغسطس في أكتوبر يُظهر إيراد أغسطس مضاعفًا وأكتوبر بالسالب.
-- وإن كانت الفترة مغلقة فالعكس بتاريخ اليوم.
create or replace function public.fn_document_reverse(p_entry_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_date   date;
  v_golive date;
  v_open   boolean;
begin
  select entry_date into v_date from public.journal_entries where id = p_entry_id;
  select coalesce(min(go_live_date), date '2026-07-01') into v_golive from public.company_settings;
  select exists (select 1 from public.fiscal_periods p
                  where v_date between p.period_start and p.period_end and p.status = 'open')
    into v_open;

  perform public.fn_reverse_entry(p_entry_id, p_reason,
                                  case when v_open and v_date >= v_golive then v_date end);
end;
$$;

revoke all on function public.fn_document_reverse(uuid, text) from public, anon, authenticated;

-- ---------- ترحيل فاتورة المشتريات ----------
create or replace function public.fn_purchase_post(pur public.purchases)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ap     uuid;
  v_vat    uuid;
  v_entry  uuid;
  v_label  text;
begin
  select account_id into v_ap  from public.account_map where map_key = 'ACCOUNTS_PAYABLE';
  select account_id into v_vat from public.account_map where map_key = 'VAT_INPUT';

  v_label := 'مشتريات ' || pur.purchase_number || coalesce(' — ' || nullif(btrim(pur.description), ''), '');

  insert into public.journal_entries
        (entry_date, description, reference, status, source, transaction_type, document_type, document_id)
  values (pur.purchase_date, v_label, pur.purchase_number, 'draft', 'system',
          'purchase_invoice', 'purchase', pur.id)
  returning id into v_entry;

  if pur.total - pur.tax_amount > 0 then
    insert into public.journal_entry_lines (entry_id, account_id, description, debit, credit)
    values (v_entry, pur.account_id, v_label, pur.total - pur.tax_amount, 0);
  end if;

  if pur.tax_amount > 0 then
    insert into public.journal_entry_lines (entry_id, account_id, description, debit, credit)
    values (v_entry, v_vat, 'ضريبة القيمة المضافة - مدخلات', pur.tax_amount, 0);
  end if;

  insert into public.journal_entry_lines (entry_id, account_id, description, debit, credit, party_type, party_id)
  values (v_entry, v_ap, v_label, 0, pur.total, 'supplier', pur.supplier_id);

  perform public.fn_post_entry(v_entry);
  return v_entry;
end;
$$;

-- ---------- التحقق والترحيل ----------
create or replace function public.tg_purchase_posting()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_want    boolean;
  v_changed boolean;
  v_acc     public.accounts%rowtype;
begin
  perform set_config('app.document_posting', 'on', true);

  if tg_op = 'DELETE' then
    -- P03: المدفوعات تُفك أو تُحذف أولًا
    if exists (select 1 from public.payments where purchase_id = old.id) then
      raise exception 'P03: فاتورة المشتريات % عليها مدفوعات — احذف المدفوعات أولًا', old.purchase_number
        using errcode = '23514';
    end if;
    if old.journal_entry_id is not null then
      perform public.fn_document_reverse(old.journal_entry_id, 'حذف فاتورة المشتريات ' || old.purchase_number);
    end if;
    perform set_config('app.document_posting', '', true);
    return old;
  end if;

  -- P01: الإجمالي = قبل الضريبة + الضريبة، ولا مبالغ سالبة
  if new.subtotal < 0 or new.tax_amount < 0 or new.total <> new.subtotal + new.tax_amount then
    raise exception 'P01: إجمالي المشتريات يجب أن يساوي المبلغ قبل الضريبة + الضريبة' using errcode = '23514';
  end if;

  -- القيد يُكتب هنا وحده
  if tg_op = 'UPDATE' then
    new.journal_entry_id := old.journal_entry_id;
  else
    new.journal_entry_id := null;
  end if;

  v_want := new.status in ('received', 'paid') and new.supplier_id is not null and new.total > 0;

  -- P03: فاتورة عليها مدفوعات لا تعود لمسودة ولا تُلغى
  if tg_op = 'UPDATE' and new.status in ('draft', 'cancelled') and old.status not in ('draft', 'cancelled')
     and exists (select 1 from public.payments where purchase_id = new.id) then
    raise exception 'P03: فاتورة المشتريات % عليها مدفوعات — احذف المدفوعات قبل إلغائها', new.purchase_number
      using errcode = '23514';
  end if;

  -- P02: الحساب المدين صالح: مصروف أو أصل، قابل للترحيل ونشط، وليس حساب مراقبة ولا نقدية
  if v_want then
    select * into v_acc from public.accounts where id = new.account_id;
    if not found then
      raise exception 'P02: اختر الحساب المدين للمشتريات (مصروف أو أصل)' using errcode = '23514';
    end if;
    if v_acc.type not in ('expense', 'asset') or v_acc.is_control or v_acc.is_cash_account
       or v_acc.is_contra or not v_acc.is_postable or not v_acc.is_active then
      raise exception 'P02: الحساب % - % لا يصلح حسابًا مدينًا للمشتريات', v_acc.code, v_acc.name
        using errcode = '23514';
    end if;
  end if;

  if tg_op = 'UPDATE' and old.journal_entry_id is not null then
    v_changed := (new.total, new.tax_amount, new.supplier_id, new.purchase_date,
                  new.account_id, new.purchase_number)
                 is distinct from
                 (old.total, old.tax_amount, old.supplier_id, old.purchase_date,
                  old.account_id, old.purchase_number);
    if not v_want or v_changed then
      perform public.fn_document_reverse(old.journal_entry_id,
        case
          when new.status = 'cancelled' then 'إلغاء فاتورة المشتريات ' || new.purchase_number
          when new.status = 'draft'     then 'إرجاع فاتورة المشتريات ' || new.purchase_number || ' إلى مسودة'
          else 'تعديل فاتورة المشتريات ' || new.purchase_number
        end);
      new.journal_entry_id := null;
    end if;
  end if;

  if v_want and new.journal_entry_id is null then
    new.journal_entry_id := public.fn_purchase_post(new);
  end if;

  perform set_config('app.document_posting', '', true);
  return new;
end;
$$;

-- الاسم بعد purchase_number أبجديًا: الرقم يُولَّد قبل الترحيل
create or replace trigger purchase_posting
before insert or update or delete on public.purchases
for each row execute function public.tg_purchase_posting();

-- ---------- رصيد المورد = المشتريات المستلمة − المدفوعات، مثل حساب الموردين ----------
-- المسودة ليست التزامًا بعد، فلا تدخل الرصيد.
create or replace function public.recalc_supplier_balance(p_supplier_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_purchased numeric(14,2);
  v_paid      numeric(14,2);
begin
  if p_supplier_id is null then
    return;
  end if;

  select coalesce(sum(pu.total), 0) into v_purchased
    from public.purchases pu
   where pu.supplier_id = p_supplier_id
     and pu.status not in ('draft', 'cancelled');

  select coalesce(sum(p.amount), 0) into v_paid
    from public.payments p
   where p.party_type = 'supplier' and p.party_id = p_supplier_id;

  update public.suppliers set balance = v_purchased - v_paid where id = p_supplier_id;
end;
$$;

-- ---------- الدفع لمورد ----------
create or replace function public.fn_supplier_payment_post(pay public.payments)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cash   uuid;
  v_ap     uuid;
  v_pur    text;
  v_entry  uuid;
  v_label  text;
begin
  if pay.cash_account_id is not null then
    v_cash := pay.cash_account_id;
  else
    select account_id into v_cash from public.account_map
     where map_key = case when coalesce(pay.method, 'cash') = 'cash' then 'CASH' else 'BANK' end;
  end if;

  select account_id into v_ap from public.account_map where map_key = 'ACCOUNTS_PAYABLE';
  select purchase_number into v_pur from public.purchases where id = pay.purchase_id;

  v_label := 'دفع لمورد' || coalesce(' — مشتريات ' || v_pur, '')
             || coalesce(' — مرجع ' || nullif(btrim(pay.reference), ''), '');

  insert into public.journal_entries
        (entry_date, description, reference, status, source, transaction_type, document_type, document_id)
  values (pay.payment_date, v_label, coalesce(v_pur, pay.reference), 'draft', 'system',
          'supplier_payment', 'payment', pay.id)
  returning id into v_entry;

  insert into public.journal_entry_lines (entry_id, account_id, description, debit, credit, party_type, party_id)
  values (v_entry, v_ap, v_label, pay.amount, 0, 'supplier', pay.party_id);

  insert into public.journal_entry_lines (entry_id, account_id, description, debit, credit, cash_flow_category)
  values (v_entry, v_cash, v_label, 0, pay.amount, 'operating');

  perform public.fn_post_entry(v_entry);
  return v_entry;
end;
$$;

-- tg_payment_posting من 20261008220000 مع: مدفوعات الموردين، والربط بفاتورة
-- مشتريات (R04)، وعلامة القيود المنشأة من المستندات.
create or replace function public.tg_payment_posting()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_changed boolean;
  v_inv     public.invoices%rowtype;
  v_pur     public.purchases%rowtype;
  v_cash    public.accounts%rowtype;
begin
  perform set_config('app.document_posting', 'on', true);

  if tg_op = 'DELETE' then
    if old.journal_entry_id is not null then
      perform public.fn_document_reverse(old.journal_entry_id,
        case when old.party_type = 'supplier' then 'حذف الدفع للمورد' else 'حذف المقبوض' end);
    end if;
    perform set_config('app.document_posting', '', true);
    return old;
  end if;

  -- R03: مبلغ موجب
  if new.amount is null or new.amount <= 0 then
    raise exception 'R03: المبلغ يجب أن يكون أكبر من صفر' using errcode = '23514';
  end if;

  -- R01: المقبوض المربوط بفاتورة يخص عميلها، والفاتورة صادرة
  if new.invoice_id is not null then
    select * into v_inv from public.invoices where id = new.invoice_id;
    if new.party_type <> 'customer' or v_inv.customer_id is distinct from new.party_id then
      raise exception 'R01: الفاتورة % لا تخص هذا العميل', v_inv.invoice_number using errcode = '23514';
    end if;
    if v_inv.status in ('draft', 'cancelled') then
      raise exception 'R01: الفاتورة % حالتها % — لا تُسدَّد', v_inv.invoice_number, v_inv.status
        using errcode = '23514';
    end if;
  end if;

  -- R04: الدفع المربوط بفاتورة مشتريات يخص موردها، والفاتورة مستلمة
  if new.purchase_id is not null then
    select * into v_pur from public.purchases where id = new.purchase_id;
    if new.party_type <> 'supplier' or v_pur.supplier_id is distinct from new.party_id then
      raise exception 'R04: فاتورة المشتريات % لا تخص هذا المورد', v_pur.purchase_number using errcode = '23514';
    end if;
    if v_pur.status not in ('received', 'paid') then
      raise exception 'R04: فاتورة المشتريات % حالتها % — لا تُسدَّد', v_pur.purchase_number, v_pur.status
        using errcode = '23514';
    end if;
  end if;

  -- R02: حساب النقدية المحدد يدويًا يجب أن يكون حساب نقدية
  if new.cash_account_id is not null then
    select * into v_cash from public.accounts where id = new.cash_account_id;
    if not coalesce(v_cash.is_cash_account, false) then
      raise exception 'R02: الحساب % ليس حساب نقدية', coalesce(v_cash.code, '?') using errcode = '23514';
    end if;
  end if;

  -- القيد يُكتب هنا وحده
  if tg_op = 'UPDATE' then
    new.journal_entry_id := old.journal_entry_id;
  else
    new.journal_entry_id := null;
  end if;

  if tg_op = 'UPDATE' and old.journal_entry_id is not null then
    v_changed := (new.amount, new.payment_date, new.party_type, new.party_id,
                  coalesce(new.method, 'cash'), new.cash_account_id, new.invoice_id, new.purchase_id)
                 is distinct from
                 (old.amount, old.payment_date, old.party_type, old.party_id,
                  coalesce(old.method, 'cash'), old.cash_account_id, old.invoice_id, old.purchase_id);
    if v_changed then
      perform public.fn_document_reverse(old.journal_entry_id,
        case when old.party_type = 'supplier' then 'تعديل الدفع للمورد' else 'تعديل المقبوض' end);
      new.journal_entry_id := null;
    end if;
  end if;

  if new.journal_entry_id is null then
    new.journal_entry_id := case when new.party_type = 'supplier'
                                 then public.fn_supplier_payment_post(new)
                                 else public.fn_receipt_post(new) end;
  end if;

  perform set_config('app.document_posting', '', true);
  return new;
end;
$$;

-- ---------- حالة فاتورة المشتريات من مدفوعاتها ----------
create or replace function public.fn_purchase_settle(p_purchase_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pur  public.purchases%rowtype;
  v_paid numeric(14,2);
begin
  if p_purchase_id is null then
    return;
  end if;

  select * into v_pur from public.purchases where id = p_purchase_id;
  if not found or v_pur.status not in ('received', 'paid') then
    return;
  end if;

  select coalesce(sum(amount), 0) into v_paid from public.payments where purchase_id = p_purchase_id;

  if v_paid >= v_pur.total and v_pur.status <> 'paid' then
    update public.purchases set status = 'paid' where id = p_purchase_id;
  elsif v_paid < v_pur.total and v_pur.status = 'paid' then
    update public.purchases set status = 'received' where id = p_purchase_id;
  end if;
end;
$$;

create or replace function public.tg_payment_settle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform public.fn_invoice_settle(old.invoice_id);
    perform public.fn_purchase_settle(old.purchase_id);
  end if;
  if tg_op = 'INSERT' or (tg_op = 'UPDATE' and new.invoice_id is distinct from old.invoice_id) then
    perform public.fn_invoice_settle(new.invoice_id);
  end if;
  if tg_op = 'INSERT' or (tg_op = 'UPDATE' and new.purchase_id is distinct from old.purchase_id) then
    perform public.fn_purchase_settle(new.purchase_id);
  end if;
  return null;
end;
$$;

-- تعديل إجمالي فاتورة مشتريات عليها مدفوعات يعيد حساب حالتها
create or replace function public.tg_purchase_settle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.total, new.status) is distinct from (old.total, old.status) then
    perform public.fn_purchase_settle(new.id);
  end if;
  return null;
end;
$$;

create or replace trigger purchase_settle
after update on public.purchases
for each row execute function public.tg_purchase_settle();

-- ---------- إغلاق الدوال الداخلية أمام REST ----------
revoke all on function public.tg_purchase_settle()                       from public, anon, authenticated;
revoke all on function public.fn_purchase_post(public.purchases)         from public, anon, authenticated;
revoke all on function public.tg_purchase_posting()                      from public, anon, authenticated;
revoke all on function public.fn_supplier_payment_post(public.payments)  from public, anon, authenticated;
revoke all on function public.fn_purchase_settle(uuid)                   from public, anon, authenticated;
revoke all on function public.recalc_supplier_balance(uuid)              from public, anon, authenticated;

-- ---------- المستندات القائمة (إن وُجدت) ----------
update public.purchases set status = status
 where status in ('received', 'paid') and journal_entry_id is null;
update public.payments set amount = amount
 where party_type = 'supplier' and journal_entry_id is null;
select public.recalc_supplier_balance(id) from public.suppliers;
