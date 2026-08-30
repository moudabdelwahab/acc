-- ============================================================
-- تحسين توليد رمز الحساب:
-- عندما تمتلئ المراتب التسع تحت الأب (مثلاً 5100..5900 تحت 5000)
-- ننزل إلى مرتبة أدق (5010, 5020, ...) بدل توسيع الرمز بخانة
-- إضافية. التوسيع يبقى الملاذ الأخير فقط.
-- ============================================================

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
  v_span        integer;
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
    select code into v_parent_code
      from public.accounts
     where type = p_type and parent_id is null and code ~ '^\d000$'
     order by code
     limit 1;
  end if;

  if v_parent_code is null then
    if not exists (select 1 from public.accounts where code = v_prefix || '000') then
      return v_prefix || '000';
    end if;
    v_parent_code := v_prefix || '000';
  end if;

  if v_parent_code ~ '^\d+$' then
    v_zeros := length(v_parent_code) - length(rtrim(v_parent_code, '0'));
    if v_zeros > 0 then
      v_base := v_parent_code::int;
      v_span := power(10, v_zeros)::int;      -- مدى الأرقام المتاحة تحت الأب
      v_step := v_span / 10;                  -- ابدأ من أخشن مرتبة

      while v_step >= 1 loop
        i := 1;
        while i * v_step < v_span loop
          v_candidate := lpad((v_base + i * v_step)::text, length(v_parent_code), '0');
          if not exists (select 1 from public.accounts a where a.code = v_candidate) then
            return v_candidate;
          end if;
          i := i + 1;
        end loop;
        v_step := v_step / 10;
      end loop;
    end if;
  end if;

  -- المدى ممتلئ بالكامل (أو رمز الأب غير رقمي): وسّع الرمز بخانة إضافية
  for i in 1..99 loop
    v_candidate := v_parent_code || i::text;
    if not exists (select 1 from public.accounts a where a.code = v_candidate) then
      return v_candidate;
    end if;
  end loop;

  raise exception 'تعذر توليد رمز حساب تلقائي تحت الرمز %', v_parent_code;
end;
$$;

revoke all on function public.next_account_code(text, uuid) from public, anon, authenticated;
