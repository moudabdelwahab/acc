/* ============================================================
   accounts.js — Chart of Accounts: hierarchy, search, filter,
   add/edit/view/delete. Data: Supabase table `accounts`.
   ============================================================ */

(function () {
  'use strict';

  var ACCOUNT_TYPES = {
    asset: 'الأصول',
    liability: 'الخصوم',
    equity: 'حقوق الملكية',
    revenue: 'الإيرادات',
    expense: 'المصروفات'
  };

  var ACCOUNT_SUBTYPES = {
    asset: ['أصول متداولة', 'أصول ثابتة', 'أصول أخرى'],
    liability: ['خصوم متداولة', 'خصوم طويلة الأجل'],
    equity: ['حقوق ملكية'],
    revenue: ['إيرادات'],
    expense: ['مصروفات', 'تكلفة المبيعات']
  };

  var state = { accounts: [], search: '', type: '', page: 1, perPage: 15, editingId: null };

  document.addEventListener('DOMContentLoaded', function () {
    window.layout.render('accounts');
    var main = window.layout.mainEl();

    main.innerHTML =
      '<nav class="breadcrumbs" aria-label="مسار التنقل">' +
      '  <a href="../dashboard.html">لوحة التحكم</a>' +
      '  <span class="breadcrumbs__sep">/</span>' +
      '  <span aria-current="page">دليل الحسابات</span>' +
      '</nav>' +
      '<div class="page-header">' +
      '  <div>' +
      '    <h1 class="page-header__title">دليل الحسابات</h1>' +
      '    <p class="page-header__subtitle">إدارة شجرة الحسابات المحاسبية</p>' +
      '  </div>' +
      '  <div class="page-header__actions">' +
      '    <button class="btn btn--primary" id="addAccountBtn">' + window.utils.iconSvg('plus') + ' حساب جديد</button>' +
      '  </div>' +
      '</div>' +
      '<div class="toolbar">' +
      '  <div class="toolbar__search">' +
      '    <span class="toolbar__search-icon">' + window.utils.iconSvg('search') + '</span>' +
      '    <input class="input" type="search" id="searchInput" placeholder="بحث بالاسم أو الرمز..." aria-label="بحث في الحسابات">' +
      '  </div>' +
      '  <select class="input" id="typeFilter" aria-label="تصفية حسب نوع الحساب">' +
      '    <option value="">كل الأنواع</option>' +
      typeOptionsHtml() +
      '  </select>' +
      '</div>' +
      '<div class="card">' +
      '  <div class="card__body card__body--flush" id="accountsTable">' + window.utils.loadingHtml() + '</div>' +
      '  <div class="card__footer">' +
      '    <span class="text-secondary fs-sm" id="countLabel"></span>' +
      '    <div class="pagination" id="pagination"></div>' +
      '  </div>' +
      '</div>' +

      /* Add/Edit modal */
      '<div class="modal-backdrop" id="accountModal">' +
      '  <div class="modal" role="dialog" aria-modal="true" aria-labelledby="accountModalTitle">' +
      '    <div class="modal__header">' +
      '      <h3 class="modal__title" id="accountModalTitle">حساب جديد</h3>' +
      '      <button class="modal__close" data-close-modal aria-label="إغلاق">' + window.utils.iconSvg('close') + '</button>' +
      '    </div>' +
      '    <form id="accountForm" novalidate>' +
      '      <div class="modal__body">' +
      '        <div class="form-grid">' +
      '          <div class="form-field">' +
      '            <label class="form-field__label" for="accCode">رمز الحساب</label>' +
      '            <input class="input input--num" id="accCode" placeholder="يُنشأ تلقائياً">' +
      '            <span class="form-field__hint">اتركه فارغاً ليُولَّد تلقائياً حسب النوع والحساب الأب.</span>' +
      '          </div>' +
      '          <div class="form-field">' +
      '            <label class="form-field__label" for="accName">اسم الحساب <span class="form-field__required">*</span></label>' +
      '            <input class="input" id="accName" required placeholder="مثال: النقدية بالصندوق">' +
      '            <span class="form-field__error">اسم الحساب مطلوب</span>' +
      '          </div>' +
      '          <div class="form-field">' +
      '            <label class="form-field__label" for="accType">نوع الحساب <span class="form-field__required">*</span></label>' +
      '            <select class="input" id="accType" required>' +
      '              <option value="">اختر النوع...</option>' + typeOptionsHtml() +
      '            </select>' +
      '            <span class="form-field__error">نوع الحساب مطلوب</span>' +
      '          </div>' +
      '          <div class="form-field">' +
      '            <label class="form-field__label" for="accSubtype">التصنيف الفرعي</label>' +
      '            <select class="input" id="accSubtype"><option value="">اختر...</option></select>' +
      '          </div>' +
      '          <div class="form-field form-grid__full">' +
      '            <label class="form-field__label" for="accParent">الحساب الأب</label>' +
      '            <select class="input" id="accParent"><option value="">— بدون (حساب رئيسي) —</option></select>' +
      '          </div>' +
      '          <div class="form-field form-grid__full">' +
      '            <label class="checkbox-field"><input type="checkbox" id="accActive" checked><span>حساب نشط</span></label>' +
      '          </div>' +
      '        </div>' +
      '      </div>' +
      '      <div class="modal__footer">' +
      '        <button type="button" class="btn btn--secondary" data-close-modal>إلغاء</button>' +
      '        <button type="submit" class="btn btn--primary" id="saveAccountBtn">حفظ الحساب</button>' +
      '      </div>' +
      '    </form>' +
      '  </div>' +
      '</div>' +

      /* View modal */
      '<div class="modal-backdrop" id="viewAccountModal">' +
      '  <div class="modal" role="dialog" aria-modal="true" aria-labelledby="viewAccountTitle">' +
      '    <div class="modal__header">' +
      '      <h3 class="modal__title" id="viewAccountTitle">تفاصيل الحساب</h3>' +
      '      <button class="modal__close" data-close-modal aria-label="إغلاق">' + window.utils.iconSvg('close') + '</button>' +
      '    </div>' +
      '    <div class="modal__body" id="viewAccountBody"></div>' +
      '    <div class="modal__footer">' +
      '      <button type="button" class="btn btn--secondary" data-close-modal>إغلاق</button>' +
      '    </div>' +
      '  </div>' +
      '</div>';

    window.utils.wireModals();
    bindEvents();
    loadAccounts();
  });

  function typeOptionsHtml() {
    return Object.keys(ACCOUNT_TYPES).map(function (k) {
      return '<option value="' + k + '">' + ACCOUNT_TYPES[k] + '</option>';
    }).join('');
  }

  function bindEvents() {
    document.getElementById('addAccountBtn').addEventListener('click', function () { openForm(null); });

    document.getElementById('searchInput').addEventListener('input', function (e) {
      state.search = e.target.value.trim();
      state.page = 1;
      renderTable();
    });

    document.getElementById('typeFilter').addEventListener('change', function (e) {
      state.type = e.target.value;
      state.page = 1;
      renderTable();
    });

    document.getElementById('accType').addEventListener('change', function (e) {
      var sub = document.getElementById('accSubtype');
      var list = ACCOUNT_SUBTYPES[e.target.value] || [];
      sub.innerHTML = '<option value="">اختر...</option>' + list.map(function (s) {
        return '<option value="' + s + '">' + s + '</option>';
      }).join('');
    });

    document.getElementById('accountForm').addEventListener('submit', saveAccount);
  }

  /* ---------- Data ---------- */

  function loadAccounts() {
    var box = document.getElementById('accountsTable');
    box.innerHTML = window.utils.loadingHtml();

    window.db.fetchRows('accounts', {
      select: 'id,code,name,type,subtype,parent_id,balance,is_active',
      order: { col: 'code', ascending: true }
    }).then(function (res) {
      if (res.error) {
        box.innerHTML = window.utils.errorToState(res.error, 'retryAccounts');
        var btn = document.getElementById('retryAccounts');
        if (btn) btn.addEventListener('click', loadAccounts);
        return;
      }
      state.accounts = res.data || [];
      renderTable();
    }).catch(function () {
      box.innerHTML = window.utils.errorStateHtml({ retryId: 'retryAccounts' });
      var btn = document.getElementById('retryAccounts');
      if (btn) btn.addEventListener('click', loadAccounts);
    });
  }

  function filtered() {
    return state.accounts.filter(function (a) {
      if (state.type && a.type !== state.type) return false;
      if (state.search) {
        var q = state.search.toLowerCase();
        var name = (a.name || '').toLowerCase();
        var code = (a.code || '').toLowerCase();
        if (name.indexOf(q) === -1 && code.indexOf(q) === -1) return false;
      }
      return true;
    });
  }

  function renderTable() {
    var box = document.getElementById('accountsTable');
    var list = filtered();

    if (!state.accounts.length) {
      box.innerHTML = window.utils.emptyStateHtml({
        icon: 'document',
        title: 'لا توجد حسابات حتى الآن',
        text: 'ابدأ ببناء دليل الحسابات الخاص بمنشأتك بإضافة أول حساب.',
        actionLabel: 'إضافة حساب جديد',
        actionId: 'emptyAddBtn'
      });
      var b = document.getElementById('emptyAddBtn');
      if (b) b.addEventListener('click', function () { openForm(null); });
      document.getElementById('countLabel').textContent = '';
      document.getElementById('pagination').innerHTML = '';
      return;
    }

    if (!list.length) {
      box.innerHTML = window.utils.emptyStateHtml({
        icon: 'search',
        title: 'لا توجد نتائج مطابقة',
        text: 'جرّب تعديل كلمة البحث أو إعادة تعيين التصفية.'
      });
      document.getElementById('countLabel').textContent = '';
      document.getElementById('pagination').innerHTML = '';
      return;
    }

    var pageCount = Math.ceil(list.length / state.perPage);
    if (state.page > pageCount) state.page = pageCount;
    var start = (state.page - 1) * state.perPage;
    var pageRows = list.slice(start, start + state.perPage);

    var parentName = {};
    state.accounts.forEach(function (a) { parentName[a.id] = a.name; });

    var html = '<div class="table-wrapper"><table class="table">' +
      '<thead><tr>' +
      '<th>الرمز</th><th>اسم الحساب</th><th>النوع</th><th>التصنيف الفرعي</th><th>الحساب الأب</th>' +
      '<th class="num">الرصيد</th><th>الحالة</th><th></th>' +
      '</tr></thead><tbody>';

    pageRows.forEach(function (a) {
      var indent = a.parent_id ? ' style="padding-inline-start: var(--space-6);"' : '';
      html += '<tr>' +
        '<td class="num fw-semibold">' + window.utils.escapeHtml(a.code || '—') + '</td>' +
        '<td' + indent + '>' + window.utils.escapeHtml(a.name || '—') + '</td>' +
        '<td><span class="badge badge--info">' + (ACCOUNT_TYPES[a.type] || window.utils.escapeHtml(a.type || '—')) + '</span></td>' +
        '<td>' + window.utils.escapeHtml(a.subtype || '—') + '</td>' +
        '<td>' + (a.parent_id ? window.utils.escapeHtml(parentName[a.parent_id] || '—') : '—') + '</td>' +
        '<td class="num">' + window.utils.formatAmount(a.balance) + '</td>' +
        '<td>' + window.utils.statusBadge(a.is_active ? 'active' : 'inactive') + '</td>' +
        '<td><div class="row-actions">' +
        '<button class="row-action-btn" data-act="view" data-id="' + a.id + '" aria-label="عرض">' + window.utils.iconSvg('eye') + '</button>' +
        '<button class="row-action-btn" data-act="edit" data-id="' + a.id + '" aria-label="تعديل">' + window.utils.iconSvg('edit') + '</button>' +
        '<button class="row-action-btn row-action-btn--danger" data-act="delete" data-id="' + a.id + '" aria-label="حذف">' + window.utils.iconSvg('trash') + '</button>' +
        '</div></td>' +
        '</tr>';
    });

    html += '</tbody></table></div>';
    box.innerHTML = html;

    document.getElementById('countLabel').textContent = 'إجمالي الحسابات: ' + list.length;
    window.utils.renderPagination(document.getElementById('pagination'), state.page, pageCount, function (p) {
      state.page = p;
      renderTable();
    });

    box.querySelectorAll('[data-act]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.dataset.id;
        var account = state.accounts.find(function (a) { return String(a.id) === String(id); });
        if (!account) return;
        if (btn.dataset.act === 'view') viewAccount(account);
        else if (btn.dataset.act === 'edit') openForm(account);
        else if (btn.dataset.act === 'delete') deleteAccount(account);
      });
    });
  }

  /* ---------- Form ---------- */

  function openForm(account) {
    state.editingId = account ? account.id : null;
    var form = document.getElementById('accountForm');
    form.reset();
    window.utils.clearValidation(form);
    document.getElementById('accountModalTitle').textContent = account ? 'تعديل الحساب' : 'حساب جديد';

    /* Parent options = all accounts except the one being edited */
    var parentSel = document.getElementById('accParent');
    parentSel.innerHTML = '<option value="">— بدون (حساب رئيسي) —</option>' +
      state.accounts
        .filter(function (a) { return !account || String(a.id) !== String(account.id); })
        .map(function (a) { return '<option value="' + a.id + '">' + window.utils.escapeHtml(a.code + ' — ' + a.name) + '</option>'; })
        .join('');

    if (account) {
      document.getElementById('accCode').value = account.code || '';
      document.getElementById('accName').value = account.name || '';
      document.getElementById('accType').value = account.type || '';
      document.getElementById('accType').dispatchEvent(new Event('change'));
      document.getElementById('accSubtype').value = account.subtype || '';
      parentSel.value = account.parent_id || '';
      document.getElementById('accActive').checked = account.is_active !== false;
    }

    window.utils.openModal('accountModal');
  }

  function saveAccount(e) {
    e.preventDefault();
    var form = e.target;
    if (!window.utils.validateForm(form)) return;

    var btn = document.getElementById('saveAccountBtn');
    window.utils.setButtonLoading(btn, true, 'جاري الحفظ...');

    var payload = {
      name: document.getElementById('accName').value.trim(),
      type: document.getElementById('accType').value,
      subtype: document.getElementById('accSubtype').value || null,
      parent_id: document.getElementById('accParent').value || null,
      is_active: document.getElementById('accActive').checked
    };

    /* رمز فارغ = لا تُرسل الحقل: عند الإضافة يولّده المحفّز،
       وعند التعديل يبقى الرمز الحالي كما هو. */
    var code = document.getElementById('accCode').value.trim();
    if (code) payload.code = code;

    var op = state.editingId
      ? window.db.updateRow('accounts', state.editingId, payload)
      : window.db.insertRow('accounts', payload);

    op.then(function (res) {
      window.utils.setButtonLoading(btn, false);
      if (res.error) {
        if (window.utils.isNotConfigured(res.error)) {
          window.utils.toast('لم يتم إعداد الاتصال بقاعدة البيانات بعد.', 'error');
        } else {
          window.utils.toast('تعذر حفظ البيانات', 'error');
        }
        return;
      }
      window.utils.closeModal('accountModal');
      window.utils.toast('تم حفظ البيانات بنجاح', 'success');
      loadAccounts();
    }).catch(function () {
      window.utils.setButtonLoading(btn, false);
      window.utils.toast('تعذر حفظ البيانات', 'error');
    });
  }

  function viewAccount(a) {
    var parent = state.accounts.find(function (x) { return String(x.id) === String(a.parent_id); });
    document.getElementById('viewAccountBody').innerHTML =
      '<dl class="dl">' +
      '<dt>رمز الحساب</dt><dd class="num">' + window.utils.escapeHtml(a.code || '—') + '</dd>' +
      '<dt>اسم الحساب</dt><dd>' + window.utils.escapeHtml(a.name || '—') + '</dd>' +
      '<dt>النوع</dt><dd>' + (ACCOUNT_TYPES[a.type] || '—') + '</dd>' +
      '<dt>التصنيف الفرعي</dt><dd>' + window.utils.escapeHtml(a.subtype || '—') + '</dd>' +
      '<dt>الحساب الأب</dt><dd>' + (parent ? window.utils.escapeHtml(parent.name) : '—') + '</dd>' +
      '<dt>الرصيد الحالي</dt><dd class="num fw-bold">' + window.utils.formatAmount(a.balance) + '</dd>' +
      '<dt>الحالة</dt><dd>' + window.utils.statusBadge(a.is_active ? 'active' : 'inactive') + '</dd>' +
      '</dl>';
    window.utils.openModal('viewAccountModal');
  }

  function deleteAccount(a) {
    window.utils.confirmDialog('هل أنت متأكد من حذف هذا الحساب؟ لا يمكن التراجع عن هذه العملية.').then(function (ok) {
      if (!ok) return;
      window.db.deleteRow('accounts', a.id).then(function (res) {
        if (res.error) {
          var msg = String((res.error && res.error.message) || '');
          window.utils.toast(
            msg.indexOf('foreign key') !== -1 || msg.indexOf('violates') !== -1
              ? 'لا يمكن حذف حساب عليه حركات مسجّلة. عطّل الحساب بدلاً من حذفه.'
              : 'تعذر حذف الحساب', 'error');
          return;
        }
        window.utils.toast('تم حذف الحساب بنجاح', 'success');
        loadAccounts();
      }).catch(function () {
        window.utils.toast('تعذر حذف الحساب', 'error');
      });
    });
  }
})();
