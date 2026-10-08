-- رصيد العميل بالجنيه، مثل دفتر الأستاذ.
--
-- recalc_customer_balance كانت تجمع إجمالي الفواتير بعملاتها كما هي، فعميل
-- عليه فواتير بالدولار يظهر رصيده بالدولار مخلوطًا بالجنيه، ولا يطابق مجموع
-- الأرصدة حساب العملاء (1130) الذي يُرحَّل بالجنيه. الآن تُحوَّل كل فاتورة
-- بسعرها (invoices.exchange_rate)، والفاتورة بعملة أخرى بلا سعر لا تدخل الرصيد،
-- كما لا تدخل الدفاتر. والمسودة ليست مديونية بعد، فلا تدخل الرصيد هي أيضًا.
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

  select coalesce(sum(case when coalesce(i.currency, 'EGP') = 'EGP' then i.total
                           else round(i.total * i.exchange_rate, 2) end), 0)
    into v_invoiced
    from public.invoices i
   where i.customer_id = p_customer_id
     and i.status not in ('draft', 'cancelled')
     and (coalesce(i.currency, 'EGP') = 'EGP' or i.exchange_rate is not null);

  select coalesce(sum(p.amount), 0) into v_paid
    from public.payments p
   where p.party_type = 'customer' and p.party_id = p_customer_id;

  update public.customers set balance = v_invoiced - v_paid where id = p_customer_id;
end;
$$;

revoke all on function public.recalc_customer_balance(uuid) from public, anon, authenticated;

select public.recalc_customer_balance(id) from public.customers;
