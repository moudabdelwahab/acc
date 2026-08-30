/* ============================================================
   expenses.js — Expense list, category filter, create/edit.
   Table: expenses. All rows come from Supabase only.
   ============================================================ */

(function () {
  'use strict';

  var PAYMENT_METHODS = {
    cash: 'نقدي',
    bank_transfer: 'تحويل بنكي',
    card: 'بطاقة',
    cheque: 'شيك',
    other: 'أخرى'
  };

  var state = { expenses: [], accounts: [], search: '', category: '', page: 1, perPage: 12, editingId: null };

  document.addEventListener('DOMContentLoaded', function () {
    window.layout.render('expenses');
    var main = window.layout.mainEl();

    main.innerHTML =
      '<nav class="breadcrumbs" aria-label="مسار التنقل">' +
      '  <a href="../dashboard.html">لوحة التحكم</a>' +
      '  <span class="breadcrumbs__sep">/</span>' +
      '  <span aria-current="page">المصروفات</span>' +
      '</nav>' +
      '<div class="page-header">' +
      '  <div>' +
      '    <h1 class="page-header__title">المصروفات</h1>' +
      '    <p class="page-header__subtitle">تسجيل ومتابعة مصروفات المنشأة</p>' +
      '  </div>' +
      '  <div class="page-header__actions">' +
      '    <button class="btn btn--primary" id="addExpenseBtn">' + window.utils.iconSvg('plus') + ' مصروف جديد</button>' +
      '  </div>' +
      '</div>' +
      '<div class="toolbar">' +
      '  <div class="toolbar__search">' +
      '    <span class="toolbar__search-icon">' + window.utils.iconSvg('search') + '</span>' +
      '    <input class="input" type="search" id="searchInput" placeholder="بحث في الوصف..." aria-label="بحث في المصروفات">' +
      '  </div>' +
      '  <select class="input" id="categoryFilter" aria-label="تصفية حسب التصنيف">' +
      '    <option value="">كل التصنيفات</option>' +
      '  </select>' +
      '</div>' +
      '<div class="card">' +
      '  <div class="card__body card__body--flush" id="expensesTable">' + window.utils.loadingHtml() + '</div>' +
      '  <div class="card__footer">' +
      '    <span class="text-secondary fs-sm" id="countLabel"></span>' +
      '    <div class="pagination" id="pagination"></div>' +
      '  </div>' +
      '</div>' +

      /* Add/Edit modal */
      '<div class="modal-backdrop" id="expenseModal">' +
      '  <div class="modal" role="dialog" aria-modal="true" aria-labelledby="expenseModalTitle">' +
      '    <div class="modal__header">' +
      '      <h3 class="modal__title" id="expenseModalTitle">مصروف جديد</h3>' +
      '      <button class="modal__close" data-close-modal aria-label="إغلاق">' + window.utils.iconSvg('close') + '</button>' +
      '    </div>' +
      '    <form id="expenseForm" novalidate>' +
      '      <div class="modal__body">' +
      '        <div class="form-grid">' +
      '          <div class="form-field">' +
      '            <label class="form-field__label" for="expDate">التاريخ <span class="form-field__required">*</span></label>' +
      '            <input class="input" type="date" id="expDate" required>' +
      '            <span class="form-field__error">التاريخ مطلوب</span>' +
      '          </div>' +
      '          <div class="form-field">' +
      '            <label class="form-field__label" for="expAmount">المبلغ <span class="form-field__required">*</span></label>' +
      '            <input class="input input--num" type="number" id="expAmount" min="0.01" step="0.01" required placeholder="0.00">' +
      '            <span class="form-field__error">المبلغ مطلوب</span>' +
      '          </div>' +
      '          <div class="form-field">' +
      '            <label class="form-field__label" for="expCategory">التصنيف <span class="form-field__required">*</span></label>' +
      '            <select class="input" id="expCategory" required>' +
      '              <option value="">اختر حساب المصروف...</option>' +
      '            </select>' +
      '            <span class="form-field__error">التصنيف مطلوب</span>' +
      '          </div>' +
      '          <div class="form-field">' +
      '            <label class="form-field__label" for="expMethod">طريقة الدفع</label>' +
      '            <select class="input" id="expMethod">' +
      '              <option value="cash">نقدي</option>' +
      '              <option value="bank_transfer">تحويل بنكي</option>' +
      '              <option value="card">بطاقة</option>' +
      '              <option value="cheque">شيك</option>' +
      '              <option value="other">أخرى</option>' +
      '            </select>' +
      '          </div>' +
      '          <div class="form-field form-grid__full">' +
      '            <label class="form-field__label" for="expDesc">الوصف <span class="form-field__required">*</span></label>' +
      '            <input class="input" id="expDesc" required placeholder="وصف المصروف">' +
      '            <span class="form-field__error">الوصف مطلوب</span>' +
      '          </div>' +
      '          <div class="form-field form-grid__full">' +
      '            <label class="form-field__label" for="expReceipt">مرفق الإيصال (رابط)</label>' +
      '            <input class="input" type="url" id="expReceipt" placeholder="https://..." style="direction:ltr; text-align:end;">' +
      '            <span class="form-field__hint">ارفع الإيصال إلى مخزن Supabase ثم الصق الرابط هنا.</span>' +
      '          </div>' +
      '        </div>' +
      '      </div>' +
      '      <div class="modal__footer">' +
      '        <button type="button" class="btn btn--secondary" data-close-modal>إلغاء</button>' +
      '        <button type="submit" class="btn btn--primary" id="saveExpenseBtn">حفظ المصروف</button>' +
      '      </div>' +
      '    </form>' +
      '  </div>' +
      '</div>';

    window.utils.wireModals();
    document.getElementById('addExpenseBtn').addEventListener('click', function () { openForm(null); });
    document.getElementById('expenseForm').addEventListener('submit', saveExpense);
    document.getElementById('searchInput').addEventListener('input', function (e) {
      state.search = e.target.value.trim();
      state.page = 1;
      renderTable();
    });
    document.getElementById('categoryFilter').addEventListener('change', function (e) {
      state.category = e.target.value;
      state.page = 1;
      renderTable();
    });

    loadExpenseAccounts().then(loadExpenses);
  });

  /* Expense categories = expense-type accounts from the chart */
  function loadExpenseAccounts() {
    return window.db.fetchRows('accounts', {
      select: 'id,code,name',
      filters: [{ col: 'type', op: 'eq', val: 'expense' }, { col: 'is_active', op: 'eq', val: true }],
      order: { col: 'code', ascending: true }
    }).then(function (res) {
      state.accounts = (res && res.data) || [];
      var options = state.accounts.map(function (a) {
        return '<option value="' + a.id + '">' + window.utils.escapeHtml(a.code + ' — ' + a.name) + '</option>';
      }).join('');
      document.getElementById('expCategory').innerHTML = '<option value="">اختر حساب المصروف...</option>' + options;
      document.getElementById('categoryFilter').innerHTML = '<option value="">كل التصنيفات</option>' + options;
    });
  }

  function categoryName(id) {
    var a = state.accounts.find(function (x) { return String(x.id) === String(id); });
    return a ? a.name : '—';
  }

  function loadExpenses() {
    var box = document.getElementById('expensesTable');
    box.innerHTML = window.utils.loadingHtml();

    window.db.fetchRows('expenses', {
      select: 'id,expense_date,category_id,amount,payment_method,description,receipt_url,status',
      order: { col: 'expense_date', ascending: false }
    }).then(function (res) {
      if (res.error) {
        box.innerHTML = window.utils.errorToState(res.error, 'retryExpenses');
        bindRetry('retryExpenses', loadExpenses);
        return;
      }
      state.expenses = res.data || [];
      renderTable();
    }).catch(function () {
      box.innerHTML = window.utils.errorStateHtml({ retryId: 'retryExpenses' });
      bindRetry('retryExpenses', loadExpenses);
    });
  }

  function filtered() {
    return state.expenses.filter(function (ex) {
      if (state.category && String(ex.category_id) !== String(state.category)) return false;
      if (state.search) {
        var q = state.search.toLowerCase();
        if ((ex.description || '').toLowerCase().indexOf(q) === -1) return false;
      }
      return true;
    });
  }

  function renderTable() {
    var box = document.getElementById('expensesTable');
    var list = filtered();

    if (!state.expenses.length) {
      box.innerHTML = window.utils.emptyStateHtml({
        icon: 'document',
        title: 'لا توجد مصروفات حتى الآن',
        text: 'لم يتم تسجيل أي مصروفات بعد. سجّل أول مصروف لبدء المتابعة.',
        actionLabel: 'تسجيل مصروف جديد',
        actionId: 'emptyAddBtn'
      });
      var b = document.getElementById('emptyAddBtn');
      if (b) b.addEventListener('click', function () { openForm(null); });
      document.getElementById('countLabel').textContent = '';
      document.getElementById('pagination').innerHTML = '';
      return;
    }

    if (!list.length) {
      box.innerHTML = window.utils.emptyStateHtml({ icon: 'search', title: 'لا توجد نتائج مطابقة' });
      document.getElementById('countLabel').textContent = '';
      document.getElementById('pagination').innerHTML = '';
      return;
    }

    var pageCount = Math.ceil(list.length / state.perPage);
    if (state.page > pageCount) state.page = pageCount;
    var start = (state.page - 1) * state.perPage;
    var pageRows = list.slice(start, start + state.perPage);

    var total = list.reduce(function (s, ex) { return s + (Number(ex.amount) || 0); }, 0);

    var html = '<div class="table-wrapper"><table class="table">' +
      '<thead><tr><th>التاريخ</th><th>التصنيف</th><th>الوصف</th><th>طريقة الدفع</th>' +
      '<th>الإيصال</th><th class="num">المبلغ</th><th>الحالة</th><th></th></tr></thead><tbody>';

    pageRows.forEach(function (ex) {
      html += '<tr>' +
        '<td class="num">' + window.utils.formatDate(ex.expense_date) + '</td>' +
        '<td>' + window.utils.escapeHtml(categoryName(ex.category_id)) + '</td>' +
        '<td>' + window.utils.escapeHtml(ex.description || '—') + '</td>' +
        '<td>' + (PAYMENT_METHODS[ex.payment_method] || window.utils.escapeHtml(ex.payment_method || '—')) + '</td>' +
        '<td>' + (ex.receipt_url ? '<a href="' + window.utils.escapeHtml(ex.receipt_url) + '" target="_blank" rel="noopener">عرض</a>' : '—') + '</td>' +
        '<td class="num fw-semibold">' + window.utils.formatAmount(ex.amount) + '</td>' +
        '<td>' + window.utils.statusBadge(ex.status || 'approved') + '</td>' +
        '<td><div class="row-actions">' +
        '<button class="row-action-btn" data-act="edit" data-id="' + ex.id + '" aria-label="تعديل">' + window.utils.iconSvg('edit') + '</button>' +
        '<button class="row-action-btn row-action-btn--danger" data-act="delete" data-id="' + ex.id + '" aria-label="حذف">' + window.utils.iconSvg('trash') + '</button>' +
        '</div></td></tr>';
    });

    html += '</tbody><tfoot><tr><td colspan="5">إجمالي المصروفات المعروضة</td>' +
      '<td class="num">' + window.utils.formatAmount(total) + '</td><td colspan="2"></td></tr></tfoot></table></div>';
    box.innerHTML = html;

    document.getElementById('countLabel').textContent = 'عدد المصروفات: ' + list.length;
    window.utils.renderPagination(document.getElementById('pagination'), state.page, pageCount, function (p) {
      state.page = p;
      renderTable();
    });

    box.querySelectorAll('[data-act]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var ex = state.expenses.find(function (x) { return String(x.id) === String(btn.dataset.id); });
        if (!ex) return;
        if (btn.dataset.act === 'edit') openForm(ex);
        else if (btn.dataset.act === 'delete') deleteExpense(ex);
      });
    });
  }

  function openForm(ex) {
    state.editingId = ex ? ex.id : null;
    var form = document.getElementById('expenseForm');
    form.reset();
    window.utils.clearValidation(form);
    document.getElementById('expenseModalTitle').textContent = ex ? 'تعديل المصروف' : 'مصروف جديد';
    document.getElementById('expDate').value = window.utils.todayISO();
    if (ex) {
      document.getElementById('expDate').value = ex.expense_date || '';
      document.getElementById('expAmount').value = ex.amount || '';
      document.getElementById('expCategory').value = ex.category_id || '';
      document.getElementById('expMethod').value = ex.payment_method || 'cash';
      document.getElementById('expDesc').value = ex.description || '';
      document.getElementById('expReceipt').value = ex.receipt_url || '';
    }
    window.utils.openModal('expenseModal');
  }

  function saveExpense(e) {
    e.preventDefault();
    var form = e.target;
    if (!window.utils.validateForm(form)) return;

    var btn = document.getElementById('saveExpenseBtn');
    window.utils.setButtonLoading(btn, true, 'جاري الحفظ...');

    var payload = {
      expense_date: document.getElementById('expDate').value,
      amount: Number(document.getElementById('expAmount').value),
      category_id: document.getElementById('expCategory').value,
      payment_method: document.getElementById('expMethod').value,
      description: document.getElementById('expDesc').value.trim(),
      receipt_url: document.getElementById('expReceipt').value.trim() || null,
      status: 'approved'
    };

    var op = state.editingId
      ? window.db.updateRow('expenses', state.editingId, payload)
      : window.db.insertRow('expenses', payload);

    op.then(function (res) {
      window.utils.setButtonLoading(btn, false);
      if (res.error) {
        window.utils.toast(window.utils.isNotConfigured(res.error)
          ? 'لم يتم إعداد الاتصال بقاعدة البيانات بعد.'
          : 'تعذر حفظ البيانات', 'error');
        return;
      }
      window.utils.closeModal('expenseModal');
      window.utils.toast('تم حفظ البيانات بنجاح', 'success');
      loadExpenses();
    }).catch(function () {
      window.utils.setButtonLoading(btn, false);
      window.utils.toast('تعذر حفظ البيانات', 'error');
    });
  }

  function deleteExpense(ex) {
    window.utils.confirmDialog('هل أنت متأكد من حذف هذا المصروف؟ لا يمكن التراجع عن هذه العملية.').then(function (ok) {
      if (!ok) return;
      window.db.deleteRow('expenses', ex.id).then(function (res) {
        if (res.error) { window.utils.toast('تعذر حذف المصروف', 'error'); return; }
        window.utils.toast('تم حذف المصروف بنجاح', 'success');
        loadExpenses();
      }).catch(function () { window.utils.toast('تعذر حذف المصروف', 'error'); });
    });
  }

  function bindRetry(id, fn) {
    var b = document.getElementById(id);
    if (b) b.addEventListener('click', fn);
  }
})();
