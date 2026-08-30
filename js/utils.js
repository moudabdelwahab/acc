/* ============================================================
   utils.js — Formatting helpers, validation, shared UI helpers
   ============================================================ */

(function () {
  'use strict';

  /* ---------- Formatting ---------- */

  /** Format a number as a currency-ish amount (tabular, LTR). */
  function formatAmount(value, decimals) {
    if (value === null || value === undefined || isNaN(Number(value))) return '—';
    var n = Number(value);
    var d = typeof decimals === 'number' ? decimals : 2;
    return n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  }

  /** Format ISO date string to YYYY-MM-DD for display. */
  function formatDate(value) {
    if (!value) return '—';
    var d = new Date(value);
    if (isNaN(d.getTime())) return String(value);
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  function todayISO() {
    return formatDate(new Date().toISOString());
  }

  /** Escape user-provided text before injecting into HTML. */
  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /* ---------- Toast notifications ---------- */

  function toast(message, type) {
    type = type || 'info';
    var container = document.querySelector('.toast-container');
    if (!container) {
      container = document.createElement('div');
      container.className = 'toast-container';
      container.setAttribute('aria-live', 'polite');
      document.body.appendChild(container);
    }
    var el = document.createElement('div');
    el.className = 'toast toast--' + type;
    el.setAttribute('role', 'status');
    el.textContent = message;
    container.appendChild(el);
    setTimeout(function () {
      el.style.opacity = '0';
      el.style.transition = 'opacity 200ms ease';
      setTimeout(function () { el.remove(); }, 220);
    }, 3500);
  }

  /* ---------- State renderers ---------- */

  function loadingHtml(text) {
    return '<div class="loading-block"><span class="spinner spinner--lg"></span><span>' +
      escapeHtml(text || 'جاري تحميل البيانات...') + '</span></div>';
  }

  function emptyStateHtml(opts) {
    opts = opts || {};
    var btn = '';
    if (opts.actionLabel && opts.actionHref) {
      btn = '<div class="state-block__actions"><a class="btn btn--primary" href="' + opts.actionHref + '">' +
        escapeHtml(opts.actionLabel) + '</a></div>';
    } else if (opts.actionLabel && opts.actionId) {
      btn = '<div class="state-block__actions"><button class="btn btn--primary" id="' + opts.actionId + '">' +
        escapeHtml(opts.actionLabel) + '</button></div>';
    }
    return '<div class="state-block">' +
      '<div class="state-block__icon">' + iconSvg(opts.icon || 'inbox') + '</div>' +
      '<div class="state-block__title">' + escapeHtml(opts.title || 'لا توجد بيانات لعرضها') + '</div>' +
      '<p class="state-block__text">' + escapeHtml(opts.text || '') + '</p>' +
      btn + '</div>';
  }

  function errorStateHtml(opts) {
    opts = opts || {};
    return '<div class="state-block state-block--error">' +
      '<div class="state-block__icon">' + iconSvg('alert') + '</div>' +
      '<div class="state-block__title">' + escapeHtml(opts.title || 'تعذر تحميل البيانات') + '</div>' +
      '<p class="state-block__text">' + escapeHtml(opts.text || 'حدث خطأ أثناء تحميل البيانات. حاول مرة أخرى.') + '</p>' +
      (opts.retryId ? '<div class="state-block__actions"><button class="btn btn--secondary" id="' + opts.retryId + '">إعادة المحاولة</button></div>' : '') +
      '</div>';
  }

  /** Is this a "not configured" error from the db layer? */
  function isNotConfigured(error) {
    return error && error.message === 'SUPABASE_NOT_CONFIGURED';
  }

  /** Standard handler: returns HTML string for an error (config-aware). */
  function errorToState(error, retryId) {
    if (isNotConfigured(error)) {
      return emptyStateHtml({
        icon: 'settings',
        title: 'لم يتم إعداد الاتصال بقاعدة البيانات',
        text: 'يرجى ضبط عنوان مشروع Supabase والمفتاح العام في ملف js/supabase.js ليتم عرض البيانات.'
      });
    }
    return errorStateHtml({ retryId: retryId, text: (error && error.message) || undefined });
  }

  /* ---------- Badge helpers ---------- */

  var STATUS_BADGES = {
    draft: { cls: 'badge--neutral', label: 'مسودة' },
    posted: { cls: 'badge--success', label: 'مُرحَّل' },
    sent: { cls: 'badge--info', label: 'مُرسلة' },
    paid: { cls: 'badge--success', label: 'مدفوعة' },
    partially_paid: { cls: 'badge--warning', label: 'مدفوعة جزئياً' },
    overdue: { cls: 'badge--danger', label: 'متأخرة' },
    cancelled: { cls: 'badge--neutral', label: 'ملغاة' },
    active: { cls: 'badge--success', label: 'نشط' },
    inactive: { cls: 'badge--neutral', label: 'غير نشط' },
    pending: { cls: 'badge--warning', label: 'قيد الانتظار' },
    approved: { cls: 'badge--success', label: 'معتمد' }
  };

  function statusBadge(status) {
    var meta = STATUS_BADGES[status] || { cls: 'badge--neutral', label: status || '—' };
    return '<span class="badge ' + meta.cls + '">' + escapeHtml(meta.label) + '</span>';
  }

  /* ---------- Minimal inline SVG icons ---------- */

  var ICONS = {
    inbox: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>',
    alert: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
    settings: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
    plus: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
    search: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
    edit: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4Z"/></svg>',
    trash: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
    eye: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>',
    document: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>',
    users: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    chart: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>',
    close: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'
  };

  function iconSvg(name) {
    return ICONS[name] || ICONS.inbox;
  }

  /* ---------- Form validation ---------- */

  /** Validate required fields inside a form. Returns true when valid. */
  function validateForm(form) {
    var valid = true;
    form.querySelectorAll('[required]').forEach(function (input) {
      var field = input.closest('.form-field');
      var ok = input.value && input.value.trim() !== '';
      if (input.type === 'number' && input.value === '') ok = false;
      if (field) field.classList.toggle('has-error', !ok);
      if (!ok) valid = false;
    });
    return valid;
  }

  function clearValidation(form) {
    form.querySelectorAll('.form-field.has-error').forEach(function (f) {
      f.classList.remove('has-error');
    });
  }

  /* ---------- Modal helper ---------- */

  function openModal(id) {
    var el = document.getElementById(id);
    if (el) el.classList.add('is-open');
  }

  function closeModal(id) {
    var el = document.getElementById(id);
    if (el) el.classList.remove('is-open');
  }

  /** Wire backdrop click + close buttons for all modals on the page. */
  function wireModals() {
    document.querySelectorAll('.modal-backdrop').forEach(function (backdrop) {
      backdrop.addEventListener('click', function (e) {
        if (e.target === backdrop) backdrop.classList.remove('is-open');
      });
      backdrop.querySelectorAll('[data-close-modal]').forEach(function (btn) {
        btn.addEventListener('click', function () { backdrop.classList.remove('is-open'); });
      });
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        document.querySelectorAll('.modal-backdrop.is-open').forEach(function (m) {
          m.classList.remove('is-open');
        });
      }
    });
  }

  /* ---------- Confirm dialog (promise-based) ---------- */

  function confirmDialog(message) {
    return new Promise(function (resolve) {
      var backdrop = document.createElement('div');
      backdrop.className = 'modal-backdrop is-open';
      backdrop.innerHTML =
        '<div class="modal" role="alertdialog" aria-modal="true">' +
        '<div class="modal__header"><h3 class="modal__title">تأكيد العملية</h3>' +
        '<button class="modal__close" data-act="cancel" aria-label="إغلاق">' + iconSvg('close') + '</button></div>' +
        '<div class="modal__body"><p>' + escapeHtml(message) + '</p></div>' +
        '<div class="modal__footer">' +
        '<button class="btn btn--secondary" data-act="cancel">إلغاء</button>' +
        '<button class="btn btn--danger" data-act="confirm">تأكيد الحذف</button>' +
        '</div></div>';
      document.body.appendChild(backdrop);
      backdrop.addEventListener('click', function (e) {
        var act = e.target.closest('[data-act]');
        if (e.target === backdrop || (act && act.dataset.act === 'cancel')) {
          backdrop.remove(); resolve(false);
        } else if (act && act.dataset.act === 'confirm') {
          backdrop.remove(); resolve(true);
        }
      });
    });
  }

  /* ---------- Button loading state ---------- */

  function setButtonLoading(btn, loading, loadingText) {
    if (!btn) return;
    if (loading) {
      btn.dataset.originalText = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner spinner--light"></span> ' + escapeHtml(loadingText || 'جاري الحفظ...');
    } else {
      btn.disabled = false;
      if (btn.dataset.originalText) btn.innerHTML = btn.dataset.originalText;
    }
  }

  /* ---------- Simple pagination renderer ---------- */

  function renderPagination(container, page, pageCount, onPage) {
    if (!container) return;
    if (pageCount <= 1) { container.innerHTML = ''; return; }
    var html = '';
    html += '<button class="pagination__btn" data-page="' + (page - 1) + '"' + (page <= 1 ? ' disabled' : '') + '>‹</button>';
    for (var i = 1; i <= pageCount; i++) {
      if (pageCount > 7 && i > 2 && i < pageCount - 1 && Math.abs(i - page) > 1) {
        if (!html.endsWith('<span class="pagination__btn" aria-hidden="true">…</span>')) {
          html += '<span class="pagination__btn" aria-hidden="true">…</span>';
        }
        continue;
      }
      html += '<button class="pagination__btn' + (i === page ? ' is-active' : '') + '" data-page="' + i + '">' + i + '</button>';
    }
    html += '<button class="pagination__btn" data-page="' + (page + 1) + '"' + (page >= pageCount ? ' disabled' : '') + '>›</button>';
    container.innerHTML = html;
    container.querySelectorAll('button[data-page]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var p = parseInt(btn.dataset.page, 10);
        if (p >= 1 && p <= pageCount && p !== page) onPage(p);
      });
    });
  }

  window.utils = {
    formatAmount: formatAmount,
    formatDate: formatDate,
    todayISO: todayISO,
    escapeHtml: escapeHtml,
    toast: toast,
    loadingHtml: loadingHtml,
    emptyStateHtml: emptyStateHtml,
    errorStateHtml: errorStateHtml,
    errorToState: errorToState,
    isNotConfigured: isNotConfigured,
    statusBadge: statusBadge,
    iconSvg: iconSvg,
    validateForm: validateForm,
    clearValidation: clearValidation,
    openModal: openModal,
    closeModal: closeModal,
    wireModals: wireModals,
    confirmDialog: confirmDialog,
    setButtonLoading: setButtonLoading,
    renderPagination: renderPagination
  };
})();
