#!/usr/bin/env python3
"""NovaCompute — Admin Console (tkinter, no web).

Three tabs:
    API Keys  — manage NightRouter / ExosAI key files (add / delete / status)
    Models    — catalogue + add custom models (written to custom_models.json)
    Settings  — file paths, backend health check, hot-reload notes

Run:  python admin_app.py

Notes
    * Keys are stored exactly in the files the backend reads
      (backend/nightrouter_keys.json, backend/exosai_keys.json).
      The backend reads them on every request, so key changes are live.
    * Models are stored in backend/custom_models.json; the backend reloads
      that file when its mtime changes (refresh_models), so no restart.
    * The app never sends keys anywhere; the only network call is the
      optional localhost health check on :8080.
"""

import json
import os
import re
import sys
import urllib.error
import urllib.request
from datetime import datetime

import tkinter as tk
from tkinter import ttk, messagebox

# ---------------------------------------------------------------------------
# Paths & theme
# ---------------------------------------------------------------------------

APP_DIR = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.join(APP_DIR, "backend") if os.path.isdir(os.path.join(APP_DIR, "backend")) else APP_DIR

KEY_FILES = {
    "nightrouter": os.path.join(BACKEND_DIR, "nightrouter_keys.json"),
    "exosai": os.path.join(BACKEND_DIR, "exosai_keys.json"),
}
CUSTOM_MODELS_FILE = os.path.join(BACKEND_DIR, "custom_models.json")
BACKEND_URL = os.getenv("NOVA_BACKEND_URL", "http://127.0.0.1:8080").rstrip("/")

BG = "#05070e"
PANEL = "#0b1120"
CARD = "#101830"
LINE = "#1d2740"
TEXT = "#e2e8f0"
MUTED = "#94a3b8"
ACCENT = "#7c3aed"
ACCENT_HOVER = "#6d28d9"
OK = "#34d399"
ERR = "#f87171"
WARN = "#fbbf24"
CYAN = "#22d3ee"

FONT = ("Segoe UI", 10)
FONT_BOLD = ("Segoe UI", 10, "bold")
FONT_TITLE = ("Segoe UI Semibold", 16)
FONT_MONO = ("Consolas", 9)

MODEL_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:/@-]*$")


# ---------------------------------------------------------------------------
# File helpers (pure functions — unit-testable without the GUI)
# ---------------------------------------------------------------------------

def _read_json(path, default):
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, json.JSONDecodeError):
        return default


def _write_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = f"{path}.tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


def mask_key(value):
    if not value:
        return ""
    value = str(value)
    if len(value) <= 14:
        return value[:4] + "…"
    return f"{value[:10]}…{value[-4:]}"


def load_key_entries(path):
    """Return a list of key entries (dicts or plain strings)."""
    data = _read_json(path, [])
    if isinstance(data, dict):
        data = data.get("keys", [])
    if not isinstance(data, list):
        return []
    return [e for e in data if isinstance(e, (dict, str))]


def key_value(entry):
    if isinstance(entry, dict):
        return str(entry.get("api_key") or entry.get("key") or "")
    return str(entry)


def key_status(entry):
    if isinstance(entry, dict):
        return str(entry.get("status") or "active").lower()
    return "active"


def key_label(entry):
    if not isinstance(entry, dict):
        return ""
    for field in ("label", "email", "username", "name"):
        value = entry.get(field)
        if value:
            return str(value)
    return ""


def add_key_entry(path, api_key, label=""):
    api_key = api_key.strip()
    if not api_key:
        raise ValueError("Key must not be empty.")
    entries = load_key_entries(path)
    if any(key_value(e) == api_key for e in entries):
        raise ValueError("This key already exists in the file.")
    entry = {"api_key": api_key, "status": "active"}
    if label.strip():
        entry["label"] = label.strip()
    entries.append(entry)
    _write_json(path, entries)
    return entry


def delete_key_entry(path, api_key):
    entries = load_key_entries(path)
    remaining = [e for e in entries if key_value(e) != api_key]
    if len(remaining) == len(entries):
        return False
    _write_json(path, remaining)
    return True


def set_key_status(path, api_key, status):
    entries = load_key_entries(path)
    changed = False
    for idx, entry in enumerate(entries):
        if key_value(entry) != api_key:
            continue
        if isinstance(entry, dict):
            entry["status"] = status
        else:
            entries[idx] = {"api_key": entry, "status": status}
        changed = True
    if changed:
        _write_json(path, entries)
    return changed


