-- Phase 1 / Step 8: document_counters.year is reinterpreted as the fiscal-year START year.
-- The current rows are (invoice, 2026, 8) and (journal_entry, 2026, 1); the current fiscal year
-- also starts in 2026, so both counters simply continue. No issued number is changed.
create or replace function public.next_document_number(p_doc_type text, p_prefix text, p_date date)
returns text language plpgsql security definer set search_path to '' as $function$
declare
  v_date date    := coalesce(p_date, current_date);
  v_year integer := public.fn_fiscal_year_start(v_date);
  v_fy   text    := public.fn_fiscal_year(v_date);
  v_no   integer;
begin
  insert into public.document_counters (doc_type, year, last_no)
  values (p_doc_type, v_year, 1)
  on conflict (doc_type, year)
    do update set last_no = public.document_counters.last_no + 1
  returning last_no into v_no;

  return p_prefix || '-FY' || v_fy || '-' || lpad(v_no::text, 4, '0');
end;
$function$;

comment on column public.document_counters.year is
  'سنة بداية السنة المالية (لا السنة الميلادية) — 2026 تعني 2026/27';
