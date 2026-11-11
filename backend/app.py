#!/usr/bin/env python3
"""NovaCompute API gateway — Python standard library only.

Endpoints
    POST /api/register          create an account, returns a nova-sk- key
    POST /api/login             authenticate, returns the account's API key
    GET  /api/me                dashboard data (balance, usage, keys, charts)
    POST /api/keys              create an additional customer API key
    DELETE /api/keys/<id>       delete a customer API key
    POST /api/topup             add demo credit to the balance
    POST /api/profile           update name / company
    GET  /v1/models             OpenAI-style model catalogue
    POST /v1/chat/completions   proxy to the configured upstream provider
    GET  /api/health            liveness + upstream configuration check

Design notes
    * One upstream provider key is configured in upstream_config.json
      (or NOVA_UPSTREAM_URL / NOVA_UPSTREAM_KEY). Use a key you are
      authorised to use for this workload — do not point this at keys
      obtained through automated account creation.
    * State is kept in users_db.json with a threading lock; writes are
      atomic (temp file + os.replace).
    * Not production hardened: plain HTTP, no sessions/JWT, no TLS.
"""

import hashlib
import json
import os
import re
import secrets
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
USERS_DB_FILE = os.path.join(BASE_DIR, "users_db.json")
CONFIG_FILE = os.path.join(BASE_DIR, "upstream_config.json")

PORT = int(os.getenv("NOVA_PORT", "8080"))
DEFAULT_UPSTREAM_URL = "https://api.nightrouter.ai/v1/chat/completions"
UPSTREAM_TIMEOUT = 120  # seconds

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

DB_LOCK = threading.RLock()

# ---------------------------------------------------------------------------
# Catalogue — keep in sync with novacompute/assets/js/models-data.js
# ---------------------------------------------------------------------------

MODELS = [
    {"id": "claude-opus-5.5-free", "name": "Claude Opus 5.5", "provider": "Anthropic", "context": "1M", "speed": 85, "input": 10.0, "output": 50.0},
    {"id": "claude-sonnet-5-5-free", "name": "Claude Sonnet 5.5", "provider": "Anthropic", "context": "1M", "speed": 92, "input": 2.0, "output": 10.0},
    {"id": "gpt-6-luna", "name": "GPT-6", "provider": "OpenAI", "context": "900K", "speed": 118, "input": 6.0, "output": 20.0},
    {"id": "gpt-5.6-luna", "name": "GPT-5.6", "provider": "OpenAI", "context": "900K", "speed": 130, "input": 3.0, "output": 10.0},
    {"id": "deepseek-v4.1-flash", "name": "DeepSeek V4.1", "provider": "DeepSeek", "context": "1M", "speed": 145, "input": 0.10, "output": 0.20},
    {"id": "deepseek-v4.1-flash-1017", "name": "DeepSeek V4.1 1017", "provider": "DeepSeek", "context": "1M", "speed": 145, "input": 0.10, "output": 0.30},
    {"id": "kimi-k3.1-pro-free", "name": "Kimi k3.1 Pro", "provider": "Moonshot AI", "context": "1M", "speed": 120, "input": 0.15, "output": 1.50},
    {"id": "mistral-large-4", "name": "Mistral Large 4", "provider": "Mistral AI", "context": "1M", "speed": 98, "input": 1.50, "output": 4.50},
    {"id": "mercury-3", "name": "Mercury 3", "provider": "Inception", "context": "1M", "speed": 1000, "input": 0.05, "output": 0.20},
    {"id": "glm-5.3-flash", "name": "GLM 5.3 Flash", "provider": "Z.ai", "context": "1M", "speed": 240, "input": 0.08, "output": 0.30},
    {"id": "glm-5.3", "name": "GLM 5.3", "provider": "Z.ai", "context": "1M", "speed": 85, "input": 0.50, "output": 1.20},
    {"id": "qwen/qwen3.7-flash:free", "name": "Qwen 3.7", "provider": "Alibaba", "context": "1M", "speed": 130, "input": 0.0, "output": 0.0},
]
PRICING = {m["id"]: (m["input"], m["output"]) for m in MODELS}
MODEL_IDS = set(PRICING)


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------

