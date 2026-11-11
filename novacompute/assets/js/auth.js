/* ============================================================
   NovaCompute — login / register.
   Calls the Python backend:
       POST /api/login     → { user, api_key, balance }
       POST /api/register  → { user, api_key, balance }
   On success the session (with the real nova-sk-… key) is stored
   in localStorage and the browser moves on to the dashboard.
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

      window.novaSession.set({
        name: res.data.user.name,
        email: res.data.user.email,
        api_key: res.data.api_key,
        balance: res.data.balance,
      });
      window.novaToast('Welcome back — loading your dashboard…');
      setTimeout(() => { window.location.href = 'dashboard.html'; }, 350);
    });
  }

  /* ---------------- Register ---------------- */
  const regForm = document.getElementById('register-form');
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
      btn.textContent = 'Creating account…';

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

      window.novaSession.set({
        name: res.data.user.name,
        email: res.data.user.email,
        api_key: res.data.api_key,
        balance: res.data.balance,
      });
      window.novaToast('Account created — your API key is ready.');
      setTimeout(() => { window.location.href = 'dashboard.html'; }, 350);
    });
  }

  /* ---------------- SSO (not implemented in the demo) ---------------- */
  document.querySelectorAll('[data-sso]').forEach((btn) => {
    btn.addEventListener('click', () => {
      window.novaToast(`${btn.dataset.sso} sign-in is not available in this demo build.`, false);
    });
  });
})();
