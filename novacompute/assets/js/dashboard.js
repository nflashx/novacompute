/* ============================================================
   NovaCompute — Dashboard (live data from backend/app.py).
   Requires a session in localStorage (set by login/register).
   All numbers come from GET /api/me; key changes hit the real
   /api/keys endpoints, top-ups hit /api/topup.
   ============================================================ */

(function () {
  'use strict';

  const session = window.novaSession ? window.novaSession.get() : null;
  if (!session || !session.api_key) {
    window.location.replace('login.html');
    return;
  }

  const panels = document.querySelectorAll('[data-panel]');
  const navButtons = document.querySelectorAll('[data-nav]');
  if (!panels.length) return;

  let state = { me: null };
  const charts = { usage: null, requests: null };

  /* ================= helpers ================= */
  const money = (v) => `$${Number(v || 0).toFixed(2)}`;
  const tokensShort = (v) => {
    if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
    if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
    return String(v || 0);
  };
  const timeShort = (ts) => new Date(ts * 1000).toLocaleTimeString([], { hour12: false });
  const dateShort = (ts) => new Date(ts * 1000).toLocaleDateString([], { month: 'short', day: '2-digit' });
  const relative = (isoStr) => {
    if (!isoStr) return 'Never';
    const then = new Date(isoStr).getTime();
    if (Number.isNaN(then)) return 'Never';
    const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins} min ago`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.round(hours / 24)}d ago`;
  };

  function delta(el, pct) {
    if (!el) return;
    if (pct === null || pct === undefined) {
      el.textContent = 'no data from yesterday';
      el.className = 'mt-3 text-xs text-slate-500';
      return;
    }
    const up = pct >= 0;
    el.textContent = `${up ? '▲' : '▼'} ${Math.abs(pct).toFixed(1)}% vs yesterday`;
    el.className = `mt-3 text-xs ${up ? 'text-emerald-400' : 'text-red-300'}`;
  }

  /* ================= section switching ================= */
  function showPanel(name) {
    panels.forEach((p) => {
      const active = p.dataset.panel === name;
      p.classList.toggle('hidden', !active);
      if (active) {
        p.querySelectorAll('.reveal').forEach((el) => el.classList.add('is-visible'));
        if (name === 'overview') ensureChart('usage');
        if (name === 'usage') ensureChart('requests');
      }
    });
    navButtons.forEach((b) => b.classList.toggle('is-active', b.dataset.nav === name));
  }

  navButtons.forEach((btn) => {
    btn.addEventListener('click', () => showPanel(btn.dataset.nav));
  });

  document.querySelector('[data-action="go-billing"]').addEventListener('click', () => {
    showPanel('billing');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  /* ================= charts ================= */
  const DARK_TOOLTIP = {
    backgroundColor: '#141c30',
    borderColor: 'rgba(148,163,184,0.2)',
    borderWidth: 1,
    titleColor: '#e2e8f0',
    bodyColor: '#cbd5e1',
    padding: 10,
    cornerRadius: 8,
    displayColors: false,
  };

  function chartDefaults() {
    Chart.defaults.color = '#94a3b8';
    Chart.defaults.font.family = 'Inter, sans-serif';
    Chart.defaults.font.size = 11;
  }

  function ensureChart(which) {
    if (typeof Chart === 'undefined' || charts[which] || !state.me) return;
    chartDefaults();
    const daily = state.me.daily || [];
    const labels = daily.map((d) => d.date);

    if (which === 'usage') {
      const ctx = document.getElementById('chart-usage').getContext('2d');
      const gradient = ctx.createLinearGradient(0, 0, 0, 280);
      gradient.addColorStop(0, 'rgba(139, 92, 246, 0.22)');
      gradient.addColorStop(1, 'rgba(139, 92, 246, 0)');
      charts.usage = new Chart(ctx, {
        type: 'line',
        data: {
          labels,
          datasets: [{
            data: daily.map((d) => +(d.tokens / 1000).toFixed(2)),
            borderColor: '#a78bfa',
            backgroundColor: gradient,
            borderWidth: 2,
            tension: 0.35,
            pointRadius: 0,
            pointHoverRadius: 4,
            pointBackgroundColor: '#c4b5fd',
            fill: true,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              ...DARK_TOOLTIP,
              callbacks: { label: (item) => ` ${item.parsed.y.toFixed(1)}K tokens` },
            },
          },
          scales: {
            x: { grid: { display: false }, border: { display: false } },
            y: {
              beginAtZero: true,
              grid: { color: 'rgba(148,163,184,0.08)' },
              border: { display: false },
              ticks: { maxTicksLimit: 6, callback: (v) => `${v}K` },
            },
          },
        },
      });
    }

    if (which === 'requests') {
      const ctx = document.getElementById('chart-requests').getContext('2d');
      charts.requests = new Chart(ctx, {
        type: 'bar',
        data: {
          labels,
          datasets: [{
            data: daily.map((d) => d.requests),
            backgroundColor: '#22d3ee',
            hoverBackgroundColor: '#67e8f9',
            borderRadius: 4,
            maxBarThickness: 18,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              ...DARK_TOOLTIP,
              callbacks: { label: (item) => ` ${item.parsed.y} requests` },
            },
          },
          scales: {
            x: { grid: { display: false }, border: { display: false } },
            y: {
              beginAtZero: true,
              grid: { color: 'rgba(148,163,184,0.08)' },
              border: { display: false },
              ticks: { maxTicksLimit: 6, precision: 0 },
            },
          },
        },
      });
    }
  }

  /* ================= render ================= */
  function renderHeader() {
    const me = state.me;
    const subtitle = document.getElementById('dash-subtitle');
    if (subtitle) subtitle.textContent = `${me.user.email} · ${me.stats.total_requests} requests all-time`;
    const badge = document.getElementById('dash-badge');
    if (badge) badge.textContent = 'live workspace';
  }

  function renderStats() {
    const me = state.me;
    document.getElementById('balance-figure').textContent = money(me.balance);
    document.getElementById('billing-balance').textContent = money(me.balance);

    const reqEl = document.getElementById('stat-requests');
    const tokEl = document.getElementById('stat-tokens');
    const latEl = document.getElementById('stat-latency');
    if (reqEl) reqEl.textContent = me.stats.requests_today.toLocaleString();
    if (tokEl) tokEl.textContent = tokensShort(me.stats.tokens_today);
    if (latEl) latEl.innerHTML = `${me.stats.avg_latency_ms || 0}<span class="text-lg text-slate-400">ms</span>`;
    delta(document.getElementById('stat-requests-delta'), me.stats.requests_delta_pct);
    delta(document.getElementById('stat-tokens-delta'), me.stats.tokens_delta_pct);

    const nameInput = document.getElementById('set-name');
    const emailInput = document.getElementById('set-email');
    const companyInput = document.getElementById('set-company');
    if (nameInput) nameInput.value = me.user.name || '';
    if (emailInput) emailInput.value = me.user.email || '';
    if (companyInput) companyInput.value = me.user.company || '';
  }

  function renderRecent() {
    const tbody = document.getElementById('recent-requests');
    if (!tbody) return;
    if (!state.me.recent.length) {
      tbody.innerHTML = `<tr><td colspan="5" class="px-6 py-10 text-center text-sm text-slate-500">
        No requests yet — send one from the <a href="playground.html" class="text-violet-300 hover:text-violet-200">Playground</a>.
      </td></tr>`;
      return;
    }
    tbody.innerHTML = state.me.recent.map((r) => `
      <tr class="transition-colors hover:bg-white/[0.03]">
        <td class="px-6 py-3.5 font-mono text-xs text-slate-500">${timeShort(r.ts)}</td>
        <td class="px-4 py-3.5 font-mono text-xs text-slate-300">${r.model}</td>
        <td class="px-4 py-3.5 text-right font-mono text-xs">${Number(r.tokens).toLocaleString()}</td>
        <td class="px-4 py-3.5 text-right font-mono text-xs">${r.latency_ms}ms</td>
        <td class="px-6 py-3.5 text-right">
          ${r.status === 'ok'
            ? '<span class="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/20 bg-emerald-400/[0.07] px-2.5 py-0.5 text-[11px] font-medium text-emerald-300"><span class="h-1.5 w-1.5 rounded-full bg-emerald-400"></span>200</span>'
            : '<span class="inline-flex items-center gap-1.5 rounded-full border border-red-400/20 bg-red-400/[0.07] px-2.5 py-0.5 text-[11px] font-medium text-red-300"><span class="h-1.5 w-1.5 rounded-full bg-red-400"></span>ERR</span>'}
        </td>
      </tr>`).join('');
  }

  function renderUsageByModel() {
    const tbody = document.getElementById('usage-by-model');
    if (!tbody) return;
    const rows = state.me.by_model.slice(0, 8);
    const total = rows.reduce((sum, r) => sum + r.tokens, 0) || 1;
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="4" class="px-6 py-10 text-center text-sm text-slate-500">No usage recorded yet.</td></tr>`;
      return;
    }
    tbody.innerHTML = rows.map((r) => {
      const model = window.NOVA_MODEL_BY_ID(r.id) || { name: r.id, color: '#8b5cf6' };
      const share = Math.round((r.tokens / total) * 100);
      return `
        <tr class="transition-colors hover:bg-white/[0.03]">
          <td class="px-6 py-3.5">
            <div class="flex items-center gap-2.5">
              <span class="flex h-6 w-6 items-center justify-center rounded text-[10px] font-bold"
                    style="background:${window.novaRgba(model.color, 0.15)};color:${model.color}">${model.name.charAt(0)}</span>
              <span class="text-xs text-slate-200">${model.name}</span>
            </div>
          </td>
          <td class="px-4 py-3.5 text-right font-mono text-xs">${r.requests.toLocaleString()}</td>
          <td class="px-4 py-3.5 text-right font-mono text-xs">${tokensShort(r.tokens)}</td>
          <td class="px-6 py-3.5">
            <div class="flex items-center gap-3">
              <div class="h-1.5 w-36 overflow-hidden rounded-full bg-white/10">
                <div class="h-full rounded-full" style="width:${Math.max(2, share * 2.4)}%;background:${model.color}"></div>
              </div>
              <span class="font-mono text-xs text-slate-400">${share}%</span>
            </div>
          </td>
        </tr>`;
    }).join('');
  }

  function renderTransactions() {
    const tbody = document.getElementById('transactions-tbody');
    if (!tbody) return;
    const rows = (state.me.transactions || []).slice(0, 8);
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="4" class="px-6 py-8 text-center text-sm text-slate-500">No transactions yet.</td></tr>`;
      return;
    }
    tbody.innerHTML = rows.map((t) => {
      const isTopup = t.type === 'topup';
      const amount = Number(t.amount);
      return `<tr>
        <td class="px-6 py-3.5 text-slate-400">${dateShort(t.ts)}</td>
        <td class="px-4 py-3.5">${t.description}</td>
        <td class="px-4 py-3.5 text-slate-400">${t.method}</td>
        <td class="px-6 py-3.5 text-right font-mono ${isTopup ? 'text-emerald-400' : amount === 0 ? 'text-slate-500' : 'text-slate-200'}">
          ${isTopup ? '+' : ''}${money(amount)}
        </td>
      </tr>`;
    }).join('');
  }

  /* ================= API keys ================= */
  let keysCache = [];
  let revealed = {};

  function renderKeys() {
    const tbody = document.getElementById('keys-tbody');
    if (!tbody) return;
    if (!keysCache.length) {
      tbody.innerHTML = `<tr><td colspan="5" class="px-6 py-10 text-center text-sm text-slate-500">No active keys.</td></tr>`;
      return;
    }
    tbody.innerHTML = keysCache.map((k) => `
      <tr class="transition-colors hover:bg-white/[0.03]">
        <td class="px-6 py-4 font-medium text-white">${k.name}</td>
        <td class="px-4 py-4">
          <code class="font-mono text-xs ${revealed[k.id] ? 'text-emerald-300' : 'text-slate-400'}">${revealed[k.id] ? k.key : `${k.key.slice(0, 12)}…${k.key.slice(-4)}`}</code>
        </td>
        <td class="px-4 py-4 text-xs text-slate-500">${k.created_at ? dateShort(Date.parse(k.created_at) / 1000) : '—'}</td>
        <td class="px-4 py-4 text-xs text-slate-500">${relative(k.last_used)}</td>
        <td class="px-6 py-4">
          <div class="flex items-center justify-end gap-1.5">
            <button type="button" data-key-action="copy" data-key-id="${k.id}" class="btn-ghost rounded-md px-2.5 py-1.5 text-xs font-medium text-slate-300">Copy</button>
            <button type="button" data-key-action="reveal" data-key-id="${k.id}" class="btn-ghost rounded-md px-2.5 py-1.5 text-xs font-medium text-slate-300">${revealed[k.id] ? 'Hide' : 'Reveal'}</button>
            <button type="button" data-key-action="delete" data-key-id="${k.id}" class="btn-ghost rounded-md px-2.5 py-1.5 text-xs font-medium text-red-300 hover:border-red-400/40 hover:bg-red-400/10">Delete</button>
          </div>
        </td>
      </tr>`).join('');
  }

  document.getElementById('keys-tbody').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-key-action]');
    if (!btn) return;
    const keyId = btn.dataset.keyId;
    const key = keysCache.find((k) => k.id === keyId);
    if (!key) return;

    if (btn.dataset.keyAction === 'copy') {
      const ok = await window.novaCopy(key.key);
      window.novaToast(ok ? 'API key copied to clipboard' : 'Copy failed', ok);
    }

    if (btn.dataset.keyAction === 'reveal') {
      revealed[keyId] = !revealed[keyId];
      renderKeys();
    }

    if (btn.dataset.keyAction === 'delete') {
      if (btn.dataset.confirm !== '1') {
        btn.dataset.confirm = '1';
        btn.textContent = 'Confirm?';
        setTimeout(() => {
          if (document.body.contains(btn)) renderKeys();
        }, 2600);
        return;
      }
      const res = await window.novaApi(`/api/keys/${keyId}`, { method: 'DELETE' });
      if (!res.ok) {
        window.novaToast(res.data.error?.message || 'Could not delete the key.', false);
        renderKeys();
        return;
      }
      keysCache = res.data.keys || [];
      if (res.data.deleted_current_key && res.data.auth_key) {
        window.novaSession.update({ api_key: res.data.auth_key });
      }
      renderKeys();
      window.novaToast(`Key "${key.name}" deleted`);
    }
  });

  /* ---------- Create key modal ---------- */
  const modal = document.getElementById('key-modal');
  const modalCreate = document.getElementById('key-modal-create');
  const modalResult = document.getElementById('key-modal-result');
  const keyNameInput = document.getElementById('key-name');
  let pendingKey = null;

  function openModal() {
    modalCreate.classList.remove('hidden');
    modalResult.classList.add('hidden');
    keyNameInput.value = '';
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    setTimeout(() => keyNameInput.focus(), 60);
  }
  function closeModal() {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
    pendingKey = null;
  }

  document.querySelector('[data-action="create-key"]').addEventListener('click', openModal);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
  modal.querySelector('[data-action="modal-cancel"]').addEventListener('click', closeModal);
  modal.querySelector('[data-action="modal-done"]').addEventListener('click', closeModal);

  modal.querySelector('[data-action="modal-create"]').addEventListener('click', async () => {
    const name = keyNameInput.value.trim() || 'Untitled key';
    const btn = modal.querySelector('[data-action="modal-create"]');
    btn.disabled = true;
    const res = await window.novaApi('/api/keys', { method: 'POST', body: { name } });
    btn.disabled = false;

    if (!res.ok) {
      window.novaToast(res.data.error?.message || 'Could not create the key.', false);
      return;
    }
    pendingKey = res.data.key.key;
    keysCache = res.data.keys;
    document.getElementById('key-result-value').textContent = pendingKey;
    modalCreate.classList.add('hidden');
    modalResult.classList.remove('hidden');
    renderKeys();
  });

  modal.querySelector('[data-action="copy-new-key"]').addEventListener('click', async () => {
    const ok = await window.novaCopy(pendingKey);
    window.novaToast(ok ? 'API key copied to clipboard' : 'Copy failed', ok);
  });

  /* ================= billing ================= */
  document.querySelectorAll('[data-topup]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const amount = parseFloat(btn.dataset.topup);
      const res = await window.novaApi('/api/topup', { method: 'POST', body: { amount } });
      if (!res.ok) {
        window.novaToast(res.data.error?.message || 'Top-up failed.', false);
        return;
      }
      window.novaToast(`Demo top-up of $${amount.toFixed(2)} applied`);
      await loadDashboard();
    });
  });

  /* ================= settings ================= */
  document.querySelector('[data-action="save-settings"]').addEventListener('click', async () => {
    const name = document.getElementById('set-name').value.trim();
    const company = document.getElementById('set-company').value.trim();
    const res = await window.novaApi('/api/profile', { method: 'POST', body: { name, company } });
    if (!res.ok) {
      window.novaToast(res.data.error?.message || 'Could not save settings.', false);
      return;
    }
    window.novaSession.update({ name: res.data.user.name });
    window.novaToast('Settings saved');
  });

  document.querySelector('[data-action="update-card"]').addEventListener('click', () => {
    window.novaToast('Card updates are disabled in the demo build.', false);
  });
  document.querySelector('[data-action="delete-account"]').addEventListener('click', () => {
    window.novaToast('Account deletion is disabled in the demo build.', false);
  });

  /* ================= data loading ================= */
  async function loadDashboard() {
    const res = await window.novaApi('/api/me');
    if (!res.ok) {
      if (res.status === 401) {
        window.novaSession.clear();
        window.location.replace('login.html');
        return;
      }
      window.novaToast(res.data.error?.message || 'Could not load dashboard data.', false);
      return;
    }
    state.me = res.data;
    keysCache = res.data.api_keys || [];
    renderHeader();
    renderStats();
    renderRecent();
    renderUsageByModel();
    renderTransactions();
    renderKeys();
    if (charts.usage) { charts.usage.data.labels = state.me.daily.map((d) => d.date); charts.usage.data.datasets[0].data = state.me.daily.map((d) => +(d.tokens / 1000).toFixed(2)); charts.usage.update(); }
    if (charts.requests) { charts.requests.data.labels = state.me.daily.map((d) => d.date); charts.requests.data.datasets[0].data = state.me.daily.map((d) => d.requests); charts.requests.update(); }
  }

  /* Initial state — after full load so Chart.js picks up the final layout */
  if (document.readyState === 'complete') {
    showPanel('overview');
    loadDashboard().then(() => ensureChart('usage'));
  } else {
    window.addEventListener('load', () => {
      showPanel('overview');
      loadDashboard().then(() => ensureChart('usage'));
    });
  }
})();
