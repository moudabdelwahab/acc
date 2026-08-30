-- ============================================================
-- احتساب الأرصدة تلقائياً
--  * accounts.balance   من بنود القيود المرحّلة (posted)
--  * customers.balance  = فواتير غير ملغاة - مقبوضات
--  * suppliers.balance  = مشتريات غير ملغاة - مدفوعات
-- ============================================================

-- ---------- رصيد الحساب ----------
create or replace function public.recalc_account_balance(p_account_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_type   text;
  v_debit  numeric(14,2);
  v_credit numeric(14,2);
begin
  if p_account_id is null then
    return;
  end if;

  select a.type into v_type from public.accounts a where a.id = p_account_id;
  if v_type is null then
    return;
  end if;

  select coalesce(sum(l.debit), 0), coalesce(sum(l.credit), 0)
    into v_debit, v_credit
    from public.journal_entry_lines l
    join public.journal_entries e on e.id = l.entry_id
   where l.account_id = p_account_id
     and e.status = 'posted';

  update public.accounts
     set balance = case
                     when v_type in ('asset', 'expense') then v_debit - v_credit
                     else v_credit - v_debit
                   end
   where id = p_account_id;
end;
$$;

create or replace function public.tg_jel_recalc_balance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform public.recalc_account_balance(old.account_id);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    perform public.recalc_account_balance(new.account_id);
  end if;
  return null;
end;
$$;

drop trigger if exists jel_recalc_balance on public.journal_entry_lines;
create trigger jel_recalc_balance
after insert or update or delete on public.journal_entry_lines
for each row execute function public.tg_jel_recalc_balance();

-- ترحيل/إلغاء ترحيل القيد يعيد حساب كل حساباته
create or replace function public.tg_entry_status_recalc()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare r record;
begin
  if old.status is distinct from new.status then
    for r in
      select distinct l.account_id
        from public.journal_entry_lines l
       where l.entry_id = new.id and l.account_id is not null
    loop
      perform public.recalc_account_balance(r.account_id);
    end loop;
  end if;
  return null;
end;
$$;

drop trigger if exists entry_status_recalc on public.journal_entries;
create trigger entry_status_recalc
after update on public.journal_entries
for each row execute function public.tg_entry_status_recalc();

-- ---------- رصيد العميل ----------
create or replace function public.recalc_customer_balance(p_customer_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invoiced numeric(14,2);
  v_paid     numeric(14,2);
begin
  if p_customer_id is null then
    return;
  end if;

  select coalesce(sum(i.total), 0) into v_invoiced
    from public.invoices i
   where i.customer_id = p_customer_id
     and i.status <> 'cancelled';

  select coalesce(sum(p.amount), 0) into v_paid
    from public.payments p
   where p.party_type = 'customer' and p.party_id = p_customer_id;

  update public.customers set balance = v_invoiced - v_paid where id = p_customer_id;
end;
$$;

-- ---------- رصيد المورد ----------
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
     and pu.status <> 'cancelled';

  select coalesce(sum(p.amount), 0) into v_paid
    from public.payments p
   where p.party_type = 'supplier' and p.party_id = p_supplier_id;

  update public.suppliers set balance = v_purchased - v_paid where id = p_supplier_id;
end;
$$;

create or replace function public.tg_invoice_recalc()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform public.recalc_customer_balance(old.customer_id);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    perform public.recalc_customer_balance(new.customer_id);
  end if;
  return null;
end;
$$;

drop trigger if exists invoice_recalc_balance on public.invoices;
create trigger invoice_recalc_balance
after insert or update or delete on public.invoices
for each row execute function public.tg_invoice_recalc();

create or replace function public.tg_purchase_recalc()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform public.recalc_supplier_balance(old.supplier_id);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    perform public.recalc_supplier_balance(new.supplier_id);
  end if;
  return null;
end;
$$;

drop trigger if exists purchase_recalc_balance on public.purchases;
create trigger purchase_recalc_balance
after insert or update or delete on public.purchases
for each row execute function public.tg_purchase_recalc();

create or replace function public.tg_payment_recalc()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    if old.party_type = 'customer' then
      perform public.recalc_customer_balance(old.party_id);
    else
      perform public.recalc_supplier_balance(old.party_id);
    end if;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    if new.party_type = 'customer' then
      perform public.recalc_customer_balance(new.party_id);
    else
      perform public.recalc_supplier_balance(new.party_id);
    end if;
  end if;
  return null;
end;
$$;

drop trigger if exists payment_recalc_balance on public.payments;
create trigger payment_recalc_balance
after insert or update or delete on public.payments
for each row execute function public.tg_payment_recalc();
