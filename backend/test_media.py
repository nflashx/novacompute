#!/usr/bin/env python3
"""NovaCompute — deep media capability test.

For every model:
  IMAGE: send a solid-red PNG and ask "What is the main color?"
         -> Yes if answered and the reply mentions red/pink
         -> Yes? if HTTP 200 but the color was not recognised
         -> No if the endpoint rejects the image part
  VIDEO: send a 1 s solid-red MP4 (video_url part, then input_video,
         then Anthropic-style block) and ask the same question.

Schemas tried per model, in order:
  image: OpenAI image_url -> Anthropic {type:image, source:{...}}
  video: OpenAI video_url -> OpenAI input_video
Transient 429/5xx retried twice (1.5 s).

Writes media_results.json + prints a table.
Usage: python test_media.py [--model id] [--timeout 30]
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

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import app  # noqa: E402

OUT_JSON = os.path.join(os.path.dirname(os.path.abspath(__file__)), "media_results.json")
TRANSIENT = (429, 500, 502, 503, 504)
RED_WORDS = ("red", "pink", "đỏ", "do", "crimson", "scarlet")


def provider_key(name):
    info = app.PROVIDERS.get(name)
    if not info:
        return None, None
    keys = app.load_keys_from_file(info["keys_file"], info.get("fallback_key"))
    return (keys[0] if keys else None), info


def ffmpeg_make(args, out_path):
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        return False
    try:
        subprocess.run([ffmpeg, "-y", "-loglevel", "error", *args, out_path],
                       check=True, timeout=25,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return os.path.exists(out_path)
    except Exception:
        return False


def build_samples():
    tmp = tempfile.gettempdir()
    png = os.path.join(tmp, "nova_red_64.png")
    mp4 = os.path.join(tmp, "nova_red_1s.mp4")
    if not os.path.exists(png):
        ffmpeg_make(["-f", "lavfi", "-i", "color=c=red:s=64x64", "-frames:v", "1"], png)
    if not os.path.exists(mp4):
        ffmpeg_make(["-f", "lavfi", "-i", "color=c=red:s=32x32:d=1:r=10",
                     "-pix_fmt", "yuv420p", "-movflags", "+faststart"], mp4)
    png_b64 = base64.b64encode(open(png, "rb").read()).decode() if os.path.exists(png) else None
    mp4_b64 = base64.b64encode(open(mp4, "rb").read()).decode() if os.path.exists(mp4) else None
    return png_b64, mp4_b64


def post(url, key, payload, timeout):
    req = urllib.request.Request(
        url, data=json.dumps(payload).encode(),
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        method="POST")
    started = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read(), int((time.time() - started) * 1000)
    except urllib.error.HTTPError as e:
        try:
            body = e.read()
        except Exception:
            body = b""
        return e.code, body, int((time.time() - started) * 1000)


def ask_content(model, info, key, content, timeout, retries=2):
    payload = {"model": model, "messages": [{"role": "user", "content": content}], "max_tokens": 32}
    for attempt in range(1, retries + 1):
        try:
            status, raw, _ = post(info["url"], key, payload, timeout)
        except Exception:
            return 0, ""
        body = raw.decode("utf-8", "replace")
        if status in TRANSIENT and attempt < retries:
            time.sleep(1.5)
            continue
        return status, body
    return status, body


def reply_text(body):
    try:
        data = json.loads(body)
        text = ((data.get("choices") or [{}])[0].get("message") or {}).get("content") or ""
        if not isinstance(text, str):
            text = json.dumps(text, ensure_ascii=False)
        return text
    except Exception:
        return ""


def recognises_red(text):
    lowered = text.lower()
    return any(w in lowered for w in RED_WORDS)


def image_variants(png_b64):
    data_url = f"data:image/png;base64,{png_b64}"
    return [
        ("openai", [{"type": "text", "text": "What is the main color of this image? One word."},
                    {"type": "image_url", "image_url": {"url": data_url}}]),
        ("anthropic", [{"type": "text", "text": "What is the main color of this image? One word."},
                       {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": png_b64}}]),
    ]


def video_variants(mp4_b64):
    data_url = f"data:video/mp4;base64,{mp4_b64}"
    return [
        ("video_url", [{"type": "text", "text": "What is the main color in this video? One word."},
                       {"type": "video_url", "video_url": {"url": data_url}}]),
        ("input_video", [{"type": "text", "text": "What is the main color in this video? One word."},
                         {"type": "input_video", "input_video": {"data": data_url}}]),
    ]


def test_model(model_id, timeout, png_b64, mp4_b64):
    provider = app.MODEL_PROVIDER_MAP.get(model_id, app.DEFAULT_PROVIDER)
    key, info = provider_key(provider)
    result = {"model": model_id, "provider": provider, "image": "?", "image_detail": "",
              "video": "?", "video_detail": ""}
    if not (key and info):
        result["image_detail"] = result["video_detail"] = "no key/provider"
        return result

    if png_b64:
        for schema, content in image_variants(png_b64):
            status, body = ask_content(model_id, info, key, content, timeout)
            if status == 200:
                text = reply_text(body)
                result["image"] = "Yes" if recognises_red(text) else "Yes?"
                result["image_detail"] = f"{schema}: 200 | {text.replace(chr(10), ' ')[:60]}"
                break
            result["image_detail"] = f"{schema}: HTTP {status} | {body[:90]}"
    else:
        result["image_detail"] = "sample png missing"

    if mp4_b64:
        for schema, content in video_variants(mp4_b64):
            status, body = ask_content(model_id, info, key, content, timeout)
            if status == 200:
                text = reply_text(body)
                result["video"] = "Yes" if recognises_red(text) else "Yes?"
                result["video_detail"] = f"{schema}: 200 | {text.replace(chr(10), ' ')[:60]}"
                break
            result["video_detail"] = f"{schema}: HTTP {status} | {body[:90]}"
    else:
        result["video_detail"] = "sample mp4 missing"

    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model")
    parser.add_argument("--timeout", type=int, default=30)
    args = parser.parse_args()

    models = [m for m in app.MODELS if not args.model or m["id"] == args.model]
    png_b64, mp4_b64 = build_samples()
    print(f"samples: png={bool(png_b64)} mp4={bool(mp4_b64)}")
    rows = []
    for i, m in enumerate(models, 1):
        print(f"[{i}/{len(models)}] {m['id']} ...", end="", flush=True)
        r = test_model(m["id"], args.timeout, png_b64, mp4_b64)
        rows.append(r)
        print(f" IMG={r['image']} VID={r['video']}")

    print("\nMODEL                          PROVIDER     IMG   VID   DETAIL")
    print("-" * 110)
    for r in rows:
        detail = (r["image_detail"] if r["image"] not in ("Yes", "Yes?") else r["video_detail"]) or ""
        print(f"{r['model']:30s} {r['provider']:12s} {r['image']:4s}  {r['video']:4s}  {detail[:60]}")

    with open(OUT_JSON, "w", encoding="utf-8") as fh:
        json.dump(rows, fh, ensure_ascii=False, indent=2)
    print(f"\nSaved to {OUT_JSON}")


if __name__ == "__main__":
    main()
