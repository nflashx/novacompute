// NovaCompute API — Cloudflare Worker (ES module, no build step).
// Same HTTP contract as backend/app.py so the static frontend works unchanged.
// Storage: D1 (users, api_keys, usage_events, transactions). Provider keys: secrets.

import { MODELS, MODEL_BY_ID, PROVIDERS } from "./catalog.js";

const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
};
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const MAX_USAGE_ROWS = 800;

// ---------------------------------------------------------------- utilities

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...JSON_HEADERS, ...CORS } });

const apiError = (status, type, code, message) =>
  json({ error: { type, code, message } }, status);

const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

function hex(bytes) {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function randHex(byteLen) {
  const buf = new Uint8Array(byteLen);
  crypto.getRandomValues(buf);
  return hex(buf);
}

function b64encode(bytes) {
  let s = "";
  const arr = new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
  return btoa(s);
}

function b64decode(text) {
  const raw = atob(text);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function pbkdf2(password, saltB64, iterations = 100000) {
  const keyMaterial = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: b64decode(saltB64), iterations, hash: "SHA-256" },
    keyMaterial,
    256,
  );
  return b64encode(bits);
}

function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function providerKeys(env, providerName) {
  const provider = PROVIDERS[providerName];
  if (!provider) return [];
  let raw = env[provider.secret];
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed) ? parsed : parsed.keys || [];
    return list
      .map((item) => (typeof item === "string" ? item : item && item.api_key))
      .filter(Boolean);
  } catch {
    // also allow comma/newline separated secrets
    return String(raw).split(/[\s,]+/).filter(Boolean);
  }
}

async function authenticate(request, env) {
  const header = request.headers.get("Authorization") || "";
  if (!header.toLowerCase().startsWith("bearer ")) return null;
  const token = header.slice(7).trim();
  if (!token) return null;
  const row = await env.DB.prepare(
    `SELECT k.id AS key_id, k.user_id, k.key, k.status AS key_status, u.id AS uid, u.name, u.email, u.company, u.balance, u.created_at
       FROM api_keys k JOIN users u ON u.id = k.user_id
      WHERE k.key = ? AND k.status = 'active'`,
  ).bind(token).first();
  if (!row) return null;
  return {
    token,
    keyId: row.key_id,
    user: { id: row.uid, name: row.name, email: row.email, company: row.company || "", balance: row.balance || 0, created_at: row.created_at },
  };
}

async function recordUsage(env, userId, modelId, promptTokens, completionTokens, latencyMs, status, cost, keyId) {
  const ts = Math.floor(Date.now() / 1000);
  const statements = [
    env.DB.prepare(
      "INSERT INTO usage_events (user_id, ts, model, prompt_tokens, completion_tokens, latency_ms, status, cost) VALUES (?,?,?,?,?,?,?,?)",
    ).bind(userId, ts, modelId, promptTokens, completionTokens, latencyMs, status, cost),
  ];
  if (cost > 0) {
    statements.push(
      env.DB.prepare("UPDATE users SET balance = MAX(0, balance - ?) WHERE id = ?").bind(cost, userId),
      env.DB.prepare(
        "INSERT INTO transactions (user_id, ts, type, description, method, amount) VALUES (?,?,?,?,?,?)",
      ).bind(userId, ts, "usage", `API usage — ${modelId}`, "Balance", -cost),
    );
  }
  if (keyId) {
    statements.push(env.DB.prepare("UPDATE api_keys SET last_used = ? WHERE id = ?").bind(nowIso(), keyId));
  }
  try {
    await env.DB.batch(statements);
  } catch (e) {
    console.log("recordUsage failed", e.message);
  }
}

