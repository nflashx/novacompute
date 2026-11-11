#!/usr/bin/env bash
# NovaCompute VPS installer — Debian/Ubuntu, run as root:
#   sudo bash deploy/install.sh novacompute.example.com
set -euo pipefail

DOMAIN="${1:-}"
if [[ -z "$DOMAIN" ]]; then
  echo "Usage: sudo bash deploy/install.sh YOUR_DOMAIN"
  exit 1
fi
if [[ $EUID -ne 0 ]]; then
  echo "Run as root (sudo)."
  exit 1
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="/opt/novacompute"
WEB_DIR="/var/www/novacompute"
APP_USER="novacompute"

echo "==> Installing packages"
apt-get update -y
apt-get install -y nginx python3 rsync curl certbot python3-certbot-nginx

echo "==> Creating service user and directories"
id -u "$APP_USER" >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER"
install -d -m 750 -o "$APP_USER" -g "$APP_USER" "$APP_DIR/backend"
install -d -m 755 "$WEB_DIR"

echo "==> Copying backend code (secrets and DB are preserved)"
install -m 644 "$ROOT/backend/app.py" "$APP_DIR/backend/app.py"
install -m 644 "$ROOT/backend/AUTH.md" "$APP_DIR/backend/AUTH.md"
install -m 644 "$ROOT/backend/PAYMENTS.md" "$APP_DIR/backend/PAYMENTS.md"
install -m 644 "$ROOT/backend/mail_config.example.json" "$APP_DIR/backend/mail_config.example.json"
for f in users_db.json oauth_config.json paypal_config.json payment_config.json; do
  if [[ -f "$ROOT/backend/$f" && ! -f "$APP_DIR/backend/$f" ]]; then
    install -m 600 -o "$APP_USER" -g "$APP_USER" "$ROOT/backend/$f" "$APP_DIR/backend/$f"
  fi
done
for f in "$ROOT"/backend/*_keys.json; do
  [[ -e "$f" ]] || continue
  base="$(basename "$f")"
  if [[ ! -f "$APP_DIR/backend/$base" ]]; then
    install -m 600 -o "$APP_USER" -g "$APP_USER" "$f" "$APP_DIR/backend/$base"
  fi
done

echo "==> Copying frontend"
if [[ -f "$WEB_DIR/assets/js/payment-config.js" ]]; then
  cp -p "$WEB_DIR/assets/js/payment-config.js" /tmp/novacompute-payment-config.js
fi
rsync -a --delete "$ROOT/novacompute/" "$WEB_DIR/"
if [[ -f /tmp/novacompute-payment-config.js ]]; then
  mv /tmp/novacompute-payment-config.js "$WEB_DIR/assets/js/payment-config.js"
  chmod 600 "$WEB_DIR/assets/js/payment-config.js"
elif [[ -f "$ROOT/novacompute/assets/js/payment-config.js" ]]; then
  cp -p "$ROOT/novacompute/assets/js/payment-config.js" "$WEB_DIR/assets/js/payment-config.js"
  chmod 600 "$WEB_DIR/assets/js/payment-config.js"
fi
chown -R www-data:www-data "$WEB_DIR"

echo "==> Writing environment"
if [[ ! -f /etc/novacompute.env ]]; then
  sed "s|YOUR_DOMAIN|$DOMAIN|g" "$ROOT/deploy/novacompute.env.example" > /etc/novacompute.env
  chmod 600 /etc/novacompute.env
fi

echo "==> Installing systemd service"
install -m 644 "$ROOT/deploy/novacompute.service" /etc/systemd/system/novacompute.service
systemctl daemon-reload
systemctl enable --now novacompute

echo "==> Installing nginx site"
sed "s|YOUR_DOMAIN|$DOMAIN|g" "$ROOT/deploy/nginx.conf" > /etc/nginx/sites-available/novacompute
ln -sf /etc/nginx/sites-available/novacompute /etc/nginx/sites-enabled/novacompute
nginx -t
systemctl reload nginx

echo "==> Smoke test"
sleep 1
curl -fsS "http://127.0.0.1:8080/api/health" || true
echo
echo "Install complete."
echo "  API health : https://$DOMAIN/api/health"
echo "  Site       : https://$DOMAIN"
echo "  OAuth URIs : https://$DOMAIN/api/auth/oauth/google/callback"
echo "               https://$DOMAIN/api/auth/oauth/github/callback"
echo
echo "Next:"
echo "  1. Point DNS A/AAAA to this VPS, then run: certbot --nginx -d $DOMAIN"
echo "  2. Add the OAuth callback URIs above to Google/GitHub consoles."
echo "  3. Configure SMTP: /opt/novacompute/backend/mail_config.json (see AUTH.md)."
echo "  4. Configure payments: backend/payment_config.json + paypal_config.json."
echo "  5. systemctl status novacompute"
