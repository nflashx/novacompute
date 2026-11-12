/**
 * Cloudflare Pages advanced-mode proxy for novarouter.cc.cd.
 *
 * Instabox routes HTTP by Host, so a plain CNAME to the Instabox hostname
 * returns 404. Pages accepts the custom hostname, and this worker forwards the
 * request to the Instabox origin with the correct Host header.
 *
 * Keep response.body streaming: the chat API uses Server-Sent Events.
 */
const ORIGIN = 'https://8000-agq45l5c6sphv2zqkzyanpjymq.instabox.tech';
const ORIGIN_HOST = new URL(ORIGIN).host;

export default {
  async fetch(request) {
    const incoming = new URL(request.url);
    const target = new URL(incoming.pathname + incoming.search, ORIGIN);

    const headers = new Headers(request.headers);
    const clientIp = headers.get('cf-connecting-ip') || '';
    for (const name of [
      'host', 'content-length', 'accept-encoding', 'connection',
      'keep-alive', 'proxy-connection', 'transfer-encoding', 'upgrade',
    ]) headers.delete(name);
    if (clientIp) {
      headers.set('x-forwarded-for', clientIp);
      headers.set('x-real-ip', clientIp);
    }

    const init = {
      method: request.method,
      headers,
      redirect: 'manual',
    };
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      init.body = request.body;
    }

    const upstream = await fetch(target.toString(), init);
    const out = new Headers(upstream.headers);
    out.delete('content-length');
    out.delete('content-encoding');
    out.delete('transfer-encoding');

    // Keep browser-facing redirects on the branded hostname.
    const location = out.get('location');
    if (location) {
      try {
        const loc = new URL(location, target);
        if (loc.host === ORIGIN_HOST) {
          loc.protocol = incoming.protocol;
          loc.host = incoming.host;
          out.set('location', loc.toString());
        }
      } catch (_) {}
    }

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: out,
    });
  },
};
