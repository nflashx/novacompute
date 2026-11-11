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
    const render = (filter) => {
      const rows = window.NOVA_MODELS.filter((m) =>
        filter === 'all' ? true :
        filter === 'free' ? m.input === 0 && m.output === 0 :
        m.category === filter
      );
      tbody.innerHTML = rows.map(window.renderModelRow).join('');
    };

    filterWrap.querySelectorAll('.filter-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        filterWrap.querySelectorAll('.filter-tab').forEach((b) => {
          b.classList.toggle('is-active', b === btn);
          b.setAttribute('aria-pressed', String(b === btn));
        });
        render(btn.dataset.filter);
      });
    });

    render('all');
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
    { c: 'tok-url', t: 'https://api.novacompute.io/v1/chat/completions' },
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
    { c: 'tok-str', t: ': "glm-5.3-flash",' },
    { t: '\n  ' },
    { c: 'tok-key', t: '"messages"' },
    { c: 'tok-str', t: ': [{ "role": "user", "content": "Hello, Nova!" }]' },
    { t: '\n' },
    { c: 'tok-str', t: "}'" },
  ];
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
})();
