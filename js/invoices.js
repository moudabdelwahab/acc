/* ============================================================
   invoices.js — Invoice management: list with status filter,
   create/edit with line items, totals computed client-side.
   Tables: invoices, invoice_items, customers. No fake invoices.
   ============================================================ */

(function () {
  'use strict';

  var state = { invoices: [], customers: [], search: '', status: '', page: 1, perPage: 12, editingId: null };

  document.addEventListener('DOMContentLoaded', function () {
    window.layout.render('invoices');
    var main = window.layout.mainEl();

    main.innerHTML =
      '<nav class="breadcrumbs" aria-label="مسار التنقل">' +
      '  <a href="../dashboard.html">لوحة التحكم</a>' +
      '  <span class="breadcrumbs__sep">/</span>' +
      '  <span aria-current="page">الفواتير</span>' +
      '</nav>' +
      '<div class="page-header">' +
      '  <div>' +
      '    <h1 class="page-header__title">الفواتير</h1>' +
      '    <p class="page-header__subtitle">إصدار ومتابعة فواتير المبيعات</p>' +
      '  </div>' +
      '  <div class="page-header__actions">' +
      '    <button class="btn btn--primary" id="addInvoiceBtn">' + window.utils.iconSvg('plus') + ' فاتورة جديدة</button>' +
      '  </div>' +
      '</div>' +
      '<div class="toolbar">' +
      '  <div class="toolbar__search">' +
      '    <span class="toolbar__search-icon">' + window.utils.iconSvg('search') + '</span>' +
      '    <input class="input" type="search" id="searchInput" placeholder="بحث برقم الفاتورة أو العميل..." aria-label="بحث في الفواتير">' +
      '  </div>' +
      '  <select class="input" id="statusFilter" aria-label="تصفية حسب الحالة">' +
      '    <option value="">كل الحالات</option>' +
      '    <option value="draft">مسودة</option>' +
      '    <option value="sent">مُرسلة</option>' +
      '    <option value="paid">مدفوعة</option>' +
      '    <option value="partially_paid">مدفوعة جزئياً</option>' +
      '    <option value="overdue">متأخرة</option>' +
      '    <option value="cancelled">ملغاة</option>' +
      '  </select>' +
      '</div>' +
      '<div class="card">' +
      '  <div class="card__body card__body--flush" id="invoicesTable">' + window.utils.loadingHtml() + '</div>' +
      '  <div class="card__footer">' +
      '    <span class="text-secondary fs-sm" id="countLabel"></span>' +
      '    <div class="pagination" id="pagination"></div>' +
      '  </div>' +
      '</div>' +

      /* Create/Edit modal */
      '<div class="modal-backdrop" id="invoiceModal">' +
      '  <div class="modal modal--lg" role="dialog" aria-modal="true" aria-labelledby="invoiceModalTitle">' +
      '    <div class="modal__header">' +
      '      <h3 class="modal__title" id="invoiceModalTitle">فاتورة جديدة</h3>' +
      '      <button class="modal__close" data-close-modal aria-label="إغلاق">' + window.utils.iconSvg('close') + '</button>' +
      '    </div>' +
      '    <form id="invoiceForm" novalidate>' +
      '      <div class="modal__body">' +
      '        <div class="form-grid mb-4">' +
      '          <div class="form-field">' +
      '            <label class="form-field__label" for="invNumber">رقم الفاتورة <span class="form-field__required">*</span></label>' +
      '            <input class="input input--num" id="invNumber" required placeholder="INV-0001">' +
      '            <span class="form-field__error">رقم الفاتورة مطلوب</span>' +
      '          </div>' +
      '          <div class="form-field">' +
      '            <label class="form-field__label" for="invCustomer">العميل <span class="form-field__required">*</span></label>' +
      '            <select class="input" id="invCustomer" required><option value="">اختر العميل...</option></select>' +
      '            <span class="form-field__error">العميل مطلوب</span>' +
      '          </div>' +
      '          <div class="form-field">' +
      '            <label class="form-field__label" for="invIssueDate">تاريخ الإصدار <span class="form-field__required">*</span></label>' +
      '            <input class="input" type="date" id="invIssueDate" required>' +
      '            <span class="form-field__error">تاريخ الإصدار مطلوب</span>' +
      '          </div>' +
      '          <div class="form-field">' +
      '            <label class="form-field__label" for="invDueDate">تاريخ الاستحقاق</label>' +
      '            <input class="input" type="date" id="invDueDate">' +
      '          </div>' +
      '        </div>' +

      '        <h3 class="fs-lg mb-3">بنود الفاتورة</h3>' +
      '        <div class="table-wrapper mb-3">' +
      '          <table class="table table--compact">' +
      '            <thead><tr>' +
      '              <th style="min-width:200px;">الوصف</th>' +
      '              <th class="num" style="min-width:90px;">الكمية</th>' +
      '              <th class="num" style="min-width:110px;">سعر الوحدة</th>' +
      '              <th class="num" style="min-width:110px;">الإجمالي</th>' +
      '              <th style="width:44px;"></th>' +
      '            </tr></thead>' +
      '            <tbody id="itemsBody"></tbody>' +
      '          </table>' +
      '        </div>' +
      '        <button type="button" class="btn btn--secondary btn--sm" id="addItemBtn">' + window.utils.iconSvg('plus') + ' إضافة بند</button>' +

      '        <div class="card mt-4" style="background: var(--surface);">' +
      '          <div class="card__body d-flex gap-6 flex-wrap" style="justify-content: space-between;">' +
      '            <div><div class="text-secondary fs-sm">الإجمالي الفرعي</div><div class="fw-bold fs-lg num" id="subTotal">0.00</div></div>' +
      '            <div>' +
      '              <div class="text-secondary fs-sm">الضريبة %</div>' +
      '              <input class="input input--num" type="number" id="taxRate" min="0" max="100" step="0.01" value="0" style="width:100px; height:32px;">' +
      '            </div>' +
      '            <div><div class="text-secondary fs-sm">قيمة الضريبة</div><div class="fw-bold fs-lg num" id="taxAmount">0.00</div></div>' +
      '            <div><div class="text-secondary fs-sm">الإجمالي المستحق</div><div class="fw-bold fs-lg num" id="grandTotal" style="color:var(--primary-darker);">0.00</div></div>' +
      '          </div>' +
      '        </div>' +
      '      </div>' +
      '      <div class="modal__footer">' +
      '        <button type="button" class="btn btn--secondary" data-close-modal>إلغاء</button>' +
      '        <button type="submit" class="btn btn--secondary" id="saveDraftBtn">حفظ كمسودة</button>' +
      '        <button type="submit" class="btn btn--primary" id="saveInvoiceBtn" data-status="sent">حفظ وإرسال</button>' +
      '      </div>' +
      '    </form>' +
      '  </div>' +
      '</div>' +

      /* View modal */
      '<div class="modal-backdrop" id="viewInvoiceModal">' +
      '  <div class="modal modal--lg" role="dialog" aria-modal="true" aria-labelledby="viewInvoiceTitle">' +
      '    <div class="modal__header">' +
      '      <h3 class="modal__title" id="viewInvoiceTitle">تفاصيل الفاتورة</h3>' +
      '      <button class="modal__close" data-close-modal aria-label="إغلاق">' + window.utils.iconSvg('close') + '</button>' +
      '    </div>' +
      '    <div class="modal__body" id="viewInvoiceBody"></div>' +
      '    <div class="modal__footer">' +
      '      <button type="button" class="btn btn--secondary" data-close-modal>إغلاق</button>' +
      '      <button type="button" class="btn btn--secondary" id="printInvoiceBtn">طباعة</button>' +
      '    </div>' +
      '  </div>' +
      '</div>';

    window.utils.wireModals();
    bindEvents();
    loadCustomers().then(loadInvoices);
  });

  function bindEvents() {
    var saveStatus = 'sent';
    document.getElementById('addInvoiceBtn').addEventListener('click', function () { openForm(null); });
    document.getElementById('addItemBtn').addEventListener('click', function () { addItemRow(); });
    document.getElementById('searchInput').addEventListener('input', function (e) {
      state.search = e.target.value.trim();
      state.page = 1;
      renderTable();
    });
    document.getElementById('statusFilter').addEventListener('change', function (e) {
      state.status = e.target.value;
      state.page = 1;
      renderTable();
    });
    document.getElementById('itemsBody').addEventListener('input', recalcTotals);
    document.getElementById('itemsBody').addEventListener('click', function (e) {
      var btn = e.target.closest('[data-remove-item]');
      if (btn) { btn.closest('tr').remove(); recalcTotals(); }
    });
    document.getElementById('taxRate').addEventListener('input', recalcTotals);
    document.getElementById('printInvoiceBtn').addEventListener('click', function () { window.print(); });

    document.getElementById('saveDraftBtn').addEventListener('click', function () { saveStatus = 'draft'; });
    document.getElementById('saveInvoiceBtn').addEventListener('click', function () { saveStatus = 'sent'; });
    document.getElementById('invoiceForm').addEventListener('submit', function (e) { saveInvoice(e, saveStatus); });
  }

  /* ---------- Data ---------- */

  function loadCustomers() {
    return window.db.fetchRows('customers', {
      select: 'id,name',
      filters: [{ col: 'is_active', op: 'eq', val: true }],
      order: { col: 'name', ascending: true }
    }).then(function (res) {
      state.customers = (res && res.data) || [];
      var sel = document.getElementById('invCustomer');
      sel.innerHTML = '<option value="">اختر العميل...</option>' + state.customers.map(function (c) {
        return '<option value="' + c.id + '">' + window.utils.escapeHtml(c.name) + '</option>';
      }).join('');
    });
  }

  function loadInvoices() {
    var box = document.getElementById('invoicesTable');
    box.innerHTML = window.utils.loadingHtml();

    window.db.fetchRows('invoices', {
      select: 'id,invoice_number,customer_id,issue_date,due_date,subtotal,tax_amount,total,status,invoice_items(id,description,quantity,unit_price)',
      order: { col: 'issue_date', ascending: false }
    }).then(function (res) {
      if (res.error) {
        box.innerHTML = window.utils.errorToState(res.error, 'retryInvoices');
        bindRetry('retryInvoices', loadInvoices);
        return;
      }
      state.invoices = res.data || [];
      renderTable();
    }).catch(function () {
      box.innerHTML = window.utils.errorStateHtml({ retryId: 'retryInvoices' });
      bindRetry('retryInvoices', loadInvoices);
    });
  }

  function customerName(id) {
    var c = state.customers.find(function (x) { return String(x.id) === String(id); });
    return c ? c.name : '—';
  }

  function filtered() {
    return state.invoices.filter(function (inv) {
      if (state.status && inv.status !== state.status) return false;
      if (state.search) {
        var q = state.search.toLowerCase();
        if ((inv.invoice_number || '').toLowerCase().indexOf(q) === -1 &&
            customerName(inv.customer_id).toLowerCase().indexOf(q) === -1) return false;
      }
      return true;
    });
  }

  function renderTable() {
    var box = document.getElementById('invoicesTable');
    var list = filtered();

    if (!state.invoices.length) {
      box.innerHTML = window.utils.emptyStateHtml({
        icon: 'document',
        title: 'لا توجد فواتير حتى الآن',
        text: 'لم يتم إصدار أي فواتير بعد. أنشئ أول فاتورة لبدء متابعة المبيعات.',
        actionLabel: 'إنشاء فاتورة جديدة',
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
      '<thead><tr><th>رقم الفاتورة</th><th>العميل</th><th>تاريخ الإصدار</th><th>تاريخ الاستحقاق</th>' +
      '<th class="num">الإجمالي</th><th>الحالة</th><th></th></tr></thead><tbody>';

    pageRows.forEach(function (inv) {
      html += '<tr>' +
        '<td class="num fw-semibold">' + window.utils.escapeHtml(inv.invoice_number || '—') + '</td>' +
        '<td>' + window.utils.escapeHtml(customerName(inv.customer_id)) + '</td>' +
        '<td class="num">' + window.utils.formatDate(inv.issue_date) + '</td>' +
        '<td class="num">' + window.utils.formatDate(inv.due_date) + '</td>' +
        '<td class="num fw-semibold">' + window.utils.formatAmount(inv.total) + '</td>' +
        '<td>' + window.utils.statusBadge(inv.status || 'draft') + '</td>' +
        '<td><div class="row-actions">' +
        '<button class="row-action-btn" data-act="view" data-id="' + inv.id + '" aria-label="عرض">' + window.utils.iconSvg('eye') + '</button>' +
        '<button class="row-action-btn" data-act="edit" data-id="' + inv.id + '" aria-label="تعديل">' + window.utils.iconSvg('edit') + '</button>' +
        '<button class="row-action-btn row-action-btn--danger" data-act="delete" data-id="' + inv.id + '" aria-label="حذف">' + window.utils.iconSvg('trash') + '</button>' +
        '</div></td></tr>';
    });

    html += '</tbody></table></div>';
    box.innerHTML = html;

    document.getElementById('countLabel').textContent = 'إجمالي الفواتير: ' + list.length;
    window.utils.renderPagination(document.getElementById('pagination'), state.page, pageCount, function (p) {
      state.page = p;
      renderTable();
    });

    box.querySelectorAll('[data-act]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var inv = state.invoices.find(function (x) { return String(x.id) === String(btn.dataset.id); });
        if (!inv) return;
        if (btn.dataset.act === 'view') viewInvoice(inv);
        else if (btn.dataset.act === 'edit') openForm(inv);
        else if (btn.dataset.act === 'delete') deleteInvoice(inv);
      });
    });
  }

  /* ---------- Editor ---------- */

  function addItemRow(item) {
    item = item || {};
    var tbody = document.getElementById('itemsBody');
    var tr = document.createElement('tr');
    tr.innerHTML =
      '<td><input class="input item-desc" required value="' + window.utils.escapeHtml(item.description || '') + '" placeholder="وصف البند"></td>' +
      '<td><input class="input input--num item-qty" type="number" min="0" step="0.01" value="' + (item.quantity || '') + '" placeholder="1"></td>' +
      '<td><input class="input input--num item-price" type="number" min="0" step="0.01" value="' + (item.unit_price || '') + '" placeholder="0.00"></td>' +
      '<td class="num item-total">0.00</td>' +
      '<td><button type="button" class="row-action-btn row-action-btn--danger" data-remove-item aria-label="حذف البند">' + window.utils.iconSvg('trash') + '</button></td>';
    tbody.appendChild(tr);
  }

  function recalcTotals() {
    var sub = 0;
    document.querySelectorAll('#itemsBody tr').forEach(function (tr) {
      var qty = Number(tr.querySelector('.item-qty').value) || 0;
      var price = Number(tr.querySelector('.item-price').value) || 0;
      var line = qty * price;
      sub += line;
      tr.querySelector('.item-total').textContent = window.utils.formatAmount(line);
    });
    var rate = Number(document.getElementById('taxRate').value) || 0;
    var tax = Math.round(sub * rate) / 100;
    document.getElementById('subTotal').textContent = window.utils.formatAmount(sub);
    document.getElementById('taxAmount').textContent = window.utils.formatAmount(tax);
    document.getElementById('grandTotal').textContent = window.utils.formatAmount(sub + tax);
  }

  function openForm(inv) {
    state.editingId = inv ? inv.id : null;
    var form = document.getElementById('invoiceForm');
    form.reset();
    window.utils.clearValidation(form);
    document.getElementById('invoiceModalTitle').textContent = inv ? 'تعديل الفاتورة' : 'فاتورة جديدة';
    document.getElementById('invIssueDate').value = window.utils.todayISO();
    document.getElementById('itemsBody').innerHTML = '';

    if (inv) {
      document.getElementById('invNumber').value = inv.invoice_number || '';
      document.getElementById('invCustomer').value = inv.customer_id || '';
      document.getElementById('invIssueDate').value = inv.issue_date || '';
      document.getElementById('invDueDate').value = inv.due_date || '';
      document.getElementById('taxRate').value = (inv.subtotal && inv.tax_amount)
        ? Math.round((Number(inv.tax_amount) / Number(inv.subtotal)) * 10000) / 100 : 0;
      (inv.invoice_items || []).forEach(function (it) { addItemRow(it); });
    } else {
      addItemRow();
    }
    recalcTotals();
    window.utils.openModal('invoiceModal');
  }

  function saveInvoice(e, status) {
    e.preventDefault();
    var form = e.target;
    if (!window.utils.validateForm(form)) return;

    var items = [];
    var valid = true;
    document.querySelectorAll('#itemsBody tr').forEach(function (tr) {
      var desc = tr.querySelector('.item-desc').value.trim();
      var qty = Number(tr.querySelector('.item-qty').value) || 0;
      var price = Number(tr.querySelector('.item-price').value) || 0;
      if (!desc || qty <= 0 || price < 0) valid = false;
      items.push({ description: desc, quantity: qty, unit_price: price });
    });

    if (!valid || !items.length) {
      window.utils.toast('يرجى إكمال بنود الفاتورة: الوصف والكمية والسعر.', 'error');
      return;
    }

    var sub = items.reduce(function (s, it) { return s + it.quantity * it.unit_price; }, 0);
    var rate = Number(document.getElementById('taxRate').value) || 0;
    var tax = Math.round(sub * rate) / 100;

    var payload = {
      invoice_number: document.getElementById('invNumber').value.trim(),
      customer_id: document.getElementById('invCustomer').value,
      issue_date: document.getElementById('invIssueDate').value,
      due_date: document.getElementById('invDueDate').value || null,
      subtotal: sub,
      tax_amount: tax,
      total: sub + tax,
      status: status || 'draft'
    };

    var btn = document.getElementById('saveInvoiceBtn');
    window.utils.setButtonLoading(btn, true, 'جاري الحفظ...');

    var sb = window.db.getClient();
    if (!sb) {
      window.utils.setButtonLoading(btn, false);
      window.utils.toast('لم يتم إعداد الاتصال بقاعدة البيانات بعد.', 'error');
      return;
    }

    var done = function (ok) {
      window.utils.setButtonLoading(btn, false);
      if (ok) {
        window.utils.closeModal('invoiceModal');
        window.utils.toast('تم حفظ البيانات بنجاح', 'success');
        loadInvoices();
      } else {
        window.utils.toast('تعذر حفظ البيانات', 'error');
      }
    };

    if (state.editingId) {
      sb.from('invoices').update(payload).eq('id', state.editingId).then(function (res) {
        if (res.error) { done(false); return; }
        sb.from('invoice_items').delete().eq('invoice_id', state.editingId).then(function () {
          var rows = items.map(function (it) { it.invoice_id = state.editingId; return it; });
          sb.from('invoice_items').insert(rows).then(function (r2) { done(!r2.error); });
        });
      }).catch(function () { done(false); });
    } else {
      sb.from('invoices').insert(payload).select().then(function (res) {
        if (res.error || !res.data || !res.data.length) { done(false); return; }
        var id = res.data[0].id;
        var rows = items.map(function (it) { it.invoice_id = id; return it; });
        sb.from('invoice_items').insert(rows).then(function (r2) { done(!r2.error); });
      }).catch(function () { done(false); });
    }
  }

  function viewInvoice(inv) {
    var items = inv.invoice_items || [];
    var rows = items.map(function (it) {
      return '<tr><td>' + window.utils.escapeHtml(it.description || '—') + '</td>' +
        '<td class="num">' + window.utils.formatAmount(it.quantity, 0) + '</td>' +
        '<td class="num">' + window.utils.formatAmount(it.unit_price) + '</td>' +
        '<td class="num">' + window.utils.formatAmount((Number(it.quantity) || 0) * (Number(it.unit_price) || 0)) + '</td></tr>';
    }).join('');

    document.getElementById('viewInvoiceBody').innerHTML =
      '<dl class="dl mb-4">' +
      '<dt>رقم الفاتورة</dt><dd class="num">' + window.utils.escapeHtml(inv.invoice_number || '—') + '</dd>' +
      '<dt>العميل</dt><dd>' + window.utils.escapeHtml(customerName(inv.customer_id)) + '</dd>' +
      '<dt>تاريخ الإصدار</dt><dd class="num">' + window.utils.formatDate(inv.issue_date) + '</dd>' +
      '<dt>تاريخ الاستحقاق</dt><dd class="num">' + window.utils.formatDate(inv.due_date) + '</dd>' +
      '<dt>الحالة</dt><dd>' + window.utils.statusBadge(inv.status || 'draft') + '</dd>' +
      '</dl>' +
      '<div class="table-wrapper"><table class="table table--compact">' +
      '<thead><tr><th>الوصف</th><th class="num">الكمية</th><th class="num">سعر الوحدة</th><th class="num">الإجمالي</th></tr></thead>' +
      '<tbody>' + (rows || '<tr><td colspan="4" class="text-muted">— لا توجد بنود —</td></tr>') + '</tbody>' +
      '<tfoot>' +
      '<tr><td colspan="3">الإجمالي الفرعي</td><td class="num">' + window.utils.formatAmount(inv.subtotal) + '</td></tr>' +
      '<tr><td colspan="3">الضريبة</td><td class="num">' + window.utils.formatAmount(inv.tax_amount) + '</td></tr>' +
      '<tr><td colspan="3">الإجمالي المستحق</td><td class="num fw-bold">' + window.utils.formatAmount(inv.total) + '</td></tr>' +
      '</tfoot></table></div>';

    window.utils.openModal('viewInvoiceModal');
  }

  function deleteInvoice(inv) {
    window.utils.confirmDialog('هل أنت متأكد من حذف هذه الفاتورة؟ سيتم حذف جميع بنودها ولا يمكن التراجع.').then(function (ok) {
      if (!ok) return;
      var sb = window.db.getClient();
      if (!sb) { window.utils.toast('لم يتم إعداد الاتصال بقاعدة البيانات بعد.', 'error'); return; }
      sb.from('invoice_items').delete().eq('invoice_id', inv.id).then(function () {
        sb.from('invoices').delete().eq('id', inv.id).then(function (res) {
          if (res.error) { window.utils.toast('تعذر حذف الفاتورة', 'error'); return; }
          window.utils.toast('تم حذف الفاتورة بنجاح', 'success');
          loadInvoices();
        });
      });
    });
  }

  function bindRetry(id, fn) {
    var b = document.getElementById(id);
    if (b) b.addEventListener('click', fn);
  }
})();
