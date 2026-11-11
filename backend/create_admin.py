#!/usr/bin/env python3
"""Create or promote a NovaCompute admin account.

Usage:
    python backend/create_admin.py admin@example.com 'StrongPassword123!'
"""

import os
import secrets
import sys

import app


def main():
    if len(sys.argv) < 3:
        print("Usage: python backend/create_admin.py EMAIL PASSWORD")
        return 1
    email = sys.argv[1].strip().lower()
    password = sys.argv[2]
    if len(password) < 10:
        print("Password must be at least 10 characters.")
        return 1

    db = app.load_users()
    user = app.find_user_by_email(db, email)
    salt, digest = app.hash_password(password)
    if user:
        user["password_salt"] = salt
        user["password_hash"] = digest
        user["is_admin"] = True
        user["verified"] = True
        if not user.get("api_keys"):
            user["api_keys"] = [{
                "id": "key_" + secrets.token_hex(6), "name": "Admin",
                "key": app.new_api_key(), "created_at": app.iso(app.now_utc()),
                "last_used": None, "status": "active",
            }]
        action = "updated"
    else:
        key = app.new_api_key()
        user = {
            "id": "usr_" + secrets.token_hex(8), "name": "Administrator", "email": email,
            "company": "", "password_salt": salt, "password_hash": digest,
            "created_at": app.iso(app.now_utc()), "balance": 0.0, "plan": "free",
            "verified": True, "provider": "email", "is_admin": True,
            "api_keys": [{
                "id": "key_" + secrets.token_hex(6), "name": "Admin",
                "key": key, "created_at": app.iso(app.now_utc()),
                "last_used": None, "status": "active",
            }],
            "usage": [], "transactions": [],
        }
        db["users"].append(user)
        action = "created"
    app.save_users(db)
    print(f"Admin {action}: {email}")
    print(f"API key: {app.mask_key(user['api_keys'][0]['key'])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
