-- ============================================================
-- الترقيم التلقائي: رقم القيد، رمز الحساب، رقم الفاتورة
--  * عدّاد لكل نوع مستند ولكل سنة، آمن ضد التزامن (قفل صف)
--  * الرمز/الرقم يُولَّد فقط عند تركه فارغاً، فيبقى الإدخال
--    اليدوي ممكناً عند الحاجة
-- ============================================================

-- ---------- عدّادات المستندات ----------
create table if not exists public.document_counters (
  doc_type text    not null,
  year     integer not null,
  last_no  integer not null default 0,
  primary key (doc_type, year)
);

alter table public.document_counters enable row level security;
-- لا سياسات: الوصول عبر الدوال الداخلية فقط، لا عبر واجهة REST.

create or replace function public.next_document_number(
  p_doc_type text,
  p_prefix   text,
  p_date     date
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_year integer := extract(year from coalesce(p_date, current_date))::int;
  v_no   integer;
begin
  insert into public.document_counters (doc_type, year, last_no)
  values (p_doc_type, v_year, 1)
  on conflict (doc_type, year)
    do update set last_no = public.document_counters.last_no + 1
  returning last_no into v_no;

  return p_prefix || '-' || v_year::text || '-' || lpad(v_no::text, 4, '0');
end;
$$;

-- ---------- رقم القيد تلقائياً ----------
create or replace function public.tg_journal_entry_number()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if nullif(btrim(coalesce(new.entry_number, '')), '') is null then
    new.entry_number := public.next_document_number('journal_entry', 'JV', new.entry_date);
  end if;
  return new;
end;
$$;

drop trigger if exists journal_entry_number on public.journal_entries;
create trigger journal_entry_number
before insert on public.journal_entries
for each row execute function public.tg_journal_entry_number();

-- ---------- رقم الفاتورة تلقائياً ----------
create or replace function public.tg_invoice_number()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if nullif(btrim(coalesce(new.invoice_number, '')), '') is null then
    new.invoice_number := public.next_document_number('invoice', 'INV', new.issue_date);
  end if;
  return new;
end;
$$;

drop trigger if exists invoice_number on public.invoices;
create trigger invoice_number
before insert on public.invoices
for each row execute function public.tg_invoice_number();

-- ---------- رقم المشتريات تلقائياً ----------
create or replace function public.tg_purchase_number()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if nullif(btrim(coalesce(new.purchase_number, '')), '') is null then
    new.purchase_number := public.next_document_number('purchase', 'PO', new.purchase_date);
  end if;
  return new;
end;
$$;

drop trigger if exists purchase_number on public.purchases;
create trigger purchase_number
before insert on public.purchases
for each row execute function public.tg_purchase_number();

-- ---------- رمز الحساب تلقائياً ----------
-- يتبع تدرّج دليل الحسابات: الأبناء يرثون بادئة الأب وينزلون
-- مرتبة واحدة (1000 ← 1100 ← 1110 ← 1111).
create or replace function public.next_account_code(p_type text, p_parent_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prefix      text;
  v_parent_code text;
  v_zeros       integer;
  v_step        integer;
  v_base        integer;
  v_candidate   text;
  i             integer;
begin
  v_prefix := case p_type
                when 'asset'     then '1'
                when 'liability' then '2'
                when 'equity'    then '3'
                when 'revenue'   then '4'
                when 'expense'   then '5'
                else '9'
              end;

  if p_parent_id is not null then
    select code into v_parent_code from public.accounts where id = p_parent_id;
  else
    -- بلا أب: انطلق من الحساب الجذر لنفس النوع
    select code into v_parent_code
      from public.accounts
     where type = p_type and parent_id is null and code ~ '^\d000$'
     order by code
     limit 1;
  end if;

  -- لا يوجد جذر لهذا النوع بعد
  if v_parent_code is null then
    if not exists (select 1 from public.accounts where code = v_prefix || '000') then
      return v_prefix || '000';
    end if;
    v_parent_code := v_prefix || '000';
  end if;

  -- رمز الأب غير رقمي: أضف مرتبة جديدة تحته
  if v_parent_code ~ '^\d+$' then
    v_zeros := length(v_parent_code) - length(rtrim(v_parent_code, '0'));
    if v_zeros > 0 then
      v_step := power(10, v_zeros - 1)::int;
      v_base := v_parent_code::int;
      for i in 1..9 loop
        v_candidate := lpad((v_base + i * v_step)::text, length(v_parent_code), '0');
        if not exists (select 1 from public.accounts a where a.code = v_candidate) then
          return v_candidate;
        end if;
      end loop;
    end if;
  end if;

  -- المراتب ممتلئة (أو الرمز غير رقمي): وسّع الرمز بخانة إضافية
  for i in 1..99 loop
    v_candidate := v_parent_code || i::text;
    if not exists (select 1 from public.accounts a where a.code = v_candidate) then
      return v_candidate;
    end if;
  end loop;

  raise exception 'تعذر توليد رمز حساب تلقائي تحت الرمز %', v_parent_code;
end;
$$;

create or replace function public.tg_account_code()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if nullif(btrim(coalesce(new.code, '')), '') is null then
    -- اربط الحساب بجذر نوعه تلقائياً حتى تبقى الشجرة متسقة
    if new.parent_id is null then
      select id into new.parent_id
        from public.accounts
       where type = new.type and parent_id is null and code ~ '^\d000$'
       order by code
       limit 1;
    end if;

    new.code := public.next_account_code(new.type, new.parent_id);
  end if;
  return new;
end;
$$;

drop trigger if exists account_code on public.accounts;
create trigger account_code
before insert on public.accounts
for each row execute function public.tg_account_code();

-- ---------- إغلاق الدوال الجديدة أمام واجهة REST ----------
do $$
declare fn text;
begin
  foreach fn in array array[
    'public.next_document_number(text, text, date)',
    'public.next_account_code(text, uuid)',
    'public.tg_journal_entry_number()',
    'public.tg_invoice_number()',
    'public.tg_purchase_number()',
    'public.tg_account_code()'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated;', fn);
  end loop;
end $$;

-- ---------- مزامنة العدّادات مع أي مستندات قائمة ----------
insert into public.document_counters (doc_type, year, last_no)
select 'journal_entry', extract(year from entry_date)::int,
       max(coalesce(nullif(regexp_replace(entry_number, '^.*-', ''), '')::int, 0))
  from public.journal_entries
 where entry_number ~ '^JV-\d{4}-\d+$'
 group by 2
on conflict (doc_type, year) do nothing;

insert into public.document_counters (doc_type, year, last_no)
select 'invoice', extract(year from issue_date)::int,
       max(coalesce(nullif(regexp_replace(invoice_number, '^.*-', ''), '')::int, 0))
  from public.invoices
 where invoice_number ~ '^INV-\d{4}-\d+$'
 group by 2
on conflict (doc_type, year) do nothing;
