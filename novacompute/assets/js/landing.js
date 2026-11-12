/* ============================================================
   NovaCompute — Landing page interactions.
   Data lives in models-data.js (shared across the site).
   VFX helpers live in effects.js (particles, typing, ripple).
   ============================================================ */

(function () {
  'use strict';

  const reduced = window.NOA_REDUCED_MOTION;
  const tbody = document.getElementById('models-tbody');

  /* ---------- Model table + filter tabs ---------- */
  const filterWrap = document.getElementById('model-filters');
  if (filterWrap && tbody && window.renderModelRow) {
    let currentFilter = 'all';

    const isFree = (m) => m.input === 0 && m.output === 0 && Number(m.price_per_request || 0) === 0;
    const render = (filter) => {
      const rows = window.NOVA_MODELS.filter((m) =>
        filter === 'all' ? true :
        filter === 'free' ? isFree(m) :
        filter === 'paid' ? !isFree(m) :
        m.category === filter
      );
      tbody.innerHTML = window.renderModelRowsGrouped
        ? window.renderModelRowsGrouped(rows)
        : rows.map(window.renderModelRow).join('');
    };

    const applySourceNote = () => {
      const note = document.getElementById('models-note');
      if (!note) return;
      note.textContent = window.NOVA_MODELS_SOURCE === 'live'
        ? 'Prices are per 1M tokens unless marked per request. Speed is measured end-to-end. · catalogue synced live · failed 429/5xx requests retry automatically'
        : 'Prices are per 1M tokens unless marked per request. Speed is measured end-to-end. · backend offline — showing cached catalogue';
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
      window.fetchModels().then((list) => {
        render(currentFilter);
        applySourceNote();
        const models = Array.isArray(list) ? list : [];
        if (models.length) {
          const free = models.filter((m) => Number(m.input) === 0 && Number(m.output) === 0 && Number(m.price_per_request || 0) === 0).length;
          document.querySelectorAll('[data-stat="models"]').forEach((el) => {
            el.dataset.target = String(models.length);
            el.textContent = String(models.length);
          });
          document.querySelectorAll('[data-stat="free"]').forEach((el) => {
            el.dataset.target = String(free);
            el.textContent = String(free);
          });
        }
      });
    }
  }

  /* ---------- Hero code window: language tabs ---------- */
  document.querySelectorAll('.code-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.code-tab').forEach((b) => b.classList.toggle('is-active', b === btn));
      document.querySelectorAll('.code-pane').forEach((p) => {
        p.classList.toggle('hidden', p.dataset.lang !== btn.dataset.lang);
      });
    });
  });

  /* ---------- Hero headline typing effect ---------- */
  const typeMain = document.getElementById('hero-type-main');
  const typeGrad = document.getElementById('hero-type-gradient');
  if (typeMain && typeGrad) {
    const part1 = "Build faster with the world's ";
    const part2 = 'best AI models';
    setTimeout(() => {
      window.novaType(typeMain, part1, 26, () => window.novaType(typeGrad, part2, 42));
    }, 350);
  }

  /* ---------- Hero code window: type out the cURL sample ---------- */
  const CURL_TOKENS = [
    { c: 'tok-cmd', t: 'curl ' },
    { c: 'tok-url', t: `${window.location.origin}/v1/chat/completions` },
    { t: ' \\\n  ' },
    { c: 'tok-flag', t: '-H ' },
    { c: 'tok-str', t: '"Authorization: Bearer $NOVA_API_KEY"' },
    { t: ' \\\n  ' },
    { c: 'tok-flag', t: '-H ' },
    { c: 'tok-str', t: '"Content-Type: application/json"' },
    { t: ' \\\n  ' },
    { c: 'tok-flag', t: '-d ' },
    { c: 'tok-str', t: "'{" },
    { t: '\n  ' },
    { c: 'tok-key', t: '"model"' },
    { c: 'tok-str', t: ': "deepseek-v4.1-flash",' },
    { t: '\n  ' },
    { c: 'tok-key', t: '"messages"' },
    { c: 'tok-str', t: ': [{ "role": "user", "content": "Hello, Nova!" }]' },
    { t: '\n' },
    { c: 'tok-str', t: "}'" },
  ];
  document.querySelectorAll('.code-pane span').forEach((el) => {
    if (el.textContent.includes('YOUR-DOMAIN')) el.textContent = el.textContent.replaceAll('YOUR-DOMAIN', window.location.host);
  });

  const curlCode = document.querySelector('#code-curl code');
  if (curlCode && window.novaTypeCode) {
    setTimeout(() => window.novaTypeCode(curlCode, CURL_TOKENS, 11), 900);
  }

  /* ---------- Constellation particles ---------- */
  if (window.novaParticles) {
    window.novaParticles(document.getElementById('hero-particles'));
  }

  /* ---------- Animated stat counters ---------- */
  function animateCounter(el) {
    const target = parseFloat(el.dataset.target || '0');
    const decimals = parseInt(el.dataset.decimals || '0', 10);
    const prefix = el.dataset.prefix || '';
    const suffix = el.dataset.suffix || '';
    const duration = 1300;
    const start = performance.now();
    const tick = (now) => {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      el.textContent = `${prefix}${(target * eased).toFixed(decimals)}${suffix}`;
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  const counters = document.querySelectorAll('.stat-value');
  if (reduced || !('IntersectionObserver' in window)) {
    counters.forEach((el) => {
      el.textContent = `${el.dataset.prefix || ''}${parseFloat(el.dataset.target).toFixed(parseInt(el.dataset.decimals || '0', 10))}${el.dataset.suffix || ''}`;
    });
  } else {
    const countObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        animateCounter(entry.target);
        countObserver.unobserve(entry.target);
      });
    }, { threshold: 0.5 });
    counters.forEach((el) => countObserver.observe(el));
  }

  /* ---------- Founding free-seat counter ---------- */
  const seatBadge = document.querySelector('[data-free-seat-badge]');
  if (seatBadge && window.novaApi) {
    window.novaApi('/api/free-seats', { auth: false }).then((res) => {
      if (!res.ok || !res.data || !res.data.limit) return;
      const remaining = Number(res.data.remaining);
      if (remaining > 0) {
        seatBadge.textContent = `Founding free plan — ${remaining} of ${res.data.limit} seats left`;
      } else {
        seatBadge.textContent = 'Founding free seats are full — new accounts are pay-as-you-go';
      }
    }).catch(() => {});
  }
})();
