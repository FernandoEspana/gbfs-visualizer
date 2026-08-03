/**
 * Cloudflare Worker: CORS front for the Lime GBFS feed.
 *
 * The upstream sends no `Access-Control-Allow-Origin`, so a browser on a static
 * host cannot call it. This worker is the reverse proxy the dev-server proxy has
 * no equivalent of in production. It adds CORS and nothing else: no reshaping,
 * no filtering. `GbfsMapper` stays the only translation boundary.
 */

const UPSTREAM =
  'https://data.lime.bike/api/partners/v2/gbfs/new_york/free_bike_status.json';

/** The feed's own `ttl`. Caching past it would serve data the app calls stale. */
const CACHE_TTL_SECONDS = 60;

/**
 * Explicit allowlist rather than `*`: the worker is a public URL, and an open
 * one is a free relay for anyone. Localhost is here for testing the production
 * URL from `ng serve`; normal dev goes through `proxy.conf.json`.
 */
const ALLOWED_ORIGINS = new Set([
  'https://fernandoespana.github.io',
  'http://localhost:4200',
]);

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

export default {
  async fetch(request) {
    const origin = request.headers.get('Origin');
    const allowed = origin !== null && ALLOWED_ORIGINS.has(origin);

    if (request.method === 'OPTIONS') {
      return allowed
        ? new Response(null, { status: 204, headers: corsHeaders(origin) })
        : new Response(null, { status: 403 });
    }

    if (request.method !== 'GET') {
      return new Response('Method Not Allowed', {
        status: 405,
        headers: { Allow: 'GET, OPTIONS' },
      });
    }

    if (!allowed) {
      return new Response('Forbidden', { status: 403 });
    }

    const upstream = await fetch(UPSTREAM, {
      cf: { cacheTtl: CACHE_TTL_SECONDS, cacheEverything: true },
    });

    if (!upstream.ok) {
      // Surfaced as a `PollResult` error by `VehiclePolling`, which retries.
      return new Response(`Upstream ${upstream.status}`, {
        status: 502,
        headers: corsHeaders(origin),
      });
    }

    return new Response(upstream.body, {
      status: 200,
      headers: {
        ...corsHeaders(origin),
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': `public, max-age=${CACHE_TTL_SECONDS}`,
      },
    });
  },
};
