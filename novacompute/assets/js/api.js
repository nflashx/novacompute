/* ============================================================
   NovaCompute — shared API client.
   Talks to the Python backend (backend/app.py, port 8080).
   The customer's nova-sk-… key is stored in localStorage and
   sent as a Bearer token on every authenticated call.
   ============================================================ */

(function () {
  'use strict';

  const preset = (window.NOVA_API_BASE || '').trim();
  const meta = document.querySelector('meta[name="nova-api"]');
  window.NOVA_API_BASE = (preset || (meta && meta.content) || 'http://127.0.0.1:8080').replace(/\/+$/, '');

  /* Optional override for local testing: ?api=http://127.0.0.1:PORT */
  const apiOverride = new URLSearchParams(window.location.search).get('api');
  if (apiOverride) window.NOVA_API_BASE = apiOverride.replace(/\/+$/, '');

  window.novaSession = {
    get() {
      try {
        return JSON.parse(localStorage.getItem('nova_user') || 'null');
      } catch (err) {
        return null;
      }
    },
    set(user) {
      localStorage.setItem('nova_user', JSON.stringify(user));
    },
    update(patch) {
      const current = window.novaSession.get() || {};
      window.novaSession.set({ ...current, ...patch });
    },
    clear() {
      localStorage.removeItem('nova_user');
    },
  };

  /**
   * novaApi('/api/me', { method, body, auth }) → { ok, status, data }
   * Never throws: network failures resolve with status 0.
   */
  window.novaApi = async function novaApi(path, opts = {}) {
    const { method = 'GET', body, auth = true } = opts;
    const headers = { 'Content-Type': 'application/json' };
    if (auth) {
      const session = window.novaSession.get();
      if (session && session.api_key) headers.Authorization = `Bearer ${session.api_key}`;
    }

    let res;
    try {
      res = await fetch(window.NOVA_API_BASE + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (err) {
      return {
        ok: false,
        status: 0,
        data: {
          error: {
            type: 'network_error',
            code: 'backend_unreachable',
            message: 'Cannot reach the NovaCompute backend. Start it with start.bat (python app.py on port 8080).',
          },
        },
      };
    }

    let data = {};
    try {
      data = await res.json();
    } catch (err) {
      data = {};
    }
    return { ok: res.ok, status: res.status, data };
  };

  /* Show the real API base URL anywhere a [data-api-base] element exists. */
  window.novaApiBase = function () {
    const base = String(window.NOVA_API_BASE || 'http://127.0.0.1:8080').replace(/\/+$/, '').replace(/\/v1$/, '');
    return base + '/v1';
  };
  function paintApiBase() {
    document.querySelectorAll('[data-api-base]').forEach((el) => { el.textContent = window.novaApiBase(); });
  }
  paintApiBase();
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-copy-api-base]');
    if (!btn) return;
    const ok = window.novaCopy ? await window.novaCopy(window.novaApiBase()) : false;
    if (window.novaToast) window.novaToast(ok ? 'API base URL copied' : 'Copy failed', ok);
  });
})();
