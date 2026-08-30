/* ============================================================
   settings.js — Company profile, user profile, preferences,
   security, appearance. Company data persisted to Supabase
   table `company_settings` (single row). No invented values.
   ============================================================ */

(function () {
  'use strict';

  var CURRENCIES = [
    { code: 'SAR', label: 'ريال سعودي (SAR)' },
    { code: 'AED', label: 'درهم إماراتي (AED)' },
    { code: 'EGP', label: 'جنيه مصري (EGP)' },
    { code: 'KWD', label: 'دينار كويتي (KWD)' },
    { code: 'USD', label: 'دولار أمريكي (USD)' },
    { code: 'EUR', label: 'يورو (EUR)' }
  ];

  var settingsId = null;

  document.addEventListener('DOMContentLoaded', function () {
    window.layout.render('settings');
    var main = window.layout.mainEl();

    main.innerHTML =
      '<nav class="breadcrumbs" aria-label="مسار التنقل">' +
      '  <a href="../dashboard.html">لوحة التحكم</a>' +
      '  <span class="breadcrumbs__sep">/</span>' +
      '  <span aria-current="page">الإعدادات</span>' +
      '</nav>' +
      '<div class="page-header">' +
      '  <div>' +
      '    <h1 class="page-header__title">الإعدادات</h1>' +
      '    <p class="page-header__subtitle">إعدادات المنشأة والحساب والتفضيلات</p>' +
      '  </div>' +
      '</div>' +
      '<div class="tabs" role="tablist">' +
      '  <button class="tabs__btn is-active" data-tab="company" role="tab" aria-selected="true">ملف المنشأة</button>' +
      '  <button class="tabs__btn" data-tab="user" role="tab" aria-selected="false">الملف الشخصي</button>' +
      '  <button class="tabs__btn" data-tab="security" role="tab" aria-selected="false">الأمان</button>' +
      '  <button class="tabs__btn" data-tab="appearance" role="tab" aria-selected="false">المظهر</button>' +
      '</div>' +

      /* ---- Company profile ---- */
      '<div data-panel="company">' +
      '  <div class="card">' +
      '    <div class="card__header"><h2 class="card__title">بيانات المنشأة</h2></div>' +
      '    <div class="card__body" id="companyPanel">' + window.utils.loadingHtml() + '</div>' +
      '  </div>' +
      '</div>' +

      /* ---- User profile ---- */
      '<div data-panel="user" class="d-none">' +
      '  <div class="card">' +
      '    <div class="card__header"><h2 class="card__title">الملف الشخصي</h2></div>' +
      '    <div class="card__body" id="userPanel">' + window.utils.loadingHtml() + '</div>' +
      '  </div>' +
      '</div>' +

      /* ---- Security ---- */
      '<div data-panel="security" class="d-none">' +
      '  <div class="card">' +
      '    <div class="card__header"><h2 class="card__title">الأمان</h2></div>' +
      '    <div class="card__body">' +
      '      <div class="alert alert--info mb-4">' +
      '        إدارة كلمة المرور والجلسات تتم عبر Supabase Auth. لن تُخزَّن كلمات المرور أو المفاتيح السرية في الواجهة إطلاقاً.' +
      '      </div>' +
      '      <div class="form-grid form-grid--single" style="max-width: 420px;">' +
      '        <button class="btn btn--secondary" id="resetPasswordBtn">إرسال رابط إعادة تعيين كلمة المرور</button>' +
      '        <button class="btn btn--danger-outline" id="signOutBtn">تسجيل الخروج من هذا الجهاز</button>' +
      '      </div>' +
      '    </div>' +
      '  </div>' +
      '</div>' +

      /* ---- Appearance ---- */
      '<div data-panel="appearance" class="d-none">' +
      '  <div class="card">' +
      '    <div class="card__header"><h2 class="card__title">المظهر</h2></div>' +
      '    <div class="card__body">' +
      '      <div class="form-grid form-grid--single" style="max-width: 420px;">' +
      '        <label class="checkbox-field">' +
      '          <input type="checkbox" id="compactSidebar">' +
      '          <span>طي القائمة الجانبية افتراضياً (سطح المكتب)</span>' +
      '        </label>' +
      '        <p class="text-secondary fs-sm">يتم حفظ هذا التفضيل على هذا الجهاز فقط ولا يؤثر على بيانات المنشأة.</p>' +
      '      </div>' +
      '    </div>' +
      '  </div>' +
      '</div>';

    bindTabs();
    bindSecurity();
    bindAppearance();
    loadCompanySettings();
    loadUserPanel();
  });

  /* ---------- Tabs ---------- */
  function bindTabs() {
    document.querySelectorAll('.tabs__btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        document.querySelectorAll('.tabs__btn').forEach(function (b) {
          b.classList.toggle('is-active', b === btn);
          b.setAttribute('aria-selected', String(b === btn));
        });
        document.querySelectorAll('[data-panel]').forEach(function (p) {
          p.classList.toggle('d-none', p.dataset.panel !== btn.dataset.tab);
        });
      });
    });
  }

  /* ---------- Company profile ---------- */
  function loadCompanySettings() {
    var panel = document.getElementById('companyPanel');

    window.db.fetchRows('company_settings', { select: '*', limit: 1 }).then(function (res) {
      if (res.error) {
        panel.innerHTML = window.utils.errorToState(res.error, 'retrySettings');
        var b = document.getElementById('retrySettings');
        if (b) b.addEventListener('click', loadCompanySettings);
        return;
      }
      var row = (res.data && res.data[0]) || null;
      settingsId = row ? row.id : null;
      renderCompanyForm(panel, row || {});
    }).catch(function () {
      panel.innerHTML = window.utils.errorStateHtml({ retryId: 'retrySettings' });
      var b = document.getElementById('retrySettings');
      if (b) b.addEventListener('click', loadCompanySettings);
    });
  }

  function renderCompanyForm(panel, s) {
    var currencyOptions = CURRENCIES.map(function (c) {
      var sel = s.currency === c.code ? ' selected' : '';
      return '<option value="' + c.code + '"' + sel + '>' + c.label + '</option>';
    }).join('');

    panel.innerHTML =
      '<form id="companyForm" novalidate>' +
      '  <div class="form-grid">' +
      '    <div class="form-field">' +
      '      <label class="form-field__label" for="coName">اسم المنشأة <span class="form-field__required">*</span></label>' +
      '      <input class="input" id="coName" required value="' + window.utils.escapeHtml(s.company_name || '') + '">' +
      '      <span class="form-field__error">اسم المنشأة مطلوب</span>' +
      '    </div>' +
      '    <div class="form-field">' +
      '      <label class="form-field__label" for="coCountry">الدولة</label>' +
      '      <input class="input" id="coCountry" value="' + window.utils.escapeHtml(s.country || '') + '">' +
      '    </div>' +
      '    <div class="form-field">' +
      '      <label class="form-field__label" for="coCurrency">العملة</label>' +
      '      <select class="input" id="coCurrency"><option value="">اختر العملة...</option>' + currencyOptions + '</select>' +
      '    </div>' +
      '    <div class="form-field">' +
      '      <label class="form-field__label" for="coTax">الرقم الضريبي</label>' +
      '      <input class="input input--num" id="coTax" value="' + window.utils.escapeHtml(s.tax_number || '') + '">' +
      '    </div>' +
      '    <div class="form-field">' +
      '      <label class="form-field__label" for="coPhone">هاتف التواصل</label>' +
      '      <input class="input" type="tel" id="coPhone" style="direction:ltr; text-align:end;" value="' + window.utils.escapeHtml(s.phone || '') + '">' +
      '    </div>' +
      '    <div class="form-field">' +
      '      <label class="form-field__label" for="coEmail">البريد الإلكتروني</label>' +
      '      <input class="input" type="email" id="coEmail" style="direction:ltr; text-align:end;" value="' + window.utils.escapeHtml(s.email || '') + '">' +
      '    </div>' +
      '    <div class="form-field form-grid__full">' +
      '      <label class="form-field__label" for="coLogo">شعار المنشأة (رابط)</label>' +
      '      <input class="input" type="url" id="coLogo" placeholder="https://..." style="direction:ltr; text-align:end;" value="' + window.utils.escapeHtml(s.logo_url || '') + '">' +
      '      <span class="form-field__hint">ارفع الشعار إلى مخزن Supabase ثم الصق الرابط هنا.</span>' +
      '    </div>' +
      '  </div>' +
      '  <div class="d-flex justify-end mt-4">' +
      '    <button type="submit" class="btn btn--primary" id="saveCompanyBtn">حفظ بيانات المنشأة</button>' +
      '  </div>' +
      '</form>';

    document.getElementById('companyForm').addEventListener('submit', function (e) {
      e.preventDefault();
      if (!window.utils.validateForm(e.target)) return;

      var btn = document.getElementById('saveCompanyBtn');
      window.utils.setButtonLoading(btn, true, 'جاري الحفظ...');

      var payload = {
        company_name: document.getElementById('coName').value.trim(),
        country: document.getElementById('coCountry').value.trim() || null,
        currency: document.getElementById('coCurrency').value || null,
        tax_number: document.getElementById('coTax').value.trim() || null,
        phone: document.getElementById('coPhone').value.trim() || null,
        email: document.getElementById('coEmail').value.trim() || null,
        logo_url: document.getElementById('coLogo').value.trim() || null
      };

      var op = settingsId
        ? window.db.updateRow('company_settings', settingsId, payload)
        : window.db.insertRow('company_settings', payload);

      op.then(function (res) {
        window.utils.setButtonLoading(btn, false);
        if (res.error) {
          window.utils.toast(window.utils.isNotConfigured(res.error)
            ? 'لم يتم إعداد الاتصال بقاعدة البيانات بعد.'
            : 'تعذر حفظ البيانات', 'error');
          return;
        }
        window.utils.toast('تم حفظ البيانات بنجاح', 'success');
        loadCompanySettings();
      }).catch(function () {
        window.utils.setButtonLoading(btn, false);
        window.utils.toast('تعذر حفظ البيانات', 'error');
      });
    });
  }

  /* ---------- User profile (from real session only) ---------- */
  function loadUserPanel() {
    var panel = document.getElementById('userPanel');
    window.db.getSession().then(function (res) {
      var user = res && res.data && res.data.session ? res.data.session.user : null;
      if (!user) {
        panel.innerHTML = window.utils.emptyStateHtml({
          icon: 'users',
          title: 'لا يوجد مستخدم مسجل الدخول',
          text: 'سجّل الدخول لعرض بيانات ملفك الشخصي.',
          actionLabel: 'تسجيل الدخول',
          actionHref: '../login.html'
        });
        return;
      }
      var lastSignIn = user.last_sign_in_at ? window.utils.formatDate(user.last_sign_in_at) : '—';
      panel.innerHTML =
        '<dl class="dl">' +
        '<dt>البريد الإلكتروني</dt><dd class="num">' + window.utils.escapeHtml(user.email || '—') + '</dd>' +
        '<dt>معرّف المستخدم</dt><dd class="num">' + window.utils.escapeHtml(user.id || '—') + '</dd>' +
        '<dt>آخر تسجيل دخول</dt><dd class="num">' + lastSignIn + '</dd>' +
        '</dl>';
    });
  }

  /* ---------- Security ---------- */
  function bindSecurity() {
    document.getElementById('resetPasswordBtn').addEventListener('click', function () {
      window.db.getSession().then(function (res) {
        var user = res && res.data && res.data.session ? res.data.session.user : null;
        if (!user || !user.email) {
          window.utils.toast('لا يوجد مستخدم مسجل الدخول.', 'error');
          return;
        }
        window.db.resetPassword(user.email).then(function (r) {
          if (r.error) window.utils.toast('تعذر إرسال رابط الاستعادة.', 'error');
          else window.utils.toast('تم إرسال رابط إعادة التعيين إلى بريدك الإلكتروني.', 'success');
        });
      });
    });

    document.getElementById('signOutBtn').addEventListener('click', function () {
      window.db.signOut().finally(function () {
        window.location.href = '../login.html';
      });
    });
  }

  /* ---------- Appearance (device-local UI preference only) ---------- */
  function bindAppearance() {
    var checkbox = document.getElementById('compactSidebar');
    checkbox.checked = sessionStorage.getItem('pref_compact_sidebar') === '1';
    checkbox.addEventListener('change', function () {
      sessionStorage.setItem('pref_compact_sidebar', checkbox.checked ? '1' : '0');
      var shell = document.getElementById('appShell');
      if (shell) shell.classList.toggle('sidebar-collapsed', checkbox.checked);
      window.utils.toast('تم حفظ البيانات بنجاح', 'success');
    });
  }
})();
