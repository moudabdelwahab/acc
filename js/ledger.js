/* ============================================================
   ledger.js — General Ledger: account selector, date range,
   running balance computed from real journal entry lines.
   ============================================================ */

(function () {
  'use strict';

  var state = { accounts: [], accountId: '', from: '', to: '', lines: [] };

  document.addEventListener('DOMContentLoaded', function () {
    window.layout.render('ledger');
    var main = window.layout.mainEl();

    main.innerHTML =
      '<nav class="breadcrumbs" aria-label="مسار التنقل">' +
      '  <a href="../dashboard.html">لوحة التحكم</a>' +
      '  <span class="breadcrumbs__sep">/</span>' +
      '  <span aria-current="page">دفتر الأستاذ العام</span>' +
      '</nav>' +
      '<div class="page-header">' +
      '  <div>' +
      '    <h1 class="page-header__title">دفتر الأستاذ العام</h1>' +
      '    <p class="page-header__subtitle">حركات الحسابات مع الرصيد المتحرك</p>' +
      '  </div>' +
      '  <div class="page-header__actions">' +
      '    <button class="btn btn--secondary" id="printBtn">طباعة</button>' +
      '  </div>' +
      '</div>' +
      '<div class="card mb-4"><div class="card__body">' +
      '  <div class="toolbar" style="margin-bottom:0;">' +
      '    <select class="input" id="accountSelect" aria-label="اختيار الحساب" style="flex:1; min-width:220px;">' +
      '      <option value="">— اختر الحساب —</option>' +
      '    </select>' +
      '    <input class="input" type="date" id="fromDate" aria-label="من تاريخ" style="width:auto;">' +
      '    <input class="input" type="date" id="toDate" aria-label="إلى تاريخ" style="width:auto;">' +
      '    <button class="btn btn--primary" id="applyBtn">عرض</button>' +
      '  </div>' +
      '</div></div>' +
      '<div class="card">' +
      '  <div class="card__body card__body--flush" id="ledgerTable">' +
      window.utils.emptyStateHtml({
        icon: 'document',
        title: 'اختر حساباً لعرض حركاته',
        text: 'حدد الحساب والفترة الزمنية ثم اضغط "عرض" لإظهار حركات الحساب.'
      }) +
      '  </div>' +
      '</div>';

    document.getElementById('printBtn').addEventListener('click', function () { window.print(); });
    document.getElementById('applyBtn').addEventListener('click', function () {
      state.accountId = document.getElementById('accountSelect').value;
      state.from = document.getElementById('fromDate').value;
      state.to = document.getElementById('toDate').value;
      loadLedger();
    });

    loadAccounts();
  });

  function loadAccounts() {
    window.db.fetchRows('accounts', {
      select: 'id,code,name,type,balance',
      order: { col: 'code', ascending: true }
    }).then(function (res) {
      if (res.error) {
        document.getElementById('ledgerTable').innerHTML = window.utils.errorToState(res.error, 'retryLedgerAcc');
        var b = document.getElementById('retryLedgerAcc');
        if (b) b.addEventListener('click', loadAccounts);
        return;
      }
      state.accounts = res.data || [];
      var sel = document.getElementById('accountSelect');
      sel.innerHTML = '<option value="">— اختر الحساب —</option>' + state.accounts.map(function (a) {
        return '<option value="' + a.id + '">' + window.utils.escapeHtml(a.code + ' — ' + a.name) + '</option>';
      }).join('');
    });
  }

  function loadLedger() {
    var box = document.getElementById('ledgerTable');
    if (!state.accountId) {
      box.innerHTML = window.utils.emptyStateHtml({
        icon: 'document',
        title: 'اختر حساباً لعرض حركاته',
        text: 'حدد الحساب والفترة الزمنية ثم اضغط "عرض".'
      });
      return;
    }
    box.innerHTML = window.utils.loadingHtml();

    window.db.fetchRows('journal_entry_lines', {
      select: 'id,account_id,debit,credit,description,journal_entries!inner(entry_number,entry_date,reference,status)',
      filters: [{ col: 'account_id', op: 'eq', val: state.accountId }]
    }).then(function (res) {
      if (res.error) {
        box.innerHTML = window.utils.errorToState(res.error, 'retryLedger');
        var b = document.getElementById('retryLedger');
        if (b) b.addEventListener('click', loadLedger);
        return;
      }

      renderRows(box, res.data || []);
    }).catch(function () {
      box.innerHTML = window.utils.errorStateHtml({ retryId: 'retryLedger' });
      var b = document.getElementById('retryLedger');
      if (b) b.addEventListener('click', loadLedger);
    });
  }

  function renderRows(box, rows) {
    /* Apply date range */
    var filtered = rows.filter(function (l) {
      var je = l.journal_entries || {};
      if (state.from && je.entry_date < state.from) return false;
      if (state.to && je.entry_date > state.to) return false;
      return true;
    });

    filtered.sort(function (a, b) {
      var da = (a.journal_entries || {}).entry_date || '';
      var db = (b.journal_entries || {}).entry_date || '';
      return da < db ? -1 : da > db ? 1 : 0;
    });

    if (!filtered.length) {
      box.innerHTML = window.utils.emptyStateHtml({
        icon: 'document',
        title: 'لا توجد حركات لهذا الحساب',
        text: 'لم يتم تسجيل أي حركات على هذا الحساب ضمن الفترة المحددة.'
      });
      return;
    }

    var running = 0;
    var html = '<div class="table-wrapper"><table class="table">' +
      '<thead><tr><th>التاريخ</th><th>المرجع</th><th>البيان</th>' +
      '<th class="num">مدين</th><th class="num">دائن</th><th class="num">الرصيد</th></tr></thead><tbody>';

    filtered.forEach(function (l) {
      var je = l.journal_entries || {};
      running += (Number(l.debit) || 0) - (Number(l.credit) || 0);
      var cls = running < 0 ? ' amount--negative' : '';
      html += '<tr>' +
        '<td class="num">' + window.utils.formatDate(je.entry_date) + '</td>' +
        '<td class="num">' + window.utils.escapeHtml(je.entry_number || je.reference || '—') + '</td>' +
        '<td>' + window.utils.escapeHtml(l.description || '—') + '</td>' +
        '<td class="num">' + window.utils.formatAmount(l.debit) + '</td>' +
        '<td class="num">' + window.utils.formatAmount(l.credit) + '</td>' +
        '<td class="num fw-semibold' + cls + '">' + window.utils.formatAmount(running) + '</td>' +
        '</tr>';
    });

    html += '</tbody><tfoot><tr>' +
      '<td colspan="5">الرصيد الختامي</td>' +
      '<td class="num">' + window.utils.formatAmount(running) + '</td>' +
      '</tr></tfoot></table></div>';
    box.innerHTML = html;
  }
})();
