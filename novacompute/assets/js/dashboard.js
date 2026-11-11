/* ============================================================
   NovaCompute — Dashboard (live data from backend/app.py).
   Requires a session in localStorage (set by login/register).
   All numbers come from GET /api/me; key changes hit the real
   /api/keys endpoints, top-ups use server-verified PayPal/bank payments.
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
  const charts = { usage: null, tokens: null };

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
        if (name === 'usage') ensureChart('tokens');
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

    if (which === 'tokens') {
      const ctx = document.getElementById('chart-tokens').getContext('2d');
      charts.tokens = new Chart(ctx, {
        type: 'bar',
        data: {
          labels,
          datasets: [{
            data: daily.map((d) => d.tokens),
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
              callbacks: { label: (item) => ` ${Number(item.parsed.y).toLocaleString()} tokens` },
            },
          },
          scales: {
            x: { grid: { display: false }, border: { display: false } },
            y: {
              beginAtZero: true,
              grid: { color: 'rgba(148,163,184,0.08)' },
              border: { display: false },
              ticks: { maxTicksLimit: 6, precision: 0, callback: (v) => tokensShort(v) },
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

  function renderQuota() {
    const me = state.me;
    const plan = me.plan || 'free';
    const quota = Number(me.daily_quota || 0);
    const used = quota > 0 ? Number(me.quota_used_today || 0) : Number(me.stats.tokens_today || 0);
    const planEl = document.getElementById('quota-plan');
    const numEl = document.getElementById('quota-numbers');
    const barEl = document.getElementById('quota-bar');
    const noteEl = document.getElementById('quota-note');
    const trackEl = document.getElementById('quota-track');
    if (!planEl || !numEl || !barEl || !noteEl) return;

    if (quota > 0) {
      const pct = Math.min(100, Math.round((used / quota) * 100000) / 1000);
      planEl.textContent = `${me.plan_name || plan} · ${used >= quota ? 'quota reached' : 'active'}`;
      numEl.textContent = `${used.toLocaleString()} / ${quota.toLocaleString()} quota tokens today · ${pct.toFixed(3)}%`;
      barEl.style.width = `${pct}%`;
      if (trackEl) trackEl.style.display = '';
      barEl.className = `h-full rounded-full transition-[width] duration-500 ${used >= quota ? 'bg-red-400' : 'bg-gradient-to-r from-violet-500 to-cyan-400'}`;
      noteEl.textContent = `Resets daily at 00:00 UTC${me.plan_expires ? ` · renews ${new Date(me.plan_expires).toLocaleDateString()}` : ''}. Free models do not consume this quota.`;
    } else {
      planEl.textContent = 'Pay-as-you-go — no daily token cap';
      numEl.textContent = `${used.toLocaleString()} tokens today`;
      barEl.style.width = '0%';
      barEl.className = 'h-full rounded-full bg-gradient-to-r from-violet-500 to-cyan-400';
      if (trackEl) trackEl.style.display = 'none';
      noteEl.textContent = 'Usage is billed from your balance at the model rates. Subscribe for a daily paid-token quota.';
    }
  }

  function renderBillingPlan() {
    const me = state.me;
    const planEl = document.getElementById('billing-plan');
    const noteEl = document.getElementById('billing-plan-note');
    if (!planEl || !noteEl) return;
    if (me.daily_quota > 0) {
      planEl.textContent = `${me.plan_name} — ${tokensShort(me.daily_quota)} quota tokens/day`;
      const until = me.plan_expires ? new Date(me.plan_expires).toLocaleDateString() : '—';
      noteEl.textContent = `≈ ${tokensShort(me.daily_quota * 30)} tokens/month · active until ${until} · ${me.daily_tts || 0} TTS requests/day · activated automatically after payment.`;
    } else {
      planEl.textContent = 'Pay-as-you-go';
      noteEl.textContent = 'No monthly token quota — paid models are billed from your balance. Subscribe for a daily quota.';
    }
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
      const amount = Number(t.amount);
      const isTopup = t.type === 'topup';
      const isSub = t.type === 'subscription';
      const cls = isTopup ? 'text-emerald-400' : isSub ? 'text-violet-300' : amount === 0 ? 'text-slate-500' : 'text-slate-200';
      return `<tr>
        <td class="px-6 py-3.5 text-slate-400">${dateShort(t.ts)}</td>
        <td class="px-4 py-3.5">${t.description}</td>
        <td class="px-4 py-3.5 text-slate-400">${t.method}</td>
        <td class="px-6 py-3.5 text-right font-mono ${cls}">
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

  /* ================= billing / real top-up ================= */
  const topupModal = document.getElementById('topup-modal');
  const topupLabel = document.getElementById('topup-amount-label');
  const topupQr = document.getElementById('topup-qr');
  const topupVnd = document.getElementById('topup-vnd');
  const topupMemo = document.getElementById('topup-memo');
  const topupPaypalWrap = document.getElementById('topup-paypal-wrap');
  const topupPaypalButton = document.getElementById('topup-paypal-button');
  let topupAmount = 0;
  let topupRate = 0;
  let paypalSdkPromise = null;

  function closeTopup() {
    if (!topupModal) return;
    topupModal.classList.add('hidden');
    topupModal.classList.remove('flex');
  }

  function loadPaypalSdk(clientId) {
    if (window.paypal && window.paypal.Buttons) return Promise.resolve(window.paypal);
    if (paypalSdkPromise) return paypalSdkPromise;
    paypalSdkPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      const params = new URLSearchParams({ 'client-id': clientId, currency: 'USD', intent: 'capture', components: 'buttons', 'disable-funding': 'card,credit' });
      script.src = `https://www.paypal.com/sdk/js?${params.toString()}`;
      script.async = true;
      script.onload = () => (window.paypal && window.paypal.Buttons) ? resolve(window.paypal) : reject(new Error('PayPal SDK loaded without Buttons'));
      script.onerror = () => reject(new Error('PayPal SDK failed to load'));
      document.head.appendChild(script);
    }).catch((err) => { paypalSdkPromise = null; throw err; });
    return paypalSdkPromise;
  }

  function mountTopupPaypal() {
    const pay = window.NOVA_PAYMENT || {};
    const pp = pay.paypal || {};
    if (!topupPaypalWrap || !topupPaypalButton) return;
    if (!pp.clientId) { topupPaypalWrap.classList.add('hidden'); return; }
    topupPaypalWrap.classList.remove('hidden');
    topupPaypalButton.innerHTML = '<div class="rounded-lg border border-white/[0.08] bg-white/[0.02] px-3 py-3 text-center text-xs text-slate-500">Loading PayPal…</div>';
    loadPaypalSdk(pp.clientId).then((paypal) => {
      topupPaypalButton.innerHTML = '';
      paypal.Buttons({
        style: { layout: 'vertical', color: 'blue', shape: 'rect', label: 'paypal', height: 40 },
        createOrder: async () => {
          const res = await window.novaApi('/api/paypal/create-order', {
            method: 'POST', body: { purpose: 'topup', amount: topupAmount },
          });
          if (!res.ok) throw new Error((res.data.error && res.data.error.message) || 'Could not create PayPal order');
          return res.data.id;
        },
        onApprove: async (data) => {
          const res = await window.novaApi('/api/paypal/capture-order', {
            method: 'POST', body: { order_id: data.orderID },
          });
          if (!res.ok) {
            window.novaToast((res.data.error && res.data.error.message) || 'PayPal capture failed.', false);
            return;
          }
          window.novaToast(`Payment received — balance ${money(res.data.balance)}`, true);
          closeTopup();
          await loadDashboard();
        },
        onCancel: () => window.novaToast('PayPal checkout cancelled', false),
        onError: (err) => {
          console.error('[paypal topup]', err);
          window.novaToast('PayPal could not start — use bank transfer.', false);
        },
      }).render('#topup-paypal-button').catch((err) => {
        console.error('[paypal topup] render', err);
        topupPaypalButton.innerHTML = '<div class="rounded-lg border border-amber-400/25 bg-amber-400/[0.07] p-3 text-xs text-amber-200/80">PayPal is unavailable — use bank transfer.</div>';
      });
    }).catch((err) => {
      console.error('[paypal topup] sdk', err);
      topupPaypalButton.innerHTML = '<div class="rounded-lg border border-amber-400/25 bg-amber-400/[0.07] p-3 text-xs text-amber-200/80">PayPal could not load — use bank transfer.</div>';
    });
  }

  async function openTopup(amount) {
    if (!topupModal) return;
    topupAmount = amount;
    const pay = window.NOVA_PAYMENT || {};
    const bank = pay.bank || {};
    const email = state.me?.user?.email || session.email;
    if (topupLabel) topupLabel.textContent = `Top up $${amount.toFixed(2)}`;
    if (topupMemo) topupMemo.textContent = `${pay.memo_prefix || 'NOVA'} TOPUP ${email}`;
    if (topupQr) topupQr.removeAttribute('src');
    if (topupVnd) topupVnd.textContent = 'loading…';
    topupModal.classList.remove('hidden');
    topupModal.classList.add('flex');
    mountTopupPaypal();

    const fx = await window.novaApi('/api/fx', { auth: false });
    topupRate = Number((fx.data && fx.data.usd_vnd) || 0);
    const vnd = Math.round(amount * topupRate);
    if (topupVnd) {
      topupVnd.textContent = topupRate
        ? `${vnd.toLocaleString('vi-VN')} VND (≈ $${amount.toFixed(2)})`
        : 'your bank will convert from USD';
    }
    if (topupQr && bank.account) {
      const params = new URLSearchParams({ addInfo: `${pay.memo_prefix || 'NOVA'} TOPUP ${email}`, accountName: bank.holder || '' });
      if (vnd) params.set('amount', String(vnd));
      topupQr.src = `https://img.vietqr.io/image/${encodeURIComponent(bank.code || 'TCB')}-${encodeURIComponent(bank.account)}-compact2.png?${params.toString()}`;
    }
  }

  document.querySelectorAll('[data-topup]').forEach((btn) => {
    btn.addEventListener('click', () => openTopup(parseFloat(btn.dataset.topup)));
  });
  document.querySelectorAll('[data-topup-close]').forEach((btn) => btn.addEventListener('click', closeTopup));
  if (topupModal) {
    topupModal.addEventListener('click', (e) => { if (e.target === topupModal) closeTopup(); });
  }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeTopup(); });

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
    renderQuota();
    renderBillingPlan();
    renderRecent();
    renderUsageByModel();
    renderTransactions();
    renderKeys();
    if (charts.usage) { charts.usage.data.labels = state.me.daily.map((d) => d.date); charts.usage.data.datasets[0].data = state.me.daily.map((d) => +(d.tokens / 1000).toFixed(2)); charts.usage.update(); }
    if (charts.tokens) { charts.tokens.data.labels = state.me.daily.map((d) => d.date); charts.tokens.data.datasets[0].data = state.me.daily.map((d) => d.tokens); charts.tokens.update(); }
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
