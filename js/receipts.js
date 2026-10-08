/* ============================================================
   receipts.js — تسجيل مقبوض من عميل أو دفع لمورد. نافذة واحدة مشتركة
   تفتحها صفحة العملاء وصفحة الفواتير (مقبوض) وصفحة الموردين (دفع).

   الواجهة تُدرج صفاً في payments فقط. القيد (مدين النقدية / دائن
   العملاء، أو مدين الموردين / دائن النقدية) وتحويل المستند إلى «مدفوع»
   يتمّان في قاعدة البيانات بالمحفزين payment_posting و payment_settle،
   فلا يمكن أن يُسجَّل دفع بلا قيد. رسائل الرفض (R01-R04، V05) تأتي
   بالعربية وتُعرض كما هي.
   ============================================================ */

(function () {
  'use strict';

  var METHODS = {
    cash: 'نقدي',
    bank_transfer: 'تحويل بنكي',
    card: 'بطاقة',
    cheque: 'شيك',
    other: 'أخرى'
  };

  var PARTY = {
    customer: {
      title: 'تسجيل مقبوض', who: 'العميل', docLabel: 'الفاتورة', docTable: 'invoices', docField: 'invoice_id',
      partyCol: 'customer_id', numberCol: 'invoice_number', openStatuses: ['sent', 'overdue'],
      docSelect: 'id,invoice_number,total,currency,exchange_rate,status',
      hint: 'النقدي يدخل الصندوق، وباقي الطرق تدخل البنك. يُرحَّل القيد تلقائياً.',
      saved: 'تم تسجيل المقبوض وترحيل قيده', del: 'سيُحذف المقبوض ويُعكس قيده في الدفاتر. هل تريد المتابعة؟'
    },
    supplier: {
      title: 'سداد لمورد', who: 'المورد', docLabel: 'فاتورة المشتريات', docTable: 'purchases', docField: 'purchase_id',
      partyCol: 'supplier_id', numberCol: 'purchase_number', openStatuses: ['received'],
      docSelect: 'id,purchase_number,total,status',
      hint: 'النقدي يخرج من الصندوق، وباقي الطرق من البنك. يُرحَّل القيد تلقائياً.',
      saved: 'تم تسجيل الدفع وترحيل قيده', del: 'سيُحذف الدفع ويُعكس قيده في الدفاتر. هل تريد المتابعة؟'
    }
  };

  var ctx = null;          // { partyType, partyId, partyName, docId, onSaved }
  var invoices = [];       // مستندات الطرف المفتوحة مع المتبقي بالجنيه

  function ensureModal() {
    if (document.getElementById('receiptModal')) return;
    var u = window.utils;
    var wrap = document.createElement('div');
    wrap.innerHTML =
      '<div class="modal-backdrop" id="receiptModal">' +
      '  <div class="modal" role="dialog" aria-modal="true" aria-labelledby="receiptModalTitle">' +
      '    <div class="modal__header">' +
      '      <h3 class="modal__title" id="receiptModalTitle"></h3>' +
      '      <button class="modal__close" data-close-modal aria-label="إغلاق">' + u.iconSvg('close') + '</button>' +
      '    </div>' +
      '    <form id="receiptForm" novalidate>' +
      '      <div class="modal__body">' +
      '        <p class="text-secondary fs-sm mb-3" id="receiptCustomer"></p>' +
      '        <div class="form-grid">' +
      '          <div class="form-field form-grid__full">' +
      '            <label class="form-field__label" for="rcInvoice" id="rcInvoiceLabel">الفاتورة</label>' +
      '            <select class="input" id="rcInvoice"><option value="">بدون فاتورة (دفعة على الحساب)</option></select>' +
      '          </div>' +
      '          <div class="form-field">' +
      '            <label class="form-field__label" for="rcDate">التاريخ <span class="form-field__required">*</span></label>' +
      '            <input class="input" type="date" id="rcDate" required>' +
      '            <span class="form-field__error">التاريخ مطلوب</span>' +
      '          </div>' +
      '          <div class="form-field">' +
      '            <label class="form-field__label" for="rcAmount">المبلغ (جنيه) <span class="form-field__required">*</span></label>' +
      '            <input class="input input--num" type="number" id="rcAmount" min="0.01" step="0.01" required>' +
      '            <span class="form-field__error">أدخل مبلغاً أكبر من صفر</span>' +
      '          </div>' +
      '          <div class="form-field">' +
      '            <label class="form-field__label" for="rcMethod">طريقة الدفع</label>' +
      '            <select class="input" id="rcMethod">' +
      Object.keys(METHODS).map(function (k) { return '<option value="' + k + '">' + METHODS[k] + '</option>'; }).join('') +
      '            </select>' +
      '          </div>' +
      '          <div class="form-field">' +
      '            <label class="form-field__label" for="rcRef">المرجع</label>' +
      '            <input class="input input--num" id="rcRef" placeholder="رقم الإيصال أو التحويل">' +
      '          </div>' +
      '        </div>' +
      '        <p class="text-secondary fs-sm mt-3" id="rcHint"></p>' +
      '      </div>' +
      '      <div class="modal__footer">' +
      '        <button type="button" class="btn btn--secondary" data-close-modal>إلغاء</button>' +
      '        <button type="submit" class="btn btn--primary" id="saveReceiptBtn">حفظ</button>' +
      '      </div>' +
      '    </form>' +
      '  </div>' +
      '</div>';
    var modal = wrap.firstChild;
    document.body.appendChild(modal);

    modal.addEventListener('click', function (e) {
      if (e.target === modal || e.target.closest('[data-close-modal]')) modal.classList.remove('is-open');
    });
    document.getElementById('rcInvoice').addEventListener('change', function (e) {
      var inv = invoices.filter(function (i) { return i.id === e.target.value; })[0];
      if (inv) document.getElementById('rcAmount').value = inv.remaining.toFixed(2);
    });
    document.getElementById('receiptForm').addEventListener('submit', save);
  }

  /** قيمة الفاتورة بالجنيه، كما تُرحَّل في الدفاتر. */
  function dueEgp(inv) {
    if (!inv.currency || inv.currency === 'EGP') return Number(inv.total);
    if (!inv.exchange_rate) return null;
    return Math.round(Number(inv.total) * Number(inv.exchange_rate) * 100) / 100;
  }

  /**
   * opts: { partyType: 'customer'|'supplier', partyId, partyName, docId?, onSaved? }
   * (customerId / customerName / invoiceId مقبولة للتوافق)
   */
  function open(opts) {
    ensureModal();
    opts = opts || {};
    ctx = {
      partyType: opts.partyType || 'customer',
      partyId: opts.partyId || opts.customerId,
      partyName: opts.partyName || opts.customerName,
      docId: opts.docId || opts.invoiceId,
      onSaved: opts.onSaved
    };
    var cfg = PARTY[ctx.partyType];
    invoices = [];

    var form = document.getElementById('receiptForm');
    form.reset();
    window.utils.clearValidation(form);
    document.getElementById('receiptModalTitle').textContent = cfg.title;
    document.getElementById('rcInvoiceLabel').textContent = cfg.docLabel;
    document.getElementById('rcHint').textContent = cfg.hint;
    document.getElementById('rcDate').value = window.utils.todayISO();
    document.getElementById('receiptCustomer').textContent = cfg.who + ': ' + (ctx.partyName || '—');

    var sel = document.getElementById('rcInvoice');
    sel.innerHTML = '<option value="">بدون فاتورة (دفعة على الحساب)</option>';
    window.utils.openModal('receiptModal');

    var docFilters = [{ col: cfg.partyCol, op: 'eq', val: ctx.partyId }, { col: 'status', op: 'in', val: cfg.openStatuses }];
    Promise.all([
      window.db.fetchAll(cfg.docTable, { select: cfg.docSelect, filters: docFilters }),
      window.db.fetchAll('payments', {
        select: 'id,' + cfg.docField + ',amount',
        filters: [{ col: 'party_type', op: 'eq', val: ctx.partyType }, { col: 'party_id', op: 'eq', val: ctx.partyId }]
      })
    ]).then(function (res) {
      var paid = {};
      ((res[1] && res[1].data) || []).forEach(function (p) {
        var d = p[cfg.docField];
        if (d) paid[d] = (paid[d] || 0) + Number(p.amount);
      });
      invoices = ((res[0] && res[0].data) || []).map(function (doc) {
        var due = dueEgp(doc);
        return { id: doc.id, number: doc[cfg.numberCol], remaining: due === null ? null : Math.max(Math.round((due - (paid[doc.id] || 0)) * 100) / 100, 0) };
      }).filter(function (doc) { return doc.remaining !== null && doc.remaining > 0; });

      sel.innerHTML += invoices.map(function (inv) {
        return '<option value="' + inv.id + '">' + window.utils.escapeHtml(inv.number) +
          ' — متبقٍ ' + window.utils.formatAmount(inv.remaining) + '</option>';
      }).join('');

      if (ctx.docId && invoices.some(function (i) { return i.id === ctx.docId; })) {
        sel.value = ctx.docId;
        sel.dispatchEvent(new Event('change'));
      }
    });
  }

  function save(e) {
    e.preventDefault();
    var form = document.getElementById('receiptForm');
    if (!window.utils.validateForm(form)) return;

    var amount = Number(document.getElementById('rcAmount').value);
    if (!(amount > 0)) {
      document.getElementById('rcAmount').closest('.form-field').classList.add('has-error');
      return;
    }

    var btn = document.getElementById('saveReceiptBtn');
    window.utils.setButtonLoading(btn, true);

    var cfg = PARTY[ctx.partyType];
    var payload = {
      payment_date: document.getElementById('rcDate').value,
      amount: amount,
      method: document.getElementById('rcMethod').value,
      reference: document.getElementById('rcRef').value.trim() || null,
      party_type: ctx.partyType,
      party_id: ctx.partyId
    };
    payload[cfg.docField] = document.getElementById('rcInvoice').value || null;

    window.db.insertRow('payments', payload).then(function (res) {
      window.utils.setButtonLoading(btn, false);
      if (res.error) {
        window.utils.toast(dbMessage(res.error) || 'تعذر الحفظ', 'error');
        return;
      }
      window.utils.closeModal('receiptModal');
      window.utils.toast(cfg.saved, 'success');
      if (typeof ctx.onSaved === 'function') ctx.onSaved();
    }).catch(function (err) {
      window.utils.setButtonLoading(btn, false);
      window.utils.toast(dbMessage(err) || 'تعذر الحفظ', 'error');
    });
  }

  /** حذف مقبوض أو دفع: قاعدة البيانات تعكس قيده وتعيد حالة مستنده. */
  function remove(paymentId, onDone, partyType) {
    var cfg = PARTY[partyType || 'customer'];
    window.utils.confirmDialog(cfg.del).then(function (ok) {
      if (!ok) return;
      window.db.deleteRow('payments', paymentId).then(function (res) {
        if (res.error) { window.utils.toast(dbMessage(res.error) || 'تعذر الحذف', 'error'); return; }
        window.utils.toast('تم الحذف وعكس القيد', 'success');
        if (typeof onDone === 'function') onDone();
      });
    });
  }

  function dbMessage(err) {
    return window.utils.dbErrorMessage(err, '');
  }

  window.receipts = { open: open, remove: remove, METHODS: METHODS };
})();
