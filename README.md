# نظام المحاسبة

تطبيق محاسبي بواجهة عربية (RTL) مبني بـ HTML/CSS/JavaScript خالص، وقاعدة بياناته على **Supabase**.

---

## 1. الربط بمشروع Supabase

المشروع مربوط بالفعل بمشروع Supabase التالي:

| العنصر | القيمة |
| --- | --- |
| اسم المشروع | `Accountant` |
| مرجع المشروع (project ref) | `lxbqalqibudovewwenes` |
| رابط الـ API | `https://lxbqalqibudovewwenes.supabase.co` |
| المنطقة | `eu-west-1` |

إعدادات الاتصال موجودة في **`js/config.js`** ويقرأها `js/supabase.js` تلقائياً:

```js
window.APP_CONFIG = {
  SUPABASE_URL: 'https://lxbqalqibudovewwenes.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_...'
};
```

المفتاح المستخدم هو المفتاح العام (publishable) وهو **آمن للنشر في المتصفح**؛ الحماية الحقيقية عبر
Row Level Security. لا تضع مفتاح `service_role` في أي ملف داخل هذا المستودع.

## 2. تشغيل الواجهة محلياً

الموقع ثابت (static) ولا يحتاج خطوة بناء، لكنه يحتاج خادماً محلياً حتى تعمل جلسة تسجيل الدخول:

```bash
python3 -m http.server 3000
# ثم افتح http://localhost:3000
```

> عند النشر على نطاق جديد، أضف الرابط في
> Supabase Dashboard → Authentication → URL Configuration → Site URL / Redirect URLs.

## 3. قاعدة البيانات

كل مخطط قاعدة البيانات موجود كملفات ترحيل (migrations) داخل `supabase/migrations`:

| الملف | المحتوى |
| --- | --- |
| `..._initial_schema.sql` | الجداول الاثنا عشر + الفهارس + محفزات `updated_at` |
| `..._rls_policies.sql` | تفعيل RLS وسياسات وصول للمستخدمين المسجَّلين فقط |
| `..._balance_triggers.sql` | احتساب أرصدة الحسابات والعملاء والموردين تلقائياً |
| `..._seed_chart_of_accounts.sql` | دليل حسابات عربي قياسي + بيانات المنشأة |
| `..._lock_down_functions.sql` | منع استدعاء الدوال الداخلية عبر `/rest/v1/rpc` |

### الجداول

`accounts` · `customers` · `suppliers` · `journal_entries` · `journal_entry_lines` ·
`invoices` · `invoice_items` · `purchases` · `payments` · `expenses` · `fixed_assets` ·
`company_settings`

### احتساب الأرصدة

الأرصدة **لا تُكتب من الواجهة**، بل تحسبها محفزات قاعدة البيانات:

- `accounts.balance` — من بنود القيود ذات الحالة `posted` فقط.
  الأصول والمصروفات = مدين − دائن، وباقي الأنواع = دائن − مدين.
- `customers.balance` — إجمالي الفواتير غير الملغاة − المقبوضات.
- `suppliers.balance` — إجمالي المشتريات غير الملغاة − المدفوعات.

### الأمان

RLS مفعّل على كل الجداول: المستخدم المسجَّل (`authenticated`) لديه صلاحية كاملة،
والزائر غير المسجَّل (`anon`) لا يرى أي صف. صفحات التطبيق تعيد توجيه غير المسجَّلين إلى `login.html`.

## 4. الربط بـ GitHub (نشر الترحيلات تلقائياً)

ملف `.github/workflows/supabase-migrations.yml` يطبّق أي ترحيل جديد على مشروع Supabase
عند الدمج في `main`، ويعرض قائمة الترحيلات المعلّقة فقط في طلبات الدمج.

لتفعيله أضف هذه الأسرار في **GitHub → Settings → Secrets and variables → Actions**:

| السر | القيمة |
| --- | --- |
| `SUPABASE_ACCESS_TOKEN` | رمز وصول شخصي من https://supabase.com/dashboard/account/tokens |
| `SUPABASE_PROJECT_ID` | `lxbqalqibudovewwenes` |
| `SUPABASE_DB_PASSWORD` | كلمة مرور قاعدة البيانات (Project Settings → Database) |

### إضافة تعديل جديد على قاعدة البيانات

```bash
supabase migration new اسم_التعديل     # ينشئ ملفاً جديداً في supabase/migrations
# اكتب SQL داخل الملف، ثم ادفع التغيير — سيطبّقه الـ workflow عند الدمج في main
```

### (اختياري) ربط Supabase بالمستودع من داخل لوحة التحكم

Supabase يوفّر تكاملاً رسمياً مع GitHub يتيح فروع قاعدة بيانات لكل طلب دمج، ويُفعَّل يدوياً من:
**Supabase Dashboard → Project Settings → Integrations → GitHub** ثم اختر هذا المستودع
ومجلد الترحيلات `supabase/`. هذه الخطوة تتطلب صلاحية OAuth ولا يمكن تنفيذها من الكود.

## 5. الدخول للنظام

استخدم البريد وكلمة المرور المُنشأة لك في Supabase Auth، ثم غيّر كلمة المرور من
**الإعدادات → الأمان → إعادة تعيين كلمة المرور**.

لإضافة مستخدمين آخرين: Supabase Dashboard → Authentication → Users → **Add user**.
