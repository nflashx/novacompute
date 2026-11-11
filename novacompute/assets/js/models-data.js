/* ============================================================
   NovaCompute — shared model catalogue (single source of truth).
   Consumed by landing.js, pricing.js, playground.js, dashboard.js.
   Prices are reseller rates in USD per 1M tokens.
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

  /* categories: "chat" = Claude / GPT / Kimi / Mistral / GLM / Qwen
                 "code" = DeepSeek / Mercury                          */
  const MODELS = [
    { id: 'claude-opus-5.5-free', name: 'Claude Opus 5.5', provider: 'Anthropic', color: '#d97757', context: '1M', speed: 85, input: 10.0, output: 50.0, tag: 'Popular', category: 'chat' },
    { id: 'claude-sonnet-5-5-free', name: 'Claude Sonnet 5.5', provider: 'Anthropic', color: '#d97757', context: '1M', speed: 92, input: 2.0, output: 10.0, tag: null, category: 'chat' },
    { id: 'gpt-6-luna', name: 'GPT-6', provider: 'OpenAI', color: '#10a37f', context: '900K', speed: 118, input: 6.0, output: 20.0, tag: 'New', category: 'chat' },
    { id: 'gpt-5.6-luna', name: 'GPT-5.6', provider: 'OpenAI', color: '#10a37f', context: '900K', speed: 130, input: 3.0, output: 10.0, tag: null, category: 'chat' },
    { id: 'deepseek-v4.1-flash', name: 'DeepSeek V4.1', provider: 'DeepSeek', color: '#4d6bfe', context: '1M', speed: 145, input: 0.10, output: 0.20, tag: 'Best value', category: 'code' },
    { id: 'deepseek-v4.1-flash-1017', name: 'DeepSeek V4.1 1017', provider: 'DeepSeek', color: '#4d6bfe', context: '1M', speed: 145, input: 0.10, output: 0.30, tag: null, category: 'code' },
    { id: 'kimi-k3.1-pro-free', name: 'Kimi k3.1 Pro', provider: 'Moonshot AI', color: '#8b5cf6', context: '1M', speed: 120, input: 0.15, output: 1.50, tag: null, category: 'chat' },
    { id: 'mistral-large-4', name: 'Mistral Large 4', provider: 'Mistral AI', color: '#ff7000', context: '1M', speed: 98, input: 1.50, output: 4.50, tag: null, category: 'chat' },
    { id: 'mercury-3', name: 'Mercury 3', provider: 'Inception', color: '#d946ef', context: '1M', speed: 1000, input: 0.05, output: 0.20, tag: 'Diffusion', category: 'code' },
    { id: 'glm-5.3-flash', name: 'GLM 5.3 Flash', provider: 'Z.ai', color: '#0ea5e9', context: '1M', speed: 240, input: 0.08, output: 0.30, tag: null, category: 'chat' },
    { id: 'glm-5.3', name: 'GLM 5.3', provider: 'Z.ai', color: '#0ea5e9', context: '1M', speed: 85, input: 0.50, output: 1.20, tag: null, category: 'chat' },
    { id: 'qwen/qwen3.7-flash:free', name: 'Qwen 3.7', provider: 'Alibaba', color: '#6366f1', context: '1M', speed: 130, input: 0.0, output: 0.0, tag: 'Free', category: 'chat' },
  ];

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
              <p class="font-medium text-white">${m.name}${tagCell(m.tag)}</p>
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

  window.NOVA_MODELS = MODELS;
  window.NOVA_TAG_STYLES = TAG_STYLES;
  window.NOVA_MODEL_BY_ID = (id) => MODELS.find((m) => m.id === id) || null;
  window.novaRgba = rgba;
  window.renderModelRow = renderModelRow;
})();