async function usageAggregates(env, userId) {
  const rows = await env.DB.prepare(
    "SELECT ts, model, prompt_tokens, completion_tokens, latency_ms, status FROM usage_events WHERE user_id = ? ORDER BY ts DESC LIMIT ?",
  ).bind(userId, MAX_USAGE_ROWS).all();
  const usage = rows.results || [];
  const days = 14;
  const fmt = (d) => d.toLocaleDateString("en-US", { month: "short", day: "2-digit", timeZone: "UTC" });
  const today = new Date();
  const utcToday = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const buckets = new Map();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(utcToday.getTime() - i * 86400000);
    buckets.set(d.toISOString().slice(0, 10), { label: fmt(d), tokens: 0, requests: 0 });
  }
  const perModel = new Map();
  for (const row of usage) {
    const dayKey = new Date(row.ts * 1000).toISOString().slice(0, 10);
    const bucket = buckets.get(dayKey);
    const tokens = (row.prompt_tokens || 0) + (row.completion_tokens || 0);
    if (bucket) {
      bucket.tokens += tokens;
      bucket.requests += 1;
    }
    const entry = perModel.get(row.model) || { requests: 0, tokens: 0 };
    entry.requests += 1;
    entry.tokens += tokens;
    perModel.set(row.model, entry);
  }
  const daily = [...buckets.values()].map((b) => ({ date: b.label, tokens: b.tokens, requests: b.requests }));
  const todayKey = utcToday.toISOString().slice(0, 10);
  const yesterdayKey = new Date(utcToday.getTime() - 86400000).toISOString().slice(0, 10);
  const todayStats = buckets.get(todayKey) || { tokens: 0, requests: 0 };
  const yesterdayStats = buckets.get(yesterdayKey) || { tokens: 0, requests: 0 };
  const pct = (cur, prev) => (prev > 0 ? Math.round(((cur - prev) / prev) * 1000) / 10 : null);

  const byModel = [...perModel.entries()]
    .map(([id, v]) => ({ id, ...v }))
    .sort((a, b) => b.tokens - a.tokens);

  const recent = usage.slice(0, 8).map((r) => ({
    ts: r.ts,
    model: r.model,
    tokens: (r.prompt_tokens || 0) + (r.completion_tokens || 0),
    latency_ms: r.latency_ms || 0,
    status: r.status || "ok",
  }));

  const latencies = usage.filter((r) => r.status === "ok" && r.latency_ms).slice(0, 50).map((r) => r.latency_ms);
  const avgLatency = latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0;

  return {
    daily,
    by_model: byModel,
    recent,
    stats: {
      requests_today: todayStats.requests,
      tokens_today: todayStats.tokens,
      requests_delta_pct: pct(todayStats.requests, yesterdayStats.requests),
      tokens_delta_pct: pct(todayStats.tokens, yesterdayStats.tokens),
      avg_latency_ms: avgLatency,
      total_requests: usage.length,
    },
  };
}

// ---------------------------------------------------------------- handlers

async function handleRegister(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return apiError(400, "invalid_request_error", "invalid_json", "Body must be valid JSON.");
  }
  const name = String(body.name || "").trim();
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  if (!name) return apiError(400, "invalid_request_error", "name_required", "Name is required.");
  if (!EMAIL_RE.test(email)) return apiError(400, "invalid_request_error", "invalid_email", "A valid email is required.");
  if (password.length < 8) return apiError(400, "invalid_request_error", "weak_password", "Password must be at least 8 characters.");

  const existing = await env.DB.prepare("SELECT id FROM users WHERE lower(email) = ?").bind(email).first();
  if (existing) return apiError(409, "invalid_request_error", "email_taken", "An account with this email already exists.");

  const salt = b64encode(crypto.getRandomValues(new Uint8Array(16)));
  const hash = await pbkdf2(password, salt, Number(env.PBKDF2_ITERATIONS || 100000));
  const userId = "usr_" + randHex(8);
  const keyId = "key_" + randHex(6);
  const apiKey = "nova-sk-" + randHex(20);
  const created = nowIso();

  await env.DB.batch([
    env.DB.prepare("INSERT INTO users (id, name, email, company, salt, hash, created_at, balance) VALUES (?,?,?,?,?,?,?,0)")
      .bind(userId, name, email, String(body.company || "").trim(), salt, hash, created),
    env.DB.prepare("INSERT INTO api_keys (id, user_id, name, key, created_at, status) VALUES (?,?,?,?,?,'active')")
      .bind(keyId, userId, "Default", apiKey, created),
  ]);

  return json({ user: { name, email, created_at: created }, api_key: apiKey, balance: 0 }, 201);
}

