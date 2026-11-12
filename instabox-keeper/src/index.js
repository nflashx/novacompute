/**
 * NovaCompute — Instabox machine keeper.
 *
 * The free machine pauses after 30 minutes idle and has a short max-run limit
 * (the dashboard currently reports maxRunMinutes=120). This Worker:
 *   - every 10 min: keeps the machine awake / wakes or starts it;
 *   - reads maxRunMinutes from the API and stop/starts it 10 minutes before
 *     the limit, so it never hits the escalating max-run cooldown.
 *
 * Secrets:
 *   npx wrangler secret put INSTABOX_API_KEY
 *
 * Vars:
 *   MACHINE_ID   m_...
 *   PUBLIC_URL   https://8000-....instabox.tech
 */

const json = (data, status = 200) =>
  new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });

const base = (env) => (env.INSTABOX_API_BASE || 'https://api.instabox.sh').replace(/\/+$/, '');

async function req(env, path, method = 'GET') {
  const headers = { 'X-API-Key': env.INSTABOX_API_KEY, Accept: 'application/json' };
  if (method !== 'GET') headers['Idempotency-Key'] = crypto.randomUUID();
  const res = await fetch(`${base(env)}/v1/machines/${encodeURIComponent(env.MACHINE_ID)}${path}`, {
    method,
    headers,
  });
  let body = null;
  try { body = await res.json(); } catch (_) { body = null; }
  return { status: res.status, body };
}

async function health(env) {
  const url = (env.PUBLIC_URL || '').replace(/\/+$/, '');
  if (!url) return { status: 0, note: 'PUBLIC_URL not set' };
  try {
    const res = await fetch(`${url}/api/health`, { cf: { cacheTtl: 0 } });
    return { status: res.status, ok: res.ok };
  } catch (err) {
    return { status: 0, error: String(err) };
  }
}

function minutesSince(iso) {
  if (!iso) return 0;
  return (Date.now() - Date.parse(iso)) / 60000;
}

async function run(env) {
  const out = { machine: env.MACHINE_ID, at: new Date().toISOString() };

  const machine = await req(env, '');
  out.state = machine.body?.state || null;
  if (machine.status === 404) {
    out.error = 'machine not found — it may have been deleted; recreate from a snapshot';
    return out;
  }
  if (machine.status >= 400 || !machine.body) {
    out.error = machine.body?.error || `machine lookup HTTP ${machine.status}`;
    return out;
  }

  const state = String(machine.body.state || '').toLowerCase();
  const maxRun = Number(machine.body.maxRunMinutes || 0);
  const elapsed = minutesSince(machine.body.runStartedAt);
  const buffer = Number(env.RESTART_BUFFER_MINUTES || 10);

  // Restart before the max-run pause. This also avoids the escalating cooldown.
  if (state === 'running' && maxRun > 0 && elapsed >= maxRun - buffer) {
    out.elapsedMinutes = Math.round(elapsed);
    out.maxRunMinutes = maxRun;
    out.stop = await req(env, '/stop', 'POST');
    await new Promise((r) => setTimeout(r, 15000));
    out.start = await req(env, '/start', 'POST');
    out.health = await health(env);
    return out;
  }

  if (state === 'stopped') {
    out.start = await req(env, '/start', 'POST');
  } else if (state === 'paused' || state === 'suspended') {
    out.wake = await req(env, '/wake', 'POST');
    if (out.wake.status >= 400) out.start = await req(env, '/start', 'POST');
  } else if (state === 'running') {
    // A health request also resets the 30-minute idle timer.
    out.wake = await req(env, '/wake', 'POST');
  } else {
    out.note = `state ${state}; no action`;
  }

  out.health = await health(env);
  return out;
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(run(env));
  },
  async fetch(request, env) {
    return json(await run(env));
  },
};
