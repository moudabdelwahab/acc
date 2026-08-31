-- Phase 1 / Step 2: eleven new accounts. Inserts only; no existing row is deleted.
insert into public.accounts (code, name, type, subtype, parent_id, normal_balance, is_postable, is_contra)
select v.code, v.name, v.type, v.subtype,
       (select p.id from public.accounts p where p.code = v.parent),
       v.nb, true, v.contra
  from (values
    ('2150','الإيرادات المقدمة',           'liability','خصوم متداولة','2100','credit', false),
    ('2160','دائنو شراء الأصول',           'liability','خصوم متداولة','2100','credit', false),
    ('3900','ملخص الدخل',                  'equity',   'حقوق ملكية',  '3000','credit', false),
    ('4300','إيرادات الاشتراكات',          'revenue',  'إيرادات',     '4000','credit', false),
    ('4400','مردودات المبيعات',            'revenue',  'إيرادات',     '4000','debit',  true ),
    ('4500','الخصم المسموح به',            'revenue',  'إيرادات',     '4000','debit',  true ),
    ('4910','الخصم المكتسب',               'revenue',  'إيرادات',     '4900','credit', false),
    ('1291','مجمع إهلاك المباني',          'asset',    'أصول ثابتة',  '1290','credit', true ),
    ('1292','مجمع إهلاك الأثاث والتجهيزات','asset',    'أصول ثابتة',  '1290','credit', true ),
    ('1293','مجمع إهلاك السيارات',         'asset',    'أصول ثابتة',  '1290','credit', true ),
    ('1294','مجمع إهلاك أجهزة الحاسب',     'asset',    'أصول ثابتة',  '1290','credit', true )
  ) as v(code, name, type, subtype, parent, nb, contra)
 where not exists (select 1 from public.accounts a where a.code = v.code);

-- 1290 and 4900 now have children, so they stop being postable
update public.accounts a
   set is_postable = false
 where a.is_postable
   and exists (select 1 from public.accounts c where c.parent_id = a.id);

-- retained earnings is not used by a sole proprietorship: deactivated, never deleted
update public.accounts set is_active = false where code = '3200' and is_active;

comment on table public.accounts is 'دليل الحسابات — 3200 معطّل لأن المنشأة فردية، و3900 حساب مؤقت للإقفال فقط';
