#!/usr/bin/env python3
"""NovaCompute model watcher.

Polls the live catalogue and sends phone alerts through ntfy and/or Telegram
when a model changes from up to down (or recovers). Stdlib only.

Environment:
  NOVA_WATCH_BASE       default http://127.0.0.1:8080
  NOVA_WATCH_KEY        customer/admin API key (required)
  NOVA_WATCH_SCOPE      free (default) or all
  NOVA_WATCH_INTERVAL   seconds between checks, default 900
  NOVA_WATCH_TIMEOUT    per probe timeout, default 45
  NOVA_WATCH_RETRIES    attempts per probe, default 5
  NOVA_WATCH_STATE      state file, default ./model_watch_state.json
  NTFY_TOPIC            ntfy topic name (optional)
  NTFY_URL              default https://ntfy.sh
  TELEGRAM_BOT_TOKEN    Telegram bot token (optional)
  TELEGRAM_CHAT_ID      Telegram chat id (optional)

Run:
  python monitor/model_watch.py --once
  python monitor/model_watch.py
"""
import argparse
import json
import os
import time
import urllib.error
import urllib.request

BASE = os.getenv("NOVA_WATCH_BASE", "http://127.0.0.1:8080").rstrip("/")
KEY = os.getenv("NOVA_WATCH_KEY", "").strip()
SCOPE = os.getenv("NOVA_WATCH_SCOPE", "free").strip().lower()
INTERVAL = max(60, int(os.getenv("NOVA_WATCH_INTERVAL", "900")))
TIMEOUT = max(5, int(os.getenv("NOVA_WATCH_TIMEOUT", "45")))
RETRIES = max(1, int(os.getenv("NOVA_WATCH_RETRIES", "5")))
STATE_FILE = os.getenv("NOVA_WATCH_STATE", os.path.join(os.path.dirname(__file__), "model_watch_state.json"))
ONLY = [x.strip() for x in os.getenv("NOVA_WATCH_MODELS", "").split(",") if x.strip()]
NTFY_TOPIC = os.getenv("NTFY_TOPIC", "").strip()
NTFY_URL = os.getenv("NTFY_URL", "https://ntfy.sh").rstrip("/")
TG_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
TG_CHAT = os.getenv("TELEGRAM_CHAT_ID", "").strip()
UA = "NovaCompute-ModelWatch/1.0"


def request_json(url, body=None, headers=None, timeout=30):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, headers=headers or {}, method="POST" if data else "GET")
    with urllib.request.urlopen(req, timeout=timeout) as res:
        return res.status, json.load(res)


def notify(title, message, priority="default", tags=""):
    delivered = []
    if NTFY_TOPIC:
        try:
            req = urllib.request.Request(
                f"{NTFY_URL}/{NTFY_TOPIC}",
                data=message.encode("utf-8"),
                headers={"Title": title, "Priority": priority, "Tags": tags, "User-Agent": UA},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=15) as res:
                res.read()
            delivered.append("ntfy")
        except Exception as exc:
            print(f"[notify] ntfy failed: {exc}")
    if TG_TOKEN and TG_CHAT:
        try:
            request_json(
                f"https://api.telegram.org/bot{TG_TOKEN}/sendMessage",
                {"chat_id": TG_CHAT, "text": f"{title}\n{message}", "disable_web_page_preview": True},
                {"Content-Type": "application/json", "User-Agent": UA},
            )
            delivered.append("telegram")
        except Exception as exc:
            print(f"[notify] telegram failed: {exc}")
    if not delivered:
        print(f"[notify] {title}: {message}")


def auth_headers():
    return {"Authorization": "Bearer " + KEY, "Content-Type": "application/json", "User-Agent": UA}


def probe(model):
    kind = model.get("category")
    body = {"model": model["id"]}
    if kind == "decision":
        body.update({"state": "The service is down and the customer is angry.", "questions": {"urgent": {"type": "noul", "instructions": "The message is urgent"}}})
        path = "/v1/systemone"
    elif kind == "moderation":
        body.update({"input": "health check"})
        path = "/v1/moderations"
    elif kind == "tts":
        body.update({"input": "health check", "voice": "Kore"})
        path = "/v1/audio/speech"
    else:
        body.update({"messages": [{"role": "user", "content": "Reply with OK."}], "max_tokens": 16})
        path = "/v1/chat/completions"

    last = ""
    for attempt in range(1, RETRIES + 1):
        started = time.time()
        try:
            req = urllib.request.Request(BASE + path, data=json.dumps(body).encode(), headers=auth_headers(), method="POST")
            with urllib.request.urlopen(req, timeout=TIMEOUT) as res:
                res.read()
                return True, int((time.time() - started) * 1000), ""
        except urllib.error.HTTPError as exc:
            last = f"HTTP {exc.code}: {exc.read().decode('utf-8', 'replace')[:180]}"
            if exc.code not in (408, 425, 429, 500, 502, 503, 504):
                return False, int((time.time() - started) * 1000), last
        except Exception as exc:
            last = f"{type(exc).__name__}: {exc}"[:200]
        if attempt < RETRIES:
            time.sleep(min(1.5 * attempt, 6))
    return False, 0, last


def load_state():
    try:
        with open(STATE_FILE, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return {}


def save_state(state):
    tmp = STATE_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(state, fh, indent=2, sort_keys=True)
    os.replace(tmp, STATE_FILE)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--once", action="store_true", help="run one pass and exit")
    args = parser.parse_args()
    if not KEY:
        raise SystemExit("NOVA_WATCH_KEY is required")

    while True:
        try:
            _, payload = request_json(BASE + "/v1/models", headers={"User-Agent": UA})
            models = payload.get("data", payload)
            if ONLY:
                models = [m for m in models if m["id"] in ONLY]
            elif SCOPE == "free":
                models = [m for m in models if not m.get("price_per_request") and not (m.get("pricing") or {}).get("input_per_1m") and not (m.get("pricing") or {}).get("output_per_1m")]
            state = load_state()
            first_run = not state
            checked = 0
            for model in models:
                mid = model["id"]
                ok, latency, error = probe(model)
                checked += 1
                previous = state.get(mid)
                current = {"up": ok, "latency_ms": latency, "error": error, "checked_at": int(time.time())}
                if previous is not None and previous.get("up") != ok:
                    if ok:
                        notify("NovaCompute recovered", f"{model.get('name', mid)} ({mid}) is responding · {latency} ms", "default", "white_check_mark")
                    else:
                        notify("NovaCompute model down", f"{model.get('name', mid)} ({mid}) failed {RETRIES} attempts\n{error}", "high", "warning")
                state[mid] = current
            save_state(state)
            up = sum(1 for m in models if state.get(m["id"], {}).get("up"))
            down = len(models) - up
            print(f"[watch] {checked} models · {up} up · {down} down")
            if first_run:
                notify("NovaCompute watch started", f"Tracking {checked} models · {up} up · {down} down", "low", "bar_chart")
        except Exception as exc:
            print(f"[watch] pass failed: {exc}")
            notify("NovaCompute watcher error", str(exc), "high", "rotating_light")
        if args.once:
            return
        time.sleep(INTERVAL)


if __name__ == "__main__":
    main()
