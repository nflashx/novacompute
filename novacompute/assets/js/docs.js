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

  /* Keep every example on the same origin as the site (or NOVA_API_BASE). */
  function rewriteApiOrigin() {
    const base = window.novaApiBase ? window.novaApiBase() : '';
    if (!base) return;
    const origin = base.replace(/\/v1$/, '');
    const old = 'https://YOUR-DOMAIN';
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach((node) => {
      if (node.nodeValue.includes(old)) node.nodeValue = node.nodeValue.replaceAll(old, origin);
    });
    document.querySelectorAll('[data-copy-text]').forEach((el) => {
      if (el.dataset.copyText.includes(old)) el.dataset.copyText = el.dataset.copyText.replaceAll(old, origin);
    });
  }
  rewriteApiOrigin();

  function shortTokens(value) {
    const v = Number(value || 0);
    if (v >= 1000000) return (v / 1000000).toFixed(v >= 10000000 ? 0 : 1).replace(/\.0$/, '') + 'M';
    if (v >= 1000) return (v / 1000).toFixed(v >= 100000 ? 0 : 1).replace(/\.0$/, '') + 'K';
    return String(v);
  }

  /* ---------- Model reference table ---------- */
  const modelRows = document.getElementById('docs-model-rows');

  function renderModelTable(models) {
    if (!modelRows) return;
    const rank = (m) => {
      if (m.category === 'tts') return 99;
      const s = `${m.name || ''} ${m.id || ''}`.toLowerCase();
      if (/\bclaude\b|anthropic/.test(s)) return 0;
      if (/\bgrok\b|xai/.test(s)) return 1;
      if (/\bgpt|openai/.test(s)) return 2;
      if (/gemini|google/.test(s)) return 3;
      if (/deepseek/.test(s)) return 4;
      if (/\bglm|zhipu/.test(s)) return 5;
      if (/kimi|moonshot/.test(s)) return 6;
      if (/qwen|alibaba/.test(s)) return 7;
      if (/mistral/.test(s)) return 8;
      if (/minimax/.test(s)) return 9;
      if (/nemotron|nvidia/.test(s)) return 10;
      if (/maritaca|\bs5\b/.test(s)) return 11;
      if (/exaone|lg ai/.test(s)) return 12;
      if (/raon|krafton/.test(s)) return 13;
      if (/mercury|inception/.test(s)) return 14;
      if (/dots/.test(s)) return 15;
      if (/ernie|baidu/.test(s)) return 16;
      return 20;
    };
    const bySpeed = (a, b) => (Number(b.speed) || 0) - (Number(a.speed) || 0) || String(a.name).localeCompare(String(b.name));
    modelRows.innerHTML = models.slice().sort((a, b) => rank(a) - rank(b) || bySpeed(a, b)).map((m) => {
      const isFree = m.input === 0 && m.output === 0 && Number(m.price_per_request || 0) === 0;
      const isTts = m.category === 'tts';
      const isRequest = m.price_unit === 'request';
      const input = isTts
        ? '<span class="text-slate-600">—</span>'
        : isRequest
          ? `<span class="font-mono text-slate-200" title="Billed per request">$${Number(m.price_per_request || 0).toFixed(2)}</span>`
          : isFree
            ? '<span class="font-medium text-emerald-400">Free</span>'
            : `<span class="font-mono text-slate-200">$${m.input.toFixed(m.input > 0 && m.input < 0.01 ? 3 : 2)}</span>`;
      const output = isTts
        ? `<span class="whitespace-nowrap font-mono text-slate-200">$${m.output.toFixed(4)}</span><span class="text-[10px] text-slate-500"> / 1k chars</span>`
        : isRequest
          ? '<span class="text-slate-600">—</span>'
          : isFree
            ? '<span class="font-medium text-emerald-400">Free</span>'
            : `<span class="font-mono text-slate-200">$${m.output.toFixed(m.output > 0 && m.output < 0.01 ? 3 : 2)}</span>`;
      const media = [
        m.image ? '<span class="rounded bg-cyan-500/10 px-1.5 py-0.5 font-mono text-[10px] text-cyan-300">IMG</span>' : '',
        m.video ? '<span class="rounded bg-fuchsia-500/10 px-1.5 py-0.5 font-mono text-[10px] text-fuchsia-300">VID</span>' : '',
      ].filter(Boolean).join(' ') || '<span class="text-slate-600">—</span>';
      const category = isTts
        ? '<span class="rounded bg-sky-500/10 px-1.5 py-0.5 font-mono text-[10px] text-sky-300">TTS</span>'
        : isFree
          ? '<span class="rounded bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[10px] text-emerald-300">FREE</span>'
          : '';
      const mult = (!isTts && !isRequest && !isFree && m.sub_allowance_pro)
        ? `<span class="rounded bg-indigo-500/10 px-1.5 py-0.5 font-mono text-[10px] text-indigo-300" title="Included daily on the Pro plan; scales with your plan.">Included ${shortTokens(m.sub_allowance_pro)}/day</span>`
        : '';
      return `<tr>
        <td class="px-4 py-3">
          <div class="flex items-center gap-2">
            <span class="font-medium text-white">${m.name}</span>${category}${mult}
          </div>
          <p class="mt-0.5 text-[11px] text-slate-500">${m.provider}</p>
        </td>
        <td class="px-3 py-3">
          <p class="whitespace-nowrap font-mono text-xs text-slate-300">${m.id}</p>
          <p class="mt-0.5 text-[10px] text-slate-500">${m.context || '—'} context</p>
        </td>
        <td class="px-3 py-3"><div class="flex items-center gap-1">${media}</div></td>
        <td class="px-3 py-3 text-right font-mono text-xs">${m.speed > 0 ? `${m.speed} tok/s` : '—'}</td>
        <td class="px-3 py-3 text-right">${input}</td>
        <td class="px-4 py-3 text-right">${output}</td>
      </tr>`;
    }).join('');
  }

  if (modelRows && window.NOVA_MODELS) {
    renderModelTable(window.NOVA_MODELS.filter((m) => m.category !== 'decision'));
    if (window.fetchModels) {
      window.fetchModels().then((models) => renderModelTable(models.filter((m) => m.category !== 'decision')));
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

  if (sections.length) {
    let ticking = false;
    const syncActive = () => {
      ticking = false;
      const marker = window.innerHeight * 0.25;
      let current = sections[0].id;
      sections.forEach((s) => {
        if (s.getBoundingClientRect().top <= marker) current = s.id;
      });
      setActive(current);
    };
    window.addEventListener('scroll', () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(syncActive);
      }
    }, { passive: true });
    window.addEventListener('resize', syncActive);
    syncActive();
  } else {
    setActive('');
  }
})();
