#!/usr/bin/env python3
"""NovaCompute API gateway — Python standard library only."""

import hashlib
import json
from collections import deque
import os
import random
import re
import secrets
import smtplib
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlencode, urlparse

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
USERS_DB_FILE = os.path.join(BASE_DIR, "users_db.json")
OAUTH_CONFIG_FILE = os.path.join(BASE_DIR, "oauth_config.json")
MAIL_CONFIG_FILE = os.path.join(BASE_DIR, "mail_config.json")
PAYPAL_CONFIG_FILE = os.path.join(BASE_DIR, "paypal_config.json")
PAYMENT_CONFIG_FILE = os.path.join(BASE_DIR, "payment_config.json")
PORT = int(os.getenv("NOVA_PORT", "8080"))
SITE_URL = os.getenv("NOVA_SITE_URL", "http://127.0.0.1:8123").rstrip("/")
OAUTH_CALLBACK_BASE = os.getenv("NOVA_OAUTH_BASE", "http://127.0.0.1:8600").rstrip("/")
OAUTH_CALLBACK_PORT = int(os.getenv("NOVA_OAUTH_PORT", "8600"))
UPSTREAM_TIMEOUT = 120
UPSTREAM_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
DB_LOCK = threading.RLock()

# ================= SIGN-UP / ANTI-ABUSE =================
SIGNUP_WINDOW = 3600
SIGNUP_LIMIT = int(os.getenv("NOVA_SIGNUP_LIMIT", "3"))
SIGNUP_DAILY = int(os.getenv("NOVA_SIGNUP_DAILY", "6"))
IP_BAN_SECONDS = 86400
FAILED_LIMIT = 8
LOCK_SECONDS = 900
CODE_TTL = 600
FAKE_MAIL_LIMIT = 3
FAKE_MAIL_BASE = 600
FAKE_MAIL_MAX = 86400

DISPOSABLE_DOMAINS = {
    "mailinator.com", "10minutemail.com", "10minutemail.net", "guerrillamail.com", "guerrillamail.net",
    "guerrillamail.org", "sharklasers.com", "grr.la", "yopmail.com", "yopmail.net", "trashmail.com",
    "trashmail.net", "trash-mail.com", "tempmail.com", "temp-mail.org", "tempmailo.com", "tempmail.dev",
    "getnada.com", "nada.email", "dispostable.com", "fakeinbox.com", "throwawaymail.com", "maildrop.cc",
    "mintemail.com", "mytemp.email", "spam4.me", "mailnesia.com", "tempinbox.com", "tmpmail.org",
    "throwam.com", "moakt.com", "mohmal.com", "emailondeck.com", "email-fake.com", "fakemailgenerator.com",
    "fake-mail.net", "mailtemp.net", "tempr.email", "discard.email", "spamgourmet.com", "burnermail.io",
    "anonaddy.me", "33mail.com", "mailcatch.com", "inboxbear.com", "tempmailaddress.com", "mailsac.com",
    "inboxkitten.com", "harakirimail.com", "mailde.de", "mailde.info", "luxusmail.org", "cs.email",
    "edumail.edu.pl", "1secmail.com", "1secmail.net", "1secmail.org", "esiix.com", "wwjmp.com", "xojxe.com",
    "yoggm.com", "vjuum.com", "laafd.com", "txcct.com", "kzccv.com", "qiott.com", "wuuvo.com", "icznn.com",
    "ezztt.com", "crymail.com", "tempmail.plus", "internxt.com", "altmails.com", "temprmail.com",
    "getairmail.com", "airmail.cc", "10minutemail.pl", "binkmail.com", "bobmail.info", "chammy.info",
    "devnullmail.com", "letthemeatspam.com", "mailin8r.com", "mailinater.com", "notmailinator.com",
    "reallymymail.com", "sogetthis.com", "spambog.com", "spamhole.com", "thisisnotmyrealemail.com",
    "trbvm.com", "uggsrock.com", "wegwerfmail.de", "zoemail.net", "sneakemail.com", "jetable.org",
    "mail-temporaire.fr", "moncourrier.fr.nf", "monmail.fr.nf", "discardmail.com", "spambog.de",
    "example.com", "example.org", "example.net", "test.com", "localhost", "invalid", "local",
}
DISPOSABLE_PATTERNS = re.compile(
    r"^(temp|trash|fake|throwaway|disposable|10minute|burner|junk|spam|onetime|one-time)[\w.-]*", re.I)

def email_family(email):
    """Canonicalize Gmail: drop dots, +alias, googlemail -> gmail."""
    e = (email or "").strip().lower()
    local, _, domain = e.partition("@")
    if domain in ("gmail.com", "googlemail.com"):
        domain = "gmail.com"
        local = local.split("+")[0].replace(".", "")
    return local + "@" + domain

def mail_allowed(email):
    domain = email.rsplit("@", 1)[-1].lower() if "@" in email else ""
    if not domain or domain in DISPOSABLE_DOMAINS or any(domain.endswith("." + d) for d in DISPOSABLE_DOMAINS):
        return False, "Disposable / temporary email domains are not allowed. Use a real mailbox."
    if domain.endswith((".test", ".invalid", ".localhost", ".local")):
        return False, "This email domain cannot receive mail. Use a real mailbox."
    if DISPOSABLE_PATTERNS.match(domain.split(".")[0]):
        return False, "This looks like a throwaway email domain. Use a real mailbox."
    return True, ""

def domain_has_mx(domain):
    """Ask Cloudflare DNS-over-HTTPS for MX/A records. Fails open on network errors."""
    for rtype in ("MX", "A"):
        try:
            url = "https://cloudflare-dns.com/dns-query?" + urlencode({"name": domain, "type": rtype})
            req = urllib.request.Request(url, headers={"Accept": "application/dns-json", "User-Agent": "NovaCompute/1.0"})
            with urllib.request.urlopen(req, timeout=4) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            if int(data.get("Status", 0)) == 0 and data.get("Answer"):
                return True
        except Exception as exc:
            print(f"[signup] DNS check skipped for {domain}: {exc}")
            return True
    return False

# ================= CẤU HÌNH PROVIDERS =================
# Keys KHÔNG bao giờ nằm trong file này — đặt trong backend/<provider>_keys.json
# (gitignored), dạng list các string hoặc {"api_key": "..."}. Có thể thêm
# "fallback_key": "<key>" tạm thời khi chạy local nếu file keys chưa có gì.
PROVIDERS = {
    "nightrouter": {
        "url": "https://api.nightrouter.ai/v1/chat/completions",
        "keys_file": os.path.join(BASE_DIR, "nightrouter_keys.json"),
    },
    "exosai": {
        "url": "https://api.exosai.tech/v1/chat/completions",
        "keys_file": os.path.join(BASE_DIR, "exosai_keys.json"),
    },
    "mistral": {
        "url": "https://api.mistral.ai/v1/chat/completions",
        "keys_file": os.path.join(BASE_DIR, "mistral_keys.json"),
    },
    "inception": {
        "url": "https://api.inceptionlabs.ai/v1/chat/completions",
        "keys_file": os.path.join(BASE_DIR, "inception_keys.json"),
    },
    "furry": {
        "url": "https://ai.furry.edu.gr/v1/chat/completions",
        "keys_file": os.path.join(BASE_DIR, "furry_keys.json"),
    },
    "bazaarlink": {
        "url": "https://api.bazaarlink.ai/v1/chat/completions",
        "keys_file": os.path.join(BASE_DIR, "bazaarlink_keys.json"),
    },
    "nagaai": {
        "url": "https://api.naga.ac/v1/chat/completions",
        "keys_file": os.path.join(BASE_DIR, "nagaai_keys.json"),
    },
}

# ================= DANH SÁCH MODEL & GIÁ =================
MODELS = [
    {"id": "claude-opus-5.5", "name": "Claude Opus 5.5", "provider": "Anthropic", "context": "1M", "speed": 85, "input": 3.2, "output": 16.0, "image": True, "video": False, "category": "chat", "tag": "Popular", "note": "", "upstream_id": "claude-opus-5.5-free"},
    {"id": "claude-sonnet-5.5", "name": "Claude Sonnet 5.5", "provider": "Anthropic", "context": "1M", "speed": 92, "input": 1.8, "output": 9.0, "image": True, "video": False, "category": "chat", "tag": None, "note": "", "upstream_id": "claude-sonnet-5-5-free"},
    {"id": "gpt-6-luna", "name": "GPT-6", "provider": "OpenAI", "context": "900K", "speed": 118, "input": 0.08, "output": 0.4, "image": True, "video": False, "category": "chat", "tag": "New", "note": ""},
    {"id": "gpt-5.6-luna", "name": "GPT-5.6", "provider": "OpenAI", "context": "900K", "speed": 130, "input": 0.0, "output": 0.0, "image": True, "video": False, "category": "chat", "tag": "Free", "note": ""},
    {"id": "grok-4.6", "name": "Grok 4.6", "provider": "xAI", "context": "500K", "speed": 150, "input": 1.7, "output": 5.1, "image": True, "video": False, "category": "chat", "tag": None, "note": ""},
    {"id": "deepseek-v4.1-flash", "name": "DeepSeek V4.1", "provider": "DeepSeek", "context": "1M", "speed": 145, "input": 0.0, "output": 0.0, "image": True, "video": False, "category": "code", "tag": "Free", "note": ""},
    {"id": "deepseek-v4.1-flash-1017", "name": "DeepSeek V4.1 1017", "provider": "DeepSeek", "context": "1M", "speed": 145, "input": 0.005, "output": 0.24, "image": True, "video": False, "category": "code", "tag": None, "note": ""},
    {"id": "kimi-k3.1-pro", "name": "Kimi k3.1 Pro", "provider": "Moonshot AI", "context": "1M", "speed": 120, "input": 1.8, "output": 9.0, "image": True, "video": True, "category": "chat", "tag": None, "note": "", "upstream_id": "kimi-k3.1-pro-free"},
    {"id": "mistral-large-4", "name": "Mistral Large 4", "provider": "Mistral AI", "context": "1M", "speed": 98, "input": 0.0, "output": 0.0, "image": True, "video": False, "category": "chat", "tag": "Free", "note": ""},
    {"id": "mercury-3", "name": "Mercury 3", "provider": "Inception", "context": "1M", "speed": 1000, "input": 0.1, "output": 0.35, "image": False, "video": False, "category": "code", "tag": "Diffusion", "note": ""},
    {"id": "glm-5.3-flash", "name": "GLM 5.3 Flash", "provider": "Z.ai", "context": "1M", "speed": 240, "input": 0.03, "output": 0.07, "image": True, "video": True, "category": "chat", "tag": None, "note": ""},
    {"id": "glm-5.3", "name": "GLM 5.3", "provider": "Z.ai", "context": "1M", "speed": 85, "input": 0.0, "output": 0.0, "image": False, "video": False, "category": "chat", "tag": "Free", "note": ""},
    {"id": "qwen/qwen3.7-flash:free", "name": "Qwen 3.7", "provider": "Alibaba", "context": "1M", "speed": 130, "input": 0.0, "output": 0.0, "image": True, "video": True, "category": "chat", "tag": "Free", "note": ""},
    {"id": "gemini-4-argon", "name": "Gemini 4 Argon", "provider": "Google", "context": "1M", "speed": 110, "input": 0.4, "output": 1.2, "image": True, "video": True, "category": "chat", "tag": None, "note": "", "upstream_id": "gemini-4-argon-free"},
    {"id": "ernie-5.5-flash", "name": "ERNIE-5.5-Flash", "provider": "Baidu", "context": "1M", "speed": 0, "input": 0.14, "output": 0.565, "image": False, "video": False, "category": "chat", "tag": None, "note": "", "upstream_id": "baidu/ernie-5.5-flash-preview:free"},
    {"id": "gemini-3.8-flash-lite-tts", "name": "Gemini 3.8 Flash-Lite TTS", "provider": "Google", "context": "—", "speed": 0, "input": 0.0, "output": 0.0055, "image": False, "video": False, "category": "tts", "tag": "Sub", "note": "Free with subscription · up to 100 req/day", "price_unit": "1k_chars", "upstream_id": "google/gemini-3.8-flash-lite-tts:free"},
    {"id": "gemini-3.8-flash-tts", "name": "Gemini 3.8 Flash TTS", "provider": "Google", "context": "—", "speed": 0, "input": 0.0, "output": 0.008, "price_unit": "1k_chars", "image": False, "video": False, "category": "tts", "tag": "Sub", "note": "Free with subscription · up to 100 req/day", "upstream_id": "google/gemini-3.8-flash-tts:free"},
    {"id": "omni-moderation", "name": "Omni Moderation", "provider": "OpenAI", "context": "—", "speed": 0, "input": 0.0, "output": 0.0, "image": True, "video": False, "category": "moderation", "tag": "Free", "note": "Moderation API · free", "upstream_id": "openai/omni-moderation"},
]
PRICING = {m["id"]: (m["input"], m["output"]) for m in MODELS}
MODEL_IDS = set(PRICING)

