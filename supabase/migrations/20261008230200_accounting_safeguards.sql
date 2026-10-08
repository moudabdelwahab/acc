-- ============================================================
-- ضمانات محاسبية من مراجعة النظام (2026-10-08)
--
-- كل قاعدة هنا تسدّ طريقًا كان يُدخل خطأً في الدفاتر أو يعطّل العمل:
--
--  J01/J02  قيود المستندات (فاتورة، مقبوض، مشتريات، دفع، مصروف) لا تُنشأ ولا
--           تُعكس إلا من المستند نفسه. عكسها يدويًا كان يترك الفاتورة «صادرة»
--           بلا قيد، وإنشاء قيد system يدويًا كان يتخطى V07 على حسابات المراقبة.
--  I01      إجمالي الفاتورة = قبل الضريبة + الضريبة.
--  I02      فاتورة عليها مقبوضات لا تُلغى ولا تعود لمسودة ولا تُحذف.
--  —        تعديل فاتورة مدفوعة يعيد حساب حالتها من مقبوضاتها.
--  A01..A07 قواعد دليل الحسابات: طبيعة الحساب تُشتق من نوعه (كان إنشاء حساب
--           من الواجهة يفشل دائمًا لأن normal_balance إلزامي بلا قيمة)، والحساب
--           الأب يصير غير قابل للترحيل تلقائيًا، ولا يُغيَّر نوع حساب عليه حركات.
--  M01      ربط الحسابات (account_map) يشير إلى حساب صالح لدوره.
--  C01      العميل أو المورد الذي له مدفوعات أو قيود لا يُحذف.
--  —        دوال تقارير تجمع في قاعدة البيانات، بدل جلب البنود إلى المتصفح
--           حيث يقطع Supabase النتيجة عند 1000 صف بصمت.
-- ============================================================

-- ---------- J02: قيود المستندات تُنشأ من المستند فقط ----------
create or replace function public.tg_guard_document_entry()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_doc boolean := coalesce(current_setting('app.document_posting', true), '') = 'on';
begin
  if v_doc then
    return new;
  end if;

  if tg_op = 'INSERT' and (new.source = 'system' or new.document_type is not null) then
    raise exception 'J02: قيود الفواتير والمقبوضات والمشتريات والمصروفات تُنشأ من المستند نفسه، لا يدويًا'
      using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' and (new.source, new.document_type, new.document_id)
                          is distinct from (old.source, old.document_type, old.document_id) then
    raise exception 'J02: لا يُغيَّر مصدر القيد ولا مستنده' using errcode = '42501';
  end if;

  return new;
end;
$$;

create or replace trigger tg_guard_document_entry
before insert or update on public.journal_entries
for each row execute function public.tg_guard_document_entry();

-- ---------- J01: قيد المستند لا يُعكس يدويًا ----------
-- fn_reverse_entry من 20260831201900 (SECURITY INVOKER منذ 20260831202146) مع فحص J01.
create or replace function public.fn_reverse_entry(p_entry_id uuid, p_reason text, p_date date default null)
returns public.journal_entries
language plpgsql
security invoker
set search_path to ''
as $$
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
  if e.source = 'system' and coalesce(current_setting('app.document_posting', true), '') <> 'on' then
    raise exception 'J01: القيد % ناتج عن مستند — يُصحَّح بتعديل المستند أو إلغائه أو حذفه، لا بعكس القيد', e.entry_number
      using errcode = '42501';
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

-- ---------- الفواتير: I01 و I02 وعلامة قيود المستندات ----------
-- tg_invoice_posting من 20261008210000 مع الإضافات.
create or replace function public.tg_invoice_posting()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_want    boolean;
  v_changed boolean;
