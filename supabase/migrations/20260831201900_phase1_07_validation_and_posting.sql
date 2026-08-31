-- Phase 1 / Step 7: line-level validation (V02-V07, V15) and the only posting path (V01, V05).
create or replace function public.tg_validate_line()
returns trigger language plpgsql security definer set search_path to '' as $$
declare
  a public.accounts%rowtype;
  v_source text;
begin
  -- V02: an account and exactly one positive side
  if new.account_id is null then
    raise exception 'V02: كل بند يجب أن يخصّ حساباً' using errcode = '23514';
  end if;
  if new.debit < 0 or new.credit < 0 then
    raise exception 'V02: لا يجوز مبلغ سالب في بند القيد' using errcode = '23514';
  end if;
  if (new.debit > 0) = (new.credit > 0) then
    raise exception 'V02: البند يكون مديناً أو دائناً بمبلغ موجب، لا الاثنين ولا الصفر' using errcode = '23514';
  end if;

  select * into a from public.accounts where id = new.account_id;
  if not found then
    raise exception 'V02: الحساب غير موجود' using errcode = '23503';
  end if;

  -- V03: no posting to a parent account
  if not a.is_postable then
    raise exception 'V03: الحساب % - % حساب أب ولا يُرحَّل إليه', a.code, a.name using errcode = '23514';
  end if;

  -- V04: no posting to an inactive account
  if not a.is_active then
    raise exception 'V04: الحساب % - % معطَّل', a.code, a.name using errcode = '23514';
  end if;

  -- V06: control accounts require a party
  if a.requires_party and (new.party_type is null or new.party_id is null) then
    raise exception 'V06: الحساب % - % حساب مراقبة ويلزم تحديد الطرف', a.code, a.name using errcode = '23514';
  end if;

  -- V07: no manual entry straight onto a control account
  select e.source into v_source from public.journal_entries e where e.id = new.entry_id;
  if a.is_control and v_source = 'manual' then
    raise exception 'V07: الحساب % - % حساب مراقبة، ويُحرَّك من المستندات لا بقيد يدوي', a.code, a.name
      using errcode = '23514';
  end if;

  -- V15 is also a CHECK constraint; repeated here for a clear Arabic message
  if new.currency <> 'EGP' then
    raise exception 'V15: النظام أحادي العملة — الجنيه المصري فقط' using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists tg_validate_line on public.journal_entry_lines;
create trigger tg_validate_line before insert or update on public.journal_entry_lines
  for each row execute function public.tg_validate_line();

-- ------------------------------------------------------------------ posting
create or replace function public.fn_post_entry(p_entry_id uuid)
returns public.journal_entries language plpgsql security definer set search_path to '' as $$
declare
  e        public.journal_entries%rowtype;
  v_debit  numeric(14,2);
  v_credit numeric(14,2);
  v_lines  integer;
  v_period public.fiscal_periods%rowtype;
  v_golive date;
