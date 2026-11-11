#!/usr/bin/env python3
"""NovaCompute — upstream latency probe.

Calls each model through its configured provider endpoint (reads
backend/app.py PROVIDERS + MODEL_PROVIDER_MAP and the provider key
files; the local customer API is not involved).

Usage:
    python test_speed.py                              # every model in MODELS
    python test_speed.py --models mistral-large-4,mercury-3
    python test_speed.py --models grok-4.6 --runs 3
    python test_speed.py --timeout 45

Columns:
    model · provider · HTTP status · latency (ms, full response) · reply / error

The script reads the first key available for each provider:
    backend/<provider>_keys.json  →  fallback_key in PROVIDERS (if configured)
"""

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.join(ROOT, "backend")
sys.path.insert(0, BACKEND_DIR)

import app  # noqa: E402  (loads PROVIDERS / MODELS / MODEL_PROVIDER_MAP; main() is guarded)

PROMPT = "Hello"
MAX_TOKENS = 32


def provider_key(provider_info):
    keys = app.load_keys_from_file(provider_info["keys_file"], provider_info.get("fallback_key"))
    return keys[0] if keys else None


def mask(value):
    if not value:
        return "—"
    return value[:8] + "…" + value[-4:] if len(value) > 14 else value[:4] + "…"


def call_model(model_id, timeout):
    provider = app.MODEL_PROVIDER_MAP.get(model_id, app.DEFAULT_PROVIDER)
    info = app.PROVIDERS.get(provider)
    if not info:
        return {"model": model_id, "provider": provider, "status": "NO PROV", "ms": None,
                "detail": "provider not configured"}

    key = provider_key(info)
    if not key:
        return {"model": model_id, "provider": provider, "status": "NO KEY", "ms": None,
                "detail": f"{os.path.basename(info['keys_file'])} empty"}

    payload = {
        "model": model_id,
        "messages": [{"role": "user", "content": PROMPT}],
        "max_tokens": MAX_TOKENS,
        "stream": False,
    }
    request = urllib.request.Request(
        info["url"],
        data=json.dumps(payload).encode("utf-8"),
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        method="POST",
    )

    started = time.perf_counter()
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read()
            elapsed = (time.perf_counter() - started) * 1000
            status = response.status
    except urllib.error.HTTPError as exc:
        elapsed = (time.perf_counter() - started) * 1000
        body = ""
        try:
            body = exc.read().decode("utf-8", "replace")[:180]
        except Exception:
            pass
        return {"model": model_id, "provider": provider, "status": f"HTTP {exc.code}",
                "ms": round(elapsed), "detail": body.replace("\n", " ") or exc.reason}
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        elapsed = (time.perf_counter() - started) * 1000
        return {"model": model_id, "provider": provider, "status": "NET ERR",
                "ms": round(elapsed), "detail": str(exc)[:160]}

    detail = ""
    usage = ""
    try:
        data = json.loads(raw.decode("utf-8"))
        choices = data.get("choices") or []
        if choices:
            message = choices[0].get("message") or {}
            detail = (message.get("content") or "").strip().replace("\n", " ")[:100]
        if data.get("usage"):
            u = data["usage"]
            usage = f"in {u.get('prompt_tokens', '?')} / out {u.get('completion_tokens', '?')}"
    except (ValueError, AttributeError):
        detail = raw.decode("utf-8", "replace")[:100].replace("\n", " ")

    return {"model": model_id, "provider": provider, "status": f"HTTP {status}",
            "ms": round(elapsed), "detail": detail + (f"  [{usage}]" if usage else "")}


def print_table(rows):
    widths = {
        "model": max(12, max(len(r["model"]) for r in rows) + 2),
        "provider": max(10, max(len(r["provider"]) for r in rows) + 2),
        "status": 10,
        "ms": 8,
    }
    header = (f"{'MODEL':<{widths['model']}}{'PROVIDER':<{widths['provider']}}"
              f"{'STATUS':<{widths['status']}}{'LATENCY':>{widths['ms']}}   DETAIL")
    print(header)
    print("-" * len(header))
    for row in rows:
        latency = f"{row['ms']} ms" if row["ms"] is not None else "—"
        print(f"{row['model']:<{widths['model']}}{row['provider']:<{widths['provider']}}"
              f"{row['status']:<{widths['status']}}{latency:>{widths['ms']}}   {row['detail']}")


def main():
    parser = argparse.ArgumentParser(description="NovaCompute upstream latency probe")
    parser.add_argument("--models", help="comma-separated model IDs (default: all)")
    parser.add_argument("--runs", type=int, default=1, help="repeat each model N times")
    parser.add_argument("--timeout", type=float, default=60, help="per-request timeout seconds")
    args = parser.parse_args()

    known = {m["id"] for m in app.MODELS}
    if args.models:
        model_ids = [m.strip() for m in args.models.split(",") if m.strip()]
        unknown = [m for m in model_ids if m not in known]
        if unknown:
            print(f"Unknown model(s): {', '.join(unknown)}")
            print("Available:", ", ".join(sorted(known)))
            return 1
    else:
        model_ids = [m["id"] for m in app.MODELS]

    print(f"Probing {len(model_ids)} model(s), prompt \"{PROMPT}\", max_tokens={MAX_TOKENS} "
          f"(backend catalogue: {len(app.MODELS)} models)\n")

    rows = []
    for run in range(max(1, args.runs)):
        if args.runs > 1:
            print(f"— run {run + 1}/{args.runs} —")
        for model_id in model_ids:
            row = call_model(model_id, args.timeout)
            rows.append(row)
            print(f"  {model_id} … {row['status']} {row['ms'] if row['ms'] is not None else ''} ms")
        print()

    print_table(rows)

    ok = sum(1 for r in rows if r["status"].startswith("HTTP 2"))
    print(f"\n{ok}/{len(rows)} request(s) succeeded.")
    return 0 if ok else 2


if __name__ == "__main__":
    sys.exit(main())
