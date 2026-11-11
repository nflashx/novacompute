/* ============================================================
   NovaCompute — Playground.
   Model picker / temperature / max tokens + live chat against
   the Python backend: POST /v1/chat/completions (SSE stream).
   Every message goes to the real API — no local mock.
   ============================================================ */

(function () {
  'use strict';

  const MODEL_SELECT = document.getElementById('pg-model');
  const INFO_BOX = document.getElementById('pg-model-info');
  const CHAT_MODEL_CHIP = document.getElementById('pg-chat-model');
  const MESSAGES = document.getElementById('pg-messages');
  const EMPTY_STATE = document.getElementById('pg-empty');
  const INPUT = document.getElementById('pg-input');
  const SEND_BTN = document.getElementById('pg-send');
  const CLEAR_BTN = document.getElementById('pg-clear');
  const TEMP = document.getElementById('pg-temp');
  const TEMP_VAL = document.getElementById('pg-temp-val');
  const MAXTOK = document.getElementById('pg-maxtok');
  const MAXTOK_VAL = document.getElementById('pg-maxtok-val');
  const MODE_BADGE = document.getElementById('pg-mode-badge');

  if (!MODEL_SELECT) return;

  let busy = false;
  let history = [];
  const session = window.novaSession ? window.novaSession.get() : null;
  const signedIn = !!(session && session.api_key);

  /* ---------- Mode badge ---------- */
  if (MODE_BADGE) {
    if (signedIn) {
      MODE_BADGE.className = 'inline-flex w-fit items-center gap-2 rounded-full border border-emerald-400/25 bg-emerald-400/[0.07] px-3.5 py-1.5 text-xs font-medium text-emerald-300';
      MODE_BADGE.innerHTML = '<span class="relative flex h-2 w-2"><span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60"></span><span class="relative inline-flex h-2 w-2 rounded-full bg-emerald-400"></span></span>Live API — billed to your account';
    } else {
      MODE_BADGE.className = 'inline-flex w-fit items-center gap-2 rounded-full border border-amber-400/20 bg-amber-400/[0.07] px-3.5 py-1.5 text-xs font-medium text-amber-300';
      MODE_BADGE.textContent = 'Sign in required — the playground calls the live API';
    }
  }

  /* ---------- Model select (live catalogue; fallback offline) ---------- */
  const requested = new URLSearchParams(window.location.search).get('model');

  function populateModelOptions(preferredId) {
    MODEL_SELECT.innerHTML = '';
    (window.NOVA_MODELS || []).forEach((m) => {
      const opt = document.createElement('option');
      opt.value = m.id;
      const price = m.input === 0 ? 'Free' : `$${m.input.toFixed(2)}/$${m.output.toFixed(2)}`;
      opt.textContent = `${m.name} — ${price}`;
      MODEL_SELECT.appendChild(opt);
    });
    if (preferredId && window.NOVA_MODEL_BY_ID(preferredId)) {
      MODEL_SELECT.value = preferredId;
    }
    updateModelInfo();
  }

  populateModelOptions(requested);
  if (requested && window.NOVA_MODEL_BY_ID(requested)) {
    window.novaToast(`Loaded model: ${window.NOVA_MODEL_BY_ID(requested).name}`);
  }
  if (window.fetchModels) {
    window.fetchModels().then(() => populateModelOptions(MODEL_SELECT.value || requested));
  }

  function currentModel() {
    return window.NOVA_MODEL_BY_ID(MODEL_SELECT.value) || window.NOVA_MODELS[0];
  }

  function updateModelInfo() {
    const m = currentModel();
    if (!m) return;
    const set = (name, value) => {
      const el = INFO_BOX.querySelector(`[data-info="${name}"]`);
      if (el) el.textContent = value;
    };
    set('id', m.id);
    set('context', m.context);
    set('speed', `${m.speed >= 1000 ? '1000+' : m.speed} tok/s`);
    set('input', m.input === 0 ? 'Free' : `$${m.input.toFixed(2)}`);
    set('output', m.output === 0 ? 'Free' : `$${m.output.toFixed(2)}`);

    const badge = INFO_BOX.querySelector('[data-info="badge"]');
    if (m.tag && window.NOVA_TAG_STYLES[m.tag]) {
      badge.textContent = m.tag;
      badge.className = `rounded-full border px-2 py-0.5 text-[10px] font-semibold ${window.NOVA_TAG_STYLES[m.tag]}`;
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }

    CHAT_MODEL_CHIP.textContent = m.id;
    CHAT_MODEL_CHIP.style.borderColor = `${m.color}55`;
    CHAT_MODEL_CHIP.style.color = m.color;
  }
  MODEL_SELECT.addEventListener('change', updateModelInfo);
  updateModelInfo();

  /* ---------- Sliders ---------- */
  function paintRange(input) {
    const min = parseFloat(input.min);
    const max = parseFloat(input.max);
    input.style.setProperty('--val', `${((input.value - min) / (max - min)) * 100}%`);
  }
  TEMP.addEventListener('input', () => {
    TEMP_VAL.textContent = parseFloat(TEMP.value).toFixed(1);
    paintRange(TEMP);
  });
  MAXTOK.addEventListener('input', () => {
    MAXTOK_VAL.textContent = MAXTOK.value;
    paintRange(MAXTOK);
  });
  paintRange(TEMP);
  paintRange(MAXTOK);

  /* ---------- Chat rendering ---------- */
  function refreshEmptyState() {
    const hasMessages = MESSAGES.children.length > 0;
    EMPTY_STATE.classList.toggle('hidden', hasMessages);
    EMPTY_STATE.classList.toggle('flex', !hasMessages);
    MESSAGES.classList.toggle('hidden', !hasMessages);
  }

  function scrollBottom() {
    MESSAGES.scrollTop = MESSAGES.scrollHeight;
  }

  function addMessage(role, text, model) {
    EMPTY_STATE.classList.add('hidden');
    EMPTY_STATE.classList.remove('flex');
    MESSAGES.classList.remove('hidden');

    if (role === 'user') {
      const row = document.createElement('div');
      row.className = 'msg-enter flex justify-end';
      const bubble = document.createElement('div');
      bubble.className = 'max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-br-sm border border-violet-400/20 bg-violet-600/25 px-4 py-3 text-sm leading-relaxed text-slate-100';
      bubble.textContent = text;
      row.appendChild(bubble);
      MESSAGES.appendChild(row);
      scrollBottom();
      return row;
    }

    const m = model || currentModel();
    const row = document.createElement('div');
    row.className = 'msg-enter flex justify-start';
    row.innerHTML = `
      <div class="max-w-[85%]">
        <div class="mb-1.5 flex items-center gap-2">
          <span class="flex h-5 w-5 items-center justify-center rounded text-[10px] font-bold"
                style="background:${window.novaRgba ? window.novaRgba(m.color, 0.15) : 'transparent'};color:${m.color}">${m.name.charAt(0)}</span>
          <span class="text-xs font-medium" style="color:${m.color}">${m.name}</span>
        </div>
        <div class="whitespace-pre-wrap rounded-2xl rounded-bl-sm border border-white/10 bg-white/[0.04] px-4 py-3 text-sm leading-relaxed text-slate-200 msg-body"></div>
        <p class="msg-meta mt-1.5 hidden text-[11px] text-slate-500"></p>
      </div>`;
    row.querySelector('.msg-body').textContent = text;
    MESSAGES.appendChild(row);
    scrollBottom();
    return row;
  }

  function addTypingIndicator() {
    const row = document.createElement('div');
    row.className = 'msg-enter flex justify-start';
    row.innerHTML = `
      <div class="rounded-2xl rounded-bl-sm border border-white/10 bg-white/[0.04] px-4 py-3.5">
        <div class="typing-dots" aria-label="Model is typing"><span></span><span></span><span></span></div>
      </div>`;
    MESSAGES.appendChild(row);
    scrollBottom();
    return row;
  }

  /* ---------- Send flow (always the live API) ---------- */
  function send() {
    const text = INPUT.value.trim();
    if (!text || busy) return;

    if (!signedIn) {
      window.novaToast('Sign in to use the API — every message goes to the live backend.', false);
      return;
    }

    busy = true;
    addMessage('user', text);
    INPUT.value = '';
    INPUT.style.height = 'auto';
    sendLive(text);
  }

  async function sendLive(text) {
    const m = currentModel();
    const systemPrompt = document.getElementById('pg-system').value.trim();
    history.push({ role: 'user', content: text });

    const messages = systemPrompt
      ? [{ role: 'system', content: systemPrompt }, ...history]
      : [...history];

    const indicator = addTypingIndicator();
    const started = performance.now();

    let res;
    try {
      res = await fetch(window.NOVA_API_BASE + '/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.api_key}`,
        },
        body: JSON.stringify({
          model: m.id,
          messages,
          temperature: parseFloat(TEMP.value),
          max_tokens: parseInt(MAXTOK.value, 10),
          stream: true,
        }),
      });
    } catch (err) {
      indicator.remove();
      addMessage('bot', '⚠ Cannot reach the backend. Start it with start.bat (python backend\\app.py on port 8080).', m);
      history.pop();
      busy = false;
      return;
    }

    if (!res.ok) {
      indicator.remove();
      let message = `⚠ Request failed (HTTP ${res.status}).`;
      try {
        const err = await res.json();
        message = `⚠ ${err.error?.message || message}`;
      } catch (e) { /* keep default */ }
      addMessage('bot', message, m);
      history.pop();
      busy = false;
      return;
    }

    indicator.remove();
    const row = addMessage('bot', '', m);
    const body = row.querySelector('.msg-body');
    const meta = row.querySelector('.msg-meta');

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let full = '';
    let usage = null;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let newline;
        while ((newline = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;
          try {
            const event = JSON.parse(payload);
            if (event.usage) usage = event.usage;
            const delta = event.choices?.[0]?.delta?.content || '';
            if (delta) {
              full += delta;
              body.textContent = full;
              scrollBottom();
            }
          } catch (e) { /* ignore malformed keep-alive lines */ }
        }
      }
    } catch (err) {
      body.textContent = full + '\n\n⚠ The stream was interrupted.';
    }

    if (full) history.push({ role: 'assistant', content: full });
    else history.pop();

    const seconds = ((performance.now() - started) / 1000).toFixed(1);
    const tokensOut = usage ? usage.completion_tokens : Math.max(1, Math.round(full.length / 4));
    meta.textContent = `${m.id} · ${tokensOut} tokens · ${seconds}s · temp ${parseFloat(TEMP.value).toFixed(1)} · live`;
    meta.classList.remove('hidden');
    busy = false;
    scrollBottom();
  }

  SEND_BTN.addEventListener('click', send);
  INPUT.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });
  INPUT.addEventListener('input', () => {
    INPUT.style.height = 'auto';
    INPUT.style.height = `${Math.min(INPUT.scrollHeight, 128)}px`;
  });

  CLEAR_BTN.addEventListener('click', () => {
    MESSAGES.innerHTML = '';
    history = [];
    refreshEmptyState();
    window.novaToast('Conversation cleared');
  });

  refreshEmptyState();
})();
