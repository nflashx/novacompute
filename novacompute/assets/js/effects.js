/* ============================================================
   NovaCompute — shared visual effects.
   Ripple (buttons), typing helpers, constellation particles,
   toast notifications, scroll-reveal. Loaded on every page.
   ============================================================ */

(function () {
  'use strict';

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  window.NOA_REDUCED_MOTION = reduced;

  /* ---------- Button ripple ---------- */
  if (!reduced) {
    document.addEventListener('pointerdown', (e) => {
      const btn = e.target.closest('.btn-primary, .btn-ghost');
      if (!btn) return;
      const rect = btn.getBoundingClientRect();
      const d = Math.max(rect.width, rect.height) * 1.15;
      const s = document.createElement('span');
      s.className = 'ripple';
      s.style.width = s.style.height = `${d}px`;
      s.style.left = `${e.clientX - rect.left - d / 2}px`;
      s.style.top = `${e.clientY - rect.top - d / 2}px`;
      btn.appendChild(s);
      s.addEventListener('animationend', () => s.remove());
    });
  }

  /* ---------- Toast ---------- */
  window.novaToast = function (message, ok) {
    let host = document.getElementById('nova-toasts');
    if (!host) {
      host = document.createElement('div');
      host.id = 'nova-toasts';
      host.className = 'fixed bottom-6 right-6 z-[100] flex flex-col items-end gap-2';
      document.body.appendChild(host);
    }
    const t = document.createElement('div');
    t.className = 'toast glass flex items-center gap-2.5 rounded-xl px-4 py-3 text-sm text-slate-200 shadow-card';
    const icon = ok === false
      ? '<svg class="h-4 w-4 shrink-0 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"></path></svg>'
      : '<svg class="h-4 w-4 shrink-0 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"></path></svg>';
    t.innerHTML = `${icon}<span></span>`;
    t.querySelector('span').textContent = message;
    host.appendChild(t);
    setTimeout(() => t.remove(), 2800);
  };

  /* ---------- Typing (plain text) ---------- */
  window.novaType = function (el, text, speed = 28, done) {
    if (!el) return;
    if (reduced) {
      el.textContent = text;
      if (done) done();
      return;
    }
    let i = 0;
    (function tick() {
      el.textContent = text.slice(0, ++i);
      if (i < text.length) setTimeout(tick, speed + Math.random() * 26);
      else if (done) done();
    })();
  };

  /* ---------- Typing (token-colored code) ----------
     tokens: [{ c: 'tok-cmd'|null, t: 'text' }, ...]
     Renders char-by-char, then leaves a blinking block caret. */
  window.novaTypeCode = function (el, tokens, charDelay = 12, done) {
    if (!el) return;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    el.textContent = '';

    if (reduced) {
      for (const tk of tokens) {
        const span = document.createElement('span');
        if (tk.c) span.className = tk.c;
        span.textContent = tk.t;
        el.appendChild(span);
      }
      const caret = document.createElement('span');
      caret.className = 'code-caret';
      el.appendChild(caret);
      if (done) done();
      return;
    }

    let cancelled = false;
    (async () => {
      for (const tk of tokens) {
        const span = document.createElement('span');
        if (tk.c) span.className = tk.c;
        el.appendChild(span);
        for (const ch of tk.t) {
          if (cancelled) return;
          span.textContent += ch;
          await sleep(charDelay + Math.random() * 9);
        }
      }
      const caret = document.createElement('span');
      caret.className = 'code-caret';
      el.appendChild(caret);
      if (done) done();
    })();
    return () => { cancelled = true; };
  };

  /* ---------- Constellation particles (spider-web network) ---------- */
  window.novaParticles = function (canvas, opts = {}) {
    if (!canvas || reduced) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const colors = opts.colors || ['167,139,250', '34,211,238', '129,140,248'];
    const LINK = opts.link || 120;
    const DPR = Math.min(window.devicePixelRatio || 1, 2);
    let w = 0, h = 0, nodes = [], raf = null;

    function resize() {
      const rect = canvas.getBoundingClientRect();
      w = rect.width; h = rect.height;
      canvas.width = Math.round(w * DPR);
      canvas.height = Math.round(h * DPR);
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      const count = Math.round(Math.min(opts.maxNodes || 64, Math.max(22, (w * h) / 28000)));
      nodes = Array.from({ length: count }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.35,
        vy: (Math.random() - 0.5) * 0.35,
        r: Math.random() * 1.5 + 0.8,
        c: colors[(Math.random() * colors.length) | 0],
      }));
    }

    function step() {
      ctx.clearRect(0, 0, w, h);
      for (const n of nodes) {
        n.x += n.vx; n.y += n.vy;
        if (n.x < -20) n.x = w + 20; else if (n.x > w + 20) n.x = -20;
        if (n.y < -20) n.y = h + 20; else if (n.y > h + 20) n.y = -20;
      }
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j];
          const dx = a.x - b.x, dy = a.y - b.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < LINK * LINK) {
            const alpha = (1 - Math.sqrt(d2) / LINK) * 0.15;
            ctx.strokeStyle = `rgba(148,163,184,${alpha})`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
        ctx.fillStyle = `rgba(${a.c},0.7)`;
        ctx.beginPath();
        ctx.arc(a.x, a.y, a.r, 0, Math.PI * 2);
        ctx.fill();
      }
      raf = requestAnimationFrame(step);
    }

    resize();
    step();
    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (raf) { cancelAnimationFrame(raf); raf = null; }
      } else if (!raf) {
        step();
      }
    });
  };

  /* ---------- Scroll reveal (auto-runs for .reveal elements) ---------- */
  function initReveal() {
    const els = document.querySelectorAll('.reveal');
    if (!els.length) return;
    if (reduced || !('IntersectionObserver' in window)) {
      els.forEach((el) => el.classList.add('is-visible'));
      return;
    }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    els.forEach((el) => io.observe(el));
  }
  initReveal();

  /* ---------- Clipboard helper ---------- */
  window.novaCopy = async function (text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (err) {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (e2) { ok = false; }
      ta.remove();
      return ok;
    }
  };
})();