# ================= SUBSCRIPTION PLANS =================
PLANS = {
    "starter": {"name": "Starter", "price": 4.99, "quota": 1_500_000, "tts": 20, "bonus": 3.0},
    "pro": {"name": "Pro", "price": 12.99, "quota": 6_000_000, "tts": 60, "bonus": 5.0},
    "ultra": {"name": "Ultra", "price": 29.99, "quota": 20_000_000, "tts": 150, "bonus": 12.0},
}
PLAN_QUOTA = {key: value["quota"] for key, value in PLANS.items()}
# Sub quota multipliers: how many quota tokens one real token burns.
# Based on the Ultra budget (the most generous plan) so no plan loses at 100% output.
QUOTA_MULTIPLIERS = {
    "glm-5.3-flash": 2,
    "deepseek-v4.1-flash-1017": 5,
    "mercury-3": 7,
    "gpt-6-luna": 8,
    "ernie-5.5-flash": 12,
    "gemini-4-argon": 25,
    "grok-4.6": 100,
    "kimi-k3.1-pro": 180,
    "claude-sonnet-5.5": 180,
    "claude-opus-5.5": 320,
}

# ================= REQUEST RATE LIMITS =================
RATE_LIMITS = {
    "free": {"rpm": 30, "daily": 500},
    "payg": {"rpm": 120, "daily": 5000},
    "starter": {"rpm": 60, "daily": 1000},
    "pro": {"rpm": 300, "daily": 5000},
    "ultra": {"rpm": 600, "daily": 20000},
    "admin": {"rpm": 1200, "daily": 100000},
}
RATE_LOCK = threading.Lock()
RATE_BUCKETS = {}

def rate_tier(user):
    if user.get("is_admin"): return "admin"
    if plan_active(user): return user.get("plan")
    return "payg" if user.get("balance", 0) > 0 else "free"

def check_request_rate(user, key):
    limits = RATE_LIMITS.get(rate_tier(user), RATE_LIMITS["free"])
    now = time.time()
    with RATE_LOCK:
        bucket = RATE_BUCKETS.setdefault(key["id"], deque())
        while bucket and now - bucket[0] >= 60:
            bucket.popleft()
        if len(bucket) >= limits["rpm"]:
            retry = max(1, int(60 - (now - bucket[0])) + 1)
            return False, limits, retry, "rpm"
        today = now_utc().date()
        used_today = 0
        for event in user.get("usage", []):
            try:
                if event.get("key_id") not in (None, key["id"]): continue
                if datetime.fromtimestamp(event["ts"], timezone.utc).date() == today:
                    used_today += 1
            except (KeyError, ValueError, OSError):
                continue
        if used_today >= limits["daily"]:
            return False, limits, None, "daily"
        bucket.append(now)
    return True, limits, 0, ""

def plan_active(user):
    plan = user.get("plan")
    if plan not in PLANS: return False
    raw = user.get("plan_expires")
    if not raw: return False
    try:
        return datetime.fromisoformat(str(raw).replace("Z", "+00:00")) > now_utc()
    except ValueError:
        return False

def plan_tokens_used_today(user):
    today = now_utc().date(); total = 0
    for event in user.get("usage", []):
        try:
            if datetime.fromtimestamp(event["ts"], timezone.utc).date() != today: continue
        except (KeyError, ValueError, OSError):
            continue
        model = event.get("model")
        if MODEL_LOOKUP.get(model, {}).get("category") == "tts": continue
        price_in, price_out = PRICING.get(model, (0, 0))
        if not price_in and not price_out: continue
        tokens = int(event.get("prompt_tokens", 0)) + int(event.get("completion_tokens", 0))
        total += tokens * QUOTA_MULTIPLIERS.get(model, 10)
    return total

def plan_tts_used_today(user):
    today = now_utc().date(); count = 0
    for event in user.get("usage", []):
        model = event.get("model")
        if not model or model not in MODEL_LOOKUP or MODEL_LOOKUP[model].get("category") != "tts": continue
        try:
            if datetime.fromtimestamp(event["ts"], timezone.utc).date() == today: count += 1
        except (KeyError, ValueError, OSError):
            continue
    return count

# Map Model ID -> Provider (CHUẨN THEO FILE CŨ)
MODEL_PROVIDER_MAP = {
    "grok-4.6": "exosai",
    "mistral-large-4": "mistral",
    "mercury-3": "inception",
    "gpt-6-luna": "furry",
    "gpt-5.6-luna": "furry",
    "qwen/qwen3.7-flash:free": "bazaarlink",
    "gemini-4-argon": "nightrouter",
    "ernie-5.5-flash": "nagaai",
    "gemini-3.8-flash-lite-tts": "nagaai",
    "gemini-3.8-flash-tts": "nagaai",
    "omni-moderation": "nagaai",
}
DEFAULT_PROVIDER = "nightrouter"

# ================= CUSTOM MODELS (hot reload) =================
CUSTOM_MODELS_FILE = os.path.join(BASE_DIR, "custom_models.json")
BASE_MODELS = [dict(m) for m in MODELS]
BASE_PROVIDER_MAP = dict(MODEL_PROVIDER_MAP)
_MODELS_LOCK = threading.Lock()
MODEL_LOOKUP = {m["id"]: m for m in MODELS}
_custom_state = {"mtime": None}

def refresh_models():
    global MODELS, PRICING, MODEL_IDS, MODEL_PROVIDER_MAP, MODEL_LOOKUP
    try:
        mtime = os.path.getmtime(CUSTOM_MODELS_FILE)
    except OSError:
        mtime = 0
    if mtime == _custom_state["mtime"]:
        return
    with _MODELS_LOCK:
        if mtime == _custom_state["mtime"]:
            return
        custom = []
        if mtime:
            try:
                with open(CUSTOM_MODELS_FILE, "r", encoding="utf-8") as fh:
                    data = json.load(fh)
                if isinstance(data, list):
                    custom = [m for m in data if isinstance(m, dict) and m.get("id")]
            except (OSError, json.JSONDecodeError) as exc:
                print(f"[models] custom_models.json error: {exc}")
        custom_ids = {m["id"] for m in custom}
        merged = [m for m in BASE_MODELS if m["id"] not in custom_ids] + custom
        MODELS = merged
        PRICING = {m["id"]: (float(m.get("input", 0) or 0), float(m.get("output", 0) or 0)) for m in merged}
        MODEL_IDS = set(PRICING)
        provider_map = dict(BASE_PROVIDER_MAP)
        for m in custom:
            upstream = str(m.get("upstream") or "").strip()
            if upstream in PROVIDERS:
                provider_map[m["id"]] = upstream
        MODEL_PROVIDER_MAP = provider_map
        global MODEL_LOOKUP
        MODEL_LOOKUP = {m["id"]: m for m in merged}
        _custom_state["mtime"] = mtime
        print(f"[models] catalogue reloaded: {len(merged)} models (+{len(custom)} custom)")

def now_utc(): return datetime.now(timezone.utc)
def iso(dt): return dt.strftime("%Y-%m-%dT%H:%M:%SZ")

def atomic_write(path, obj):
    tmp = f"{path}.tmp"
    with open(tmp, "w", encoding="utf-8") as fh: json.dump(obj, fh, ensure_ascii=False, indent=2)
    os.replace(tmp, path)

def mask_key(value):
    if not value or len(value) < 12: return "***"
    return f"{value[:10]}…{value[-4:]}"

def hash_password(password, salt_hex=None):
    salt_hex = salt_hex or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), bytes.fromhex(salt_hex), 120_000).hex()
    return salt_hex, digest

def verify_password(password, salt_hex, expected_hash):
    _, digest = hash_password(password, salt_hex)
    return secrets.compare_digest(digest, expected_hash)

def new_api_key(): return "nova-sk-" + secrets.token_hex(20)
def error_payload(err_type, code, message): return {"error": {"type": err_type, "code": code, "message": message}}

def load_users():
    with DB_LOCK:
        if not os.path.exists(USERS_DB_FILE):
            atomic_write(USERS_DB_FILE, {"users": []})
            return {"users": []}
        with open(USERS_DB_FILE, "r", encoding="utf-8") as fh:
            try: data = json.load(fh)
            except json.JSONDecodeError: data = {"users": []}
        if not isinstance(data.get("users"), list): data = {"users": []}
        for field, default in (("pending", {}), ("ip_signups", {}), ("banned_ips", []),
                               ("fake_mail", {}), ("failed_logins", {}), ("oauth_sessions", {}),
                               ("paypal_orders", {}), ("bank_txns", {}), ("paypal_payers", {}), ("bank_senders", {})):
            data.setdefault(field, default)
        return data

def save_users(db):
    with DB_LOCK: atomic_write(USERS_DB_FILE, db)

def find_user_by_api_key(db, token):
    for user in db["users"]:
        for key in user.get("api_keys", []):
            if key.get("key") == token and key.get("status", "active") == "active": return user, key
    return None, None

def find_user_by_email(db, email):
    email = email.strip().lower()
    for user in db["users"]:
        if user.get("email", "").lower() == email: return user
    return None

def family_taken(db, email):
    family = email_family(email)
    return any(email_family(u.get("email", "")) == family for u in db["users"])

def public_key(key):
    return {"id": key["id"], "name": key.get("name", "Key"), "key": key["key"], "created_at": key.get("created_at"), "last_used": key.get("last_used"), "status": key.get("status", "active")}

# ================= AUTH HELPERS (email / anti-abuse / OAuth) =================
def load_json_cfg(path):
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, json.JSONDecodeError):
        return None

def client_ip(handler):
    fwd = (handler.headers.get("X-Forwarded-For", "") or "").split(",")[0].strip()
    ip = fwd or (handler.client_address[0] if handler.client_address else "0.0.0.0")
    if ip in ("::1", "::ffff:127.0.0.1"):
        return "127.0.0.1"
    return ip

def send_mail(to, subject, html_body, text_body=""):
    cfg = load_json_cfg(MAIL_CONFIG_FILE)
    if not cfg or not cfg.get("enabled"):
        print(f"[MAIL NOT CONFIGURED] to={to} | {subject} | {text_body or html_body[:100]}")
        return False
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = cfg.get("from", cfg["user"])
    msg["To"] = to
    msg.attach(MIMEText(text_body or html_body, "plain"))
    msg.attach(MIMEText(html_body, "html"))
    port = int(cfg.get("port", 465))
    try:
        if port == 465:
            smtp = smtplib.SMTP_SSL(cfg["host"], port, timeout=20)
        else:
            smtp = smtplib.SMTP(cfg["host"], port, timeout=20)
            smtp.starttls()
        try:
            smtp.login(cfg["user"], cfg["pass"])
            smtp.send_message(msg)
        finally:
            smtp.quit()
        return True
    except Exception as exc:
        print(f"[MAIL ERROR] {to}: {exc}")
        return False

