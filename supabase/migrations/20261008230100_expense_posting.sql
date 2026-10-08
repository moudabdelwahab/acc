-- ============================================================
-- ترحيل المصروفات إلى دفتر اليومية
--
-- المصروف المعتمد (status = approved) يُدفع فورًا، وله قيد مرحّل واحد:
--   مدين  حساب المصروف (expenses.category_id)
--   دائن  الصندوق (نقدي) أو البنك (غيره) — أو expenses.cash_account_id
--
-- - الرفض أو الرجوع لقيد الانتظار أو الحذف يعكس القيد، والتعديل يعكسه
--   ويرحّل جديدًا.
-- - حساب المصروف يجب أن يكون حساب مصروف قابلًا للترحيل ونشطًا (E02):
--   الحساب الرئيسي 5000 مثلًا لا يُرحَّل إليه (V03).
-- ============================================================

alter table public.expenses
  add column if not exists cash_account_id  uuid references public.accounts (id) on delete restrict,
  add column if not exists journal_entry_id uuid references public.journal_entries (id) on delete restrict;

comment on column public.expenses.cash_account_id is
  'حساب النقدية الدافع. فارغ = الصندوق للدفع النقدي، والبنك لغيره';
comment on column public.expenses.journal_entry_id is
  'قيد اليومية المرحّل الحالي للمصروف، يكتبه المحفز expense_posting وحده';

create index if not exists expenses_cash_account_id_idx  on public.expenses (cash_account_id);
create index if not exists expenses_journal_entry_id_idx on public.expenses (journal_entry_id);

-- ---------- الترحيل ----------
create or replace function public.fn_expense_post(ex public.expenses)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cash   uuid;
  v_entry  uuid;
  v_label  text;
begin
  if ex.cash_account_id is not null then
    v_cash := ex.cash_account_id;
  else
    select account_id into v_cash from public.account_map
     where map_key = case when coalesce(ex.payment_method, 'cash') = 'cash' then 'CASH' else 'BANK' end;
  end if;

  v_label := 'مصروف' || coalesce(' — ' || nullif(btrim(ex.description), ''), '');

  insert into public.journal_entries
        (entry_date, description, reference, status, source, transaction_type, document_type, document_id)
  values (ex.expense_date, v_label, null, 'draft', 'system', 'expense', 'expense', ex.id)
  returning id into v_entry;

  insert into public.journal_entry_lines (entry_id, account_id, description, debit, credit)
  values (v_entry, ex.category_id, v_label, ex.amount, 0);

  insert into public.journal_entry_lines (entry_id, account_id, description, debit, credit, cash_flow_category)
  values (v_entry, v_cash, v_label, 0, ex.amount, 'operating');

  perform public.fn_post_entry(v_entry);
  return v_entry;
end;
$$;

-- ---------- التحقق والترحيل ----------
create or replace function public.tg_expense_posting()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_want    boolean;
  v_changed boolean;
  v_acc     public.accounts%rowtype;
  v_cash    public.accounts%rowtype;
begin
  perform set_config('app.document_posting', 'on', true);

  if tg_op = 'DELETE' then
    if old.journal_entry_id is not null then
      perform public.fn_document_reverse(old.journal_entry_id, 'حذف المصروف');
    end if;
    perform set_config('app.document_posting', '', true);
    return old;
  end if;

  -- E01: مبلغ موجب
  if new.amount is null or new.amount <= 0 then
    raise exception 'E01: مبلغ المصروف يجب أن يكون أكبر من صفر' using errcode = '23514';
  end if;

  -- القيد يُكتب هنا وحده
  if tg_op = 'UPDATE' then
    new.journal_entry_id := old.journal_entry_id;
  else
    new.journal_entry_id := null;
  end if;

  v_want := new.status = 'approved';

  if v_want then
    -- E02: حساب مصروف قابل للترحيل ونشط
    select * into v_acc from public.accounts where id = new.category_id;
    if not found then
      raise exception 'E02: اختر حساب المصروف' using errcode = '23514';
    end if;
    if v_acc.type <> 'expense' or not v_acc.is_postable or not v_acc.is_active then
      raise exception 'E02: الحساب % - % لا يصلح حسابًا للمصروف — اختر حساب مصروف فرعيًا نشطًا', v_acc.code, v_acc.name
        using errcode = '23514';
    end if;

    -- E03: حساب النقدية المحدد يدويًا يجب أن يكون حساب نقدية
    if new.cash_account_id is not null then
      select * into v_cash from public.accounts where id = new.cash_account_id;
      if not coalesce(v_cash.is_cash_account, false) then
        raise exception 'E03: الحساب % ليس حساب نقدية', coalesce(v_cash.code, '?') using errcode = '23514';
      end if;
    end if;
  end if;

  if tg_op = 'UPDATE' and old.journal_entry_id is not null then
    v_changed := (new.amount, new.expense_date, new.category_id,
                  coalesce(new.payment_method, 'cash'), new.cash_account_id, new.description)
                 is distinct from
                 (old.amount, old.expense_date, old.category_id,
                  coalesce(old.payment_method, 'cash'), old.cash_account_id, old.description);
    if not v_want or v_changed then
      perform public.fn_document_reverse(old.journal_entry_id,
        case when new.status = 'rejected' then 'رفض المصروف'
             when new.status = 'pending'  then 'إرجاع المصروف إلى قيد الانتظار'
             else 'تعديل المصروف' end);
      new.journal_entry_id := null;
    end if;
  end if;

  if v_want and new.journal_entry_id is null then
    new.journal_entry_id := public.fn_expense_post(new);
  end if;

  perform set_config('app.document_posting', '', true);
  return new;
end;
$$;

create or replace trigger expense_posting
before insert or update or delete on public.expenses
for each row execute function public.tg_expense_posting();

revoke all on function public.fn_expense_post(public.expenses) from public, anon, authenticated;
revoke all on function public.tg_expense_posting()             from public, anon, authenticated;

-- ---------- المصروفات المعتمدة القائمة ----------
update public.expenses set amount = amount
 where status = 'approved' and journal_entry_id is null;
