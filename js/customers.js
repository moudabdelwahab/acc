/* ============================================================
   customers.js — Customer list, search, profile with balance,
   invoice & payment history. Tables: customers, invoices,
   payments. No fabricated records — empty states when empty.
   ============================================================ */

(function () {
  'use strict';

  var state = { customers: [], search: '', page: 1, perPage: 12, editingId: null };

  document.addEventListener('DOMContentLoaded', function () {
    window.layout.render('customers');
    var main = window.layout.mainEl();

    main.innerHTML =
      '<nav class="breadcrumbs" aria-label="مسار التنقل">' +
      '  <a href="../dashboard.html">لوحة التحكم</a>' +
      '  <span class="breadcrumbs__sep">/</span>' +
      '  <span aria-current="page">العملاء</span>' +
      '</nav>' +
      '<div class="page-header">' +
      '  <div>' +
      '    <h1 class="page-header__title">العملاء</h1>' +
      '    <p class="page-header__subtitle">إدارة بيانات العملاء وأرصدتهم</p>' +
      '  </div>' +
      '  <div class="page-header__actions">' +
      '    <button class="btn btn--primary" id="addCustomerBtn">' + window.utils.iconSvg('plus') + ' عميل جديد</button>' +
      '  </div>' +
      '</div>' +
      '<div class="toolbar">' +
      '  <div class="toolbar__search">' +
      '    <span class="toolbar__search-icon">' + window.utils.iconSvg('search') + '</span>' +
      '    <input class="input" type="search" id="searchInput" placeholder="بحث بالاسم أو الهاتف أو البريد..." aria-label="بحث في العملاء">' +
      '  </div>' +
      '</div>' +
      '<div class="card">' +
      '  <div class="card__body card__body--flush" id="customersTable">' + window.utils.loadingHtml() + '</div>' +
      '  <div class="card__footer">' +
      '    <span class="text-secondary fs-sm" id="countLabel"></span>' +
      '    <div class="pagination" id="pagination"></div>' +
      '  </div>' +
      '</div>' +

      /* Add/Edit modal */
      '<div class="modal-backdrop" id="customerModal">' +
      '  <div class="modal" role="dialog" aria-modal="true" aria-labelledby="customerModalTitle">' +
      '    <div class="modal__header">' +
      '      <h3 class="modal__title" id="customerModalTitle">عميل جديد</h3>' +
      '      <button class="modal__close" data-close-modal aria-label="إغلاق">' + window.utils.iconSvg('close') + '</button>' +
      '    </div>' +
      '    <form id="customerForm" novalidate>' +
      '      <div class="modal__body">' +
      '        <div class="form-grid">' +
      '          <div class="form-field">' +
      '            <label class="form-field__label" for="custName">اسم العميل <span class="form-field__required">*</span></label>' +
      '            <input class="input" id="custName" required>' +
      '            <span class="form-field__error">اسم العميل مطلوب</span>' +
      '          </div>' +
      '          <div class="form-field">' +
      '            <label class="form-field__label" for="custPhone">رقم الهاتف</label>' +
      '            <input class="input" type="tel" id="custPhone" style="direction:ltr; text-align:end;">' +
      '          </div>' +
      '          <div class="form-field">' +
      '            <label class="form-field__label" for="custEmail">البريد الإلكتروني</label>' +
      '            <input class="input" type="email" id="custEmail" style="direction:ltr; text-align:end;">' +
      '          </div>' +
      '          <div class="form-field">' +
      '            <label class="form-field__label" for="custTax">الرقم الضريبي</label>' +
      '            <input class="input input--num" id="custTax">' +
      '          </div>' +
      '          <div class="form-field form-grid__full">' +
      '            <label class="form-field__label" for="custAddress">العنوان</label>' +
      '            <textarea class="input" id="custAddress" rows="2"></textarea>' +
      '          </div>' +
      '          <div class="form-field form-grid__full">' +
      '            <label class="checkbox-field"><input type="checkbox" id="custActive" checked><span>عميل نشط</span></label>' +
      '          </div>' +
      '        </div>' +
      '      </div>' +
      '      <div class="modal__footer">' +
      '        <button type="button" class="btn btn--secondary" data-close-modal>إلغاء</button>' +
      '        <button type="submit" class="btn btn--primary" id="saveCustomerBtn">حفظ العميل</button>' +
      '      </div>' +
      '    </form>' +
      '  </div>' +
      '</div>' +

      /* Profile modal */
      '<div class="modal-backdrop" id="profileModal">' +
      '  <div class="modal modal--lg" role="dialog" aria-modal="true" aria-labelledby="profileTitle">' +
      '    <div class="modal__header">' +
      '      <h3 class="modal__title" id="profileTitle">ملف العميل</h3>' +
      '      <button class="modal__close" data-close-modal aria-label="إغلاق">' + window.utils.iconSvg('close') + '</button>' +
      '    </div>' +
      '    <div class="modal__body" id="profileBody">' + window.utils.loadingHtml() + '</div>' +
      '    <div class="modal__footer">' +
      '      <button type="button" class="btn btn--secondary" data-close-modal>إغلاق</button>' +
      '    </div>' +
      '  </div>' +
      '</div>';

    window.utils.wireModals();
    document.getElementById('addCustomerBtn').addEventListener('click', function () { openForm(null); });
    document.getElementById('customerForm').addEventListener('submit', saveCustomer);
    document.getElementById('searchInput').addEventListener('input', function (e) {
      state.search = e.target.value.trim();
      state.page = 1;
      renderTable();
    });

    loadCustomers();
  });

  function loadCustomers() {
    var box = document.getElementById('customersTable');
    box.innerHTML = window.utils.loadingHtml();

    window.db.fetchRows('customers', {
      select: 'id,name,phone,email,tax_number,address,balance,is_active',
      order: { col: 'name', ascending: true }
    }).then(function (res) {
      if (res.error) {
        box.innerHTML = window.utils.errorToState(res.error, 'retryCustomers');
        bindRetry('retryCustomers', loadCustomers);
        return;
      }
      state.customers = res.data || [];
      renderTable();
    }).catch(function () {
      box.innerHTML = window.utils.errorStateHtml({ retryId: 'retryCustomers' });
      bindRetry('retryCustomers', loadCustomers);
    });
  }

  function filtered() {
    return state.customers.filter(function (c) {
      if (!state.search) return true;
      var q = state.search.toLowerCase();
      return (c.name || '').toLowerCase().indexOf(q) !== -1 ||
             (c.phone || '').toLowerCase().indexOf(q) !== -1 ||
             (c.email || '').toLowerCase().indexOf(q) !== -1;
    });
  }

  function renderTable() {
    var box = document.getElementById('customersTable');
    var list = filtered();

    if (!state.customers.length) {
      box.innerHTML = window.utils.emptyStateHtml({
        icon: 'users',
        title: 'لا يوجد عملاء حتى الآن',
        text: 'أضف أول عميل لبدء إصدار الفواتير ومتابعة الأرصدة.',
        actionLabel: 'إضافة عميل جديد',
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

    var html = '<div class="table-wrapper"><table class="table">' +
      '<thead><tr><th>الاسم</th><th>الهاتف</th><th>البريد الإلكتروني</th>' +
      '<th class="num">الرصيد</th><th>الحالة</th><th></th></tr></thead><tbody>';

    pageRows.forEach(function (c) {
      var bal = Number(c.balance) || 0;
      html += '<tr>' +
        '<td class="fw-semibold">' + window.utils.escapeHtml(c.name || '—') + '</td>' +
        '<td class="num">' + window.utils.escapeHtml(c.phone || '—') + '</td>' +
        '<td class="num">' + window.utils.escapeHtml(c.email || '—') + '</td>' +
        '<td class="num' + (bal < 0 ? ' amount--negative' : '') + '">' + window.utils.formatAmount(bal) + '</td>' +
        '<td>' + window.utils.statusBadge(c.is_active ? 'active' : 'inactive') + '</td>' +
        '<td><div class="row-actions">' +
        '<button class="row-action-btn" data-act="view" data-id="' + c.id + '" aria-label="عرض الملف">' + window.utils.iconSvg('eye') + '</button>' +
        '<button class="row-action-btn" data-act="edit" data-id="' + c.id + '" aria-label="تعديل">' + window.utils.iconSvg('edit') + '</button>' +
        '<button class="row-action-btn row-action-btn--danger" data-act="delete" data-id="' + c.id + '" aria-label="حذف">' + window.utils.iconSvg('trash') + '</button>' +
        '</div></td></tr>';
    });

    html += '</tbody></table></div>';
    box.innerHTML = html;

    document.getElementById('countLabel').textContent = 'إجمالي العملاء: ' + list.length;
    window.utils.renderPagination(document.getElementById('pagination'), state.page, pageCount, function (p) {
      state.page = p;
      renderTable();
    });

    box.querySelectorAll('[data-act]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var c = state.customers.find(function (x) { return String(x.id) === String(btn.dataset.id); });
        if (!c) return;
        if (btn.dataset.act === 'view') viewProfile(c);
        else if (btn.dataset.act === 'edit') openForm(c);
        else if (btn.dataset.act === 'delete') deleteCustomer(c);
      });
    });
  }

  function openForm(c) {
    state.editingId = c ? c.id : null;
    var form = document.getElementById('customerForm');
    form.reset();
    window.utils.clearValidation(form);
    document.getElementById('customerModalTitle').textContent = c ? 'تعديل العميل' : 'عميل جديد';
    if (c) {
      document.getElementById('custName').value = c.name || '';
      document.getElementById('custPhone').value = c.phone || '';
      document.getElementById('custEmail').value = c.email || '';
      document.getElementById('custTax').value = c.tax_number || '';
      document.getElementById('custAddress').value = c.address || '';
      document.getElementById('custActive').checked = c.is_active !== false;
    }
    window.utils.openModal('customerModal');
  }

  function saveCustomer(e) {
    e.preventDefault();
    var form = e.target;
    if (!window.utils.validateForm(form)) return;

    var btn = document.getElementById('saveCustomerBtn');
    window.utils.setButtonLoading(btn, true, 'جاري الحفظ...');

    var payload = {
      name: document.getElementById('custName').value.trim(),
      phone: document.getElementById('custPhone').value.trim() || null,
      email: document.getElementById('custEmail').value.trim() || null,
      tax_number: document.getElementById('custTax').value.trim() || null,
      address: document.getElementById('custAddress').value.trim() || null,
      is_active: document.getElementById('custActive').checked
    };

    var op = state.editingId
      ? window.db.updateRow('customers', state.editingId, payload)
      : window.db.insertRow('customers', payload);

    op.then(function (res) {
      window.utils.setButtonLoading(btn, false);
      if (res.error) {
        window.utils.toast(window.utils.isNotConfigured(res.error)
          ? 'لم يتم إعداد الاتصال بقاعدة البيانات بعد.'
          : 'تعذر حفظ البيانات', 'error');
        return;
      }
      window.utils.closeModal('customerModal');
      window.utils.toast('تم حفظ البيانات بنجاح', 'success');
      loadCustomers();
    }).catch(function () {
      window.utils.setButtonLoading(btn, false);
      window.utils.toast('تعذر حفظ البيانات', 'error');
    });
  }

  function viewProfile(c) {
    var body = document.getElementById('profileBody');
    window.utils.openModal('profileModal');
    body.innerHTML = window.utils.loadingHtml();

    var invoicesP = window.db.fetchRows('invoices', {
      select: 'id,invoice_number,issue_date,due_date,total,status',
      filters: [{ col: 'customer_id', op: 'eq', val: c.id }],
      order: { col: 'issue_date', ascending: false }
    });
    var paymentsP = window.db.fetchRows('payments', {
      select: 'id,payment_date,amount,method,reference',
      filters: [{ col: 'party_id', op: 'eq', val: c.id }, { col: 'party_type', op: 'eq', val: 'customer' }],
      order: { col: 'payment_date', ascending: false }
    });

    Promise.all([invoicesP, paymentsP]).then(function (results) {
      var invRes = results[0], payRes = results[1];
      if (invRes.error && window.utils.isNotConfigured(invRes.error)) {
        body.innerHTML = window.utils.errorToState(invRes.error);
        return;
      }

      var invoices = (invRes && invRes.data) || [];
      var payments = (payRes && payRes.data) || [];

      var html = '<dl class="dl mb-6">' +
        '<dt>الاسم</dt><dd>' + window.utils.escapeHtml(c.name || '—') + '</dd>' +
        '<dt>الهاتف</dt><dd class="num">' + window.utils.escapeHtml(c.phone || '—') + '</dd>' +
        '<dt>البريد الإلكتروني</dt><dd class="num">' + window.utils.escapeHtml(c.email || '—') + '</dd>' +
        '<dt>الرقم الضريبي</dt><dd class="num">' + window.utils.escapeHtml(c.tax_number || '—') + '</dd>' +
        '<dt>العنوان</dt><dd>' + window.utils.escapeHtml(c.address || '—') + '</dd>' +
        '<dt>الرصيد الحالي</dt><dd class="num fw-bold">' + window.utils.formatAmount(c.balance) + '</dd>' +
        '</dl>';

      html += '<h3 class="fs-lg mb-3">سجل الفواتير</h3>';
      if (invoices.length) {
        html += '<div class="table-wrapper mb-6"><table class="table table--compact">' +
          '<thead><tr><th>رقم الفاتورة</th><th>التاريخ</th><th>الاستحقاق</th><th class="num">الإجمالي</th><th>الحالة</th></tr></thead><tbody>';
        invoices.forEach(function (inv) {
          html += '<tr><td class="num">' + window.utils.escapeHtml(inv.invoice_number || '—') + '</td>' +
            '<td class="num">' + window.utils.formatDate(inv.issue_date) + '</td>' +
            '<td class="num">' + window.utils.formatDate(inv.due_date) + '</td>' +
            '<td class="num">' + window.utils.formatAmount(inv.total) + '</td>' +
            '<td>' + window.utils.statusBadge(inv.status) + '</td></tr>';
        });
        html += '</tbody></table></div>';
      } else {
        html += '<div class="alert alert--info mb-6">لا توجد فواتير مسجلة لهذا العميل.</div>';
      }

      html += '<h3 class="fs-lg mb-3">سجل المدفوعات</h3>';
      if (payments.length) {
        html += '<div class="table-wrapper"><table class="table table--compact">' +
          '<thead><tr><th>التاريخ</th><th class="num">المبلغ</th><th>طريقة الدفع</th><th>المرجع</th></tr></thead><tbody>';
        payments.forEach(function (p) {
          html += '<tr><td class="num">' + window.utils.formatDate(p.payment_date) + '</td>' +
            '<td class="num">' + window.utils.formatAmount(p.amount) + '</td>' +
            '<td>' + window.utils.escapeHtml(p.method || '—') + '</td>' +
            '<td class="num">' + window.utils.escapeHtml(p.reference || '—') + '</td></tr>';
        });
        html += '</tbody></table></div>';
      } else {
        html += '<div class="alert alert--info">لا توجد مدفوعات مسجلة لهذا العميل.</div>';
      }

      body.innerHTML = html;
    });
  }

  function deleteCustomer(c) {
    window.utils.confirmDialog('هل أنت متأكد من حذف هذا العميل؟ لا يمكن التراجع عن هذه العملية.').then(function (ok) {
      if (!ok) return;
      window.db.deleteRow('customers', c.id).then(function (res) {
        if (res.error) { window.utils.toast('تعذر حذف العميل', 'error'); return; }
        window.utils.toast('تم حذف العميل بنجاح', 'success');
        loadCustomers();
      }).catch(function () { window.utils.toast('تعذر حذف العميل', 'error'); });
    });
  }

  function bindRetry(id, fn) {
    var b = document.getElementById(id);
    if (b) b.addEventListener('click', fn);
  }
})();
