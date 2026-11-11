#!/usr/bin/env python3
"""Create (or reset) the demo NovaCompute account with a clean ledger.

    email:    demo@novacompute.io
    password: demo1234

No synthetic usage or fake card top-ups are inserted. The dashboard starts at
$0.00 and every request shown there comes from a real API call made with the
demo account's key.
"""

import os
import secrets
from datetime import timedelta

import app

DB_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "users_db.json")
EMAIL = "demo@novacompute.io"
PASSWORD = "demo1234"


def main():
    db = app.load_users()
    db["users"] = [u for u in db["users"] if u.get("email", "").lower() != EMAIL]

    salt, digest = app.hash_password(PASSWORD)
    user = {
        "id": "usr_" + secrets.token_hex(8),
        "name": "Demo Developer",
        "email": EMAIL,
        "company": "",
        "password_salt": salt,
        "password_hash": digest,
        "created_at": app.iso(app.now_utc()),
        "balance": 0.0,
        "plan": "free",
        "verified": True,
        "provider": "email",
        "api_keys": [
            {"id": "key_" + secrets.token_hex(6), "name": "Default",
             "key": app.new_api_key(), "created_at": app.iso(app.now_utc()),
             "last_used": None, "status": "active"},
        ],
        "usage": [],
        "transactions": [],
    }

    db["users"].append(user)
    app.save_users(db)

    print("Demo account ready (clean ledger)")
    print(f"  email    : {EMAIL}")
    print(f"  password : {PASSWORD}")
    print(f"  api key  : {app.mask_key(user['api_keys'][0]['key'])}")
    print("  usage    : 0 (fills from real API calls only)")


if __name__ == "__main__":
    main()
