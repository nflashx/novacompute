/**
 * NovaCompute — Instabox machine keeper.
 *
 * Free Instabox machines pause after 30 minutes idle and after 480 minutes of
 * continuous runtime. This Worker keeps one machine alive with cron triggers:
 *   - every 10 min: wake (paused) or start (stopped) + health check
 *   - every 7 h: stop then start, to reset the 480-minute max-run clock
 *
 * Secrets:
 *   npx wrangler secret put INSTABOX_API_KEY
 *
 * Vars in wrangler.toml:
 *   MACHINE_ID   m_...
 *   PUBLIC_URL   https://...instabox.sh (or your own URL)
 */

const json = (data, status = 200) =>
  new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });

function apiBase(env) {
  return (env.INSTABOX_API_BASE || 'https://api.instabox.sh').replace(/\/+$/, '');
}

async function call(env, path, method = 'POST') {
  const url = `${apiBase(env)}/v1/machines/${encodeURIComponent(env.MACHINE_ID)}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      'X-API-Key': env.INSTABOX_API_KEY,
      'Idempotency-Key': crypto.randomUUID(),
      Accept: 'application/json',
    },
  });
  let body = null;
  try { body = await res.json(); } catch (_) { body = null; }
  return { status: res.status, retryAfter: res.headers.get('Retry-After'), body };
}

async function health(env) {
  const base = (env.PUBLIC_URL || '').replace(/\/+$/, '');
  if (!base) return { status: 0, note: 'PUBLIC_URL not set' };
  try {
    const res = await fetch(`${base}/api/health`, {
      headers: { Accept: 'application/json' },
      cf: { cacheTtl: 0 },
    });
    return { status: res.status, ok: res.ok };
  } catch (err) {
    return { status: 0, error: String(err) };
  }
}

async function run(env, cron = 'manual') {
  const out = { cron, machine: env.MACHINE_ID, at: new Date().toISOString() };

  // 7-hour maintenance: reset the 480-minute max-run clock.
  if (cron === '0 */7 * * *') {
    out.stop = await call(env, '/stop');
    // Give the VM a moment to stop; the next 10-minute cron will start it if
    // this start races the stop.
    await new Promise((r) => setTimeout(r, 15000));
    out.start = await call(env, '/start');
    out.health = await health(env);
    return out;
  }

  // Normal tick: wake a self-paused machine; if that is not possible, start it.
  out.wake = await call(env, '/wake');
  if (out.wake.status === 409) {
    const code = out.wake.body?.error?.code || '';
    if (!String(code).includes('cooldown')) {
      out.start = await call(env, '/start');
    }
  } else if (out.wake.status === 404) {
    out.start = null;
    out.error = 'machine not found — it may have been deleted; recreate from a snapshot';
  } else if (out.wake.status >= 400) {
    out.start = await call(env, '/start');
  }

  out.health = await health(env);
  return out;
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(run(env, event.cron));
  },

  async fetch(request, env) {
    // Manual trigger / status: open the Worker URL.
    return json(await run(env, 'manual'));
  },
};
