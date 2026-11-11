# NovaCompute on Cloudflare — free forever

Frontend on **Cloudflare Pages** (static, free unlimited bandwidth) + API on
**Cloudflare Workers** (free: 100,000 requests/day) with **D1** (free: 5 GB,
5M reads/day). No server, no cold start, no monthly fee.

```
cloudflare-api/          Worker (src/index.js, catalog.js, schema.sql, wrangler.toml)
novacompute/             static site (deploy to Pages)
```

## 0. Prerequisites

- Node.js 20+ and npm
- Cloudflare account (free): https://dash.cloudflare.com/sign-up

```bash
cd cloudflare-api
npm install
npx wrangler login          # opens the browser once
```

## 1. Create the D1 database

```bash
npx wrangler d1 create novacompute
```

Copy the printed `database_id` into `wrangler.toml`, then create the tables:

```bash
npx wrangler d1 execute novacompute --remote --file schema.sql
```

## 2. Add provider keys as secrets

Each secret is a JSON array, e.g.:

```bash
npx wrangler secret put NIGHTROUTER_KEYS
# paste: [{"api_key":"sk-..."},{"api_key":"sk-..."}]

npx wrangler secret put EXOSAI_KEYS
npx wrangler secret put MISTRAL_KEYS
npx wrangler secret put INCEPTION_KEYS
npx wrangler secret put FURRY_KEYS
npx wrangler secret put BAZAARLINK_KEYS
npx wrangler secret put NAGA_KEYS
```

Use only keys you are authorised to resell through. Secrets are encrypted and
never appear in the repo.

## 3. Deploy the Worker

```bash
npx wrangler deploy
```

It prints the URL, e.g. `https://novacompute-api.<your-subdomain>.workers.dev`.

Test:

```bash
curl https://novacompute-api.<sub>.workers.dev/api/health
curl https://novacompute-api.<sub>.workers.dev/v1/models
```

## 4. Point the web at the Worker and deploy Pages

1. Edit `novacompute/assets/js/config.js`:

```js
window.NOVA_API_BASE = "https://novacompute-api.<your-subdomain>.workers.dev";
```

2. Deploy the static site:

```bash
npx wrangler pages deploy novacompute --project-name novacompute
```

First run asks for a project name / creates it. Output: `https://novacompute.pages.dev`.

Or drag the `novacompute` folder into the Pages dashboard.

## 5. Test the flow

```bash
# register
curl -X POST https://novacompute-api.<sub>.workers.dev/api/register \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"Sonion\",\"email\":\"sonion@example.com\",\"password\":\"test12345\"}"

# chat (use the nova-sk-… key from register; free model needs no credit)
curl -X POST https://novacompute-api.<sub>.workers.dev/v1/chat/completions \
  -H "Authorization: Bearer nova-sk-…" -H "Content-Type: application/json" \
  -d "{\"model\":\"qwen/qwen3.7-flash:free\",\"messages\":[{\"role\":\"user\",\"content\":\"Hello\"}]}"
```

## Local development (optional)

```bash
cd cloudflare-api
npm install
npm run schema:local            # creates the local D1 database
npm run dev                     # http://127.0.0.1:8787
```

Frontend: open `http://127.0.0.1:8123/index.html?api=http://127.0.0.1:8787`
(or put the URL in `assets/js/config.js`).

For local chat tests, create `cloudflare-api/.dev.vars` (gitignored):

```
NIGHTROUTER_KEYS=[{"api_key":"..."}]
EXOSAI_KEYS=[{"api_key":"..."}]
```

## Free-tier notes

| Limit | Free plan | Effect here |
|---|---|---|
| Requests/day | 100,000 | Plenty to start selling |
| CPU per request | 10 ms | Password hashing uses WebCrypto PBKDF2; if you ever hit `1102`, set `PBKDF2_ITERATIONS` lower (e.g. `20000`) in `[vars]` |
| D1 storage | 5 GB | users + usage events |
| D1 reads/day | 5M | dashboard reads are cheap |
| Streaming | supported | SSE passthrough via `body.tee()` |

## Changing the catalogue

Edit `cloudflare-api/src/catalog.js` and redeploy (`npx wrangler deploy`).
The local Admin Console manages the Python backend's `custom_models.json`, not
the Worker — for now the Worker catalogue is code (18 models), intentionally
simple and free.
