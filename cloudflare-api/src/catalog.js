// NovaCompute — model catalogue (single source for the Worker).
// Keep in sync with backend/app.py MODELS + custom_models.

export const MODELS = [
  { id: "claude-opus-5.5", name: "Claude Opus 5.5", vendor: "Anthropic", context: "1M", speed: 85, input: 3.2, output: 16.0, image: true, video: false, category: "chat", tag: "Popular", note: "", upstream: "nightrouter", upstream_id: "claude-opus-5.5-free" },
  { id: "claude-sonnet-5.5", name: "Claude Sonnet 5.5", vendor: "Anthropic", context: "1M", speed: 92, input: 1.8, output: 9.0, image: true, video: false, category: "chat", tag: null, note: "", upstream: "nightrouter", upstream_id: "claude-sonnet-5-5-free" },
  { id: "gpt-6-luna", name: "GPT-6", vendor: "OpenAI", context: "900K", speed: 118, input: 0.08, output: 0.4, image: true, video: false, category: "chat", tag: "New", note: "", upstream: "furry" },
  { id: "gpt-5.6-luna", name: "GPT-5.6", vendor: "OpenAI", context: "900K", speed: 130, input: 0.0, output: 0.0, image: true, video: false, category: "chat", tag: "Free", note: "", upstream: "furry" },
  { id: "grok-4.6", name: "Grok 4.6", vendor: "xAI", context: "500K", speed: 150, input: 0.1, output: 0.3, image: true, video: false, category: "chat", tag: null, note: "", upstream: "exosai" },
  { id: "deepseek-v4.1-flash", name: "DeepSeek V4.1", vendor: "DeepSeek", context: "1M", speed: 145, input: 0.0, output: 0.0, image: true, video: false, category: "code", tag: "Free", note: "", upstream: "nightrouter" },
  { id: "deepseek-v4.1-flash-1017", name: "DeepSeek V4.1 1017", vendor: "DeepSeek", context: "1M", speed: 145, input: 0.005, output: 0.24, image: true, video: false, category: "code", tag: null, note: "", upstream: "nightrouter" },
  { id: "kimi-k3.1-pro", name: "Kimi k3.1 Pro", vendor: "Moonshot AI", context: "1M", speed: 120, input: 1.0, output: 1.0, image: true, video: true, category: "chat", tag: null, note: "", upstream: "nightrouter", upstream_id: "kimi-k3.1-pro-free" },
  { id: "mistral-large-4", name: "Mistral Large 4", vendor: "Mistral AI", context: "1M", speed: 98, input: 0.0, output: 0.0, image: true, video: false, category: "chat", tag: "Free", note: "", upstream: "mistral" },
  { id: "mercury-3", name: "Mercury 3", vendor: "Inception", context: "1M", speed: 1000, input: 0.1, output: 0.35, image: false, video: false, category: "code", tag: "Diffusion", note: "", upstream: "inception" },
  { id: "glm-5.3-flash", name: "GLM 5.3 Flash", vendor: "Z.ai", context: "1M", speed: 240, input: 0.03, output: 0.07, image: true, video: true, category: "chat", tag: null, note: "", upstream: "nightrouter" },
  { id: "glm-5.3", name: "GLM 5.3", vendor: "Z.ai", context: "1M", speed: 85, input: 0.0, output: 0.0, image: false, video: false, category: "chat", tag: "Free", note: "", upstream: "nightrouter" },
  { id: "qwen/qwen3.7-flash:free", name: "Qwen 3.7", vendor: "Alibaba", context: "1M", speed: 130, input: 0.0, output: 0.0, image: true, video: true, category: "chat", tag: "Free", note: "", upstream: "bazaarlink" },
  { id: "gemini-4-argon", name: "Gemini 4 Argon", vendor: "Google", context: "1M", speed: 110, input: 0.4, output: 1.2, image: true, video: true, category: "chat", tag: null, note: "", upstream: "nightrouter", upstream_id: "gemini-4-argon-free" },
  { id: "ernie-5.5-flash", name: "ERNIE-5.5-Flash", vendor: "Baidu", context: "1M", speed: 0, input: 0.14, output: 0.565, image: false, video: false, category: "chat", tag: null, note: "", upstream: "nagaai", upstream_id: "baidu/ernie-5.5-flash-preview:free" },
  { id: "gemini-3.8-flash-lite-tts", name: "Gemini 3.8 Flash-Lite TTS", vendor: "Google", context: "—", speed: 0, input: 0.0, output: 0.0055, price_unit: "1k_chars", image: false, video: false, category: "tts", tag: "Sub", note: "Free with subscription · up to 100 req/day", upstream: "nagaai", upstream_id: "google/gemini-3.8-flash-lite-tts:free" },
  { id: "gemini-3.8-flash-tts", name: "Gemini 3.8 Flash TTS", vendor: "Google", context: "—", speed: 0, input: 0.0, output: 0.008, price_unit: "1k_chars", image: false, video: false, category: "tts", tag: "Sub", note: "Free with subscription · up to 100 req/day", upstream: "nagaai", upstream_id: "google/gemini-3.8-flash-tts:free" },
  { id: "omni-moderation", name: "Omni Moderation", vendor: "OpenAI", context: "—", speed: 0, input: 0.0, output: 0.0, image: true, video: false, category: "moderation", tag: "Free", note: "Moderation API · free", upstream: "nagaai", upstream_id: "openai/omni-moderation" },
];

export const MODEL_BY_ID = new Map(MODELS.map((m) => [m.id, m]));

export const PROVIDERS = {
  nightrouter: { url: "https://api.nightrouter.ai/v1/chat/completions", secret: "NIGHTROUTER_KEYS" },
  exosai: { url: "https://api.exosai.tech/v1/chat/completions", secret: "EXOSAI_KEYS" },
  mistral: { url: "https://api.mistral.ai/v1/chat/completions", secret: "MISTRAL_KEYS" },
  inception: { url: "https://api.inceptionlabs.ai/v1/chat/completions", secret: "INCEPTION_KEYS" },
  furry: { url: "https://ai.furry.edu.gr/v1/chat/completions", secret: "FURRY_KEYS" },
  bazaarlink: { url: "https://api.bazaarlink.ai/v1/chat/completions", secret: "BAZAARLINK_KEYS" },
  nagaai: { url: "https://api.naga.ac/v1/chat/completions", secret: "NAGA_KEYS" },
};
