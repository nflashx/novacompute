/* ============================================================
   NovaCompute — shared model catalogue.
   1) Renders instantly from the baked-in snapshot below.
   2) fetchModels() pulls the live catalogue from the backend
      (GET /v1/models) and swaps window.NOVA_MODELS in place.
   Model IDs are the public API ids — e.g. "deepseek-v4.1-flash" —
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
    { id: "gpt-6-luna", name: "GPT-6", provider: "OpenAI", color: "#10a37f", context: "900K", speed: 18, input: 0.08, output: 0.4, tag: "New", category: "chat", image: true, video: false, note: "", quota_multiplier: 8 },
    { id: "gpt-5.6-luna", name: "GPT-5.6", provider: "OpenAI", color: "#10a37f", context: "900K", speed: 8.03, input: 0.0, output: 0.0, tag: "Free", category: "chat", image: true, video: false, note: "", quota_multiplier: 1 },
    { id: "grok-4.6", name: "Grok 4.6", provider: "xAI", color: "#f43f5e", context: "500K", speed: 0.68, input: 1.7, output: 5.1, tag: null, category: "chat", image: true, video: false, note: "", quota_multiplier: 100 },
    { id: "deepseek-v4.1-flash", name: "DeepSeek V4.1", provider: "DeepSeek", color: "#4d6bfe", context: "1M", speed: 0, input: 0.0, output: 0.0, tag: "Free", category: "code", image: false, video: false, note: "", quota_multiplier: 1 },
    { id: "mistral-large-4", name: "Mistral Large 4", provider: "Mistral AI", color: "#ff7000", context: "1M", speed: 76.47, input: 0.0, output: 0.0, tag: "Free", category: "chat", image: true, video: false, note: "", quota_multiplier: 1 },
    { id: "mercury-3", name: "Mercury 3", provider: "Inception", color: "#d946ef", context: "1M", speed: 210.83, input: 0.1, output: 0.35, tag: "Diffusion", category: "code", image: false, video: false, note: "", quota_multiplier: 7 },
    { id: "qwen/qwen3.7-flash:free", name: "Qwen 3.7", provider: "Alibaba", color: "#6366f1", context: "1M", speed: 41.42, input: 0.0, output: 0.0, tag: "Free", category: "chat", image: true, video: false, note: "Free · image input", quota_multiplier: 1 },
    { id: "gemini-3.8-flash-lite-tts", name: "Gemini 3.8 Flash-Lite TTS", provider: "Google", color: "#4285f4", context: "—", speed: 0, input: 0.0, output: 0.0055, tag: "Sub", category: "tts", image: false, video: false, note: "Free with subscription · up to 100 req/day", price_unit: "1k_chars", quota_multiplier: 1 },
    { id: "gemini-3.8-flash-tts", name: "Gemini 3.8 Flash TTS", provider: "Google", color: "#4285f4", context: "—", speed: 0, input: 0.0, output: 0.008, tag: "Sub", category: "tts", image: false, video: false, note: "Free with subscription · up to 100 req/day", price_unit: "1k_chars", quota_multiplier: 1 },
    { id: "deepseek-v4-flash-0731-free", name: "DeepSeek V4 Flash 0731", provider: "DeepSeek", color: "#4d6bfe", context: "1M", speed: 0, input: 0.0, output: 0.0, tag: "Free", category: "chat", image: false, video: false, note: "Free tier · rate limited", quota_multiplier: 1 },
    { id: "deepseek-v4-flash-free", name: "DeepSeek V4 Flash", provider: "DeepSeek", color: "#4d6bfe", context: "1M", speed: 0, input: 0.0, output: 0.0, tag: "Free", category: "chat", image: false, video: false, note: "Free tier · rate limited", quota_multiplier: 1 },
    { id: "deepseek-v4-flash-vision-free", name: "DeepSeek V4 Flash Vision", provider: "DeepSeek", color: "#4d6bfe", context: "1M", speed: 0, input: 0.0, output: 0.0, tag: "Free", category: "chat", image: true, video: false, note: "Free tier · rate limited", quota_multiplier: 1 },
    { id: "deepseek-v4-pro-0813-free", name: "DeepSeek V4 Pro 0813", provider: "DeepSeek", color: "#4d6bfe", context: "1M", speed: 0, input: 0.0, output: 0.0, tag: "Free", category: "chat", image: false, video: false, note: "Free tier · rate limited", quota_multiplier: 1 },
    { id: "deepseek-v4-pro-free", name: "DeepSeek V4 Pro", provider: "DeepSeek", color: "#4d6bfe", context: "1M", speed: 0, input: 0.0, output: 0.0, tag: "Free", category: "chat", image: false, video: false, note: "Free tier · rate limited", quota_multiplier: 1 },
    { id: "deepseek-v4.1-flash-1017", name: "DeepSeek V4.1 1017", provider: "DeepSeek", color: "#4d6bfe", context: "1M", speed: 0, input: 0.0, output: 0.0, tag: "Free", category: "code", image: false, video: false, note: "Free tier · rate limited", quota_multiplier: 5 },
    { id: "ernie-5.5-flash", name: "ERNIE-5.5-Flash", provider: "Baidu", color: "#2932e1", context: "1M", speed: 89.95, input: 0.0, output: 0.0, tag: "Free", category: "chat", image: false, video: false, note: "Free tier · rate limited", quota_multiplier: 12 },
    { id: "nemotron-3.5-super-vl-free", name: "Nemotron 3.5 Super VL", provider: "NVIDIA", color: "#76b900", context: "1M", speed: 53.96, input: 0.0, output: 0.0, tag: "Free", category: "chat", image: true, video: false, note: "Free tier · rate limited", quota_multiplier: 1 },
    { id: "dots-3-note-free", name: "Dots3 Note Preview", provider: "Dots Studio", color: "#ec4899", context: "512K", speed: 47.23, input: 0.0, output: 0.0, tag: "Free", category: "chat", image: true, video: false, note: "Free tier · rate limited", quota_multiplier: 1 },
    { id: "nemotron-3.5-lightning-free", name: "Nemotron 3.5 Lightning", provider: "NVIDIA", color: "#76b900", context: "1M", speed: 48.91, input: 0.0, output: 0.0, tag: "Free", category: "chat", image: false, video: false, note: "Free tier · rate limited", quota_multiplier: 1 },
    { id: "nemotron-3-ultra-free", name: "Nemotron 3 Ultra", provider: "NVIDIA", color: "#76b900", context: "1M", speed: 14.39, input: 0.0, output: 0.0, tag: "Free", category: "chat", image: false, video: false, note: "Free tier · rate limited", quota_multiplier: 1 },
    { id: "omni-moderation", name: "Omni Moderation", provider: "OpenAI", color: "#10a37f", context: "—", speed: 0, input: 0.0, output: 0.0, tag: "Free", category: "moderation", image: false, video: false, note: "Free moderation API", quota_multiplier: 1 },
    { id: "gemini-3.8-flash", name: "Gemini 3.8 Flash", provider: "Google", color: "#4285f4", context: "1M", speed: 86.33, input: 0.0, output: 0.0, tag: "Free", category: "chat", image: false, video: false, note: "Free · text only", quota_multiplier: 1 },
    { id: "gemini-3.1-flash-lite", name: "Gemini 3.1 Flash Lite", provider: "Google", color: "#4285f4", context: "—", speed: 28.47, input: 0.0, output: 0.0, tag: "Free", category: "chat", image: true, video: false, note: "Free · vision-capable", quota_multiplier: 1 },
    { id: "qwen-3.8-max-free", name: "Qwen 3.8 Max", provider: "Alibaba", color: "#6366f1", context: "—", speed: 100.99, input: 0.0, output: 0.0, tag: "Free", category: "chat", image: false, video: false, note: "Free tier · rate limited", quota_multiplier: 1 },
    { id: "kimi-k3", name: "Kimi K3", provider: "Moonshot AI", color: "#8b5cf6", context: "1M", speed: 42.11, input: 0.0, output: 0.0, price_per_request: 0.05, tag: "New", category: "code", image: true, video: true, note: "Per request · vision & video", price_unit: "request", quota_multiplier: 1 },
    { id: "glm-4-plus", name: "GLM-4 Plus", provider: "Zhipu", color: "#0ea5e9", context: "—", speed: 62.12, input: 0.0, output: 0.0, tag: "Free", category: "chat", image: false, video: false, note: "Free · basic coding", quota_multiplier: 1 },
    { id: "glm-4-air", name: "GLM-4 Air", provider: "Zhipu", color: "#0ea5e9", context: "—", speed: 60.11, input: 0.0, output: 0.0, tag: "Free", category: "chat", image: false, video: false, note: "Free · basic coding", quota_multiplier: 1 },
    { id: "minimax-m3.1-flash-free", name: "MiniMax M3.1 Flash", provider: "MiniMax", color: "#f59e0b", context: "42K", speed: 0, input: 0.0, output: 0.0, tag: "Free", category: "chat", image: false, video: false, note: "Free tier · text only", quota_multiplier: 1 },
    { id: "raon-1-mini", name: "Raon-1 Mini", provider: "Krafton AI", color: "#22d3ee", context: "262K", speed: 117.12, input: 0.0, output: 0.0, tag: "Free", category: "chat", image: false, video: false, note: "Free tier · text only", quota_multiplier: 1 },
    { id: "openjev-0.1", name: "OpenJev Decision", provider: "Codiv", color: "#a78bfa", context: "65K", speed: 0, input: 0.0, output: 0.0, tag: "Free", category: "decision", image: true, video: false, note: "Free · typed decision · /v1/systemone", quota_multiplier: 1 },
    { id: "verdict-1.4", name: "Verdict Classifier", provider: "Codiv", color: "#a78bfa", context: "512 / q", speed: 0, input: 0.0, output: 0.0, tag: "Free", category: "decision", image: false, video: false, note: "Free · typed decision · /v1/systemone", quota_multiplier: 1 },
    { id: "clm-0.1", name: "CLM Router", provider: "Codiv", color: "#a78bfa", context: "2K / q", speed: 0, input: 0.0, output: 0.0, tag: "Free", category: "decision", image: false, video: false, note: "Free · typed decision · /v1/systemone", quota_multiplier: 1 },
    { id: "jevk5-0.3", name: "JevK5 Fast", provider: "Codiv", color: "#a78bfa", context: "16K", speed: 0, input: 0.0, output: 0.0, tag: "Free", category: "decision", image: false, video: false, note: "Free · typed decision · /v1/systemone", quota_multiplier: 1 },
    { id: "s5-free", name: "S5 Free", provider: "Maritaca AI", color: "#16a34a", context: "1M", speed: 10.53, input: 0.0, output: 0.0, tag: "Free", category: "chat", image: false, video: false, note: "Free for a limited time · text only", quota_multiplier: 1 },
    { id: "k-exaone-2.5", name: "K-EXAONE 2.5", provider: "LG AI Research", color: "#c026d3", context: "512K", speed: 8.16, input: 0.0, output: 0.0, tag: "New", category: "chat", image: false, video: false, note: "Preview · 1 req/s · pricing not published", quota_multiplier: 1 },
    { id: "gpt-5.6-sol", name: "GPT-5.6 Sol", provider: "OpenAI", color: "#10a37f", context: "—", speed: 21.87, input: 0.0, output: 0.0, tag: "Free", category: "chat", image: false, video: false, note: "Free tier · CrowLLM", quota_multiplier: 1 },
  ];

  const FALLBACK_BY_ID = {};
  FALLBACK_MODELS.forEach((m) => { FALLBACK_BY_ID[m.id] = m; });

  /* Sub plans count quota tokens, weighted by real model cost. */
  const QUOTA_MULT = {
    'deepseek-v4.1-flash-1017': 5,
    'mercury-3': 7,
    'gpt-6-luna': 8,
    'ernie-5.5-flash': 12,
    'grok-4.6': 100,
  };
  FALLBACK_MODELS.forEach((m) => { m.quota_multiplier = QUOTA_MULT[m.id] || 1; m.sub_allowance_pro = Math.round(6000000 / m.quota_multiplier); });

  const PROVIDER_COLORS = {
    anthropic: '#d97757', openai: '#10a37f', deepseek: '#4d6bfe',
    'moonshot ai': '#8b5cf6', 'mistral ai': '#ff7000', inception: '#d946ef',
    'z.ai': '#0ea5e9', zhipu: '#0ea5e9', alibaba: '#6366f1', xai: '#f43f5e',
    google: '#4285f4', baidu: '#2932e1', nvidia: '#76b900',
    'dots studio': '#ec4899', minimax: '#f59e0b', 'krafton ai': '#22d3ee', codiv: '#a78bfa',
    'maritaca ai': '#16a34a', 'lg ai research': '#c026d3',
  };
  const COLOR_PALETTE = ['#8b5cf6', '#22d3ee', '#f472b6', '#f59e0b', '#34d399', '#60a5fa'];

  /* NovaCompute display style: free models get ABBR-<id>-free, paid keep the plain id. */
  const PROVIDER_ABBR = {
    Anthropic: 'CL', OpenAI: 'GPT', DeepSeek: 'DS', 'Moonshot AI': 'KM',
    'Mistral AI': 'MS', Inception: 'MC', 'Z.ai': 'GLM', Zhipu: 'GLM', Alibaba: 'QW',
    xAI: 'GK', Google: 'GM', Baidu: 'ER', NVIDIA: 'NV', 'Dots Studio': 'DS',
    MiniMax: 'MM', 'Krafton AI': 'RN', Codiv: 'CD', 'Maritaca AI': 'MT', 'LG AI Research': 'EX', Custom: 'NV',
  };

  function displayCode(m) {
    const isFree = m.input === 0 && m.output === 0 && Number(m.price_per_request || 0) === 0;
    if (!isFree) return m.id;
    const abbr = m.category === 'moderation' ? 'OM' : (PROVIDER_ABBR[m.provider] || 'NV');
    const base = m.id.replace(/^.*\//, '').replace(/(?::free|-free)$/, '');
    return `${abbr}-${base}-free`;
  }

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
    const requestPrice = parseFloat(raw.price_per_request !== undefined ? raw.price_per_request : snapshot.price_per_request) || 0;
    const isFree = input === 0 && output === 0 && requestPrice === 0;
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
      price_per_request: requestPrice,
      tag,
      category: raw.category || snapshot.category || (/deepseek|mercury/i.test(String(raw.id)) ? 'code' : 'chat'),
      image: Boolean(raw.capabilities ? raw.capabilities.image : (raw.image !== undefined ? raw.image : snapshot.image)),
      video: Boolean(raw.capabilities ? raw.capabilities.video : (raw.video !== undefined ? raw.video : snapshot.video)),
      note: raw.note || snapshot.note || '',
      price_unit: raw.price_unit || snapshot.price_unit || null,
      quota_multiplier: Number(raw.quota_multiplier || QUOTA_MULT[raw.id] || 1),
      sub_allowance_pro: Math.round(6000000 / Number(raw.quota_multiplier || QUOTA_MULT[raw.id] || 1)),
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

  function tokensShort(value) {
    const v = Number(value || 0);
    if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(v >= 10_000_000 ? 0 : 1).replace(/\.0$/, '')}M`;
    if (v >= 1_000) return `${(v / 1_000).toFixed(v >= 100_000 ? 0 : 1).replace(/\.0$/, '')}K`;
    return String(v);
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
    const canTry = ['chat', 'code', 'tts'].includes(m.category);
    const speedText = m.speed > 0 ? `${m.speed >= 1000 ? '1000+' : m.speed} tok/s` : '— tok/s';
    const subAllowance = m.quota_multiplier > 1 ? Math.round(6_000_000 / m.quota_multiplier) : 0;
    const multBadge = subAllowance > 0 && m.category !== 'tts'
      ? `<span class="ml-2 rounded-full border border-sky-400/20 bg-sky-500/[0.08] px-1.5 py-0.5 align-middle text-[10px] font-semibold text-sky-300" title="Included daily on the Pro plan; scales with your plan. Premium models use quota faster because they cost more.">Included ${tokensShort(subAllowance)}/day</span>`
      : '';
    return `
      <tr class="model-row group" style="--m:${m.color}">
        <td class="px-6 py-4">
          <div class="flex items-center gap-3">
            <span class="model-avatar flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sm font-bold"
                  style="background:${rgba(m.color, 0.14)};color:${m.color};border:1px solid ${rgba(m.color, 0.3)}">${m.name.charAt(0)}</span>
            <div>
              <p class="font-medium text-white">${m.name}${tagCell(m.tag)}${multBadge}</p>
              <p class="mt-0.5 font-mono text-xs text-slate-500">${displayCode(m)}</p>
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
        <td class="whitespace-nowrap px-4 py-4 text-right">${m.price_unit === 'request'
          ? `<span class="whitespace-nowrap font-mono text-slate-200">$${Number(m.price_per_request || 0).toFixed(2)}</span><span class="text-[10px] text-slate-500"> / request</span>`
          : (m.category === 'tts' ? '<span class="text-slate-500">—</span>' : priceCell(m.input))}</td>
        <td class="whitespace-nowrap px-4 py-4 text-right">${m.price_unit === '1k_chars'
          ? `<span class="whitespace-nowrap font-mono text-slate-200">$${m.output.toFixed(4)}</span><span class="text-[10px] text-slate-500"> / 1k chars</span>`
          : (m.price_unit === 'request' ? '<span class="text-slate-500">—</span>' : priceCell(m.output))}</td>
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
    const isFree = (m) => m.input === 0 && m.output === 0 && Number(m.price_per_request || 0) === 0;
    const chat = list.filter((m) => m.category !== 'decision');
    const free = chat.filter(isFree);
    const paid = chat.filter((m) => !isFree(m));
    let html = '';
    if (free.length) {
      html += groupHeader('Free models · $0.00', 'free');
      html += free.map(renderModelRow).join('');
    }
    if (paid.length) {
      const onlyTts = paid.every((m) => m.category === 'tts');
      html += groupHeader(onlyTts ? 'TTS models · per 1k characters' : 'Paid models · token or per-request pricing', 'paid');
      html += paid.map(renderModelRow).join('');
    }
    return html;
  };

  window.NOVA_MODEL_BY_ID = (id) => (window.NOVA_MODELS || []).find((m) => m.id === id) || null;
  window.novaRgba = rgba;
  window.renderModelRow = renderModelRow;
})();
