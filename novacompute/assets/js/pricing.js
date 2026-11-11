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

  /* ---------- Subscription plans + verified checkout ---------- */
  const PLANS = {
    starter: { name: 'Starter', price: 4.99, quota: '1.5M paid tokens/day', tts: '20 TTS requests/day' },
    pro: { name: 'Pro', price: 12.99, quota: '6M paid tokens/day', tts: '60 TTS requests/day' },
    ultra: { name: 'Ultra', price: 29.99, quota: '20M paid tokens/day', tts: '150 TTS requests/day' },
  };

  const subModal = document.getElementById('sub-modal');
  const subTitle = document.getElementById('sub-title');
  const subPrice = document.getElementById('sub-price');
  const subBody = document.getElementById('sub-body');
  let paypalSdkPromise = null;

  function vietQrUrl(plan, bank, memo, rate) {
    const code = bank.code || 'TCB';
    const params = new URLSearchParams({
      addInfo: memo,
      accountName: bank.holder || '',
    });
    if (rate > 0) params.set('amount', String(Math.round(plan.price * rate)));
    return `https://img.vietqr.io/image/${encodeURIComponent(code)}-${encodeURIComponent(bank.account)}-compact2.png?${params.toString()}`;
  }

  function loadPaypalSdk(clientId) {
    if (window.paypal && window.paypal.Buttons) return Promise.resolve(window.paypal);
    if (paypalSdkPromise) return paypalSdkPromise;
    paypalSdkPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      const params = new URLSearchParams({
        'client-id': clientId,
        currency: 'USD',
        intent: 'capture',
        components: 'buttons',
      });
      script.src = `https://www.paypal.com/sdk/js?${params.toString()}`;
      script.async = true;
      script.onload = () => (window.paypal && window.paypal.Buttons)
        ? resolve(window.paypal)
        : reject(new Error('PayPal SDK loaded without Buttons'));
      script.onerror = () => reject(new Error('PayPal SDK failed to load'));
      document.head.appendChild(script);
    }).catch((err) => {
      paypalSdkPromise = null;
      throw err;
    });
    return paypalSdkPromise;
  }

  function mountPaypal(planId, plan, pay, memo) {
    const wrap = document.getElementById('paypal-wrap');
    const holder = document.getElementById('paypal-button');
    if (!wrap || !holder) return;
    const pp = pay.paypal || {};
    if (!pp.clientId) {
      if (pp.link || pp.email) {
        wrap.classList.remove('hidden');
        holder.innerHTML = pp.link
          ? `<a href="${pp.link}" target="_blank" rel="noopener" class="btn-ghost flex items-center justify-center rounded-lg px-4 py-2.5 text-sm font-medium text-slate-200">Pay with PayPal ↗</a>`
          : `<div class="rounded-lg border border-white/[0.08] bg-white/[0.02] px-3.5 py-2.5 font-mono text-xs text-slate-200">${pp.email}</div>`;
      } else {
        wrap.classList.add('hidden');
      }
      return;
    }
    const session = (window.novaSession && window.novaSession.get()) || null;
    if (!session || !session.api_key) {
      wrap.classList.remove('hidden');
      holder.innerHTML = `<a href="login.html" class="btn-ghost flex items-center justify-center rounded-lg px-4 py-2.5 text-sm font-medium text-slate-200">Sign in to pay with PayPal</a>`;
      return;
    }
    wrap.classList.remove('hidden');
    holder.innerHTML = `<div class="rounded-lg border border-white/[0.08] bg-white/[0.02] px-3.5 py-3 text-center text-xs text-slate-500">Loading PayPal…</div>`;
    loadPaypalSdk(pp.clientId).then((paypal) => {
      holder.innerHTML = '';
      const buttons = paypal.Buttons({
        style: { layout: 'vertical', color: 'blue', shape: 'rect', label: 'paypal', height: 40 },
        createOrder: async () => {
          const res = await window.novaApi('/api/paypal/create-order', {
            method: 'POST', body: { purpose: 'sub', plan: planId },
          });
          if (!res.ok) throw new Error((res.data.error && res.data.error.message) || 'Could not create PayPal order');
          return res.data.id;
        },
        onApprove: async (data) => {
          const res = await window.novaApi('/api/paypal/capture-order', {
            method: 'POST', body: { order_id: data.orderID },
          });
          if (!res.ok) {
            holder.innerHTML = `<div class="rounded-lg border border-red-400/25 bg-red-400/[0.07] p-3 text-xs text-red-200/90">${(res.data.error && res.data.error.message) || 'Payment capture failed.'}</div>`;
            return;
          }
          if (window.novaSession && res.data.plan) window.novaSession.update({ plan: res.data.plan });
          holder.innerHTML = `<div class="rounded-lg border border-emerald-400/25 bg-emerald-500/[0.08] p-3 text-xs leading-relaxed text-emerald-200/90">
            <p class="font-semibold text-emerald-300">${plan.name} activated — thank you!</p>
            <p class="mt-1">Payment captured by PayPal. Your plan is active${res.data.plan_expires ? ` until ${new Date(res.data.plan_expires).toLocaleDateString()}` : ''}; daily quota is now live on your account.</p>
          </div>`;
          window.novaToast(`${plan.name} activated`, true);
        },
        onCancel: () => window.novaToast('PayPal checkout cancelled', false),
        onError: (err) => {
          console.error('[paypal]', err);
          holder.innerHTML = `<div class="rounded-lg border border-amber-400/25 bg-amber-400/[0.07] p-3 text-xs leading-relaxed text-amber-200/80">
            PayPal could not start. Use bank transfer / QR, or contact <span class="text-white">${pay.contact?.email || 'support'}</span>.
          </div>`;
          window.novaToast('PayPal checkout unavailable — use bank transfer', false);
        },
      });
      buttons.render('#paypal-button').catch((err) => {
        console.error('[paypal] render', err);
        holder.innerHTML = `<div class="rounded-lg border border-amber-400/25 bg-amber-400/[0.07] p-3 text-xs text-amber-200/80">PayPal is unavailable right now — use bank transfer / QR.</div>`;
      });
    }).catch((err) => {
      console.error('[paypal] sdk', err);
      holder.innerHTML = `<div class="rounded-lg border border-amber-400/25 bg-amber-400/[0.07] p-3 text-xs text-amber-200/80">PayPal could not load. Use bank transfer / QR, or contact <span class="text-white">${pay.contact?.email || 'support'}</span>.</div>`;
    });
  }

  function row(label, value, copyable) {
    const copy = copyable
      ? `<button type="button" data-copy-value="${String(value).replace(/"/g, '&quot;')}" class="btn-ghost ml-2 shrink-0 rounded-md px-2 py-0.5 text-[11px] text-slate-300">Copy</button>`
      : '';
    return `<div class="flex flex-col gap-1 rounded-lg border border-white/[0.08] bg-white/[0.02] px-3.5 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
      <span class="text-xs uppercase tracking-wider text-slate-500">${label}</span>
      <span class="flex min-w-0 items-center font-mono text-xs text-slate-200"><span class="break-all sm:text-right">${value}</span>${copy}</span>
    </div>`;
  }

  async function openSubModal(planId) {
    const plan = PLANS[planId];
    if (!plan || !subModal) return;
    const pay = window.NOVA_PAYMENT || {};
    const bank = pay.bank || {};
    subTitle.textContent = `${plan.name} — $${plan.price.toFixed(2)}/mo`;
    subPrice.textContent = `${plan.quota} · ${plan.tts} · quota resets daily`;
    const session = (window.novaSession && window.novaSession.get()) || null;
    const email = (session && session.email) || '';
    const memo = `${pay.memo_prefix || 'NOVA'} ${plan.name} ${email || '{your-email}'}`;
    let rate = 0;
    try {
      const fx = await window.novaApi('/api/fx', { auth: false });
      rate = Number((fx.data && fx.data.usd_vnd) || 0);
    } catch (err) { rate = 0; }
    const vnd = rate > 0 ? Math.round(plan.price * rate) : 0;
    let html = '';
    if (bank.account) {
      html += `<p class="text-xs font-semibold uppercase tracking-wider text-slate-500">Bank transfer</p>`;
      html += row('Bank', bank.name || '—');
      html += row('Account no.', bank.account, true);
      html += row('Account holder', bank.holder || '—');
      html += row('Transfer memo', memo, true);
      html += `<div class="flex flex-col items-center gap-4 rounded-xl border border-white/[0.08] bg-white/[0.03] p-3.5 sm:flex-row">
        <img src="${vietQrUrl(plan, bank, memo, rate)}" alt="VietQR — ${plan.name} payment" width="128" height="128"
             class="h-32 w-32 shrink-0 rounded-lg bg-white p-1.5" loading="lazy" referrerpolicy="no-referrer" />
        <div class="text-xs leading-relaxed text-slate-400">
          <p class="font-semibold text-slate-200">Scan to pay — amount &amp; memo pre-filled</p>
          <p class="mt-1">Amount: <span class="text-slate-200">${vnd ? `${vnd.toLocaleString('vi-VN')} VND (≈ $${plan.price.toFixed(2)})` : `$${plan.price.toFixed(2)} — your bank converts to VND`}</span></p>
          <p class="mt-1">The memo already contains your plan and email. Keep it unchanged.</p>
          <p class="mt-1.5 font-mono text-[11px] text-slate-500">${bank.name || ''} · ${bank.holder || ''}</p>
        </div>
      </div>`;
      if (!email) {
        html += `<p class="mt-2 rounded-lg border border-amber-400/25 bg-amber-400/[0.07] p-3 text-xs text-amber-200/80">Sign in first — the memo must contain your account email so we can match your transfer.</p>`;
      }
      html += `<p class="text-xs leading-relaxed text-slate-500">Bank transfers auto-credit when the bank webhook is configured; otherwise send the receipt to <span class="text-slate-300">${pay.contact?.email || 'support'}</span>.</p>`;
    } else {
      html += `<div class="rounded-lg border border-amber-400/25 bg-amber-400/[0.07] p-3.5 text-xs text-amber-200/80">Payment details are not configured yet. Add them to <code class="font-mono">assets/js/payment-config.js</code>.</div>`;
    }
    const pp = pay.paypal || {};
    html += `<div id="paypal-wrap" class="hidden pt-1">
      <p class="pb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">PayPal</p>
      <div id="paypal-button"></div>
      <p class="mt-2 text-[11px] leading-relaxed text-slate-500">Payment is captured server-side; your plan activates automatically. If the PayPal window does not open, allow pop-ups for this site.</p>
    </div>`;
    subBody.innerHTML = html;
    subModal.classList.remove('hidden');
    subModal.classList.add('flex');
    if (pp.clientId) mountPaypal(planId, plan, pay, memo);
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
