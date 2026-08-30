/* ============================================================
   assets.js — Fixed asset register with depreciation and
   book-value visualization. Table: fixed_assets.
   Book value = purchase_cost - accumulated_depreciation
   (computed from real records; never invented).
   ============================================================ */

(function () {
  'use strict';

  var DEPRECIATION_METHODS = {
    straight_line: 'القسط الثابت',
    declining_balance: 'القسط المتناقص',
    units_of_production: 'وحدات الإنتاج'
  };

  var state = { assets: [], search: '', page: 1, perPage: 12, editingId: null };

  document.addEventListener('DOMContentLoaded', function () {
    window.layout.render('assets');
    var main = window.layout.mainEl();

    main.innerHTML =
      '<nav class="breadcrumbs" aria-label="مسار التنقل">' +
      '  <a href="../dashboard.html">لوحة التحكم</a>' +
      '  <span class="breadcrumbs__sep">/</span>' +
      '  <span aria-current="page">الأصول الثابتة</span>' +
      '</nav>' +
      '<div class="page-header">' +
      '  <div>' +
      '    <h1 class="page-header__title">الأصول الثابتة</h1>' +
      '    <p class="page-header__subtitle">سجل الأصول والإهلاك والقيمة الدفترية</p>' +
      '  </div>' +
      '  <div class="page-header__actions">' +
      '    <button class="btn btn--primary" id="addAssetBtn">' + window.utils.iconSvg('plus') + ' أصل جديد</button>' +
      '  </div>' +
      '</div>' +
      '<div class="toolbar">' +
      '  <div class="toolbar__search">' +
      '    <span class="toolbar__search-icon">' + window.utils.iconSvg('search') + '</span>' +
      '    <input class="input" type="search" id="searchInput" placeholder="بحث بالاسم أو الرمز..." aria-label="بحث في الأصول">' +
      '  </div>' +
      '</div>' +
      '<div class="card">' +
      '  <div class="card__body card__body--flush" id="assetsTable">' + window.utils.loadingHtml() + '</div>' +
      '  <div class="card__footer">' +
      '    <span class="text-secondary fs-sm" id="countLabel"></span>' +
      '    <div class="pagination" id="pagination"></div>' +
      '  </div>' +
      '</div>' +

      /* Add/Edit modal */
      '<div class="modal-backdrop" id="assetModal">' +
      '  <div class="modal" role="dialog" aria-modal="true" aria-labelledby="assetModalTitle">' +
      '    <div class="modal__header">' +
      '      <h3 class="modal__title" id="assetModalTitle">أصل جديد</h3>' +
      '      <button class="modal__close" data-close-modal aria-label="إغلاق">' + window.utils.iconSvg('close') + '</button>' +
      '    </div>' +
      '    <form id="assetForm" novalidate>' +
      '      <div class="modal__body">' +
      '        <div class="form-grid">' +
      '          <div class="form-field">' +
      '            <label class="form-field__label" for="assetName">اسم الأصل <span class="form-field__required">*</span></label>' +
      '            <input class="input" id="assetName" required placeholder="مثال: جهاز حاسب آلي">' +
      '            <span class="form-field__error">اسم الأصل مطلوب</span>' +
      '          </div>' +
      '          <div class="form-field">' +
      '            <label class="form-field__label" for="assetCode">رمز الأصل <span class="form-field__required">*</span></label>' +
      '            <input class="input input--num" id="assetCode" required placeholder="FA-0001">' +
      '            <span class="form-field__error">رمز الأصل مطلوب</span>' +
      '          </div>' +
      '          <div class="form-field">' +
      '            <label class="form-field__label" for="purchaseDate">تاريخ الشراء <span class="form-field__required">*</span></label>' +
      '            <input class="input" type="date" id="purchaseDate" required>' +
      '            <span class="form-field__error">تاريخ الشراء مطلوب</span>' +
      '          </div>' +
      '          <div class="form-field">' +
      '            <label class="form-field__label" for="purchaseCost">تكلفة الشراء <span class="form-field__required">*</span></label>' +
      '            <input class="input input--num" type="number" id="purchaseCost" min="0.01" step="0.01" required placeholder="0.00">' +
      '            <span class="form-field__error">تكلفة الشراء مطلوبة</span>' +
      '          </div>' +
      '          <div class="form-field">' +
      '            <label class="form-field__label" for="usefulLife">العمر الإنتاجي (سنوات)</label>' +
      '            <input class="input input--num" type="number" id="usefulLife" min="1" step="1" placeholder="5">' +
      '          </div>' +
      '          <div class="form-field">' +
      '            <label class="form-field__label" for="depMethod">طريقة الإهلاك</label>' +
      '            <select class="input" id="depMethod">' +
      '              <option value="straight_line">القسط الثابت</option>' +
      '              <option value="declining_balance">القسط المتناقص</option>' +
      '              <option value="units_of_production">وحدات الإنتاج</option>' +
      '            </select>' +
      '          </div>' +
      '          <div class="form-field">' +
      '            <label class="form-field__label" for="accDep">مجمع الإهلاك</label>' +
      '            <input class="input input--num" type="number" id="accDep" min="0" step="0.01" value="0">' +
      '            <span class="form-field__hint">يُحدَّث عادةً عبر قيود الإهلاك الدورية.</span>' +
      '          </div>' +
      '          <div class="form-field">' +
      '            <label class="form-field__label" for="assetStatus">الحالة</label>' +
      '            <select class="input" id="assetStatus">' +
      '              <option value="active">نشط</option>' +
      '              <option value="inactive">خارج الخدمة</option>' +
      '            </select>' +
      '          </div>' +
      '        </div>' +
      '        <div class="alert alert--info mt-4">' +
      '          القيمة الدفترية الحالية = تكلفة الشراء − مجمع الإهلاك. تُحسب تلقائياً عند العرض.' +
      '        </div>' +
      '      </div>' +
      '      <div class="modal__footer">' +
      '        <button type="button" class="btn btn--secondary" data-close-modal>إلغاء</button>' +
      '        <button type="submit" class="btn btn--primary" id="saveAssetBtn">حفظ الأصل</button>' +
      '      </div>' +
      '    </form>' +
      '  </div>' +
      '</div>';

    window.utils.wireModals();
    document.getElementById('addAssetBtn').addEventListener('click', function () { openForm(null); });
    document.getElementById('assetForm').addEventListener('submit', saveAsset);
    document.getElementById('searchInput').addEventListener('input', function (e) {
      state.search = e.target.value.trim();
      state.page = 1;
      renderTable();
    });

    loadAssets();
  });

  function bookValue(a) {
    var cost = Number(a.purchase_cost) || 0;
    var dep = Number(a.accumulated_depreciation) || 0;
    return Math.max(cost - dep, 0);
  }

  function loadAssets() {
    var box = document.getElementById('assetsTable');
    box.innerHTML = window.utils.loadingHtml();

    window.db.fetchRows('fixed_assets', {
      select: 'id,name,code,purchase_date,purchase_cost,useful_life_years,depreciation_method,accumulated_depreciation,status',
      order: { col: 'code', ascending: true }
    }).then(function (res) {
      if (res.error) {
        box.innerHTML = window.utils.errorToState(res.error, 'retryAssets');
        bindRetry('retryAssets', loadAssets);
        return;
      }
      state.assets = res.data || [];
      renderTable();
    }).catch(function () {
      box.innerHTML = window.utils.errorStateHtml({ retryId: 'retryAssets' });
      bindRetry('retryAssets', loadAssets);
    });
  }

  function filtered() {
    return state.assets.filter(function (a) {
      if (!state.search) return true;
      var q = state.search.toLowerCase();
      return (a.name || '').toLowerCase().indexOf(q) !== -1 ||
             (a.code || '').toLowerCase().indexOf(q) !== -1;
    });
  }

  function renderTable() {
    var box = document.getElementById('assetsTable');
    var list = filtered();

    if (!state.assets.length) {
      box.innerHTML = window.utils.emptyStateHtml({
        icon: 'inbox',
        title: 'لا توجد أصول ثابتة حتى الآن',
        text: 'سجّل أول أصل ثابت لبدء متابعة الإهلاك والقيمة الدفترية.',
        actionLabel: 'إضافة أصل جديد',
        actionId: 'emptyAddBtn'
      });
      var b = document.getElementById('emptyAddBtn');
      if (b) b.addEventListener('click', function () { openForm(null); });
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

    var totalCost = 0, totalDep = 0, totalBook = 0;

    var html = '<div class="table-wrapper"><table class="table">' +
      '<thead><tr><th>الرمز</th><th>اسم الأصل</th><th>تاريخ الشراء</th>' +
      '<th class="num">تكلفة الشراء</th><th class="num">مجمع الإهلاك</th>' +
      '<th style="min-width:170px;">القيمة الدفترية</th><th>الحالة</th><th></th></tr></thead><tbody>';

    pageRows.forEach(function (a) {
      var cost = Number(a.purchase_cost) || 0;
      var dep = Number(a.accumulated_depreciation) || 0;
      var book = bookValue(a);
      totalCost += cost; totalDep += dep; totalBook += book;

      /* Visual: cost -> depreciation -> book value bar */
      var depPct = cost > 0 ? Math.min(Math.round((dep / cost) * 100), 100) : 0;
      var bookPct = 100 - depPct;

      html += '<tr>' +
        '<td class="num fw-semibold">' + window.utils.escapeHtml(a.code || '—') + '</td>' +
        '<td>' + window.utils.escapeHtml(a.name || '—') + '</td>' +
        '<td class="num">' + window.utils.formatDate(a.purchase_date) + '</td>' +
        '<td class="num">' + window.utils.formatAmount(cost) + '</td>' +
        '<td class="num">' + window.utils.formatAmount(dep) + '</td>' +
        '<td>' +
          '<div class="num fw-semibold mb-2">' + window.utils.formatAmount(book) + '</div>' +
          '<div style="display:flex; height:6px; border-radius:3px; overflow:hidden; background:var(--surface); direction:ltr;"' +
          ' title="تكلفة الشراء → الإهلاك → القيمة الدفترية">' +
          '<span style="width:' + bookPct + '%; background:var(--success);"></span>' +
          '<span style="width:' + depPct + '%; background:var(--warning);"></span>' +
          '</div>' +
          '<div class="text-muted" style="font-size: var(--font-size-xs);">' +
          (DEPRECIATION_METHODS[a.depreciation_method] || '—') +
          (a.useful_life_years ? ' · ' + window.utils.escapeHtml(String(a.useful_life_years)) + ' سنوات' : '') +
          '</div>' +
        '</td>' +
        '<td>' + window.utils.statusBadge(a.status === 'active' ? 'active' : 'inactive') + '</td>' +
        '<td><div class="row-actions">' +
        '<button class="row-action-btn" data-act="edit" data-id="' + a.id + '" aria-label="تعديل">' + window.utils.iconSvg('edit') + '</button>' +
        '<button class="row-action-btn row-action-btn--danger" data-act="delete" data-id="' + a.id + '" aria-label="حذف">' + window.utils.iconSvg('trash') + '</button>' +
        '</div></td></tr>';
    });

    html += '</tbody><tfoot><tr><td colspan="3">الإجمالي</td>' +
      '<td class="num">' + window.utils.formatAmount(totalCost) + '</td>' +
      '<td class="num">' + window.utils.formatAmount(totalDep) + '</td>' +
      '<td class="num">' + window.utils.formatAmount(totalBook) + '</td>' +
      '<td colspan="2"></td></tr></tfoot></table></div>';
    box.innerHTML = html;

    document.getElementById('countLabel').textContent = 'عدد الأصول: ' + list.length;
    window.utils.renderPagination(document.getElementById('pagination'), state.page, pageCount, function (p) {
      state.page = p;
      renderTable();
    });

    box.querySelectorAll('[data-act]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var a = state.assets.find(function (x) { return String(x.id) === String(btn.dataset.id); });
        if (!a) return;
        if (btn.dataset.act === 'edit') openForm(a);
        else if (btn.dataset.act === 'delete') deleteAsset(a);
      });
    });
  }

  function openForm(a) {
    state.editingId = a ? a.id : null;
    var form = document.getElementById('assetForm');
    form.reset();
    window.utils.clearValidation(form);
    document.getElementById('assetModalTitle').textContent = a ? 'تعديل الأصل' : 'أصل جديد';
    if (a) {
      document.getElementById('assetName').value = a.name || '';
      document.getElementById('assetCode').value = a.code || '';
      document.getElementById('purchaseDate').value = a.purchase_date || '';
      document.getElementById('purchaseCost').value = a.purchase_cost || '';
      document.getElementById('usefulLife').value = a.useful_life_years || '';
      document.getElementById('depMethod').value = a.depreciation_method || 'straight_line';
      document.getElementById('accDep').value = a.accumulated_depreciation || 0;
      document.getElementById('assetStatus').value = a.status || 'active';
    }
    window.utils.openModal('assetModal');
  }

  function saveAsset(e) {
    e.preventDefault();
    var form = e.target;
    if (!window.utils.validateForm(form)) return;

    var btn = document.getElementById('saveAssetBtn');
    window.utils.setButtonLoading(btn, true, 'جاري الحفظ...');

    var payload = {
      name: document.getElementById('assetName').value.trim(),
      code: document.getElementById('assetCode').value.trim(),
      purchase_date: document.getElementById('purchaseDate').value,
      purchase_cost: Number(document.getElementById('purchaseCost').value),
      useful_life_years: Number(document.getElementById('usefulLife').value) || null,
      depreciation_method: document.getElementById('depMethod').value,
      accumulated_depreciation: Number(document.getElementById('accDep').value) || 0,
      status: document.getElementById('assetStatus').value
    };

    var op = state.editingId
      ? window.db.updateRow('fixed_assets', state.editingId, payload)
      : window.db.insertRow('fixed_assets', payload);

    op.then(function (res) {
      window.utils.setButtonLoading(btn, false);
      if (res.error) {
        window.utils.toast(window.utils.isNotConfigured(res.error)
          ? 'لم يتم إعداد الاتصال بقاعدة البيانات بعد.'
          : 'تعذر حفظ البيانات', 'error');
        return;
      }
      window.utils.closeModal('assetModal');
      window.utils.toast('تم حفظ البيانات بنجاح', 'success');
      loadAssets();
    }).catch(function () {
      window.utils.setButtonLoading(btn, false);
      window.utils.toast('تعذر حفظ البيانات', 'error');
    });
  }

  function deleteAsset(a) {
    window.utils.confirmDialog('هل أنت متأكد من حذف هذا الأصل؟ لا يمكن التراجع عن هذه العملية.').then(function (ok) {
      if (!ok) return;
      window.db.deleteRow('fixed_assets', a.id).then(function (res) {
        if (res.error) { window.utils.toast('تعذر حذف الأصل', 'error'); return; }
        window.utils.toast('تم حذف الأصل بنجاح', 'success');
        loadAssets();
      }).catch(function () { window.utils.toast('تعذر حذف الأصل', 'error'); });
    });
  }

  function bindRetry(id, fn) {
    var b = document.getElementById(id);
    if (b) b.addEventListener('click', fn);
  }
})();