def now_utc():
    return datetime.now(timezone.utc)


def iso(dt):
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def atomic_write(path, obj):
    tmp = f"{path}.tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(obj, fh, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


def mask_key(value):
    if not value or len(value) < 12:
        return "***"
    return f"{value[:10]}…{value[-4:]}"


def hash_password(password, salt_hex=None):
    salt_hex = salt_hex or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), bytes.fromhex(salt_hex), 120_000
    ).hex()
    return salt_hex, digest


def verify_password(password, salt_hex, expected_hash):
    _, digest = hash_password(password, salt_hex)
    return secrets.compare_digest(digest, expected_hash)


def new_api_key():
    return "nova-sk-" + secrets.token_hex(20)


def error_payload(err_type, code, message):
    return {"error": {"type": err_type, "code": code, "message": message}}


# ---------------------------------------------------------------------------
# User store
# ---------------------------------------------------------------------------

def load_users():
    with DB_LOCK:
        if not os.path.exists(USERS_DB_FILE):
            atomic_write(USERS_DB_FILE, {"users": []})
            return {"users": []}
        with open(USERS_DB_FILE, "r", encoding="utf-8") as fh:
            try:
                data = json.load(fh)
            except json.JSONDecodeError:
                data = {"users": []}
        if not isinstance(data.get("users"), list):
            data = {"users": []}
        return data


def save_users(db):
    with DB_LOCK:
        atomic_write(USERS_DB_FILE, db)


def find_user_by_api_key(db, token):
    for user in db["users"]:
        for key in user.get("api_keys", []):
            if key.get("key") == token and key.get("status", "active") == "active":
                return user, key
    return None, None


def find_user_by_email(db, email):
    email = email.strip().lower()
    for user in db["users"]:
        if user.get("email", "").lower() == email:
            return user
    return None


def public_key(key):
    return {
        "id": key["id"],
        "name": key.get("name", "Key"),
        "key": key["key"],
        "created_at": key.get("created_at"),
        "last_used": key.get("last_used"),
        "status": key.get("status", "active"),
    }


def touch_key(user_id, key_id):
    """Refresh last_used for a customer key (best effort)."""
    with DB_LOCK:
        db = load_users()
        for user in db["users"]:
            if user.get("id") != user_id:
                continue
            for key in user.get("api_keys", []):
                if key.get("id") == key_id:
                    key["last_used"] = iso(now_utc())
            save_users(db)
            return


def record_usage(user_id, key_id, model_id, prompt_tokens, completion_tokens,
                 latency_ms, status="ok", cost=0.0):
    """Append a usage event, deduct balance, update the key's last_used."""
    with DB_LOCK:
        db = load_users()
        for user in db["users"]:
            if user.get("id") != user_id:
                continue
            event = {
                "ts": int(time.time()),
                "model": model_id,
                "prompt_tokens": int(prompt_tokens),
                "completion_tokens": int(completion_tokens),
                "latency_ms": int(latency_ms),
                "status": status,
                "cost": round(float(cost), 6),
            }
            user.setdefault("usage", []).append(event)
            user["usage"] = user["usage"][-800:]
            if cost:
                user["balance"] = round(max(0.0, user.get("balance", 0.0) - cost), 6)
                user.setdefault("transactions", []).append({
                    "ts": event["ts"],
                    "type": "usage",
                    "description": f"API usage — {model_id}",
                    "method": "Balance",
                    "amount": -round(float(cost), 6),
                })
                user["transactions"] = user["transactions"][-200:]
            for key in user.get("api_keys", []):
                if key.get("id") == key_id:
                    key["last_used"] = iso(now_utc())
            save_users(db)
            return


