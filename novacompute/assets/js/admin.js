/* ============================================================
   NovaCompute — web admin console.
   Requires a session with is_admin=true (backend checks every call).
   ============================================================ */

(function () {
  'use strict';

  const session = window.novaSession ? window.novaSession.get() : null;
  if (!session || !session.api_key) {
    window.location.replace('login.html');
    return;
  }
  if (!session.is_admin) {
    window.location.replace('dashboard.html');
    return;
  }

  const esc = (value) => String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  const money = (v) => `$${Number(v || 0).toFixed(2)}`;
  const tokensShort = (v) => {
    const n = Number(v || 0);
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 100_000 ? 0 : 1)}K`;
    return String(n);
  };
  const relative = (ts) => {
    if (!ts) return 'Never';
    const mins = Math.max(0, Math.round((Date.now() - ts * 1000) / 60000));
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins} min ago`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.round(hours / 24)}d ago`;
  };
  const dateShort = (ts) => new Date(ts * 1000).toLocaleDateString([], { month: 'short', day: '2-digit' });

  const statsEl = document.getElementById('admin-stats');
  const usersEl = document.getElementById('admin-users');
  const txEl = document.getElementById('admin-transactions');
  const providersEl = document.getElementById('admin-provider-notes');

  function renderStats(data) {
    if (!statsEl) return;
    const cards = [
      ['Users', String(data.users), `${data.models} models · ${data.provider_keys} provider keys`],
      ['Active plans', String(data.active_plans), 'Monthly quota plans'],
      ['Revenue', money(data.revenue), `Balances: ${money(data.total_balance)}`],
      ['Requests today', Number(data.requests_today).toLocaleString(), `${tokensShort(data.tokens_today)} tokens today`],
    ];
    statsEl.innerHTML = cards.map(([label, value, note]) => `
      <div class="reveal card-hover glass rounded-2xl p-5">
        <p class="text-xs uppercase tracking-wider text-slate-500">${label}</p>
        <p class="mt-2 font-display text-3xl font-bold text-white">${value}</p>
        <p class="mt-3 text-xs text-slate-500">${note}</p>
      </div>`).join('');
  }


  function renderProviders(rows) {
    if (!providersEl) return;
    providersEl.innerHTML = (rows || []).map((p) => {
      const note = String(p.note || '—');
      const tone = note === 'Not' ? 'text-rose-300 border-rose-400/20 bg-rose-500/[0.06]'
        : note.toLowerCase().includes('hold') ? 'text-amber-300 border-amber-400/20 bg-amber-500/[0.06]'
        : note === 'Tool got' ? 'text-emerald-300 border-emerald-400/20 bg-emerald-500/[0.06]'
        : 'text-slate-300 border-white/10 bg-white/[0.02]';
      return `<div class="rounded-xl border ${tone} p-4">
        <div class="flex items-start justify-between gap-3">
          <div><p class="text-sm font-semibold text-white">${esc(p.name || p.id)}</p><p class="mt-0.5 font-mono text-[10px] text-slate-500">${esc(p.id)}</p></div>
          <span class="shrink-0 rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-slate-400">${Number(p.count || 0)} keys</span>
        </div>
        <p class="mt-3 text-xs leading-relaxed">${esc(note)}</p>
      </div>`;
    }).join('');
  }

  function planOptions(current) {
    const plans = ['free', 'starter', 'pro', 'ultra'];
    return plans.map((p) => `<option value="${p}"${p === current ? ' selected' : ''}>${p === 'free' ? 'Pay-as-you-go' : p[0].toUpperCase() + p.slice(1)}</option>`).join('');
  }

  function renderUsers(rows) {
    if (!usersEl) return;
    if (!rows.length) {
      usersEl.innerHTML = '<tr><td colspan="7" class="px-5 py-10 text-center text-sm text-slate-500">No users.</td></tr>';
      return;
    }
    usersEl.innerHTML = rows.map((u) => `
      <tr class="align-middle">
        <td class="px-5 py-3.5">
          <p class="font-medium text-white">${esc(u.name || u.email)}</p>
          <p class="mt-0.5 font-mono text-[11px] text-slate-500">${esc(u.email)}</p>
        </td>
        <td class="px-4 py-3.5">
          <select data-admin-plan="${esc(u.email)}" class="rounded-md border border-white/10 bg-white/[0.04] px-2 py-1.5 text-xs text-slate-200 outline-none focus:border-violet-400/50">
            ${planOptions(u.plan)}
          </select>
        </td>
        <td class="px-4 py-3.5">
          <div class="flex items-center gap-1.5">
            <span class="w-14 font-mono text-xs text-slate-300">${money(u.balance)}</span>
            <input data-admin-balance="${esc(u.email)}" type="number" step="1" placeholder="+10" class="w-20 rounded-md border border-white/10 bg-white/[0.04] px-2 py-1.5 font-mono text-xs text-slate-200 outline-none focus:border-violet-400/50" />
            <button type="button" data-admin-apply="${esc(u.email)}" class="btn-ghost rounded-md px-2 py-1.5 text-[11px] text-slate-300">Apply</button>
          </div>
        </td>
        <td class="px-4 py-3.5 text-right font-mono text-xs">${Number(u.requests).toLocaleString()}</td>
        <td class="px-4 py-3.5 text-right font-mono text-xs">${tokensShort(u.tokens)}</td>
        <td class="px-4 py-3.5 text-xs text-slate-500">${relative(u.last_used)}</td>
        <td class="px-5 py-3.5 text-right">
          <input data-admin-flag="${esc(u.email)}" type="checkbox" ${u.is_admin ? 'checked' : ''} class="h-4 w-4 rounded border-white/20 bg-white/5 accent-violet-500" />
        </td>
      </tr>`).join('');
  }

  function renderTransactions(rows) {
    if (!txEl) return;
    if (!rows.length) {
      txEl.innerHTML = '<tr><td colspan="5" class="px-5 py-10 text-center text-sm text-slate-500">No transactions yet.</td></tr>';
      return;
    }
    txEl.innerHTML = rows.slice(0, 40).map((t) => {
      const positive = Number(t.amount) > 0;
      return `<tr>
        <td class="px-5 py-3 text-xs text-slate-400">${dateShort(t.ts)}</td>
        <td class="px-4 py-3 font-mono text-[11px] text-slate-400">${esc(t.email)}</td>
        <td class="px-4 py-3">${esc(t.description)}</td>
        <td class="px-4 py-3 text-slate-400">${esc(t.method)}</td>
        <td class="px-5 py-3 text-right font-mono ${positive ? 'text-emerald-400' : 'text-slate-300'}">${positive ? '+' : ''}${money(t.amount)}</td>
      </tr>`;
    }).join('');
  }

  async function updateUser(email, payload) {
    const res = await window.novaApi('/api/admin/user', { method: 'POST', body: { email, ...payload } });
    if (!res.ok) {
      window.novaToast(res.data.error?.message || 'Admin update failed.', false);
      return false;
    }
    window.novaToast('Account updated', true);
    await loadAdmin();
    return true;
  }

  if (usersEl) {
    usersEl.addEventListener('change', async (e) => {
      const plan = e.target.closest('[data-admin-plan]');
      if (plan) { await updateUser(plan.dataset.adminPlan, { plan: plan.value }); return; }
      const flag = e.target.closest('[data-admin-flag]');
      if (flag) await updateUser(flag.dataset.adminFlag, { is_admin: flag.checked });
    });
    usersEl.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-admin-apply]');
      if (!btn) return;
      const email = btn.dataset.adminApply;
      const input = usersEl.querySelector(`[data-admin-balance="${CSS.escape(email)}"]`);
      const delta = Number(input && input.value);
      if (!delta) { window.novaToast('Enter a non-zero amount', false); return; }
      await updateUser(email, { balance_delta: delta });
    });
  }

  async function loadAdmin() {
    const [overview, users, txs, providerKeys] = await Promise.all([
      window.novaApi('/api/admin/overview'),
      window.novaApi('/api/admin/users'),
      window.novaApi('/api/admin/transactions'),
      window.novaApi('/api/admin/provider-keys'),
    ]);
    if (!overview.ok || !users.ok || !txs.ok) {
      if (overview.status === 403) {
        window.novaToast('Admin access required', false);
        window.location.replace('dashboard.html');
        return;
      }
      window.novaToast(overview.data.error?.message || 'Could not load admin data.', false);
      return;
    }
    renderStats(overview.data);
    renderUsers(users.data.users || []);
    renderTransactions(txs.data.transactions || []);
    if (providerKeys && providerKeys.ok) renderProviders(providerKeys.data.providers || []);
  }

  const refresh = document.getElementById('admin-refresh');
  if (refresh) refresh.addEventListener('click', loadAdmin);
  loadAdmin();
})();
