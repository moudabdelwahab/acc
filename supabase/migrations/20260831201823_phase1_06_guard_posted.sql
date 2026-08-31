-- Phase 1 / Step 6: immutability of posted entries. Runs AFTER all backfills.
create or replace function public.tg_guard_posted()
returns trigger language plpgsql security definer set search_path to '' as $$
declare
  v_posting boolean := coalesce(current_setting('app.posting', true), '') = 'on';
begin
  if tg_op = 'DELETE' then
    if old.status = 'posted' then
      raise exception 'القيد % مرحّل ولا يجوز حذفه — التصحيح يكون بقيد عكسي عبر fn_reverse_entry', old.entry_number
        using errcode = '42501';
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    if new.status = 'posted' and not v_posting then
      raise exception 'لا يجوز إنشاء قيد بحالة posted مباشرة — أنشئه draft ثم رحّله بـ fn_post_entry'
        using errcode = '42501';
    end if;
    return new;
  end if;

  -- UPDATE
  if old.status = 'posted' and not v_posting then
    raise exception 'القيد % مرحّل ولا يجوز تعديله — التصحيح يكون بقيد عكسي عبر fn_reverse_entry', old.entry_number
      using errcode = '42501';
  end if;

  if old.status = 'draft' and new.status = 'posted' and not v_posting then
    raise exception 'الترحيل لا يتم بتغيير الحالة مباشرة — استخدم fn_post_entry'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create or replace function public.tg_guard_posted_lines()
returns trigger language plpgsql security definer set search_path to '' as $$
declare
  v_posting boolean := coalesce(current_setting('app.posting', true), '') = 'on';
  v_entry   uuid    := coalesce(new.entry_id, old.entry_id);
  v_status  text;
  v_number  text;
begin
  if not v_posting then
    select e.status, e.entry_number into v_status, v_number
      from public.journal_entries e where e.id = v_entry;

    if v_status = 'posted' then
      raise exception 'بنود القيد % مرحّلة ولا تُعدَّل ولا تُحذف ولا يُضاف إليها', v_number
        using errcode = '42501';
    end if;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists tg_guard_posted on public.journal_entries;
create trigger tg_guard_posted before insert or update or delete on public.journal_entries
  for each row execute function public.tg_guard_posted();

drop trigger if exists tg_guard_posted_lines on public.journal_entry_lines;
create trigger tg_guard_posted_lines before insert or update or delete on public.journal_entry_lines
  for each row execute function public.tg_guard_posted_lines();

-- defence in depth: no delete privilege at all, even if a trigger were disabled
revoke delete on public.journal_entries, public.journal_entry_lines from anon, authenticated;