def load_custom_models(path=CUSTOM_MODELS_FILE):
    data = _read_json(path, [])
    return [m for m in data if isinstance(m, dict) and m.get("id")] if isinstance(data, list) else []


def add_custom_model(path, model):
    model_id = str(model.get("id", "")).strip()
    if not MODEL_ID_RE.match(model_id):
        raise ValueError("Model ID may only contain letters, digits and . _ : / @ -")
    if not str(model.get("name", "")).strip():
        raise ValueError("Model name is required.")
    try:
        price_in = float(model.get("input", 0) or 0)
        price_out = float(model.get("output", 0) or 0)
    except (TypeError, ValueError):
        raise ValueError("Prices must be numbers.")
    if price_in < 0 or price_out < 0:
        raise ValueError("Prices cannot be negative.")

    models = load_custom_models(path)
    if any(m["id"] == model_id for m in models):
        raise ValueError("A custom model with this ID already exists.")
    if any(m["id"] == model_id for m in get_builtin_models()):
        raise ValueError("This ID already exists in the built-in catalogue.")

    entry = {
        "id": model_id,
        "name": str(model["name"]).strip(),
        "provider": str(model.get("provider", "")).strip() or "Custom",
        "context": str(model.get("context", "")).strip() or "128K",
        "speed": int(model.get("speed", 100) or 100),
        "input": round(price_in, 4),
        "output": round(price_out, 4),
        "upstream": str(model.get("upstream", "")).strip() or "nightrouter",
    }
    models.append(entry)
    _write_json(path, models)
    return entry


def delete_custom_model(path, model_id):
    models = load_custom_models(path)
    remaining = [m for m in models if m["id"] != model_id]
    if len(remaining) == len(models):
        return False
    _write_json(path, remaining)
    return True


def get_builtin_models():
    """Read the built-in catalogue from backend/app.py (import-safe)."""
    try:
        if BACKEND_DIR not in sys.path:
            sys.path.insert(0, BACKEND_DIR)
        import app as backend_app  # noqa: WPS433 (deliberate lazy import)
        return [dict(m) for m in getattr(backend_app, "MODELS", [])]
    except Exception:
        return []


# ---------------------------------------------------------------------------
# GUI
# ---------------------------------------------------------------------------

def _dark_button(parent, text, command, primary=False, small=False):
    bg = ACCENT if primary else CARD
    hover = ACCENT_HOVER if primary else LINE
    return tk.Button(
        parent, text=text, command=command,
        bg=bg, fg="#ffffff" if primary else TEXT,
        activebackground=hover, activeforeground="#ffffff",
        relief="flat", bd=0, cursor="hand2",
        font=("Segoe UI", 9, "bold" if primary else "normal"),
        padx=12 if not small else 8, pady=6 if not small else 3,
        highlightthickness=1, highlightbackground=LINE if not primary else ACCENT,
    )


