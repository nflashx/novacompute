# novarouter.cc.cd — Cloudflare Pages edge proxy

`novarouter.cc.cd` is served by the Cloudflare Pages project **novarouter** in
advanced mode. Pages terminates TLS for the custom hostname and `_worker.js`
forwards every request to the Instabox origin with the Host header Instabox
expects.

Why not a plain CNAME to Instabox? Instabox routes by Host, so a CNAME to the
`*.instabox.tech` hostname returns 404. Why not a Worker route? A Worker custom
domain/route needs the hostname to be a Cloudflare zone, and Cloudflare Free
does not support adding a subdomain as its own zone. Pages custom domains do
support an external-DNS subdomain through a CNAME, so the proxy lives there.

```
browser
  │  https://novarouter.cc.cd
  ▼
Cloudflare Pages project "novarouter"  (pages/_worker.js)
  │  Host: 8000-<machine>.instabox.tech
  ▼
Instabox nginx :8000
  ├─ /v1/*              → 127.0.0.1:8080  (OpenAI-compatible API, SSE)
  ├─ /api/auth/oauth/*  → 127.0.0.1:8600  (OAuth callback listener)
  └─ /*                 → static site
```

## DNS

At DNSHE, the `novarouter.cc.cd` zone has one record:

| Type  | Name | Content               | TTL |
|-------|------|-----------------------|-----|
| CNAME | @    | `novarouter.pages.dev` | 600 |

The Pages project must have the custom domain added first. It is already added,
and its status is `active` with an HTTP-validated certificate.

## Deploy

```bash
cd novarouter-proxy
npx wrangler pages deploy pages --project-name novarouter --branch main
```

The origin is the `ORIGIN` constant in `pages/_worker.js`. Update it if the
Instabox public hostname or machine changes.

`src/index.js` + `wrangler.toml` are the older standalone Worker deployment
(`novarouter-proxy.nflashx.workers.dev`). It is kept as a fallback/testing path;
the production hostname uses Pages.

## Backend environment

On the Instabox machine, `/etc/systemd/system/novacompute.service` sets:

```
Environment=NOVA_SITE_URL=https://novarouter.cc.cd
Environment=NOVA_OAUTH_BASE=https://novarouter.cc.cd
```

`NOVA_OAUTH_BASE` is the public callback base, so the provider consoles need:

```
https://novarouter.cc.cd/api/auth/oauth/google/callback
https://novarouter.cc.cd/api/auth/oauth/github/callback
```

Both are registered, together with the Instabox hostname as a fallback.

## Checks

```bash
curl -sS https://novarouter.cc.cd/api/health
curl -sS https://novarouter.cc.cd/v1/models
curl -sS -N https://novarouter.cc.cd/v1/chat/completions \
  -H "Authorization: Bearer $NOVA_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"model":"deepseek-v4.1-flash","messages":[{"role":"user","content":"ping"}],"stream":true}'
```

SSE must arrive incrementally; `_worker.js` returns `upstream.body` without
buffering and strips `content-length` / `content-encoding`.
