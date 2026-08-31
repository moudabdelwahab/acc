-- Phase 1 / Step 3: fiscal year settings, the fiscal calendar, and its lookup functions.
alter table public.company_settings
  add column if not exists fiscal_year_start_month integer not null default 7,
  add column if not exists fiscal_year_start_day   integer not null default 1,
  add column if not exists go_live_date            date    not null default date '2026-07-01';

do $$
begin
  if not exists (select 1 from pg_constraint
                 where conrelid='public.company_settings'::regclass and conname='company_settings_fy_month_check') then
    alter table public.company_settings
      add constraint company_settings_fy_month_check check (fiscal_year_start_month between 1 and 12);
  end if;
  if not exists (select 1 from pg_constraint
                 where conrelid='public.company_settings'::regclass and conname='company_settings_fy_day_check') then
    alter table public.company_settings
      add constraint company_settings_fy_day_check check (fiscal_year_start_day between 1 and 28);
  end if;
end $$;

-- ---------------------------------------------------------------- functions
create or replace function public.fn_fiscal_year_start(p_date date)
returns integer language sql stable security definer set search_path to '' as $$
  with s as (
    select coalesce(min(fiscal_year_start_month), 7) as m,
           coalesce(min(fiscal_year_start_day),   1) as d
      from public.company_settings
  )
  select case
           when make_date(extract(year from p_date)::int, s.m, s.d) <= p_date
             then extract(year from p_date)::int
           else extract(year from p_date)::int - 1
         end
    from s;
$$;

create or replace function public.fn_fiscal_year(p_date date)
returns text language sql stable security definer set search_path to '' as $$
  select public.fn_fiscal_year_start(p_date)::text || '/' ||
         lpad(((public.fn_fiscal_year_start(p_date) + 1) % 100)::text, 2, '0');
$$;

-- ---------------------------------------------------------------- calendar
create table if not exists public.fiscal_periods (
  id           uuid primary key default gen_random_uuid(),
  fiscal_year  text        not null,
  period_no    integer     not null check (period_no between 1 and 12),
  period_start date        not null,
  period_end   date        not null,
  status       text        not null default 'open' check (status in ('open','closed','locked')),
  closed_at    timestamptz,
  closed_by    uuid,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint fiscal_periods_range_check unique (fiscal_year, period_no),
  constraint fiscal_periods_start_key   unique (period_start),
  constraint fiscal_periods_order_check check (period_end >= period_start)
);

create index if not exists fiscal_periods_span_idx on public.fiscal_periods (period_start, period_end);

drop trigger if exists set_updated_at on public.fiscal_periods;
create trigger set_updated_at before update on public.fiscal_periods
  for each row execute function public.set_updated_at();

alter table public.fiscal_periods enable row level security;

do $$
begin
  if not exists (select 1 from pg_policy where polrelid='public.fiscal_periods'::regclass and polname='authenticated_select') then
    create policy authenticated_select on public.fiscal_periods for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policy where polrelid='public.fiscal_periods'::regclass and polname='authenticated_insert') then
    create policy authenticated_insert on public.fiscal_periods for insert to authenticated with check (true);
  end if;
  if not exists (select 1 from pg_policy where polrelid='public.fiscal_periods'::regclass and polname='authenticated_update') then
    create policy authenticated_update on public.fiscal_periods for update to authenticated using (true) with check (true);
  end if;
end $$;

revoke delete on public.fiscal_periods from anon, authenticated;

-- generate the twelve monthly periods of a fiscal year, idempotently
create or replace function public.fn_generate_fiscal_year(p_start_year integer)
returns integer language plpgsql security definer set search_path to '' as $$
declare
  v_m     integer;
  v_d     integer;
  v_first date;
  v_fy    text;
  v_added integer := 0;
  i       integer;
begin
  select coalesce(min(fiscal_year_start_month), 7), coalesce(min(fiscal_year_start_day), 1)
    into v_m, v_d from public.company_settings;

  v_first := make_date(p_start_year, v_m, v_d);
  v_fy    := public.fn_fiscal_year(v_first);

  for i in 1..12 loop
    insert into public.fiscal_periods (fiscal_year, period_no, period_start, period_end, status)
    values (v_fy, i,
            (v_first + make_interval(months => i - 1))::date,
            (v_first + make_interval(months => i) - interval '1 day')::date,
            'open')
    on conflict (fiscal_year, period_no) do nothing;
    v_added := v_added + 1;
  end loop;

  return v_added;
end;
$$;

create or replace function public.fn_period_of(p_date date)
returns public.fiscal_periods language sql stable security definer set search_path to '' as $$
  select p.* from public.fiscal_periods p
   where p_date between p.period_start and p.period_end
   limit 1;
$$;

select public.fn_generate_fiscal_year(2026);
select public.fn_generate_fiscal_year(2027);

comment on table public.fiscal_periods is 'الفترات المالية الشهرية وحالاتها — open / closed / locked';
