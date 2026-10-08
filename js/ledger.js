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
    window.db.fetchAll('accounts', {
      select: 'id,code,name,type,normal_balance,balance',
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

    /* البنود المرحّلة للحساب ضمن الفترة، كلها (تُجلب على دفعات من 1000)،
       والرصيد الافتتاحي = حركة الحساب قبل بداية الفترة. بدونه كان الرصيد
       المتحرك يبدأ من صفر عند اختيار «من تاريخ». */
    var filters = [
      { col: 'account_id', op: 'eq', val: state.accountId },
      { col: 'journal_entries.status', op: 'eq', val: 'posted' }
    ];
    if (state.from) filters.push({ col: 'journal_entries.entry_date', op: 'gte', val: state.from });
    if (state.to) filters.push({ col: 'journal_entries.entry_date', op: 'lte', val: state.to });

    var linesP = window.db.fetchAll('journal_entry_lines', {
      select: 'id,account_id,debit,credit,description,journal_entries!inner(entry_number,entry_date,reference,status,created_at)',
      filters: filters
    });
    var openingP = state.from
      ? window.db.rpc('fn_account_movements', { p_from: null, p_to: dayBefore(state.from) })
      : Promise.resolve({ data: [] });

    Promise.all([linesP, openingP]).then(function (results) {
      var res = results[0], op = results[1];
      var err = res.error || op.error;
      if (err) {
        box.innerHTML = window.utils.errorToState(err, 'retryLedger');
        var b = document.getElementById('retryLedger');
        if (b) b.addEventListener('click', loadLedger);
        return;
      }
      var mv = (op.data || []).filter(function (m) { return String(m.account_id) === String(state.accountId); })[0];
      renderRows(box, res.data || [], mv ? { debit: Number(mv.debit) || 0, credit: Number(mv.credit) || 0 } : null);
    }).catch(function () {
      box.innerHTML = window.utils.errorStateHtml({ retryId: 'retryLedger' });
      var b = document.getElementById('retryLedger');
      if (b) b.addEventListener('click', loadLedger);
    });
  }

  function dayBefore(iso) {
    var d = new Date(iso + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  }

  function renderRows(box, rows, opening) {
    rows.sort(function (a, b) {
      var ja = a.journal_entries || {}, jb = b.journal_entries || {};
      if (ja.entry_date !== jb.entry_date) return ja.entry_date < jb.entry_date ? -1 : 1;
      return (ja.created_at || '') < (jb.created_at || '') ? -1 : (ja.created_at || '') > (jb.created_at || '') ? 1 : 0;
    });

    var account = state.accounts.filter(function (a) {
      return String(a.id) === String(state.accountId);
    })[0] || {};
    /* الطبيعة من normal_balance: مجمع الإهلاك مثلًا أصل طبيعته دائنة. */
    var debitNature = account.normal_balance
      ? account.normal_balance === 'debit'
      : (account.type === 'asset' || account.type === 'expense');
    var sign = function (d, c) { return debitNature ? d - c : c - d; };

    var running = opening ? sign(opening.debit, opening.credit) : 0;

    if (!rows.length && !running) {
      box.innerHTML = window.utils.emptyStateHtml({
        icon: 'document',
        title: 'لا توجد حركات لهذا الحساب',
        text: 'لم يتم تسجيل أي حركات مرحّلة على هذا الحساب ضمن الفترة المحددة.'
      });
      return;
    }

    var html = '<div class="table-wrapper"><table class="table">' +
      '<thead><tr><th>التاريخ</th><th>المرجع</th><th>البيان</th>' +
      '<th class="num">مدين</th><th class="num">دائن</th><th class="num">الرصيد</th></tr></thead><tbody>';

    if (opening) {
      html += '<tr><td class="num">' + window.utils.escapeHtml(state.from) + '</td><td>—</td>' +
        '<td class="fw-semibold">رصيد أول المدة</td><td class="num">—</td><td class="num">—</td>' +
        '<td class="num fw-semibold' + (running < 0 ? ' amount--negative' : '') + '">' + window.utils.formatAmount(running) + '</td></tr>';
    }

    var td = 0, tc = 0;
    rows.forEach(function (l) {
      var je = l.journal_entries || {};
      var d = Number(l.debit) || 0, c = Number(l.credit) || 0;
      td += d; tc += c;
      running = Math.round((running + sign(d, c)) * 100) / 100;
      var cls = running < 0 ? ' amount--negative' : '';
      html += '<tr>' +
        '<td class="num">' + window.utils.formatDate(je.entry_date) + '</td>' +
        '<td class="num">' + window.utils.escapeHtml(je.entry_number || je.reference || '—') + '</td>' +
        '<td>' + window.utils.escapeHtml(l.description || '—') + '</td>' +
        '<td class="num">' + window.utils.formatAmount(d) + '</td>' +
        '<td class="num">' + window.utils.formatAmount(c) + '</td>' +
        '<td class="num fw-semibold' + cls + '">' + window.utils.formatAmount(running) + '</td>' +
        '</tr>';
    });

    html += '</tbody><tfoot><tr>' +
      '<td colspan="3">الإجمالي والرصيد الختامي</td>' +
      '<td class="num">' + window.utils.formatAmount(td) + '</td>' +
      '<td class="num">' + window.utils.formatAmount(tc) + '</td>' +
      '<td class="num">' + window.utils.formatAmount(running) + '</td>' +
      '</tr></tfoot></table></div>';
    box.innerHTML = html;
  }
})();
