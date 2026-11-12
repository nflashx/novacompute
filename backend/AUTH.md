# NovaCompute auth — email verification + Google/GitHub login

## What is enforced

- Email/password sign-up creates a **pending** account and sends a 6-digit code.
  The user is not created until the code is verified.
- Disposable domains, throwaway patterns, `+` aliases and Gmail dot/alias duplicates are rejected.
- The domain must have MX (or A) records, checked through Cloudflare DNS-over-HTTPS.
- Sign-ups per IP: 3/hour, 6/day, then a 24-hour IP block.
- 8 failed logins lock the account for 15 minutes.
- Google/GitHub accounts are accepted only with a provider-verified email.

## Real verification email (SMTP)

Copy `backend/mail_config.example.json` to `backend/mail_config.json` and fill in
a Gmail App Password (Google Account → Security → App passwords):

```json
{
  "enabled": true,
  "host": "smtp.gmail.com",
  "port": 465,
  "user": "you@gmail.com",
  "pass": "16-character-app-password",
  "from": "NovaCompute <you@gmail.com>"
}
```

Restart `python backend/app.py`.

Without SMTP, the backend keeps the DEV fallback **off** (`NOVA_DEV_MAIL=0`).
For local development only, start with `NOVA_DEV_MAIL=1`; the code is printed
to the server console and returned to the page only for a direct loopback
request with no proxy headers. nginx and tunnels connect from `127.0.0.1`, so
they are explicitly rejected; public requests get `503 mail_not_configured`.

## Google / GitHub OAuth

`backend/oauth_config.json` (gitignored) is already populated. Redirect URIs:

```
http://127.0.0.1:8600/api/auth/oauth/google/callback
http://127.0.0.1:8600/api/auth/oauth/github/callback
```

The OAuth callback listener runs on port 8600 inside the same `app.py` process;
the main API stays on 8080. If you change ports, update both the provider console
and `NOVA_OAUTH_BASE` / `NOVA_OAUTH_PORT` / `NOVA_SITE_URL` env vars.

## Production notes

- Set `NOVA_SITE_URL` to your public site and `NOVA_OAUTH_BASE` to the public
  callback origin, then add those exact URIs to Google/GitHub.
- The Cloudflare Worker in `cloudflare-api/` does **not** implement this auth
  flow yet. Do not expose its `/api/register` publicly without porting the
  verification/anti-abuse logic (or restricting sign-up to OAuth).
