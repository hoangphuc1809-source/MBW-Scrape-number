// Cloudflare Worker — multi-target reverse proxy for Vietnamese retail sites
// Purpose: let GitHub-hosted Actions runners (datacenter IPs, sometimes blocked
// or bot-challenged by these sites) reach them via Cloudflare's edge instead.
//
// Usage: prefix the upstream path with /__proxy/<target>/<rest-of-path>
//   /__proxy/mbw/laptop          → https://www.thegioididong.com/laptop
//   /__proxy/fpt/may-tinh-xach-tay/asus → https://fptshop.com.vn/may-tinh-xach-tay/asus
//   /__proxy/cps/laptop/asus.html       → https://cellphones.com.vn/laptop/asus.html
//
// Any request whose path does NOT start with /__proxy/ falls back to the
// original single-target behaviour (proxies straight to thegioididong.com),
// for backward compatibility with the existing MBW-only setup.

const TARGETS = {
  mbw: 'www.thegioididong.com',
  fpt: 'fptshop.com.vn',
  cps: 'cellphones.com.vn',
};

const DEFAULT_TARGET_HOST = TARGETS.mbw; // backward-compat fallback

export default {
  async fetch(request) {
    const url = new URL(request.url);

    let targetHost = DEFAULT_TARGET_HOST;
    let upstreamPath = url.pathname;

    const m = url.pathname.match(/^\/__proxy\/([a-z]+)(\/.*)?$/);
    if (m) {
      const key = m[1];
      if (!TARGETS[key]) {
        return new Response(`Unknown proxy target: ${key}`, { status: 400 });
      }
      targetHost = TARGETS[key];
      upstreamPath = m[2] || '/';
    }

    const targetOrigin = 'https://' + targetHost;
    const upstreamUrl = targetOrigin + upstreamPath + url.search;

    // Clone and adjust headers for the upstream request.
    const upstreamHeaders = new Headers(request.headers);
    upstreamHeaders.set('Host', targetHost);
    upstreamHeaders.set('Origin', targetOrigin);
    upstreamHeaders.set('Referer', targetOrigin + '/');
    upstreamHeaders.delete('cf-connecting-ip');
    upstreamHeaders.delete('cf-ray');
    upstreamHeaders.delete('cf-visitor');
    upstreamHeaders.delete('cf-ipcountry');
    upstreamHeaders.delete('x-forwarded-for');
    upstreamHeaders.delete('x-forwarded-proto');

    const init = {
      method: request.method,
      headers: upstreamHeaders,
      redirect: 'manual',
    };
    if (!['GET', 'HEAD'].includes(request.method)) {
      init.body = request.body;
    }

    const upstreamResp = await fetch(upstreamUrl, init);

    const respHeaders = new Headers(upstreamResp.headers);

    // Rewrite redirects (Location) to stay on the worker's origin, preserving
    // the /__proxy/<target>/ prefix if one was used.
    const location = respHeaders.get('location');
    if (location) {
      try {
        const loc = new URL(location, targetOrigin);
        if (loc.hostname === targetHost) {
          const prefix = m ? `/__proxy/${m[1]}` : '';
          const newPath = prefix + loc.pathname;
          const rewritten = new URL(url.toString());
          rewritten.pathname = newPath;
          rewritten.search = loc.search;
          respHeaders.set('location', rewritten.toString());
        }
      } catch (_) { /* ignore malformed Location */ }
    }

    // Rewrite Set-Cookie domain so cookies stick to the worker's origin.
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

    respHeaders.set('Access-Control-Allow-Origin', '*');

    return new Response(upstreamResp.body, {
      status: upstreamResp.status,
      statusText: upstreamResp.statusText,
      headers: respHeaders,
    });
  },
};
