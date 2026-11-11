#!/usr/bin/env python3
"""NovaCompute API gateway — Python standard library only."""

import hashlib
import json
import os
import random
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
PORT = int(os.getenv("NOVA_PORT", "8080"))
UPSTREAM_TIMEOUT = 120
UPSTREAM_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
DB_LOCK = threading.RLock()

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
    {"id": "grok-4.6", "name": "Grok 4.6", "provider": "xAI", "context": "500K", "speed": 150, "input": 0.1, "output": 0.3, "image": True, "video": False, "category": "chat", "tag": None, "note": ""},
    {"id": "deepseek-v4.1-flash", "name": "DeepSeek V4.1", "provider": "DeepSeek", "context": "1M", "speed": 145, "input": 0.0, "output": 0.0, "image": True, "video": False, "category": "code", "tag": "Free", "note": ""},
    {"id": "deepseek-v4.1-flash-1017", "name": "DeepSeek V4.1 1017", "provider": "DeepSeek", "context": "1M", "speed": 145, "input": 0.005, "output": 0.24, "image": True, "video": False, "category": "code", "tag": None, "note": ""},
    {"id": "kimi-k3.1-pro", "name": "Kimi k3.1 Pro", "provider": "Moonshot AI", "context": "1M", "speed": 120, "input": 1.0, "output": 1.0, "image": True, "video": True, "category": "chat", "tag": None, "note": "", "upstream_id": "kimi-k3.1-pro-free"},
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

def public_key(key):
    return {"id": key["id"], "name": key.get("name", "Key"), "key": key["key"], "created_at": key.get("created_at"), "last_used": key.get("last_used"), "status": key.get("status", "active")}

