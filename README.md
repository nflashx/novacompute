# NovaCompute

**One OpenAI-compatible API for 18 frontier AI models — live at [novarouter.cc.cd](https://novarouter.cc.cd).**

NovaCompute is an AI API reseller: a dark, fast storefront plus a Python gateway that routes chat, vision, video-capable and text-to-speech requests to upstream providers with key rotation, retries and per-token billing.

- **Website:** [https://novarouter.cc.cd](https://novarouter.cc.cd)
- **API base URL:** `https://novarouter.cc.cd/v1`
- **Docs:** [https://novarouter.cc.cd/docs.html](https://novarouter.cc.cd/docs.html)
- **Dashboard:** [https://novarouter.cc.cd/dashboard.html](https://novarouter.cc.cd/dashboard.html)
- **Health check:** [https://novarouter.cc.cd/api/health](https://novarouter.cc.cd/api/health)
- **Model catalogue:** [https://novarouter.cc.cd/v1/models](https://novarouter.cc.cd/v1/models)

> **Founding offer:** the free plan is limited to the **first 50 customer accounts**. After that, new accounts are pay-as-you-go — add credit or subscribe to use the API. The live remaining count is at [`/api/free-seats`](https://novarouter.cc.cd/api/free-seats).

---

## What it does

- **18 models, one key** — OpenAI SDK compatible chat completions with streaming (SSE).
- **Free models** — Qwen 3.7, DeepSeek V4.1, GPT-5.6, Mistral Large 4, GLM 5.3, Omni Moderation.
- **Paid models** — Claude Opus/Sonnet, GPT-6, Grok 4.6, Kimi k3.1 Pro, Gemini 4 Argon, ERNIE, Mercury and more.
- **TTS** — `POST /v1/audio/speech` with Gemini 3.8 Flash-Lite / Flash TTS, billed per 1,000 characters.
- **Subscriptions** — Starter, Pro and Ultra with a daily paid-token quota, activation bonus and balance overflow after the quota.
- **Real payments** — server-side PayPal capture (card funding disabled in the checkout UI) and Vietnamese bank transfer webhooks with live USD→VND conversion.
- **Account system** — verified email/password signup, Google and GitHub OAuth, per-IP signup limits, disposable-email blocking.
- **Dashboard** — real usage, token charts, API keys, plan, balance and payment history. No seeded or fake data.
- **Admin console** — web `/admin.html` and a native Rust desktop app for users, plans, balances, bans, model prices and provider keys.

---

## Quick start

Create an account at [novarouter.cc.cd/register.html](https://novarouter.cc.cd/register.html), copy the API key from the dashboard, then:

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

Python (OpenAI SDK):

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

## Login setup (Google, GitHub and email)

The site is at `https://novarouter.cc.cd`. OAuth callbacks are handled by the backend listener on port `8600`, proxied by nginx and the Cloudflare Pages edge.

### 1. Google OAuth

In [Google Cloud Console → Google Auth Platform → Clients](https://console.cloud.google.com/auth/clients):

1. Create an OAuth client of type **Web application** (or edit the existing one).
2. Add these **Authorized redirect URIs**:
   - `https://novarouter.cc.cd/api/auth/oauth/google/callback`
   - `https://8000-agq45l5c6sphv2zqkzyanpjymq.instabox.tech/api/auth/oauth/google/callback` (fallback origin)
   - `http://127.0.0.1:8600/api/auth/oauth/google/callback` (local development)
3. Save. No JavaScript origin is required for server-side OAuth.
4. Put the client ID and secret in `backend/oauth_config.json`:

```json
{
  "google": {
    "client_id": "....apps.googleusercontent.com",
    "client_secret": "...."
  }
}
```

Start the flow with `GET /api/oauth/google/start`; the callback redirects to `login.html?oauth_token=...`, the frontend exchanges the one-time token at `POST /api/oauth/exchange`, and the session lands on the dashboard.

### 2. GitHub OAuth

In [GitHub → Settings → Developer settings → OAuth Apps](https://github.com/settings/developers), create/edit an OAuth app:

- **Homepage URL:** `https://novarouter.cc.cd`
- **Authorization callback URLs:**
  - `https://novarouter.cc.cd/api/auth/oauth/github/callback`
  - `https://8000-agq45l5c6sphv2zqkzyanpjymq.instabox.tech/api/auth/oauth/github/callback`
  - `http://127.0.0.1:8600/api/auth/oauth/github/callback`

Then add the credentials:

```json
{
  "github": {
    "client_id": "Ov23li...",
    "client_secret": "...."
  }
}
```

GitHub must return a **verified** email. Accounts younger than `NOVA_OAUTH_MIN_ACCOUNT_DAYS` (default **7 days**) can still sign in and pay, but do not receive a founding free seat.

### 3. Email + password

`POST /api/register` sends a 6-digit code, and `POST /api/verify` creates the account. Real SMTP is required in production. Create `backend/mail_config.json` (gitignored; template at `backend/mail_config.example.json`):

```json
{
  "enabled": true,
  "host": "smtp.your-provider.com",
  "port": 465,
  "user": "noreply@your-domain.com",
  "pass": "smtp-password-or-api-key",
  "from": "NovaCompute <noreply@your-domain.com>"
}
```

Without SMTP, public signup returns `503 mail_not_configured`; the DEV code is only exposed on a direct loopback connection. Google/GitHub sign-in does not depend on SMTP.

### 4. Environment

On the Instabox host, `/etc/systemd/system/novacompute.service` contains:

```
Environment=NOVA_SITE_URL=https://novarouter.cc.cd
Environment=NOVA_OAUTH_BASE=https://novarouter.cc.cd
Environment=NOVA_PORT=8080
Environment=NOVA_OAUTH_PORT=8600
```

`NOVA_OAUTH_BASE` is the public callback base; provider redirect URIs must match exactly. Restart after changing:

```bash
sudo systemctl daemon-reload
sudo systemctl restart novacompute
```

---

## Founding free seats (first 50 customers)

- New non-admin accounts receive `free_seat: true` while fewer than **50** seats are claimed.
- `NOVA_FREE_CUSTOMER_LIMIT=50` controls the cap (`0` = unlimited, not recommended).
- Seats are assigned at email verification / first OAuth signup, never to admin accounts.
- After the cap, new accounts can still register, but a chat request with no free seat, no active plan and a $0 balance returns `402 free_capacity_reached` until they add credit or subscribe.
- Existing accounts are backfilled in creation order when the backend starts.
- Live state: `GET /api/free-seats` → `{ limit, claimed, remaining, open }`.

The register page and landing hero show the live remaining count. The API and dashboard explain the pay-as-you-go fallback.

---

## Anti-abuse: disposable email and fake credit

No public signup system can honestly promise 100% prevention. NovaCompute uses layered controls and keeps the failure modes explicit:

**Disposable/throwaway email**

- Built-in seed list plus `backend/disposable_domains.txt` (10,000+ maintained domains, sourced from the community `disposable-email-domains` list).
- Subdomain matching, throwaway-pattern detection, plus-address rejection, Gmail dot/`googlemail` canonicalization, and duplicate-family checks.
- MX lookup through both Cloudflare and Google DNS-over-HTTPS. **No MX = blocked.** MX hosts that belong to a disposable provider are blocked too. DNS outage returns `503 dns_unavailable` instead of silently allowing the address.
- Per-IP signup limits: 3/hour and 6/day, then a 24-hour IP ban. OAuth signups go through the same gate.
- Google requires a verified email; GitHub requires a verified email and applies the account-age rule for free seats.
- Pending codes expire in 10 minutes and are destroyed after 6 wrong attempts.

**Fake credit / multi-account abuse**

- `/api/topup` is dead (`410`). Credit only comes from a verified PayPal capture or a signed bank webhook.
- PayPal: server-created order, server-side capture, USD amount check, `COMPLETED` capture status, and a **unique PayPal payer ID per NovaCompute account**. Missing payer identity is held for review.
- Card/credit funding is disabled in the PayPal checkout UI; a PayPal account is required.
- Bank webhook: bearer token compared in constant time, idempotent transaction IDs, VND currency/transfer-type checks, memo must match `NOVA TOPUP|STARTER|PRO|ULTRA <email>`, amount must match the plan, and a sender account can fund only one NovaCompute account when the bank payload exposes a sender field.
- Payment velocity: new accounts are capped at $20 in the first 10 minutes, $100/day for the first 7 days, and 3 payment attempts per 10 minutes.
- One activation bonus per account, not per renewal.
- Free seats are capped at 50; free-tier requests are rate-limited per key (30 RPM / 500 per day for free, higher for paid tiers).

**Known limits (be honest):** a PayPal merchant cannot see the card BIN inside a PayPal account, and a bank payload that omits the sender account cannot prove sender identity. Hard KYC (Stripe Radar, Seon, Sumsub, phone verification) is the only way to go beyond these controls. Never describe the current stack as "100% fraud-proof".

---

## Architecture

```
Browser
  │  https://novarouter.cc.cd
  ▼
Cloudflare Pages project "novarouter"  (novarouter-proxy/pages/_worker.js)
  │  Host: 8000-<machine>.instabox.tech
  ▼
Instabox nginx :8000
  ├─ /v1/*              → 127.0.0.1:8080  (Python API, SSE)
  ├─ /api/auth/oauth/*  → 127.0.0.1:8600  (OAuth callback listener)
  └─ /*                 → static frontend
```

- **DNS:** DNSHE `CNAME @ → novarouter.pages.dev` (TTL 600). Pages terminates TLS for the custom hostname; Instabox routes by Host, so a direct CNAME to the Instabox hostname would 404.
- **Backend:** Python standard library only (`http.server`, `urllib`, JSON files, PBKDF2). No Flask/Django.
- **Pages worker:** forwards method, path, query and body; streams the response; rewrites same-origin `Location` headers. See [`novarouter-proxy/README.md`](novarouter-proxy/README.md).
- **Keeper:** `instabox-keeper/` is a Cloudflare Worker cron (`*/10 * * * *`) that wakes the free Instabox machine, checks `/api/health`, and restarts it before `maxRunMinutes` (currently 120).

---

## Run locally

```bash
python backend/app.py          # API on :8080
python -m http.server 8123 --directory novacompute   # static site on :8123
```

Open `http://127.0.0.1:8123`. The frontend automatically talks to `http://127.0.0.1:8080` on local ports and to the same origin in production.

Copy the example mail config before starting:

```bash
cp backend/mail_config.example.json backend/mail_config.json
```

Create `backend/oauth_config.json`, `backend/paypal_config.json` and `backend/payment_config.json` from the formats in the login and payment sections. They are gitignored.

Create an admin:

```bash
python backend/create_admin.py admin@your-domain.com 'StrongPassword123!'
```

The admin account bypasses billing and has a higher rate tier. Do not commit `users_db.json`, OAuth/payment configs, provider key pools, or `mail_config.json`; they are gitignored.

---

## Deploy

**Current production:** Instabox free microVM + Cloudflare Pages edge proxy + keeper Worker. The site is live at [novarouter.cc.cd](https://novarouter.cc.cd).

**VPS alternative:** `deploy/install.sh <domain>` installs nginx, systemd (`Restart=always`), certbot and the static site on Debian/Ubuntu. See [`deploy/README.md`](deploy/README.md).

**Cloudflare free chat-only build:** `cloudflare-api/` contains a Worker + D1 chat port without auth/payments. Do not expose `/api/register` there; the full account system lives in the Python backend.

---

## Repository layout

| Path | Purpose |
|---|---|
| `novacompute/` | Static frontend (compiled Tailwind, vanilla JS) |
| `backend/` | Python API gateway, auth, billing, payments, admin |
| `backend/disposable_domains.txt` | Maintained disposable-email blocklist |
| `novarouter-proxy/` | Cloudflare Pages edge proxy + fallback Worker |
| `instabox-keeper/` | Cron Worker that keeps the Instabox machine alive |
| `deploy/` | VPS systemd/nginx installer |
| `rust-console/` | Native Rust admin desktop app |
| `cloudflare-api/` | Free chat-only Worker + D1 build |

---

## Links

- **Live site:** [https://novarouter.cc.cd](https://novarouter.cc.cd)
- **Sign up:** [https://novarouter.cc.cd/register.html](https://novarouter.cc.cd/register.html)
- **Sign in:** [https://novarouter.cc.cd/login.html](https://novarouter.cc.cd/login.html)
- **Docs:** [https://novarouter.cc.cd/docs.html](https://novarouter.cc.cd/docs.html)
- **API health:** [https://novarouter.cc.cd/api/health](https://novarouter.cc.cd/api/health)
- **Free-seat counter:** [https://novarouter.cc.cd/api/free-seats](https://novarouter.cc.cd/api/free-seats)

Private repository: [hoanghaiminh2004-rgb/novacompute](https://github.com/hoanghaiminh2004-rgb/novacompute).
