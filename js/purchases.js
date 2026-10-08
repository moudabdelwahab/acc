/* ============================================================
   purchases.js — فاتورة مشتريات من مورد (إضافة / تعديل / حذف).
   تفتحها صفحة الموردين من ملف المورد.

   الواجهة تكتب صف purchases فقط. عند «الاستلام» يُرحَّل القيد في
   قاعدة البيانات (المحفز purchase_posting): مدين الحساب المختار
   وضريبة المدخلات / دائن الموردين. رسائل الرفض (P01-P03، V05)
   تأتي بالعربية وتُعرض كما هي.
   ============================================================ */

(function () {
  'use strict';

  var ctx = null;          // { supplierId, supplierName, purchase, onSaved }
  var accounts = [];

  function ensureModal() {
    if (document.getElementById('purchaseModal')) return;
    var u = window.utils;
    var wrap = document.createElement('div');
    wrap.innerHTML =
      '<div class="modal-backdrop" id="purchaseModal">' +
      '  <div class="modal" role="dialog" aria-modal="true" aria-labelledby="purchaseModalTitle">' +
      '    <div class="modal__header">' +
      '      <h3 class="modal__title" id="purchaseModalTitle">فاتورة مشتريات</h3>' +
      '      <button class="modal__close" data-close-modal aria-label="إغلاق">' + u.iconSvg('close') + '</button>' +
      '    </div>' +
      '    <form id="purchaseForm" novalidate>' +
      '      <div class="modal__body">' +
      '        <p class="text-secondary fs-sm mb-3" id="purchaseSupplier"></p>' +
      '        <div class="form-grid">' +
      '          <div class="form-field">' +
      '            <label class="form-field__label" for="puNumber">رقم الفاتورة</label>' +
      '            <input class="input input--num" id="puNumber" placeholder="يُنشأ تلقائياً">' +
      '          </div>' +
      '          <div class="form-field">' +
      '            <label class="form-field__label" for="puDate">التاريخ <span class="form-field__required">*</span></label>' +
      '            <input class="input" type="date" id="puDate" required>' +
      '            <span class="form-field__error">التاريخ مطلوب</span>' +
      '          </div>' +
      '          <div class="form-field form-grid__full">' +
      '            <label class="form-field__label" for="puAccount">الحساب المدين <span class="form-field__required">*</span></label>' +
      '            <select class="input" id="puAccount" required></select>' +
      '            <span class="form-field__hint">ما الذي اشتريته: مصروف (إيجار، صيانة…) أو أصل (مخزون، أجهزة…).</span>' +
      '            <span class="form-field__error">اختر الحساب</span>' +
      '          </div>' +
      '          <div class="form-field form-grid__full">' +
      '            <label class="form-field__label" for="puDesc">البيان</label>' +
      '            <input class="input" id="puDesc" placeholder="وصف المشتريات">' +
      '          </div>' +
      '          <div class="form-field">' +
      '            <label class="form-field__label" for="puSubtotal">المبلغ قبل الضريبة (جنيه) <span class="form-field__required">*</span></label>' +
      '            <input class="input input--num" type="number" min="0.01" step="0.01" id="puSubtotal" required>' +
      '            <span class="form-field__error">المبلغ مطلوب</span>' +
      '          </div>' +
      '          <div class="form-field">' +
      '            <label class="form-field__label" for="puTaxRate">نسبة الضريبة %</label>' +
      '            <input class="input input--num" type="number" min="0" step="0.01" id="puTaxRate" value="0">' +
      '          </div>' +
      '          <div class="form-field">' +
      '            <label class="form-field__label" for="puDue">تاريخ الاستحقاق</label>' +
      '            <input class="input" type="date" id="puDue">' +
      '          </div>' +
      '          <div class="form-field">' +
      '            <span class="form-field__label">الإجمالي</span>' +
      '            <div class="fw-bold fs-lg num" id="puTotal">0.00</div>' +
      '            <span class="form-field__hint" id="puTaxLabel"></span>' +
      '          </div>' +
      '        </div>' +
      '      </div>' +
      '      <div class="modal__footer">' +
      '        <button type="button" class="btn btn--secondary" data-close-modal>إلغاء</button>' +
      '        <button type="submit" class="btn btn--secondary" data-status="draft" id="puDraftBtn">حفظ كمسودة</button>' +
      '        <button type="submit" class="btn btn--primary" data-status="received" id="puSaveBtn">حفظ واستلام</button>' +
      '      </div>' +
      '    </form>' +
      '  </div>' +
      '</div>';
    var modal = wrap.firstChild;
    document.body.appendChild(modal);

    modal.addEventListener('click', function (e) {
      if (e.target === modal || e.target.closest('[data-close-modal]')) modal.classList.remove('is-open');
    });
    ['puSubtotal', 'puTaxRate'].forEach(function (id) {
      document.getElementById(id).addEventListener('input', recalc);
    });
    var form = document.getElementById('purchaseForm');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var status = (e.submitter && e.submitter.dataset.status) || 'received';
      save(status, e.submitter);
    });
  }

  /* بالقروش: الإجمالي = قبل الضريبة + الضريبة بالضبط (قاعدة P01) */
  function totals() {
    var subC = Math.round((Number(document.getElementById('puSubtotal').value) || 0) * 100);
    var rate = Number(document.getElementById('puTaxRate').value) || 0;
    var taxC = Math.round(subC * rate / 100);
    return { subtotal: subC / 100, tax: taxC / 100, total: (subC + taxC) / 100 };
  }

  function recalc() {
    var t = totals();
    document.getElementById('puTotal').textContent = window.utils.formatAmount(t.total);
    document.getElementById('puTaxLabel').textContent = t.tax ? 'منها ضريبة ' + window.utils.formatAmount(t.tax) : '';
  }

  /* الحسابات الصالحة مدينًا للمشتريات (قاعدة P02): مصروف أو أصل، فرعي نشط،
     ليس حساب مراقبة ولا نقدية ولا عكسيًا. */
  function loadAccounts() {
    if (accounts.length) return Promise.resolve();
    return window.db.fetchAll('accounts', {
      select: 'id,code,name,type,is_postable,is_active,is_control,is_cash_account,is_contra',
      filters: [{ col: 'type', op: 'in', val: ['expense', 'asset'] }],
      order: { col: 'code', ascending: true }
    }).then(function (res) {
      accounts = ((res && res.data) || []).filter(function (a) {
        return a.is_postable && a.is_active && !a.is_control && !a.is_cash_account && !a.is_contra;
      });
    });
  }

  /**
   * opts: { supplierId, supplierName, purchase?, onSaved? }
   */
  function open(opts) {
    ensureModal();
    ctx = opts || {};
    var p = ctx.purchase || null;

    var form = document.getElementById('purchaseForm');
    form.reset();
    window.utils.clearValidation(form);
    document.getElementById('purchaseModalTitle').textContent = p ? 'تعديل فاتورة المشتريات' : 'فاتورة مشتريات جديدة';
    document.getElementById('purchaseSupplier').textContent = 'المورد: ' + (ctx.supplierName || '—');
    document.getElementById('puDate').value = window.utils.todayISO();
    document.getElementById('puDraftBtn').style.display = p && p.status !== 'draft' ? 'none' : '';

    loadAccounts().then(function () {
      var groups = { expense: 'المصروفات', asset: 'الأصول' };
      var sel = document.getElementById('puAccount');
      sel.innerHTML = '<option value="">اختر الحساب...</option>' + ['expense', 'asset'].map(function (t) {
        return '<optgroup label="' + groups[t] + '">' + accounts.filter(function (a) { return a.type === t; }).map(function (a) {
          return '<option value="' + a.id + '">' + window.utils.escapeHtml(a.code + ' — ' + a.name) + '</option>';
        }).join('') + '</optgroup>';
      }).join('');

      if (p) {
        document.getElementById('puNumber').value = p.purchase_number || '';
        document.getElementById('puDate').value = p.purchase_date || '';
        document.getElementById('puDue').value = p.due_date || '';
        document.getElementById('puDesc').value = p.description || '';
        document.getElementById('puSubtotal').value = p.subtotal || '';
        document.getElementById('puTaxRate').value = Number(p.subtotal) && Number(p.tax_amount)
          ? Math.round(Number(p.tax_amount) / Number(p.subtotal) * 10000) / 100 : 0;
        sel.value = p.account_id || '';
      }
      recalc();
    });

    window.utils.openModal('purchaseModal');
  }

  function save(status, btn) {
    var form = document.getElementById('purchaseForm');
    if (!window.utils.validateForm(form)) return;
    var t = totals();
    if (!(t.subtotal > 0)) {
      document.getElementById('puSubtotal').closest('.form-field').classList.add('has-error');
      return;
    }

    var p = ctx.purchase || null;
    /* تعديل فاتورة مستلمة أو مدفوعة يبقيها كما هي؛ قاعدة البيانات تعيد
       حساب «مدفوعة» من مدفوعاتها. */
    var payload = {
      supplier_id: ctx.supplierId,
      purchase_date: document.getElementById('puDate').value,
      due_date: document.getElementById('puDue').value || null,
      description: document.getElementById('puDesc').value.trim() || null,
      account_id: document.getElementById('puAccount').value,
      subtotal: t.subtotal,
      tax_amount: t.tax,
      total: t.total,
      status: p && p.status !== 'draft' ? p.status : status
    };
    var number = document.getElementById('puNumber').value.trim();
    if (number) payload.purchase_number = number;

    window.utils.setButtonLoading(btn, true);
    var op = p ? window.db.updateRow('purchases', p.id, payload) : window.db.insertRow('purchases', payload);
    op.then(function (res) {
      window.utils.setButtonLoading(btn, false);
      if (res.error) {
        window.utils.toast(window.utils.dbErrorMessage(res.error, 'تعذر حفظ فاتورة المشتريات'), 'error');
        return;
      }
      window.utils.closeModal('purchaseModal');
      window.utils.toast(payload.status === 'draft' ? 'تم حفظ المسودة' : 'تم حفظ فاتورة المشتريات وترحيل قيدها', 'success');
      if (typeof ctx.onSaved === 'function') ctx.onSaved();
    }).catch(function () {
      window.utils.setButtonLoading(btn, false);
      window.utils.toast('تعذر حفظ فاتورة المشتريات', 'error');
    });
  }

  function remove(purchase, onDone) {
    window.utils.confirmDialog('حذف فاتورة المشتريات ' + (purchase.purchase_number || '') + '؟ يُعكس قيدها في الدفاتر.').then(function (ok) {
      if (!ok) return;
      window.db.deleteRow('purchases', purchase.id).then(function (res) {
        if (res.error) { window.utils.toast(window.utils.dbErrorMessage(res.error, 'تعذر الحذف'), 'error'); return; }
        window.utils.toast('تم حذف فاتورة المشتريات وعكس قيدها', 'success');
        if (typeof onDone === 'function') onDone();
      });
    });
  }

  window.purchases = { open: open, remove: remove };
})();
