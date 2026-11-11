#!/usr/bin/env python3
"""NovaCompute — full model probe: latency, context, image/video support.

For every model in app.py MODELS:
  * one "Hello" completion (retries transient 429/5xx/timeouts after 1.5 s)
  * real context length from the provider's GET /v1/models when published,
    otherwise the catalogue value (marked "cat")
  * image probe: tiny inline PNG through an OpenAI-style image_url part
  * video probe: tiny generated MP4 through a video_url part (ffmpeg)

Results are printed and written to speed_results.txt + speed_results.json.
Probe verdicts are Yes / No / ?  ("?" = provider answered ambiguously).

Usage:
    python test_speed.py
    python test_speed.py --no-media          # latency + context only
    python test_speed.py --model grok-4.6
"""

import argparse
import base64
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import app  # noqa: E402

RESULTS_TXT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "speed_results.txt")
RESULTS_JSON = os.path.join(os.path.dirname(os.path.abspath(__file__)), "speed_results.json")

TRANSIENT_STATUSES = (429, 500, 502, 503, 504)

# 1x1 red PNG
TINY_PNG_B64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)


# ---------------------------------------------------------------------------
# Provider helpers
# ---------------------------------------------------------------------------

def provider_key(provider_name):
    info = app.PROVIDERS.get(provider_name)
    if not info:
        return None, None
    keys = app.load_keys_from_file(info["keys_file"], info.get("fallback_key"))
    return (keys[0] if keys else None), info


def provider_models_meta(provider_name, timeout=15):
    """Return {model_id: meta} from the provider's GET /v1/models (best effort)."""
    key, info = provider_key(provider_name)
    base = info["url"].split("/chat/completions")[0]
    request = urllib.request.Request(base + "/models", headers={"Authorization": f"Bearer {key}"})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            payload = json.loads(response.read().decode("utf-8", "replace"))
    except Exception:
        return {}
    items = payload.get("data") or payload.get("models") or []
    meta = {}
    for item in items:
        if isinstance(item, dict) and item.get("id"):
            meta[str(item["id"])] = item
    return meta


def modality_flags(meta):
    """Pull explicit modality info if the provider publishes it."""
    if not meta:
        return None
    modalities = meta.get("input_modalities") or meta.get("modalities") or []
    if isinstance(modalities, dict):
        modalities = modalities.get("input") or []
    if isinstance(modalities, list) and modalities:
        lowered = {str(m).lower() for m in modalities}
        return {"image": "image" in lowered or "vision" in lowered,
                "video": "video" in lowered, "explicit": True}

    capabilities = meta.get("capabilities")
    if isinstance(capabilities, dict):
        flags = {"explicit": True}
        if "images" in capabilities:
            flags["image"] = bool(capabilities["images"])
        elif "vision" in capabilities:
            flags["image"] = bool(capabilities["vision"])
        else:
            flags["image"] = None
        flags["video"] = bool(capabilities.get("video")) if "video" in capabilities else None
        return flags
    return None


# ---------------------------------------------------------------------------
# Calls / probes
# ---------------------------------------------------------------------------