class AdminConsole(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("NovaCompute — Admin Console")
        self.configure(bg=BG)
        self.geometry(self._centered(1060, 690))
        self.minsize(940, 580)

        self.reveal_keys = tk.BooleanVar(value=False)
        self.key_rows = {"nightrouter": {}, "exosai": {}}
        self.model_rows = {}

        self._setup_style()
        self._build_header()
        self._build_tabs()
        self._build_statusbar()

        self.bind("<F5>", lambda _e: self.refresh_all())
        self.refresh_all()

    def _centered(self, width, height):
        screen_w = self.winfo_screenwidth()
        screen_h = self.winfo_screenheight()
        x = max(0, (screen_w - width) // 2)
        y = max(0, (screen_h - height) // 3)
        return f"{width}x{height}+{x}+{y}"

    # ---------------- styling ----------------
    def _setup_style(self):
        style = ttk.Style(self)
        style.theme_use("clam")
        style.configure(".", background=BG, foreground=TEXT, fieldbackground=PANEL, bordercolor=LINE, font=FONT)
        style.configure("TNotebook", background=BG, borderwidth=0)
        style.configure("TNotebook.Tab", background=PANEL, foreground=MUTED, padding=(20, 9), font=FONT_BOLD)
        style.map("TNotebook.Tab",
                  background=[("selected", CARD)],
                  foreground=[("selected", TEXT)])
        style.configure("Treeview", background=PANEL, fieldbackground=PANEL, foreground=TEXT,
                        rowheight=28, bordercolor=LINE, borderwidth=0, font=("Segoe UI", 9))
        style.configure("Treeview.Heading", background=CARD, foreground=MUTED,
                        relief="flat", borderwidth=0, font=("Segoe UI", 9, "bold"), padding=(6, 6))
        style.map("Treeview", background=[("selected", "#23305c")], foreground=[("selected", "#ffffff")])
        style.configure("TLabelframe", background=BG, bordercolor=LINE, borderwidth=1)
        style.configure("TLabelframe.Label", background=BG, foreground=TEXT, font=FONT_BOLD)
        style.configure("TCheckbutton", background=BG, foreground=MUTED, font=("Segoe UI", 9))
        style.map("TCheckbutton", background=[("active", BG)], foreground=[("active", TEXT)])
        style.configure("TEntry", fieldbackground=CARD, foreground=TEXT, insertcolor=TEXT, bordercolor=LINE)
        style.configure("TCombobox", fieldbackground=CARD, background=CARD, foreground=TEXT,
                        arrowcolor=MUTED, bordercolor=LINE, lightcolor=CARD, darkcolor=CARD)
        style.map("TCombobox", fieldbackground=[("readonly", CARD)], foreground=[("readonly", TEXT)])

    def _build_header(self):
        header = tk.Frame(self, bg=BG, padx=20, pady=16)
        header.pack(fill="x")
        left = tk.Frame(header, bg=BG)
        left.pack(side="left")
        title_row = tk.Frame(left, bg=BG)
        title_row.pack(anchor="w")
        tk.Label(title_row, text="✦", bg=BG, fg=ACCENT, font=("Segoe UI", 18, "bold")).pack(side="left", padx=(0, 8))
        tk.Label(title_row, text="NovaCompute", bg=BG, fg=TEXT, font=FONT_TITLE).pack(side="left")
        tk.Label(title_row, text="Admin Console", bg=BG, fg=CYAN, font=FONT_TITLE).pack(side="left", padx=(6, 0))
        tk.Label(left, text="API keys · Models · Hot reload — no restart needed",
                 bg=BG, fg=MUTED, font=("Segoe UI", 9)).pack(anchor="w", padx=(30, 0), pady=(2, 0))

        right = tk.Frame(header, bg=BG)
        right.pack(side="right")
        tk.Label(right, text=BACKEND_URL, bg=BG, fg=MUTED, font=FONT_MONO).pack(side="right", padx=(10, 0))
        _dark_button(right, "⟳  Refresh (F5)", self.refresh_all).pack(side="right")

        tk.Frame(self, bg=LINE, height=1).pack(fill="x")

    def _build_tabs(self):
        style = ttk.Style(self)
        style.configure("TFrame", background=BG)
        self.notebook = ttk.Notebook(self)
        self.notebook.pack(fill="both", expand=True, padx=16, pady=(12, 6))

        self.tab_keys = tk.Frame(self.notebook, bg=BG)
        self.tab_models = tk.Frame(self.notebook, bg=BG)
        self.tab_settings = tk.Frame(self.notebook, bg=BG)
        self.notebook.add(self.tab_keys, text="  API Keys  ")
        self.notebook.add(self.tab_models, text="  Models  ")
        self.notebook.add(self.tab_settings, text="  Settings  ")

        self._build_keys_tab()
        self._build_models_tab()
        self._build_settings_tab()

    # ---------------- API Keys tab ----------------
    def _build_keys_tab(self):
        top = tk.Frame(self.tab_keys, bg=BG)
        top.pack(fill="x", pady=(6, 4))
        tk.Label(top, text="Key pools read/written straight to the JSON files the backend loads.",
                 bg=BG, fg=MUTED, font=("Segoe UI", 9)).pack(side="left")
        ttk.Checkbutton(top, text="Reveal keys", variable=self.reveal_keys,
                        command=self.refresh_all).pack(side="right")

        for provider, title in (("nightrouter", "NightRouter Keys"), ("exosai", "ExosAI Keys")):
            frame = ttk.Labelframe(self.tab_keys, text=f" {title} ")
            frame.pack(fill="both", expand=True, pady=(6, 6))

            toolbar = tk.Frame(frame, bg=BG, padx=8, pady=6)
            toolbar.pack(fill="x")
            _dark_button(toolbar, "+  Add Key", lambda p=provider: self.add_key_dialog(p), primary=True, small=True).pack(side="left", padx=(0, 6))
            _dark_button(toolbar, "Delete Selected", lambda p=provider: self.delete_selected_key(p), small=True).pack(side="left", padx=(0, 6))
            _dark_button(toolbar, "Mark Active", lambda p=provider: self.mark_selected_key(p, "active"), small=True).pack(side="left", padx=(0, 6))
            _dark_button(toolbar, "Mark Dead", lambda p=provider: self.mark_selected_key(p, "dead"), small=True).pack(side="left")
            count_label = tk.Label(toolbar, text="", bg=BG, fg=MUTED, font=("Segoe UI", 9))
            count_label.pack(side="right", padx=(8, 0))
            setattr(self, f"{provider}_count", count_label)

            tree = ttk.Treeview(frame, columns=("key", "status", "label"), show="headings", selectmode="browse")
            tree.heading("key", text="API Key")
            tree.heading("status", text="Status")
            tree.heading("label", text="Label / Account")
            tree.column("key", width=380, anchor="w")
            tree.column("status", width=90, anchor="center", stretch=False)
            tree.column("label", width=220, anchor="w")
            tree.tag_configure("active", foreground=OK)
            tree.tag_configure("dead", foreground=ERR)
            scroll = ttk.Scrollbar(frame, orient="vertical", command=tree.yview)
            tree.configure(yscrollcommand=scroll.set)
            tree.pack(side="left", fill="both", expand=True, padx=(8, 0), pady=(0, 8))
            scroll.pack(side="right", fill="y", padx=(0, 8), pady=(0, 8))
            setattr(self, f"{provider}_tree", tree)

    def _render_keys(self, provider):
        tree = getattr(self, f"{provider}_tree")
        tree.delete(*tree.get_children())
        rows = {}
        entries = load_key_entries(KEY_FILES[provider])
        for idx, entry in enumerate(entries):
            value = key_value(entry)
            status = key_status(entry)
            shown = value if self.reveal_keys.get() else mask_key(value)
            iid = tree.insert("", "end",
                              values=(shown, "Active" if status == "active" else "Dead", key_label(entry)),
                              tags=("active" if status == "active" else "dead",))
            rows[iid] = entry
        self.key_rows[provider] = rows
        active = sum(1 for e in entries if key_status(e) == "active")
        getattr(self, f"{provider}_count").configure(text=f"{len(entries)} keys · {active} active")

    def _selected_entry(self, provider):
        tree = getattr(self, f"{provider}_tree")
        selection = tree.selection()
        if not selection:
            return None, None
        iid = selection[0]
        return iid, self.key_rows.get(provider, {}).get(iid)

    def add_key_dialog(self, provider):
        dialog = tk.Toplevel(self)
        dialog.title(f"Add {provider.title()} key")
        dialog.configure(bg=BG)
        dialog.geometry(self._centered(460, 250))
        dialog.transient(self)
        dialog.grab_set()

        tk.Label(dialog, text=f"Add key to {provider}_keys.json", bg=BG, fg=TEXT, font=FONT_BOLD).pack(anchor="w", padx=18, pady=(16, 2))
        tk.Label(dialog, text="The key is written to the file immediately — the backend reads it on the next request.",
                 bg=BG, fg=MUTED, font=("Segoe UI", 9), wraplength=410, justify="left").pack(anchor="w", padx=18)

        form = tk.Frame(dialog, bg=BG)
        form.pack(fill="x", padx=18, pady=12)
        tk.Label(form, text="API key *", bg=BG, fg=MUTED, font=("Segoe UI", 9)).grid(row=0, column=0, sticky="w")
        key_entry = ttk.Entry(form, width=46, show="•")
        key_entry.grid(row=1, column=0, sticky="we", pady=(2, 0))
        tk.Label(form, text="Label / account (optional)", bg=BG, fg=MUTED, font=("Segoe UI", 9)).grid(row=2, column=0, sticky="w", pady=(10, 0))
        label_entry = ttk.Entry(form, width=46)
        label_entry.grid(row=3, column=0, sticky="we", pady=(2, 0))
        form.columnconfigure(0, weight=1)

        error_label = tk.Label(dialog, text="", bg=BG, fg=ERR, font=("Segoe UI", 9))
        error_label.pack(anchor="w", padx=18)

        def save():
            try:
                add_key_entry(KEY_FILES[provider], key_entry.get(), label_entry.get())
            except ValueError as exc:
                error_label.configure(text=str(exc))
                return
            dialog.destroy()
            self.refresh_all()
            self.set_status(f"Key added to {provider}_keys.json — live on the next request.")

        buttons = tk.Frame(dialog, bg=BG)
        buttons.pack(fill="x", padx=18, pady=12)
        _dark_button(buttons, "Cancel", dialog.destroy).pack(side="right")
        _dark_button(buttons, "Add Key", save, primary=True).pack(side="right", padx=(0, 8))
        dialog.bind("<Return>", lambda _e: save())
        dialog.bind("<Escape>", lambda _e: dialog.destroy())
        key_entry.focus_set()

    def delete_selected_key(self, provider):
        _iid, entry = self._selected_entry(provider)
        if entry is None:
            self.set_status("Select a key first.", warn=True)
            return
        value = key_value(entry)
        if not messagebox.askyesno("Delete key", f"Delete this key from {provider}_keys.json?\n\n{mask_key(value)}", parent=self):
            return
        if delete_key_entry(KEY_FILES[provider], value):
            self.refresh_all()
            self.set_status(f"Key deleted from {provider}_keys.json.")

    def mark_selected_key(self, provider, status):
        _iid, entry = self._selected_entry(provider)
        if entry is None:
            self.set_status("Select a key first.", warn=True)
            return
        set_key_status(KEY_FILES[provider], key_value(entry), status)
        self.refresh_all()
        self.set_status(f"Key marked {status} (status is management metadata; the backend currently retries every key).")

    # ---------------- Models tab ----------------
    def _build_models_tab(self):
        top = tk.Frame(self.tab_models, bg=BG)
        top.pack(fill="x", pady=(6, 4))
        tk.Label(top, text="Built-in catalogue + models from custom_models.json (hot-reloaded by the backend).",
                 bg=BG, fg=MUTED, font=("Segoe UI", 9)).pack(side="left")

        toolbar = tk.Frame(self.tab_models, bg=BG)
        toolbar.pack(fill="x", pady=(4, 8))
        _dark_button(toolbar, "+  Add Model", self.add_model_dialog, primary=True, small=True).pack(side="left", padx=(0, 6))
        _dark_button(toolbar, "Delete Custom Model", self.delete_selected_model, small=True).pack(side="left")
        self.models_count = tk.Label(toolbar, text="", bg=BG, fg=MUTED, font=("Segoe UI", 9))
        self.models_count.pack(side="right")

        frame = tk.Frame(self.tab_models, bg=BG)
        frame.pack(fill="both", expand=True)
        columns = ("id", "name", "provider", "input", "output", "context", "upstream", "source")
        tree = ttk.Treeview(frame, columns=columns, show="headings", selectmode="browse")
        headings = {
            "id": ("Model ID", 240), "name": ("Name", 170), "provider": ("Provider", 110),
            "input": ("Input $/1M", 90), "output": ("Output $/1M", 95),
            "context": ("Context", 80), "upstream": ("Upstream", 100), "source": ("Source", 90),
        }
        for key, (label, width) in headings.items():
            tree.heading(key, text=label)
            anchor = "e" if key in ("input", "output") else ("center" if key in ("context", "source", "upstream") else "w")
            tree.column(key, width=width, anchor=anchor, stretch=(key in ("id", "name")))
        tree.tag_configure("custom", foreground=CYAN)
        tree.tag_configure("builtin", foreground=MUTED)
        scroll = ttk.Scrollbar(frame, orient="vertical", command=tree.yview)
        tree.configure(yscrollcommand=scroll.set)
        tree.pack(side="left", fill="both", expand=True)
        scroll.pack(side="right", fill="y")
        self.models_tree = tree

    def _render_models(self):
        tree = self.models_tree
        tree.delete(*tree.get_children())
        self.model_rows = {}
        builtin = get_builtin_models()
        custom = load_custom_models(CUSTOM_MODELS_FILE)
        custom_ids = {m["id"] for m in custom}
        rows = []
        for model in builtin:
            rows.append((model, "builtin"))
        for model in custom:
            rows.append((model, "custom"))
        for model, source in rows:
            if source == "builtin" and model["id"] in custom_ids:
                continue
            iid = tree.insert("", "end", values=(
                model.get("id", ""), model.get("name", ""), model.get("provider", ""),
                f"{float(model.get('input', 0)):.2f}", f"{float(model.get('output', 0)):.2f}",
                model.get("context", ""), model.get("upstream", "—") if source == "custom" else "default",
                "Custom" if source == "custom" else "Built-in",
            ), tags=(source,))
            self.model_rows[iid] = (model, source)
        self.models_count.configure(text=f"{len(rows)} models · {len(custom)} custom")

    def add_model_dialog(self):
        dialog = tk.Toplevel(self)
        dialog.title("Add model")
        dialog.configure(bg=BG)
        dialog.geometry(self._centered(520, 470))
        dialog.transient(self)
        dialog.grab_set()

        tk.Label(dialog, text="Add a model to custom_models.json", bg=BG, fg=TEXT, font=FONT_BOLD).pack(anchor="w", padx=20, pady=(16, 2))
        tk.Label(dialog, text="The backend hot-reloads this file when it changes — no restart.",
                 bg=BG, fg=MUTED, font=("Segoe UI", 9)).pack(anchor="w", padx=20)

        form = tk.Frame(dialog, bg=BG)
        form.pack(fill="both", expand=True, padx=20, pady=12)
        fields = [
            ("id", "Model ID *", "e.g. grok-5-mini"),
            ("name", "Display name *", "e.g. Grok 5 Mini"),
            ("provider", "Provider (vendor)", "e.g. xAI / OpenAI / Anthropic"),
            ("input", "Input price $/1M *", "0.50"),
            ("output", "Output price $/1M *", "1.50"),
            ("context", "Context window", "128K"),
            ("speed", "Speed tok/s", "150"),
        ]
        entries = {}
        for row, (key, label, hint) in enumerate(fields):
            tk.Label(form, text=label, bg=BG, fg=MUTED, font=("Segoe UI", 9)).grid(row=row * 2, column=0, sticky="w", pady=(6, 0))
            entry = ttk.Entry(form, width=44)
            entry.grid(row=row * 2 + 1, column=0, sticky="we", pady=(2, 0))
            entries[key] = entry
        tk.Label(form, text="Upstream provider (routing)", bg=BG, fg=MUTED, font=("Segoe UI", 9)).grid(row=len(fields) * 2, column=0, sticky="w", pady=(8, 0))
        upstream = ttk.Combobox(form, values=["nightrouter", "exosai"], state="readonly")
        upstream.set("nightrouter")
        upstream.grid(row=len(fields) * 2 + 1, column=0, sticky="we", pady=(2, 0))
        form.columnconfigure(0, weight=1)
        entries["id"].insert(0, "")
        entries["provider"].insert(0, "Custom")
        entries["input"].insert(0, "0.00")
        entries["output"].insert(0, "0.00")
        entries["context"].insert(0, "128K")
        entries["speed"].insert(0, "100")

        error_label = tk.Label(dialog, text="", bg=BG, fg=ERR, font=("Segoe UI", 9), wraplength=460, justify="left")
        error_label.pack(anchor="w", padx=20)

        def save():
            model = {key: entry.get() for key, entry in entries.items()}
            model["upstream"] = upstream.get()
            try:
                add_custom_model(CUSTOM_MODELS_FILE, model)
            except ValueError as exc:
                error_label.configure(text=str(exc))
                return
            dialog.destroy()
            self.refresh_all()
            self.set_status(f"Model '{model['id']}' saved — backend will serve it on the next request.")

        buttons = tk.Frame(dialog, bg=BG)
        buttons.pack(fill="x", padx=20, pady=12)
        _dark_button(buttons, "Cancel", dialog.destroy).pack(side="right")
        _dark_button(buttons, "Save Model", save, primary=True).pack(side="right", padx=(0, 8))
        dialog.bind("<Escape>", lambda _e: dialog.destroy())
        entries["id"].focus_set()

    def delete_selected_model(self):
        selection = self.models_tree.selection()
        if not selection:
            self.set_status("Select a model first.", warn=True)
            return
        model, source = self.model_rows.get(selection[0], ({}, "builtin"))
        if source != "custom":
            self.set_status("Built-in models cannot be deleted here.", warn=True)
            return
        if not messagebox.askyesno("Delete model", f"Delete '{model['id']}' from custom_models.json?", parent=self):
            return
        if delete_custom_model(CUSTOM_MODELS_FILE, model["id"]):
            self.refresh_all()
            self.set_status(f"Model '{model['id']}' removed — backend drops it on the next request.")

    # ---------------- Settings tab ----------------
    def _build_settings_tab(self):
        wrap = tk.Frame(self.tab_settings, bg=BG)
        wrap.pack(fill="both", expand=True, pady=8)

        info = ttk.Labelframe(wrap, text=" Files ")
        info.pack(fill="x", pady=(0, 10))
        rows = [
            ("NightRouter keys", KEY_FILES["nightrouter"]),
            ("ExosAI keys", KEY_FILES["exosai"]),
            ("Custom models", CUSTOM_MODELS_FILE),
            ("Backend folder", BACKEND_DIR),
        ]
        for row, (label, path) in enumerate(rows):
            tk.Label(info, text=label, bg=BG, fg=MUTED, font=("Segoe UI", 9)).grid(row=row, column=0, sticky="w", padx=12, pady=3)
            tk.Label(info, text=path, bg=BG, fg=TEXT, font=FONT_MONO).grid(row=row, column=1, sticky="w", padx=12, pady=3)

        backend = ttk.Labelframe(wrap, text=" Backend ")
        backend.pack(fill="x", pady=(0, 10))
        row = tk.Frame(backend, bg=BG, padx=12, pady=8)
        row.pack(fill="x")
        self.health_label = tk.Label(row, text="Not checked yet.", bg=BG, fg=MUTED, font=("Segoe UI", 9))
        self.health_label.pack(side="left")
        _dark_button(row, "Check backend", self.check_backend, small=True).pack(side="right")
        _dark_button(row, "Open backend folder", lambda: os.startfile(BACKEND_DIR)).pack(side="right", padx=(0, 8))

        notes = ttk.Labelframe(wrap, text=" How the hot reload works ")
        notes.pack(fill="x")
        text = (
            "Keys  — backend/app.py reads nightrouter_keys.json and exosai_keys.json on every request, "
            "so adding or deleting a key here is effective immediately.\n"
            "Models — backend/app.py calls refresh_models(): whenever custom_models.json changes (mtime), "
            "it rebuilds the catalogue and pricing, including the /v1/models response and chat validation.\n\n"
            "Key status (Active/Dead) is stored in the JSON for management purposes; the current backend "
            "retries every key in the pool on 401/403/429 regardless of this field."
        )
        tk.Label(notes, text=text, bg=BG, fg=MUTED, font=("Segoe UI", 9), justify="left",
                 wraplength=880, anchor="w").pack(fill="x", padx=12, pady=10)

    def check_backend(self):
        try:
            with urllib.request.urlopen(BACKEND_URL + "/api/health", timeout=3) as response:
                data = json.load(response)
            models = data.get("models", "?")
            keys = data.get("keys_loaded", "?")
            self.health_label.configure(text=f"● Online — {models} models · {keys} keys loaded", fg=OK)
        except (urllib.error.URLError, OSError, ValueError) as exc:
            self.health_label.configure(text=f"● Offline — start the backend (start.bat / silent_start.vbs). {exc}", fg=ERR)

    # ---------------- shared ----------------
    def refresh_all(self):
        for provider in ("nightrouter", "exosai"):
            if hasattr(self, f"{provider}_tree"):
                self._render_keys(provider)
        if hasattr(self, "models_tree"):
            self._render_models()

    def _build_statusbar(self):
        bar = tk.Frame(self, bg=PANEL, height=28)
        bar.pack(fill="x", side="bottom")
        self.status_var = tk.StringVar(value="Ready.")
        tk.Label(bar, textvariable=self.status_var, bg=PANEL, fg=MUTED, font=("Segoe UI", 9), anchor="w").pack(fill="x", padx=14, pady=4)

    def set_status(self, message, warn=False):
        stamp = datetime.now().strftime("%H:%M:%S")
        self.status_var.set(f"[{stamp}] {message}")


def main():
    app = AdminConsole()
    app.mainloop()


if __name__ == "__main__":
    main()
