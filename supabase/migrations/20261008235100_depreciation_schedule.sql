-- ============================================================
-- الترحيل الشهري التلقائي للإهلاك (pg_cron)
-- ============================================================
-- أول كل شهر 00:05 UTC: إهلاك الشهر الذي انتهى. حيث لا تتوفر pg_cron (بيئة
-- اختبار محلية) يُتخطى الجدول، ويبقى الترحيل من زر شاشة الأصول.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    execute 'create extension if not exists pg_cron';
    execute $cron$select cron.schedule('monthly-depreciation', '5 0 1 * *',
                                      'select public.fn_run_depreciation()')$cron$;
  else
    raise notice 'pg_cron غير متاح: الإهلاك يُرحَّل من شاشة الأصول';
  end if;
end $$;
