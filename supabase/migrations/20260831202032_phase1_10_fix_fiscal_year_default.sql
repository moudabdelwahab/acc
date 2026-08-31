-- Fix found by the acceptance suite: fiscal_year is NOT NULL but nothing filled it on INSERT,
-- so every new journal entry failed. It is derived from entry_date, never supplied by the caller.
create or replace function public.tg_entry_fiscal_year()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  new.fiscal_year := public.fn_fiscal_year(new.entry_date);
  return new;
end;
$$;

drop trigger if exists tg_entry_fiscal_year on public.journal_entries;
create trigger tg_entry_fiscal_year before insert or update of entry_date on public.journal_entries
  for each row execute function public.tg_entry_fiscal_year();
