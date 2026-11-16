#!/usr/bin/env python3
"""Local OpenAI-compatible bridge for YuE2 Studio's Writing Assistant.

YuE2 runs on this PC and calls a "local server" at 127.0.0.1:1234/v1.
This bridge accepts those calls and forwards them to NovaRouter's
Kimi K3.1 Pro endpoint with the real API key kept in local_api/config.json.

Only binds to 127.0.0.1. Run:
    python local_api/yue2_proxy.py
"""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

BASE_DIR = Path(__file__).resolve().parent
CONFIG_PATH = BASE_DIR / "config.json"


def load_config() -> dict:
    config = {}
    if CONFIG_PATH.exists():
        config = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    env_map = {
        "upstream_base": "NOVA_UPSTREAM_BASE",
        "upstream_key": "NOVA_UPSTREAM_KEY",
        "model": "NOVA_MODEL",
        "local_key": "NOVA_LOCAL_KEY",
        "port": "NOVA_LOCAL_PORT",
    }
    for key, env_name in env_map.items():
        value = os.getenv(env_name)
        if value:
            config[key] = value
    return config


CONFIG = load_config()
UPSTREAM_BASE = str(CONFIG.get("upstream_base", "https://novarouter.cc.cd/v1")).rstrip("/")
UPSTREAM_KEY = str(CONFIG.get("upstream_key", "")).strip()
MODEL = str(CONFIG.get("model", "kimi-k3.1-pro")).strip()
LOCAL_KEY = str(CONFIG.get("local_key", "nova-local")).strip()
HOST = "127.0.0.1"
PORT = int(CONFIG.get("port", 1234))


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "NovaLocal/1.0"

    def log_message(self, fmt, *args):
        # Keep the console readable; never log prompts or API keys.
        sys.stderr.write("[yue2] " + (fmt % args) + "\n")

    def _cors(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Max-Age", "86400")

    def _json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self._cors()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _path(self) -> str:
        return urlparse(self.path).path.rstrip("/").lower()

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self._cors()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self) -> None:
        path = self._path()
        if path.endswith("/models") or path == "/models":
            names = [MODEL]
            if MODEL.endswith("-pro"):
                names.append(MODEL + "-free")
            self._json(200, {
                "object": "list",
                "data": [
                    {
                        "id": name,
                        "object": "model",
                        "created": int(time.time()),
                        "owned_by": "novarouter",
                        "name": name,
                    }
                    for name in names
                ],
            })
            return
        if path in ("", "/", "/health"):
            self._json(200, {
                "status": "ok",
                "service": "nova-local-yue2",
                "model": MODEL,
                "upstream": UPSTREAM_BASE,
            })
            return
        self._json(404, {"error": {"message": "Not found", "type": "not_found"}})

    def do_POST(self) -> None:
        path = self._path()
        if not path.endswith("/chat/completions"):
            self._json(404, {
                "error": {
                    "message": "This local bridge only serves POST /v1/chat/completions",
                    "type": "not_found",
                }
            })
            return
        try:
            length = int(self.headers.get("Content-Length", "0") or "0")
        except ValueError:
            length = 0
        raw = self.rfile.read(max(0, length))
        try:
            payload = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            self._json(400, {"error": {"message": "Request body must be valid JSON", "type": "invalid_request"}})
            return
        if not isinstance(payload, dict):
            self._json(400, {"error": {"message": "Request body must be a JSON object", "type": "invalid_request"}})
            return

        original_model = str(payload.get("model", ""))
        payload["model"] = MODEL
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        target = UPSTREAM_BASE + "/chat/completions"
        request = urllib.request.Request(
            target,
            data=body,
            method="POST",
            headers={
                "Authorization": "Bearer " + UPSTREAM_KEY,
                "Content-Type": "application/json",
                "Accept": self.headers.get("Accept", "*/*"),
                # Cloudflare rejects default Python-urllib user agents.
                "User-Agent": "OpenAI/Python 1.0",
            },
        )
        started = time.time()
        try:
            upstream = urllib.request.urlopen(request, timeout=300)
        except urllib.error.HTTPError as exc:
            data = exc.read()
            elapsed = int((time.time() - started) * 1000)
            print(f"[yue2] {original_model or '-'} -> {MODEL} HTTP {exc.code} {elapsed}ms", flush=True)
            self.send_response(exc.code)
            self._cors()
            self.send_header("Content-Type", exc.headers.get("Content-Type", "application/json"))
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(data)
            return
        except Exception as exc:  # network/timeout
            elapsed = int((time.time() - started) * 1000)
            print(f"[yue2] {original_model or '-'} -> {MODEL} network error {elapsed}ms: {type(exc).__name__}", flush=True)
            self._json(502, {"error": {"message": f"Upstream unavailable: {type(exc).__name__}", "type": "upstream_error"}})
            return

        with upstream:
            status = upstream.status
            content_type = upstream.headers.get("Content-Type", "application/json")
            self.send_response(status)
            self._cors()
            self.send_header("Content-Type", content_type)
            self.send_header("Cache-Control", "no-store")
            streaming = "text/event-stream" in content_type.lower()
            if streaming:
                self.send_header("Connection", "close")
                self.end_headers()
                self.close_connection = True
                try:
                    while True:
                        chunk = upstream.read(4096)
                        if not chunk:
                            break
                        self.wfile.write(chunk)
                        self.wfile.flush()
                except (BrokenPipeError, ConnectionResetError):
                    pass
            else:
                data = upstream.read()
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)
        elapsed = int((time.time() - started) * 1000)
        print(f"[yue2] {original_model or '-'} -> {MODEL} HTTP {status} {elapsed}ms", flush=True)


def main() -> int:
    if not UPSTREAM_KEY:
        print("Missing upstream_key in local_api/config.json", file=sys.stderr)
        return 1
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"Nova local bridge ready: http://{HOST}:{PORT}/v1", flush=True)
    print(f"Model: {MODEL}  |  Local API key: {LOCAL_KEY}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
