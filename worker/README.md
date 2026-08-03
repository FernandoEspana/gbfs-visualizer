# GBFS CORS proxy (Cloudflare Worker)

Reverse proxy that fronts the Lime GBFS feed with an `Access-Control-Allow-Origin`
header, so the GitHub Pages build can read live data instead of the captured
snapshot in `public/gbfs/`.

It is deliberately outside the Angular build: the app knows the feed only through
the `GBFS_FEED_URL` injection token in `src/app/app.config.ts`.

## Deploy

```bash
npm install -g wrangler     # once
wrangler login              # opens a browser; a free Cloudflare account is enough
cd worker && wrangler deploy
```

`wrangler deploy` prints the public URL. The deployed instance lives at
**https://gbfs-proxy.fernandoespana-dev.workers.dev**, which is the value of
`PROD_FEED_URL` in `src/app/app.config.ts`. Redeploying to a different account or
subdomain means updating that one constant; nothing else in the app changes.

## Verify

```bash
URL=https://gbfs-proxy.fernandoespana-dev.workers.dev/

# 200 + `access-control-allow-origin: https://fernandoespana.github.io`
curl -sI -H 'Origin: https://fernandoespana.github.io' "$URL"

# 403 — the allowlist is closed
curl -sI -H 'Origin: https://example.com' "$URL"

# 405 — GET and OPTIONS only
curl -sI -X POST -H 'Origin: https://fernandoespana.github.io' "$URL"
```

## Notes

- **Allowlist, not `*`.** `ALLOWED_ORIGINS` in `src/index.js` holds the Pages
  origin and `http://localhost:4200`. A new deploy origin needs adding there.
- **Edge cache of 60s**, matching the feed's own `ttl`. Any number of viewers
  polling once a minute collapses into roughly one upstream request per minute.
- **Free tier** covers this comfortably: 100k requests/day against one request
  per viewer per minute.
- **Rollback.** Point `PROD_FEED_URL` back at the snapshot path
  (`gbfs/free_bike_status.json`, still committed) and redeploy Pages. The worker
  can stay running or be deleted with `wrangler delete`.
