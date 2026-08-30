/* ============================================================
   dashboard.js — Financial overview, recent journal entries,
   activity area. All figures come from Supabase only.
   ============================================================ */

(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', function () {
    window.layout.render('dashboard');
    var main = window.layout.mainEl();

    main.innerHTML =
      '<div class="page-header">' +
      '  <div>' +
      '    <h1 class="page-header__title">لوحة التحكم</h1>' +
      '    <p class="page-header__subtitle">نظرة عامة على الوضع المالي</p>' +
      '  </div>' +
      '  <div class="page-header__actions">' +
      '    <a class="btn btn--secondary" href="pages/journal.html">القيود اليومية</a>' +
      '    <a class="btn btn--primary" href="pages/journal.html#new">قيد جديد</a>' +
      '  </div>' +
      '</div>' +
      '<section aria-labelledby="finOverviewTitle">' +
      '  <h2 id="finOverviewTitle" class="visually-hidden">الملخص المالي</h2>' +
      '  <div class="stats-grid" id="statsGrid">' + window.utils.loadingHtml() + '</div>' +
      '</section>' +
      '<div class="d-grid mt-6" style="grid-template-columns: 1fr; gap: var(--space-6);">' +
      '  <div class="card">' +
      '    <div class="card__header">' +
      '      <h2 class="card__title">أحدث القيود اليومية</h2>' +
      '      <a class="btn btn--ghost btn--sm" href="pages/journal.html">عرض الكل</a>' +
      '    </div>' +
      '    <div class="card__body card__body--flush" id="recentEntries">' + window.utils.loadingHtml() + '</div>' +
      '  </div>' +
      '  <div class="card">' +
      '    <div class="card__header"><h2 class="card__title">النشاط المالي</h2></div>' +
      '    <div class="card__body" id="activityArea">' + window.utils.loadingHtml() + '</div>' +
      '  </div>' +
      '</div>';

    loadStats();
    loadRecentEntries();
    loadActivity();
  });

  /* ---------- Financial overview cards ---------- */
  function loadStats() {
    var grid = document.getElementById('statsGrid');

    window.db.fetchRows('accounts', { select: 'id,type,balance,is_active' }).then(function (res) {
      if (res.error) {
        grid.innerHTML = window.utils.errorToState(res.error, 'retryStats');
        bindRetry('retryStats', loadStats);
        return;
      }

      var accounts = res.data || [];
      if (!accounts.length) {
        grid.innerHTML = window.utils.emptyStateHtml({
          icon: 'chart',
          title: 'لا توجد بيانات مالية بعد',
          text: 'ابدأ بإنشاء دليل الحسابات وتسجيل القيود اليومية لعرض الملخص المالي هنا.',
          actionLabel: 'إضافة حساب',
          actionHref: 'pages/accounts.html'
        });
        return;
      }

      var totals = { asset: 0, liability: 0, equity: 0, revenue: 0, expense: 0 };
      accounts.forEach(function (a) {
        var bal = Number(a.balance) || 0;
        if (totals[a.type] !== undefined) totals[a.type] += bal;
      });
      var netProfit = totals.revenue - totals.expense;

      var cards = [
        { label: 'إجمالي الأصول', value: totals.asset },
        { label: 'إجمالي الخصوم', value: totals.liability },
        { label: 'حقوق الملكية', value: totals.equity },
        { label: 'الإيرادات', value: totals.revenue },
        { label: 'المصروفات', value: totals.expense },
        { label: 'صافي الربح', value: netProfit, colored: true }
      ];

      grid.innerHTML = cards.map(function (c) {
        var cls = c.colored ? (c.value < 0 ? ' amount--negative' : ' amount--positive') : '';
        return '<div class="stat-card">' +
          '<div class="stat-card__label">' + c.label + '</div>' +
          '<div class="stat-card__value' + cls + '">' + window.utils.formatAmount(c.value) + '</div>' +
          '</div>';
      }).join('');
    }).catch(function () {
      grid.innerHTML = window.utils.errorStateHtml({ retryId: 'retryStats' });
      bindRetry('retryStats', loadStats);
    });
  }

  /* ---------- Recent journal entries ---------- */
  function loadRecentEntries() {
    var box = document.getElementById('recentEntries');

    window.db.fetchRows('journal_entries', {
      select: 'id,entry_number,entry_date,description,status,journal_entry_lines(debit,credit)',
      order: { col: 'entry_date', ascending: false },
      limit: 8
    }).then(function (res) {
      if (res.error) {
        box.innerHTML = window.utils.errorToState(res.error, 'retryEntries');
        bindRetry('retryEntries', loadRecentEntries);
        return;
      }

      var rows = res.data || [];
      if (!rows.length) {
        box.innerHTML = window.utils.emptyStateHtml({
          icon: 'document',
          title: 'لا توجد قيود يومية حتى الآن',
          text: 'لم يتم تسجيل أي قيود محاسبية حتى الآن.',
          actionLabel: 'إنشاء قيد جديد',
          actionHref: 'pages/journal.html#new'
        });
        return;
      }

      var html = '<div class="table-wrapper"><table class="table">' +
        '<thead><tr>' +
        '<th>رقم القيد</th><th>التاريخ</th><th>البيان</th>' +
        '<th class="num">مدين</th><th class="num">دائن</th><th>الحالة</th>' +
        '</tr></thead><tbody>';

      rows.forEach(function (r) {
        var debit = 0, credit = 0;
        (r.journal_entry_lines || []).forEach(function (l) {
          debit += Number(l.debit) || 0;
          credit += Number(l.credit) || 0;
        });
        html += '<tr>' +
          '<td class="num">' + window.utils.escapeHtml(r.entry_number || '—') + '</td>' +
          '<td class="num">' + window.utils.formatDate(r.entry_date) + '</td>' +
          '<td>' + window.utils.escapeHtml(r.description || '—') + '</td>' +
          '<td class="num">' + window.utils.formatAmount(debit) + '</td>' +
          '<td class="num">' + window.utils.formatAmount(credit) + '</td>' +
          '<td>' + window.utils.statusBadge(r.status) + '</td>' +
          '</tr>';
      });

      html += '</tbody></table></div>';
      box.innerHTML = html;
    }).catch(function () {
      box.innerHTML = window.utils.errorStateHtml({ retryId: 'retryEntries' });
      bindRetry('retryEntries', loadRecentEntries);
    });
  }

  /* ---------- Financial activity (no fake chart data) ---------- */
  function loadActivity() {
    var box = document.getElementById('activityArea');

    window.db.fetchRows('journal_entry_lines', {
      select: 'debit,credit,journal_entries!inner(entry_date,status)'
    }).then(function (res) {
      if (res.error) {
        box.innerHTML = window.utils.errorToState(res.error, 'retryActivity');
        bindRetry('retryActivity', loadActivity);
        return;
      }

      /* التجميع حسب شهر القيد المحاسبي لا شهر إدخاله، والقيود
         غير المرحّلة خارج النشاط. */
      var byMonth = {};
      (res.data || []).forEach(function (l) {
        var je = l.journal_entries || {};
        if (je.status && je.status !== 'posted') return;
        var key = (je.entry_date || '').substring(0, 7);
        if (!key) return;
        if (!byMonth[key]) byMonth[key] = { debit: 0, credit: 0 };
        byMonth[key].debit += Number(l.debit) || 0;
        byMonth[key].credit += Number(l.credit) || 0;
      });

      if (!Object.keys(byMonth).length) {
        box.innerHTML = window.utils.emptyStateHtml({
          icon: 'chart',
          title: 'لا يوجد نشاط مالي بعد',
          text: 'سيظهر النشاط المالي والرسوم البيانية هنا فور تسجيل الحركات المحاسبية.'
        });
        return;
      }

      var months = Object.keys(byMonth).sort();
      var max = 0;
      months.forEach(function (m) {
        max = Math.max(max, byMonth[m].debit, byMonth[m].credit);
      });
      if (max <= 0) max = 1;

      var bars = months.map(function (m) {
        var d = byMonth[m].debit, c = byMonth[m].credit;
        var dh = Math.round((d / max) * 100);
        var ch = Math.round((c / max) * 100);
        return '<div style="flex:1; display:flex; flex-direction:column; align-items:center; gap:6px; min-width:44px;">' +
          '<div style="display:flex; align-items:flex-end; gap:4px; height:120px;">' +
          '<div title="مدين: ' + window.utils.formatAmount(d) + '" style="width:16px; height:' + dh + '%; background:var(--primary-dark); border-radius:3px 3px 0 0;"></div>' +
          '<div title="دائن: ' + window.utils.formatAmount(c) + '" style="width:16px; height:' + ch + '%; background:var(--primary); border-radius:3px 3px 0 0;"></div>' +
          '</div>' +
          '<span class="text-muted fs-sm num">' + m + '</span>' +
          '</div>';
      }).join('');

      box.innerHTML =
        '<div class="d-flex gap-4 mb-4" style="font-size: var(--font-size-sm);">' +
        '<span class="d-flex align-center gap-2"><span style="width:12px;height:12px;background:var(--primary-dark);border-radius:2px;display:inline-block;"></span> مدين</span>' +
        '<span class="d-flex align-center gap-2"><span style="width:12px;height:12px;background:var(--primary);border-radius:2px;display:inline-block;"></span> دائن</span>' +
        '</div>' +
        '<div class="d-flex align-end gap-3" style="direction:ltr; overflow-x:auto; padding-bottom:4px;">' + bars + '</div>';
    }).catch(function () {
      box.innerHTML = window.utils.errorStateHtml({ retryId: 'retryActivity' });
      bindRetry('retryActivity', loadActivity);
    });
  }

  function bindRetry(id, fn) {
    var btn = document.getElementById(id);
    if (btn) btn.addEventListener('click', function () { fn(); });
  }
})();
