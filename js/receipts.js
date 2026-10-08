/* ============================================================
   receipts.js — تسجيل مقبوض من عميل. نافذة واحدة مشتركة تفتحها
   صفحة العملاء (ملف العميل) وصفحة الفواتير (زر «تسجيل مقبوض»).

   الواجهة تُدرج صفاً في payments فقط. القيد (مدين النقدية / دائن
   العملاء) وتحويل الفاتورة إلى «مدفوعة» يتمّان في قاعدة البيانات
   بالمحفزين payment_posting و payment_settle، فلا يمكن أن يُسجَّل
   مقبوض بلا قيد. رسائل الرفض (R01-R03، V05) تأتي بالعربية وتُعرض كما هي.
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

  var ctx = null;          // { customerId, onSaved }
  var invoices = [];       // فواتير العميل المفتوحة مع المتبقي بالجنيه

  function ensureModal() {
    if (document.getElementById('receiptModal')) return;
    var u = window.utils;
    var wrap = document.createElement('div');
    wrap.innerHTML =
      '<div class="modal-backdrop" id="receiptModal">' +
      '  <div class="modal" role="dialog" aria-modal="true" aria-labelledby="receiptModalTitle">' +
      '    <div class="modal__header">' +
      '      <h3 class="modal__title" id="receiptModalTitle">تسجيل مقبوض</h3>' +
      '      <button class="modal__close" data-close-modal aria-label="إغلاق">' + u.iconSvg('close') + '</button>' +
      '    </div>' +
      '    <form id="receiptForm" novalidate>' +
      '      <div class="modal__body">' +
      '        <p class="text-secondary fs-sm mb-3" id="receiptCustomer"></p>' +
      '        <div class="form-grid">' +
      '          <div class="form-field form-grid__full">' +
      '            <label class="form-field__label" for="rcInvoice">الفاتورة</label>' +
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
      '        <p class="text-secondary fs-sm mt-3">النقدي يدخل الصندوق، وباقي الطرق تدخل البنك. يُرحَّل القيد تلقائياً.</p>' +
      '      </div>' +
      '      <div class="modal__footer">' +
      '        <button type="button" class="btn btn--secondary" data-close-modal>إلغاء</button>' +
      '        <button type="submit" class="btn btn--primary" id="saveReceiptBtn">حفظ المقبوض</button>' +
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
   * opts: { customerId, customerName, invoiceId?, onSaved? }
   */
  function open(opts) {
    ensureModal();
    ctx = opts || {};
    invoices = [];

    var form = document.getElementById('receiptForm');
    form.reset();
    window.utils.clearValidation(form);
    document.getElementById('rcDate').value = window.utils.todayISO();
    document.getElementById('receiptCustomer').textContent = 'العميل: ' + (ctx.customerName || '—');

    var sel = document.getElementById('rcInvoice');
    sel.innerHTML = '<option value="">بدون فاتورة (دفعة على الحساب)</option>';
    window.utils.openModal('receiptModal');

    Promise.all([
      window.db.fetchRows('invoices', {
        select: 'id,invoice_number,total,currency,exchange_rate,status',
        filters: [{ col: 'customer_id', op: 'eq', val: ctx.customerId }, { col: 'status', op: 'in', val: ['sent', 'overdue'] }],
        order: { col: 'issue_date', ascending: true }
      }),
      window.db.fetchRows('payments', {
        select: 'invoice_id,amount',
        filters: [{ col: 'party_type', op: 'eq', val: 'customer' }, { col: 'party_id', op: 'eq', val: ctx.customerId }]
      })
    ]).then(function (res) {
      var paid = {};
      ((res[1] && res[1].data) || []).forEach(function (p) {
        if (p.invoice_id) paid[p.invoice_id] = (paid[p.invoice_id] || 0) + Number(p.amount);
      });
      invoices = ((res[0] && res[0].data) || []).map(function (inv) {
        var due = dueEgp(inv);
        return { id: inv.id, number: inv.invoice_number, remaining: due === null ? null : Math.max(due - (paid[inv.id] || 0), 0) };
      }).filter(function (inv) { return inv.remaining !== null && inv.remaining > 0; });

      sel.innerHTML += invoices.map(function (inv) {
        return '<option value="' + inv.id + '">' + window.utils.escapeHtml(inv.number) +
          ' — متبقٍ ' + window.utils.formatAmount(inv.remaining) + '</option>';
      }).join('');

      if (ctx.invoiceId && invoices.some(function (i) { return i.id === ctx.invoiceId; })) {
        sel.value = ctx.invoiceId;
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

    var payload = {
      payment_date: document.getElementById('rcDate').value,
      amount: amount,
      method: document.getElementById('rcMethod').value,
      reference: document.getElementById('rcRef').value.trim() || null,
      party_type: 'customer',
      party_id: ctx.customerId,
      invoice_id: document.getElementById('rcInvoice').value || null
    };

    window.db.insertRow('payments', payload).then(function (res) {
      window.utils.setButtonLoading(btn, false);
      if (res.error) {
        window.utils.toast(dbMessage(res.error) || 'تعذر حفظ المقبوض', 'error');
        return;
      }
      window.utils.closeModal('receiptModal');
      window.utils.toast('تم تسجيل المقبوض وترحيل قيده', 'success');
      if (typeof ctx.onSaved === 'function') ctx.onSaved();
    }).catch(function (err) {
      window.utils.setButtonLoading(btn, false);
      window.utils.toast(dbMessage(err) || 'تعذر حفظ المقبوض', 'error');
    });
  }

  /** حذف مقبوض: قاعدة البيانات تعكس قيده وتعيد حالة فاتورته. */
  function remove(paymentId, onDone) {
    window.utils.confirmDialog('سيُحذف المقبوض ويُعكس قيده في الدفاتر. هل تريد المتابعة؟').then(function (ok) {
      if (!ok) return;
      window.db.deleteRow('payments', paymentId).then(function (res) {
        if (res.error) { window.utils.toast(dbMessage(res.error) || 'تعذر حذف المقبوض', 'error'); return; }
        window.utils.toast('تم حذف المقبوض وعكس قيده', 'success');
        if (typeof onDone === 'function') onDone();
      });
    });
  }

  function dbMessage(err) {
    if (!err) return '';
    if (window.utils.isNotConfigured(err)) return 'لم يتم إعداد الاتصال بقاعدة البيانات بعد.';
    return String(err.message || err.hint || err.details || '').trim();
  }

  window.receipts = { open: open, remove: remove, METHODS: METHODS };
})();
