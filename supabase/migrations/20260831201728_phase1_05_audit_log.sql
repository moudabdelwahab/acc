-- Phase 1 / Step 5: append-only audit trail.
create table if not exists public.audit_log (
  id          bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  actor_id    uuid,
  table_name  text not null,
  row_id      uuid,
  operation   text not null check (operation in ('INSERT','UPDATE','DELETE')),
  old_data    jsonb,
  new_data    jsonb,
  reason      text
);

create index if not exists audit_log_row_idx  on public.audit_log (table_name, row_id, occurred_at desc);
create index if not exists audit_log_time_idx on public.audit_log (occurred_at desc);

-- layer 1: the only writer is this SECURITY DEFINER trigger
create or replace function public.tg_audit_row()
returns trigger language plpgsql security definer set search_path to '' as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_row uuid;
begin
  if tg_op <> 'INSERT' then v_old := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then v_new := to_jsonb(new); end if;

  begin
    v_row := coalesce((v_new ->> 'id'), (v_old ->> 'id'))::uuid;
  exception when others then
    v_row := null;
  end;

  insert into public.audit_log (actor_id, table_name, row_id, operation, old_data, new_data, reason)
  values (auth.uid(), tg_table_name, v_row, tg_op, v_old, v_new,
          nullif(btrim(coalesce(current_setting('app.audit_reason', true), '')), ''));

  return null;
end;
$$;

-- layer 3: the log itself cannot be changed, even by a privileged role
create or replace function public.tg_audit_immutable()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  raise exception 'سجل التدقيق غير قابل للتعديل أو الحذف (audit_log is append-only)'
    using errcode = '42501';
end;
$$;

drop trigger if exists audit_immutable on public.audit_log;
create trigger audit_immutable before update or delete on public.audit_log
  for each row execute function public.tg_audit_immutable();

-- attach the recorder to the tables in scope for phase 1
do $$
declare t text;
begin
  foreach t in array array['journal_entries','journal_entry_lines','accounts','fiscal_periods','company_settings'] loop
    execute format('drop trigger if exists audit_row on public.%I', t);
    execute format(
      'create trigger audit_row after insert or update or delete on public.%I
         for each row execute function public.tg_audit_row()', t);
  end loop;
end $$;

-- layer 2: no write path from the application
revoke insert, update, delete, truncate on public.audit_log from anon, authenticated;

-- layer 4: RLS on, with a read policy only
alter table public.audit_log enable row level security;

do $$
begin
  if not exists (select 1 from pg_policy where polrelid='public.audit_log'::regclass and polname='authenticated_select') then
    create policy authenticated_select on public.audit_log for select to authenticated using (true);
  end if;
end $$;

comment on table public.audit_log is
  'أثر تدقيق append-only. الكتابة حصراً من tg_audit_row، والتعديل والحذف مرفوضان بمحفّز. حدّ الصدق: مالك القاعدة أو service_role يستطيع تعطيل المحفّز.';