begin
  perform set_config('app.document_posting', 'on', true);

  if tg_op = 'DELETE' then
    -- I02: المقبوضات تُحذف أولًا، وإلا صارت دفعات بلا فاتورة دون علم المستخدم
    if exists (select 1 from public.payments where invoice_id = old.id) then
      raise exception 'I02: الفاتورة % عليها مقبوضات — احذف المقبوضات أولًا', old.invoice_number
        using errcode = '23514';
    end if;
    if old.journal_entry_id is not null then
      perform public.fn_document_reverse(old.journal_entry_id, 'حذف الفاتورة ' || old.invoice_number);
    end if;
    perform set_config('app.document_posting', '', true);
    return old;
  end if;

  -- I01: الإجمالي = قبل الضريبة + الضريبة، ولا مبالغ سالبة
  if new.subtotal < 0 or new.tax_amount < 0 or new.total <> new.subtotal + new.tax_amount then
    raise exception 'I01: إجمالي الفاتورة يجب أن يساوي المبلغ قبل الضريبة + الضريبة' using errcode = '23514';
  end if;

  -- I02: فاتورة عليها مقبوضات لا تُلغى ولا تعود لمسودة
  if tg_op = 'UPDATE' and new.status in ('draft', 'cancelled') and old.status not in ('draft', 'cancelled')
     and exists (select 1 from public.payments where invoice_id = new.id) then
    raise exception 'I02: الفاتورة % عليها مقبوضات — احذف المقبوضات قبل إلغائها', new.invoice_number
      using errcode = '23514';
  end if;

  -- القيد يُكتب هنا وحده
  if tg_op = 'UPDATE' then
    new.journal_entry_id := old.journal_entry_id;
  else
    new.journal_entry_id := null;
  end if;

  v_want := new.status not in ('draft', 'cancelled')
            and new.customer_id is not null
            and (coalesce(new.currency, 'EGP') = 'EGP' or new.exchange_rate is not null);

  if tg_op = 'UPDATE' and old.journal_entry_id is not null then
    v_changed := (new.total, new.tax_amount, new.customer_id, new.issue_date,
                  coalesce(new.currency, 'EGP'), new.exchange_rate, new.plan_id, new.invoice_number)
                 is distinct from
                 (old.total, old.tax_amount, old.customer_id, old.issue_date,
                  coalesce(old.currency, 'EGP'), old.exchange_rate, old.plan_id, old.invoice_number);

    if not v_want or v_changed then
      perform public.fn_document_reverse(old.journal_entry_id,
        case
          when new.status = 'cancelled' then 'إلغاء الفاتورة ' || new.invoice_number
          when new.status = 'draft'     then 'إرجاع الفاتورة ' || new.invoice_number || ' إلى مسودة'
          else 'تعديل الفاتورة ' || new.invoice_number
        end);
      new.journal_entry_id := null;
    end if;
  end if;

  if v_want and new.journal_entry_id is null then
    new.journal_entry_id := public.fn_invoice_post(new);
  end if;

  perform set_config('app.document_posting', '', true);
  return new;
end;
$$;

-- تعديل فاتورة عليها مقبوضات (أو حفظها من الواجهة بحالة «مُرسلة») يعيد حساب حالتها
create or replace function public.tg_invoice_settle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.total, new.status, new.currency, new.exchange_rate)
     is distinct from (old.total, old.status, old.currency, old.exchange_rate) then
    perform public.fn_invoice_settle(new.id);
  end if;
  return null;
end;
$$;

create or replace trigger invoice_settle
after update on public.invoices
for each row execute function public.tg_invoice_settle();

-- ---------- A01..A07: قواعد دليل الحسابات ----------
create or replace function public.tg_account_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_parent public.accounts%rowtype;
  v_has_lines boolean;
  v_cursor uuid;
  i integer := 0;
