-- ============================================================
-- نظام المحاسبة — المخطط الأساسي لقاعدة البيانات
-- Accounting system — core schema, RLS and balance triggers.
-- ============================================================

create extension if not exists "pgcrypto";

-- ---------- helper: updated_at ----------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------- accounts (دليل الحسابات) ----------
create table if not exists public.accounts (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  name        text not null,
  type        text not null check (type in ('asset','liability','equity','revenue','expense')),
  subtype     text,
  parent_id   uuid references public.accounts (id) on delete set null,
  balance     numeric(14,2) not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists accounts_parent_id_idx on public.accounts (parent_id);
create index if not exists accounts_type_idx on public.accounts (type);

-- ---------- customers / suppliers ----------
create table if not exists public.customers (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  phone       text,
  email       text,
  tax_number  text,
  address     text,
  balance     numeric(14,2) not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.suppliers (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  phone       text,
  email       text,
  tax_number  text,
  address     text,
  balance     numeric(14,2) not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---------- journal (القيود اليومية) ----------
create table if not exists public.journal_entries (
  id            uuid primary key default gen_random_uuid(),
  entry_number  text not null unique,
  entry_date    date not null default current_date,
  description   text,
  reference     text,
  notes         text,
  status        text not null default 'draft' check (status in ('draft','posted','void')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists journal_entries_entry_date_idx on public.journal_entries (entry_date desc);

create table if not exists public.journal_entry_lines (
  id          uuid primary key default gen_random_uuid(),
  entry_id    uuid not null references public.journal_entries (id) on delete cascade,
  account_id  uuid references public.accounts (id) on delete restrict,
  description text,
  debit       numeric(14,2) not null default 0 check (debit >= 0),
  credit      numeric(14,2) not null default 0 check (credit >= 0),
  created_at  timestamptz not null default now()
);
create index if not exists jel_entry_id_idx on public.journal_entry_lines (entry_id);
create index if not exists jel_account_id_idx on public.journal_entry_lines (account_id);

-- ---------- invoices (فواتير المبيعات) ----------
create table if not exists public.invoices (
  id              uuid primary key default gen_random_uuid(),
  invoice_number  text not null unique,
  customer_id     uuid references public.customers (id) on delete restrict,
  issue_date      date not null default current_date,
  due_date        date,
  subtotal        numeric(14,2) not null default 0,
  tax_amount      numeric(14,2) not null default 0,
  total           numeric(14,2) not null default 0,
  status          text not null default 'draft' check (status in ('draft','sent','paid','overdue','cancelled')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists invoices_customer_id_idx on public.invoices (customer_id);
create index if not exists invoices_issue_date_idx on public.invoices (issue_date desc);

create table if not exists public.invoice_items (
  id          uuid primary key default gen_random_uuid(),
  invoice_id  uuid not null references public.invoices (id) on delete cascade,
  description text,
  quantity    numeric(14,2) not null default 1,
  unit_price  numeric(14,2) not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists invoice_items_invoice_id_idx on public.invoice_items (invoice_id);

-- ---------- purchases (فواتير المشتريات) ----------
create table if not exists public.purchases (
  id              uuid primary key default gen_random_uuid(),
  purchase_number text not null unique,
  supplier_id     uuid references public.suppliers (id) on delete restrict,
  purchase_date   date not null default current_date,
  subtotal        numeric(14,2) not null default 0,
  tax_amount      numeric(14,2) not null default 0,
  total           numeric(14,2) not null default 0,
  status          text not null default 'draft' check (status in ('draft','received','paid','cancelled')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists purchases_supplier_id_idx on public.purchases (supplier_id);

-- ---------- payments (المدفوعات/المقبوضات) ----------
create table if not exists public.payments (
  id            uuid primary key default gen_random_uuid(),
  payment_date  date not null default current_date,
  amount        numeric(14,2) not null default 0,
  method        text,
  reference     text,
  party_type    text not null check (party_type in ('customer','supplier')),
  party_id      uuid not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists payments_party_idx on public.payments (party_type, party_id);

-- ---------- expenses (المصروفات) ----------
create table if not exists public.expenses (
  id              uuid primary key default gen_random_uuid(),
  expense_date    date not null default current_date,
  category_id     uuid references public.accounts (id) on delete set null,
  amount          numeric(14,2) not null default 0,
  payment_method  text,
  description     text,
  receipt_url     text,
  status          text not null default 'approved' check (status in ('pending','approved','rejected')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists expenses_expense_date_idx on public.expenses (expense_date desc);
create index if not exists expenses_category_id_idx on public.expenses (category_id);

-- ---------- fixed_assets (الأصول الثابتة) ----------
create table if not exists public.fixed_assets (
  id                        uuid primary key default gen_random_uuid(),
  code                      text not null unique,
  name                      text not null,
  purchase_date             date not null default current_date,
  purchase_cost             numeric(14,2) not null default 0,
  useful_life_years         integer,
  depreciation_method       text not null default 'straight_line',
  accumulated_depreciation  numeric(14,2) not null default 0,
  status                    text not null default 'active' check (status in ('active','disposed','sold')),
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

-- ---------- company_settings (بيانات المنشأة) ----------
create table if not exists public.company_settings (
  id            uuid primary key default gen_random_uuid(),
  company_name  text not null,
  country       text,
  currency      text,
  tax_number    text,
  phone         text,
  email         text,
  logo_url      text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ---------- updated_at triggers ----------
do $$
declare t text;
begin
  foreach t in array array[
    'accounts','customers','suppliers','journal_entries','invoices',
    'purchases','payments','expenses','fixed_assets','company_settings'
  ] loop
    execute format(
      'drop trigger if exists set_updated_at on public.%I;
       create trigger set_updated_at before update on public.%I
       for each row execute function public.set_updated_at();', t, t);
  end loop;
end $$;
