-- ============================================================
-- الربط مع منصة مدعوم (مشروع Supabase منفصل)
--
-- المراجع للمنصة نصّية (text) عن قصد: الجداول في مشروع آخر،
-- فلا يمكن إنشاء مفتاح أجنبي حقيقي، والنوع النصّي يحتمل أي
-- نوع مُعرِّف تستعمله المنصة (uuid أو bigint).
-- ============================================================

-- ---------- كتالوج الباقات ----------
create table if not exists public.service_plans (
  id                 uuid primary key default gen_random_uuid(),
  code               text not null,
  billing_cycle      text not null check (billing_cycle in ('monthly', 'yearly', 'none')),
  name               text not null,
  price              numeric(14,2) not null default 0,
  currency           text not null default 'USD',
  revenue_account_id uuid references public.accounts (id) on delete set null,
  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (code, billing_cycle)
);

drop trigger if exists set_updated_at on public.service_plans;
create trigger set_updated_at before update on public.service_plans
for each row execute function public.set_updated_at();

-- ---------- ربط العميل بحساب المنصة ----------
alter table public.customers
  add column if not exists external_source text,
  add column if not exists external_id     text,
  add column if not exists username        text;

create unique index if not exists customers_external_uidx
  on public.customers (external_source, external_id)
  where external_source is not null and external_id is not null;

-- ---------- ربط الفاتورة بالتذكرة والاشتراك ----------
alter table public.invoices
  add column if not exists source                   text not null default 'manual',
  add column if not exists currency                 text,
  add column if not exists plan_id                  uuid references public.service_plans (id) on delete set null,
  add column if not exists external_ticket_id       text,
  add column if not exists external_ticket_number   text,
  add column if not exists external_subscription_id text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'invoices_source_check'
  ) then
    alter table public.invoices
      add constraint invoices_source_check check (source in ('manual', 'mad3oom'));
  end if;
end $$;

create index if not exists invoices_external_ticket_idx
  on public.invoices (external_ticket_id)
  where external_ticket_id is not null;

-- اشتراك واحد ⇐ فاتورة واحدة، فتصير المزامنة قابلة لإعادة التشغيل بأمان
create unique index if not exists invoices_external_subscription_uidx
  on public.invoices (external_subscription_id)
  where external_subscription_id is not null;

-- ---------- صندوق صادر للأحداث ----------
-- عند إصدار فاتورة مرتبطة بتذكرة يُسجَّل حدث هنا، ثم تسحبه
-- منصة مدعوم لتكتب الفاتورة داخل التذكرة. الطابور يجعل التسليم
-- قابلاً لإعادة المحاولة ولا يفقد حدثاً إذا كانت المنصة متوقفة.
create table if not exists public.integration_outbox (
  id          uuid primary key default gen_random_uuid(),
  event_type  text not null,
  invoice_id  uuid references public.invoices (id) on delete cascade,
  payload     jsonb not null,
  status      text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  attempts    integer not null default 0,
  last_error  text,
  created_at  timestamptz not null default now(),
  sent_at     timestamptz
);

create index if not exists integration_outbox_pending_idx
  on public.integration_outbox (created_at)
  where status = 'pending';

-- ---------- المحفّز: فاتورة صدرت ⇐ حدث في الطابور ----------
create or replace function public.tg_invoice_outbox()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_issued boolean;
begin
  -- «الإصدار» = خروج الفاتورة من حالة المسودة
  if tg_op = 'INSERT' then
    v_issued := new.status <> 'draft';
  else
    v_issued := old.status = 'draft' and new.status <> 'draft';
  end if;

  if not v_issued or new.external_ticket_id is null then
    return null;
  end if;

  insert into public.integration_outbox (event_type, invoice_id, payload)
  values (
    'invoice.issued',
    new.id,
    jsonb_build_object(
      'invoice_id',       new.id,
      'invoice_number',   new.invoice_number,
      'issue_date',       new.issue_date,
      'due_date',         new.due_date,
      'subtotal',         new.subtotal,
      'tax_amount',       new.tax_amount,
      'total',            new.total,
      'currency',         coalesce(new.currency, 'USD'),
      'status',           new.status,
      'ticket_id',        new.external_ticket_id,
      'ticket_number',    new.external_ticket_number,
      'subscription_id',  new.external_subscription_id,
      'customer_external_id', (
        select c.external_id from public.customers c where c.id = new.customer_id
      )
    )
  );

  return null;
end;
$$;

drop trigger if exists invoice_outbox on public.invoices;
create trigger invoice_outbox
after insert or update of status on public.invoices
for each row execute function public.tg_invoice_outbox();

-- ---------- RLS ----------
do $$
declare t text;
begin
  foreach t in array array['service_plans', 'integration_outbox'] loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists "authenticated_select" on public.%I;', t);
    execute format('create policy "authenticated_select" on public.%I for select to authenticated using (true);', t);
    execute format('drop policy if exists "authenticated_insert" on public.%I;', t);
    execute format('create policy "authenticated_insert" on public.%I for insert to authenticated with check (true);', t);
    execute format('drop policy if exists "authenticated_update" on public.%I;', t);
    execute format('create policy "authenticated_update" on public.%I for update to authenticated using (true) with check (true);', t);
    execute format('drop policy if exists "authenticated_delete" on public.%I;', t);
    execute format('create policy "authenticated_delete" on public.%I for delete to authenticated using (true);', t);
  end loop;
end $$;

revoke all on function public.tg_invoice_outbox() from public, anon, authenticated;

-- ---------- بيانات الباقات كما هي معلنة في المنصة ----------
insert into public.service_plans (code, billing_cycle, name, price, currency) values
  ('free',     'none',    'الخطة المجانية',              0,   'USD'),
  ('support',  'monthly', 'الدعم الفني — شهري',          15,  'USD'),
  ('support',  'yearly',  'الدعم الفني — سنوي',          150, 'USD'),
  ('whatsapp', 'monthly', 'واتساب — شهري',               20,  'USD'),
  ('whatsapp', 'yearly',  'واتساب — سنوي',               200, 'USD'),
  ('bundle',   'monthly', 'دعم فني + واتساب — شهري',      30,  'USD'),
  ('bundle',   'yearly',  'دعم فني + واتساب — سنوي',      330, 'USD')
on conflict (code, billing_cycle) do nothing;

-- ربط الباقات بحساب إيرادات الخدمات
update public.service_plans
   set revenue_account_id = (select id from public.accounts where code = '4200')
 where revenue_account_id is null;