def _post(url, key, payload, timeout):
    request = urllib.request.Request(
        url,
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
            return response.status, response.read(), int((time.time() - started) * 1000)
    except urllib.error.HTTPError as exc:
        try:
            body = exc.read()
        except Exception:
            body = b""
        return exc.code, body, int((time.time() - started) * 1000)


def call_model(model_id, timeout, retries, retry_delay):
    provider = app.MODEL_PROVIDER_MAP.get(model_id, app.DEFAULT_PROVIDER)
    key, info = provider_key(provider)
    if not info:
        return {"status": "FAIL", "detail": f"provider '{provider}' not configured", "ms": 0, "tokens": 0}
    if not key:
        return {"status": "FAIL", "detail": f"no key for {provider}", "ms": 0, "tokens": 0}

    payload = {"model": model_id, "messages": [{"role": "user", "content": "Hello"}], "max_tokens": 16}
    result = None
    for attempt in range(1, retries + 1):
        status, raw, ms = _post(info["url"], key, payload, timeout)
        if status == 200:
            try:
                data = json.loads(raw.decode("utf-8", "replace"))
            except ValueError:
                data = {}
            usage = data.get("usage") or {}
            tokens = (usage.get("prompt_tokens") or 0) + (usage.get("completion_tokens") or 0)
            text = ((data.get("choices") or [{}])[0].get("message") or {}).get("content") or ""
            if not isinstance(text, str):
                text = json.dumps(text, ensure_ascii=False)
            note = text.replace("\n", " ")[:40]
            if attempt > 1:
                note = f"(try {attempt}) " + note
            return {"status": "OK", "detail": note, "ms": ms, "tokens": tokens}

        body = raw.decode("utf-8", "replace")[:110].replace("\n", " ")
        result = {"status": f"HTTP {status}", "detail": body, "ms": ms, "tokens": 0}
        if status in TRANSIENT_STATUSES and attempt < retries:
            time.sleep(retry_delay)
            continue
        return result
    return result or {"status": "FAIL", "detail": "no attempt", "ms": 0, "tokens": 0}


def _probe_verdict(status, body_text):
    if status == 200:
        return "Yes"
    lowered = body_text.lower()
    if status in (400, 404, 415, 422):
        if any(word in lowered for word in ("image", "vision", "video", "modality", "unsupported", "content type", "invalid content")):
            return "No"
        return "No"
    return "?"


def probe_media(model_id, timeout, media_b64, mime, part_type, key_name="url", retries=2, delay=1.5):
    provider = app.MODEL_PROVIDER_MAP.get(model_id, app.DEFAULT_PROVIDER)
    key, info = provider_key(provider)
    if not info or not key:
        return "?"
    data_url = f"data:{mime};base64,{media_b64}"
    content = [
        {"type": "text", "text": "Describe this briefly."},
        {"type": part_type, part_type: {key_name: data_url}},
    ]
    payload = {"model": model_id, "messages": [{"role": "user", "content": content}], "max_tokens": 8}
    verdict = "?"
    for attempt in range(1, retries + 1):
        try:
            status, raw, _ms = _post(info["url"], key, payload, timeout)
        except Exception:
            return "?"
        body = raw.decode("utf-8", "replace")
        verdict = _probe_verdict(status, body[:300])
        if status in TRANSIENT_STATUSES and attempt < retries:
            time.sleep(delay)
            continue
        return verdict
    return verdict


def make_tiny_mp4():
    """Generate a ~2 KB mp4 with ffmpeg; return base64 or None."""
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        return None
    path = os.path.join(tempfile.gettempdir(), "nova_probe_16x16.mp4")
    if not os.path.exists(path):
        try:
            subprocess.run(
                [ffmpeg, "-y", "-loglevel", "error", "-f", "lavfi",
                 "-i", "color=c=red:s=16x16:d=0.4:r=10", "-pix_fmt", "yuv420p",
                 "-movflags", "+faststart", path],
                check=True, timeout=20,
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            )
        except Exception:
            return None
    try:
        with open(path, "rb") as fh:
            return base64.b64encode(fh.read()).decode("ascii")
    except OSError:
        return None


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--timeout", type=int, default=35)
    parser.add_argument("--retries", type=int, default=3)
    parser.add_argument("--delay", type=float, default=1.5)
    parser.add_argument("--model", help="only test one model id")
    parser.add_argument("--no-media", action="store_true", help="skip image/video probes")
    args = parser.parse_args()

    models = [m for m in app.MODELS if not args.model or m["id"] == args.model]
    if not models:
        print(f"No models matched {args.model!r}")
        return 1

    need_media = not args.no_media
    mp4_b64 = make_tiny_mp4() if need_media else None

    # provider metadata (context + explicit modalities), one request per provider
    providers = sorted({app.MODEL_PROVIDER_MAP.get(m["id"], app.DEFAULT_PROVIDER) for m in models})
    meta = {}
    for provider in providers:
        meta[provider] = provider_models_meta(provider)
        print(f"[meta] {provider}: {len(meta[provider])} model entries", flush=True)

    lines = []
    lines.append("NovaCompute — model probe (latency | context | image/video)")
    lines.append("time: " + datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                 + f"   timeout: {args.timeout}s   retry: {args.retries}x{args.delay}s")
    lines.append("context: meta = provider /v1/models | cat = catalogue value")
    lines.append("media: Yes/No = live 1x1 PNG + 0.4s MP4 probe | Yes*/No* = provider capability metadata" if need_media else "media: skipped")
    lines.append("")
    header = (f"{'MODEL':30s} {'PROVIDER':11s} {'STATUS':9s} {'MS':>7s} {'TOK':>4s} "
              f"{'CONTEXT':12s} {'IMG':>4s} {'VID':>4s}")
    lines.append(header)
    lines.append("-" * len(header))

    ok = 0
    latencies = []
    json_rows = []

    for index, model in enumerate(models, 1):
        model_id = model["id"]
        provider = app.MODEL_PROVIDER_MAP.get(model_id, app.DEFAULT_PROVIDER)
        provider_meta = meta.get(provider, {})
        entry_meta = provider_meta.get(model_id) or {}

        print(f"[{index}/{len(models)}] {model_id} -> {provider} ...", end="", flush=True)
        result = call_model(model_id, args.timeout, args.retries, args.delay)
        if result["status"] == "OK":
            ok += 1
            latencies.append(result["ms"])

        # context
        ctx_value = entry_meta.get("context_length") or entry_meta.get("max_context_length")
        if ctx_value:
            try:
                ctx_num = int(ctx_value)
                ctx_text = f"{ctx_num/1e6:.0f}M" if ctx_num >= 1_000_000 else f"{ctx_num//1000}K"
                ctx_text += " meta"
            except (TypeError, ValueError):
                ctx_text = f"{ctx_value} meta"
        else:
            ctx_text = f"{model.get('context', '—')} cat"

        # media probes (metadata wins where the provider publishes it)
        img = vid = "-"
        modalities = modality_flags(entry_meta) or {}
        if need_media:
            if modalities.get("image") is True:
                img = "Yes*"
            elif modalities.get("image") is False:
                img = "No*"
            else:
                img = probe_media(model_id, min(args.timeout, 25), TINY_PNG_B64, "image/png", "image_url")
            if mp4_b64 is None:
                vid = "?"
            elif modalities.get("video") is True:
                vid = "Yes*"
            elif modalities.get("video") is False:
                vid = "No*"
            else:
                vid = probe_media(model_id, min(args.timeout, 25), mp4_b64, "video/mp4", "video_url")

        row = (f"{model_id:30s} {provider:11s} {result['status']:9s} {result['ms']:7d} "
               f"{result['tokens']:4d} {ctx_text:12s} {img:>4s} {vid:>4s}")
        lines.append(row)
        json_rows.append({
            "model": model_id,
            "provider": provider,
            "status": result["status"],
            "latency_ms": result["ms"],
            "tokens": result["tokens"],
            "context": ctx_text,
            "image": img,
            "video": vid,
            "note": result["detail"],
        })
        print(f" {result['status']} {result['ms']}ms ctx={ctx_text} img={img} vid={vid}", flush=True)

    lines.append("")
    summary = f"RESULT: {ok}/{len(models)} OK"
    if latencies:
        summary += f"   avg latency: {sum(latencies)//len(latencies)} ms   fastest: {min(latencies)} ms"
    lines.append(summary)

    output = "\n".join(lines)
    print("\n" + output)
    with open(RESULTS_TXT, "w", encoding="utf-8") as fh:
        fh.write(output + "\n")
    with open(RESULTS_JSON, "w", encoding="utf-8") as fh:
        json.dump({"generated_at": datetime.now().isoformat(timespec="seconds"), "rows": json_rows}, fh, ensure_ascii=False, indent=2)
    print(f"\nSaved to {RESULTS_TXT} and {RESULTS_JSON}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
