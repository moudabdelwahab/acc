-- ============================================================
-- تفعيل Row Level Security على كل الجداول
-- Every table is readable/writable only by authenticated users.
-- ============================================================

do $$
declare t text;
begin
  foreach t in array array[
    'accounts','customers','suppliers','journal_entries','journal_entry_lines',
    'invoices','invoice_items','purchases','payments','expenses',
    'fixed_assets','company_settings'
  ] loop
    execute format('alter table public.%I enable row level security;', t);

    execute format('drop policy if exists "authenticated_select" on public.%I;', t);
    execute format(
      'create policy "authenticated_select" on public.%I
         for select to authenticated using (true);', t);

    execute format('drop policy if exists "authenticated_insert" on public.%I;', t);
    execute format(
      'create policy "authenticated_insert" on public.%I
         for insert to authenticated with check (true);', t);

    execute format('drop policy if exists "authenticated_update" on public.%I;', t);
    execute format(
      'create policy "authenticated_update" on public.%I
         for update to authenticated using (true) with check (true);', t);

    execute format('drop policy if exists "authenticated_delete" on public.%I;', t);
    execute format(
      'create policy "authenticated_delete" on public.%I
         for delete to authenticated using (true);', t);
  end loop;
end $$;
