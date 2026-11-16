#!/usr/bin/env python3
"""Temporarily hide or restore all NightRouter models in the public catalogue.

Usage:
    python toggle_nightrouter_visibility.py hide
    python toggle_nightrouter_visibility.py show
    python toggle_nightrouter_visibility.py status

`hide` adds `"hidden": true` to every custom model whose upstream is
nightrouter, plus a hidden override for the base-only DeepSeek V4.1 row.
`show` removes only the flags/overrides it added; models that were already
hidden (for example Gemini 4 Argon) stay hidden.
"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
CUSTOM_FILE = BASE_DIR / "custom_models.json"
STATE_FILE = BASE_DIR / "nightrouter_hide_state.json"
BASE_ONLY_IDS = ["deepseek-v4.1-flash"]


def load_custom() -> list:
    data = json.loads(CUSTOM_FILE.read_text(encoding="utf-8"))
    if not isinstance(data, list):
        raise SystemExit("custom_models.json is not a list")
    return data


def save_custom(data: list) -> None:
    tmp = CUSTOM_FILE.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(CUSTOM_FILE)


def load_state() -> dict | None:
    try:
        return json.loads(STATE_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def hide() -> None:
    if load_state():
        print("Already hidden. Run `show` first to restore.")
        return
    custom = load_custom()
    newly_hidden = []
    preexisting = []
    for model in custom:
        if not isinstance(model, dict) or model.get("upstream") != "nightrouter":
            continue
        if model.get("hidden"):
            preexisting.append(model["id"])
            continue
        model["hidden"] = True
        newly_hidden.append(model["id"])

    existing_ids = {m.get("id") for m in custom if isinstance(m, dict)}
    base_overrides = []
    for model_id in BASE_ONLY_IDS:
        if model_id not in existing_ids:
            custom.append({"id": model_id, "hidden": True})
            base_overrides.append(model_id)

    save_custom(custom)
    state = {
        "hidden_at": datetime.now(timezone.utc).isoformat(),
        "newly_hidden": sorted(newly_hidden),
        "base_overrides": base_overrides,
        "preexisting_hidden": sorted(preexisting),
    }
    STATE_FILE.write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Hidden {len(newly_hidden)} custom NightRouter models + {len(base_overrides)} base override(s).")
    print("Newly hidden:", ", ".join(sorted(newly_hidden)) or "(none)")
    print("Already hidden:", ", ".join(sorted(preexisting)) or "(none)")


def show() -> None:
    state = load_state()
    if not state:
        print("No hide state found; nothing to restore.")
        return
    custom = load_custom()
    restore = set(state.get("newly_hidden") or [])
    for model in custom:
        if isinstance(model, dict) and model.get("id") in restore:
            model.pop("hidden", None)
    overrides = set(state.get("base_overrides") or [])
    custom = [
        m for m in custom
        if not (isinstance(m, dict) and m.get("id") in overrides and set(m) <= {"id", "hidden"})
    ]
    save_custom(custom)
    STATE_FILE.unlink(missing_ok=True)
    print(f"Restored {len(restore)} NightRouter models; removed {len(overrides)} base override(s).")


def status() -> None:
    state = load_state()
    if not state:
        print("NightRouter models are visible (no hide state).")
        return
    print("NightRouter models are hidden since", state.get("hidden_at"))
    print("Newly hidden:", len(state.get("newly_hidden") or []))
    print("Base overrides:", ", ".join(state.get("base_overrides") or []) or "(none)")


if __name__ == "__main__":
    action = (sys.argv[1] if len(sys.argv) > 1 else "status").lower()
    if action == "hide":
        hide()
    elif action == "show":
        show()
    elif action == "status":
        status()
    else:
        raise SystemExit("Usage: python toggle_nightrouter_visibility.py hide|show|status")
