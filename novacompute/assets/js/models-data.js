/* ============================================================
   NovaCompute — shared model catalogue.
   1) Renders immediately from a baked-in snapshot (so the UI never
      flashes empty) — the snapshot includes every current model,
      e.g. Grok 4.6 (xAI / ExosAI) at $0.50 / $1.50.
   2) fetchModels() pulls the live catalogue from the backend
      (GET /v1/models) and swaps window.NOVA_MODELS in place.
      If the backend is down, the snapshot stays and
      NOVA_MODELS_SOURCE = "fallback".
   Consumers: landing.js, pricing.js, playground.js, dashboard.js.
   ============================================================ */

(function () {
  'use strict';

  const TAG_STYLES = {
    Popular: 'border-violet-400/25 bg-violet-500/10 text-violet-300',
    New: 'border-cyan-400/25 bg-cyan-500/10 text-cyan-300',
    'Best value': 'border-emerald-400/25 bg-emerald-500/10 text-emerald-300',
    Free: 'border-emerald-400/25 bg-emerald-500/10 text-emerald-300',
    Diffusion: 'border-fuchsia-400/25 bg-fuchsia-500/10 text-fuchsia-300',
  };

  /* Snapshot used when the backend is unreachable — keep in sync with
     backend/app.py MODELS (plus custom_models.json if you rely on it offline). */
  const FALLBACK_MODELS = [
    { id: 'claude-opus-5.5-free', name: 'Claude Opus 5.5', provider: 'Anthropic', color: '#d97757', context: '1M', speed: 85, input: 3.20, output: 16.00, tag: 'Popular', category: 'chat', image: true, video: false },
    { id: 'claude-sonnet-5-5-free', name: 'Claude Sonnet 5.5', provider: 'Anthropic', color: '#d97757', context: '1M', speed: 92, input: 1.80, output: 9.00, tag: null, category: 'chat', image: true, video: false },
    { id: 'gpt-6-luna', name: 'GPT-6', provider: 'OpenAI', color: '#10a37f', context: '900K', speed: 118, input: 0.08, output: 0.40, tag: 'New', category: 'chat', image: false, video: false },
    { id: 'gpt-5.6-luna', name: 'GPT-5.6', provider: 'OpenAI', color: '#10a37f', context: '900K', speed: 130, input: 0.16, output: 0.96, tag: null, category: 'chat', image: true, video: false },
    { id: 'grok-4.6', name: 'Grok 4.6', provider: 'xAI', color: '#f43f5e', context: '500K', speed: 150, input: 0.10, output: 0.30, tag: null, category: 'chat', image: true, video: false },
    { id: 'deepseek-v4.1-flash', name: 'DeepSeek V4.1', provider: 'DeepSeek', color: '#4d6bfe', context: '1M', speed: 145, input: 0.02, output: 0.24, tag: 'Best value', category: 'code', image: true, video: false },
    { id: 'deepseek-v4.1-flash-1017', name: 'DeepSeek V4.1 1017', provider: 'DeepSeek', color: '#4d6bfe', context: '1M', speed: 145, input: 0.02, output: 0.24, tag: null, category: 'code', image: true, video: false },
    { id: 'kimi-k3.1-pro-free', name: 'Kimi k3.1 Pro', provider: 'Moonshot AI', color: '#8b5cf6', context: '1M', speed: 120, input: 1.00, output: 1.00, tag: null, category: 'chat', image: true, video: true },
    { id: 'mistral-large-4', name: 'Mistral Large 4', provider: 'Mistral AI', color: '#ff7000', context: '1M', speed: 98, input: 0.45, output: 1.35, tag: null, category: 'chat', image: true, video: false },
    { id: 'mercury-3', name: 'Mercury 3', provider: 'Inception', color: '#d946ef', context: '1M', speed: 1000, input: 0.10, output: 0.35, tag: 'Diffusion', category: 'code', image: false, video: false },
    { id: 'glm-5.3-flash', name: 'GLM 5.3 Flash', provider: 'Z.ai', color: '#0ea5e9', context: '1M', speed: 240, input: 0.05, output: 0.20, tag: null, category: 'chat', image: false, video: false },
    { id: 'glm-5.3', name: 'GLM 5.3', provider: 'Z.ai', color: '#0ea5e9', context: '1M', speed: 85, input: 0.30, output: 0.80, tag: null, category: 'chat', image: false, video: false },
    { id: 'qwen/qwen3.7-flash:free', name: 'Qwen 3.7', provider: 'Alibaba', color: '#6366f1', context: '1M', speed: 130, input: 0.0, output: 0.0, tag: 'Free', category: 'chat', image: true, video: false },
    { id: 'gemini-4-argon-free', name: 'Gemini 4 Argon', provider: 'Google', color: '#4285f4', context: '1M', speed: 110, input: 0.40, output: 1.20, tag: null, category: 'chat', image: false, video: false },
  ];

  const FALLBACK_BY_ID = {};
  FALLBACK_MODELS.forEach((m) => { FALLBACK_BY_ID[m.id] = m; });

  const PROVIDER_COLORS = {
    anthropic: '#d97757',
    openai: '#10a37f',
    deepseek: '#4d6bfe',
    'moonshot ai': '#8b5cf6',
    'mistral ai': '#ff7000',
    inception: '#d946ef',
    'z.ai': '#0ea5e9',
    alibaba: '#6366f1',
    xai: '#f43f5e',
    google: '#4285f4',
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

  /* Backend shape: { id, owned_by, name, context, speed_tps, pricing:{...} }
     (also tolerates the static shape: provider / speed / input / output) */
  function mapBackendModel(raw) {
    if (!raw || !raw.id) return null;
    const pricing = raw.pricing || {};
    const input = parseFloat(pricing.input_per_1m !== undefined ? pricing.input_per_1m : raw.input) || 0;
    const output = parseFloat(pricing.output_per_1m !== undefined ? pricing.output_per_1m : raw.output) || 0;
    const snapshot = FALLBACK_BY_ID[raw.id] || {};
    const isFree = input === 0 && output === 0;
    return {
      id: String(raw.id),
      name: raw.name || snapshot.name || String(raw.id),
      provider: raw.owned_by || raw.provider || snapshot.provider || 'Custom',
      color: colorFor(raw.id, raw.owned_by || raw.provider),
      context: raw.context || snapshot.context || '—',
      speed: Number(raw.speed_tps !== undefined ? raw.speed_tps : (raw.speed !== undefined ? raw.speed : snapshot.speed)) || 0,
      input,
      output,
      tag: isFree ? 'Free' : (snapshot.tag || null),
      image: Boolean(raw.capabilities ? raw.capabilities.image : (raw.image !== undefined ? raw.image : snapshot.image)),
      video: Boolean(raw.capabilities ? raw.capabilities.video : (raw.video !== undefined ? raw.video : snapshot.video)),
      category: /deepseek|mercury/i.test(String(raw.id)) ? 'code' : 'chat',
    };
  }

  window.NOVA_MODELS = FALLBACK_MODELS.slice();
  window.NOVA_MODELS_SOURCE = 'fallback';
  window.NOVA_TAG_STYLES = TAG_STYLES;

  /**
   * Pull the live catalogue from the backend.
   * Resolves with the model array; never throws (falls back to the snapshot).
   */
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

  function renderModelRow(m) {
    const MAX_SPEED = 1000;
    const bar = Math.max(8, Math.min(100, Math.round((m.speed / MAX_SPEED) * 100)));
    return `
      <tr class="model-row group" style="--m:${m.color}">
        <td class="px-6 py-4">
          <div class="flex items-center gap-3">
            <span class="model-avatar flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sm font-bold"
                  style="background:${rgba(m.color, 0.14)};color:${m.color};border:1px solid ${rgba(m.color, 0.3)}">${m.name.charAt(0)}</span>
            <div>
              <p class="font-medium text-white">${m.name}${tagCell(m.tag)}${m.image ? '<span class="ml-2 hidden sm:inline-flex items-center gap-1 rounded-full border border-cyan-400/25 bg-cyan-500/10 px-2 py-0.5 align-middle text-[10px] font-semibold text-cyan-300" title="Accepts image input"><svg class="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"></rect><circle cx="9" cy="9" r="2"></circle><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"></path></svg>IMG</span>' : ''}${m.video ? '<span class="ml-2 hidden sm:inline-flex items-center gap-1 rounded-full border border-fuchsia-400/25 bg-fuchsia-500/10 px-2 py-0.5 align-middle text-[10px] font-semibold text-fuchsia-300" title="Accepts video input"><svg class="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="14" height="12" rx="2"></rect><path d="m16 10 6-3v10l-6-3z"></path></svg>VID</span>' : ''}</p>
              <p class="mt-0.5 font-mono text-xs text-slate-500">${m.id}</p>
            </div>
          </div>
        </td>
        <td class="px-4 py-4 font-mono text-slate-300">${m.context}</td>
        <td class="px-4 py-4">
          <div class="flex items-center gap-3">
            <div class="h-1.5 w-28 overflow-hidden rounded-full bg-white/10">
              <div class="h-full rounded-full bg-gradient-to-r from-violet-500 to-cyan-400" style="width:${bar}%"></div>
            </div>
            <span class="font-mono text-xs text-slate-400">${m.speed >= 1000 ? '1000+' : m.speed} tok/s</span>
          </div>
        </td>
        <td class="px-4 py-4 text-right">${priceCell(m.input)}</td>
        <td class="px-4 py-4 text-right">${priceCell(m.output)}</td>
        <td class="px-6 py-4 text-right">
          <a href="playground.html?model=${encodeURIComponent(m.id)}"
             class="inline-flex items-center gap-1 text-xs font-medium text-violet-300 transition-colors hover:text-violet-200">
            Try
            <svg class="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"></path><path d="m12 5 7 7-7 7"></path></svg>
          </a>
        </td>
      </tr>`;
  }

  window.NOVA_MODEL_BY_ID = (id) => (window.NOVA_MODELS || []).find((m) => m.id === id) || null;
  window.novaRgba = rgba;
  window.renderModelRow = renderModelRow;
})();
