-- ============================================================
-- منع استدعاء دوال الحساب الداخلية عبر واجهة REST
-- Trigger execution does not require EXECUTE, so revoking the
-- grant keeps the triggers working while closing /rest/v1/rpc.
-- ============================================================

do $$
declare fn text;
begin
  foreach fn in array array[
    'public.recalc_account_balance(uuid)',
    'public.recalc_customer_balance(uuid)',
    'public.recalc_supplier_balance(uuid)',
    'public.tg_jel_recalc_balance()',
    'public.tg_entry_status_recalc()',
    'public.tg_invoice_recalc()',
    'public.tg_purchase_recalc()',
    'public.tg_payment_recalc()',
    'public.set_updated_at()'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated;', fn);
  end loop;
end $$;
