#!/usr/bin/env python3
"""NovaCompute — model speed test.

Sends "Hello" to every model in app.py's catalogue, through the same
provider/key routing the API uses, measures round-trip latency and
prints a table. Results are also written to speed_results.txt.

Usage:
    python test_speed.py                 # default 30 s per request
    python test_speed.py --timeout 15
    python test_speed.py --model gpt-6-luna
"""

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import app  # noqa: E402  (local module, same folder)

RESULTS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "speed_results.txt")


def pick_key(provider_name):
    info = app.PROVIDERS.get(provider_name)
    if not info:
        return None
    keys = app.load_keys_from_file(info["keys_file"], info.get("fallback_key"))
    return keys[0] if keys else None


TRANSIENT_STATUSES = (429, 500, 502, 503, 504)


def call_model(model_id, timeout, retries=3, retry_delay=1.5):
    provider = app.MODEL_PROVIDER_MAP.get(model_id, app.DEFAULT_PROVIDER)
    info = app.PROVIDERS.get(provider)
    if not info:
        return {"status": "FAIL", "detail": f"provider '{provider}' not configured", "ms": 0, "tokens": 0}

    key = pick_key(provider)
    if not key:
        return {"status": "FAIL", "detail": f"no key for {provider}", "ms": 0, "tokens": 0}

    payload = {
        "model": model_id,
        "messages": [{"role": "user", "content": "Hello"}],
        "max_tokens": 16,
    }

    result = None
    for attempt in range(1, retries + 1):
        request = urllib.request.Request(
            info["url"],
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {key}",
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
            method="POST",
        )
        started = time.time()
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                raw = response.read()
            ms = int((time.time() - started) * 1000)
            data = json.loads(raw.decode("utf-8", "replace"))
            usage = data.get("usage") or {}
            tokens = (usage.get("prompt_tokens") or 0) + (usage.get("completion_tokens") or 0)
            text = ((data.get("choices") or [{}])[0].get("message") or {}).get("content") or ""
            if not isinstance(text, str):
                text = json.dumps(text, ensure_ascii=False)
            note = text.replace("\n", " ")[:40]
            if attempt > 1:
                note = f"(try {attempt}) " + note
            return {"status": "OK", "detail": note, "ms": ms, "tokens": tokens}
        except urllib.error.HTTPError as exc:
            ms = int((time.time() - started) * 1000)
            try:
                body = exc.read().decode("utf-8", "replace")[:120]
            except Exception:
                body = ""
            result = {"status": f"HTTP {exc.code}", "detail": body.replace("\n", " "), "ms": ms, "tokens": 0}
            if exc.code in TRANSIENT_STATUSES and attempt < retries:
                print(f"retry in {retry_delay}s... ", end="", flush=True)
                time.sleep(retry_delay)
                continue
            return result
        except Exception as exc:  # timeout, DNS, TLS...
            ms = int((time.time() - started) * 1000)
            result = {"status": "ERROR", "detail": str(exc)[:90], "ms": ms, "tokens": 0}
            if attempt < retries:
                print(f"retry in {retry_delay}s... ", end="", flush=True)
                time.sleep(retry_delay)
                continue
            return result

    return result or {"status": "FAIL", "detail": "no attempt", "ms": 0, "tokens": 0}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--timeout", type=int, default=30, help="per-request timeout in seconds")
    parser.add_argument("--model", help="only test one model id")
    parser.add_argument("--retries", type=int, default=3, help="attempts per model on transient errors")
    parser.add_argument("--delay", type=float, default=1.5, help="seconds between retries")
    args = parser.parse_args()

    models = [m for m in app.MODELS if not args.model or m["id"] == args.model]
    if not models:
        print(f"No models matched {args.model!r}")
        return 1

    lines = []
    lines.append("NovaCompute — model speed test")
    lines.append("time: " + datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                 + f"   timeout: {args.timeout}s   retry: {args.retries}x{args.delay}s on 429/5xx/timeout")
    lines.append("")
    header = f"{'MODEL':32s} {'PROVIDER':12s} {'STATUS':10s} {'LATENCY':>9s} {'TOK':>5s}  NOTE"
    lines.append(header)
    lines.append("-" * len(header))

    ok = 0
    latencies = []
    for index, model in enumerate(models, 1):
        provider = app.MODEL_PROVIDER_MAP.get(model["id"], app.DEFAULT_PROVIDER)
        print(f"[{index}/{len(models)}] {model['id']} -> {provider} ...", end="", flush=True)
        result = call_model(model["id"], args.timeout, args.retries, args.delay)
        if result["status"] == "OK":
            ok += 1
            latencies.append(result["ms"])
        row = (f"{model['id']:32s} {provider:12s} {result['status']:10s} "
               f"{str(result['ms']) + ' ms':>9s} {result['tokens']:>5d}  {result['detail']}")
        lines.append(row)
        print(f" {result['status']} {result['ms']}ms")

    lines.append("")
    summary = f"RESULT: {ok}/{len(models)} OK"
    if latencies:
        summary += f"   avg latency: {sum(latencies) // len(latencies)} ms   fastest: {min(latencies)} ms"
    lines.append(summary)

    output = "\n".join(lines)
    print("\n" + output)
    with open(RESULTS_FILE, "w", encoding="utf-8") as fh:
        fh.write(output + "\n")
    print(f"\nSaved to {RESULTS_FILE}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
