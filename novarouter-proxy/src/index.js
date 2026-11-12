/**
 * Reverse proxy for novarouter.cc.cd -> Instabox public port.
 * Instabox routes by Host, so a plain DNS CNAME to the instabox.tech host
 * returns 404. Cloudflare terminates TLS for novarouter.cc.cd and this Worker
 * fetches the Instabox URL with the correct origin Host.
 */
export default {
  async fetch(request, env) {
    const incoming = new URL(request.url);
    const origin = new URL(env.ORIGIN);
    const target = new URL(incoming.pathname + incoming.search, origin);

    const headers = new Headers(request.headers);
    headers.delete('host');
    headers.delete('content-length');
    headers.delete('cf-connecting-ip');
    headers.delete('x-forwarded-proto');

    const init = {
      method: request.method,
      headers,
      redirect: 'manual',
    };
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      init.body = request.body;
    }

    const response = await fetch(target.toString(), init);
    const out = new Headers(response.headers);
    out.delete('content-length');
    out.delete('content-encoding');
    out.delete('transfer-encoding');
    return new Response(response.body, { status: response.status, headers: out });
  },
};
