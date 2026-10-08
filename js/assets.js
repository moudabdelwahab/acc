/* ============================================================
   assets.js — سجل الأصول الثابتة مربوطًا بالدفاتر.

   الواجهة تكتب صف fixed_assets فقط؛ قاعدة البيانات ترحّل القيود:
   - الاقتناء (نقدًا/بنكًا/من المالك/رصيد افتتاحي، أو بربطه بفاتورة
     مشتريات مرحّلة على حساب الأصل)،
   - الإهلاك الشهري بالقسط الثابت (fn_run_depreciation، وتشغّله مهمة
     مجدولة أول كل شهر)، والتراجع عن آخر شهر (fn_undo_last_depreciation)،
   - البيع أو الاستبعاد وأرباحه أو خسائره.
   مجمع الإهلاك محسوب في القاعدة ولا يُكتب من هنا. رسائل الرفض (FA..، P04)
   تأتي بالعربية وتُعرض كما هي.
   ============================================================ */

(function () {
  'use strict';

  var SOURCES = {
    purchase: 'فاتورة مشتريات مرحّلة',
    cash: 'نقدًا من الصندوق',
    bank: 'من البنك',
    capital: 'قدّمه المالك (رأس المال)',
    opening: 'مملوك قبل بداية التشغيل (رصيد افتتاحي)'
  };
  /* مجمع الإهلاك الافتراضي لكل حساب أصل في الدليل القياسي */
  var ACCUM_FOR = { '1210': '1291', '1220': '1292', '1230': '1293', '1240': '1294' };

  var state = {
    assets: [], accounts: [], purchases: [], deps: [],
    search: '', page: 1, perPage: 12, editing: null, disposing: null
  };

  document.addEventListener('DOMContentLoaded', function () {
    window.layout.render('assets');
    var main = window.layout.mainEl();
    var u = window.utils;

    main.innerHTML =
      '<nav class="breadcrumbs" aria-label="مسار التنقل">' +
      '  <a href="../dashboard.html">لوحة التحكم</a>' +
      '  <span class="breadcrumbs__sep">/</span>' +
      '  <span aria-current="page">الأصول الثابتة</span>' +
      '</nav>' +
      '<div class="page-header">' +
      '  <div>' +
      '    <h1 class="page-header__title">الأصول الثابتة</h1>' +
      '    <p class="page-header__subtitle">سجل الأصول والإهلاك والقيمة الدفترية، مرحّلًا إلى الدفاتر</p>' +
      '  </div>' +
      '  <div class="page-header__actions">' +
      '    <button class="btn btn--primary" id="addAssetBtn">' + u.iconSvg('plus') + ' أصل جديد</button>' +
      '  </div>' +
      '</div>' +
      '<div class="card mb-4"><div class="card__body" id="depPanel">' + u.loadingHtml() + '</div></div>' +
      '<div class="toolbar">' +
      '  <div class="toolbar__search">' +
      '    <span class="toolbar__search-icon">' + u.iconSvg('search') + '</span>' +
      '    <input class="input" type="search" id="searchInput" placeholder="بحث بالاسم أو الرمز..." aria-label="بحث في الأصول">' +
      '  </div>' +
      '</div>' +
      '<div class="card">' +
      '  <div class="card__body card__body--flush" id="assetsTable">' + u.loadingHtml() + '</div>' +
      '  <div class="card__footer">' +
      '    <span class="text-secondary fs-sm" id="countLabel"></span>' +
      '    <div class="pagination" id="pagination"></div>' +
      '  </div>' +
      '</div>' +

      /* إضافة / تعديل */
      '<div class="modal-backdrop" id="assetModal">' +
      '  <div class="modal modal--lg" role="dialog" aria-modal="true" aria-labelledby="assetModalTitle">' +
      '    <div class="modal__header">' +
      '      <h3 class="modal__title" id="assetModalTitle">أصل جديد</h3>' +
      '      <button class="modal__close" data-close-modal aria-label="إغلاق">' + u.iconSvg('close') + '</button>' +
      '    </div>' +
      '    <form id="assetForm" novalidate>' +
      '      <div class="modal__body">' +
      '        <div class="alert alert--info mb-4" id="lockedNote" style="display:none;">' +
      '          على هذا الأصل إهلاك أو بيع مرحّل، فبياناته المحاسبية مقفلة. يمكن تعديل الاسم والرمز والملاحظات فقط.' +
      '        </div>' +
      '        <div class="form-grid">' +
      field('assetName', 'اسم الأصل', '<input class="input" id="assetName" required placeholder="مثال: جهاز حاسب آلي">', true, 'اسم الأصل مطلوب') +
      field('assetCode', 'رمز الأصل', '<input class="input input--num" id="assetCode" required placeholder="FA-0001">', true, 'رمز الأصل مطلوب') +
      field('assetAccount', 'حساب الأصل', '<select class="input acct" id="assetAccount" required></select>', true, 'اختر حساب الأصل') +
      field('accumAccount', 'حساب مجمع الإهلاك', '<select class="input acct" id="accumAccount" required></select>', true, 'اختر حساب مجمع الإهلاك') +
      field('purchaseDate', 'تاريخ الشراء', '<input class="input acct" type="date" id="purchaseDate" required>', true, 'تاريخ الشراء مطلوب') +
      field('purchaseCost', 'التكلفة (جنيه)', '<input class="input input--num acct" type="number" id="purchaseCost" min="0.01" step="0.01" required>', true, 'التكلفة مطلوبة') +
      field('usefulLife', 'العمر الإنتاجي (سنوات)', '<input class="input input--num acct" type="number" id="usefulLife" min="1" step="1" placeholder="فارغ = لا يُهلَك (أرض)">') +
      field('salvage', 'قيمة الخردة', '<input class="input input--num acct" type="number" id="salvage" min="0" step="0.01" value="0">') +
      '          <div class="form-field form-grid__full">' +
      '            <label class="form-field__label" for="source">طريقة الاقتناء <span class="form-field__required">*</span></label>' +
      '            <select class="input acct" id="source" required>' +
      Object.keys(SOURCES).map(function (k) { return '<option value="' + k + '">' + SOURCES[k] + '</option>'; }).join('') +
      '            </select>' +
      '            <span class="form-field__hint" id="sourceHint"></span>' +
      '          </div>' +
      '          <div class="form-field form-grid__full" id="purchaseField">' +
      '            <label class="form-field__label" for="purchaseSel">فاتورة المشتريات</label>' +
      '            <select class="input acct" id="purchaseSel"></select>' +
      '            <span class="form-field__hint">الفواتير المستلمة المرحّلة على حساب الأصل المختار.</span>' +
      '          </div>' +
      '          <div class="form-field" id="openingField">' +
      '            <label class="form-field__label" for="openingAcc">مجمع الإهلاك حتى بداية التشغيل</label>' +
      '            <input class="input input--num acct" type="number" id="openingAcc" min="0" step="0.01" value="0">' +
      '          </div>' +
      '          <div class="form-field">' +
      '            <span class="form-field__label">القسط الشهري</span>' +
      '            <div class="fw-bold fs-lg num" id="monthlyPreview">—</div>' +
      '          </div>' +
      '          <div class="form-field form-grid__full">' +
      '            <label class="form-field__label" for="assetNotes">ملاحظات</label>' +
      '            <textarea class="input" id="assetNotes" rows="2"></textarea>' +
      '          </div>' +
      '        </div>' +
      '      </div>' +
      '      <div class="modal__footer">' +
      '        <button type="button" class="btn btn--secondary" data-close-modal>إلغاء</button>' +
      '        <button type="submit" class="btn btn--primary" id="saveAssetBtn">حفظ الأصل</button>' +
      '      </div>' +
      '    </form>' +
      '  </div>' +
      '</div>' +

      /* بيع / استبعاد */
      '<div class="modal-backdrop" id="disposeModal">' +
      '  <div class="modal" role="dialog" aria-modal="true" aria-labelledby="disposeTitle">' +
      '    <div class="modal__header">' +
      '      <h3 class="modal__title" id="disposeTitle">بيع أو استبعاد أصل</h3>' +
      '      <button class="modal__close" data-close-modal aria-label="إغلاق">' + u.iconSvg('close') + '</button>' +
      '    </div>' +
      '    <form id="disposeForm" novalidate>' +
      '      <div class="modal__body">' +
      '        <p class="text-secondary fs-sm mb-3" id="disposeInfo"></p>' +
      '        <div class="form-grid">' +
      '          <div class="form-field">' +
      '            <label class="form-field__label" for="dType">العملية</label>' +
      '            <select class="input" id="dType"><option value="sold">بيع</option><option value="disposed">استبعاد (تالف / خردة بلا مقابل)</option></select>' +
      '          </div>' +
      field('dDate', 'التاريخ', '<input class="input" type="date" id="dDate" required>', true, 'التاريخ مطلوب') +
      '          <div class="form-field" id="dProceedsField">' +
      '            <label class="form-field__label" for="dProceeds">مبلغ البيع (جنيه)</label>' +
      '            <input class="input input--num" type="number" id="dProceeds" min="0.01" step="0.01">' +
      '          </div>' +
      '          <div class="form-field" id="dMethodField">' +
      '            <label class="form-field__label" for="dMethod">استُلم</label>' +
      '            <select class="input" id="dMethod"><option value="cash">نقدًا في الصندوق</option><option value="bank">في البنك</option></select>' +
      '          </div>' +
      '        </div>' +
      '        <p class="text-secondary fs-sm mt-3">يُرحَّل إهلاك الأصل حتى الشهر السابق للتاريخ، ثم قيد البيع وأرباحه أو خسائره.</p>' +
      '      </div>' +
      '      <div class="modal__footer">' +
      '        <button type="button" class="btn btn--secondary" data-close-modal>إلغاء</button>' +
      '        <button type="submit" class="btn btn--danger" id="disposeBtn">تأكيد</button>' +
      '      </div>' +
      '    </form>' +
      '  </div>' +
      '</div>' +

      /* عرض */
      '<div class="modal-backdrop" id="viewAssetModal">' +
      '  <div class="modal modal--lg" role="dialog" aria-modal="true" aria-labelledby="viewAssetTitle">' +
      '    <div class="modal__header">' +
      '      <h3 class="modal__title" id="viewAssetTitle">تفاصيل الأصل</h3>' +
      '      <button class="modal__close" data-close-modal aria-label="إغلاق">' + u.iconSvg('close') + '</button>' +
      '    </div>' +
      '    <div class="modal__body" id="viewAssetBody"></div>' +
      '  </div>' +
      '</div>';

    u.wireModals();
    document.getElementById('addAssetBtn').addEventListener('click', function () { openForm(null); });
    document.getElementById('assetForm').addEventListener('submit', saveAsset);
    document.getElementById('disposeForm').addEventListener('submit', saveDisposal);
    document.getElementById('searchInput').addEventListener('input', function (e) {
      state.search = e.target.value.trim();
      state.page = 1;
      renderTable();
    });
    document.getElementById('assetAccount').addEventListener('change', onAssetAccountChange);
    document.getElementById('source').addEventListener('change', onSourceChange);
    ['purchaseCost', 'salvage', 'usefulLife'].forEach(function (id) {
      document.getElementById(id).addEventListener('input', updatePreview);
    });
    document.getElementById('dType').addEventListener('change', onDisposeTypeChange);

    loadAll();
  });

  function field(id, label, control, required, error) {
    return '<div class="form-field">' +
      '<label class="form-field__label" for="' + id + '">' + label +
      (required ? ' <span class="form-field__required">*</span>' : '') + '</label>' + control +
      (error ? '<span class="form-field__error">' + error + '</span>' : '') + '</div>';
  }

  /* ---------- البيانات ---------- */

  function loadAll() {
    var box = document.getElementById('assetsTable');
    box.innerHTML = window.utils.loadingHtml();
    Promise.all([
      window.db.fetchAll('fixed_assets', {
        select: 'id,name,code,purchase_date,purchase_cost,useful_life_years,salvage_value,accumulated_depreciation,status,' +
                'asset_account_id,accumulated_account_id,acquisition_source,purchase_id,opening_accumulated,' +
                'disposal_date,disposal_proceeds,disposal_method,notes',
        order: { col: 'code', ascending: true }
      }),
      window.db.fetchAll('accounts', {
        select: 'id,code,name,type,subtype,is_contra,is_control,is_cash_account,is_postable,is_active',
        filters: [{ col: 'type', op: 'eq', val: 'asset' }],
        order: { col: 'code', ascending: true }
      }),
      window.db.fetchAll('purchases', {
        select: 'id,purchase_number,purchase_date,subtotal,account_id,status,description',
        filters: [{ col: 'status', op: 'in', val: ['received', 'paid'] }]
      }),
      /* الأقساط القائمة فقط: المعكوسة تبقى في القاعدة للتدقيق */
      window.db.fetchAll('asset_depreciation', { select: 'id,asset_id,period_month,amount', filters: [{ col: 'reversed', op: 'eq', val: false }] })
    ]).then(function (res) {
      var err = res[0].error || res[1].error || res[2].error || res[3].error;
      if (err) {
        box.innerHTML = window.utils.errorToState(err, 'retryAssets');
        bindRetry('retryAssets', loadAll);
        document.getElementById('depPanel').innerHTML = '';
        return;
      }
      state.assets = res[0].data || [];
      state.accounts = res[1].data || [];
      state.purchases = res[2].data || [];
      state.deps = res[3].data || [];
      renderDepPanel();
      renderTable();
    }).catch(function () {
      box.innerHTML = window.utils.errorStateHtml({ retryId: 'retryAssets' });
      bindRetry('retryAssets', loadAll);
    });
  }

  function account(id) { return state.accounts.filter(function (a) { return a.id === id; })[0]; }
  function assetAccounts() {
    return state.accounts.filter(function (a) {
      return a.is_postable && a.is_active && !a.is_contra && !a.is_control && !a.is_cash_account && a.subtype === 'أصول ثابتة';
    });
  }
  function accumAccounts() {
    return state.accounts.filter(function (a) { return a.is_postable && a.is_active && a.is_contra; });
  }
  function monthly(a) {
    var life = Number(a.useful_life_years) || 0;
    if (!life) return 0;
    return Math.round(((Number(a.purchase_cost) || 0) - (Number(a.salvage_value) || 0)) / (life * 12) * 100) / 100;
  }
  function hasPosted(a) {
    return a.status !== 'active' || state.deps.some(function (d) { return d.asset_id === a.id; });
  }
  function monthLabel(iso) { return iso ? String(iso).slice(0, 7) : '—'; }
  function prevMonthEnd() {
    var d = new Date();
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 0)).toISOString().slice(0, 10);
  }

  /* ---------- لوحة الإهلاك ---------- */

  function renderDepPanel() {
    var box = document.getElementById('depPanel');
    var last = state.deps.reduce(function (m, d) { return d.period_month > m ? d.period_month : m; }, '');
    var depreciable = state.assets.filter(function (a) { return a.status === 'active' && Number(a.useful_life_years) > 0; });
    var monthlyTotal = depreciable.reduce(function (s, a) {
      var remaining = (Number(a.purchase_cost) || 0) - (Number(a.salvage_value) || 0) - (Number(a.accumulated_depreciation) || 0);
      return s + Math.min(monthly(a), Math.max(remaining, 0));
    }, 0);

    box.innerHTML =
      '<div class="d-flex flex-wrap align-center justify-between gap-4">' +
      '  <div>' +
      '    <div class="fw-bold mb-2">الإهلاك الشهري</div>' +
      '    <div class="text-secondary fs-sm">آخر شهر مرحّل: <span class="num fw-semibold">' + monthLabel(last) + '</span>' +
      '      · القسط الشهري الحالي: <span class="num fw-semibold">' + window.utils.formatAmount(monthlyTotal) + '</span></div>' +
      '    <div class="text-muted fs-sm mt-2">يُرحَّل تلقائيًا أول كل شهر عن الشهر المنتهي. استخدم الزر لترحيل شهور فائتة.</div>' +
      '  </div>' +
      '  <div class="d-flex flex-wrap align-center gap-2">' +
      '    <label class="d-flex align-center gap-2 fs-sm text-secondary">حتى ' +
      '      <input class="input" type="date" id="depThrough" style="width:auto;" value="' + prevMonthEnd() + '"></label>' +
      '    <button class="btn btn--primary" id="runDepBtn">ترحيل الإهلاك</button>' +
      (last ? '    <button class="btn btn--secondary" id="undoDepBtn">تراجع عن ' + monthLabel(last) + '</button>' : '') +
      '  </div>' +
      '</div>';

    document.getElementById('runDepBtn').addEventListener('click', function () {
      var btn = this;
      window.utils.setButtonLoading(btn, true);
      window.db.rpc('fn_run_depreciation', { p_through: document.getElementById('depThrough').value || null }).then(function (res) {
        window.utils.setButtonLoading(btn, false);
        if (res.error) { window.utils.toast(window.utils.dbErrorMessage(res.error, 'تعذر ترحيل الإهلاك'), 'error'); return; }
        var r = res.data || {};
        window.utils.toast(r.entries
          ? 'رُحّل الإهلاك: ' + r.entries + ' قيد بإجمالي ' + window.utils.formatAmount(r.amount)
          : 'لا يوجد إهلاك مستحق حتى هذا التاريخ', 'success');
        loadAll();
      });
    });
    var undo = document.getElementById('undoDepBtn');
    if (undo) undo.addEventListener('click', function () {
      window.utils.confirmDialog('سيُعكس قيد إهلاك ' + monthLabel(last) + ' لكل الأصول. هل تريد المتابعة؟').then(function (ok) {
        if (!ok) return;
        window.db.rpc('fn_undo_last_depreciation').then(function (res) {
          if (res.error) { window.utils.toast(window.utils.dbErrorMessage(res.error, 'تعذر التراجع'), 'error'); return; }
          window.utils.toast('تم التراجع عن إهلاك ' + monthLabel(last), 'success');
          loadAll();
        });
      });
    });
  }

  /* ---------- الجدول ---------- */

  function filtered() {
    return state.assets.filter(function (a) {
      if (!state.search) return true;
      var q = state.search.toLowerCase();
      return (a.name || '').toLowerCase().indexOf(q) !== -1 || (a.code || '').toLowerCase().indexOf(q) !== -1;
    });
  }

  function renderTable() {
    var box = document.getElementById('assetsTable');
    var list = filtered();
    var u = window.utils;

    if (!state.assets.length) {
      box.innerHTML = u.emptyStateHtml({
        icon: 'inbox',
        title: 'لا توجد أصول ثابتة حتى الآن',
        text: 'سجّل أول أصل ثابت؛ يُرحَّل اقتناؤه وإهلاكه إلى الدفاتر تلقائيًا.',
        actionLabel: 'إضافة أصل جديد',
        actionId: 'emptyAddBtn'
      });
      var b = document.getElementById('emptyAddBtn');
      if (b) b.addEventListener('click', function () { openForm(null); });
      document.getElementById('countLabel').textContent = '';
      document.getElementById('pagination').innerHTML = '';
      return;
    }
    if (!list.length) {
      box.innerHTML = u.emptyStateHtml({ icon: 'search', title: 'لا توجد نتائج مطابقة' });
      document.getElementById('countLabel').textContent = '';
      document.getElementById('pagination').innerHTML = '';
      return;
    }

    var pageCount = Math.ceil(list.length / state.perPage);
    if (state.page > pageCount) state.page = pageCount;
    var start = (state.page - 1) * state.perPage;
    var pageRows = list.slice(start, start + state.perPage);

    var t = { cost: 0, dep: 0, book: 0 };
    list.forEach(function (a) {
      if (a.status !== 'active') return;
      t.cost += Number(a.purchase_cost) || 0;
      t.dep += Number(a.accumulated_depreciation) || 0;
    });
    t.book = t.cost - t.dep;

    var html = '<div class="table-wrapper"><table class="table">' +
      '<thead><tr><th>الرمز</th><th>اسم الأصل</th><th>الحساب</th><th>تاريخ الشراء</th>' +
      '<th class="num">التكلفة</th><th class="num">مجمع الإهلاك</th>' +
      '<th style="min-width:160px;">القيمة الدفترية</th><th class="num">القسط الشهري</th><th>الحالة</th><th></th></tr></thead><tbody>';

    pageRows.forEach(function (a) {
      var cost = Number(a.purchase_cost) || 0;
      var dep = Number(a.accumulated_depreciation) || 0;
      var book = Math.max(cost - dep, 0);
      var depPct = cost > 0 ? Math.min(Math.round((dep / cost) * 100), 100) : 0;
      var acc = account(a.asset_account_id);
      html += '<tr>' +
        '<td class="num fw-semibold">' + u.escapeHtml(a.code || '—') + '</td>' +
        '<td>' + u.escapeHtml(a.name || '—') + '</td>' +
        '<td>' + u.escapeHtml(acc ? acc.code + ' — ' + acc.name : '—') + '</td>' +
        '<td class="num">' + u.formatDate(a.purchase_date) + '</td>' +
        '<td class="num">' + u.formatAmount(cost) + '</td>' +
        '<td class="num">' + u.formatAmount(dep) + '</td>' +
        '<td><div class="num fw-semibold mb-2">' + (a.status === 'active' ? u.formatAmount(book) : '—') + '</div>' +
        '<div style="display:flex; height:6px; border-radius:3px; overflow:hidden; background:var(--surface); direction:ltr;" title="القيمة الدفترية / الإهلاك">' +
        '<span style="width:' + (100 - depPct) + '%; background:var(--success);"></span>' +
        '<span style="width:' + depPct + '%; background:var(--warning);"></span></div></td>' +
        '<td class="num">' + (a.status === 'active' && monthly(a) ? u.formatAmount(monthly(a)) : '—') + '</td>' +
        '<td>' + u.statusBadge(a.status) + '</td>' +
        '<td><div class="row-actions">' +
        '<button class="row-action-btn" data-act="view" data-id="' + a.id + '" aria-label="عرض">' + u.iconSvg('eye') + '</button>' +
        '<button class="row-action-btn" data-act="edit" data-id="' + a.id + '" aria-label="تعديل">' + u.iconSvg('edit') + '</button>' +
        (a.status === 'active'
          ? '<button class="row-action-btn" data-act="dispose" data-id="' + a.id + '" aria-label="بيع أو استبعاد" title="بيع أو استبعاد">' + u.iconSvg('check') + '</button>'
          : '<button class="row-action-btn" data-act="reactivate" data-id="' + a.id + '" aria-label="إلغاء البيع" title="إلغاء البيع أو الاستبعاد">' + u.iconSvg('close') + '</button>') +
        '<button class="row-action-btn row-action-btn--danger" data-act="delete" data-id="' + a.id + '" aria-label="حذف">' + u.iconSvg('trash') + '</button>' +
        '</div></td></tr>';
    });

    html += '</tbody><tfoot><tr><td colspan="4">إجمالي الأصول القائمة</td>' +
      '<td class="num">' + u.formatAmount(t.cost) + '</td>' +
      '<td class="num">' + u.formatAmount(t.dep) + '</td>' +
      '<td class="num">' + u.formatAmount(t.book) + '</td>' +
      '<td colspan="3"></td></tr></tfoot></table></div>';
    box.innerHTML = html;

    document.getElementById('countLabel').textContent = 'عدد الأصول: ' + list.length;
    u.renderPagination(document.getElementById('pagination'), state.page, pageCount, function (p) {
      state.page = p;
      renderTable();
    });

    box.querySelectorAll('[data-act]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var a = state.assets.filter(function (x) { return String(x.id) === String(btn.dataset.id); })[0];
        if (!a) return;
        var act = btn.dataset.act;
        if (act === 'view') viewAsset(a);
        else if (act === 'edit') openForm(a);
        else if (act === 'dispose') openDispose(a);
        else if (act === 'reactivate') reactivate(a);
        else if (act === 'delete') deleteAsset(a);
      });
    });
  }

  /* ---------- النموذج ---------- */

  function optionsHtml(list, placeholder) {
    return '<option value="">' + placeholder + '</option>' + list.map(function (a) {
      return '<option value="' + a.id + '">' + window.utils.escapeHtml(a.code + ' — ' + a.name) + '</option>';
    }).join('');
  }

  function nextCode() {
    var max = 0;
    state.assets.forEach(function (a) {
      var m = /^FA-(\d+)$/.exec(a.code || '');
      if (m) max = Math.max(max, Number(m[1]));
    });
    return 'FA-' + String(max + 1).padStart(4, '0');
  }

  function openForm(a) {
    state.editing = a || null;
    var form = document.getElementById('assetForm');
    form.reset();
    window.utils.clearValidation(form);
    document.getElementById('assetModalTitle').textContent = a ? 'تعديل الأصل' : 'أصل جديد';
    document.getElementById('assetAccount').innerHTML = optionsHtml(assetAccounts(), 'اختر حساب الأصل...');
    document.getElementById('accumAccount').innerHTML = optionsHtml(accumAccounts(), 'اختر حساب مجمع الإهلاك...');

    if (a) {
      document.getElementById('assetName').value = a.name || '';
      document.getElementById('assetCode').value = a.code || '';
      document.getElementById('assetAccount').value = a.asset_account_id || '';
      document.getElementById('accumAccount').value = a.accumulated_account_id || '';
      document.getElementById('purchaseDate').value = a.purchase_date || '';
      document.getElementById('purchaseCost').value = a.purchase_cost || '';
      document.getElementById('usefulLife').value = a.useful_life_years || '';
      document.getElementById('salvage').value = a.salvage_value || 0;
      document.getElementById('source').value = a.acquisition_source || 'cash';
      document.getElementById('openingAcc').value = a.opening_accumulated || 0;
      document.getElementById('assetNotes').value = a.notes || '';
    } else {
      document.getElementById('assetCode').value = nextCode();
      document.getElementById('purchaseDate').value = window.utils.todayISO();
      document.getElementById('source').value = 'cash';
    }

    var locked = !!(a && hasPosted(a));
    document.getElementById('lockedNote').style.display = locked ? '' : 'none';
    form.querySelectorAll('.acct').forEach(function (el) { el.disabled = locked; });

    onSourceChange();
    if (a && a.purchase_id) document.getElementById('purchaseSel').value = a.purchase_id;
    updatePreview();
    window.utils.openModal('assetModal');
  }

  function onAssetAccountChange() {
    var acc = account(document.getElementById('assetAccount').value);
    var accumCode = acc && ACCUM_FOR[acc.code];
    if (accumCode) {
      var accum = state.accounts.filter(function (x) { return x.code === accumCode; })[0];
      if (accum) document.getElementById('accumAccount').value = accum.id;
    }
    fillPurchases();
  }

  function fillPurchases() {
    var accId = document.getElementById('assetAccount').value;
    var list = state.purchases.filter(function (p) { return p.account_id === accId; });
    document.getElementById('purchaseSel').innerHTML = '<option value="">اختر فاتورة المشتريات...</option>' + list.map(function (p) {
      return '<option value="' + p.id + '">' + window.utils.escapeHtml(p.purchase_number + ' — ' + window.utils.formatDate(p.purchase_date) +
        ' — ' + window.utils.formatAmount(p.subtotal) + (p.description ? ' — ' + p.description : '')) + '</option>';
    }).join('');
  }

  var HINTS = {
    purchase: 'القيد موجود من فاتورة المشتريات (مدين حساب الأصل / دائن المورد)، فلا يُنشأ قيد جديد.',
    cash: 'قيد: مدين حساب الأصل / دائن الصندوق.',
    bank: 'قيد: مدين حساب الأصل / دائن البنك.',
    capital: 'قيد: مدين حساب الأصل / دائن رأس المال.',
    opening: 'بتاريخ بداية التشغيل: مدين حساب الأصل بالتكلفة / دائن مجمع الإهلاك بالإهلاك السابق / دائن رأس المال بالصافي. يبدأ إهلاكه من شهر بداية التشغيل.'
  };

  function onSourceChange() {
    var src = document.getElementById('source').value;
    document.getElementById('sourceHint').textContent = HINTS[src] || '';
    document.getElementById('purchaseField').style.display = src === 'purchase' ? '' : 'none';
    document.getElementById('openingField').style.display = src === 'opening' ? '' : 'none';
    fillPurchases();
  }

  function updatePreview() {
    var m = monthly({
      purchase_cost: document.getElementById('purchaseCost').value,
      salvage_value: document.getElementById('salvage').value,
      useful_life_years: document.getElementById('usefulLife').value
    });
    document.getElementById('monthlyPreview').textContent = m > 0 ? window.utils.formatAmount(m) : 'لا يُهلَك';
  }

  function saveAsset(e) {
    e.preventDefault();
    var form = e.target;
    var a = state.editing;
    var locked = !!(a && hasPosted(a));
    if (!window.utils.validateForm(form)) return;

    var payload = {
      name: document.getElementById('assetName').value.trim(),
      code: document.getElementById('assetCode').value.trim(),
      notes: document.getElementById('assetNotes').value.trim() || null
    };
    if (!locked) {
      var src = document.getElementById('source').value;
      Object.assign(payload, {
        asset_account_id: document.getElementById('assetAccount').value,
        accumulated_account_id: document.getElementById('accumAccount').value,
        purchase_date: document.getElementById('purchaseDate').value,
        purchase_cost: Number(document.getElementById('purchaseCost').value),
        useful_life_years: Number(document.getElementById('usefulLife').value) || null,
        salvage_value: Number(document.getElementById('salvage').value) || 0,
        acquisition_source: src,
        purchase_id: src === 'purchase' ? (document.getElementById('purchaseSel').value || null) : null,
        opening_accumulated: src === 'opening' ? (Number(document.getElementById('openingAcc').value) || 0) : 0,
        depreciation_method: 'straight_line'
      });
    }

    var btn = document.getElementById('saveAssetBtn');
    window.utils.setButtonLoading(btn, true, 'جاري الحفظ...');
    var op = a ? window.db.updateRow('fixed_assets', a.id, payload) : window.db.insertRow('fixed_assets', payload);
    op.then(function (res) {
      window.utils.setButtonLoading(btn, false);
      if (res.error) { window.utils.toast(window.utils.dbErrorMessage(res.error, 'تعذر حفظ الأصل'), 'error'); return; }
      window.utils.closeModal('assetModal');
      window.utils.toast(a ? 'تم حفظ الأصل' : 'تم تسجيل الأصل وترحيل اقتنائه', 'success');
      loadAll();
    }).catch(function () {
      window.utils.setButtonLoading(btn, false);
      window.utils.toast('تعذر حفظ الأصل', 'error');
    });
  }

  /* ---------- البيع والاستبعاد ---------- */

  function openDispose(a) {
    state.disposing = a;
    var form = document.getElementById('disposeForm');
    form.reset();
    window.utils.clearValidation(form);
    document.getElementById('disposeTitle').textContent = 'بيع أو استبعاد ' + a.code;
    document.getElementById('disposeInfo').textContent = a.name + ' — التكلفة ' + window.utils.formatAmount(a.purchase_cost) +
      '، مجمع الإهلاك المرحّل ' + window.utils.formatAmount(a.accumulated_depreciation);
    document.getElementById('dDate').value = window.utils.todayISO();
    onDisposeTypeChange();
    window.utils.openModal('disposeModal');
  }

  function onDisposeTypeChange() {
    var sold = document.getElementById('dType').value === 'sold';
    document.getElementById('dProceedsField').style.display = sold ? '' : 'none';
    document.getElementById('dMethodField').style.display = sold ? '' : 'none';
  }

  function saveDisposal(e) {
    e.preventDefault();
    if (!window.utils.validateForm(e.target)) return;
    var sold = document.getElementById('dType').value === 'sold';
    var proceeds = Number(document.getElementById('dProceeds').value) || 0;
    if (sold && !(proceeds > 0)) {
      document.getElementById('dProceeds').closest('.form-field').classList.add('has-error');
      return;
    }
    var btn = document.getElementById('disposeBtn');
    window.utils.setButtonLoading(btn, true);
    window.db.updateRow('fixed_assets', state.disposing.id, {
      status: sold ? 'sold' : 'disposed',
      disposal_date: document.getElementById('dDate').value,
      disposal_proceeds: sold ? proceeds : 0,
      disposal_method: sold ? document.getElementById('dMethod').value : null
    }).then(function (res) {
      window.utils.setButtonLoading(btn, false);
      if (res.error) { window.utils.toast(window.utils.dbErrorMessage(res.error, 'تعذر الحفظ'), 'error'); return; }
      window.utils.closeModal('disposeModal');
      window.utils.toast(sold ? 'تم بيع الأصل وترحيل القيد' : 'تم استبعاد الأصل وترحيل القيد', 'success');
      loadAll();
    });
  }

  function reactivate(a) {
    window.utils.confirmDialog('إلغاء بيع/استبعاد ' + a.code + '؟ يُعكس قيد البيع ويعود الأصل نشطًا.').then(function (ok) {
      if (!ok) return;
      window.db.updateRow('fixed_assets', a.id, { status: 'active' }).then(function (res) {
        if (res.error) { window.utils.toast(window.utils.dbErrorMessage(res.error, 'تعذر الحفظ'), 'error'); return; }
        window.utils.toast('عاد الأصل نشطًا وعُكس قيد البيع', 'success');
        loadAll();
      });
    });
  }

  function deleteAsset(a) {
    window.utils.confirmDialog('حذف الأصل ' + a.code + '؟ يُعكس قيد اقتنائه. لا يُحذف أصل عليه إهلاك مرحّل.').then(function (ok) {
      if (!ok) return;
      window.db.deleteRow('fixed_assets', a.id).then(function (res) {
        if (res.error) { window.utils.toast(window.utils.dbErrorMessage(res.error, 'تعذر حذف الأصل'), 'error'); return; }
        window.utils.toast('تم حذف الأصل وعكس قيده', 'success');
        loadAll();
      });
    });
  }

  /* ---------- العرض ---------- */

  function viewAsset(a) {
    var u = window.utils;
    var acc = account(a.asset_account_id), accum = account(a.accumulated_account_id);
    var rows = state.deps.filter(function (d) { return d.asset_id === a.id; })
      .sort(function (x, y) { return x.period_month < y.period_month ? -1 : 1; });
    var cost = Number(a.purchase_cost) || 0;
    var depreciable = cost - (Number(a.salvage_value) || 0);
    var remaining = Math.max(depreciable - (Number(a.accumulated_depreciation) || 0), 0);
    var m = monthly(a);

    var html = '<dl class="dl mb-4">' +
      '<dt>الأصل</dt><dd>' + u.escapeHtml(a.code + ' — ' + a.name) + '</dd>' +
      '<dt>حساب الأصل</dt><dd>' + u.escapeHtml(acc ? acc.code + ' — ' + acc.name : '—') + '</dd>' +
      '<dt>مجمع الإهلاك</dt><dd>' + u.escapeHtml(accum ? accum.code + ' — ' + accum.name : '—') + '</dd>' +
      '<dt>الاقتناء</dt><dd>' + u.escapeHtml(SOURCES[a.acquisition_source] || '—') + ' · ' + u.formatDate(a.purchase_date) + '</dd>' +
      '<dt>التكلفة / الخردة</dt><dd class="num">' + u.formatAmount(cost) + ' / ' + u.formatAmount(a.salvage_value) + '</dd>' +
      '<dt>العمر الإنتاجي</dt><dd>' + (a.useful_life_years ? a.useful_life_years + ' سنوات — قسط شهري ' + u.formatAmount(m) : 'لا يُهلَك') + '</dd>' +
      (Number(a.opening_accumulated) ? '<dt>إهلاك افتتاحي</dt><dd class="num">' + u.formatAmount(a.opening_accumulated) + '</dd>' : '') +
      '<dt>مجمع الإهلاك</dt><dd class="num fw-bold">' + u.formatAmount(a.accumulated_depreciation) + '</dd>' +
      '<dt>المتبقي للإهلاك</dt><dd class="num">' + u.formatAmount(remaining) +
        (m && remaining ? ' (حوالي ' + Math.ceil(remaining / m) + ' شهرًا)' : '') + '</dd>' +
      (a.status !== 'active' ? '<dt>' + (a.status === 'sold' ? 'البيع' : 'الاستبعاد') + '</dt><dd>' + u.formatDate(a.disposal_date) +
        (a.status === 'sold' ? ' — ' + u.formatAmount(a.disposal_proceeds) : '') + '</dd>' : '') +
      '</dl>';

    html += '<h3 class="fs-lg mb-3">الإهلاك المرحّل</h3>';
    html += rows.length
      ? '<div class="table-wrapper"><table class="table table--compact"><thead><tr><th>الشهر</th><th class="num">القسط</th></tr></thead><tbody>' +
        rows.map(function (d) { return '<tr><td class="num">' + monthLabel(d.period_month) + '</td><td class="num">' + u.formatAmount(d.amount) + '</td></tr>'; }).join('') +
        '</tbody></table></div>'
      : '<div class="alert alert--info">لم يُرحَّل إهلاك لهذا الأصل بعد.</div>';

    document.getElementById('viewAssetBody').innerHTML = html;
    window.utils.openModal('viewAssetModal');
  }

  function bindRetry(id, fn) {
    var b = document.getElementById(id);
    if (b) b.addEventListener('click', fn);
  }
})();
