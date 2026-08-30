/* ============================================================
   journal.js — Journal entries list + entry editor with
   debit/credit lines and real-time balance validation.
   Tables: journal_entries, journal_entry_lines, accounts.
   ============================================================ */

(function () {
  'use strict';

  var state = { entries: [], accounts: [], page: 1, perPage: 12, search: '', editingId: null };

  document.addEventListener('DOMContentLoaded', function () {
    window.layout.render('journal');
    var main = window.layout.mainEl();

    main.innerHTML =
      '<nav class="breadcrumbs" aria-label="مسار التنقل">' +
      '  <a href="../dashboard.html">لوحة التحكم</a>' +
      '  <span class="breadcrumbs__sep">/</span>' +
      '  <span aria-current="page">القيود اليومية</span>' +
      '</nav>' +
      '<div class="page-header">' +
      '  <div>' +
      '    <h1 class="page-header__title">القيود اليومية</h1>' +
      '    <p class="page-header__subtitle">تسجيل وإدارة القيود المحاسبية</p>' +
      '  </div>' +
      '  <div class="page-header__actions">' +
      '    <button class="btn btn--primary" id="addEntryBtn">' + window.utils.iconSvg('plus') + ' قيد جديد</button>' +
      '  </div>' +
      '</div>' +
      '<div class="toolbar">' +
      '  <div class="toolbar__search">' +
      '    <span class="toolbar__search-icon">' + window.utils.iconSvg('search') + '</span>' +
      '    <input class="input" type="search" id="searchInput" placeholder="بحث برقم القيد أو البيان..." aria-label="بحث في القيود">' +
      '  </div>' +
      '</div>' +
      '<div class="card">' +
      '  <div class="card__body card__body--flush" id="entriesTable">' + window.utils.loadingHtml() + '</div>' +
      '  <div class="card__footer">' +
      '    <span class="text-secondary fs-sm" id="countLabel"></span>' +
      '    <div class="pagination" id="pagination"></div>' +
      '  </div>' +
      '</div>' +

      /* Entry editor modal */
      '<div class="modal-backdrop" id="entryModal">' +
      '  <div class="modal modal--lg" role="dialog" aria-modal="true" aria-labelledby="entryModalTitle">' +
      '    <div class="modal__header">' +
      '      <h3 class="modal__title" id="entryModalTitle">قيد يومية جديد</h3>' +
      '      <button class="modal__close" data-close-modal aria-label="إغلاق">' + window.utils.iconSvg('close') + '</button>' +
      '    </div>' +
      '    <form id="entryForm" novalidate>' +
      '      <div class="modal__body">' +
      '        <div class="form-grid mb-4">' +
      '          <div class="form-field">' +
      '            <label class="form-field__label" for="entryNumber">رقم القيد</label>' +
      '            <input class="input input--num" id="entryNumber" placeholder="يُنشأ تلقائياً">' +
      '            <span class="form-field__hint">اتركه فارغاً ليُرقَّم تلقائياً بالتسلسل.</span>' +
      '          </div>' +
      '          <div class="form-field">' +
      '            <label class="form-field__label" for="entryDate">التاريخ <span class="form-field__required">*</span></label>' +
      '            <input class="input" type="date" id="entryDate" required>' +
      '            <span class="form-field__error">التاريخ مطلوب</span>' +
      '          </div>' +
      '          <div class="form-field">' +
      '            <label class="form-field__label" for="entryRef">المرجع</label>' +
      '            <input class="input" id="entryRef" placeholder="رقم المستند المرجعي">' +
      '          </div>' +
      '          <div class="form-field">' +
      '            <label class="form-field__label" for="entryDesc">البيان <span class="form-field__required">*</span></label>' +
      '            <input class="input" id="entryDesc" required placeholder="وصف القيد">' +
      '            <span class="form-field__error">البيان مطلوب</span>' +
      '          </div>' +
      '          <div class="form-field form-grid__full">' +
      '            <label class="form-field__label" for="entryNotes">ملاحظات</label>' +
      '            <textarea class="input" id="entryNotes" rows="2"></textarea>' +
      '          </div>' +
      '        </div>' +

      '        <h3 class="fs-lg mb-3">بنود القيد</h3>' +
      '        <div class="table-wrapper mb-3">' +
      '          <table class="table table--compact" id="linesTable">' +
      '            <thead><tr>' +
      '              <th style="min-width:220px;">الحساب</th>' +
      '              <th style="min-width:130px;">البيان</th>' +
      '              <th class="num" style="min-width:110px;">مدين</th>' +
      '              <th class="num" style="min-width:110px;">دائن</th>' +
      '              <th style="width:44px;"></th>' +
      '            </tr></thead>' +
      '            <tbody id="linesBody"></tbody>' +
      '          </table>' +
      '        </div>' +
      '        <button type="button" class="btn btn--secondary btn--sm" id="addLineBtn">' + window.utils.iconSvg('plus') + ' إضافة بند</button>' +

      '        <div class="card mt-4" style="background: var(--surface);">' +
      '          <div class="card__body d-flex gap-6 flex-wrap" style="justify-content: space-between;">' +
      '            <div><div class="text-secondary fs-sm">إجمالي مدين</div><div class="fw-bold fs-lg num" id="totalDebit">0.00</div></div>' +
      '            <div><div class="text-secondary fs-sm">إجمالي دائن</div><div class="fw-bold fs-lg num" id="totalCredit">0.00</div></div>' +
      '            <div><div class="text-secondary fs-sm">الفرق</div><div class="fw-bold fs-lg num" id="totalDiff">0.00</div></div>' +
      '          </div>' +
      '        </div>' +
      '        <div class="alert alert--danger mt-3" id="balanceAlert" style="display:none;" role="alert">' +
      '          القيد غير متوازن: يجب أن يتساوى إجمالي المدين مع إجمالي الدائن قبل الحفظ.' +
      '        </div>' +
      '      </div>' +
      '      <div class="modal__footer">' +
      '        <button type="button" class="btn btn--secondary" data-close-modal>إلغاء</button>' +
      '        <button type="submit" class="btn btn--primary" id="saveEntryBtn">حفظ القيد</button>' +
      '      </div>' +
      '    </form>' +
      '  </div>' +
      '</div>' +

      /* View modal */
      '<div class="modal-backdrop" id="viewEntryModal">' +
      '  <div class="modal modal--lg" role="dialog" aria-modal="true" aria-labelledby="viewEntryTitle">' +
      '    <div class="modal__header">' +
      '      <h3 class="modal__title" id="viewEntryTitle">تفاصيل القيد</h3>' +
      '      <button class="modal__close" data-close-modal aria-label="إغلاق">' + window.utils.iconSvg('close') + '</button>' +
      '    </div>' +
      '    <div class="modal__body" id="viewEntryBody"></div>' +
      '    <div class="modal__footer">' +
      '      <button type="button" class="btn btn--secondary" data-close-modal>إغلاق</button>' +
      '    </div>' +
      '  </div>' +
      '</div>';

    window.utils.wireModals();
    bindEvents();
    loadAccounts().then(loadEntries);

    /* Support dashboard.html#new deep link */
    if (location.hash === '#new') {
      var tryOpen = function () {
        openForm();
      };
      setTimeout(tryOpen, 300);
    }
  });

  function bindEvents() {
    document.getElementById('addEntryBtn').addEventListener('click', function () { openForm(); });
    document.getElementById('addLineBtn').addEventListener('click', function () { addLineRow(); });
    document.getElementById('entryForm').addEventListener('submit', saveEntry);
    document.getElementById('searchInput').addEventListener('input', function (e) {
      state.search = e.target.value.trim();
      state.page = 1;
      renderTable();
    });
    /* Live totals recalculation */
    document.getElementById('linesBody').addEventListener('input', recalcTotals);
    document.getElementById('linesBody').addEventListener('click', function (e) {
      var btn = e.target.closest('[data-remove-line]');
      if (btn) {
        btn.closest('tr').remove();
        recalcTotals();
      }
    });
  }

  /* ---------- Data ---------- */

  function loadAccounts() {
    return window.db.fetchRows('accounts', {
      select: 'id,code,name,type',
      filters: [{ col: 'is_active', op: 'eq', val: true }],
      order: { col: 'code', ascending: true }
    }).then(function (res) {
      state.accounts = (res && res.data) || [];
    });
  }

  function loadEntries() {
    var box = document.getElementById('entriesTable');
    box.innerHTML = window.utils.loadingHtml();

    window.db.fetchRows('journal_entries', {
      select: 'id,entry_number,entry_date,description,reference,status,journal_entry_lines(id,account_id,description,debit,credit)',
      order: { col: 'entry_date', ascending: false }
    }).then(function (res) {
      if (res.error) {
        box.innerHTML = window.utils.errorToState(res.error, 'retryEntries');
        bindRetry('retryEntries', loadEntries);
        return;
      }
      state.entries = res.data || [];
      renderTable();
    }).catch(function () {
      box.innerHTML = window.utils.errorStateHtml({ retryId: 'retryEntries' });
      bindRetry('retryEntries', loadEntries);
    });
  }

  function filtered() {
    return state.entries.filter(function (en) {
      if (!state.search) return true;
      var q = state.search.toLowerCase();
      return (en.entry_number || '').toLowerCase().indexOf(q) !== -1 ||
             (en.description || '').toLowerCase().indexOf(q) !== -1;
    });
  }

  function renderTable() {
    var box = document.getElementById('entriesTable');
    var list = filtered();

    if (!state.entries.length) {
      box.innerHTML = window.utils.emptyStateHtml({
        icon: 'document',
        title: 'لا توجد قيود يومية',
        text: 'لم يتم تسجيل أي قيود محاسبية حتى الآن.',
        actionLabel: 'إنشاء قيد جديد',
        actionId: 'emptyAddBtn'
      });
      var b = document.getElementById('emptyAddBtn');
      if (b) b.addEventListener('click', function () { openForm(); });
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
      '<thead><tr><th>رقم القيد</th><th>التاريخ</th><th>البيان</th><th>المرجع</th>' +
      '<th class="num">مدين</th><th class="num">دائن</th><th>الحالة</th><th></th></tr></thead><tbody>';

    pageRows.forEach(function (en) {
      var d = 0, c = 0;
      (en.journal_entry_lines || []).forEach(function (l) {
        d += Number(l.debit) || 0;
        c += Number(l.credit) || 0;
      });
      html += '<tr>' +
        '<td class="num fw-semibold">' + window.utils.escapeHtml(en.entry_number || '—') + '</td>' +
        '<td class="num">' + window.utils.formatDate(en.entry_date) + '</td>' +
        '<td>' + window.utils.escapeHtml(en.description || '—') + '</td>' +
        '<td class="num">' + window.utils.escapeHtml(en.reference || '—') + '</td>' +
        '<td class="num">' + window.utils.formatAmount(d) + '</td>' +
        '<td class="num">' + window.utils.formatAmount(c) + '</td>' +
        '<td>' + window.utils.statusBadge(en.status || 'draft') + '</td>' +
        '<td><div class="row-actions">' +
        '<button class="row-action-btn" data-act="view" data-id="' + en.id + '" aria-label="عرض">' + window.utils.iconSvg('eye') + '</button>' +
        '<button class="row-action-btn" data-act="edit" data-id="' + en.id + '" aria-label="تعديل">' + window.utils.iconSvg('edit') + '</button>' +
        '<button class="row-action-btn row-action-btn--danger" data-act="delete" data-id="' + en.id + '" aria-label="حذف">' + window.utils.iconSvg('trash') + '</button>' +
        '</div></td></tr>';
    });

    html += '</tbody></table></div>';
    box.innerHTML = html;

    document.getElementById('countLabel').textContent = 'إجمالي القيود: ' + list.length;
    window.utils.renderPagination(document.getElementById('pagination'), state.page, pageCount, function (p) {
      state.page = p;
      renderTable();
    });

    box.querySelectorAll('[data-act]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var en = state.entries.find(function (x) { return String(x.id) === String(btn.dataset.id); });
        if (!en) return;
        if (btn.dataset.act === 'view') viewEntry(en);
        else if (btn.dataset.act === 'edit') openForm(en);
        else if (btn.dataset.act === 'delete') deleteEntry(en);
      });
    });
  }

  /* ---------- Entry editor ---------- */

  function accountOptionsHtml(selectedId) {
    if (!state.accounts.length) return '<option value="">— لا توجد حسابات متاحة —</option>';
    return '<option value="">اختر الحساب...</option>' + state.accounts.map(function (a) {
      var sel = String(a.id) === String(selectedId) ? ' selected' : '';
      return '<option value="' + a.id + '"' + sel + '>' +
        window.utils.escapeHtml(a.code + ' — ' + a.name) + '</option>';
    }).join('');
  }

  function addLineRow(line) {
    line = line || {};
    var tbody = document.getElementById('linesBody');
    var tr = document.createElement('tr');
    tr.innerHTML =
      '<td><select class="input line-account" required>' + accountOptionsHtml(line.account_id) + '</select></td>' +
      '<td><input class="input line-desc" value="' + window.utils.escapeHtml(line.description || '') + '" placeholder="—"></td>' +
      '<td><input class="input input--num line-debit" type="number" min="0" step="0.01" value="' + (line.debit || '') + '" placeholder="0.00"></td>' +
      '<td><input class="input input--num line-credit" type="number" min="0" step="0.01" value="' + (line.credit || '') + '" placeholder="0.00"></td>' +
      '<td><button type="button" class="row-action-btn row-action-btn--danger" data-remove-line aria-label="حذف البند">' + window.utils.iconSvg('trash') + '</button></td>';
    tbody.appendChild(tr);
  }

  function recalcTotals() {
    var debit = 0, credit = 0;
    document.querySelectorAll('#linesBody tr').forEach(function (tr) {
      debit += Number(tr.querySelector('.line-debit').value) || 0;
      credit += Number(tr.querySelector('.line-credit').value) || 0;
    });
    var diff = Math.round((debit - credit) * 100) / 100;
    document.getElementById('totalDebit').textContent = window.utils.formatAmount(debit);
    document.getElementById('totalCredit').textContent = window.utils.formatAmount(credit);
    var diffEl = document.getElementById('totalDiff');
    diffEl.textContent = window.utils.formatAmount(Math.abs(diff));
    diffEl.className = 'fw-bold fs-lg num ' + (diff === 0 ? 'amount--positive' : 'amount--negative');
    document.getElementById('balanceAlert').style.display = (diff !== 0 && (debit > 0 || credit > 0)) ? 'flex' : 'none';
  }

  function openForm(entry) {
    state.editingId = entry ? entry.id : null;
    var form = document.getElementById('entryForm');
    form.reset();
    window.utils.clearValidation(form);
    document.getElementById('entryModalTitle').textContent = entry ? 'تعديل القيد' : 'قيد يومية جديد';
    document.getElementById('entryDate').value = window.utils.todayISO();
    document.getElementById('linesBody').innerHTML = '';

    if (entry) {
      document.getElementById('entryNumber').value = entry.entry_number || '';
      document.getElementById('entryDate').value = entry.entry_date || '';
      document.getElementById('entryRef').value = entry.reference || '';
      document.getElementById('entryDesc').value = entry.description || '';
      document.getElementById('entryNotes').value = entry.notes || '';
      (entry.journal_entry_lines || []).forEach(function (l) { addLineRow(l); });
    } else {
      addLineRow();
      addLineRow();
    }
    recalcTotals();
    window.utils.openModal('entryModal');
  }

  function saveEntry(e) {
    e.preventDefault();
    var form = e.target;
    if (!window.utils.validateForm(form)) return;

    /* Collect lines */
    var lines = [];
    var valid = true;
    document.querySelectorAll('#linesBody tr').forEach(function (tr) {
      var accountId = tr.querySelector('.line-account').value;
      var debit = Number(tr.querySelector('.line-debit').value) || 0;
      var credit = Number(tr.querySelector('.line-credit').value) || 0;
      if (!accountId) { valid = false; }
      if (debit <= 0 && credit <= 0) { valid = false; }
      lines.push({
        account_id: accountId || null,
        description: tr.querySelector('.line-desc').value.trim(),
        debit: debit,
        credit: credit
      });
    });

    if (!valid || !lines.length) {
      window.utils.toast('يرجى إكمال بنود القيد: اختيار الحساب وإدخال مبلغ مدين أو دائن لكل بند.', 'error');
      return;
    }

    var totalD = lines.reduce(function (s, l) { return s + l.debit; }, 0);
    var totalC = lines.reduce(function (s, l) { return s + l.credit; }, 0);
    if (Math.round((totalD - totalC) * 100) !== 0) {
      document.getElementById('balanceAlert').style.display = 'flex';
      window.utils.toast('لا يمكن حفظ قيد غير متوازن.', 'error');
      return;
    }

    var btn = document.getElementById('saveEntryBtn');
    window.utils.setButtonLoading(btn, true, 'جاري الحفظ...');

    var payload = {
      entry_date: document.getElementById('entryDate').value,
      reference: document.getElementById('entryRef').value.trim() || null,
      description: document.getElementById('entryDesc').value.trim(),
      notes: document.getElementById('entryNotes').value.trim() || null,
      status: 'posted'
    };

    /* رقم فارغ = لا تُرسل الحقل: عند الإضافة يرقّمه المحفّز،
       وعند التعديل يبقى الرقم الحالي كما هو. */
    var entryNumber = document.getElementById('entryNumber').value.trim();
    if (entryNumber) payload.entry_number = entryNumber;

    var done = function (ok) {
      window.utils.setButtonLoading(btn, false);
      if (ok) {
        window.utils.closeModal('entryModal');
        window.utils.toast('تم حفظ البيانات بنجاح', 'success');
        loadEntries();
      } else {
        window.utils.toast('تعذر حفظ البيانات', 'error');
      }
    };

    var sb = window.db.getClient();
    if (!sb) {
      window.utils.setButtonLoading(btn, false);
      window.utils.toast('لم يتم إعداد الاتصال بقاعدة البيانات بعد.', 'error');
      return;
    }

    if (state.editingId) {
      /* Update header then replace lines */
      sb.from('journal_entries').update(payload).eq('id', state.editingId).then(function (res) {
        if (res.error) { done(false); return; }
        sb.from('journal_entry_lines').delete().eq('entry_id', state.editingId).then(function () {
          var rows = lines.map(function (l) { l.entry_id = state.editingId; return l; });
          sb.from('journal_entry_lines').insert(rows).then(function (r2) { done(!r2.error); });
        });
      }).catch(function () { done(false); });
    } else {
      sb.from('journal_entries').insert(payload).select().then(function (res) {
        if (res.error || !res.data || !res.data.length) { done(false); return; }
        var entryId = res.data[0].id;
        var rows = lines.map(function (l) { l.entry_id = entryId; return l; });
        sb.from('journal_entry_lines').insert(rows).then(function (r2) { done(!r2.error); });
      }).catch(function () { done(false); });
    }
  }

  function viewEntry(en) {
    var accountName = {};
    state.accounts.forEach(function (a) { accountName[a.id] = a.code + ' — ' + a.name; });

    var lines = en.journal_entry_lines || [];
    var d = 0, c = 0;
    var rows = lines.map(function (l) {
      d += Number(l.debit) || 0;
      c += Number(l.credit) || 0;
      return '<tr>' +
        '<td>' + window.utils.escapeHtml(accountName[l.account_id] || '—') + '</td>' +
        '<td>' + window.utils.escapeHtml(l.description || '—') + '</td>' +
        '<td class="num">' + window.utils.formatAmount(l.debit) + '</td>' +
        '<td class="num">' + window.utils.formatAmount(l.credit) + '</td></tr>';
    }).join('');

    document.getElementById('viewEntryBody').innerHTML =
      '<dl class="dl mb-4">' +
      '<dt>رقم القيد</dt><dd class="num">' + window.utils.escapeHtml(en.entry_number || '—') + '</dd>' +
      '<dt>التاريخ</dt><dd class="num">' + window.utils.formatDate(en.entry_date) + '</dd>' +
      '<dt>البيان</dt><dd>' + window.utils.escapeHtml(en.description || '—') + '</dd>' +
      '<dt>المرجع</dt><dd>' + window.utils.escapeHtml(en.reference || '—') + '</dd>' +
      '<dt>الحالة</dt><dd>' + window.utils.statusBadge(en.status || 'draft') + '</dd>' +
      '</dl>' +
      '<div class="table-wrapper"><table class="table table--compact">' +
      '<thead><tr><th>الحساب</th><th>البيان</th><th class="num">مدين</th><th class="num">دائن</th></tr></thead>' +
      '<tbody>' + rows + '</tbody>' +
      '<tfoot><tr><td colspan="2">الإجمالي</td>' +
      '<td class="num">' + window.utils.formatAmount(d) + '</td>' +
      '<td class="num">' + window.utils.formatAmount(c) + '</td></tr></tfoot>' +
      '</table></div>';

    window.utils.openModal('viewEntryModal');
  }

  function deleteEntry(en) {
    window.utils.confirmDialog('هل أنت متأكد من حذف هذا القيد؟ سيتم حذف جميع بنوده ولا يمكن التراجع.').then(function (ok) {
      if (!ok) return;
      var sb = window.db.getClient();
      if (!sb) { window.utils.toast('لم يتم إعداد الاتصال بقاعدة البيانات بعد.', 'error'); return; }
      sb.from('journal_entry_lines').delete().eq('entry_id', en.id).then(function () {
        sb.from('journal_entries').delete().eq('id', en.id).then(function (res) {
          if (res.error) { window.utils.toast('تعذر حذف القيد', 'error'); return; }
          window.utils.toast('تم حذف القيد بنجاح', 'success');
          loadEntries();
        });
      });
    });
  }

  function bindRetry(id, fn) {
    var btn = document.getElementById(id);
    if (btn) btn.addEventListener('click', fn);
  }
})();
