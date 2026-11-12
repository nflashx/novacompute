# NovaCompute

**A free shared AI API for the first 50 developers — plus premium model APIs on demand.**

**Live website:** [https://novarouter.cc.cd](https://novarouter.cc.cd)

**API base URL:** `https://novarouter.cc.cd/v1`

**Docs:** [https://novarouter.cc.cd/docs.html](https://novarouter.cc.cd/docs.html)

**Dashboard:** [https://novarouter.cc.cd/dashboard.html](https://novarouter.cc.cd/dashboard.html)

NovaCompute gives you one OpenAI-compatible endpoint for 25 models — 19 of them free. Create an account, get an API key, and send your first request in under a minute. The first **50 customer accounts** get the founding free plan; after that, access is pay-as-you-go or subscription.

No credit card is required to claim a founding free seat.

---

## What you can build

- **Chat and reasoning** — Claude Opus/Sonnet, GPT-6, Grok 4.6, Gemini 4 Argon, Kimi, DeepSeek, GLM, ERNIE, Mistral and more.
- **Vision** — send images to multimodal models with the standard `image_url` content part.
- **Video-capable models** — Qwen 3.7 and Kimi K3 accept video input.
- **Streaming** — token-by-token SSE on `/v1/chat/completions`.
- **Text-to-speech** — `POST /v1/audio/speech` with Gemini 3.8 Flash-Lite / Flash TTS.
- **Moderation** — Omni Moderation through `POST /v1/moderations`.
- **One key, one bill** — no provider accounts, no SDK rewrites. Works with the OpenAI SDK and any OpenAI-compatible client.
- **Live usage** — dashboard charts, API keys, balance, plans and payment history with real data only.

---

## Founding free plan

The first **50 customer accounts** receive the free plan:

- Access to every `$0.00` model.
- No credit card, no expiry.
- Live remaining seats: [`/api/free-seats`](https://novarouter.cc.cd/api/free-seats).

After the 50 seats are claimed, new accounts are **pay-as-you-go**: add credit or choose a subscription to use the API. Existing free seats stay active.

---

## Models and pricing

The live catalogue currently has **25 models: 19 free, 14 with image input and 2 with video input**. Prices are per **1M tokens** unless marked per 1,000 characters.

**Free ($0.00):** GPT-5.6, DeepSeek V4.1, DeepSeek V4.1 1017, DeepSeek V4 Flash, DeepSeek V4 Flash 0731, DeepSeek V4 Flash Vision, DeepSeek V4 Pro, DeepSeek V4 Pro 0813, Mistral Large 4, Qwen 3.7, Qwen 3.8 Max, Gemini 3.8 Flash, Gemini 3.1 Flash Lite, ERNIE-5.5-Flash, Nemotron 3.5 Super VL, Nemotron 3.5 Lightning, Nemotron 3 Ultra, Dots3 Note Preview.

**Moderation:** Omni Moderation is free through `POST /v1/moderations` (not chat completions).

**Paid:**

| Model | Input / 1M | Output / 1M |
|---|---:|---:|
| GPT-6 | $0.08 | $0.40 |
| Grok 4.6 | $1.70 | $5.10 |
| Mercury 3 | $0.10 | $0.35 |
| Kimi K3 | $0.02 / request | — |

**Text-to-speech:** Gemini 3.8 Flash-Lite TTS at $0.0055 / 1k chars and Gemini 3.8 Flash TTS at $0.0080 / 1k chars via `POST /v1/audio/speech`.

The live catalogue with machine-readable capabilities is always at [`/v1/models`](https://novarouter.cc.cd/v1/models). Availability depends on upstream capacity; if a model is temporarily unavailable, retry or pick another model.

---

## Quick start

1. [Create an account](https://novarouter.cc.cd/register.html) or sign in with Google/GitHub.
2. Copy your API key from the [dashboard](https://novarouter.cc.cd/dashboard.html).
3. Send a request:

```bash
curl https://novarouter.cc.cd/v1/chat/completions \
  -H "Authorization: Bearer $NOVA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "deepseek-v4.1-flash",
    "messages": [{"role": "user", "content": "Explain SSE in one sentence."}],
    "stream": true
  }'
```

Python:

```python
from openai import OpenAI

client = OpenAI(
    api_key="nova-sk-...",
    base_url="https://novarouter.cc.cd/v1",
)
print(client.chat.completions.create(
    model="gpt-6-luna",
    messages=[{"role": "user", "content": "Hello"}],
).choices[0].message.content)
```

Image input:

```json
{
  "model": "gemini-4-argon",
  "messages": [{
    "role": "user",
    "content": [
      {"type": "text", "text": "Describe this image."},
      {"type": "image_url", "image_url": {"url": "https://example.com/image.png"}}
    ]
  }]
}
```

Text-to-speech:

```bash
curl https://novarouter.cc.cd/v1/audio/speech \
  -H "Authorization: Bearer $NOVA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"gemini-3.8-flash-tts","input":"Hello from NovaCompute.","voice":"Kore"}' \
  --output speech.wav
```

Full parameter tables, streaming, image input, TTS and rate limits: [docs.html](https://novarouter.cc.cd/docs.html).

---

## Plans

| Plan | Price | Daily paid-token quota | TTS / day | Activation credit |
|---|---:|---:|---:|---:|
| Founding free | $0 | Free models only | — | — |
| Starter | $4.99 / 30 days | 1.5M | 20 | +$3 |
| Pro | $12.99 / 30 days | 6M | 60 | +$5 |
| Ultra | $29.99 / 30 days | 20M | 150 | +$12 |

Subscriptions are optional. Pay-as-you-go credit never expires and is billed per token from your balance. When a subscription quota runs out, usage continues from balance if credit is available.

---

## Sign in

- **Google** — one click, verified Google email.
- **GitHub** — one click, verified GitHub email.
- **Email + password** — available when SMTP is configured; the code is sent to your mailbox.

Google and GitHub accounts are regular customer accounts. The site administrator uses a separate admin account for `/admin.html`.

---

## API surface

| Endpoint | Purpose |
|---|---|
| `POST /v1/chat/completions` | Chat, reasoning, vision and video input; streaming supported |
| `POST /v1/moderations` | Omni Moderation via the moderation API |
| `POST /v1/audio/speech` | Gemini TTS, returns WAV |
| `GET /v1/models` | Live model catalogue, prices and capabilities |
| `GET /api/health` | Service health and free-seat count |
| `GET /api/free-seats` | Founding free-seat availability |
| `GET /api/me` | Account, plan, balance, keys and usage |
| `GET /api/fx` | Live USD→VND rate for bank checkout |

Rate limits apply per API key and tier; see the [docs](https://novarouter.cc.cd/docs.html#rate-limits). The playground is limited to 5 tries/day.

---

## Fair use and security

- Real email verification and disposable-email blocking.
- Per-IP signup limits, OAuth verification and a 50-seat free cap.
- API keys are shown only after sign-in; rotate or delete them from the dashboard.
- Payments: PayPal server-side capture and Vietnamese bank webhooks; no free-credit endpoint.
- No seeded usage, fake balances or demo top-ups.

---

## Links

- **Website:** [https://novarouter.cc.cd](https://novarouter.cc.cd)
- **Create account:** [https://novarouter.cc.cd/register.html](https://novarouter.cc.cd/register.html)
- **Sign in:** [https://novarouter.cc.cd/login.html](https://novarouter.cc.cd/login.html)
- **Dashboard:** [https://novarouter.cc.cd/dashboard.html](https://novarouter.cc.cd/dashboard.html)
- **Docs:** [https://novarouter.cc.cd/docs.html](https://novarouter.cc.cd/docs.html)
- **Models:** [https://novarouter.cc.cd/v1/models](https://novarouter.cc.cd/v1/models)
- **Free seats:** [https://novarouter.cc.cd/api/free-seats](https://novarouter.cc.cd/api/free-seats)

---

NovaCompute is an independent API platform. Model names and trademarks belong to their respective owners.