async function handleLogin(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return apiError(400, "invalid_request_error", "invalid_json", "Body must be valid JSON.");
  }
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  if (!email || !password) return apiError(400, "invalid_request_error", "missing_fields", "Email and password are required.");

  const user = await env.DB.prepare("SELECT * FROM users WHERE lower(email) = ?").bind(email).first();
  if (!user) return apiError(401, "authentication_error", "invalid_credentials", "Incorrect email or password.");
  const hash = await pbkdf2(password, user.salt, Number(env.PBKDF2_ITERATIONS || 100000));
  if (!safeEqual(hash, user.hash)) return apiError(401, "authentication_error", "invalid_credentials", "Incorrect email or password.");

  const key = await env.DB.prepare(
    "SELECT key FROM api_keys WHERE user_id = ? AND status = 'active' ORDER BY created_at LIMIT 1",
  ).bind(user.id).first();
  if (!key) return apiError(403, "authentication_error", "no_active_key", "This account has no active API keys.");

  return json({
    user: { name: user.name, email: user.email, created_at: user.created_at },
    api_key: key.key,
    balance: user.balance || 0,
  });
}

async function handleMe(request, env) {
  const auth = await authenticate(request, env);
  if (!auth) return apiError(401, "authentication_error", "invalid_api_key", "Missing or invalid API key. Send Authorization: Bearer nova-sk-…");

  const keys = await env.DB.prepare(
    "SELECT id, name, key, created_at, last_used, status FROM api_keys WHERE user_id = ? AND status = 'active' ORDER BY created_at",
  ).bind(auth.user.id).all();
  const aggregates = await usageAggregates(env, auth.user.id);
  const tx = await env.DB.prepare(
    "SELECT ts, type, description, method, amount FROM transactions WHERE user_id = ? ORDER BY ts DESC LIMIT 10",
  ).bind(auth.user.id).all();

  return json({
    user: { name: auth.user.name, email: auth.user.email, company: auth.user.company, created_at: auth.user.created_at },
    balance: Math.round((auth.user.balance || 0) * 1e6) / 1e6,
    api_keys: (keys.results || []).map((k) => ({ id: k.id, name: k.name, key: k.key, created_at: k.created_at, last_used: k.last_used, status: k.status })),
    request_key_id: auth.keyId,
    ...aggregates,
    transactions: (tx.results || []).map((t) => ({ ts: t.ts, type: t.type, description: t.description, method: t.method, amount: t.amount })),
  });
}

async function handleCreateKey(request, env) {
  const auth = await authenticate(request, env);
  if (!auth) return apiError(401, "authentication_error", "invalid_api_key", "Not authenticated.");
  let body = {};
  try {
    body = await request.json();
  } catch { /* optional body */ }
  const name = (String(body.name || "").trim() || "Untitled key").slice(0, 60);
  const keyId = "key_" + randHex(6);
  const apiKey = "nova-sk-" + randHex(20);
  await env.DB.prepare("INSERT INTO api_keys (id, user_id, name, key, created_at, status) VALUES (?,?,?,?,?,'active')")
    .bind(keyId, auth.user.id, name, apiKey, nowIso()).run();
  const keys = await env.DB.prepare(
    "SELECT id, name, key, created_at, last_used, status FROM api_keys WHERE user_id = ? AND status = 'active' ORDER BY created_at",
  ).bind(auth.user.id).all();
  return json({
    key: { id: keyId, name, key: apiKey, created_at: nowIso(), last_used: null, status: "active" },
    keys: keys.results || [],
  }, 201);
}

async function handleDeleteKey(request, env, keyId) {
  const auth = await authenticate(request, env);
  if (!auth) return apiError(401, "authentication_error", "invalid_api_key", "Not authenticated.");
  const active = await env.DB.prepare(
    "SELECT id, key FROM api_keys WHERE user_id = ? AND status = 'active'",
  ).bind(auth.user.id).all();
  const list = active.results || [];
  if (list.length <= 1) return apiError(409, "invalid_request_error", "last_key", "Keep at least one active API key.");
  if (!list.some((k) => k.id === keyId)) return apiError(404, "not_found", "key_missing", "API key not found.");
  await env.DB.prepare("DELETE FROM api_keys WHERE id = ? AND user_id = ?").bind(keyId, auth.user.id).run();
  const remaining = await env.DB.prepare(
    "SELECT id, name, key, created_at, last_used, status FROM api_keys WHERE user_id = ? AND status = 'active' ORDER BY created_at",
  ).bind(auth.user.id).all();
  const rest = remaining.results || [];
  return json({
    deleted: keyId,
    deleted_current_key: keyId === auth.keyId,
    keys: rest,
    auth_key: keyId === auth.keyId && rest[0] ? rest[0].key : auth.token,
  });
}