def send_code_email(to, code):
    html = f"""<div style="background:#04060a;padding:32px;font-family:Segoe UI,Arial,sans-serif">
      <div style="max-width:460px;margin:0 auto;background:#0c1016;border:1px solid #1f2a36;border-radius:16px;padding:32px;text-align:center">
        <h2 style="color:#fff;margin:0 0 6px">NovaCompute</h2>
        <p style="color:#8fa0b0;font-size:13px;margin:0 0 24px">Your verification code (expires in 10 minutes)</p>
        <div style="font-size:34px;letter-spacing:10px;font-weight:700;color:#a78bfa">{code}</div>
        <p style="color:#5c6975;font-size:12px;margin-top:24px">If you didn't request this, ignore this email.</p>
      </div></div>"""
    return send_mail(to, f"NovaCompute — your verification code: {code}", html,
                     f"Your NovaCompute verification code: {code} (expires in 10 minutes)")

def dev_mail_allowed(handler):
    """DEV code is only exposed on a direct loopback connection, never via X-Forwarded-For."""
    addr = handler.client_address[0] if handler.client_address else ""
    return addr in ("127.0.0.1", "::1", "::ffff:127.0.0.1") and os.getenv("NOVA_DEV_MAIL", "1") != "0"

def prune_ip(db, ip):
    hits = [t for t in db["ip_signups"].get(ip, []) if time.time() - t < 86400]
    db["ip_signups"][ip] = hits
    return hits

def ip_is_banned(db, ip):
    for ban in db.get("banned_ips", []):
        if ban.get("ip") == ip and (not ban.get("until") or time.time() < ban["until"]):
            return True
    return False

def fake_mail_blocked(db, ip):
    st = db.get("fake_mail", {}).get(ip)
    return bool(st and time.time() < st.get("blocked_until", 0))

def fake_mail_hit(handler):
    ip = client_ip(handler)
    with DB_LOCK:
        db = load_users()
        st = db["fake_mail"].setdefault(ip, {"count": 0, "blocked_until": 0})
        st["count"] = int(st.get("count", 0)) + 1
        if st["count"] >= FAKE_MAIL_LIMIT:
            penalty = min(FAKE_MAIL_BASE * (2 ** (st["count"] - FAKE_MAIL_LIMIT)), FAKE_MAIL_MAX)
            st["blocked_until"] = time.time() + penalty
        save_users(db)

# ================= OAUTH (Google / GitHub) =================
OAUTH_STATE = {}
OAUTH_LOCK = threading.Lock()

def oauth_cfg(provider):
    cfg = load_json_cfg(OAUTH_CONFIG_FILE) or {}
    c = cfg.get(provider) or {}
    if not c.get("client_id") or not c.get("client_secret"):
        return None
    return c

def oauth_authorize_url(provider):
    c = oauth_cfg(provider)
    if not c:
        return None
    state = secrets.token_urlsafe(18)
    with OAUTH_LOCK:
        OAUTH_STATE[state] = {"provider": provider, "expires": time.time() + 600}
    redirect_uri = f"{OAUTH_CALLBACK_BASE}/api/auth/oauth/{provider}/callback"
    if provider == "google":
        return "https://accounts.google.com/o/oauth2/v2/auth?" + urlencode({
            "client_id": c["client_id"], "redirect_uri": redirect_uri,
            "response_type": "code", "scope": "openid email profile",
            "state": state, "prompt": "select_account",
        })
    return "https://github.com/login/oauth/authorize?" + urlencode({
        "client_id": c["client_id"], "redirect_uri": redirect_uri,
        "scope": "read:user user:email", "state": state,
    })

def http_post_json(url, data, headers=None):
    req = urllib.request.Request(url, data=json.dumps(data).encode("utf-8"),
        headers={"Content-Type": "application/json", "Accept": "application/json", **(headers or {})})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))

def http_post_form(url, data, headers=None):
    req = urllib.request.Request(url, data=urlencode(data).encode("utf-8"),
        headers={"Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json", **(headers or {})})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))

def http_get_json(url, headers=None):
    req = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": "NovaCompute/1.0", **(headers or {})})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))

def oauth_profile(provider, code):
    c = oauth_cfg(provider)
    if not c:
        raise ValueError(f"{provider} OAuth is not configured.")
    redirect_uri = f"{OAUTH_CALLBACK_BASE}/api/auth/oauth/{provider}/callback"
    if provider == "google":
        tok = http_post_form("https://oauth2.googleapis.com/token", {
            "code": code, "client_id": c["client_id"], "client_secret": c["client_secret"],
            "redirect_uri": redirect_uri, "grant_type": "authorization_code",
        })
        info = http_get_json("https://openidconnect.googleapis.com/v1/userinfo",
                             {"Authorization": "Bearer " + tok["access_token"]})
        if not info.get("email_verified", True):
            raise ValueError("Your Google email is not verified.")
        return info.get("email"), info.get("name") or info.get("email")
    tok = http_post_json("https://github.com/login/oauth/access_token", {
        "code": code, "client_id": c["client_id"], "client_secret": c["client_secret"],
        "redirect_uri": redirect_uri,
    })
    access = tok.get("access_token")
    if not access:
        raise ValueError("GitHub did not return an access token.")
    info = http_get_json("https://api.github.com/user", {"Authorization": "Bearer " + access})
    emails = http_get_json("https://api.github.com/user/emails", {"Authorization": "Bearer " + access})
    verified = [e for e in emails if e.get("verified")]
    primary = next((e for e in verified if e.get("primary")), verified[0] if verified else None)
    if not primary:
        raise ValueError("Your GitHub account has no verified email.")
    return primary["email"], info.get("name") or info.get("login")

def oauth_session_token(provider, query):
    state = (query.get("state") or [""])[0]
    with OAUTH_LOCK:
        entry = OAUTH_STATE.pop(state, None)
    if not entry or entry.get("provider") != provider or time.time() > entry.get("expires", 0):
        raise ValueError("OAuth state is invalid or expired. Try again.")
    code = (query.get("code") or [""])[0]
    if not code:
        raise ValueError("OAuth provider returned no code.")
    email, name = oauth_profile(provider, code)
    if not email:
        raise ValueError("Could not read your email from the provider.")
    email = email.strip().lower()
    with DB_LOCK:
        db = load_users()
        user = find_user_by_email(db, email)
        if not user:
            salt, digest = hash_password(secrets.token_urlsafe(24))
            user = {
                "id": "usr_" + secrets.token_hex(8), "name": name or email.split("@")[0],
                "email": email, "company": "", "password_salt": salt, "password_hash": digest,
                "created_at": iso(now_utc()), "balance": 0.0,
                "api_keys": [{"id": "key_" + secrets.token_hex(6), "name": "Default",
                              "key": new_api_key(), "created_at": iso(now_utc()),
                              "last_used": None, "status": "active"}],
                "usage": [], "transactions": [], "verified": True, "provider": provider, "plan": "free",
            }
            db["users"].append(user)
        else:
            user["verified"] = True
            user.setdefault("provider", provider)
            if not user.get("api_keys"):
                user["api_keys"] = [{"id": "key_" + secrets.token_hex(6), "name": "Default",
                                     "key": new_api_key(), "created_at": iso(now_utc()),
                                     "last_used": None, "status": "active"}]
        token = secrets.token_urlsafe(32)
        db["oauth_sessions"][token] = {"user_id": user["id"], "expires": time.time() + 600}
        save_users(db)
    return token

# ================= PAYMENTS (PayPal + bank webhook) =================
PAYPAL_TOKEN_CACHE = {"value": None, "expires": 0}
PAYPAL_TOKEN_LOCK = threading.Lock()
FX_CACHE = {"rate": 0.0, "ts": 0.0}

def usd_vnd_rate():
    """Live USD→VND rate, cached for one hour. No invented exchange rate."""
    now = time.time()
    if FX_CACHE["rate"] and now - FX_CACHE["ts"] < 3600:
        return FX_CACHE["rate"]
    try:
        req = urllib.request.Request("https://open.er-api.com/v6/latest/USD",
                                     headers={"Accept": "application/json", "User-Agent": "NovaCompute/1.0"})
        with urllib.request.urlopen(req, timeout=8) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        rate = float((data.get("rates") or {}).get("VND") or 0)
        if rate > 0:
            FX_CACHE["rate"] = rate
            FX_CACHE["ts"] = now
    except Exception as exc:
        print(f"[fx] USD/VND lookup failed: {exc}")
    return FX_CACHE["rate"]

def paypal_cfg():
    return load_json_cfg(PAYPAL_CONFIG_FILE) or {}

def paypal_base():
    return "https://api-m.paypal.com" if (paypal_cfg().get("mode") or "live") == "live" else "https://api-m.sandbox.paypal.com"

