# NovaCompute Admin Console (Rust)

Native desktop admin console for the NovaCompute backend. No Python, no browser.

## Build

```powershell
cd rust-console
cargo build --release
```

The executable is `target\release\novacompute-console.exe`.
Copy it together with `console_config.json` (created on first run) to any folder.

## Config (`console_config.json` next to the exe)

```json
{
  "project_root": "C:\\path\\to\\NovaCompute",
  "backend_url": "http://127.0.0.1:8080",
  "admin_email": "admin@novacompute.io",
  "admin_password": "NovaAdmin!2026"
}
```

`project_root` must contain `backend/users_db.json`, `backend/*_keys.json`
and `backend/custom_models.json`.

## What it manages

- **Dashboard** — users, active plans, revenue, requests/tokens today, provider key count.
- **Users & plans** — change plan, adjust balance, grant/revoke admin, ban/unban, delete account (with confirmation). Cannot delete yourself or the last admin.
- **Provider keys** — add/delete keys in every upstream key pool; the backend reads them live.
- **Models** — full live catalogue. Click **Edit** on any model, change input/output price (and other fields), then **Save custom model**. This writes `backend/custom_models.json`; the backend hot-reloads the override without restart.
- **Payments** — all top-ups, subscriptions and admin adjustments, plus PayPal order/bank event counts.
- **Settings** — project root, backend URL, admin credentials; copy login, open web console.

## Admin note

The same account opens the web console at `/admin.html`:

```
admin@novacompute.io
NovaAdmin!2026
```

The credentials are shown in the sidebar and on Dashboard/Settings, with Copy buttons.
Change the password with:

```powershell
python backend/create_admin.py admin@novacompute.io "NewStrongPassword!"
```

## Desktop install

The built app is copied to `Desktop\NovaCompute Admin\` with a shortcut
`Desktop\NovaCompute Admin.lnk` and a `README.txt` containing the admin login.
