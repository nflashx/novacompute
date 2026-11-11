/* ============================================================
   NovaCompute — Documentation page.
   Copy-to-clipboard buttons, "On this page" TOC + scroll spy,
   and the model ID reference grid.
   ============================================================ */

(function () {
  'use strict';

  /* ---------- Copy buttons ---------- */
  document.querySelectorAll('[data-copy]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const code = document.getElementById(btn.dataset.copy);
      if (!code) return;
      const ok = await window.novaCopy(code.textContent);
      if (ok) {
        btn.textContent = 'Copied!';
        window.novaToast('Copied to clipboard');
        setTimeout(() => { btn.textContent = 'Copy'; }, 1600);
      } else {
        window.novaToast('Copy failed — select the code manually', false);
      }
    });
  });

  document.querySelectorAll('[data-copy-text]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const ok = await window.novaCopy(btn.dataset.copyText);
      window.novaToast(ok ? 'Endpoint URL copied' : 'Copy failed', ok);
    });
  });

  /* ---------- Model ID reference grid ---------- */
  const grid = document.getElementById('docs-model-grid');
  if (grid && window.NOVA_MODELS) {
    grid.innerHTML = window.NOVA_MODELS.map((m) => `
      <div class="glass flex items-center justify-between rounded-xl px-4 py-3">
        <div class="flex min-w-0 items-center gap-3">
          <span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[11px] font-bold"
                style="background:${window.novaRgba(m.color, 0.15)};color:${m.color}">${m.name.charAt(0)}</span>
          <code class="truncate font-mono text-xs text-slate-200">${m.id}</code>
        </div>
        <span class="ml-3 shrink-0 text-xs text-slate-500">${m.input === 0 ? 'Free' : `$${m.input.toFixed(2)} in`}</span>
      </div>`).join('');
  }

  /* ---------- TOC build + scroll spy ---------- */
  const sections = [...document.querySelectorAll('[data-docs-section]')];
  const tocList = document.getElementById('toc-list');
  const docsLinks = [...document.querySelectorAll('.docs-link')];

  if (tocList && sections.length) {
    tocList.innerHTML = sections.map((s) => {
      const h2 = s.querySelector('h2');
      return `<li><a href="#${s.id}" class="toc-link block border-l-2 border-transparent py-1 pl-3 text-slate-500 transition-colors hover:text-slate-300 -ml-[13px]">${h2 ? h2.textContent : s.id}</a></li>`;
    }).join('');
  }

  const tocLinks = [...document.querySelectorAll('.toc-link')];

  function setActive(id) {
    docsLinks.forEach((a) => {
      const active = a.getAttribute('href') === `#${id}`;
      a.classList.toggle('bg-white/[0.06]', active);
      a.classList.toggle('text-white', active);
    });
    tocLinks.forEach((a) => {
      const active = a.getAttribute('href') === `#${id}`;
      a.classList.toggle('border-violet-400', active);
      a.classList.toggle('text-violet-300', active);
      a.classList.toggle('text-slate-500', !active);
    });
  }

  if ('IntersectionObserver' in window && sections.length) {
    const spy = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) setActive(entry.target.id);
      });
    }, { rootMargin: '-20% 0px -70% 0px' });
    sections.forEach((s) => spy.observe(s));
  }
  setActive(sections.length ? sections[0].id : '');
})();
