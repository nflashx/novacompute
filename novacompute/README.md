# NovaCompute — Frontend + API Gateway

Dark-mode web UI + a real Python API gateway for **NovaCompute**, an AI API reseller
demo (similar to OpenRouter / Together AI). Frontend is static HTML/Tailwind; the
backend is pure Python standard library (`http.server` + `urllib`, no frameworks).

```
.
├── start.bat                 # launches both servers (start /b)
├── backend/                  # API gateway (:8080)
│   ├── app.py                # auth, billing, /v1/chat/completions proxy, /api/*
│   ├── seed_demo.py          # demo account + 14 days of synthetic usage
│   ├── upstream_config.example.json
│   ├── users_db.json         # local state (gitignored)
│   └── upstream_config.json  # your provider key (gitignored)
└── novacompute/              # static frontend (:8123)
    ├── index.html / pricing.html / docs.html / playground.html
    ├── dashboard.html / login.html / register.html
    └── assets/…
```

## Run

```bat
start.bat
```

### 1-click silent launcher

Run `Create_Shortcut.vbs` once → a **NovaCompute** icon appears on the Desktop.
Double-clicking it starts both servers with **no console window** and opens the
site after 3 seconds (`silent_start.vbs`). `start.bat` remains available for a
manual launch with minimized log windows.

Or manually:

```bash
python backend/seed_demo.py          # once — creates demo@novacompute.io / demo1234
python backend/app.py                # backend  http://127.0.0.1:8080
python -m http.server 8123 --directory novacompute   # frontend
```

Demo login: **demo@novacompute.io / demo1234**

## Upstream provider key

The gateway forwards requests to one upstream provider. Copy
`backend/upstream_config.example.json` → `backend/upstream_config.json` and put in a
key **you are authorised to use for this workload** (e.g. an official/partner API
key). You can also set `NOVA_UPSTREAM_URL` / `NOVA_UPSTREAM_KEY` env vars.

> NovaCompute intentionally does **not** load a pool of harvested keys or rotate
> keys to bypass provider 401/429 enforcement. If NightRouter offers a
> reseller/partner program, use that key here. Pointing this at keys obtained
> through automated account creation violates the provider's terms.

## API endpoints

| Method | Path                     | Auth                | Purpose                                  |
| ------ | ------------------------ | ------------------- | ---------------------------------------- |
| POST   | `/api/register`          | —                   | create account → `nova-sk-…` key         |
| POST   | `/api/login`             | —                   | email/password → API key                 |
| GET    | `/api/me`                | `Bearer nova-sk-…`  | balance, usage, keys, charts data        |
| POST   | `/api/keys`              | Bearer              | create an additional customer key        |
| DELETE | `/api/keys/<id>`         | Bearer              | delete a customer key                    |
| POST   | `/api/topup`             | Bearer              | demo credit top-up                       |
| POST   | `/api/profile`           | Bearer              | update name / company                    |
| GET    | `/v1/models`             | —                   | OpenAI-style catalogue + pricing         |
| POST   | `/v1/chat/completions`   | `Bearer nova-sk-…`  | proxy (JSON or SSE stream)               |
| GET    | `/api/health`            | —                   | liveness + upstream config check         |

Billing: each completion is metered from `usage.prompt_tokens` / `usage.completion_tokens`
against the catalogue prices and deducted from the account balance. Paid models
return `402 insufficient_balance` at $0; the free model (`qwen/qwen3.7-flash:free`)
keeps working.

## Quick tests (CMD / curl)

```bat
:: health
curl http://127.0.0.1:8080/api/health

:: models
curl http://127.0.0.1:8080/v1/models

:: register (returns api_key)
curl -X POST http://127.0.0.1:8080/api/register ^
  -H "Content-Type: application/json" ^
  -d "{\"name\":\"Sonion\",\"email\":\"sonion@vertexa.dev\",\"password\":\"test12345\"}"

:: chat (replace KEY with the nova-sk-… value; top up first for paid models)
curl -X POST http://127.0.0.1:8080/v1/chat/completions ^
  -H "Authorization: Bearer KEY" -H "Content-Type: application/json" ^
  -d "{\"model\":\"gpt-6-luna\",\"messages\":[{\"role\":\"user\",\"content\":\"hello\"}]}"

:: streaming
curl -N -X POST http://127.0.0.1:8080/v1/chat/completions ^
  -H "Authorization: Bearer KEY" -H "Content-Type: application/json" ^
  -d "{\"model\":\"glm-5.3-flash\",\"messages\":[{\"role\":\"user\",\"content\":\"hi\"}],\"stream\":true}"
```

Postman: create a POST request to `http://127.0.0.1:8080/v1/chat/completions`, header
`Authorization: Bearer nova-sk-…`, JSON body with `model` + `messages`.

## Frontend ⇄ backend

- `assets/js/api.js` — API base + session helpers (`localStorage.nova_user`)
- `auth.js` — real register/login, stores the returned `nova-sk-…` key
- `dashboard.js` — everything renders from `GET /api/me`; Create/Delete key and
  top-ups call the server
- `playground.js` — every message streams from `/v1/chat/completions`; the page
  requires a signed-in session (no local mock). Append `?api=http://host:port`
  to point the page at another backend instance while testing.

Asset URLs carry a `?v=6` cache-buster — bump it when changing JS/CSS.

## Admin Console (desktop app)

```bat
python admin_app.py
```

Three tabs:

- **API Keys** — NightRouter / ExosAI pools: add, delete, mark Active/Dead.
  Reads/writes `backend/nightrouter_keys.json` and `backend/exosai_keys.json`.
- **Models** — built-in catalogue + custom models (ID, name, provider, input/output
  price, context, speed, upstream). Custom rows are written to
  `backend/custom_models.json`.
- **Settings** — file paths, backend health check, hot-reload notes.

**Hot reload:** the backend reads key files on every request, and its
`refresh_models()` re-reads `custom_models.json` whenever the file's mtime
changes — new keys and models apply without restarting `app.py`.

## Notes / limitations

- HTTP only, no TLS; single-process JSON store — fine for demos, not for production.
- Password hashing: PBKDF2-SHA256 (120k iterations, per-user salt).
- `users_db.json` and `upstream_config.json` are gitignored. Never commit real keys.
- `backend/seed_demo.py` writes synthetic usage rows so the dashboard charts have data.

## Push to GitHub

```bash
git init
git add .
git commit -m "NovaCompute: frontend UI + Python API gateway"
gh repo create novacompute --private --source=. --push
# or: create an empty repo on github.com, then
# git remote add origin https://github.com/<you>/novacompute.git
# git push -u origin main
```
