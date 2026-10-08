-- ============================================================
-- ترحيل المقبوضات إلى دفتر اليومية
--
-- مكمّل لـ 20261008210000_invoice_posting: الفاتورة تجعل العميل مدينًا،
-- والمقبوض يسدّد. قبل هذا الترحيل كان المقبوض يُنقص رصيد العميل
-- (customers.balance) دون أي قيد، فيفترق رصيده عن حساب العملاء 1130.
--
-- القاعدة: كل مقبوض من عميل له قيد مرحّل واحد (payments.journal_entry_id):
--   مدين  النقدية بالصندوق (CASH) إن كانت الطريقة نقدية، وإلا النقدية بالبنك (BANK)
--         — أو حساب النقدية المحدد في payments.cash_account_id
--   دائن  العملاء (ACCOUNTS_RECEIVABLE)، والطرف هو العميل
--
-- - حذف المقبوض يعكس قيده، وتعديل حقل مالي يعكسه ويرحّل جديدًا.
-- - المقبوض المربوط بفاتورة (payments.invoice_id) يجعل الفاتورة «مدفوعة»
--   متى غطّت مقبوضاتها إجماليها بالجنيه، ويعيدها «مُرسلة» إن نقصت.
-- - المدفوعات للموردين لا تُرحَّل بعد: المشتريات نفسها غير مرحّلة، فترحيل
--   الدفع وحده يجعل حساب الموردين 2110 مدينًا بلا التزام مقابل.
-- ============================================================

alter table public.payments
  add column if not exists invoice_id       uuid references public.invoices (id) on delete set null,
  add column if not exists cash_account_id  uuid references public.accounts (id) on delete restrict,
  add column if not exists journal_entry_id uuid references public.journal_entries (id) on delete restrict;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'payments_amount_positive_check') then
    alter table public.payments
      add constraint payments_amount_positive_check check (amount > 0) not valid;
  end if;
end $$;

comment on column public.payments.invoice_id is
  'الفاتورة التي يسددها المقبوض (اختياري). تصير الفاتورة مدفوعة متى غطّت مقبوضاتها إجماليها';
comment on column public.payments.cash_account_id is
  'حساب النقدية المستلِم. فارغ = الصندوق للدفع النقدي، والبنك لغيره';
comment on column public.payments.journal_entry_id is
  'قيد اليومية المرحّل الحالي للمقبوض، يكتبه المحفز payment_posting وحده';

create index if not exists payments_invoice_id_idx       on public.payments (invoice_id);
create index if not exists payments_cash_account_id_idx  on public.payments (cash_account_id);
create index if not exists payments_journal_entry_id_idx on public.payments (journal_entry_id);

-- ---------- الترحيل ----------
create or replace function public.fn_receipt_post(pay public.payments)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cash   uuid;
  v_ar     uuid;
  v_inv    text;
  v_entry  uuid;
  v_label  text;
begin
  if pay.cash_account_id is not null then
    v_cash := pay.cash_account_id;
  else
    select account_id into v_cash from public.account_map
     where map_key = case when coalesce(pay.method, 'cash') = 'cash' then 'CASH' else 'BANK' end;
  end if;

  select account_id into v_ar from public.account_map where map_key = 'ACCOUNTS_RECEIVABLE';
  select invoice_number into v_inv from public.invoices where id = pay.invoice_id;

  v_label := 'مقبوض من عميل' || coalesce(' — فاتورة ' || v_inv, '')
             || coalesce(' — مرجع ' || nullif(btrim(pay.reference), ''), '');

  insert into public.journal_entries
        (entry_date, description, reference, status, source, transaction_type, document_type, document_id)
  values (pay.payment_date, v_label, coalesce(v_inv, pay.reference), 'draft', 'system',
          'customer_receipt', 'payment', pay.id)
  returning id into v_entry;

  insert into public.journal_entry_lines (entry_id, account_id, description, debit, credit, cash_flow_category)
  values (v_entry, v_cash, v_label, pay.amount, 0, 'operating');

  insert into public.journal_entry_lines (entry_id, account_id, description, debit, credit, party_type, party_id)
  values (v_entry, v_ar, v_label, 0, pay.amount, 'customer', pay.party_id);

  perform public.fn_post_entry(v_entry);
  return v_entry;
