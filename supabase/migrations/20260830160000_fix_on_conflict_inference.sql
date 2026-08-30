-- ============================================================
-- إصلاح 42P10: استدلال ON CONFLICT على فهرس فريد جزئي
--
-- كان الفهرسان جزئيين (`WHERE ... IS NOT NULL`). وPostgres لا يستدل
-- على فهرس جزئي إلا إذا كرّرت الجملة شرطه، وPostgREST ترسل
-- `on_conflict=` بلا WHERE — فكان كل upsert من المزامنة يفشل بـ
--   42P10: there is no unique or exclusion constraint matching
--          the ON CONFLICT specification
--
-- الحل: فهرس فريد غير جزئي. لا يغيّر ذلك السلوك المقصود، لأن
-- Postgres يعتبر قيم NULL متمايزة في الفهرس الفريد افتراضياً
-- (NULLS DISTINCT): فالصفوف اليدوية التي لا تحمل مُعرِّفاً خارجياً
-- تبقى غير مقيَّدة كما كانت، بينما يظل التكرار ممنوعاً على أي
-- مُعرِّف خارجي فعلي — وهو ما تعتمد عليه إعادة تشغيل المزامنة.
-- ============================================================

-- عميل واحد لكل حساب في المنصة
drop index if exists public.customers_external_uidx;
create unique index customers_external_uidx
  on public.customers (external_source, external_id);

-- فاتورة واحدة لكل اشتراك
drop index if exists public.invoices_external_subscription_uidx;
create unique index invoices_external_subscription_uidx
  on public.invoices (external_subscription_id);
