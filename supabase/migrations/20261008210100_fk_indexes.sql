-- فهارس للمفاتيح الأجنبية التي نبّه إليها Supabase Advisor (unindexed_foreign_keys).
-- بدونها يفحص Postgres الجدول كاملاً عند حذف أو تعديل الصف المرجعي.
create index if not exists account_map_account_id_idx           on public.account_map (account_id);
create index if not exists integration_outbox_invoice_id_idx    on public.integration_outbox (invoice_id);
create index if not exists invoices_plan_id_idx                 on public.invoices (plan_id);
create index if not exists journal_entries_reversal_of_idx      on public.journal_entries (reversal_of);
create index if not exists journal_entries_reversed_by_idx      on public.journal_entries (reversed_by);
create index if not exists service_plans_revenue_account_id_idx on public.service_plans (revenue_account_id);
