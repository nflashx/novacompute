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

  /* ---------- Model reference table ---------- */
  const modelRows = document.getElementById('docs-model-rows');

  function renderModelTable(models) {
    if (!modelRows) return;
    modelRows.innerHTML = models.map((m) => {
      const isFree = m.input === 0 && m.output === 0;
      const isTts = m.category === 'tts';
      const input = isTts
        ? '<span class="text-slate-600">—</span>'
        : isFree
          ? '<span class="font-medium text-emerald-400">Free</span>'
          : `<span class="font-mono text-slate-200">$${m.input.toFixed(2)}</span>`;
      const output = isTts
        ? `<span class="whitespace-nowrap font-mono text-slate-200">$${m.output.toFixed(4)}</span><span class="text-[10px] text-slate-500"> / 1k chars</span>`
        : isFree
          ? '<span class="font-medium text-emerald-400">Free</span>'
          : `<span class="font-mono text-slate-200">$${m.output.toFixed(2)}</span>`;
      const media = [
        m.image ? '<span class="rounded bg-cyan-500/10 px-1.5 py-0.5 font-mono text-[10px] text-cyan-300">IMG</span>' : '',
        m.video ? '<span class="rounded bg-fuchsia-500/10 px-1.5 py-0.5 font-mono text-[10px] text-fuchsia-300">VID</span>' : '',
      ].filter(Boolean).join(' ') || '<span class="text-slate-600">—</span>';
      const category = isTts
        ? '<span class="rounded bg-sky-500/10 px-1.5 py-0.5 font-mono text-[10px] text-sky-300">TTS</span>'
        : isFree
          ? '<span class="rounded bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[10px] text-emerald-300">FREE</span>'
          : '';
      return `<tr>
        <td class="px-4 py-3">
          <div class="flex items-center gap-2">
            <span class="font-medium text-white">${m.name}</span>${category}
          </div>
          <p class="mt-0.5 text-[11px] text-slate-500">${m.provider}</p>
        </td>
        <td class="px-3 py-3">
          <p class="whitespace-nowrap font-mono text-xs text-slate-300">${m.id}</p>
          <p class="mt-0.5 text-[10px] text-slate-500">${m.context || '—'} context</p>
        </td>
        <td class="px-3 py-3"><div class="flex items-center gap-1">${media}</div></td>
        <td class="px-3 py-3 text-right">${input}</td>
        <td class="px-4 py-3 text-right">${output}</td>
      </tr>`;
    }).join('');
  }

  if (modelRows && window.NOVA_MODELS) {
    renderModelTable(window.NOVA_MODELS);
    if (window.fetchModels) {
      window.fetchModels().then((models) => renderModelTable(models));
    }
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
