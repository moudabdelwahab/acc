-- 5850 مصروف الإهلاك was parented under 5800 الصيانة والإصلاح, which made 5800
-- unpostable. Only parent_id changes; no balance, no line, no amount is touched.
update public.accounts
   set parent_id = (select id from public.accounts where code = '5000')
 where code = '5850'
   and parent_id is distinct from (select id from public.accounts where code = '5000');

-- 5800 has no children any more, so it becomes postable again
update public.accounts a
   set is_postable = true
 where a.code = '5800'
   and not exists (select 1 from public.accounts c where c.parent_id = a.id);
