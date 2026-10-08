/* ============================================================
   suppliers.js — Supplier list, search, profile with
   outstanding balance, purchase & payment history.
   Tables: suppliers, purchases, payments. No fabricated data.
   ============================================================ */

(function () {
  'use strict';

  var state = { suppliers: [], search: '', page: 1, perPage: 12, editingId: null };

  document.addEventListener('DOMContentLoaded', function () {
    window.layout.render('suppliers');
    var main = window.layout.mainEl();

    main.innerHTML =
      '<nav class="breadcrumbs" aria-label="مسار التنقل">' +
      '  <a href="../dashboard.html">لوحة التحكم</a>' +
      '  <span class="breadcrumbs__sep">/</span>' +
      '  <span aria-current="page">الموردون</span>' +
      '</nav>' +
      '<div class="page-header">' +
      '  <div>' +
      '    <h1 class="page-header__title">الموردون</h1>' +
      '    <p class="page-header__subtitle">إدارة بيانات الموردين والأرصدة المستحقة</p>' +
      '  </div>' +
      '  <div class="page-header__actions">' +
      '    <button class="btn btn--primary" id="addSupplierBtn">' + window.utils.iconSvg('plus') + ' مورد جديد</button>' +
      '  </div>' +
      '</div>' +
      '<div class="toolbar">' +
      '  <div class="toolbar__search">' +
      '    <span class="toolbar__search-icon">' + window.utils.iconSvg('search') + '</span>' +
      '    <input class="input" type="search" id="searchInput" placeholder="بحث بالاسم أو الهاتف أو البريد..." aria-label="بحث في الموردين">' +
      '  </div>' +
      '</div>' +
      '<div class="card">' +
      '  <div class="card__body card__body--flush" id="suppliersTable">' + window.utils.loadingHtml() + '</div>' +
      '  <div class="card__footer">' +
      '    <span class="text-secondary fs-sm" id="countLabel"></span>' +
      '    <div class="pagination" id="pagination"></div>' +
      '  </div>' +
      '</div>' +

      /* Add/Edit modal */
      '<div class="modal-backdrop" id="supplierModal">' +
      '  <div class="modal" role="dialog" aria-modal="true" aria-labelledby="supplierModalTitle">' +
      '    <div class="modal__header">' +
      '      <h3 class="modal__title" id="supplierModalTitle">مورد جديد</h3>' +
      '      <button class="modal__close" data-close-modal aria-label="إغلاق">' + window.utils.iconSvg('close') + '</button>' +
      '    </div>' +
      '    <form id="supplierForm" novalidate>' +
      '      <div class="modal__body">' +
      '        <div class="form-grid">' +
      '          <div class="form-field">' +
      '            <label class="form-field__label" for="supName">اسم المورد <span class="form-field__required">*</span></label>' +
      '            <input class="input" id="supName" required>' +
      '            <span class="form-field__error">اسم المورد مطلوب</span>' +
      '          </div>' +
      '          <div class="form-field">' +
      '            <label class="form-field__label" for="supPhone">رقم الهاتف</label>' +
      '            <input class="input" type="tel" id="supPhone" style="direction:ltr; text-align:end;">' +
      '          </div>' +
      '          <div class="form-field">' +
      '            <label class="form-field__label" for="supEmail">البريد الإلكتروني</label>' +
      '            <input class="input" type="email" id="supEmail" style="direction:ltr; text-align:end;">' +
      '          </div>' +
      '          <div class="form-field">' +
      '            <label class="form-field__label" for="supTax">الرقم الضريبي</label>' +
      '            <input class="input input--num" id="supTax">' +
      '          </div>' +
      '          <div class="form-field form-grid__full">' +
      '            <label class="form-field__label" for="supAddress">العنوان</label>' +
      '            <textarea class="input" id="supAddress" rows="2"></textarea>' +
      '          </div>' +
      '          <div class="form-field form-grid__full">' +
      '            <label class="checkbox-field"><input type="checkbox" id="supActive" checked><span>مورد نشط</span></label>' +
      '          </div>' +
      '        </div>' +
      '      </div>' +
      '      <div class="modal__footer">' +
      '        <button type="button" class="btn btn--secondary" data-close-modal>إلغاء</button>' +
      '        <button type="submit" class="btn btn--primary" id="saveSupplierBtn">حفظ المورد</button>' +
      '      </div>' +
      '    </form>' +
      '  </div>' +
      '</div>' +

      /* Profile modal */
      '<div class="modal-backdrop" id="profileModal">' +
      '  <div class="modal modal--lg" role="dialog" aria-modal="true" aria-labelledby="profileTitle">' +
      '    <div class="modal__header">' +
      '      <h3 class="modal__title" id="profileTitle">ملف المورد</h3>' +
      '      <button class="modal__close" data-close-modal aria-label="إغلاق">' + window.utils.iconSvg('close') + '</button>' +
      '    </div>' +
      '    <div class="modal__body" id="profileBody">' + window.utils.loadingHtml() + '</div>' +
      '    <div class="modal__footer">' +
      '      <button type="button" class="btn btn--secondary" data-close-modal>إغلاق</button>' +
      '    </div>' +
      '  </div>' +
      '</div>';

    window.utils.wireModals();
    document.getElementById('addSupplierBtn').addEventListener('click', function () { openForm(null); });
    document.getElementById('supplierForm').addEventListener('submit', saveSupplier);
    document.getElementById('searchInput').addEventListener('input', function (e) {
      state.search = e.target.value.trim();
      state.page = 1;
      renderTable();
    });

    loadSuppliers();
  });

  function loadSuppliers() {
    var box = document.getElementById('suppliersTable');
    box.innerHTML = window.utils.loadingHtml();

    window.db.fetchAll('suppliers', {
      select: 'id,name,phone,email,tax_number,address,balance,is_active',
      order: { col: 'name', ascending: true }
    }).then(function (res) {
      if (res.error) {
        box.innerHTML = window.utils.errorToState(res.error, 'retrySuppliers');
        bindRetry('retrySuppliers', loadSuppliers);
        return;
      }
      state.suppliers = res.data || [];
      renderTable();
    }).catch(function () {
      box.innerHTML = window.utils.errorStateHtml({ retryId: 'retrySuppliers' });
      bindRetry('retrySuppliers', loadSuppliers);
    });
  }

  function filtered() {
    return state.suppliers.filter(function (s) {
      if (!state.search) return true;
      var q = state.search.toLowerCase();
      return (s.name || '').toLowerCase().indexOf(q) !== -1 ||
             (s.phone || '').toLowerCase().indexOf(q) !== -1 ||
             (s.email || '').toLowerCase().indexOf(q) !== -1;
    });
  }

  function renderTable() {
    var box = document.getElementById('suppliersTable');
    var list = filtered();

    if (!state.suppliers.length) {
      box.innerHTML = window.utils.emptyStateHtml({
        icon: 'users',
        title: 'لا يوجد موردون حتى الآن',
        text: 'أضف أول مورد لبدء تسجيل المشتريات ومتابعة المستحقات.',
        actionLabel: 'إضافة مورد جديد',
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
      '<th class="num">الرصيد المستحق</th><th>الحالة</th><th></th></tr></thead><tbody>';

    pageRows.forEach(function (s) {
      var bal = Number(s.balance) || 0;
      html += '<tr>' +
        '<td class="fw-semibold">' + window.utils.escapeHtml(s.name || '—') + '</td>' +
        '<td class="num">' + window.utils.escapeHtml(s.phone || '—') + '</td>' +
        '<td class="num">' + window.utils.escapeHtml(s.email || '—') + '</td>' +
        '<td class="num' + (bal < 0 ? ' amount--negative' : '') + '">' + window.utils.formatAmount(bal) + '</td>' +
        '<td>' + window.utils.statusBadge(s.is_active ? 'active' : 'inactive') + '</td>' +
        '<td><div class="row-actions">' +
        '<button class="row-action-btn" data-act="view" data-id="' + s.id + '" aria-label="عرض الملف">' + window.utils.iconSvg('eye') + '</button>' +
        '<button class="row-action-btn" data-act="edit" data-id="' + s.id + '" aria-label="تعديل">' + window.utils.iconSvg('edit') + '</button>' +
        '<button class="row-action-btn row-action-btn--danger" data-act="delete" data-id="' + s.id + '" aria-label="حذف">' + window.utils.iconSvg('trash') + '</button>' +
        '</div></td></tr>';
    });

    html += '</tbody></table></div>';
    box.innerHTML = html;

    document.getElementById('countLabel').textContent = 'إجمالي الموردين: ' + list.length;
    window.utils.renderPagination(document.getElementById('pagination'), state.page, pageCount, function (p) {
      state.page = p;
      renderTable();
    });

    box.querySelectorAll('[data-act]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var s = state.suppliers.find(function (x) { return String(x.id) === String(btn.dataset.id); });
        if (!s) return;
        if (btn.dataset.act === 'view') viewProfile(s);
        else if (btn.dataset.act === 'edit') openForm(s);
        else if (btn.dataset.act === 'delete') deleteSupplier(s);
      });
    });
  }

  function openForm(s) {
    state.editingId = s ? s.id : null;
    var form = document.getElementById('supplierForm');
    form.reset();
    window.utils.clearValidation(form);
    document.getElementById('supplierModalTitle').textContent = s ? 'تعديل المورد' : 'مورد جديد';
    if (s) {
      document.getElementById('supName').value = s.name || '';
      document.getElementById('supPhone').value = s.phone || '';
      document.getElementById('supEmail').value = s.email || '';
      document.getElementById('supTax').value = s.tax_number || '';
      document.getElementById('supAddress').value = s.address || '';
      document.getElementById('supActive').checked = s.is_active !== false;
    }
    window.utils.openModal('supplierModal');
  }

  function saveSupplier(e) {
    e.preventDefault();
    var form = e.target;
    if (!window.utils.validateForm(form)) return;

    var btn = document.getElementById('saveSupplierBtn');
    window.utils.setButtonLoading(btn, true, 'جاري الحفظ...');

    var payload = {
      name: document.getElementById('supName').value.trim(),
      phone: document.getElementById('supPhone').value.trim() || null,
      email: document.getElementById('supEmail').value.trim() || null,
      tax_number: document.getElementById('supTax').value.trim() || null,
      address: document.getElementById('supAddress').value.trim() || null,
      is_active: document.getElementById('supActive').checked
    };

    var op = state.editingId
      ? window.db.updateRow('suppliers', state.editingId, payload)
      : window.db.insertRow('suppliers', payload);

    op.then(function (res) {
      window.utils.setButtonLoading(btn, false);
      if (res.error) {
        window.utils.toast(window.utils.isNotConfigured(res.error)
          ? 'لم يتم إعداد الاتصال بقاعدة البيانات بعد.'
          : 'تعذر حفظ البيانات', 'error');
        return;
      }
      window.utils.closeModal('supplierModal');
      window.utils.toast('تم حفظ البيانات بنجاح', 'success');
      loadSuppliers();
    }).catch(function () {
      window.utils.setButtonLoading(btn, false);
      window.utils.toast('تعذر حفظ البيانات', 'error');
    });
  }

  /** يعيد فتح ملف المورد بأحدث بياناته (الرصيد يتغيّر بعد كل مستند). */
  function reloadSupplier(id) {
    window.db.fetchRows('suppliers', { filters: [{ col: 'id', op: 'eq', val: id }] }).then(function (res) {
      var fresh = res && res.data && res.data[0];
      if (fresh) viewProfile(fresh);
    });
  }

  function viewProfile(s) {
    var body = document.getElementById('profileBody');
    window.utils.openModal('profileModal');
    body.innerHTML = window.utils.loadingHtml();

    var purchasesP = window.db.fetchAll('purchases', {
      select: 'id,purchase_number,purchase_date,due_date,description,account_id,subtotal,tax_amount,total,status',
      filters: [{ col: 'supplier_id', op: 'eq', val: s.id }],
      order: { col: 'purchase_date', ascending: false }
    });
    var paymentsP = window.db.fetchAll('payments', {
      select: 'id,payment_date,amount,method,reference,purchases(purchase_number)',
      filters: [{ col: 'party_id', op: 'eq', val: s.id }, { col: 'party_type', op: 'eq', val: 'supplier' }],
      order: { col: 'payment_date', ascending: false }
    });

    Promise.all([purchasesP, paymentsP]).then(function (results) {
      var purRes = results[0], payRes = results[1];
      if (purRes.error && window.utils.isNotConfigured(purRes.error)) {
        body.innerHTML = window.utils.errorToState(purRes.error);
        return;
      }

      var purchases = (purRes && purRes.data) || [];
      var payments = (payRes && payRes.data) || [];

      var html = '<dl class="dl mb-6">' +
        '<dt>الاسم</dt><dd>' + window.utils.escapeHtml(s.name || '—') + '</dd>' +
        '<dt>الهاتف</dt><dd class="num">' + window.utils.escapeHtml(s.phone || '—') + '</dd>' +
        '<dt>البريد الإلكتروني</dt><dd class="num">' + window.utils.escapeHtml(s.email || '—') + '</dd>' +
        '<dt>الرقم الضريبي</dt><dd class="num">' + window.utils.escapeHtml(s.tax_number || '—') + '</dd>' +
        '<dt>العنوان</dt><dd>' + window.utils.escapeHtml(s.address || '—') + '</dd>' +
        '<dt>الرصيد المستحق</dt><dd class="num fw-bold">' + window.utils.formatAmount(s.balance) + '</dd>' +
        '</dl>';

      html += '<div class="flex align-center justify-between gap-2 mb-3"><h3 class="fs-lg">فواتير المشتريات</h3>' +
        '<button class="btn btn--primary btn--sm" id="addPurchaseBtn">' + window.utils.iconSvg('plus') + ' فاتورة مشتريات</button></div>';
      if (purchases.length) {
        html += '<div class="table-wrapper mb-6"><table class="table table--compact">' +
          '<thead><tr><th>رقم الشراء</th><th>التاريخ</th><th>البيان</th><th class="num">الإجمالي</th><th>الحالة</th><th></th></tr></thead><tbody>';
        purchases.forEach(function (p) {
          html += '<tr><td class="num">' + window.utils.escapeHtml(p.purchase_number || '—') + '</td>' +
            '<td class="num">' + window.utils.formatDate(p.purchase_date) + '</td>' +
            '<td>' + window.utils.escapeHtml(p.description || '—') + '</td>' +
            '<td class="num">' + window.utils.formatAmount(p.total) + '</td>' +
            '<td>' + window.utils.statusBadge(p.status) + '</td>' +
            '<td><div class="row-actions">' +
            (p.status === 'received'
              ? '<button class="row-action-btn" data-pay-purchase="' + p.id + '" aria-label="سداد" title="سداد">' + window.utils.iconSvg('check') + '</button>' : '') +
            '<button class="row-action-btn" data-edit-purchase="' + p.id + '" aria-label="تعديل">' + window.utils.iconSvg('edit') + '</button>' +
            '<button class="row-action-btn row-action-btn--danger" data-del-purchase="' + p.id + '" aria-label="حذف">' + window.utils.iconSvg('trash') + '</button>' +
            '</div></td></tr>';
        });
        html += '</tbody></table></div>';
      } else {
        html += '<div class="alert alert--info mb-6">لا توجد مشتريات مسجلة لهذا المورد.</div>';
      }

      html += '<div class="flex align-center justify-between gap-2 mb-3"><h3 class="fs-lg">سجل المدفوعات</h3>' +
        '<button class="btn btn--primary btn--sm" id="addSupplierPaymentBtn">' + window.utils.iconSvg('plus') + ' سداد للمورد</button></div>';
      if (payments.length) {
        html += '<div class="table-wrapper"><table class="table table--compact">' +
          '<thead><tr><th>التاريخ</th><th class="num">المبلغ</th><th>طريقة الدفع</th><th>فاتورة المشتريات</th><th>المرجع</th><th></th></tr></thead><tbody>';
        payments.forEach(function (p) {
          html += '<tr><td class="num">' + window.utils.formatDate(p.payment_date) + '</td>' +
            '<td class="num">' + window.utils.formatAmount(p.amount) + '</td>' +
            '<td>' + window.utils.escapeHtml(window.receipts.METHODS[p.method] || p.method || '—') + '</td>' +
            '<td class="num">' + window.utils.escapeHtml((p.purchases && p.purchases.purchase_number) || '—') + '</td>' +
            '<td class="num">' + window.utils.escapeHtml(p.reference || '—') + '</td>' +
            '<td><button class="row-action-btn row-action-btn--danger" data-del-payment="' + p.id + '" aria-label="حذف الدفع">' + window.utils.iconSvg('trash') + '</button></td></tr>';
        });
        html += '</tbody></table></div>';
      } else {
        html += '<div class="alert alert--info">لا توجد مدفوعات مسجلة لهذا المورد.</div>';
      }

      body.innerHTML = html;

      /* بعد أي مستند يتغيّر رصيد المورد وحالة فواتيره: يُعاد تحميل الملف والقائمة */
      var refresh = function () { reloadSupplier(s.id); loadSuppliers(); };
      var byId = function (id) { return purchases.filter(function (p) { return String(p.id) === String(id); })[0]; };
      document.getElementById('addPurchaseBtn').addEventListener('click', function () {
        window.purchases.open({ supplierId: s.id, supplierName: s.name, onSaved: refresh });
      });
      document.getElementById('addSupplierPaymentBtn').addEventListener('click', function () {
        window.receipts.open({ partyType: 'supplier', partyId: s.id, partyName: s.name, onSaved: refresh });
      });
      body.querySelectorAll('[data-edit-purchase]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          window.purchases.open({ supplierId: s.id, supplierName: s.name, purchase: byId(btn.dataset.editPurchase), onSaved: refresh });
        });
      });
      body.querySelectorAll('[data-del-purchase]').forEach(function (btn) {
        btn.addEventListener('click', function () { window.purchases.remove(byId(btn.dataset.delPurchase), refresh); });
      });
      body.querySelectorAll('[data-pay-purchase]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          window.receipts.open({ partyType: 'supplier', partyId: s.id, partyName: s.name, docId: btn.dataset.payPurchase, onSaved: refresh });
        });
      });
      body.querySelectorAll('[data-del-payment]').forEach(function (btn) {
        btn.addEventListener('click', function () { window.receipts.remove(btn.dataset.delPayment, refresh, 'supplier'); });
      });
    });
  }

  function deleteSupplier(s) {
    window.utils.confirmDialog('هل أنت متأكد من حذف هذا المورد؟ لا يمكن التراجع عن هذه العملية.').then(function (ok) {
      if (!ok) return;
      window.db.deleteRow('suppliers', s.id).then(function (res) {
        if (res.error) { window.utils.toast(window.utils.dbErrorMessage(res.error, 'تعذر حذف المورد — قد تكون عليه مشتريات مسجّلة'), 'error'); return; }
        window.utils.toast('تم حذف المورد بنجاح', 'success');
        loadSuppliers();
      }).catch(function () { window.utils.toast('تعذر حذف المورد', 'error'); });
    });
  }

  function bindRetry(id, fn) {
    var b = document.getElementById(id);
    if (b) b.addEventListener('click', fn);
  }
})();