begin
  if tg_op = 'DELETE' then
    -- A07: حذف حساب له حسابات فرعية يفصلها عن شجرتها
    if exists (select 1 from public.accounts where parent_id = old.id) then
      raise exception 'A07: الحساب % له حسابات فرعية — احذفها أو انقلها أولًا', old.code using errcode = '23514';
    end if;
    return old;
  end if;

  -- A00: الطبيعة تُشتق من النوع، ومقلوبة للحساب العكسي
  if tg_op = 'INSERT' and new.normal_balance is null then
    new.normal_balance := case
      when new.type in ('asset', 'expense') then (case when new.is_contra then 'credit' else 'debit' end)
      else (case when new.is_contra then 'debit' else 'credit' end)
    end;
  end if;

  if new.parent_id is not null and (tg_op = 'INSERT' or new.parent_id is distinct from old.parent_id) then
    select * into v_parent from public.accounts where id = new.parent_id;

    -- A01: الحساب الفرعي من نوع أبيه
    if v_parent.type is distinct from new.type then
      raise exception 'A01: الحساب الفرعي يجب أن يكون من نوع الحساب الأب (%)', v_parent.code using errcode = '23514';
    end if;

    -- A02: الحساب الأب لا يُرحَّل إليه، فلا يصير أبًا حساب عليه حركات
    if exists (select 1 from public.journal_entry_lines where account_id = new.parent_id) then
      raise exception 'A02: الحساب % عليه حركات مسجّلة — لا يمكن أن يصير حسابًا أب. أضف الحساب تحت حساب آخر',
        v_parent.code using errcode = '23514';
    end if;

    -- A05: لا حلقات في الشجرة
    if tg_op = 'UPDATE' then
      v_cursor := new.parent_id;
      while v_cursor is not null and i < 20 loop
        if v_cursor = new.id then
          raise exception 'A05: لا يكون الحساب أبًا لنفسه أو لأحد آبائه' using errcode = '23514';
        end if;
        select parent_id into v_cursor from public.accounts where id = v_cursor;
        i := i + 1;
      end loop;
    end if;
  end if;

  if tg_op = 'UPDATE' then
    v_has_lines := exists (select 1 from public.journal_entry_lines where account_id = new.id);

    -- A03: نوع الحساب وطبيعته يحددان موضعه وإشارته في كل التقارير
    if v_has_lines and (new.type, new.normal_balance, new.is_contra)
                       is distinct from (old.type, old.normal_balance, old.is_contra) then
      raise exception 'A03: الحساب % عليه حركات — لا يُغيَّر نوعه ولا طبيعته', old.code using errcode = '23514';
    end if;

    -- A04: الحسابات التي تستعملها المستندات تلقائيًا لا تُعطَّل
    if old.is_active and not new.is_active
       and exists (select 1 from public.account_map where account_id = new.id) then
      raise exception 'A04: الحساب % مستخدم في الترحيل التلقائي (ربط الحسابات) — لا يُعطَّل', old.code
        using errcode = '23514';
    end if;

    -- A06: حساب له حسابات فرعية يبقى غير قابل للترحيل
    if new.is_postable and exists (select 1 from public.accounts where parent_id = new.id) then
      new.is_postable := false;
    end if;
  end if;

  return new;
end;
$$;

-- الاسم بعد account_code أبجديًا: الأب الافتراضي يُحدَّد قبل الفحص
create or replace trigger account_rules
before insert or update or delete on public.accounts
for each row execute function public.tg_account_rules();

-- الحساب الأب غير قابل للترحيل، والحساب الذي لم يعد له فروع يعود قابلًا للترحيل
create or replace function public.tg_account_tree()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.accounts a
     set is_postable = not exists (select 1 from public.accounts c where c.parent_id = a.id)
   where a.id in (
           case when tg_op in ('INSERT', 'UPDATE') then new.parent_id end,
           case when tg_op in ('UPDATE', 'DELETE') then old.parent_id end)
     and a.is_postable is distinct from not exists (select 1 from public.accounts c where c.parent_id = a.id);
  return null;
end;
$$;

create or replace trigger account_tree
after insert or update of parent_id or delete on public.accounts
for each row execute function public.tg_account_tree();

-- ---------- M01: ربط الحسابات يشير إلى حساب صالح لدوره ----------
create or replace function public.tg_account_map_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.accounts%rowtype;
  v_ok boolean;
