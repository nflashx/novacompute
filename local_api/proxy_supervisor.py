#!/usr/bin/env python3
"""Keep the YuE2 local bridge alive on 127.0.0.1:1234.

Started at logon by Windows Task Scheduler (task `NovaLocalYuE2Proxy`).
If the bridge dies, this supervisor starts it again after a few seconds.
"""
from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
PROXY = BASE_DIR / "yue2_proxy.py"
CONFIG = BASE_DIR / "config.json"
LOG = BASE_DIR / "proxy.log"


def configured_port() -> int:
    try:
        return int(json.loads(CONFIG.read_text(encoding="utf-8")).get("port", 1234))
    except (OSError, ValueError, TypeError, json.JSONDecodeError):
        return 1234


PORT = configured_port()


def log(message: str) -> None:
    stamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    try:
        with LOG.open("a", encoding="utf-8") as fh:
            fh.write(f"[{stamp}] {message}\n")
    except OSError:
        pass


def port_open() -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.5)
        return sock.connect_ex(("127.0.0.1", PORT)) == 0


def main() -> int:
    log("supervisor started")
    child = None
    while True:
        try:
            if child is not None and child.poll() is not None:
                log(f"bridge exited with code {child.returncode}")
                child = None
            if child is None and not port_open():
                log("starting bridge")
                with LOG.open("a", encoding="utf-8") as fh:
                    child = subprocess.Popen(
                        [sys.executable, "-u", str(PROXY)],
                        cwd=str(BASE_DIR),
                        stdin=subprocess.DEVNULL,
                        stdout=fh,
                        stderr=subprocess.STDOUT,
                        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
                    )
                time.sleep(2)
            time.sleep(5)
        except KeyboardInterrupt:
            break
        except Exception as exc:  # never let the supervisor die
            log(f"supervisor error: {type(exc).__name__}: {exc}")
            time.sleep(5)
    if child is not None and child.poll() is None:
        child.terminate()
    log("supervisor stopped")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
