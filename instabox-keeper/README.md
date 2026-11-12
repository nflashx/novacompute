# Instabox keeper + NovaCompute hosting

## What Instabox gives you (free plan)

- 1 Firecracker microVM, 4 vCPU / 8 GiB, Debian 13
- 20 GiB root disk + 20 GiB persistent `/data`
- `agent-browser` template includes Python 3.13, Node, Bun, Rust, Docker
- Public HTTPS URL for a published port
- **Idle pause: 30 minutes fixed**
- **Max run: 480 minutes**, then a cooldown (5–20 min first time, 60–75 min
  second, 120–135 min after repeated max-run pauses)
- Starts: 3/minute

The docs do **not** mention a 120-hour limit. The dashboard may show a trial or
expiry timer; this keeper cannot resurrect a machine that Instabox has already
deleted. It can wake a paused machine and start a stopped one forever.

## 1. Put NovaCompute on the machine

Inside the Instabox terminal:

```bash
cd /data
git clone https://github.com/hoanghaiminh2004-rgb/novacompute.git
cd novacompute
```

Copy your runtime secrets into `backend/` (`oauth_config.json`,
`paypal_config.json`, `payment_config.json`, `users_db.json`, `*_keys.json`).

Install nginx/systemd and start the app:

```bash
sudo bash deploy/install.sh YOUR-PUBLIC-HOST
```

Then edit `/etc/novacompute.env`:

```
NOVA_SITE_URL=https://YOUR-PUBLIC-HOST
NOVA_OAUTH_BASE=https://YOUR-PUBLIC-HOST
```

Restart and publish port 80:

```bash
sudo systemctl restart novacompute
instabox port publish 80
```

The VM terminates TLS; `certbot` is not needed. Add the Instabox public hosts to
Google/GitHub OAuth redirect URIs and set the bank webhook to
`https://YOUR-PUBLIC-HOST/api/payments/bank-webhook`.

## 2. Deploy the keeper Worker

This runs on Cloudflare Workers Cron (free), independent of your PC.

```bash
cd instabox-keeper
npm install
# edit wrangler.toml: MACHINE_ID + PUBLIC_URL
npx wrangler secret put INSTABOX_API_KEY
npx wrangler deploy
```

Get `MACHINE_ID` from the Instabox dashboard or `instabox ls` (`m_...`).
Create the API key in the Instabox dashboard → **API keys**.

Cron behaviour:

- Every 10 minutes: `POST /wake`; if the machine is stopped, `POST /start`;
  then fetch `PUBLIC_URL/api/health`.
- Every 7 hours: `POST /stop` then `POST /start`, before the 480-minute
  max-run pause. The next 10-minute tick starts it if the stop/start races.

Open the Worker URL at any time for a manual status JSON.

## 120-hour case

If the dashboard says the machine is deleted after 120 hours, an API wake can
only return `404`. Keep a snapshot (`instabox snapshot ...`) and restore/create
from it; the keeper can be extended with a `SNAPSHOT_ID` fallback, but the
machine ID and public URL change after recreation.

## Local alternative

If you do not want Cloudflare, a Windows Task Scheduler task can run the same
two API calls every 10 minutes. It only works while the PC is on; the Worker
does not depend on your PC.
