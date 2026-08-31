-- Close /rest/v1/rpc on the new internal functions. Triggers do not need EXECUTE to fire.
do $$
declare fn text;
begin
  foreach fn in array array[
    'public.tg_audit_row()',
    'public.tg_audit_immutable()',
    'public.tg_guard_posted()',
    'public.tg_guard_posted_lines()',
    'public.tg_validate_line()',
    'public.tg_entry_fiscal_year()',
    'public.fn_generate_fiscal_year(integer)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated;', fn);
  end loop;
end $$;

-- The read helpers and the two sanctioned entry points only ever need the caller's own
-- privileges, so they become SECURITY INVOKER and stop being a privilege-escalation surface.
alter function public.fn_fiscal_year(date)             security invoker;
alter function public.fn_fiscal_year_start(date)       security invoker;
alter function public.fn_period_of(date)               security invoker;
alter function public.fn_post_entry(uuid)              security invoker;
alter function public.fn_reverse_entry(uuid, text, date) security invoker;

revoke all on function public.fn_fiscal_year(date)             from public, anon;
revoke all on function public.fn_fiscal_year_start(date)       from public, anon;
revoke all on function public.fn_period_of(date)               from public, anon;
revoke all on function public.fn_post_entry(uuid)              from public, anon;
revoke all on function public.fn_reverse_entry(uuid, text, date) from public, anon;

grant execute on function public.fn_fiscal_year(date)             to authenticated;
grant execute on function public.fn_fiscal_year_start(date)       to authenticated;
grant execute on function public.fn_period_of(date)               to authenticated;
grant execute on function public.fn_post_entry(uuid)              to authenticated;
grant execute on function public.fn_reverse_entry(uuid, text, date) to authenticated;

-- document_counters is written only by next_document_number (SECURITY DEFINER);
-- RLS is on with no policy, so add no policy - just close the direct grants.
revoke all on table public.document_counters from anon, authenticated;
