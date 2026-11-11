# Deploy NovaCompute on a VPS (auto-start + restart)

Tested layout: Debian/Ubuntu + systemd + nginx + Python 3 (stdlib only).

## One command

```bash
sudo bash deploy/install.sh novacompute.yourdomain.com
```

This creates:

- `/opt/novacompute/backend` — API (`app.py`), started by `novacompute.service`
- `/var/www/novacompute` — static site served by nginx
- `/etc/novacompute.env` — domain, ports, DEV mail flag
- `/etc/nginx/sites-available/novacompute` — same-origin proxy:
  - `/v1/*` and `/api/*` → `127.0.0.1:8080`
  - `/api/auth/oauth/*` → `127.0.0.1:8600` (OAuth callback listener)
  - everything else → static files

`systemd` uses `Restart=always`, so the API comes back after a crash or reboot.
`systemctl status novacompute` shows it.

## HTTPS

After DNS points to the VPS:

```bash
certbot --nginx -d novacompute.yourdomain.com
```

Certbot edits the nginx config and installs the renewal timer.

## OAuth consoles

Add these exact redirect URIs in Google Cloud / GitHub OAuth App:

```
https://novacompute.yourdomain.com/api/auth/oauth/google/callback
https://novacompute.yourdomain.com/api/auth/oauth/github/callback
```

Set `NOVA_SITE_URL` and `NOVA_OAUTH_BASE` to `https://novacompute.yourdomain.com`
in `/etc/novacompute.env` (the installer does this), then `systemctl restart novacompute`.

## Secrets and data

Copy once into `/opt/novacompute/backend/` (mode 600, owner `novacompute`):

- `oauth_config.json`
- `paypal_config.json`
- `payment_config.json`
- `users_db.json`
- `*_keys.json` (provider pools)
- `mail_config.json` if you want real verification email

Re-running `install.sh` preserves these files and the live `users_db.json`.

## What runs automatically

- API + OAuth callback: `novacompute.service`
- Static + reverse proxy + HTTPS renewal: nginx + certbot timer
- Plan activation, quota reset and payment crediting are handled by the API on
  each request; no cron or manual approval is required for PayPal.
- Bank transfers auto-credit only when the bank webhook (SePay/Casso) is pointed
  at `https://your-domain/api/payments/bank-webhook` with the token from
  `payment_config.json`.

## Local Windows

`start.bat` still starts the Python API and static server. For auto-start on
Windows, create a Task Scheduler task at logon running `silent_start.vbs`.

## Update the app

```bash
cd /path/to/repo && git pull
sudo bash deploy/install.sh novacompute.yourdomain.com
```

The installer rsyncs the frontend and replaces `app.py`, then systemd restarts
the API. Databases and secret configs are kept.
