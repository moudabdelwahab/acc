/* ============================================================
   reports.js — Financial reports computed ONLY from real
   Supabase data (accounts + posted journal entry lines):
   - Trial Balance (ميزان المراجعة)
   - Income Statement (قائمة الدخل)
   - Balance Sheet (الميزانية العمومية)
   The page is selected via document.body.dataset.report.
   ============================================================ */

(function () {
  'use strict';

  var report = document.body.dataset.report;

  var ACCOUNT_TYPES = {
    asset: 'الأصول',
    liability: 'الخصوم',
    equity: 'حقوق الملكية',
    revenue: 'الإيرادات',
    expense: 'المصروفات'
  };

  document.addEventListener('DOMContentLoaded', function () {
    window.layout.render(report);
    var main = window.layout.mainEl();

    if (report === 'trial-balance') renderTrialBalancePage(main);
    else if (report === 'income-statement') renderIncomeStatementPage(main);
    else if (report === 'balance-sheet') renderBalanceSheetPage(main);
  });

  /* ---------- Shared data loader ---------- */

  /* الحركة تُجمَّع في قاعدة البيانات (fn_account_movements) من القيود المرحّلة
     وحدها: جلب البنود إلى المتصفح كان يتوقف بصمت عند 1000 بند فتنقص التقارير. */
  function loadMovements(fromDate, toDate) {
    return window.db.rpc('fn_account_movements', { p_from: fromDate || null, p_to: toDate || null })
      .then(function (res) {
        if (res.error) return { error: res.error };
        var movement = {};
        (res.data || []).forEach(function (m) {
          movement[m.account_id] = { debit: Number(m.debit) || 0, credit: Number(m.credit) || 0 };
        });
        return { movement: movement };
      });
  }

  function loadAccounts() {
    return window.db.fetchAll('accounts', {
      select: 'id,code,name,type,subtype,normal_balance',
      order: { col: 'code', ascending: true }
    });
  }

  function loadData(fromDate, toDate) {
    return Promise.all([loadAccounts(), loadMovements(fromDate, toDate)]).then(function (results) {
      var accRes = results[0], mvRes = results[1];
      if (accRes.error) return { error: accRes.error };
      if (mvRes.error) return { error: mvRes.error };
      return { accounts: accRes.data || [], movement: mvRes.movement };
    });
  }

  function toolbarHtml(asOfOnly) {
    return '<div class="card mb-4"><div class="card__body">' +
      '<div class="toolbar" style="margin-bottom:0;">' +
      (asOfOnly ? '' :
      '  <label class="d-flex align-center gap-2 fs-sm text-secondary">من ' +
      '    <input class="input" type="date" id="fromDate" style="width:auto;"></label>') +
      '  <label class="d-flex align-center gap-2 fs-sm text-secondary">' + (asOfOnly ? 'حتى تاريخ' : 'إلى') + ' ' +
      '    <input class="input" type="date" id="toDate" style="width:auto;"></label>' +
      '  <button class="btn btn--primary" id="applyBtn">عرض التقرير</button>' +
      '  <div class="toolbar__spacer"></div>' +
      '  <button class="btn btn--secondary" id="printBtn">طباعة</button>' +
      '</div></div></div>';
  }

  function pageHeader(title, subtitle, crumb) {
    return '<nav class="breadcrumbs" aria-label="مسار التنقل">' +
      '  <a href="../dashboard.html">لوحة التحكم</a>' +
      '  <span class="breadcrumbs__sep">/</span>' +
      '  <span aria-current="page">' + crumb + '</span></nav>' +
      '<div class="page-header"><div>' +
      '  <h1 class="page-header__title">' + title + '</h1>' +
      '  <p class="page-header__subtitle">' + subtitle + '</p>' +
      '</div></div>';
  }

  function bindToolbar(run) {
    document.getElementById('printBtn').addEventListener('click', function () { window.print(); });
    document.getElementById('applyBtn').addEventListener('click', function () {
      var fromEl = document.getElementById('fromDate');
      run(fromEl ? fromEl.value : '', document.getElementById('toDate').value);
    });
  }

  function showError(box, error, retryId, retryFn) {
    box.innerHTML = window.utils.errorToState(error, retryId);
    var b = document.getElementById(retryId);
    if (b) b.addEventListener('click', retryFn);
  }

  /* ============================================================
     TRIAL BALANCE
     ============================================================ */
  function renderTrialBalancePage(main) {
    main.innerHTML =
      pageHeader('ميزان المراجعة', 'حركة الفترة والأرصدة الختامية للحسابات', 'ميزان المراجعة') +
      toolbarHtml() +
      '<div class="card"><div class="card__body card__body--flush" id="reportArea">' +
      window.utils.loadingHtml() + '</div></div>' +
      '<div id="balanceNotice" class="mt-4"></div>';

    bindToolbar(run);
    run('', '');

    /* حركة الفترة من «من» إلى «إلى»، والرصيد الختامي تراكمي حتى «إلى»:
       الرصيد يشمل كل ما قبل الفترة، فلا يُحسب من حركتها وحدها. */
    function run(from, to) {
      var box = document.getElementById('reportArea');
      var notice = document.getElementById('balanceNotice');
      box.innerHTML = window.utils.loadingHtml();
      notice.innerHTML = '';

      Promise.all([loadAccounts(), loadMovements(from, to), loadMovements(null, to)]).then(function (res) {
        var err = res[0].error || res[1].error || res[2].error;
        if (err) { showError(box, err, 'retryReport', function () { run(from, to); }); return; }
        var accounts = res[0].data || [];
        var period = res[1].movement, closing = res[2].movement;

        var t = { pd: 0, pc: 0, bd: 0, bc: 0 };
        var rowsHtml = '';
        accounts.forEach(function (a) {
          var mv = period[a.id] || { debit: 0, credit: 0 };
          var cl = closing[a.id] || { debit: 0, credit: 0 };
          var net = Math.round((cl.debit - cl.credit) * 100) / 100;
          var bd = net > 0 ? net : 0, bc = net < 0 ? -net : 0;
          if (!mv.debit && !mv.credit && !bd && !bc) return;
          t.pd += mv.debit; t.pc += mv.credit; t.bd += bd; t.bc += bc;
          var cell = function (v) { return '<td class="num">' + (v ? window.utils.formatAmount(v) : '—') + '</td>'; };
          rowsHtml += '<tr>' +
            '<td class="num">' + window.utils.escapeHtml(a.code || '—') + '</td>' +
            '<td>' + window.utils.escapeHtml(a.name || '—') + '</td>' +
            cell(mv.debit) + cell(mv.credit) + cell(bd) + cell(bc) + '</tr>';
        });

        if (!rowsHtml) {
          box.innerHTML = window.utils.emptyStateHtml({
            icon: 'document',
            title: 'لا توجد أرصدة لعرضها',
            text: 'لا توجد قيود مرحّلة حتى التاريخ المحدد.'
          });
          return;
        }

        box.innerHTML = '<div class="table-wrapper"><table class="table">' +
          '<thead><tr><th rowspan="2">رمز الحساب</th><th rowspan="2">اسم الحساب</th>' +
          '<th class="num" colspan="2">حركة الفترة</th><th class="num" colspan="2">الرصيد الختامي</th></tr>' +
          '<tr><th class="num">مدين</th><th class="num">دائن</th><th class="num">مدين</th><th class="num">دائن</th></tr></thead>' +
          '<tbody>' + rowsHtml + '</tbody>' +
          '<tfoot><tr><td colspan="2">الإجمالي</td>' +
          '<td class="num">' + window.utils.formatAmount(t.pd) + '</td>' +
          '<td class="num">' + window.utils.formatAmount(t.pc) + '</td>' +
          '<td class="num">' + window.utils.formatAmount(t.bd) + '</td>' +
          '<td class="num">' + window.utils.formatAmount(t.bc) + '</td></tr></tfoot>' +
          '</table></div>';

        var diff = Math.round((t.bd - t.bc) * 100) / 100;
        var pdiff = Math.round((t.pd - t.pc) * 100) / 100;
        if (diff === 0 && pdiff === 0) {
          notice.innerHTML = '<div class="alert alert--success">الميزان متوازن: إجمالي المدين يساوي إجمالي الدائن.</div>';
        } else {
          notice.innerHTML = '<div class="alert alert--danger">' +
            'الميزان غير متوازن — الفرق: <span class="num fw-bold">' + window.utils.formatAmount(Math.abs(diff || pdiff)) + '</span>. يرجى مراجعة القيود.</div>';
        }
      }).catch(function () {
        showError(box, { message: '' }, 'retryReport', function () { run(from, to); });
      });
    }
  }

  /* ============================================================
     INCOME STATEMENT
     ============================================================ */
  function renderIncomeStatementPage(main) {
    main.innerHTML =
      pageHeader('قائمة الدخل', 'الإيرادات والمصروفات وصافي الربح', 'قائمة الدخل') +
      toolbarHtml() +
      '<div class="card"><div class="card__body" id="reportArea">' +
      window.utils.loadingHtml() + '</div></div>';

    bindToolbar(run);
    run('', '');

    function sectionRows(accounts, movement) {
      var html = '', total = 0;
      accounts.forEach(function (a) {
        var mv = movement[a.id] || { debit: 0, credit: 0 };
        /* Revenue: credit-nature; Expense: debit-nature */
        var amount = a.type === 'revenue' ? mv.credit - mv.debit : mv.debit - mv.credit;
        if (amount === 0) return;
        total += amount;
        html += '<tr><td>' + window.utils.escapeHtml(a.code + ' — ' + a.name) + '</td>' +
          '<td class="num">' + window.utils.formatAmount(amount) + '</td></tr>';
      });
      return { html: html, total: total };
    }

    function totalRow(label, amount) {
      var cls = amount < 0 ? ' amount--negative' : '';
      return '<tr class="report-total-row"><td>' + label + '</td>' +
        '<td class="num' + cls + '">' + window.utils.formatAmount(amount) + '</td></tr>';
    }

    function run(from, to) {
      var box = document.getElementById('reportArea');
      box.innerHTML = window.utils.loadingHtml();

      loadData(from, to).then(function (r) {
        if (r.error) { showError(box, r.error, 'retryReport', function () { run(from, to); }); return; }

        var revenue = r.accounts.filter(function (a) { return a.type === 'revenue'; });
        var expenses = r.accounts.filter(function (a) { return a.type === 'expense'; });

        var hasMovement = Object.keys(r.movement).length > 0;
        if (!hasMovement) {
          box.innerHTML = window.utils.emptyStateHtml({
            icon: 'chart',
            title: 'لا توجد بيانات لعرضها',
            text: 'لم يتم تسجيل حركات إيرادات أو مصروفات ضمن الفترة المحددة.'
          });
          return;
        }

        var costAccounts = expenses.filter(function (a) { return a.subtype === 'تكلفة المبيعات'; });
        var opAccounts = expenses.filter(function (a) { return a.subtype !== 'تكلفة المبيعات'; });

        var rev = sectionRows(revenue, r.movement);
        var cost = sectionRows(costAccounts, r.movement);
        var ops = sectionRows(opAccounts, r.movement);
        var gross = rev.total - cost.total;
        var operating = gross - ops.total;
        var net = operating;

        var html = '<div class="table-wrapper"><table class="table">' +
          '<thead><tr><th>البند</th><th class="num">المبلغ</th></tr></thead><tbody>';

        html += '<tr><td colspan="2" class="fw-bold" style="color:var(--primary-darker);">الإيرادات</td></tr>';
        html += rev.html || '<tr><td class="text-muted">— لا توجد إيرادات مسجلة —</td><td class="num">—</td></tr>';
        html += totalRow('إجمالي الإيرادات', rev.total);

        html += '<tr><td colspan="2" class="fw-bold" style="color:var(--primary-darker);">تكلفة المبيعات</td></tr>';
        html += cost.html || '<tr><td class="text-muted">— لا توجد تكاليف مسجلة —</td><td class="num">—</td></tr>';
        html += totalRow('مجمل الربح', gross);

        html += '<tr><td colspan="2" class="fw-bold" style="color:var(--primary-darker);">المصروفات التشغيلية</td></tr>';
        html += ops.html || '<tr><td class="text-muted">— لا توجد مصروفات مسجلة —</td><td class="num">—</td></tr>';
        html += totalRow('الربح التشغيلي', operating);
        html += totalRow('صافي الربح', net);

        html += '</tbody></table></div>';
        box.innerHTML = html;
      }).catch(function () {
        showError(box, { message: '' }, 'retryReport', function () { run(from, to); });
      });
    }
  }

  /* ============================================================
     BALANCE SHEET
     ============================================================ */
  function renderBalanceSheetPage(main) {
    main.innerHTML =
      pageHeader('الميزانية العمومية', 'الأصول والخصوم وحقوق الملكية في تاريخ محدد', 'الميزانية العمومية') +
      toolbarHtml(true) +
      '<div class="card"><div class="card__body" id="reportArea">' +
      window.utils.loadingHtml() + '</div></div>' +
      '<div id="equationArea" class="mt-4"></div>';

    bindToolbar(run);
    run('', '');

    function groupRows(accounts, movement) {
      var html = '', total = 0;
      accounts.forEach(function (a) {
        var mv = movement[a.id] || { debit: 0, credit: 0 };
        /* من الحركات وحدها — انظر ملاحظة ميزان المراجعة. */
        var bal = a.type === 'asset' ? mv.debit - mv.credit : mv.credit - mv.debit;
        if (bal === 0) return;
        total += bal;
        html += '<tr><td>' + window.utils.escapeHtml(a.code + ' — ' + a.name) + '</td>' +
          '<td class="num">' + window.utils.formatAmount(bal) + '</td></tr>';
      });
      return { html: html, total: total };
    }

    function section(title, result) {
      var html = '<tr><td colspan="2" class="fw-bold" style="color:var(--primary-darker);">' + title + '</td></tr>';
      html += result.html || '<tr><td class="text-muted">— لا توجد أرصدة —</td><td class="num">—</td></tr>';
      return html;
    }

    function totalRow(label, amount) {
      return '<tr class="report-total-row"><td>' + label + '</td>' +
        '<td class="num">' + window.utils.formatAmount(amount) + '</td></tr>';
    }

    function run(from, to) {
      var box = document.getElementById('reportArea');
      var eq = document.getElementById('equationArea');
      box.innerHTML = window.utils.loadingHtml();
      eq.innerHTML = '';

      /* الميزانية صورة في لحظة: كل الحركات حتى التاريخ المحدد، لا حركة فترة.
         حسابها من فترة وحدها كان يُسقط أرصدة ما قبلها. */
      loadData(null, to).then(function (r) {
        if (r.error) { showError(box, r.error, 'retryReport', function () { run(from, to); }); return; }
        if (!r.accounts.length) {
          box.innerHTML = window.utils.emptyStateHtml({
            icon: 'document',
            title: 'لا توجد بيانات لعرضها',
            text: 'تظهر الميزانية العمومية بعد إنشاء الحسابات وتسجيل القيود.'
          });
          return;
        }

        var byTypeAndSub = function (type, subtypes) {
          return r.accounts.filter(function (a) {
            return a.type === type && (subtypes.indexOf(a.subtype) !== -1);
          });
        };

        var currentAssets = groupRows(byTypeAndSub('asset', ['أصول متداولة']), r.movement);
        var fixedAssets = groupRows(byTypeAndSub('asset', ['أصول ثابتة']), r.movement);
        var otherAssets = groupRows(byTypeAndSub('asset', ['أصول أخرى']), r.movement);
        /* Assets without a recognized subtype fall into "other" */
        var unclassifiedAssets = groupRows(r.accounts.filter(function (a) {
          return a.type === 'asset' && ['أصول متداولة', 'أصول ثابتة', 'أصول أخرى'].indexOf(a.subtype) === -1;
        }), r.movement);
        var totalAssets = currentAssets.total + fixedAssets.total + otherAssets.total + unclassifiedAssets.total;

        var currentLiab = groupRows(byTypeAndSub('liability', ['خصوم متداولة']), r.movement);
        var longLiab = groupRows(byTypeAndSub('liability', ['خصوم طويلة الأجل']), r.movement);
        var unclassifiedLiab = groupRows(r.accounts.filter(function (a) {
          return a.type === 'liability' && ['خصوم متداولة', 'خصوم طويلة الأجل'].indexOf(a.subtype) === -1;
        }), r.movement);
        var totalLiab = currentLiab.total + longLiab.total + unclassifiedLiab.total;

        var equityAccounts = groupRows(r.accounts.filter(function (a) { return a.type === 'equity'; }), r.movement);

        /* صافي ربح الفترة يخصّ الملّاك، ويظل ضمن حقوق الملكية حتى
           يُقفَل في الأرباح المحتجزة — بدونه لا تتوازن الميزانية. */
        var netIncome = 0;
        r.accounts.forEach(function (a) {
          if (a.type !== 'revenue' && a.type !== 'expense') return;
          var mv = r.movement[a.id] || { debit: 0, credit: 0 };
          netIncome += a.type === 'revenue' ? (mv.credit - mv.debit) : -(mv.debit - mv.credit);
        });

        var equityHtml = equityAccounts.html;
        if (netIncome !== 0) {
          equityHtml += '<tr><td>صافي ربح الفترة</td>' +
            '<td class="num' + (netIncome < 0 ? ' amount--negative' : '') + '">' +
            window.utils.formatAmount(netIncome) + '</td></tr>';
        }
        equityAccounts = { html: equityHtml, total: equityAccounts.total + netIncome };
        var totalEquity = equityAccounts.total;

        var html = '<div class="table-wrapper"><table class="table">' +
          '<thead><tr><th>البند</th><th class="num">المبلغ</th></tr></thead><tbody>';

        html += section('الأصول المتداولة', currentAssets);
        html += section('الأصول غير المتداولة (الثابتة)', fixedAssets);
        html += section('أصول أخرى', { html: otherAssets.html + unclassifiedAssets.html, total: otherAssets.total + unclassifiedAssets.total });
        html += totalRow('إجمالي الأصول', totalAssets);

        html += section('الخصوم المتداولة', currentLiab);
        html += section('الخصوم طويلة الأجل', { html: longLiab.html + unclassifiedLiab.html, total: longLiab.total + unclassifiedLiab.total });
        html += totalRow('إجمالي الخصوم', totalLiab);

        html += section('حقوق الملكية', equityAccounts);
        html += totalRow('إجمالي حقوق الملكية', totalEquity);
        html += totalRow('إجمالي الخصوم وحقوق الملكية', totalLiab + totalEquity);

        html += '</tbody></table></div>';
        box.innerHTML = html;

        var diff = Math.round((totalAssets - (totalLiab + totalEquity)) * 100) / 100;
        var eqHtml = '<div class="balance-equation">' +
          '<div class="balance-equation__part"><div class="text-secondary fs-sm">إجمالي الأصول</div>' +
          '<div class="balance-equation__value">' + window.utils.formatAmount(totalAssets) + '</div></div>' +
          '<div class="balance-equation__op">=</div>' +
          '<div class="balance-equation__part"><div class="text-secondary fs-sm">إجمالي الخصوم</div>' +
          '<div class="balance-equation__value">' + window.utils.formatAmount(totalLiab) + '</div></div>' +
          '<div class="balance-equation__op">+</div>' +
          '<div class="balance-equation__part"><div class="text-secondary fs-sm">حقوق الملكية</div>' +
          '<div class="balance-equation__value">' + window.utils.formatAmount(totalEquity) + '</div></div>' +
          '</div>';

        if (diff === 0) {
          eqHtml += '<div class="alert alert--success mt-3">الميزانية متوازنة: الأصول = الخصوم + حقوق الملكية.</div>';
        } else {
          eqHtml += '<div class="alert alert--danger mt-3">الميزانية غير متوازنة — الفرق: <span class="num fw-bold">' +
            window.utils.formatAmount(Math.abs(diff)) + '</span>. يرجى مراجعة القيود والأرصدة.</div>';
        }
        eq.innerHTML = eqHtml;
      }).catch(function () {
        showError(box, { message: '' }, 'retryReport', function () { run(from, to); });
      });
    }
  }
})();