begin
  select * into e from public.journal_entries where id = p_entry_id for update;
  if not found then
    raise exception 'القيد غير موجود' using errcode = 'P0002';
  end if;
  if e.status = 'posted' then
    raise exception 'القيد % مرحّل بالفعل', e.entry_number using errcode = '42501';
  end if;
  if e.status <> 'draft' then
    raise exception 'لا يُرحَّل إلا قيد بحالة draft — حالة % هي %', e.entry_number, e.status using errcode = '42501';
  end if;

  select count(*), coalesce(sum(debit), 0), coalesce(sum(credit), 0)
    into v_lines, v_debit, v_credit
    from public.journal_entry_lines where entry_id = p_entry_id;

  if v_lines < 2 then
    raise exception 'V01: القيد يحتاج بندين على الأقل' using errcode = '23514';
  end if;
  if v_debit <> v_credit then
    raise exception 'V01: القيد غير متوازن — مدين % مقابل دائن %', v_debit, v_credit using errcode = '23514';
  end if;
  if v_debit = 0 then
    raise exception 'V01: مجموع القيد صفر' using errcode = '23514';
  end if;

  -- V05: date inside an open period, and never before go-live
  select coalesce(min(go_live_date), date '2026-07-01') into v_golive from public.company_settings;
  if e.entry_date < v_golive then
    raise exception 'V05: تاريخ القيد % سابق لبداية التشغيل %', e.entry_date, v_golive using errcode = '23514';
  end if;

  select * into v_period from public.fn_period_of(e.entry_date);
  if v_period.id is null then
    raise exception 'V05: لا توجد فترة مالية تشمل التاريخ %', e.entry_date using errcode = '23514';
  end if;
  if v_period.status <> 'open' then
    raise exception 'V05: الفترة % # % حالتها % — لا ترحيل فيها',
      v_period.fiscal_year, v_period.period_no, v_period.status using errcode = '23514';
  end if;

  perform set_config('app.posting', 'on', true);

  update public.journal_entries
     set status      = 'posted',
         posted_at   = now(),
         posted_by   = auth.uid(),
         fiscal_year = public.fn_fiscal_year(entry_date)
   where id = p_entry_id
  returning * into e;

  perform set_config('app.posting', '', true);
  return e;
end;
$$;

-- ---------------------------------------------------------------- reversing
create or replace function public.fn_reverse_entry(p_entry_id uuid, p_reason text, p_date date default null)
returns public.journal_entries language plpgsql security definer set search_path to '' as $$
declare
  e     public.journal_entries%rowtype;
  r     public.journal_entries%rowtype;
  v_dt  date := coalesce(p_date, current_date);
begin
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'سبب العكس إلزامي' using errcode = '23514';
  end if;

  select * into e from public.journal_entries where id = p_entry_id for update;
  if not found then
    raise exception 'القيد غير موجود' using errcode = 'P0002';
  end if;
  if e.status <> 'posted' then
    raise exception 'لا يُعكس إلا قيد مرحّل' using errcode = '42501';
  end if;
  if e.reversed_by is not null then
    raise exception 'القيد % معكوس بالفعل', e.entry_number using errcode = '42501';
  end if;

  perform set_config('app.audit_reason', p_reason, true);

  -- the reversing entry is created as a normal draft, so every validation applies
  insert into public.journal_entries (entry_date, description, reference, notes, status,
                                      source, transaction_type, document_type, document_id, reversal_of)
  values (v_dt,
          'عكس القيد ' || e.entry_number || ' — ' || p_reason,
          e.reference, e.notes, 'draft',
          e.source, e.transaction_type, e.document_type, e.document_id, e.id)
  returning * into r;

  insert into public.journal_entry_lines
        (entry_id, account_id, description, debit, credit, party_type, party_id, currency, cash_flow_category)
  select r.id, l.account_id, l.description, l.credit, l.debit, l.party_type, l.party_id, l.currency,
         l.cash_flow_category
    from public.journal_entry_lines l
   where l.entry_id = e.id;

  r := public.fn_post_entry(r.id);

  -- the only permitted write to a posted entry: the link to its reversal
  perform set_config('app.posting', 'on', true);
  update public.journal_entries set reversed_by = r.id where id = e.id;
  perform set_config('app.posting', '', true);
  perform set_config('app.audit_reason', '', true);

  return r;
end;
$$;

revoke all on function public.fn_post_entry(uuid)              from anon;
revoke all on function public.fn_reverse_entry(uuid, text, date) from anon;
grant execute on function public.fn_post_entry(uuid)              to authenticated;
grant execute on function public.fn_reverse_entry(uuid, text, date) to authenticated;

comment on function public.fn_post_entry(uuid) is
  'المسار الوحيد للترحيل: يتحقق من V01 و V05 ثم يحوّل الحالة إلى posted';
comment on function public.fn_reverse_entry(uuid, text, date) is
  'ينشئ قيداً عكسياً مستقلاً ويربطه بالأصل — الأصل يبقى posted ولا يُعدَّل أثره';
