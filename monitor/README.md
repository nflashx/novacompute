# Model watcher

Phone alerts when a model stops answering and when it comes back. Stdlib only;
run it next to the API (or on the same Instabox machine).

## Quick start (ntfy — no account)

1. Install the **ntfy** app on your phone.
2. Pick a long random topic, for example `nova-7c1f4e9a2b`, and subscribe to it in the app.
3. Run one pass:

```bash
export NOVA_WATCH_BASE=http://127.0.0.1:8080
export NOVA_WATCH_KEY='nova-sk-...'       # admin or customer key
export NTFY_TOPIC='nova-7c1f4e9a2b'
export NOVA_WATCH_SCOPE=free              # free models only; use "all" for every model
python monitor/model_watch.py --once
```

Without `--once` it keeps running every 15 minutes (`NOVA_WATCH_INTERVAL`).
Only **state changes** are pushed, so your phone is not spammed every pass.
Each probe gets 5 attempts with backoff before a model is marked down.

## Telegram instead

```bash
export TELEGRAM_BOT_TOKEN='123:ABC...'
export TELEGRAM_CHAT_ID='123456789'
```

Create the bot with @BotFather, send it one message, then use that chat id.
ntfy and Telegram can both be enabled at once.

## systemd (Instabox / VPS)

Create `/etc/novacompute-monitor.env` with the variables above (mode 600), then:

```ini
[Unit]
Description=NovaCompute model watcher
After=network.target novacompute.service

[Service]
Type=simple
User=noway
WorkingDirectory=/data/novacompute
EnvironmentFile=/etc/novacompute-monitor.env
ExecStart=/usr/bin/python3 /data/novacompute/monitor/model_watch.py
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now novacompute-monitor
journalctl -u novacompute-monitor -f
```

The state file (`monitor/model_watch_state.json`) is local and must not be
committed. `NOVA_WATCH_SCOPE=free` avoids spending money on paid models; use
`all` only when you accept the upstream cost.

## What it checks

- chat/code → `/v1/chat/completions`
- decision → `/v1/systemone`
- moderation → `/v1/moderations`
- TTS → `/v1/audio/speech`

A probe is health-only: it sends a tiny prompt and never uses customer data.