def usage_aggregates(user):
    """Daily tokens/requests for the last 14 days, per-model totals, recent rows."""
    days = 14
    today = now_utc().date()
    by_day = {}
    for offset in range(days - 1, -1, -1):
        by_day[(today - timedelta(days=offset))] = {"tokens": 0, "requests": 0}

    usage = user.get("usage", [])
    for event in usage:
        try:
            day = datetime.fromtimestamp(event["ts"], timezone.utc).date()
        except (KeyError, ValueError, OSError):
            continue
        if day in by_day:
            by_day[day]["tokens"] += event.get("prompt_tokens", 0) + event.get("completion_tokens", 0)
            by_day[day]["requests"] += 1

    daily = [
        {"date": day.strftime("%b %d"), "tokens": vals["tokens"], "requests": vals["requests"]}
        for day, vals in sorted(by_day.items())
    ]

    today_stats = by_day.get(today, {"tokens": 0, "requests": 0})
    yesterday_stats = by_day.get(today - timedelta(days=1), {"tokens": 0, "requests": 0})

    def pct(current, previous):
        if previous <= 0:
            return None
        return round((current - previous) / previous * 100, 1)

    per_model = {}
    for event in usage:
        entry = per_model.setdefault(event["model"], {"requests": 0, "tokens": 0})
        entry["requests"] += 1
        entry["tokens"] += event.get("prompt_tokens", 0) + event.get("completion_tokens", 0)
    by_model = [
        {"id": model_id, **vals}
        for model_id, vals in sorted(per_model.items(), key=lambda kv: -kv[1]["tokens"])
    ]

    recent = []
    for event in sorted(usage, key=lambda e: e.get("ts", 0), reverse=True)[:8]:
        recent.append({
            "ts": event.get("ts"),
            "model": event.get("model"),
            "tokens": event.get("prompt_tokens", 0) + event.get("completion_tokens", 0),
            "latency_ms": event.get("latency_ms"),
            "status": event.get("status", "ok"),
        })

    latencies = [e.get("latency_ms", 0) for e in usage
                 if e.get("latency_ms") and e.get("status") == "ok"][-50:]
    avg_latency = round(sum(latencies) / len(latencies)) if latencies else 0

    return {
        "daily": daily,
        "by_model": by_model,
        "recent": recent,
        "stats": {
            "requests_today": today_stats["requests"],
            "tokens_today": today_stats["tokens"],
            "requests_delta_pct": pct(today_stats["requests"], yesterday_stats["requests"]),
            "tokens_delta_pct": pct(today_stats["tokens"], yesterday_stats["tokens"]),
            "avg_latency_ms": avg_latency,
            "total_requests": len(usage),
        },
    }


def transactions(user, limit=10):
    rows = sorted(user.get("transactions", []), key=lambda t: t.get("ts", 0), reverse=True)[:limit]
    return [
        {
            "ts": row.get("ts"),
            "type": row.get("type", "usage"),
            "description": row.get("description", ""),
            "method": row.get("method", ""),
            "amount": row.get("amount", 0),
        }
        for row in rows
    ]


# ---------------------------------------------------------------------------
# Upstream configuration
# ---------------------------------------------------------------------------

def load_upstream_config():
    """Return (url, key). Env vars win; placeholders count as unconfigured."""
    url = os.getenv("NOVA_UPSTREAM_URL", "").strip()
    key = os.getenv("NOVA_UPSTREAM_KEY", "").strip()
    if not (url and key) and os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, "r", encoding="utf-8") as fh:
                cfg = json.load(fh)
            url = url or str(cfg.get("chat_completions_url", "")).strip()
            key = key or str(cfg.get("api_key", "")).strip()
        except (OSError, json.JSONDecodeError):
            pass
    if not url:
        url = DEFAULT_UPSTREAM_URL
    if not key or key.upper().startswith("SK-REPLACE"):
        return url, None
    return url, key


# ---------------------------------------------------------------------------
# HTTP handler
# ---------------------------------------------------------------------------

def json_bytes(obj):
    return json.dumps(obj, ensure_ascii=False).encode("utf-8")