begin
  select * into a from public.accounts where id = new.account_id;
  if not found or not a.is_postable or not a.is_active then
    raise exception 'M01: % يجب أن يشير إلى حساب نشط قابل للترحيل', new.map_key using errcode = '23514';
  end if;

  v_ok := case new.map_key
    when 'CASH'                then a.is_cash_account
    when 'BANK'                then a.is_cash_account
    when 'ACCOUNTS_RECEIVABLE' then a.is_control and a.subledger = 'customers'
    when 'ACCOUNTS_PAYABLE'    then a.is_control and a.subledger = 'suppliers'
    when 'VAT_INPUT'           then a.type = 'asset'
    when 'VAT_OUTPUT'          then a.type = 'liability'
    when 'CAPITAL'             then a.type = 'equity'
    when 'SERVICE_REVENUE'     then a.type = 'revenue'
    when 'SALES_REVENUE'       then a.type = 'revenue'
    when 'SUBSCRIPTION_REVENUE' then a.type = 'revenue'
    else true
  end;
  if not v_ok then
    raise exception 'M01: الحساب % لا يصلح لدور %', a.code, new.map_key using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace trigger account_map_rules
before insert or update on public.account_map
for each row execute function public.tg_account_map_rules();

-- ---------- C01: العميل أو المورد الذي له حركات لا يُحذف ----------
-- payments.party_id وبنود القيود لا ترتبط بمفتاح أجنبي بالعميل/المورد (الطرف
-- أحد جدولين)، فحذف الطرف كان يترك مدفوعات وأرصدة مراقبة بلا صاحب.
create or replace function public.tg_party_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_type text := case tg_table_name when 'customers' then 'customer' else 'supplier' end;
begin
  if exists (select 1 from public.payments where party_type = v_type and party_id = old.id)
     or exists (select 1 from public.journal_entry_lines where party_type = v_type and party_id = old.id) then
    raise exception 'C01: % عليه مدفوعات أو قيود مسجّلة — لا يُحذف، عطّله بدلًا من ذلك',
      case v_type when 'customer' then 'العميل' else 'المورد' end
      using errcode = '23514';
  end if;
  return old;
end;
$$;

create or replace trigger party_guard
before delete on public.customers
for each row execute function public.tg_party_guard();

create or replace trigger party_guard
before delete on public.suppliers
for each row execute function public.tg_party_guard();

revoke all on function public.tg_party_guard() from public, anon, authenticated;

-- ---------- دوال التقارير ----------
-- حركة كل حساب من القيود المرحّلة ضمن فترة (حدود فارغة = بلا حد).
-- صف لكل حساب، فلا يقترب من حد الـ 1000 صف.
create or replace function public.fn_account_movements(p_from date default null, p_to date default null)
returns table (account_id uuid, debit numeric, credit numeric)
language sql
stable
security invoker
set search_path = ''
as $$
  select l.account_id, sum(l.debit), sum(l.credit)
    from public.journal_entry_lines l
    join public.journal_entries e on e.id = l.entry_id
   where e.status = 'posted'
     and (p_from is null or e.entry_date >= p_from)
     and (p_to   is null or e.entry_date <= p_to)
   group by l.account_id;
$$;

-- الإيرادات والمصروفات لكل شهر، للوحة التحكم
create or replace function public.fn_monthly_activity()
returns table (month text, revenue numeric, expense numeric)
language sql
stable
security invoker
set search_path = ''
as $$
  select to_char(e.entry_date, 'YYYY-MM'),
         coalesce(sum(case when a.type = 'revenue' then l.credit - l.debit end), 0),
         coalesce(sum(case when a.type = 'expense' then l.debit - l.credit end), 0)
    from public.journal_entry_lines l
    join public.journal_entries e on e.id = l.entry_id
    join public.accounts a on a.id = l.account_id
   where e.status = 'posted' and a.type in ('revenue', 'expense')
   group by 1
   order by 1;
$$;

-- ---------- الصلاحيات ----------
revoke all on function public.tg_guard_document_entry() from public, anon, authenticated;
revoke all on function public.tg_invoice_posting()      from public, anon, authenticated;
revoke all on function public.tg_invoice_settle()       from public, anon, authenticated;
revoke all on function public.tg_account_rules()        from public, anon, authenticated;
revoke all on function public.tg_account_tree()         from public, anon, authenticated;
revoke all on function public.tg_account_map_rules()    from public, anon, authenticated;

revoke all on function public.fn_account_movements(date, date) from public, anon;
revoke all on function public.fn_monthly_activity()            from public, anon;
grant execute on function public.fn_account_movements(date, date) to authenticated;
grant execute on function public.fn_monthly_activity()            to authenticated;
