/* ============================================================
   auth.js — Login page logic (Supabase Auth)
   ============================================================ */

(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', function () {
    var form = document.getElementById('loginForm');
    if (!form) return;

    var emailInput = document.getElementById('email');
    var passwordInput = document.getElementById('password');
    var submitBtn = document.getElementById('loginBtn');
    var alertBox = document.getElementById('loginAlert');
    var forgotLink = document.getElementById('forgotLink');

    /* If Supabase is not configured yet, inform the user instead of failing silently. */
    if (!window.db.isConfigured()) {
      showAlert('لم يتم إعداد الاتصال بقاعدة البيانات بعد. يرجى ضبط إعدادات Supabase في ملف js/config.js.', 'warning');
    }

    /* Already signed in? go to dashboard */
    window.db.getSession().then(function (res) {
      if (res && res.data && res.data.session) {
        window.location.href = 'dashboard.html';
      }
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      hideAlert();

      if (!window.utils.validateForm(form)) return;

      window.utils.setButtonLoading(submitBtn, true, 'جاري تسجيل الدخول...');

      window.db.signIn(emailInput.value.trim(), passwordInput.value).then(function (res) {
        window.utils.setButtonLoading(submitBtn, false);
        if (res.error) {
          if (window.utils.isNotConfigured(res.error)) {
            showAlert('لم يتم إعداد الاتصال بقاعدة البيانات بعد. يرجى ضبط إعدادات Supabase.', 'warning');
          } else {
            showAlert('تعذر تسجيل الدخول. يرجى التحقق من البريد الإلكتروني وكلمة المرور.', 'danger');
          }
          return;
        }
        window.location.href = 'dashboard.html';
      }).catch(function () {
        window.utils.setButtonLoading(submitBtn, false);
        showAlert('حدث خطأ غير متوقع. حاول مرة أخرى.', 'danger');
      });
    });

    forgotLink.addEventListener('click', function (e) {
      e.preventDefault();
      var email = emailInput.value.trim();
      if (!email) {
        showAlert('أدخل بريدك الإلكتروني أولاً ثم اضغط "نسيت كلمة المرور".', 'info');
        emailInput.focus();
        return;
      }
      window.db.resetPassword(email).then(function (res) {
        if (res.error) {
          showAlert('تعذر إرسال رابط الاستعادة. حاول مرة أخرى.', 'danger');
        } else {
          showAlert('تم إرسال رابط استعادة كلمة المرور إلى بريدك الإلكتروني.', 'success');
        }
      });
    });

    function showAlert(message, type) {
      alertBox.className = 'alert alert--' + (type || 'danger');
      alertBox.textContent = message;
      alertBox.style.display = 'flex';
    }

    function hideAlert() {
      alertBox.style.display = 'none';
    }
  });
})();
