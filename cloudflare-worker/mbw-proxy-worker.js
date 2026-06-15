// Cloudflare Worker — reverse proxy for thegioididong.com
// Purpose: let GitHub-hosted Actions runners (datacenter IPs, blocked by TGDĐ)
// reach thegioididong.com via Cloudflare's edge IPs instead.
//
// Usage: any request to https://<worker>.workers.dev/<path> is forwarded to
// https://www.thegioididong.com/<path> with the same method/headers/body,
// and the response is passed back as-is (with a couple of header tweaks).

const TARGET_HOST = 'www.thegioididong.com';
const TARGET_ORIGIN = 'https://' + TARGET_HOST;

export default {
  async fetch(request) {
    const url = new URL(request.url);

    // Build the upstream URL: same path + query, but pointing at TGDĐ.
    const upstreamUrl = TARGET_ORIGIN + url.pathname + url.search;

    // Clone and adjust headers for the upstream request.
    const upstreamHeaders = new Headers(request.headers);
    upstreamHeaders.set('Host', TARGET_HOST);
    upstreamHeaders.set('Origin', TARGET_ORIGIN);
    // Referer should look like it came from the site itself.
    upstreamHeaders.set('Referer', TARGET_ORIGIN + '/laptop');
    // Strip headers that reveal we're a Worker / cause mismatches.
    upstreamHeaders.delete('cf-connecting-ip');
    upstreamHeaders.delete('cf-ray');
    upstreamHeaders.delete('cf-visitor');
    upstreamHeaders.delete('cf-ipcountry');
    upstreamHeaders.delete('x-forwarded-for');
    upstreamHeaders.delete('x-forwarded-proto');

    const init = {
      method: request.method,
      headers: upstreamHeaders,
      redirect: 'manual', // handle redirects ourselves so we can rewrite Location
    };
    if (!['GET', 'HEAD'].includes(request.method)) {
      init.body = request.body;
    }

    const upstreamResp = await fetch(upstreamUrl, init);

    // Clone response headers, rewriting anything that points back at TGDĐ
    // so the browser keeps talking to the Worker (same-origin AJAX, cookies).
    const respHeaders = new Headers(upstreamResp.headers);

    // Rewrite redirects (Location) to stay on the worker's origin.
    const location = respHeaders.get('location');
    if (location) {
      try {
        const loc = new URL(location, TARGET_ORIGIN);
        if (loc.hostname === TARGET_HOST) {
          loc.protocol = url.protocol;
          loc.host = url.host;
          respHeaders.set('location', loc.toString());
        }
      } catch (_) { /* ignore malformed Location */ }
    }

    // Rewrite Set-Cookie domain so cookies stick to the worker's origin.
    // (Workers expose multiple Set-Cookie headers via getAll on some runtimes;
    // Headers in Workers supports multiple values for the same key natively.)
    if (respHeaders.has('set-cookie')) {
      const cookies = respHeaders.getAll
        ? respHeaders.getAll('set-cookie')
        : [respHeaders.get('set-cookie')];
      respHeaders.delete('set-cookie');
      for (let c of cookies) {
        c = c.replace(/Domain=[^;]+;?\s*/i, '');
        respHeaders.append('set-cookie', c);
      }
    }

    // Allow the page (now served from workers.dev) to fetch cross-origin if needed.
    respHeaders.set('Access-Control-Allow-Origin', '*');

    return new Response(upstreamResp.body, {
      status: upstreamResp.status,
      statusText: upstreamResp.statusText,
      headers: respHeaders,
    });
  },
};