def record_usage(user_id, key_id, model_id, prompt_tokens, completion_tokens, latency_ms, status="ok", cost=0.0, client=""):
    with DB_LOCK:
        db = load_users()
        for user in db["users"]:
            if user.get("id") != user_id: continue
            event = {"ts": int(time.time()), "model": model_id, "prompt_tokens": int(prompt_tokens), "completion_tokens": int(completion_tokens), "latency_ms": int(latency_ms), "status": status, "cost": round(float(cost), 6), "client": client}
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
    for event in usage:
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
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
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
            self.send_json(200, {"object": "list", "data": [{"id": m["id"], "object": "model", "owned_by": m["provider"], "name": m["name"], "context": m["context"], "speed_tps": m["speed"], "pricing": {"input_per_1m": m["input"], "output_per_1m": m["output"]}, "capabilities": {"image": bool(m.get("image")), "video": bool(m.get("video"))}, "category": m.get("category", "chat"), "tag": m.get("tag"), "note": m.get("note", ""), "price_unit": m.get("price_unit")} for m in MODELS]})
            return
        if path == "/api/me": self.handle_me(); return
        self.send_error_json(404, "not_found", "not_found", f"No route for GET {path}")

    def do_POST(self):
        path = urlparse(self.path).path.rstrip("/") or "/"
        if path == "/v1/chat/completions": self.handle_chat_completions(); return
        if path == "/api/register": self.handle_register(); return
        if path == "/api/login": self.handle_login(); return
        if path == "/api/keys": self.handle_create_key(); return
        if path == "/api/topup": self.handle_topup(); return
        if path == "/api/profile": self.handle_profile(); return
        if path == "/v1/audio/speech": self.handle_speech(); return
        self.send_error_json(404, "not_found", "not_found", f"No route for POST {path}")

    def do_DELETE(self):
        path = urlparse(self.path).path.rstrip("/") or "/"
        if path.startswith("/api/keys/"): self.handle_delete_key(path.rsplit("/", 1)[-1]); return
        self.send_error_json(404, "not_found", "not_found", f"No route for DELETE {path}")

    def handle_register(self):
        body = self.read_json_body() or {}
        name = str(body.get("name", "")).strip(); email = str(body.get("email", "")).strip().lower(); password = str(body.get("password", ""))
        if not name: return self.send_error_json(400, "invalid_request_error", "name_required", "Name is required.")
        if not EMAIL_RE.match(email): return self.send_error_json(400, "invalid_request_error", "invalid_email", "A valid email is required.")
        if len(password) < 8: return self.send_error_json(400, "invalid_request_error", "weak_password", "Password must be at least 8 characters.")
        with DB_LOCK:
            db = load_users()
            if find_user_by_email(db, email): return self.send_error_json(409, "invalid_request_error", "email_taken", "An account with this email already exists.")
            salt, digest = hash_password(password); api_key = new_api_key()
            user = {"id": "usr_" + secrets.token_hex(8), "name": name, "email": email, "company": str(body.get("company", "")).strip(), "password_salt": salt, "password_hash": digest, "created_at": iso(now_utc()), "balance": 0.0, "api_keys": [{"id": "key_" + secrets.token_hex(6), "name": "Default", "key": api_key, "created_at": iso(now_utc()), "last_used": None, "status": "active"}], "usage": [], "transactions": []}
            db["users"].append(user); save_users(db)
        self.send_json(201, {"user": {"name": name, "email": email, "created_at": user["created_at"]}, "api_key": api_key, "balance": 0.0})

    def handle_login(self):
        body = self.read_json_body() or {}
        email = str(body.get("email", "")).strip().lower(); password = str(body.get("password", ""))
        if not email or not password: return self.send_error_json(400, "invalid_request_error", "missing_fields", "Email and password are required.")
        db = load_users(); user = find_user_by_email(db, email)
        if not user or not verify_password(password, user["password_salt"], user["password_hash"]): return self.send_error_json(401, "authentication_error", "invalid_credentials", "Incorrect email or password.")
        active_keys = [k for k in user.get("api_keys", []) if k.get("status", "active") == "active"]
        if not active_keys: return self.send_error_json(403, "authentication_error", "no_active_key", "This account has no active API keys.")
        self.send_json(200, {"user": {"name": user["name"], "email": user["email"], "created_at": user.get("created_at")}, "api_key": active_keys[0]["key"], "balance": round(user.get("balance", 0.0), 6)})

    def handle_me(self):
        _db, user, key = self.authenticate()
        if not user: return self.send_error_json(401, "authentication_error", "invalid_api_key", "Missing or invalid API key. Send Authorization: Bearer nova-sk-…")
        agg = usage_aggregates(user)
        self.send_json(200, {"user": {"name": user.get("name"), "email": user.get("email"), "company": user.get("company", ""), "created_at": user.get("created_at")}, "balance": round(user.get("balance", 0.0), 6), "api_keys": [public_key(k) for k in user.get("api_keys", []) if k.get("status", "active") == "active"], "request_key_id": key["id"], "stats": agg["stats"], "daily": agg["daily"], "by_model": agg["by_model"], "recent": agg["recent"], "transactions": transactions(user)})

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
        _db, user, _key = self.authenticate()
        if not user: return self.send_error_json(401, "authentication_error", "invalid_api_key", "Not authenticated.")
        body = self.read_json_body() or {}
        try: amount = round(float(body.get("amount", 0)), 2)
        except (TypeError, ValueError): amount = 0
        if not 0 < amount <= 1000: return self.send_error_json(400, "invalid_request_error", "invalid_amount", "Amount must be between $0.01 and $1000.")
        with DB_LOCK:
            db = load_users(); target = next((u for u in db["users"] if u["id"] == user["id"]), None)
            if not target: return self.send_error_json(404, "not_found", "user_missing", "Account not found.")
            target["balance"] = round(target.get("balance", 0.0) + amount, 6)
            target.setdefault("transactions", []).append({"ts": int(time.time()), "type": "topup", "description": "Demo top-up", "method": "Visa •••• 4242", "amount": amount})
            target["transactions"] = target["transactions"][-200:]; save_users(db); balance = target["balance"]
        self.send_json(200, {"balance": round(balance, 6)})

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

    # ================= TTS (NagaAI /v1/audio/speech) =================
    def handle_speech(self):
        refresh_models()
        _db, user, key = self.authenticate()
        if not user:
            return self.send_error_json(401, "authentication_error", "invalid_api_key", "Missing or invalid API key.")
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
        if cost > 0 and user.get("balance", 0) <= 0:
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
        upstream_model = (MODEL_LOOKUP.get(model) or {}).get("upstream_id") or model
        
        price_in, price_out = PRICING[model]
        is_paid = (price_in or price_out) > 0
        if is_paid and user.get("balance", 0) <= 0: return self.send_error_json(402, "insufficient_balance_error", "insufficient_balance", "Balance exhausted.")

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

        if stream: return self.relay_stream(upstream, user, key, model, price_in, price_out, started, client)

        try:
            raw = upstream.read(); data = json.loads(raw.decode("utf-8"))
        except (ValueError, OSError): return self.send_error_json(502, "upstream_error", "bad_upstream_response", "Upstream malformed JSON.")
        finally: upstream.close()

        latency = int((time.time() - started) * 1000); usage = data.get("usage") or {}
        prompt_tokens = int(usage.get("prompt_tokens") or 0); completion_tokens = int(usage.get("completion_tokens") or 0)
        cost = (prompt_tokens * price_in + completion_tokens * price_out) / 1_000_000
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

def main():
    print("=" * 62)
    print(" NovaCompute backend  ·  http://127.0.0.1:%d" % PORT)
    for p_name, p_info in PROVIDERS.items():
        keys = load_keys_from_file(p_info["keys_file"], p_info.get("fallback_key"))
        print(f" Provider : {p_name} | Keys: {len(keys)}")
    print("=" * 62)
    server = ThreadingHTTPServer(("127.0.0.1", PORT), NovaHandler)
    try: server.serve_forever()
    except KeyboardInterrupt: print("\nStopping NovaCompute backend.")
    finally: server.server_close()

if __name__ == "__main__":
    main()