end;
$$;

-- ---------- التحقق والترحيل ----------
create or replace function public.tg_payment_posting()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_want    boolean;
  v_changed boolean;
  v_inv     public.invoices%rowtype;
  v_cash    public.accounts%rowtype;
begin
  if tg_op = 'DELETE' then
    if old.journal_entry_id is not null then
      perform public.fn_reverse_entry(old.journal_entry_id, 'حذف المقبوض');
    end if;
    return old;
  end if;

  -- R03: مبلغ موجب
  if new.amount is null or new.amount <= 0 then
    raise exception 'R03: مبلغ المقبوض يجب أن يكون أكبر من صفر' using errcode = '23514';
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

  -- R02: حساب النقدية المحدد يدويًا يجب أن يكون حساب نقدية قابلًا للترحيل
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

  v_want := new.party_type = 'customer';

  if tg_op = 'UPDATE' and old.journal_entry_id is not null then
    v_changed := (new.amount, new.payment_date, new.party_type, new.party_id,
                  coalesce(new.method, 'cash'), new.cash_account_id, new.invoice_id)
                 is distinct from
                 (old.amount, old.payment_date, old.party_type, old.party_id,
                  coalesce(old.method, 'cash'), old.cash_account_id, old.invoice_id);
    if not v_want or v_changed then
      perform public.fn_reverse_entry(old.journal_entry_id, 'تعديل المقبوض');
      new.journal_entry_id := null;
    end if;
  end if;

  if v_want and new.journal_entry_id is null then
    new.journal_entry_id := public.fn_receipt_post(new);
  end if;

  return new;
end;
$$;

create or replace trigger payment_posting
before insert or update or delete on public.payments
for each row execute function public.tg_payment_posting();

-- ---------- حالة الفاتورة من مقبوضاتها ----------
create or replace function public.fn_invoice_settle(p_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv  public.invoices%rowtype;
  v_due  numeric(14,2);
  v_paid numeric(14,2);
begin
  if p_invoice_id is null then
    return;
  end if;

  select * into v_inv from public.invoices where id = p_invoice_id;
  if not found or v_inv.status not in ('sent', 'overdue', 'paid') then
    return;
  end if;

  v_due := case when coalesce(v_inv.currency, 'EGP') = 'EGP' then v_inv.total
                else round(v_inv.total * v_inv.exchange_rate, 2) end;
  if v_due is null then
    return;   -- عملة أخرى بلا سعر: لا يُعرف المستحق بالجنيه
  end if;

  select coalesce(sum(amount), 0) into v_paid from public.payments where invoice_id = p_invoice_id;

  if v_paid >= v_due and v_inv.status <> 'paid' then
    update public.invoices set status = 'paid' where id = p_invoice_id;
  elsif v_paid < v_due and v_inv.status = 'paid' then
    update public.invoices
       set status = case when v_inv.due_date < current_date then 'overdue' else 'sent' end
     where id = p_invoice_id;
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
  end if;
  if tg_op = 'INSERT' or (tg_op = 'UPDATE' and new.invoice_id is distinct from old.invoice_id) then
    perform public.fn_invoice_settle(new.invoice_id);
  end if;
  return null;
end;
$$;

create or replace trigger payment_settle
after insert or update or delete on public.payments
for each row execute function public.tg_payment_settle();

-- ---------- إغلاق الدوال الداخلية أمام REST ----------
revoke all on function public.fn_receipt_post(public.payments) from public, anon, authenticated;
revoke all on function public.tg_payment_posting()             from public, anon, authenticated;
revoke all on function public.fn_invoice_settle(uuid)          from public, anon, authenticated;
revoke all on function public.tg_payment_settle()              from public, anon, authenticated;

-- ---------- المقبوضات القائمة (إن وُجدت) ----------
update public.payments set amount = amount
 where party_type = 'customer' and journal_entry_id is null;
