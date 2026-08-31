-- Phase 1 / Step 4: entry and line columns, backfilled BEFORE the immutability guard exists.
alter table public.journal_entries
  add column if not exists source           text,
  add column if not exists transaction_type text,
  add column if not exists document_type    text,
  add column if not exists document_id      uuid,
  add column if not exists fiscal_year      text,
  add column if not exists reversal_of      uuid,
  add column if not exists reversed_by      uuid,
  add column if not exists posted_at        timestamptz,
  add column if not exists posted_by        uuid,
  add column if not exists void_reason      text;

update public.journal_entries set source      = 'manual'                     where source      is null;
update public.journal_entries set fiscal_year = public.fn_fiscal_year(entry_date) where fiscal_year is null;

alter table public.journal_entries alter column source set not null;
alter table public.journal_entries alter column source set default 'manual';
alter table public.journal_entries alter column fiscal_year set not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid='public.journal_entries'::regclass and conname='journal_entries_source_check') then
    alter table public.journal_entries add constraint journal_entries_source_check
      check (source in ('manual','system','opening'));
  end if;
  -- V23: a void entry must carry a reason
  if not exists (select 1 from pg_constraint where conrelid='public.journal_entries'::regclass and conname='journal_entries_void_reason_check') then
    alter table public.journal_entries add constraint journal_entries_void_reason_check
      check (status <> 'void' or nullif(btrim(coalesce(void_reason,'')), '') is not null);
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.journal_entries'::regclass and conname='journal_entries_reversal_of_fkey') then
    alter table public.journal_entries add constraint journal_entries_reversal_of_fkey
      foreign key (reversal_of) references public.journal_entries(id) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.journal_entries'::regclass and conname='journal_entries_reversed_by_fkey') then
    alter table public.journal_entries add constraint journal_entries_reversed_by_fkey
      foreign key (reversed_by) references public.journal_entries(id) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.journal_entries'::regclass and conname='journal_entries_no_self_reversal_check') then
    alter table public.journal_entries add constraint journal_entries_no_self_reversal_check
      check (reversal_of is distinct from id and reversed_by is distinct from id);
  end if;
end $$;

-- V18: at most one opening-balance entry in the whole ledger
create unique index if not exists journal_entries_single_opening_uidx
  on public.journal_entries (source) where source = 'opening';

create index if not exists journal_entries_fiscal_year_idx on public.journal_entries (fiscal_year);
create index if not exists journal_entries_document_idx    on public.journal_entries (document_type, document_id);

-- ---------------------------------------------------------------- lines
alter table public.journal_entry_lines
  add column if not exists party_type         text,
  add column if not exists party_id           uuid,
  add column if not exists currency           text,
  add column if not exists cash_flow_category text;

update public.journal_entry_lines set currency = 'EGP' where currency is null;
alter table public.journal_entry_lines alter column currency set not null;
alter table public.journal_entry_lines alter column currency set default 'EGP';

do $$
begin
  -- V15: single currency
  if not exists (select 1 from pg_constraint where conrelid='public.journal_entry_lines'::regclass and conname='journal_entry_lines_currency_check') then
    alter table public.journal_entry_lines add constraint journal_entry_lines_currency_check
      check (currency = 'EGP');
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.journal_entry_lines'::regclass and conname='journal_entry_lines_party_type_check') then
    alter table public.journal_entry_lines add constraint journal_entry_lines_party_type_check
      check (party_type is null or party_type in ('customer','supplier'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.journal_entry_lines'::regclass and conname='journal_entry_lines_party_pair_check') then
    alter table public.journal_entry_lines add constraint journal_entry_lines_party_pair_check
      check ((party_type is null) = (party_id is null));
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.journal_entry_lines'::regclass and conname='journal_entry_lines_cash_flow_check') then
    alter table public.journal_entry_lines add constraint journal_entry_lines_cash_flow_check
      check (cash_flow_category is null or cash_flow_category in ('operating','investing','financing'));
  end if;
end $$;

create index if not exists jel_party_idx on public.journal_entry_lines (party_type, party_id);

comment on column public.journal_entry_lines.cash_flow_category is
  'تصنيف الحركة النقدية لحظة الترحيل — أساس قائمة التدفقات بالطريقة المباشرة، لا فروق أرصدة';