class NovaHandler(BaseHTTPRequestHandler):
    server_version = "NovaCompute/1.0"
    protocol_version = "HTTP/1.0"  # close-delimited streaming for SSE

    # ---------------- plumbing ----------------

    def end_headers(self):
        # CORS for the static frontend on :8123
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
        super().end_headers()

    def log_message(self, fmt, *args):  # noqa: N802 (stdlib signature)
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
        try:
            length = int(self.headers.get("Content-Length", "0") or "0")
        except ValueError:
            length = 0
        if length <= 0:
            return None
        raw = self.rfile.read(length)
        try:
            return json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            return None

    def authenticate(self):
        header = self.headers.get("Authorization", "")
        if not header.lower().startswith("bearer "):
            return None, None, None
        token = header[7:].strip()
        if not token:
            return None, None, None
        db = load_users()
        user, key = find_user_by_api_key(db, token)
        return db, user, key

    # ---------------- verbs ----------------

    def do_OPTIONS(self):  # noqa: N802
        self.send_response(204)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):  # noqa: N802
        path = urlparse(self.path).path.rstrip("/") or "/"
        if path in ("/", "/api/health"):
            url, key = load_upstream_config()
            self.send_json(200, {
                "status": "ok",
                "service": "nova-backend",
                "upstream": {"url": url, "configured": bool(key)},
                "models": len(MODELS),
                "time": iso(now_utc()),
            })
            return
        if path == "/v1/models":
            self.send_json(200, {
                "object": "list",
                "data": [
                    {
                        "id": m["id"],
                        "object": "model",
                        "owned_by": m["provider"],
                        "name": m["name"],
                        "context": m["context"],
                        "speed_tps": m["speed"],
                        "pricing": {"input_per_1m": m["input"], "output_per_1m": m["output"]},
                    }
                    for m in MODELS
                ],
            })
            return
        if path == "/api/me":
            self.handle_me()
            return
        self.send_error_json(404, "not_found", "not_found", f"No route for GET {path}")

    def do_POST(self):  # noqa: N802
        path = urlparse(self.path).path.rstrip("/") or "/"
        if path == "/v1/chat/completions":
            self.handle_chat_completions()
            return
        if path == "/api/register":
            self.handle_register()
            return
        if path == "/api/login":
            self.handle_login()
            return
        if path == "/api/keys":
            self.handle_create_key()
            return
        if path == "/api/topup":
            self.handle_topup()
            return
        if path == "/api/profile":
            self.handle_profile()
            return
        self.send_error_json(404, "not_found", "not_found", f"No route for POST {path}")

    def do_DELETE(self):  # noqa: N802
        path = urlparse(self.path).path.rstrip("/") or "/"
        if path.startswith("/api/keys/"):
            self.handle_delete_key(path.rsplit("/", 1)[-1])
            return
        self.send_error_json(404, "not_found", "not_found", f"No route for DELETE {path}")

    # ---------------- account endpoints ----------------

    def handle_register(self):
        body = self.read_json_body() or {}
        name = str(body.get("name", "")).strip()
        email = str(body.get("email", "")).strip().lower()
        password = str(body.get("password", ""))

        if not name:
            return self.send_error_json(400, "invalid_request_error", "name_required", "Name is required.")
        if not EMAIL_RE.match(email):
            return self.send_error_json(400, "invalid_request_error", "invalid_email", "A valid email is required.")
        if len(password) < 8:
            return self.send_error_json(400, "invalid_request_error", "weak_password", "Password must be at least 8 characters.")

        with DB_LOCK:
            db = load_users()
            if find_user_by_email(db, email):
                return self.send_error_json(409, "invalid_request_error", "email_taken", "An account with this email already exists.")

            salt, digest = hash_password(password)
            api_key = new_api_key()
            user = {
                "id": "usr_" + secrets.token_hex(8),
                "name": name,
                "email": email,
                "company": str(body.get("company", "")).strip(),
                "password_salt": salt,
                "password_hash": digest,
                "created_at": iso(now_utc()),
                "balance": 0.0,
                "api_keys": [{
                    "id": "key_" + secrets.token_hex(6),
                    "name": "Default",
                    "key": api_key,
                    "created_at": iso(now_utc()),
                    "last_used": None,
                    "status": "active",
                }],
                "usage": [],
                "transactions": [],
            }
            db["users"].append(user)
            save_users(db)

        print(f"[accounts] registered {email} key={mask_key(api_key)}", flush=True)
        self.send_json(201, {
            "user": {"name": name, "email": email, "created_at": user["created_at"]},
            "api_key": api_key,
            "balance": 0.0,
        })

    def handle_login(self):
        body = self.read_json_body() or {}
        email = str(body.get("email", "")).strip().lower()
        password = str(body.get("password", ""))
        if not email or not password:
            return self.send_error_json(400, "invalid_request_error", "missing_fields", "Email and password are required.")

        db = load_users()
        user = find_user_by_email(db, email)
        if not user or not verify_password(password, user["password_salt"], user["password_hash"]):
            return self.send_error_json(401, "authentication_error", "invalid_credentials", "Incorrect email or password.")

        active_keys = [k for k in user.get("api_keys", []) if k.get("status", "active") == "active"]
        if not active_keys:
            return self.send_error_json(403, "authentication_error", "no_active_key", "This account has no active API keys.")

        self.send_json(200, {
            "user": {"name": user["name"], "email": user["email"], "created_at": user.get("created_at")},
            "api_key": active_keys[0]["key"],
            "balance": round(user.get("balance", 0.0), 6),
        })

    def handle_me(self):
        _db, user, key = self.authenticate()
        if not user:
            return self.send_error_json(401, "authentication_error", "invalid_api_key",
                                        "Missing or invalid API key. Send Authorization: Bearer nova-sk-…")

        agg = usage_aggregates(user)
        self.send_json(200, {
            "user": {
                "name": user.get("name"),
                "email": user.get("email"),
                "company": user.get("company", ""),
                "created_at": user.get("created_at"),
            },
            "balance": round(user.get("balance", 0.0), 6),
            "api_keys": [public_key(k) for k in user.get("api_keys", []) if k.get("status", "active") == "active"],
            "request_key_id": key["id"],
            "stats": agg["stats"],
            "daily": agg["daily"],
            "by_model": agg["by_model"],
            "recent": agg["recent"],
            "transactions": transactions(user),
        })

    def handle_create_key(self):
        _db, user, _key = self.authenticate()
        if not user:
            return self.send_error_json(401, "authentication_error", "invalid_api_key", "Not authenticated.")
        body = self.read_json_body() or {}
        name = str(body.get("name", "")).strip() or "Untitled key"
        name = name[:60]

        with DB_LOCK:
            db = load_users()
            target = next((u for u in db["users"] if u["id"] == user["id"]), None)
            if not target:
                return self.send_error_json(404, "not_found", "user_missing", "Account not found.")
            entry = {
                "id": "key_" + secrets.token_hex(6),
                "name": name,
                "key": new_api_key(),
                "created_at": iso(now_utc()),
                "last_used": None,
                "status": "active",
            }
            target.setdefault("api_keys", []).append(entry)
            save_users(db)

        print(f"[accounts] {user['email']} created key '{name}' {mask_key(entry['key'])}", flush=True)
        self.send_json(201, {
            "key": public_key(entry),
            "keys": [public_key(k) for k in target["api_keys"] if k.get("status", "active") == "active"],
        })

    def handle_delete_key(self, key_id):
        _db, user, auth_key = self.authenticate()
        if not user:
            return self.send_error_json(401, "authentication_error", "invalid_api_key", "Not authenticated.")

        with DB_LOCK:
            db = load_users()
            target = next((u for u in db["users"] if u["id"] == user["id"]), None)
            if not target:
                return self.send_error_json(404, "not_found", "user_missing", "Account not found.")
            active = [k for k in target.get("api_keys", []) if k.get("status", "active") == "active"]
            if len(active) <= 1:
                return self.send_error_json(409, "invalid_request_error", "last_key", "Keep at least one active API key.")
            doomed = next((k for k in active if k["id"] == key_id), None)
            if not doomed:
                return self.send_error_json(404, "not_found", "key_missing", "API key not found.")

            target["api_keys"] = [k for k in target["api_keys"] if k["id"] != key_id]
            save_users(db)

        remaining = active_after = [k for k in target["api_keys"] if k.get("status", "active") == "active"]
        self.send_json(200, {
            "deleted": key_id,
            "deleted_current_key": key_id == auth_key["id"],
            "keys": [public_key(k) for k in remaining],
            "auth_key": remaining[0]["key"] if key_id == auth_key["id"] else auth_key["key"],
        })

    def handle_topup(self):
        _db, user, _key = self.authenticate()
        if not user:
            return self.send_error_json(401, "authentication_error", "invalid_api_key", "Not authenticated.")
        body = self.read_json_body() or {}
        try:
            amount = round(float(body.get("amount", 0)), 2)
        except (TypeError, ValueError):
            amount = 0
        if not 0 < amount <= 1000:
            return self.send_error_json(400, "invalid_request_error", "invalid_amount",
                                        "Amount must be between $0.01 and $1000.")

        with DB_LOCK:
            db = load_users()
            target = next((u for u in db["users"] if u["id"] == user["id"]), None)
            if not target:
                return self.send_error_json(404, "not_found", "user_missing", "Account not found.")
            target["balance"] = round(target.get("balance", 0.0) + amount, 6)
            target.setdefault("transactions", []).append({
                "ts": int(time.time()),
                "type": "topup",
                "description": "Demo top-up",
                "method": "Visa •••• 4242",
                "amount": amount,
            })
            target["transactions"] = target["transactions"][-200:]
            save_users(db)
            balance = target["balance"]

        self.send_json(200, {"balance": round(balance, 6)})

    def handle_profile(self):
        _db, user, _key = self.authenticate()
        if not user:
            return self.send_error_json(401, "authentication_error", "invalid_api_key", "Not authenticated.")
        body = self.read_json_body() or {}
        name = str(body.get("name", "")).strip()
        company = str(body.get("company", "")).strip()
        if not name:
            return self.send_error_json(400, "invalid_request_error", "name_required", "Name is required.")

        with DB_LOCK:
            db = load_users()
            target = next((u for u in db["users"] if u["id"] == user["id"]), None)
            if not target:
                return self.send_error_json(404, "not_found", "user_missing", "Account not found.")
            target["name"] = name[:80]
            target["company"] = company[:80]
            save_users(db)

        self.send_json(200, {"user": {"name": name, "company": company, "email": user["email"]}})

    # ---------------- chat completions ----------------

    def handle_chat_completions(self):
        _db, user, key = self.authenticate()
        if not user:
            return self.send_error_json(401, "authentication_error", "invalid_api_key",
                                        "Missing or invalid API key. Send Authorization: Bearer nova-sk-…")

        body = self.read_json_body()
        if body is None:
            return self.send_error_json(400, "invalid_request_error", "invalid_json", "Request body must be valid JSON.")

        model = str(body.get("model", "")).strip()
        if model not in MODEL_IDS:
            return self.send_error_json(400, "invalid_request_error", "invalid_model",
                                        f"Unknown model '{model}'. Call GET /v1/models for the catalogue.")
        messages = body.get("messages")
        if not isinstance(messages, list) or not messages:
            return self.send_error_json(400, "invalid_request_error", "invalid_messages",
                                        "'messages' must be a non-empty array.")

        price_in, price_out = PRICING[model]
        is_paid = (price_in or price_out) > 0
        if is_paid and user.get("balance", 0) <= 0:
            return self.send_error_json(402, "insufficient_balance_error", "insufficient_balance",
                                        "Balance exhausted. Top up in the dashboard or use a free model.")

        url, upstream_key = load_upstream_config()
        if not upstream_key:
            return self.send_error_json(503, "configuration_error", "upstream_not_configured",
                                        "No upstream provider key is configured. Add your authorised key to "
                                        "backend/upstream_config.json (see upstream_config.example.json).")

        stream = bool(body.get("stream"))
        payload = dict(body)
        payload["model"] = model

        request = urllib.request.Request(
            url,
            data=json_bytes(payload),
            headers={
                "Authorization": f"Bearer {upstream_key}",
                "Content-Type": "application/json",
                "Accept": "text/event-stream" if stream else "application/json",
            },
            method="POST",
        )

        started = time.time()
        try:
            upstream = urllib.request.urlopen(request, timeout=UPSTREAM_TIMEOUT)
        except urllib.error.HTTPError as exc:
            latency = int((time.time() - started) * 1000)
            detail = ""
            try:
                detail = exc.read().decode("utf-8", "replace")[:400]
            except Exception:
                pass
            print(f"[upstream] {model} -> HTTP {exc.code} in {latency}ms {detail[:120]}", flush=True)
            if exc.code in (401, 403):
                return self.send_error_json(502, "upstream_error", "upstream_auth_failed",
                                            "The upstream provider rejected the configured key (401/403). "
                                            "Check that your key is valid and authorised for this workload.")
            if exc.code == 429:
                return self.send_error_json(502, "upstream_error", "upstream_rate_limited",
                                            "The upstream provider rate-limited this key (429). Retry later "
                                            "or use a plan with higher limits — NovaCompute does not rotate keys "
                                            "to bypass provider limits.")
            return self.send_error_json(502, "upstream_error", "upstream_rejected",
                                        f"Upstream provider returned HTTP {exc.code}.")
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            print(f"[upstream] {model} -> connection error: {exc}", flush=True)
            return self.send_error_json(502, "upstream_error", "upstream_unreachable",
                                        "Could not reach the upstream provider. Check the URL/network.")

        if stream:
            return self.relay_stream(upstream, user, key, model, price_in, price_out, started)

        # ---- non-streaming ----
        try:
            raw = upstream.read()
            data = json.loads(raw.decode("utf-8"))
        except (ValueError, OSError):
            return self.send_error_json(502, "upstream_error", "bad_upstream_response",
                                        "Upstream returned a malformed JSON response.")
        finally:
            upstream.close()

        latency = int((time.time() - started) * 1000)
        usage = data.get("usage") or {}
        prompt_tokens = int(usage.get("prompt_tokens") or 0)
        completion_tokens = int(usage.get("completion_tokens") or 0)
        cost = (prompt_tokens * price_in + completion_tokens * price_out) / 1_000_000
        record_usage(user["id"], key["id"], model, prompt_tokens, completion_tokens, latency,
                     status="ok", cost=cost)
        print(f"[chat] {model} key={mask_key(key['key'])} in={prompt_tokens} out={completion_tokens} "
              f"cost=${cost:.6f} {latency}ms", flush=True)
        self.send_json(200, data)

    def relay_stream(self, upstream, user, key, model, price_in, price_out, started):
        """Relay server-sent events to the client and account for the usage."""
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "close")
        self.end_headers()

        collected_chars = 0
        usage = None
        try:
            while True:
                chunk = upstream.read(2048)
                if not chunk:
                    break
                text = chunk.decode("utf-8", "replace")
                for line in text.splitlines():
                    line = line.strip()
                    if line.startswith("data:"):
                        payload = line[5:].strip()
                        if payload and payload != "[DONE]":
                            try:
                                event = json.loads(payload)
                                usage = event.get("usage") or usage
                                delta = (event.get("choices") or [{}])[0].get("delta") or {}
                                collected_chars += len(delta.get("content") or "")
                            except (ValueError, AttributeError, IndexError):
                                pass
                self.wfile.write(chunk)
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            print("[stream] client disconnected early", flush=True)
        finally:
            upstream.close()

        latency = int((time.time() - started) * 1000)
        if usage:
            prompt_tokens = int(usage.get("prompt_tokens") or 0)
            completion_tokens = int(usage.get("completion_tokens") or 0)
        else:
            prompt_tokens = 0
            completion_tokens = max(1, collected_chars // 4)
        cost = (prompt_tokens * price_in + completion_tokens * price_out) / 1_000_000
        record_usage(user["id"], key["id"], model, prompt_tokens, completion_tokens, latency,
                     status="ok", cost=cost)
        print(f"[chat:stream] {model} out~{completion_tokens} tok cost=${cost:.6f} {latency}ms", flush=True)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    print("=" * 62)
    print(" NovaCompute backend  ·  http://127.0.0.1:%d" % PORT)
    url, key = load_upstream_config()
    print(f" Upstream : {url}")
    print(f" Key      : {'configured (' + mask_key(key) + ')' if key else 'NOT CONFIGURED — see upstream_config.example.json'}")
    print("=" * 62)
    server = ThreadingHTTPServer(("127.0.0.1", PORT), NovaHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping NovaCompute backend.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
