#!/usr/bin/env python3
"""Seed a demo NovaCompute account with realistic (synthetic) usage.

Creates / resets:
    email:    demo@novacompute.io
    password: demo1234

Run once before testing the dashboard:
    python seed_demo.py

The usage rows are generated locally so the charts and tables have
something to display; they are clearly demo data, not real traffic.
"""

import json
import os
import random
import secrets
import time
from datetime import datetime, timedelta, timezone

import app

DB_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "users_db.json")
EMAIL = "demo@novacompute.io"
PASSWORD = "demo1234"
MODEL_POOL = [
    "glm-5.3-flash",
    "deepseek-v4.1-flash",
    "gpt-6-luna",
    "claude-sonnet-5-5-free",
    "qwen/qwen3.7-flash:free",
    "mercury-3",
]


def ts(days_ago, hour, minute, second=0):
    day = datetime.now(timezone.utc) - timedelta(days=days_ago)
    return int(day.replace(hour=hour, minute=minute, second=second, microsecond=0).timestamp())


def build_usage():
    rng = random.Random(42)
    usage = []
    for days_ago in range(13, -1, -1):
        events = rng.randint(4, 9)
        for _ in range(events):
            model = rng.choice(MODEL_POOL)
            prompt_tokens = rng.randint(300, 1800)
            completion_tokens = rng.randint(120, 900)
            price_in, price_out = app.PRICING[model]
            cost = (prompt_tokens * price_in + completion_tokens * price_out) / 1_000_000
            usage.append({
                "ts": ts(days_ago, rng.randint(8, 22), rng.randint(0, 59), rng.randint(0, 59)),
                "model": model,
                "prompt_tokens": prompt_tokens,
                "completion_tokens": completion_tokens,
                "latency_ms": rng.randint(60, 260),
                "status": "ok",
                "cost": round(cost, 6),
            })
    # one failed request (rate-limited upstream) for a bit of realism
    usage.append({
        "ts": ts(2, 15, 42, 10),
        "model": "gpt-6-luna",
        "prompt_tokens": 0,
        "completion_tokens": 0,
        "latency_ms": 431,
        "status": "error",
        "cost": 0.0,
    })
    return sorted(usage, key=lambda e: e["ts"])


def main():
    db = app.load_users()
    db["users"] = [u for u in db["users"] if u.get("email", "").lower() != EMAIL]

    salt, digest = app.hash_password(PASSWORD)
    usage = build_usage()

    transactions = [
        {"ts": ts(13, 9, 12, 0), "type": "topup", "description": "Demo top-up",
         "method": "Visa •••• 4242", "amount": 25.0},
        {"ts": ts(5, 11, 3, 0), "type": "topup", "description": "Demo top-up",
         "method": "Visa •••• 4242", "amount": 10.0},
    ]
    for event in usage[-24:]:
        if event["cost"]:
            transactions.append({
                "ts": event["ts"],
                "type": "usage",
                "description": f"API usage — {event['model']}",
                "method": "Balance",
                "amount": -event["cost"],
            })
    transactions.sort(key=lambda t: t["ts"])

    user = {
        "id": "usr_" + secrets.token_hex(8),
        "name": "Demo Developer",
        "email": EMAIL,
        "company": "Vertexa Labs",
        "password_salt": salt,
        "password_hash": digest,
        "created_at": app.iso(app.now_utc() - timedelta(days=14)),
        "balance": 0.0,
        "api_keys": [
            {"id": "key_" + secrets.token_hex(6), "name": "Production",
             "key": app.new_api_key(), "created_at": app.iso(app.now_utc() - timedelta(days=12)),
             "last_used": None, "status": "active"},
            {"id": "key_" + secrets.token_hex(6), "name": "Testing",
             "key": app.new_api_key(), "created_at": app.iso(app.now_utc() - timedelta(days=9)),
             "last_used": None, "status": "active"},
        ],
        "usage": usage,
        "transactions": transactions[-200:],
    }

    db["users"].append(user)
    app.save_users(db)

    print("Seeded demo account")
    print(f"  email    : {EMAIL}")
    print(f"  password : {PASSWORD}")
    print(f"  api key  : {app.mask_key(user['api_keys'][0]['key'])}")
    print(f"  usage    : {len(usage)} events over 14 days")
    print(f"  keys     : {len(user['api_keys'])}")


if __name__ == "__main__":
    main()