async function handleTopup(request, env) {
  const auth = await authenticate(request, env);
  if (!auth) return apiError(401, "authentication_error", "invalid_api_key", "Not authenticated.");
  let body = {};
  try {
    body = await request.json();
  } catch { /* ignore */ }
  const amount = Math.round(Number(body.amount || 0) * 100) / 100;
  if (!(amount > 0) || amount > 1000) return apiError(400, "invalid_request_error", "invalid_amount", "Amount must be between $0.01 and $1000.");
  const ts = Math.floor(Date.now() / 1000);
  await env.DB.batch([
    env.DB.prepare("UPDATE users SET balance = balance + ? WHERE id = ?").bind(amount, auth.user.id),
    env.DB.prepare("INSERT INTO transactions (user_id, ts, type, description, method, amount) VALUES (?,?,?,?,?,?)")
      .bind(auth.user.id, ts, "topup", "Demo top-up", "Visa •••• 4242", amount),
  ]);
  const updated = await env.DB.prepare("SELECT balance FROM users WHERE id = ?").bind(auth.user.id).first();
  return json({ balance: Math.round((updated.balance || 0) * 1e6) / 1e6 });
}

async function handleProfile(request, env) {
  const auth = await authenticate(request, env);
  if (!auth) return apiError(401, "authentication_error", "invalid_api_key", "Not authenticated.");
  let body = {};
  try {
    body = await request.json();
  } catch { /* ignore */ }
  const name = String(body.name || "").trim();
  if (!name) return apiError(400, "invalid_request_error", "name_required", "Name is required.");
  const company = String(body.company || "").trim().slice(0, 80);
  await env.DB.prepare("UPDATE users SET name = ?, company = ? WHERE id = ?").bind(name.slice(0, 80), company, auth.user.id).run();
  return json({ user: { name, company, email: auth.user.email } });
}

function streamUsageMeter(stream, env, auth, model, priceIn, priceOut, started, ctx, promptChars) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let contentChars = 0;
  let usage = null;
  ctx.waitUntil((async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        const matches = text.matchAll(/"content"\s*:\s*"((?:\\.|[^"\\])*)"/g);
        for (const m of matches) contentChars += m[1].length;
        const usageMatch = text.match(/"usage"\s*:\s*\{[^}]*"completion_tokens"\s*:\s*(\d+)[^}]*\}/);
        if (usageMatch) usage = { completion_tokens: Number(usageMatch[1]) };
      }
    } catch { /* client closed */ }
    const promptTokens = usage && usage.prompt_tokens ? usage.prompt_tokens : Math.max(1, Math.floor(promptChars / 4));
    const completionTokens = usage && usage.completion_tokens ? usage.completion_tokens : Math.max(1, Math.floor(contentChars / 4));
    const cost = (promptTokens * priceIn + completionTokens * priceOut) / 1e6;
    await recordUsage(env, auth.user.id, model.id, promptTokens, completionTokens, Math.round(performance.now() - started), "ok", cost, auth.keyId);
  })());
}

