/* ============================================================
   NovaCompute — shared model catalogue.
   1) Renders instantly from the baked-in snapshot below.
   2) fetchModels() pulls the live catalogue from the backend
      (GET /v1/models) and swaps window.NOVA_MODELS in place.
   Model IDs are the public API ids — e.g. "claude-opus-5.5" —
   never the upstream routing ids.
   ============================================================ */

(function () {
  'use strict';

  const TAG_STYLES = {
    Popular: 'border-violet-400/25 bg-violet-500/10 text-violet-300',
    New: 'border-cyan-400/25 bg-cyan-500/10 text-cyan-300',
    'Best value': 'border-emerald-400/25 bg-emerald-500/10 text-emerald-300',
    Free: 'border-emerald-400/25 bg-emerald-500/10 text-emerald-300',
    Diffusion: 'border-fuchsia-400/25 bg-fuchsia-500/10 text-fuchsia-300',
    Sub: 'border-sky-400/25 bg-sky-500/10 text-sky-300',
  };

  const FALLBACK_MODELS = [
    { id: 'claude-opus-5.5', name: 'Claude Opus 5.5', provider: 'Anthropic', color: '#d97757', context: '1M', speed: 85, input: 3.2, output: 16.0, tag: 'Popular', category: 'chat', image: true, video: false, note: '' },
    { id: 'claude-sonnet-5.5', name: 'Claude Sonnet 5.5', provider: 'Anthropic', color: '#d97757', context: '1M', speed: 92, input: 1.8, output: 9.0, tag: null, category: 'chat', image: true, video: false, note: '' },
    { id: 'gpt-6-luna', name: 'GPT-6', provider: 'OpenAI', color: '#10a37f', context: '900K', speed: 118, input: 0.08, output: 0.4, tag: 'New', category: 'chat', image: true, video: false, note: '' },
    { id: 'gpt-5.6-luna', name: 'GPT-5.6', provider: 'OpenAI', color: '#10a37f', context: '900K', speed: 130, input: 0.0, output: 0.0, tag: 'Free', category: 'chat', image: true, video: false, note: '' },
    { id: 'grok-4.6', name: 'Grok 4.6', provider: 'xAI', color: '#f43f5e', context: '500K', speed: 150, input: 0.1, output: 0.3, tag: null, category: 'chat', image: true, video: false, note: '' },
    { id: 'deepseek-v4.1-flash', name: 'DeepSeek V4.1', provider: 'DeepSeek', color: '#4d6bfe', context: '1M', speed: 145, input: 0.0, output: 0.0, tag: 'Free', category: 'code', image: true, video: false, note: '' },
    { id: 'deepseek-v4.1-flash-1017', name: 'DeepSeek V4.1 1017', provider: 'DeepSeek', color: '#4d6bfe', context: '1M', speed: 145, input: 0.005, output: 0.24, tag: null, category: 'code', image: true, video: false, note: '' },
    { id: 'kimi-k3.1-pro', name: 'Kimi k3.1 Pro', provider: 'Moonshot AI', color: '#8b5cf6', context: '1M', speed: 120, input: 1.0, output: 1.0, tag: null, category: 'chat', image: true, video: true, note: '' },
    { id: 'mistral-large-4', name: 'Mistral Large 4', provider: 'Mistral AI', color: '#ff7000', context: '1M', speed: 98, input: 0.0, output: 0.0, tag: 'Free', category: 'chat', image: true, video: false, note: '' },
    { id: 'mercury-3', name: 'Mercury 3', provider: 'Inception', color: '#d946ef', context: '1M', speed: 1000, input: 0.1, output: 0.35, tag: 'Diffusion', category: 'code', image: false, video: false, note: '' },
    { id: 'glm-5.3-flash', name: 'GLM 5.3 Flash', provider: 'Z.ai', color: '#0ea5e9', context: '1M', speed: 240, input: 0.03, output: 0.07, tag: null, category: 'chat', image: true, video: true, note: '' },
    { id: 'glm-5.3', name: 'GLM 5.3', provider: 'Z.ai', color: '#0ea5e9', context: '1M', speed: 85, input: 0.0, output: 0.0, tag: 'Free', category: 'chat', image: false, video: false, note: '' },
    { id: 'qwen/qwen3.7-flash:free', name: 'Qwen 3.7', provider: 'Alibaba', color: '#6366f1', context: '1M', speed: 130, input: 0.0, output: 0.0, tag: 'Free', category: 'chat', image: true, video: true, note: '' },
    { id: 'gemini-4-argon', name: 'Gemini 4 Argon', provider: 'Google', color: '#4285f4', context: '1M', speed: 110, input: 0.4, output: 1.2, tag: null, category: 'chat', image: true, video: true, note: '' },
    { id: 'ernie-5.5-flash', name: 'ERNIE-5.5-Flash', provider: 'Baidu', color: '#2932e1', context: '1M', speed: 0, input: 0.14, output: 0.565, tag: null, category: 'chat', image: false, video: false, note: '' },
    { id: 'gemini-3.8-flash-lite-tts', name: 'Gemini 3.8 Flash-Lite TTS', provider: 'Google', color: '#4285f4', context: '—', speed: 0, input: 0.0, output: 0.0046, price_unit: '1k_chars', tag: 'Sub', category: 'tts', image: false, video: false, note: 'Free with subscription · up to 100 req/day' },
    { id: 'omni-moderation', name: 'Omni Moderation', provider: 'OpenAI', color: '#10a37f', context: '—', speed: 0, input: 0.0, output: 0.0, tag: 'Free', category: 'moderation', image: true, video: false, note: 'Moderation API · free' },
  ];

  const FALLBACK_BY_ID = {};
  FALLBACK_MODELS.forEach((m) => { FALLBACK_BY_ID[m.id] = m; });

  const PROVIDER_COLORS = {
    anthropic: '#d97757', openai: '#10a37f', deepseek: '#4d6bfe',
    'moonshot ai': '#8b5cf6', 'mistral ai': '#ff7000', inception: '#d946ef',
    'z.ai': '#0ea5e9', alibaba: '#6366f1', xai: '#f43f5e', google: '#4285f4',
    baidu: '#2932e1',
  };
  const COLOR_PALETTE = ['#8b5cf6', '#22d3ee', '#f472b6', '#f59e0b', '#34d399', '#60a5fa'];

  function colorFor(id, provider) {
    if (FALLBACK_BY_ID[id]) return FALLBACK_BY_ID[id].color;
    const key = String(provider || '').toLowerCase();
    if (PROVIDER_COLORS[key]) return PROVIDER_COLORS[key];
    let hash = 0;
    for (const ch of key) hash = (hash + ch.charCodeAt(0)) % 997;
    return COLOR_PALETTE[hash % COLOR_PALETTE.length];
  }

  function mapBackendModel(raw) {
    if (!raw || !raw.id) return null;
    const pricing = raw.pricing || {};
    const input = parseFloat(pricing.input_per_1m !== undefined ? pricing.input_per_1m : raw.input) || 0;
    const output = parseFloat(pricing.output_per_1m !== undefined ? pricing.output_per_1m : raw.output) || 0;
    const snapshot = FALLBACK_BY_ID[raw.id] || {};
    const isFree = input === 0 && output === 0;
    const tag = raw.tag !== undefined && raw.tag !== null
      ? raw.tag
      : (isFree ? 'Free' : (snapshot.tag || null));
    return {
      id: String(raw.id),
      name: raw.name || snapshot.name || String(raw.id),
      provider: raw.owned_by || raw.provider || snapshot.provider || 'Custom',
      color: colorFor(raw.id, raw.owned_by || raw.provider),
      context: raw.context || snapshot.context || '—',
      speed: Number(raw.speed_tps !== undefined ? raw.speed_tps : (raw.speed !== undefined ? raw.speed : snapshot.speed)) || 0,
      input,
      output,
      tag,
      category: raw.category || snapshot.category || (/deepseek|mercury/i.test(String(raw.id)) ? 'code' : 'chat'),
      image: Boolean(raw.capabilities ? raw.capabilities.image : (raw.image !== undefined ? raw.image : snapshot.image)),
      video: Boolean(raw.capabilities ? raw.capabilities.video : (raw.video !== undefined ? raw.video : snapshot.video)),
      note: raw.note || snapshot.note || '',
      price_unit: raw.price_unit || snapshot.price_unit || null,
    };
  }

  window.NOVA_MODELS = FALLBACK_MODELS.slice();
  window.NOVA_MODELS_SOURCE = 'fallback';
  window.NOVA_TAG_STYLES = TAG_STYLES;

  window.fetchModels = async function fetchModels() {
    const base = (window.NOVA_API_BASE || 'http://127.0.0.1:8080').replace(/\/+$/, '');
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 4000);
      const res = await fetch(`${base}/v1/models`, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const payload = await res.json();
      const list = (payload.data || []).map(mapBackendModel).filter(Boolean);
      if (!list.length) throw new Error('empty catalogue');
      window.NOVA_MODELS = list;
      window.NOVA_MODELS_SOURCE = 'live';
      return list;
    } catch (err) {
      window.NOVA_MODELS = FALLBACK_MODELS.slice();
      window.NOVA_MODELS_SOURCE = 'fallback';
      return window.NOVA_MODELS;
    }
  };

  function rgba(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  }

  function priceCell(value) {
    return value === 0
      ? '<span class="font-medium text-emerald-400">Free</span>'
      : `<span class="font-mono text-slate-200">$${value.toFixed(2)}</span>`;
  }

  function tagCell(tag) {
    if (!tag) return '';
    const cls = TAG_STYLES[tag] || 'border-white/10 bg-white/5 text-slate-300';
    return `<span class="ml-2 hidden rounded-full border px-2 py-0.5 align-middle text-[10px] font-semibold sm:inline ${cls}">${tag}</span>`;
  }

  const MEDIA_BADGES = {
    image: '<span class="inline-flex h-6 w-6 items-center justify-center rounded-md border border-cyan-400/25 bg-cyan-500/10 text-cyan-300" title="Accepts image input"><svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"></rect><circle cx="9" cy="9" r="2"></circle><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"></path></svg></span>',
    video: '<span class="inline-flex h-6 w-6 items-center justify-center rounded-md border border-fuchsia-400/25 bg-fuchsia-500/10 text-fuchsia-300" title="Accepts video input"><svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="14" height="12" rx="2"></rect><path d="m16 10 6-3v10l-6-3z"></path></svg></span>',
  };

  function renderModelRow(m) {
    const MAX_SPEED = 1000;
    const bar = m.speed > 0 ? Math.max(8, Math.min(100, Math.round((m.speed / MAX_SPEED) * 100))) : 8;
    const canTry = m.category === 'chat' || m.category === 'code';
    const speedText = m.speed > 0 ? `${m.speed >= 1000 ? '1000+' : m.speed} tok/s` : '— tok/s';
    return `
      <tr class="model-row group" style="--m:${m.color}">
        <td class="px-6 py-4">
          <div class="flex items-center gap-3">
            <span class="model-avatar flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sm font-bold"
                  style="background:${rgba(m.color, 0.14)};color:${m.color};border:1px solid ${rgba(m.color, 0.3)}">${m.name.charAt(0)}</span>
            <div>
              <p class="font-medium text-white">${m.name}${tagCell(m.tag)}</p>
              <p class="mt-0.5 font-mono text-xs text-slate-500">${m.id}${m.note ? `<span class="text-slate-600"> · ${m.note}</span>` : ''}</p>
            </div>
          </div>
        </td>
        <td class="px-4 py-4 font-mono text-slate-300">${m.context}</td>
        <td class="px-4 py-4">
          <div class="flex items-center gap-3">
            <div class="h-1.5 w-28 overflow-hidden rounded-full bg-white/10">
              <div class="h-full rounded-full bg-gradient-to-r from-violet-500 to-cyan-400" style="width:${bar}%"></div>
            </div>
            <span class="whitespace-nowrap font-mono text-xs text-slate-400">${speedText}</span>
          </div>
        </td>
        <td class="px-4 py-4">
          <div class="flex items-center justify-center gap-1.5">
            ${m.image ? MEDIA_BADGES.image : ''}${m.video ? MEDIA_BADGES.video : ''}${!m.image && !m.video ? '<span class="text-xs text-slate-600">—</span>' : ''}
          </div>
        </td>
        <td class="whitespace-nowrap px-4 py-4 text-right">${m.category === 'tts' ? '<span class="text-slate-500">—</span>' : priceCell(m.input)}</td>
        <td class="whitespace-nowrap px-4 py-4 text-right">${m.price_unit === '1k_chars'
          ? `<span class="whitespace-nowrap font-mono text-slate-200">$${m.output.toFixed(4)}</span><span class="text-[10px] text-slate-500"> / 1k chars</span>`
          : priceCell(m.output)}</td>
        <td class="px-6 py-4 text-right">
          ${canTry
            ? `<a href="playground.html?model=${encodeURIComponent(m.id)}"
                  class="inline-flex items-center gap-1 text-xs font-medium text-violet-300 transition-colors hover:text-violet-200">
                 Try
                 <svg class="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"></path><path d="m12 5 7 7-7 7"></path></svg>
               </a>`
            : '<span class="text-xs text-slate-600" title="Not a chat model">—</span>'}
        </td>
      </tr>`;
  }

  function groupHeader(label, tone) {
    const cls = tone === 'free'
      ? 'bg-emerald-400/[0.04] text-emerald-300/80'
      : 'bg-violet-500/[0.05] text-violet-300/80';
    return `<tr class="models-group"><td colspan="7" class="border-y border-white/[0.06] px-6 py-2.5 text-[11px] font-semibold uppercase tracking-widest ${cls}">${label}</td></tr>`;
  }

  /** Render rows split into a Free table section and a Paid section. */
  window.renderModelRowsGrouped = function renderModelRowsGrouped(list) {
    const isFree = (m) => m.input === 0 && m.output === 0;
    const free = list.filter(isFree);
    const paid = list.filter((m) => !isFree(m));
    let html = '';
    if (free.length) {
      html += groupHeader('Free models · $0.00', 'free');
      html += free.map(renderModelRow).join('');
    }
    if (paid.length) {
      html += groupHeader('Paid models · per 1M tokens', 'paid');
      html += paid.map(renderModelRow).join('');
    }
    return html;
  };

  window.NOVA_MODEL_BY_ID = (id) => (window.NOVA_MODELS || []).find((m) => m.id === id) || null;
  window.novaRgba = rgba;
  window.renderModelRow = renderModelRow;
})();