def paypal_token():
    cfg = paypal_cfg()
    if not cfg.get("client_id") or not cfg.get("secret"):
        raise ValueError("PayPal is not configured.")
    with PAYPAL_TOKEN_LOCK:
        if PAYPAL_TOKEN_CACHE["value"] and time.time() < PAYPAL_TOKEN_CACHE["expires"]:
            return PAYPAL_TOKEN_CACHE["value"]
        import base64
        auth = base64.b64encode(f"{cfg['client_id']}:{cfg['secret']}".encode()).decode()
        req = urllib.request.Request(
            paypal_base() + "/v1/oauth2/token",
            data=b"grant_type=client_credentials",
            headers={"Authorization": "Basic " + auth, "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=25) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        PAYPAL_TOKEN_CACHE["value"] = data["access_token"]
        PAYPAL_TOKEN_CACHE["expires"] = time.time() + int(data.get("expires_in", 3000)) - 60
        return PAYPAL_TOKEN_CACHE["value"]

def paypal_request(method, path, payload=None):
    token = paypal_token()
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(
        paypal_base() + path, data=data, method=method,
        headers={"Authorization": "Bearer " + token, "Content-Type": "application/json", "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=35) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")[:400]
        raise ValueError(f"PayPal HTTP {exc.code}: {detail}")

def payment_risk(user, amount):
    """Cheap velocity/age checks for card-testing and multi-account abuse."""
    now_ts = time.time()
    created = None
    try:
        created = datetime.fromisoformat(str(user.get("created_at", "")).replace("Z", "+00:00"))
    except ValueError:
        pass
    age_min = ((now_utc() - created).total_seconds() / 60) if created else 99999
    if age_min < 10 and amount > 20:
        return "New accounts can top up up to $20 during the first 10 minutes."
    recent = [t for t in user.get("transactions", [])
              if t.get("type") in ("topup", "subscription") and now_ts - t.get("ts", 0) < 600]
    if len(recent) >= 3:
        return "Too many payment attempts. Wait a few minutes and try again."
    day_total = sum(float(t.get("amount", 0)) for t in user.get("transactions", [])
                    if t.get("type") in ("topup", "subscription") and now_ts - t.get("ts", 0) < 86400)
    if age_min < 7 * 1440 and day_total + amount > 100:
        return "New accounts are limited to $100 of payments per day."
    return None

def paypal_create_order(user, purpose, amount, plan=None):
    if purpose == "sub":
        plan_def = PLANS.get(str(plan))
        if not plan_def:
            raise ValueError("Unknown plan.")
        amount = float(plan_def["price"])
        description = f"NovaCompute {plan_def['name']} - 30 days"
    elif purpose == "topup":
        amount = round(float(amount), 2)
        if not 1 <= amount <= 1000:
            raise ValueError("Top-up must be between $1 and $1000.")
        description = "NovaCompute account credit"
    else:
        raise ValueError("Unknown payment purpose.")

    risk = payment_risk(user, amount)
    if risk:
        raise ValueError(risk)
    order = paypal_request("POST", "/v2/checkout/orders", {
        "intent": "CAPTURE",
        "purchase_units": [{
            "description": description,
            "custom_id": f"{user['id']}|{purpose}|{plan or ''}",
            "amount": {"currency_code": "USD", "value": f"{amount:.2f}"},
        }],
        "application_context": {
            "brand_name": "NovaCompute",
            "shipping_preference": "NO_SHIPPING",
            "user_action": "PAY_NOW",
            "return_url": SITE_URL + "/dashboard.html?paypal=return",
            "cancel_url": SITE_URL + "/dashboard.html?paypal=cancel",
        },
    })
    order_id = order.get("id")
    if not order_id:
        raise ValueError("PayPal did not return an order id.")
    with DB_LOCK:
        db = load_users()
        db["paypal_orders"][order_id] = {
            "user_id": user["id"], "purpose": purpose, "amount": amount,
            "plan": plan, "status": "created", "ts": int(time.time()),
        }
        save_users(db)
    approve = next((l.get("href") for l in order.get("links", []) if l.get("rel") == "approve"), None)
    return {"id": order_id, "approve_url": approve, "amount": amount}

def apply_payment(user, purpose, amount, plan, method, reference):
    now_ts = int(time.time())
    if purpose == "topup":
        user["balance"] = round(user.get("balance", 0.0) + float(amount), 6)
        user.setdefault("transactions", []).append({
            "ts": now_ts, "type": "topup", "description": "Balance top-up",
            "method": method, "amount": round(float(amount), 2), "reference": reference,
        })
    elif purpose == "sub":
        plan_def = PLANS.get(str(plan))
        if not plan_def:
            raise ValueError("Unknown plan.")
        user["plan"] = plan
        user["plan_started"] = iso(now_utc())
        user["plan_expires"] = iso(now_utc() + timedelta(days=30))
        user.setdefault("transactions", []).append({
            "ts": now_ts, "type": "subscription", "description": f"{plan_def['name']} - 30 days",
            "method": method, "amount": round(float(amount), 2), "reference": reference,
        })
        bonus = float(plan_def.get("bonus", 0) or 0)
        if bonus > 0:
            user["balance"] = round(user.get("balance", 0.0) + bonus, 6)
            user["transactions"].append({
                "ts": now_ts + 1, "type": "bonus", "description": f"{plan_def['name']} bonus credit",
                "method": "Subscription bonus", "amount": bonus, "reference": reference,
            })
    else:
        raise ValueError("Unknown payment purpose.")
    user["transactions"] = user.get("transactions", [])[-200:]
    return user

def paypal_capture_order(user, order_id):
    with DB_LOCK:
        db = load_users()
        meta = db["paypal_orders"].get(order_id)
    if not meta or meta.get("user_id") != user["id"]:
        raise ValueError("Payment order not found for this account.")
    if meta.get("status") == "captured":
        return {"status": "already_captured", "balance": user.get("balance", 0.0), "plan": user.get("plan", "free")}

    # Check the payer before charging: one PayPal identity cannot fund multiple accounts.
    details = paypal_request("GET", f"/v2/checkout/orders/{order_id}")
    payer_id = (details.get("payer") or {}).get("payer_id", "")
    if payer_id:
        with DB_LOCK:
            linked = load_users().get("paypal_payers", {}).get(payer_id)
        if linked and linked != user["id"]:
            raise ValueError("This PayPal account is already linked to another NovaCompute account.")

    result = paypal_request("POST", f"/v2/checkout/orders/{order_id}/capture", {})
    if str(result.get("status", "")).upper() != "COMPLETED":
        raise ValueError("PayPal payment was not completed.")
    unit = (result.get("purchase_units") or [{}])[0]
    capture = ((unit.get("payments") or {}).get("captures") or [{}])[0]
    paid = float((capture.get("amount") or {}).get("value", 0))
    if abs(paid - float(meta["amount"])) > 0.011:
        raise ValueError("Paid amount does not match the order.")

    with DB_LOCK:
        db = load_users()
        target = next((u for u in db["users"] if u.get("id") == user["id"]), None)
        if not target:
            raise ValueError("Account not found.")
        meta = db["paypal_orders"].get(order_id) or meta
        if meta.get("status") == "captured":
            return {"status": "already_captured", "balance": target.get("balance", 0.0), "plan": target.get("plan", "free")}
        payer_id = (result.get("payer") or {}).get("payer_id", "") or payer_id
        linked = db.get("paypal_payers", {}).get(payer_id) if payer_id else None
        if linked and linked != target["id"]:
            meta["status"] = "review"
            meta["payer_id"] = payer_id
            db["paypal_orders"][order_id] = meta
            save_users(db)
            raise ValueError("Payment captured but held for review: this PayPal account is linked to another NovaCompute account.")
        apply_payment(target, meta["purpose"], meta["amount"], meta.get("plan"), "PayPal", order_id)
        meta["status"] = "captured"
        meta["captured_at"] = int(time.time())
        meta["payer_id"] = payer_id
        if payer_id:
            db["paypal_payers"][payer_id] = target["id"]
        db["paypal_orders"][order_id] = meta
        save_users(db)
    return {"status": "completed", "balance": target.get("balance", 0.0), "plan": target.get("plan", "free"), "plan_expires": target.get("plan_expires")}

def message_text(message):
    content = message.get("content") if isinstance(message, dict) else ""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return " ".join(str(p.get("text", "")) for p in content if isinstance(p, dict) and p.get("type") == "text")
    return ""

def detect_reply_language(messages, accept_language=""):
    """Cheap language detection: strong script signals + word lists + client locale."""
    latest = ""
    for message in reversed(messages):
        if isinstance(message, dict) and message.get("role") == "user":
            latest = message_text(message).strip()
            if latest: break
    if not latest: return None
    text = latest.lower()
    scores = {"Vietnamese": 0, "English": 0, "Spanish": 0, "French": 0, "Indonesian": 0, "German": 0}
    if re.search(r"[ăâđêôơư]", text): scores["Vietnamese"] += 4
    if re.search(r"[¿¡ñ]", text): scores["Spanish"] += 4
    words = {
        "Vietnamese": ["chào", "bạn", "tôi", "mình", "cảm ơn", "không", "được", "giúp", "như thế nào", "là gì", "tiếng việt", "ở đâu", "với", "cho tôi"],
        "English": ["the", "is", "are", "what", "where", "when", "why", "how", "who", "you", "your", "please", "hello", "hi", "thanks", "from", "this", "that", "can", "does"],
        "Spanish": ["hola", "qué", "como", "cómo", "dónde", "gracias", "puedo", "ayudarte", "eres", "por favor", "estás"],
        "French": ["bonjour", "comment", "pourquoi", "merci", "vous", "je", "où", "avec", "être"],
        "Indonesian": ["apa", "yang", "saya", "bisa", "dengan", "kabar", "terima kasih", "dari", "halo"],
        "German": ["hallo", "wie", "was", "warum", "danke", "ich", "sie", "mit"],
    }
    for language, tokens in words.items():
        for token in tokens:
            if re.search(r"(?<!\w)" + re.escape(token) + r"(?!\w)", text):
                scores[language] += 1
    best = max(scores, key=scores.get)
    if scores[best] >= 2:
        return best
    if scores[best] == 1 and len(text) <= 16:
        return best
    locale = (accept_language or "").split(",")[0].split("-")[0].strip().lower()
    fallback = {"vi": "Vietnamese", "en": "English", "es": "Spanish", "fr": "French", "id": "Indonesian", "de": "German"}
    if locale in fallback and len(text) <= 12:
        return fallback[locale]
    return None

def record_usage(user_id, key_id, model_id, prompt_tokens, completion_tokens, latency_ms, status="ok", cost=0.0, client=""):
    with DB_LOCK:
        db = load_users()
        for user in db["users"]:
            if user.get("id") != user_id: continue
            event = {"ts": int(time.time()), "model": model_id, "key_id": key_id, "prompt_tokens": int(prompt_tokens), "completion_tokens": int(completion_tokens), "latency_ms": int(latency_ms), "status": status, "cost": round(float(cost), 6), "client": client}
            user.setdefault("usage", []).append(event)
            user["usage"] = user["usage"][-800:]
            if cost:
                user["balance"] = round(max(0.0, user.get("balance", 0.0) - cost), 6)
                user.setdefault("transactions", []).append({"ts": event["ts"], "type": "usage", "description": f"API usage — {model_id}", "method": "Balance", "amount": -round(float(cost), 6)})
                user["transactions"] = user["transactions"][-200:]
            for key in user.get("api_keys", []):
                if key.get("id") == key_id: key["last_used"] = iso(now_utc())
            save_users(db)
            return

def usage_aggregates(user):
    days = 14
    today = now_utc().date()
    by_day = {}
    for offset in range(days - 1, -1, -1): by_day[(today - timedelta(days=offset))] = {"tokens": 0, "requests": 0}
    usage = user.get("usage", [])
    for event in usage:
        try: day = datetime.fromtimestamp(event["ts"], timezone.utc).date()
        except (KeyError, ValueError, OSError): continue
        if day in by_day:
            by_day[day]["tokens"] += event.get("prompt_tokens", 0) + event.get("completion_tokens", 0)
            by_day[day]["requests"] += 1
    daily = [{"date": day.strftime("%b %d"), "tokens": vals["tokens"], "requests": vals["requests"]} for day, vals in sorted(by_day.items())]
    today_stats = by_day.get(today, {"tokens": 0, "requests": 0})
    yesterday_stats = by_day.get(today - timedelta(days=1), {"tokens": 0, "requests": 0})
    def pct(current, previous):
        if previous <= 0: return None
        return round((current - previous) / previous * 100, 1)
    per_model = {}
    cutoff = time.time() - 30 * 86400
    for event in usage:
        if event.get("ts", 0) < cutoff: continue
        entry = per_model.setdefault(event["model"], {"requests": 0, "tokens": 0})
        entry["requests"] += 1
        entry["tokens"] += event.get("prompt_tokens", 0) + event.get("completion_tokens", 0)
    by_model = [{"id": model_id, **vals} for model_id, vals in sorted(per_model.items(), key=lambda kv: -kv[1]["tokens"])]
    recent = []
    for event in sorted(usage, key=lambda e: e.get("ts", 0), reverse=True)[:8]:
        recent.append({"ts": event.get("ts"), "model": event.get("model"), "tokens": event.get("prompt_tokens", 0) + event.get("completion_tokens", 0), "latency_ms": event.get("latency_ms"), "status": event.get("status", "ok")})
    latencies = [e.get("latency_ms", 0) for e in usage if e.get("latency_ms") and e.get("status") == "ok"][-50:]
    avg_latency = round(sum(latencies) / len(latencies)) if latencies else 0
    return {"daily": daily, "by_model": by_model, "recent": recent, "stats": {"requests_today": today_stats["requests"], "tokens_today": today_stats["tokens"], "requests_delta_pct": pct(today_stats["requests"], yesterday_stats["requests"]), "tokens_delta_pct": pct(today_stats["tokens"], yesterday_stats["tokens"]), "avg_latency_ms": avg_latency, "total_requests": len(usage)}}

def transactions(user, limit=10):
    rows = sorted(user.get("transactions", []), key=lambda t: t.get("ts", 0), reverse=True)[:limit]
    return [{"ts": row.get("ts"), "type": row.get("type", "usage"), "description": row.get("description", ""), "method": row.get("method", ""), "amount": row.get("amount", 0)} for row in rows]

def load_keys_from_file(filepath, fallback_key=None):
    keys = []
    if os.path.exists(filepath):
        try:
            with open(filepath, "r", encoding="utf-8") as f:
                data = json.load(f)
                for item in data:
                    if isinstance(item, dict) and "api_key" in item: keys.append(item["api_key"])
                    elif isinstance(item, str): keys.append(item)
        except Exception as e: print(f"Error loading keys from {filepath}: {e}")
    if not keys and fallback_key:
        keys.append(fallback_key)
    return keys

def json_bytes(obj): return json.dumps(obj, ensure_ascii=False).encode("utf-8")

class NovaHandler(BaseHTTPRequestHandler):
    server_version = "NovaCompute/1.0"
    protocol_version = "HTTP/1.0"

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Nova-Client, X-Nova-Device, Accept")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
        self.send_header("Access-Control-Max-Age", "86400")
        for name, value in getattr(self, "_rate_headers", {}).items():
            self.send_header(name, value)
        super().end_headers()

    def log_message(self, fmt, *args):
        stamp = datetime.now().strftime("%H:%M:%S")
        print(f"[{stamp}] {self.client_address[0]} {fmt % args}", flush=True)

    def send_json(self, status, payload):
        body = json_bytes(payload)
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def send_error_json(self, status, err_type, code, message):
        self.send_json(status, error_payload(err_type, code, message))

    def read_json_body(self):
        try: length = int(self.headers.get("Content-Length", "0") or "0")
        except ValueError: length = 0
        if length <= 0: return None
        raw = self.rfile.read(length)
        try: return json.loads(raw.decode("utf-8"))
        except: return None

    def authenticate(self):
        header = self.headers.get("Authorization", "")
        if not header.lower().startswith("bearer "): return None, None, None
        token = header[7:].strip()
        if not token: return None, None, None
        db = load_users()
        user, key = find_user_by_api_key(db, token)
        if user and user.get("banned"):
            return db, None, None
        return db, user, key

    def do_OPTIONS(self):
        self.send_response(204); self.send_header("Content-Length", "0"); self.end_headers()

    def do_GET(self):
        path = urlparse(self.path).path.rstrip("/") or "/"
        refresh_models()
        if path in ("/", "/api/health"):
            total_keys = 0
            for p_name, p_info in PROVIDERS.items():
                total_keys += len(load_keys_from_file(p_info["keys_file"], p_info.get("fallback_key")))
            
            self.send_json(200, {"status": "ok", "service": "nova-backend", "keys_loaded": total_keys, "models": len(MODELS), "time": iso(now_utc())})
            return
        if path == "/v1/models":
            self.send_json(200, {"object": "list", "data": [{"id": m["id"], "object": "model", "owned_by": m["provider"], "name": m["name"], "context": m["context"], "speed_tps": m["speed"], "pricing": {"input_per_1m": m["input"], "output_per_1m": m["output"]}, "capabilities": {"image": bool(m.get("image")), "video": bool(m.get("video"))}, "category": m.get("category", "chat"), "tag": m.get("tag"), "note": m.get("note", ""), "price_unit": m.get("price_unit"), "quota_multiplier": QUOTA_MULTIPLIERS.get(m["id"], 1)} for m in MODELS]})
            return
        if path == "/api/me": self.handle_me(); return
        if path == "/api/fx": self.handle_fx(); return
        if path == "/api/admin/overview": self.handle_admin_overview(); return
        if path == "/api/admin/users": self.handle_admin_users(); return
        if path == "/api/admin/transactions": self.handle_admin_transactions(); return
        if path.startswith("/api/oauth/") and path.endswith("/start"):
            self.handle_oauth_start(path.split("/")[3]); return
        if path.startswith("/api/auth/oauth/") and path.endswith("/callback"):
            self.handle_oauth_callback(path.split("/")[4]); return
        self.send_error_json(404, "not_found", "not_found", f"No route for GET {path}")

    def do_POST(self):
        path = urlparse(self.path).path.rstrip("/") or "/"
        if path == "/v1/chat/completions": self.handle_chat_completions(); return
        if path == "/api/register": self.handle_register(); return
        if path == "/api/verify": self.handle_verify(); return
        if path == "/api/resend": self.handle_resend(); return
        if path == "/api/login": self.handle_login(); return
        if path == "/api/oauth/exchange": self.handle_oauth_exchange(); return
        if path == "/api/paypal/create-order": self.handle_paypal_create(); return
        if path == "/api/paypal/capture-order": self.handle_paypal_capture(); return
        if path == "/api/payments/bank-webhook": self.handle_bank_webhook(); return
        if path == "/api/admin/user": self.handle_admin_user_update(); return
        if path == "/api/admin/user/delete": self.handle_admin_user_delete(); return
        if path == "/api/keys": self.handle_create_key(); return
        if path == "/api/topup":
            self.send_error_json(410, "invalid_request_error", "use_checkout", "Top-up requires a verified payment. Use PayPal or a bank transfer.")
            return
        if path == "/api/profile": self.handle_profile(); return
        if path == "/v1/audio/speech": self.handle_speech(); return
        self.send_error_json(404, "not_found", "not_found", f"No route for POST {path}")

    def do_DELETE(self):
        path = urlparse(self.path).path.rstrip("/") or "/"
        if path.startswith("/api/keys/"): self.handle_delete_key(path.rsplit("/", 1)[-1]); return
        self.send_error_json(404, "not_found", "not_found", f"No route for DELETE {path}")

    def handle_oauth_start(self, provider):
        url = oauth_authorize_url(provider)
        if not url:
            return self.send_error_json(503, "configuration_error", "oauth_not_configured", f"{provider.capitalize()} login is not configured yet.")
        self.send_json(200, {"url": url})

    def handle_oauth_callback(self, provider):
        try:
            token = oauth_session_token(provider, parse_qs(urlparse(self.path).query))
            target = f"{SITE_URL}/login.html?oauth_token={token}"
        except ValueError as exc:
            target = f"{SITE_URL}/login.html?oauth_error={urlencode({'m': str(exc)})[2:]}"
        except Exception as exc:
            print(f"[oauth] {provider}: {exc}")
            target = f"{SITE_URL}/login.html?oauth_error={urlencode({'m': 'OAuth sign-in failed. Try again.'})[2:]}"
        self.send_response(302)
        self.send_header("Location", target)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def handle_oauth_exchange(self):
        body = self.read_json_body() or {}
        token = str(body.get("token", "")).strip()
        if not token: return self.send_error_json(400, "invalid_request_error", "missing_token", "OAuth token is required.")
        with DB_LOCK:
            db = load_users()
            session = db["oauth_sessions"].get(token)
            if not session or time.time() > session.get("expires", 0):
                return self.send_error_json(401, "authentication_error", "oauth_expired", "OAuth session expired. Sign in again.")
            user = next((u for u in db["users"] if u.get("id") == session.get("user_id")), None)
            if not user: return self.send_error_json(404, "not_found", "user_missing", "Account not found.")
            db["oauth_sessions"].pop(token, None); save_users(db)
            active_keys = [k for k in user.get("api_keys", []) if k.get("status", "active") == "active"]
            if not active_keys: return self.send_error_json(403, "authentication_error", "no_active_key", "This account has no active API keys.")
        self.send_json(200, {"user": {"name": user["name"], "email": user["email"], "created_at": user.get("created_at"), "is_admin": bool(user.get("is_admin"))}, "api_key": active_keys[0]["key"], "balance": round(user.get("balance", 0.0), 6)})

    def handle_paypal_create(self):
        _db, user, _key = self.authenticate()
        if not user: return self.send_error_json(401, "authentication_error", "invalid_api_key", "Sign in before paying.")
        body = self.read_json_body() or {}
        purpose = str(body.get("purpose", "sub")).strip().lower()
        try:
            result = paypal_create_order(user, purpose, body.get("amount", 0), body.get("plan"))
        except ValueError as exc:
            return self.send_error_json(400, "payment_error", "paypal_create_failed", str(exc))
        except Exception as exc:
            print(f"[paypal] create: {exc}")
            return self.send_error_json(502, "payment_error", "paypal_unavailable", "PayPal is unavailable right now.")
        self.send_json(200, result)

    def handle_paypal_capture(self):
        _db, user, _key = self.authenticate()
        if not user: return self.send_error_json(401, "authentication_error", "invalid_api_key", "Sign in before paying.")
        body = self.read_json_body() or {}
        order_id = str(body.get("order_id", "")).strip()
        if not order_id: return self.send_error_json(400, "invalid_request_error", "missing_order", "Order id is required.")
        try:
            result = paypal_capture_order(user, order_id)
        except ValueError as exc:
            return self.send_error_json(400, "payment_error", "paypal_capture_failed", str(exc))
        except Exception as exc:
            print(f"[paypal] capture: {exc}")
            return self.send_error_json(502, "payment_error", "paypal_unavailable", "PayPal is unavailable right now.")
        self.send_json(200, result)

    def handle_fx(self):
        rate = usd_vnd_rate()
        self.send_json(200, {"usd_vnd": rate, "updated_at": int(FX_CACHE["ts"]) if rate else 0})

    def handle_bank_webhook(self):
        cfg = load_json_cfg(PAYMENT_CONFIG_FILE) or {}
        secret = os.getenv("NOVA_BANK_WEBHOOK_SECRET") or cfg.get("webhook_token") or ""
        if not secret or self.headers.get("Authorization", "") != "Bearer " + secret:
            return self.send_error_json(401, "authentication_error", "invalid_webhook_token", "Invalid bank webhook token.")
        body = self.read_json_body() or {}
        events = body.get("data") if isinstance(body.get("data"), list) else [body]
        rate = usd_vnd_rate()
        if not rate:
            return self.send_error_json(503, "configuration_error", "fx_unavailable", "USD/VND rate is unavailable; retry later.")
        processed = 0
        matched = 0
        for event in events:
            if not isinstance(event, dict): continue
            txid = str(event.get("id") or event.get("referenceCode") or event.get("tid") or event.get("transactionId") or "").strip()
            try: amount_vnd = float(event.get("transferAmount") or event.get("amount") or 0)
            except (TypeError, ValueError): amount_vnd = 0
            content = str(event.get("content") or event.get("description") or "")
            if not txid or amount_vnd <= 0: continue
            with DB_LOCK:
                db = load_users()
                if txid in db["bank_txns"]: continue
                match = re.search(r"NOVA[\s\-_]+(TOPUP|STARTER|PRO|ULTRA)[\s\-_]+([^\s]+@[^\s]+)", content, re.I)
                if not match:
                    db["bank_txns"][txid] = {"ts": int(time.time()), "status": "unmatched", "amount_vnd": amount_vnd, "content": content[:200]}
                    db["bank_txns"] = dict(list(db["bank_txns"].items())[-1000:])
                    save_users(db)
                    continue
                kind = match.group(1).upper(); email = match.group(2).lower().rstrip(".,;")
                user = find_user_by_email(db, email)
                if not user:
                    db["bank_txns"][txid] = {"ts": int(time.time()), "status": "user_missing", "email": email, "amount_vnd": amount_vnd}
                    save_users(db); continue
                sender = str(event.get("accountNumber") or event.get("senderAccount") or event.get("senderAccountNumber") or "").strip()
                if sender and db.get("bank_senders", {}).get(sender) not in (None, user["id"]):
                    db["bank_txns"][txid] = {"ts": int(time.time()), "status": "sender_linked", "email": email, "sender": sender}
                    save_users(db); continue
                risk_amount = (amount_vnd / rate) if kind == "TOPUP" else float((PLANS.get(kind.lower()) or {}).get("price", 0))
                risk = payment_risk(user, risk_amount)
                if risk:
                    db["bank_txns"][txid] = {"ts": int(time.time()), "status": "risk_blocked", "email": email, "reason": risk}
                    save_users(db); continue
                if kind == "TOPUP":
                    usd = round(amount_vnd / rate, 2)
                    if usd < 1:
                        db["bank_txns"][txid] = {"ts": int(time.time()), "status": "too_small", "amount_vnd": amount_vnd}
                    else:
                        apply_payment(user, "topup", usd, None, "Bank transfer", txid)
                        if sender: db["bank_senders"][sender] = user["id"]
                        db["bank_txns"][txid] = {"ts": int(time.time()), "status": "credited", "email": email, "usd": usd, "amount_vnd": amount_vnd}
                        processed += 1; matched += 1
                else:
                    plan = kind.lower()
                    plan_def = PLANS.get(plan)
                    required_vnd = float(plan_def["price"]) * rate if plan_def else 0
                    if not plan_def or amount_vnd + 1 < required_vnd * 0.98:
                        db["bank_txns"][txid] = {"ts": int(time.time()), "status": "amount_mismatch", "plan": plan, "amount_vnd": amount_vnd, "required_vnd": round(required_vnd)}
                    else:
                        apply_payment(user, "sub", plan_def["price"], plan, "Bank transfer", txid)
                        if sender: db["bank_senders"][sender] = user["id"]
                        db["bank_txns"][txid] = {"ts": int(time.time()), "status": "activated", "email": email, "plan": plan, "amount_vnd": amount_vnd}
                        processed += 1; matched += 1
                db["bank_txns"] = dict(list(db["bank_txns"].items())[-1000:])
                save_users(db)
        self.send_json(200, {"success": True, "processed": processed, "matched": matched})

    def handle_register(self):
        body = self.read_json_body() or {}
        name = str(body.get("name", "")).strip(); email = str(body.get("email", "")).strip().lower(); password = str(body.get("password", ""))
        company = str(body.get("company", "")).strip()
        ip = client_ip(self)
        if not name or len(name) < 2: return self.send_error_json(400, "invalid_request_error", "name_required", "Please enter your full name.")
        if not EMAIL_RE.match(email): return self.send_error_json(400, "invalid_request_error", "invalid_email", "A valid email is required.")
        if "+" in email.split("@")[0]:
            return self.send_error_json(400, "invalid_request_error", "alias_not_allowed", "Plus-addressing is not allowed. Use your base email address.")
        if len(password) < 8: return self.send_error_json(400, "invalid_request_error", "weak_password", "Password must be at least 8 characters.")

        db = load_users()
        if fake_mail_blocked(db, ip):
            return self.send_error_json(429, "rate_limit_error", "email_blocked", "Too many disposable-email attempts from this network. Try again later.")
        if ip_is_banned(db, ip):
            return self.send_error_json(403, "authentication_error", "ip_banned", "This network is temporarily blocked from creating accounts.")
        hits = prune_ip(db, ip)
        per_hour = sum(1 for t in hits if time.time() - t < SIGNUP_WINDOW)
        if per_hour >= SIGNUP_LIMIT:
            if per_hour >= SIGNUP_DAILY:
                db["banned_ips"].append({"ip": ip, "until": time.time() + IP_BAN_SECONDS, "reason": "mass signup"})
                save_users(db)
                return self.send_error_json(403, "authentication_error", "ip_banned", "Too many accounts from this network. Blocked for 24 hours.")
            return self.send_error_json(429, "rate_limit_error", "signup_limit", "Too many accounts from this network. Try again later.")
        if find_user_by_email(db, email):
            return self.send_error_json(409, "invalid_request_error", "email_taken", "An account with this email already exists.")
        if family_taken(db, email):
            return self.send_error_json(409, "invalid_request_error", "email_taken", "An account with this email (or a Gmail variant) already exists.")
        ok, why = mail_allowed(email)
        if not ok:
            fake_mail_hit(self)
            return self.send_error_json(400, "invalid_request_error", "disposable_email", why)
        if not domain_has_mx(email.rsplit("@", 1)[-1]):
            fake_mail_hit(self)
            return self.send_error_json(400, "invalid_request_error", "no_mail_server", "This email domain cannot receive mail. Use a real mailbox.")

        code = f"{secrets.randbelow(1000000):06d}"
        sent = send_code_email(email, code)
        if not sent and not dev_mail_allowed(self):
            return self.send_error_json(503, "configuration_error", "mail_not_configured", "Email delivery is not configured. Use Google or GitHub sign-in, or contact support.")
        if not sent:
            print(f"[MAIL NOT CONFIGURED] verification code for {email}: {code}")
        now_ts = time.time()
        salt, digest = hash_password(password)
        code_salt, code_digest = hash_password(code)
        with DB_LOCK:
            db = load_users()
            db["pending"][email] = {
                "code_salt": code_salt, "code_hash": code_digest, "name": name, "company": company,
                "password_salt": salt, "password_hash": digest, "expires": now_ts + CODE_TTL,
                "attempts": 0, "ip": ip, "sent": sent, "ts": now_ts, "last_sent": now_ts,
            }
            hits = prune_ip(db, ip); hits.append(now_ts); db["ip_signups"][ip] = hits
            save_users(db)
        self.send_json(200, {"pending": True, "email": email, "sent": sent, "dev_code": code if not sent else None})

    def handle_verify(self):
        body = self.read_json_body() or {}
        email = str(body.get("email", "")).strip().lower(); code = str(body.get("code", "")).strip()
        if not email or not code: return self.send_error_json(400, "invalid_request_error", "missing_fields", "Email and code are required.")
        with DB_LOCK:
            db = load_users()
            pending = db["pending"].get(email)
            if not pending: return self.send_error_json(400, "invalid_request_error", "no_pending", "No pending verification for this email. Sign up again.")
            if time.time() > pending.get("expires", 0):
                db["pending"].pop(email, None); save_users(db)
                return self.send_error_json(400, "invalid_request_error", "code_expired", "Code expired. Sign up again to get a new one.")
            if pending.get("attempts", 0) >= 6:
                db["pending"].pop(email, None); save_users(db)
                return self.send_error_json(429, "rate_limit_error", "too_many_attempts", "Too many wrong attempts. Sign up again.")
            pending["attempts"] = int(pending.get("attempts", 0)) + 1
            if not verify_password(code, pending["code_salt"], pending["code_hash"]):
                save_users(db)
                return self.send_error_json(400, "invalid_request_error", "wrong_code", "Wrong code. Check your email and try again.")
            if find_user_by_email(db, email):
                db["pending"].pop(email, None); save_users(db)
                return self.send_error_json(409, "invalid_request_error", "email_taken", "An account with this email already exists.")
            api_key = new_api_key()
            user = {
                "id": "usr_" + secrets.token_hex(8), "name": pending["name"], "email": email,
                "company": pending.get("company", ""), "password_salt": pending["password_salt"],
                "password_hash": pending["password_hash"], "created_at": iso(now_utc()), "balance": 0.0,
                "api_keys": [{"id": "key_" + secrets.token_hex(6), "name": "Default", "key": api_key,
                              "created_at": iso(now_utc()), "last_used": None, "status": "active"}],
                "usage": [], "transactions": [], "verified": True, "provider": "email", "plan": "free",
            }
            db["users"].append(user)
            db["pending"].pop(email, None)
            save_users(db)
        self.send_json(201, {"user": {"name": user["name"], "email": email, "created_at": user["created_at"]}, "api_key": api_key, "balance": 0.0})

    def handle_resend(self):
        body = self.read_json_body() or {}
        email = str(body.get("email", "")).strip().lower()
        with DB_LOCK:
            db = load_users()
            pending = db["pending"].get(email)
            if not pending: return self.send_error_json(400, "invalid_request_error", "no_pending", "No pending verification for this email.")
            if time.time() - pending.get("last_sent", 0) < 45:
                return self.send_error_json(429, "rate_limit_error", "resend_cooldown", "Please wait 45 seconds before requesting another code.")
            code = f"{secrets.randbelow(1000000):06d}"
            sent = send_code_email(email, code)
            if not sent and not dev_mail_allowed(self):
                return self.send_error_json(503, "configuration_error", "mail_not_configured", "Email delivery is not configured. Use Google or GitHub sign-in, or contact support.")
            code_salt, code_digest = hash_password(code)
            pending.update({"code_salt": code_salt, "code_hash": code_digest, "expires": time.time() + CODE_TTL,
                            "attempts": 0, "sent": sent, "last_sent": time.time()})
            save_users(db)
        self.send_json(200, {"sent": sent, "dev_code": code if not sent else None})

    def handle_login(self):
        body = self.read_json_body() or {}
        email = str(body.get("email", "")).strip().lower(); password = str(body.get("password", ""))
        if not email or not password: return self.send_error_json(400, "invalid_request_error", "missing_fields", "Email and password are required.")
        with DB_LOCK:
            db = load_users()
            fl = db["failed_logins"].get(email, {"count": 0, "lock_until": 0})
            if time.time() < fl.get("lock_until", 0):
                return self.send_error_json(429, "rate_limit_error", "login_locked", "Too many failed attempts. Try again in a few minutes.")
            user = find_user_by_email(db, email)
            if not user or not verify_password(password, user["password_salt"], user["password_hash"]):
                fl["count"] = int(fl.get("count", 0)) + 1
                if fl["count"] >= FAILED_LIMIT:
                    fl["lock_until"] = time.time() + LOCK_SECONDS; fl["count"] = 0
                db["failed_logins"][email] = fl; save_users(db)
                return self.send_error_json(401, "authentication_error", "invalid_credentials", "Incorrect email or password.")
            if user.get("banned"):
                return self.send_error_json(403, "authentication_error", "account_banned", "This account has been banned.")
            if not user.get("verified", True):
                return self.send_error_json(403, "authentication_error", "email_unverified", "Email not verified. Sign up again to receive a new code.")
            db["failed_logins"].pop(email, None); save_users(db)
            active_keys = [k for k in user.get("api_keys", []) if k.get("status", "active") == "active"]
            if not active_keys: return self.send_error_json(403, "authentication_error", "no_active_key", "This account has no active API keys.")
        self.send_json(200, {"user": {"name": user["name"], "email": user["email"], "created_at": user.get("created_at"), "is_admin": bool(user.get("is_admin"))}, "api_key": active_keys[0]["key"], "balance": round(user.get("balance", 0.0), 6)})

    def handle_me(self):
        _db, user, key = self.authenticate()
        if not user: return self.send_error_json(401, "authentication_error", "invalid_api_key", "Missing or invalid API key. Send Authorization: Bearer nova-sk-…")
        agg = usage_aggregates(user)
        active_plan = plan_active(user)
        plan = user.get("plan") if active_plan else "free"
        self.send_json(200, {"user": {"name": user.get("name"), "email": user.get("email"), "company": user.get("company", ""), "created_at": user.get("created_at"), "verified": user.get("verified", True), "provider": user.get("provider", "email"), "is_admin": bool(user.get("is_admin"))}, "balance": round(user.get("balance", 0.0), 6), "plan": plan, "plan_name": PLANS.get(plan, {}).get("name", "Pay-as-you-go"), "plan_expires": user.get("plan_expires") if active_plan else None, "daily_quota": PLAN_QUOTA.get(plan, 0), "plan_bonus": PLANS.get(plan, {}).get("bonus", 0), "daily_tts": PLANS.get(plan, {}).get("tts", 0), "quota_used_today": plan_tokens_used_today(user) if active_plan else 0, "api_keys": [public_key(k) for k in user.get("api_keys", []) if k.get("status", "active") == "active"], "request_key_id": key["id"], "stats": agg["stats"], "daily": agg["daily"], "by_model": agg["by_model"], "recent": agg["recent"], "transactions": transactions(user)})

    def require_admin(self):
        _db, user, _key = self.authenticate()
        if not user or not user.get("is_admin"):
            self.send_error_json(403, "authentication_error", "admin_required", "Admin access required.")
            return None
        return user

    def handle_admin_overview(self):
        if not self.require_admin(): return
        db = load_users()
        users = db["users"]
        today = now_utc().date()
        requests_today = 0
        tokens_today = 0
        for user in users:
            for event in user.get("usage", []):
                try:
                    if datetime.fromtimestamp(event["ts"], timezone.utc).date() != today: continue
                except (KeyError, ValueError, OSError):
                    continue
                requests_today += 1
                tokens_today += int(event.get("prompt_tokens", 0)) + int(event.get("completion_tokens", 0))
        revenue = 0.0
        for user in users:
            for tx in user.get("transactions", []):
                if tx.get("type") in ("topup", "subscription"):
                    revenue += float(tx.get("amount", 0) or 0)
        keys_loaded = sum(len(load_keys_from_file(p["keys_file"], p.get("fallback_key"))) for p in PROVIDERS.values())
        self.send_json(200, {
            "users": len(users),
            "active_plans": sum(1 for u in users if plan_active(u)),
            "total_balance": round(sum(float(u.get("balance", 0) or 0) for u in users), 2),
            "revenue": round(revenue, 2),
            "requests_today": requests_today,
            "tokens_today": tokens_today,
            "provider_keys": keys_loaded,
            "models": len(MODELS),
        })

    def handle_admin_users(self):
        if not self.require_admin(): return
        db = load_users()
        rows = []
        for user in db["users"]:
            usage = user.get("usage", [])
            tokens = sum(int(e.get("prompt_tokens", 0)) + int(e.get("completion_tokens", 0)) for e in usage)
            last = max((e.get("ts", 0) for e in usage), default=0)
            rows.append({
                "email": user.get("email"),
                "name": user.get("name", ""),
                "plan": user.get("plan", "free") if plan_active(user) else "free",
                "plan_expires": user.get("plan_expires") if plan_active(user) else None,
                "balance": round(float(user.get("balance", 0) or 0), 2),
                "requests": len(usage),
                "tokens": tokens,
                "last_used": last,
                "is_admin": bool(user.get("is_admin")),
                "banned": bool(user.get("banned")),
                "created_at": user.get("created_at"),
            })
        rows.sort(key=lambda r: r.get("created_at") or "", reverse=True)
        self.send_json(200, {"users": rows})

    def handle_admin_transactions(self):
        if not self.require_admin(): return
        db = load_users()
        rows = []
        for user in db["users"]:
            for tx in user.get("transactions", []):
                rows.append({
                    "email": user.get("email"),
                    "ts": tx.get("ts", 0),
                    "type": tx.get("type", "usage"),
                    "description": tx.get("description", ""),
                    "method": tx.get("method", ""),
                    "amount": tx.get("amount", 0),
                })
        rows.sort(key=lambda r: r.get("ts", 0), reverse=True)
        self.send_json(200, {"transactions": rows[:100]})

    def handle_admin_user_update(self):
        if not self.require_admin(): return
        body = self.read_json_body() or {}
        email = str(body.get("email", "")).strip().lower()
        with DB_LOCK:
            db = load_users()
            target = find_user_by_email(db, email)
            if not target: return self.send_error_json(404, "not_found", "user_missing", "Account not found.")
            if "plan" in body:
                plan = str(body.get("plan", "free")).lower()
                if plan not in ("free", *PLANS.keys()):
                    return self.send_error_json(400, "invalid_request_error", "invalid_plan", "Unknown plan.")
                target["plan"] = plan
                if plan == "free":
                    target.pop("plan_expires", None); target.pop("plan_started", None)
                else:
                    target["plan_started"] = iso(now_utc())
                    target["plan_expires"] = iso(now_utc() + timedelta(days=30))
            if "balance_delta" in body:
                try: delta = round(float(body.get("balance_delta", 0)), 2)
                except (TypeError, ValueError): delta = 0
                if delta:
                    target["balance"] = round(max(0.0, float(target.get("balance", 0)) + delta), 6)
                    target.setdefault("transactions", []).append({
                        "ts": int(time.time()), "type": "admin_adjustment", "description": "Admin balance adjustment",
                        "method": "Admin", "amount": delta,
                    })
                    target["transactions"] = target["transactions"][-200:]
            if "is_admin" in body:
                target["is_admin"] = bool(body.get("is_admin"))
            if "banned" in body:
                target["banned"] = bool(body.get("banned"))
            save_users(db)
        self.send_json(200, {"ok": True, "email": email, "plan": target.get("plan", "free"), "balance": round(float(target.get("balance", 0)), 2), "is_admin": bool(target.get("is_admin"))})

    def handle_admin_user_delete(self):
        admin = self.require_admin()
        if not admin: return
        body = self.read_json_body() or {}
        email = str(body.get("email", "")).strip().lower()
        if not email: return self.send_error_json(400, "invalid_request_error", "missing_email", "Email is required.")
        if email == str(admin.get("email", "")).lower():
            return self.send_error_json(400, "invalid_request_error", "cannot_delete_self", "You cannot delete the admin account you are signed in with.")
        with DB_LOCK:
            db = load_users()
            target = find_user_by_email(db, email)
            if not target: return self.send_error_json(404, "not_found", "user_missing", "Account not found.")
            if target.get("is_admin") and sum(1 for u in db["users"] if u.get("is_admin")) <= 1:
                return self.send_error_json(400, "invalid_request_error", "last_admin", "Cannot delete the last admin account.")
            db["users"] = [u for u in db["users"] if str(u.get("email", "")).lower() != email]
            save_users(db)
        self.send_json(200, {"ok": True, "deleted": email})

    def handle_create_key(self):
        _db, user, _key = self.authenticate()
        if not user: return self.send_error_json(401, "authentication_error", "invalid_api_key", "Not authenticated.")
        body = self.read_json_body() or {}; name = str(body.get("name", "")).strip() or "Untitled key"; name = name[:60]
        with DB_LOCK:
            db = load_users(); target = next((u for u in db["users"] if u["id"] == user["id"]), None)
            if not target: return self.send_error_json(404, "not_found", "user_missing", "Account not found.")
            entry = {"id": "key_" + secrets.token_hex(6), "name": name, "key": new_api_key(), "created_at": iso(now_utc()), "last_used": None, "status": "active"}
            target.setdefault("api_keys", []).append(entry); save_users(db)
        self.send_json(201, {"key": public_key(entry), "keys": [public_key(k) for k in target["api_keys"] if k.get("status", "active") == "active"]})

    def handle_delete_key(self, key_id):
        _db, user, auth_key = self.authenticate()
        if not user: return self.send_error_json(401, "authentication_error", "invalid_api_key", "Not authenticated.")
        with DB_LOCK:
            db = load_users(); target = next((u for u in db["users"] if u["id"] == user["id"]), None)
            if not target: return self.send_error_json(404, "not_found", "user_missing", "Account not found.")
            active = [k for k in target.get("api_keys", []) if k.get("status", "active") == "active"]
            if len(active) <= 1: return self.send_error_json(409, "invalid_request_error", "last_key", "Keep at least one active API key.")
            doomed = next((k for k in active if k["id"] == key_id), None)
            if not doomed: return self.send_error_json(404, "not_found", "key_missing", "API key not found.")
            target["api_keys"] = [k for k in target["api_keys"] if k["id"] != key_id]; save_users(db)
        remaining = active_after = [k for k in target["api_keys"] if k.get("status", "active") == "active"]
        self.send_json(200, {"deleted": key_id, "deleted_current_key": key_id == auth_key["id"], "keys": [public_key(k) for k in remaining], "auth_key": remaining[0]["key"] if key_id == auth_key["id"] else auth_key["key"]})

    def handle_topup(self):
        return self.send_error_json(410, "invalid_request_error", "use_checkout", "Top-up requires a verified payment. Use PayPal or a bank transfer.")

    def handle_profile(self):
        _db, user, _key = self.authenticate()
        if not user: return self.send_error_json(401, "authentication_error", "invalid_api_key", "Not authenticated.")
        body = self.read_json_body() or {}; name = str(body.get("name", "")).strip(); company = str(body.get("company", "")).strip()
        if not name: return self.send_error_json(400, "invalid_request_error", "name_required", "Name is required.")
        with DB_LOCK:
            db = load_users(); target = next((u for u in db["users"] if u["id"] == user["id"]), None)
            if not target: return self.send_error_json(404, "not_found", "user_missing", "Account not found.")
            target["name"] = name[:80]; target["company"] = company[:80]; save_users(db)
        self.send_json(200, {"user": {"name": name, "company": company, "email": user["email"]}})


    def playground_limit_reached(self, user, limit):
        today = now_utc().date()
        used = 0
        for event in user.get("usage", []):
            if event.get("client") != "playground":
                continue
            try:
                if datetime.fromtimestamp(event["ts"], timezone.utc).date() == today:
                    used += 1
            except (KeyError, ValueError, OSError):
                continue
        return used >= limit

    def enforce_rate_limit(self, user, key):
        ok, limits, retry, reason = check_request_rate(user, key)
        self._rate_headers = {
            "X-RateLimit-Limit-Requests": str(limits["rpm"]),
            "X-RateLimit-Limit-Daily": str(limits["daily"]),
        }
        if ok:
            return True
        if retry:
            self._rate_headers["Retry-After"] = str(retry)
        message = (f"Rate limit reached: {limits['rpm']} requests per minute." if reason == "rpm"
                   else f"Daily request limit reached: {limits['daily']} requests per day.")
        self.send_error_json(429, "rate_limit_error", "rate_limit_exceeded", message)
        return False

    # ================= TTS (NagaAI /v1/audio/speech) =================
    def handle_speech(self):
        refresh_models()
        _db, user, key = self.authenticate()
        if not user:
            return self.send_error_json(401, "authentication_error", "invalid_api_key", "Missing or invalid API key.")
        if not self.enforce_rate_limit(user, key): return
        body = self.read_json_body()
        if body is None:
            return self.send_error_json(400, "invalid_request_error", "invalid_json", "Request body must be valid JSON.")
        model = str(body.get("model", "")).strip()
        entry = MODEL_LOOKUP.get(model)
        if not entry or entry.get("category") != "tts":
            return self.send_error_json(400, "invalid_request_error", "invalid_model", "'" + model + "' is not a TTS model.")
        text = str(body.get("input", "") or "")
        if not text:
            return self.send_error_json(400, "invalid_request_error", "invalid_input", "'input' text is required.")
        client = self.headers.get("X-Nova-Client", "").strip().lower()
        if client == "playground":
            limit = int(os.getenv("NOVA_PLAYGROUND_LIMIT", "5"))
            if self.playground_limit_reached(user, limit):
                return self.send_error_json(429, "rate_limit_error", "try_limit_reached",
                                            f"Try limit reached ({limit}/day). Use your API key for production traffic.")
        price_per_1k = float(entry.get("output", 0) or 0)
        cost = round(len(text) / 1000.0 * price_per_1k, 6)
        active_plan = plan_active(user)
        if cost > 0 and user.get("is_admin"):
            cost = 0.0
        elif cost > 0 and active_plan:
            tts_limit = int(PLANS.get(user.get("plan"), {}).get("tts", 0))
            if tts_limit and plan_tts_used_today(user) >= tts_limit:
                if user.get("balance", 0) <= 0:
                    return self.send_error_json(429, "rate_limit_error", "sub_tts_limit", "Daily TTS request limit reached. Top up or wait for the 00:00 UTC reset.")
            else:
                cost = 0.0
        elif cost > 0 and user.get("balance", 0) <= 0:
            return self.send_error_json(402, "insufficient_balance_error", "insufficient_balance", "Balance exhausted.")
        provider_name = MODEL_PROVIDER_MAP.get(model, DEFAULT_PROVIDER)
        provider = PROVIDERS.get(provider_name)
        if not provider:
            return self.send_error_json(500, "configuration_error", "provider_missing", "TTS provider not configured.")
        keys = load_keys_from_file(provider["keys_file"], provider.get("fallback_key"))
        if not keys:
            return self.send_error_json(503, "configuration_error", "upstream_not_configured", "No keys for provider '" + provider_name + "'.")
        speech_url = provider["url"].replace("/chat/completions", "/audio/speech")
        payload = dict(body)
        payload["model"] = entry.get("upstream_id") or model
        payload.setdefault("voice", "Kore")  # upstream yêu cầu voice (Gemini TTS)
        started = time.time()
        last_exc = None
        retryable = (400, 408, 409, 425, 429, 500, 502, 503, 504)
        for upstream_key in keys[:3]:
            for attempt in (1, 2):
                req = urllib.request.Request(
                    speech_url, data=json_bytes(payload),
                    headers={"Authorization": f"Bearer {upstream_key}", "Content-Type": "application/json",
                             "Accept": "audio/wav, audio/mpeg, application/octet-stream", "User-Agent": UPSTREAM_UA},
                    method="POST")
                try:
                    with urllib.request.urlopen(req, timeout=UPSTREAM_TIMEOUT) as resp:
                        audio = resp.read()
                        ctype = resp.headers.get("Content-Type", "audio/wav")
                    latency = int((time.time() - started) * 1000)
                    record_usage(user["id"], key["id"], model, max(1, len(text) // 4), 0, latency, status="ok", cost=cost, client=client)
                    self.send_response(200)
                    self.send_header("Content-Type", ctype)
                    self.send_header("Content-Length", str(len(audio)))
                    self.send_header("Cache-Control", "no-store")
                    self.end_headers()
                    self.wfile.write(audio)
                    return
                except urllib.error.HTTPError as exc:
                    last_exc = exc
                    if exc.code in retryable and attempt == 1:
                        print(f"[tts] HTTP {exc.code}, retrying in 1.5s...")
                        time.sleep(1.5)
                        continue
                    if exc.code in (401, 403, 429):
                        break
                    detail = ""
                    try: detail = exc.read().decode("utf-8", "replace")[:300]
                    except Exception: pass
                    return self.send_error_json(502, "upstream_error", "upstream_rejected", f"TTS upstream HTTP {exc.code}: {detail}")
                except Exception as exc:
                    last_exc = exc
                    if attempt == 1:
                        time.sleep(1.5)
                        continue
                    break
        return self.send_error_json(502, "upstream_error", "tts_failed", f"All TTS keys failed. Last error: {str(last_exc)}")

    def handle_chat_completions(self):
        refresh_models()
        _db, user, key = self.authenticate()
        if not user: return self.send_error_json(401, "authentication_error", "invalid_api_key", "Missing or invalid API key.")
        if not self.enforce_rate_limit(user, key): return
        body = self.read_json_body()
        if body is None: return self.send_error_json(400, "invalid_request_error", "invalid_json", "Request body must be valid JSON.")
        
        client = self.headers.get("X-Nova-Client", "").strip().lower()
        if client == "playground":
            limit = int(os.getenv("NOVA_PLAYGROUND_LIMIT", "5"))
            if self.playground_limit_reached(user, limit):
                return self.send_error_json(429, "rate_limit_error", "try_limit_reached",
                                            f"Try limit reached ({limit}/day). Use your API key for production traffic.")
        model = str(body.get("model", "")).strip()
        if model not in MODEL_IDS: return self.send_error_json(400, "invalid_request_error", "invalid_model", f"Unknown model '{model}'.")
        
        messages = body.get("messages")
        if not isinstance(messages, list) or not messages: return self.send_error_json(400, "invalid_request_error", "invalid_messages", "'messages' must be a non-empty array.")
        # Always mirror the language of the user's latest message.
        detected_language = detect_reply_language(messages, self.headers.get("Accept-Language", ""))
        if detected_language:
            language_rule = (f"The user's latest message is in {detected_language}. "
                             f"Always answer in {detected_language}. Never switch language unless the user asks.")
        else:
            language_rule = ("Always answer in the same language as the user's most recent message. "
                             "Detect the language from their text and never switch unless the user asks.")
        messages = [dict(m) for m in messages if isinstance(m, dict)]
        if messages and messages[0].get("role") == "system":
            base = str(messages[0].get("content") or "").rstrip()
            messages[0]["content"] = (base + "\n\n" + language_rule).strip()
        else:
            messages.insert(0, {"role": "system", "content": language_rule})
        body["messages"] = messages
        upstream_model = (MODEL_LOOKUP.get(model) or {}).get("upstream_id") or model
        
        price_in, price_out = PRICING[model]
        is_paid = (price_in or price_out) > 0
        is_admin = bool(user.get("is_admin"))
        active_plan = plan_active(user)
        plan_covered = bool(is_paid and active_plan)
        if is_paid and not is_admin:
            if plan_covered:
                quota = PLAN_QUOTA.get(user.get("plan"), 0)
                if plan_tokens_used_today(user) >= quota:
                    if user.get("balance", 0) <= 0:
                        return self.send_error_json(429, "rate_limit_error", "sub_quota_reached", "Daily subscription quota reached. Top up or wait for the 00:00 UTC reset.")
                    plan_covered = False
            elif user.get("balance", 0) <= 0:
                return self.send_error_json(402, "insufficient_balance_error", "insufficient_balance", "Balance exhausted.")
        bill_in, bill_out = (0, 0) if (plan_covered or is_admin) else (price_in, price_out)

        provider_name = MODEL_PROVIDER_MAP.get(model, DEFAULT_PROVIDER)
        provider_info = PROVIDERS.get(provider_name)
        
        if not provider_info:
            return self.send_error_json(500, "configuration_error", "provider_missing", f"Provider '{provider_name}' not configured.")
            
        url = provider_info["url"]
        upstream_keys = load_keys_from_file(provider_info["keys_file"], provider_info.get("fallback_key"))
        
        if not upstream_keys:
            return self.send_error_json(503, "configuration_error", "upstream_not_configured", f"No keys found for provider '{provider_name}'.")
        
        stream = bool(body.get("stream"))
        payload = dict(body); payload["model"] = upstream_model
        data_bytes = json_bytes(payload)
        
        started = time.time()
        upstream = None
        last_exc = None
        # Auto-retry for flaky upstreams (furry queue, transient 5xx, timeouts).
        retry_delay = float(os.getenv("NOVA_UPSTREAM_RETRY_DELAY", "1.5"))
        retry_attempts = max(1, int(os.getenv("NOVA_UPSTREAM_RETRY_ATTEMPTS", "3")))
        retry_statuses = (429, 500, 502, 503, 504)

        random.shuffle(upstream_keys)

        for upstream_key in upstream_keys[:5]:
            for attempt in range(1, retry_attempts + 1):
                request = urllib.request.Request(
                    url, data=data_bytes,
                    headers={
                        "Authorization": f"Bearer {upstream_key}",
                        "Content-Type": "application/json",
                        "Accept": "text/event-stream" if stream else "application/json",
                        "User-Agent": UPSTREAM_UA,
                    },
                    method="POST",
                )
                try:
                    upstream = urllib.request.urlopen(request, timeout=UPSTREAM_TIMEOUT)
                    break
                except urllib.error.HTTPError as exc:
                    last_exc = exc
                    if exc.code in retry_statuses and attempt < retry_attempts:
                        print(f"[{provider_name}] Key {mask_key(upstream_key)} got {exc.code} "
                              f"(attempt {attempt}/{retry_attempts}), retrying in {retry_delay}s...")
                        time.sleep(retry_delay)
                        continue
                    if exc.code in (429, 401, 403):
                        print(f"[{provider_name}] Key {mask_key(upstream_key)} failed {exc.code}, trying next...")
                        break
                    detail = ""
                    try: detail = exc.read().decode("utf-8", "replace")[:400]
                    except: pass
                    return self.send_error_json(502, "upstream_error", "upstream_rejected", f"Upstream HTTP {exc.code}: {detail}")
                except Exception as exc:
                    last_exc = exc
                    if attempt < retry_attempts:
                        print(f"[{provider_name}] Network error (attempt {attempt}/{retry_attempts}): {exc} — retrying in {retry_delay}s...")
                        time.sleep(retry_delay)
                        continue
                    print(f"[{provider_name}] Network error: {exc}")
                    break
            if upstream:
                break
                
        if not upstream:
            return self.send_error_json(502, "upstream_error", "all_keys_failed", f"All keys for {provider_name} failed. Last error: {str(last_exc)}")

        if stream: return self.relay_stream(upstream, user, key, model, bill_in, bill_out, started, client)

        try:
            raw = upstream.read(); data = json.loads(raw.decode("utf-8"))
        except (ValueError, OSError): return self.send_error_json(502, "upstream_error", "bad_upstream_response", "Upstream malformed JSON.")
        finally: upstream.close()

        latency = int((time.time() - started) * 1000); usage = data.get("usage") or {}
        prompt_tokens = int(usage.get("prompt_tokens") or 0); completion_tokens = int(usage.get("completion_tokens") or 0)
        cost = (prompt_tokens * bill_in + completion_tokens * bill_out) / 1_000_000
        record_usage(user["id"], key["id"], model, prompt_tokens, completion_tokens, latency, status="ok", cost=cost, client=client)
        self.send_json(200, data)

    def relay_stream(self, upstream, user, key, model, price_in, price_out, started, client=""):
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "close")
        self.end_headers()
        collected_chars = 0; usage = None
        try:
            while True:
                chunk = upstream.read(2048)
                if not chunk: break
                text = chunk.decode("utf-8", "replace")
                for line in text.splitlines():
                    line = line.strip()
                    if line.startswith("data:"):
                        payload = line[5:].strip()
                        if payload and payload != "[DONE]":
                            try:
                                event = json.loads(payload); usage = event.get("usage") or usage
                                delta = (event.get("choices") or [{}])[0].get("delta") or {}
                                collected_chars += len(delta.get("content") or "")
                            except: pass
                self.wfile.write(chunk); self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError): print("[stream] client disconnected early", flush=True)
        finally: upstream.close()
        latency = int((time.time() - started) * 1000)
        if usage:
            prompt_tokens = int(usage.get("prompt_tokens") or 0); completion_tokens = int(usage.get("completion_tokens") or 0)
        else:
            prompt_tokens = 0; completion_tokens = max(1, collected_chars // 4)
        cost = (prompt_tokens * price_in + completion_tokens * price_out) / 1_000_000
        record_usage(user["id"], key["id"], model, prompt_tokens, completion_tokens, latency, status="ok", cost=cost, client=client)

class OAuthCallbackHandler(BaseHTTPRequestHandler):
    """Small listener for the redirect URIs registered with Google/GitHub."""
    def do_GET(self):
        path = urlparse(self.path).path.rstrip("/")
        if path.startswith("/api/auth/oauth/") and path.endswith("/callback"):
            provider = path.split("/")[4]
            try:
                token = oauth_session_token(provider, parse_qs(urlparse(self.path).query))
                target = f"{SITE_URL}/login.html?oauth_token={token}"
            except ValueError as exc:
                target = f"{SITE_URL}/login.html?oauth_error={urlencode({'m': str(exc)})[2:]}"
            except Exception as exc:
                print(f"[oauth] {provider}: {exc}")
                target = f"{SITE_URL}/login.html?oauth_error=OAuth%20sign-in%20failed"
        else:
            target = f"{SITE_URL}/login.html?oauth_error=Unknown%20OAuth%20callback"
        self.send_response(302); self.send_header("Location", target)
        self.send_header("Content-Length", "0"); self.end_headers()

    def log_message(self, fmt, *args):
        print(f"[oauth:{self.client_address[0]}] {fmt % args}", flush=True)

def start_oauth_callback_server():
    if OAUTH_CALLBACK_PORT == PORT: return
    if not any(oauth_cfg(p) for p in ("google", "github")): return
    try:
        server = ThreadingHTTPServer(("127.0.0.1", OAUTH_CALLBACK_PORT), OAuthCallbackHandler)
    except OSError as exc:
        print(f"[oauth] callback port {OAUTH_CALLBACK_PORT} unavailable: {exc}")
        return
    threading.Thread(target=server.serve_forever, daemon=True).start()
    print(f" OAuth callback : http://127.0.0.1:{OAUTH_CALLBACK_PORT}/api/auth/oauth/<provider>/callback")

def main():
    print("=" * 62)
    print(" NovaCompute backend  ·  http://127.0.0.1:%d" % PORT)
    for p_name, p_info in PROVIDERS.items():
        keys = load_keys_from_file(p_info["keys_file"], p_info.get("fallback_key"))
        print(f" Provider : {p_name} | Keys: {len(keys)}")
    print(f" OAuth    : google={'yes' if oauth_cfg('google') else 'no'} github={'yes' if oauth_cfg('github') else 'no'}")
    print(f" SMTP     : {'configured' if (load_json_cfg(MAIL_CONFIG_FILE) or {}).get('enabled') else 'DEV MODE (code printed)'}")
    print("=" * 62)
    start_oauth_callback_server()
    server = ThreadingHTTPServer(("127.0.0.1", PORT), NovaHandler)
    try: server.serve_forever()
    except KeyboardInterrupt: print("\nStopping NovaCompute backend.")
    finally: server.server_close()

if __name__ == "__main__":
    main()