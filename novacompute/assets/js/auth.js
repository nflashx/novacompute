/* ============================================================
   NovaCompute — login / register / email verification / OAuth.
   Backend endpoints:
       POST /api/register      → pending verification + code
       POST /api/verify        → create account, return API key
       POST /api/resend        → new verification code
       POST /api/login         → { user, api_key, balance }
       GET  /api/oauth/<p>/start
       POST /api/oauth/exchange
   ============================================================ */

(function () {
  'use strict';

  if (window.novaParticles) {
    window.novaParticles(document.getElementById('auth-particles'));
  }

  document.querySelectorAll('[data-toggle-password]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.dataset.togglePassword);
      if (!input) return;
      input.type = input.type === 'password' ? 'text' : 'password';
    });
  });

  function errorMessage(res, fallback) {
    return (res.data && res.data.error && res.data.error.message) || fallback;
  }

  function finishAuth(data, message) {
    window.novaSession.set({
      name: data.user.name,
      email: data.user.email,
      api_key: data.api_key,
      balance: data.balance,
      is_admin: !!(data.user && data.user.is_admin),
    });
    window.novaToast(message || 'Signed in — loading your dashboard…');
    setTimeout(() => { window.location.href = 'dashboard.html'; }, 320);
  }

  async function exchangeOAuth(token) {
    const res = await window.novaApi('/api/oauth/exchange', {
      method: 'POST', auth: false, body: { token },
    });
    if (!res.ok) {
      window.novaToast(errorMessage(res, 'OAuth sign-in failed. Try again.'), false);
      return;
    }
    finishAuth(res.data, 'Signed in — loading your dashboard…');
  }

  /* OAuth redirect-back handling (Google/GitHub callback server on :8600). */
  const params = new URLSearchParams(window.location.search);
  const oauthToken = params.get('oauth_token');
  const oauthError = params.get('oauth_error');
  if (oauthToken) {
    history.replaceState({}, '', window.location.pathname);
    exchangeOAuth(oauthToken);
  } else if (oauthError) {
    history.replaceState({}, '', window.location.pathname);
    window.novaToast(oauthError, false);
  }

  /* ---------------- Login ---------------- */
  const loginForm = document.getElementById('login-form');
  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('login-email');
      const password = document.getElementById('login-password');
      const btn = loginForm.querySelector('button[type="submit"]');

      if (!email.value.trim() || !email.checkValidity()) {
        window.novaToast('Please enter a valid email address.', false);
        email.focus();
        return;
      }
      if (!password.value) {
        window.novaToast('Please enter your password.', false);
        password.focus();
        return;
      }

      btn.disabled = true;
      const original = btn.textContent;
      btn.textContent = 'Signing in…';

      const res = await window.novaApi('/api/login', {
        method: 'POST',
        auth: false,
        body: { email: email.value.trim(), password: password.value },
      });

      btn.disabled = false;
      btn.textContent = original;

      if (!res.ok) {
        window.novaToast(errorMessage(res, 'Sign-in failed.'), false);
        return;
      }
      finishAuth(res.data, 'Welcome back — loading your dashboard…');
    });
  }

  /* ---------------- Register (two-step) ---------------- */
  const regForm = document.getElementById('register-form');
  const verifyPanel = document.getElementById('verify-panel');
  const verifyForm = document.getElementById('verify-form');
  const verifyEmailEl = document.getElementById('verify-email');
  const verifyCode = document.getElementById('verify-code');
  const devNote = document.getElementById('verify-dev-note');
  const devCode = document.getElementById('verify-dev-code');
  const resendBtn = document.getElementById('resend-code');
  let pendingEmail = '';
  let resendTimer = null;

  function showVerifyPanel(email, dev) {
    pendingEmail = email;
    if (verifyEmailEl) verifyEmailEl.textContent = email;
    if (regForm) regForm.classList.add('hidden');
    if (verifyPanel) verifyPanel.classList.remove('hidden');
    if (devNote && dev) {
      devNote.classList.remove('hidden');
      if (devCode) devCode.textContent = dev;
      if (verifyCode) verifyCode.value = dev;
    } else if (devNote) {
      devNote.classList.add('hidden');
    }
    if (verifyCode) verifyCode.focus();
  }

  function startResendCooldown() {
    if (!resendBtn) return;
    let left = 45;
    resendBtn.disabled = true;
    resendBtn.textContent = `Resend in ${left}s`;
    clearInterval(resendTimer);
    resendTimer = setInterval(() => {
      left -= 1;
      if (left <= 0) {
        clearInterval(resendTimer);
        resendBtn.disabled = false;
        resendBtn.textContent = 'Resend code';
      } else {
        resendBtn.textContent = `Resend in ${left}s`;
      }
    }, 1000);
  }

  if (regForm) {
    regForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('reg-name');
      const email = document.getElementById('reg-email');
      const password = document.getElementById('reg-password');
      const terms = document.getElementById('reg-terms');
      const btn = regForm.querySelector('button[type="submit"]');

      if (!name.value.trim()) {
        window.novaToast('Please enter your full name.', false);
        name.focus();
        return;
      }
      if (!email.value.trim() || !email.checkValidity()) {
        window.novaToast('Please enter a valid email address.', false);
        email.focus();
        return;
      }
      if (password.value.length < 8) {
        window.novaToast('Password must be at least 8 characters.', false);
        password.focus();
        return;
      }
      if (!terms.checked) {
        window.novaToast('Please accept the Terms of Service.', false);
        return;
      }

      btn.disabled = true;
      const original = btn.textContent;
      btn.textContent = 'Sending code…';

      const res = await window.novaApi('/api/register', {
        method: 'POST',
        auth: false,
        body: { name: name.value.trim(), email: email.value.trim(), password: password.value },
      });

      btn.disabled = false;
      btn.textContent = original;

      if (!res.ok) {
        window.novaToast(errorMessage(res, 'Registration failed.'), false);
        return;
      }

      const dev = res.data.dev_code || '';
      showVerifyPanel(res.data.email, dev);
      window.novaToast(dev ? 'SMTP is not configured — DEV code filled in.' : 'Verification code sent. Check your inbox.', !!dev);
      startResendCooldown();
    });
  }

  if (verifyForm) {
    verifyForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const code = (verifyCode.value || '').trim();
      if (code.length !== 6) {
        window.novaToast('Enter the 6-digit code from your email.', false);
        verifyCode.focus();
        return;
      }
      const btn = verifyForm.querySelector('button[type="submit"]');
      btn.disabled = true;
      const original = btn.textContent;
      btn.textContent = 'Verifying…';
      const res = await window.novaApi('/api/verify', {
        method: 'POST', auth: false, body: { email: pendingEmail, code },
      });
      btn.disabled = false;
      btn.textContent = original;
      if (!res.ok) {
        window.novaToast(errorMessage(res, 'Verification failed.'), false);
        return;
      }
      finishAuth(res.data, 'Email verified — your API key is ready.');
    });
  }

  if (resendBtn) {
    resendBtn.addEventListener('click', async () => {
      if (!pendingEmail) return;
      resendBtn.disabled = true;
      const res = await window.novaApi('/api/resend', {
        method: 'POST', auth: false, body: { email: pendingEmail },
      });
      if (!res.ok) {
        window.novaToast(errorMessage(res, 'Could not resend the code.'), false);
        resendBtn.disabled = false;
        return;
      }
      if (res.data.dev_code && devNote) {
        devNote.classList.remove('hidden');
        devCode.textContent = res.data.dev_code;
        verifyCode.value = res.data.dev_code;
        window.novaToast('DEV code filled in — configure SMTP for real email.', true);
      } else {
        window.novaToast('A new code has been sent.', true);
      }
      startResendCooldown();
    });
  }

  /* ---------------- Google / GitHub OAuth ---------------- */
  document.querySelectorAll('[data-sso]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const provider = (btn.dataset.sso || '').toLowerCase();
      if (!provider) return;
      const original = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Redirecting…';
      const res = await window.novaApi(`/api/oauth/${provider}/start`, { auth: false });
      if (!res.ok || !res.data.url) {
        btn.disabled = false;
        btn.textContent = original;
        window.novaToast(errorMessage(res, `${provider} sign-in is not configured yet.`), false);
        return;
      }
      window.location.href = res.data.url;
    });
  });
})();
