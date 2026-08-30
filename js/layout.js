/* ============================================================
   layout.js — Shared app shell (topbar + sidebar) renderer
   Injected into every authenticated page so markup is not
   duplicated across HTML files.
   ============================================================ */

(function () {
  'use strict';

  var NAV = [
    {
      section: null,
      items: [
        { href: 'dashboard.html', key: 'dashboard', label: 'لوحة التحكم', icon: 'dashboard' }
      ]
    },
    {
      section: 'المحاسبة',
      items: [
        { href: 'pages/accounts.html', key: 'accounts', label: 'دليل الحسابات', icon: 'accounts' },
        { href: 'pages/journal.html', key: 'journal', label: 'القيود اليومية', icon: 'journal' },
        { href: 'pages/ledger.html', key: 'ledger', label: 'دفتر الأستاذ العام', icon: 'ledger' }
      ]
    },
    {
      section: 'المبيعات',
      items: [
        { href: 'pages/customers.html', key: 'customers', label: 'العملاء', icon: 'customers' },
        { href: 'pages/invoices.html', key: 'invoices', label: 'الفواتير', icon: 'invoices' }
      ]
    },
    {
      section: 'المشتريات',
      items: [
        { href: 'pages/suppliers.html', key: 'suppliers', label: 'الموردون', icon: 'suppliers' },
        { href: 'pages/expenses.html', key: 'expenses', label: 'المصروفات', icon: 'expenses' }
      ]
    },
    {
      section: null,
      items: [
        { href: 'pages/assets.html', key: 'assets', label: 'الأصول الثابتة', icon: 'assets' }
      ]
    },
    {
      section: 'التقارير',
      items: [
        { href: 'pages/trial-balance.html', key: 'trial-balance', label: 'ميزان المراجعة', icon: 'trial' },
        { href: 'pages/income-statement.html', key: 'income-statement', label: 'قائمة الدخل', icon: 'income' },
        { href: 'pages/balance-sheet.html', key: 'balance-sheet', label: 'الميزانية العمومية', icon: 'balance' }
      ]
    },
    {
      section: null,
      items: [
        { href: 'pages/settings.html', key: 'settings', label: 'الإعدادات', icon: 'settings' }
      ]
    }
  ];

  var SIDEBAR_ICONS = {
    dashboard: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/></svg>',
    accounts: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>',
    journal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>',
    ledger: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>',
    customers: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    invoices: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>',
    suppliers: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="3" width="15" height="13" rx="1"/><path d="M16 8h4l3 3v5h-7V8z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>',
    expenses: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>',
    assets: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18"/><path d="M5 21V7l7-4 7 4v14"/><path d="M9 21v-6h6v6"/></svg>',
    trial: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v18"/><path d="M5 7l7-4 7 4"/><path d="M3 13l2-6 2 6a3.5 3.5 0 0 1-4 0z"/><path d="M17 13l2-6 2 6a3.5 3.5 0 0 1-4 0z"/></svg>',
    income: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>',
    balance: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="2" x2="12" y2="22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>',
    settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>'
  };

  /**
   * Resolve a href so it works both from the root (dashboard.html)
   * and from inside /pages/.
   */
  function resolveHref(href, inPagesDir) {
    if (inPagesDir) {
      if (href.indexOf('pages/') === 0) return href.substring(6);
      return '../' + href;
    }
    return href;
  }

  function render(activeKey) {
    var mount = document.getElementById('app');
    if (!mount) return;
    var inPagesDir = location.pathname.indexOf('/pages/') !== -1;

    /* --- Sidebar nav --- */
    var navHtml = '';
    NAV.forEach(function (group) {
      navHtml += '<div class="sidebar__section">';
      if (group.section) navHtml += '<div class="sidebar__section-title">' + group.section + '</div>';
      group.items.forEach(function (item) {
        var href = resolveHref(item.href, inPagesDir);
        var active = item.key === activeKey ? ' is-active' : '';
        var aria = item.key === activeKey ? ' aria-current="page"' : '';
        navHtml += '<a class="sidebar__link' + active + '" href="' + href + '"' + aria + '>' +
          SIDEBAR_ICONS[item.icon] + '<span>' + item.label + '</span></a>';
      });
      navHtml += '</div>';
    });

    mount.innerHTML =
      '<div class="app-shell" id="appShell">' +
      '  <header class="topbar">' +
      '    <div class="topbar__brand">' +
      '      <button class="topbar__toggle" id="sidebarToggle" aria-label="تبديل القائمة الجانبية" aria-expanded="true">' +
      '        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>' +
      '      </button>' +
      '      <svg class="topbar__logo" viewBox="0 0 40 40" fill="none" aria-hidden="true">' +
      '        <rect width="40" height="40" rx="8" fill="#3E7FAE"/>' +
      '        <path d="M12 28V18m8 10V12m8 16v-7" stroke="#fff" stroke-width="3" stroke-linecap="round"/>' +
      '      </svg>' +
      '      <span class="topbar__brand-name">نظام المحاسبة</span>' +
      '    </div>' +
      '    <div class="topbar__search">' +
      '      <span class="topbar__search-icon">' +
      '        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>' +
      '      </span>' +
      '      <input type="search" id="globalSearch" placeholder="بحث..." aria-label="بحث عام">' +
      '    </div>' +
      '    <div class="topbar__actions">' +
      '      <button class="icon-btn" id="notifBtn" aria-label="الإشعارات">' +
      '        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>' +
      '        <span class="icon-btn__badge" id="notifBadge"></span>' +
      '      </button>' +
      '      <div class="user-menu">' +
      '        <button class="user-menu__trigger" id="userMenuTrigger" aria-haspopup="true" aria-expanded="false">' +
      '          <span class="user-menu__avatar" id="userAvatar">—</span>' +
      '          <span class="user-menu__label" id="userName">حسابي</span>' +
      '        </button>' +
      '        <div class="dropdown" id="userDropdown" role="menu">' +
      '          <div class="dropdown__header"><div class="fw-semibold" id="userEmail">—</div></div>' +
      '          <a class="dropdown__item" href="' + resolveHref('pages/settings.html', inPagesDir) + '" role="menuitem">الإعدادات</a>' +
      '          <button class="dropdown__item dropdown__item--danger" id="logoutBtn" role="menuitem">تسجيل الخروج</button>' +
      '        </div>' +
      '      </div>' +
      '    </div>' +
      '  </header>' +
      '  <div class="sidebar-backdrop" id="sidebarBackdrop"></div>' +
      '  <nav class="sidebar" id="sidebar" aria-label="التنقل الرئيسي">' + navHtml + '</nav>' +
      '  <main class="main" id="mainContent"></main>' +
      '</div>';

    wireShell(inPagesDir);
  }

  function wireShell(inPagesDir) {
    var shell = document.getElementById('appShell');
    var sidebar = document.getElementById('sidebar');
    var backdrop = document.getElementById('sidebarBackdrop');
    var toggle = document.getElementById('sidebarToggle');

    toggle.addEventListener('click', function () {
      if (window.innerWidth <= 768) {
        var open = sidebar.classList.toggle('is-open');
        backdrop.classList.toggle('is-visible', open);
        toggle.setAttribute('aria-expanded', String(open));
      } else {
        shell.classList.toggle('sidebar-collapsed');
      }
    });

    backdrop.addEventListener('click', function () {
      sidebar.classList.remove('is-open');
      backdrop.classList.remove('is-visible');
    });

    /* User dropdown */
    var trigger = document.getElementById('userMenuTrigger');
    var dropdown = document.getElementById('userDropdown');
    trigger.addEventListener('click', function (e) {
      e.stopPropagation();
      var open = dropdown.classList.toggle('is-open');
      trigger.setAttribute('aria-expanded', String(open));
    });
    document.addEventListener('click', function () {
      dropdown.classList.remove('is-open');
      trigger.setAttribute('aria-expanded', 'false');
    });

    /* Logout */
    document.getElementById('logoutBtn').addEventListener('click', function () {
      window.db.signOut().finally(function () {
        window.location.href = inPagesDir ? '../login.html' : 'login.html';
      });
    });

    /* Load current session user (no invented data). Row Level Security
       blocks every table for anonymous visitors, so an unauthenticated
       page can only show empty states — send them to login instead. */
    window.db.getSession().then(function (res) {
      var user = res && res.data && res.data.session ? res.data.session.user : null;
      if (!user) {
        document.getElementById('userEmail').textContent = 'غير مسجل الدخول';
        if (window.db.isConfigured()) {
          window.location.replace(inPagesDir ? '../login.html' : 'login.html');
        }
        return;
      }
      var email = user.email || '';
      document.getElementById('userEmail').textContent = email;
      document.getElementById('userName').textContent = email.split('@')[0] || 'حسابي';
      document.getElementById('userAvatar').textContent = (email.charAt(0) || '—').toUpperCase();
    });
  }

  /** Returns the <main> element where each page renders its content. */
  function mainEl() {
    return document.getElementById('mainContent');
  }

  window.layout = { render: render, mainEl: mainEl };
})();