async function handleChat(request, env, ctx) {
  const auth = await authenticate(request, env);
  if (!auth) return apiError(401, "authentication_error", "invalid_api_key", "Missing or invalid API key. Send Authorization: Bearer nova-sk-…");

  let body;
  try {
    body = await request.json();
  } catch {
    return apiError(400, "invalid_request_error", "invalid_json", "Request body must be valid JSON.");
  }
  const model = MODEL_BY_ID.get(String(body.model || "").trim());
  if (!model) return apiError(400, "invalid_request_error", "invalid_model", `Unknown model '${body.model}'. Call GET /v1/models for the catalogue.`);
  const messages = body.messages;
  if (!Array.isArray(messages) || messages.length === 0) return apiError(400, "invalid_request_error", "invalid_messages", "'messages' must be a non-empty array.");

  const isPaid = model.input > 0 || model.output > 0;
  if (isPaid && (auth.user.balance || 0) <= 0) {
    return apiError(402, "insufficient_balance_error", "insufficient_balance", "Balance exhausted. Top up in the dashboard or use a free model.");
  }

  const provider = PROVIDERS[model.upstream];
  if (!provider) return apiError(500, "configuration_error", "provider_missing", `Provider '${model.upstream}' not configured.`);
  const keys = providerKeys(env, model.upstream);
  if (!keys.length) return apiError(503, "configuration_error", "upstream_not_configured", `No keys configured for provider '${model.upstream}'. Add the ${provider.secret} secret.`);

  const stream = Boolean(body.stream);
  const payload = JSON.stringify({ ...body, model: model.id });
  const retryDelay = Number(env.UPSTREAM_RETRY_DELAY_MS || 1500);
  const attempts = Math.max(1, Number(env.UPSTREAM_RETRY_ATTEMPTS || 3));
  const transient = new Set([429, 500, 502, 503, 504]);
  const shuffled = [...keys].sort(() => Math.random() - 0.5).slice(0, 5);

  const started = performance.now();
  let lastError = "no upstream key worked";
  let upstream = null;

  outer: for (const key of shuffled) {
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const res = await fetch(provider.url, {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", Accept: stream ? "text/event-stream" : "application/json" },
          body: payload,
        });
        if (res.ok) {
          upstream = res;
          break outer;
        }
        const status = res.status;
        let detail = "";
        try { detail = (await res.text()).slice(0, 300); } catch { /* ignore */ }
        lastError = `HTTP ${status} ${detail}`.trim();
        if (transient.has(status) && attempt < attempts) {
          await sleep(retryDelay);
          continue;
        }
        if (status === 401 || status === 403 || status === 429) break; // next key
        return apiError(502, "upstream_error", "upstream_rejected", `Upstream HTTP ${status}: ${detail.slice(0, 200)}`);
      } catch (e) {
        lastError = e.message || String(e);
        if (attempt < attempts) {
          await sleep(retryDelay);
          continue;
        }
        break;
      }
    }
  }

  if (!upstream) return apiError(502, "upstream_error", "all_keys_failed", `All keys for ${model.upstream} failed. Last error: ${lastError.slice(0, 200)}`);

  if (stream) {
    const [clientStream, meterStream] = upstream.body.tee();
    streamUsageMeter(meterStream, env, auth, model, model.input, model.output, started, ctx, payload.length);
    return new Response(clientStream, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        ...CORS,
      },
    });
  }

  let data;
  try {
    data = await upstream.json();
  } catch {
    return apiError(502, "upstream_error", "bad_upstream_response", "Upstream returned malformed JSON.");
  }
  const usage = data.usage || {};
  const promptTokens = usage.prompt_tokens || 0;
  const completionTokens = usage.completion_tokens || 0;
  const cost = (promptTokens * model.input + completionTokens * model.output) / 1e6;
  await recordUsage(env, auth.user.id, model.id, promptTokens, completionTokens, Math.round(performance.now() - started), "ok", cost, auth.keyId);
  return json(data);
}

// ---------------------------------------------------------------- router

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    try {
      if (request.method === "GET" && (path === "/" || path === "/api/health")) {
        let d1 = "ok";
        try {
          await env.DB.prepare("SELECT 1").first();
        } catch (e) {
          d1 = "error: " + e.message;
        }
        const configured = Object.keys(PROVIDERS).filter((p) => providerKeys(env, p).length > 0);
        return json({
          status: "ok",
          service: "nova-worker",
          storage: d1,
          providers_configured: configured,
          models: MODELS.length,
          time: nowIso(),
        });
      }

      if (request.method === "GET" && path === "/v1/models") {
        return json({
          object: "list",
          data: MODELS.map((m) => ({
            id: m.id,
            object: "model",
            owned_by: m.vendor,
            name: m.name,
            context: m.context,
            speed_tps: m.speed,
            pricing: { input_per_1m: m.input, output_per_1m: m.output },
            capabilities: { image: Boolean(m.image), video: Boolean(m.video) },
          })),
        });
      }

      if (request.method === "POST" && path === "/api/register") return handleRegister(request, env);
      if (request.method === "POST" && path === "/api/login") return handleLogin(request, env);
      if (request.method === "GET" && path === "/api/me") return handleMe(request, env);
      if (request.method === "POST" && path === "/api/keys") return handleCreateKey(request, env);
      if (request.method === "DELETE" && path.startsWith("/api/keys/")) return handleDeleteKey(request, env, path.split("/").pop());
      if (request.method === "POST" && path === "/api/topup") return handleTopup(request, env);
      if (request.method === "POST" && path === "/api/profile") return handleProfile(request, env);
      if (request.method === "POST" && path === "/v1/chat/completions") return handleChat(request, env, ctx);

      return apiError(404, "not_found", "not_found", `No route for ${request.method} ${path}`);
    } catch (e) {
      console.log("worker error", e && e.stack ? e.stack : e);
      return apiError(500, "server_error", "internal_error", "Internal error. Try again.");
    }
  },
};
