/* ============================================================
   NovaCompute — Pricing page.
   Reuses the shared catalogue (models-data.js) and renders
   the full price table with filter tabs.
   ============================================================ */

(function () {
  'use strict';

  const tbody = document.getElementById('pricing-tbody');
  const filterWrap = document.getElementById('pricing-filters');
  if (!tbody || !filterWrap || !window.renderModelRow) return;

  let currentFilter = 'all';

  const isFree = (m) => m.input === 0 && m.output === 0;

  function render(filter) {
    const rows = window.NOVA_MODELS.filter((m) =>
      filter === 'all' ? true :
      filter === 'free' ? isFree(m) :
      filter === 'paid' ? !isFree(m) :
      m.category === filter
    );
    tbody.innerHTML = window.renderModelRowsGrouped
      ? window.renderModelRowsGrouped(rows)
      : rows.map(window.renderModelRow).join('');
  }

  const applySourceNote = () => {
    const note = document.getElementById('pricing-note');
    if (!note) return;
    note.textContent = window.NOVA_MODELS_SOURCE === 'live'
      ? 'Prices are per 1M tokens on the standard tier. Failed requests (5xx from our side) are never billed. · synced live from backend · Free tier + TTS subscription included'
      : 'Prices are per 1M tokens on the standard tier. Failed requests (5xx from our side) are never billed. · backend offline — cached catalogue · Free tier + TTS subscription included';
  };

  filterWrap.querySelectorAll('.filter-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      currentFilter = btn.dataset.filter;
      filterWrap.querySelectorAll('.filter-tab').forEach((b) => {
        b.classList.toggle('is-active', b === btn);
        b.setAttribute('aria-pressed', String(b === btn));
      });
      render(currentFilter);
    });
  });

  render(currentFilter);
  applySourceNote();

  /* Swap in the live catalogue from GET /v1/models (fallback stays if offline) */
  if (window.fetchModels) {
    window.fetchModels().then(() => {
      render(currentFilter);
      applySourceNote();
    });
  }

  /* ---------- Subscription plans + manual checkout ---------- */
  const PLANS = {
    starter: { name: 'Starter', price: 4.99, quota: '1.5M paid tokens/day', tts: '20 TTS requests/day' },
    pro: { name: 'Pro', price: 12.99, quota: '6M paid tokens/day', tts: '60 TTS requests/day' },
    ultra: { name: 'Ultra', price: 29.99, quota: '20M paid tokens/day', tts: '150 TTS requests/day' },
  };

  const subModal = document.getElementById('sub-modal');
  const subTitle = document.getElementById('sub-title');
  const subPrice = document.getElementById('sub-price');
  const subBody = document.getElementById('sub-body');

  function row(label, value, copyable) {
    const copy = copyable
      ? `<button type="button" data-copy-value="${String(value).replace(/"/g, '&quot;')}" class="btn-ghost ml-2 shrink-0 rounded-md px-2 py-0.5 text-[11px] text-slate-300">Copy</button>`
      : '';
    return `<div class="flex items-center justify-between gap-3 rounded-lg border border-white/[0.08] bg-white/[0.02] px-3.5 py-2.5">
      <span class="text-xs uppercase tracking-wider text-slate-500">${label}</span>
      <span class="flex min-w-0 items-center font-mono text-xs text-slate-200"><span class="truncate">${value}</span>${copy}</span>
    </div>`;
  }

  function openSubModal(planId) {
    const plan = PLANS[planId];
    if (!plan || !subModal) return;
    const pay = window.NOVA_PAYMENT || {};
    const bank = pay.bank || {};
    subTitle.textContent = `${plan.name} — $${plan.price.toFixed(2)}/mo`;
    subPrice.textContent = `${plan.quota} · ${plan.tts} · quota resets daily`;
    const memo = `${pay.memo_prefix || 'NOVA'} ${plan.name} {your-email}`;
    let html = '';
    if (bank.account) {
      html += `<p class="text-xs font-semibold uppercase tracking-wider text-slate-500">Bank transfer</p>`;
      html += row('Bank', bank.name || '—');
      html += row('Account no.', bank.account, true);
      html += row('Account holder', bank.holder || '—');
      html += row('Transfer memo', memo, true);
      html += `<p class="text-xs leading-relaxed text-slate-500">Transfer the exact amount, then send the receipt to <span class="text-slate-300">${pay.contact?.email || 'support'}</span> — your plan is activated manually (usually within a few minutes).</p>`;
    } else {
      html += `<div class="rounded-lg border border-amber-400/25 bg-amber-400/[0.07] p-3.5 text-xs text-amber-200/80">Payment details are not configured yet. Add them to <code class="font-mono">assets/js/payment-config.js</code>.</div>`;
    }
    const pp = pay.paypal || {};
    if (pp.link || pp.email) {
      html += `<p class="pt-2 text-xs font-semibold uppercase tracking-wider text-slate-500">PayPal</p>`;
      if (pp.link) {
        html += `<a href="${pp.link}" target="_blank" rel="noopener" class="btn-ghost flex items-center justify-center rounded-lg px-4 py-2.5 text-sm font-medium text-slate-200">Pay with PayPal ↗</a>`;
      } else {
        html += row('PayPal', pp.email, true);
      }
    }
    subBody.innerHTML = html;
    subModal.classList.remove('hidden');
    subModal.classList.add('flex');
  }

  function closeSubModal() {
    if (!subModal) return;
    subModal.classList.add('hidden');
    subModal.classList.remove('flex');
  }

  document.querySelectorAll('[data-plan]').forEach((btn) => {
    btn.addEventListener('click', () => openSubModal(btn.dataset.plan));
  });
  document.querySelectorAll('[data-sub-close]').forEach((btn) => {
    btn.addEventListener('click', closeSubModal);
  });
  if (subModal) {
    subModal.addEventListener('click', (e) => { if (e.target === subModal) closeSubModal(); });
  }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSubModal(); });
  if (subBody) {
    subBody.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-copy-value]');
      if (!btn) return;
      const ok = await window.novaCopy(btn.dataset.copyValue);
      window.novaToast(ok ? 'Copied to clipboard' : 'Copy failed', ok);
    });
  }
})();
