# 06 — Build & Deployment

## Product Context

Wasabi is a self-hosted AI-native workspace deployed entirely on Cloudflare's edge infrastructure. The frontend is a React 18 SPA served by Cloudflare Pages. The backend is a single Cloudflare Worker (`worker.js`, ~9533 lines) that handles all API routes, authentication, WebSocket upgrade, cron triggers, and OAuth flows. All data lives in D1 (SQLite) and R2 (object storage), fully owned by the deployer.

---

## Infrastructure

| Layer | Service | Purpose |
|-------|---------|---------|
| Frontend | Cloudflare Pages | Static SPA hosting, auto-deploy from GitHub |
| Backend | Cloudflare Workers | Single worker: API, auth, WebSocket, cron, OAuth |
| Database | Cloudflare D1 | SQLite source of truth (`wasabi-main`) |
| Storage | Cloudflare R2 | File attachments, document content (`wasabi-docs`) |
| Real-time | Durable Objects | `TableRoom` (per-table WebSocket), `UserRoom` (per-user broadcast) |
| Cron | Worker Triggers | `*/2 * * * *` — automations, sync flush, cleanup |

---

## Dependencies

### Production

| Package | Version | Purpose |
|---------|---------|---------|
| react | ^18.3.1 | Core UI framework |
| react-dom | ^18.3.1 | React DOM rendering |
| jspdf | ^4.2.0 | PDF generation for documents |

### Development

| Package | Version | Purpose |
|---------|---------|---------|
| @vitejs/plugin-react | ^4.3.4 | React Fast Refresh for HMR |
| vite | ^5.4.11 | Build tool and dev server |
| vitest | ^4.1.0 | Test runner |

---

## npm Scripts

```bash
npm run dev        # Start Vite dev server on http://localhost:5173
npm run build      # Production build → dist/ with lazy-loaded chunks
npm run preview    # Preview production build locally
npm run test       # Run vitest (single run)
npm run test:watch # Run vitest in watch mode
```

---

## Frontend Deployment (Cloudflare Pages)

Push to the GitHub repo triggers automatic deployment via Cloudflare Pages:

1. Pages monitors the repo (configured in Cloudflare dashboard)
2. On push to main, Pages runs `npm install` then `npm run build`
3. Serves `dist/` on `wasabi-platform.pages.dev`

### npm Version Compatibility

Cloudflare Pages builds use **Node 22 / npm 10**. Local development may use a newer npm version. If `package-lock.json` was generated with a different npm version, the Pages build will fail with `EBADPLATFORM` errors from platform-specific packages like `@esbuild`.

**Fix:** Regenerate the lock file with npm 10:

```bash
rm -rf node_modules package-lock.json && npx -y npm@10 install
```

Commit the regenerated `package-lock.json` before pushing.

### Vite Configuration

**File:** `vite.config.js`

```javascript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5173,
  },
  build: {
    outDir: "dist",
    sourcemap: false,
  },
});
```

- **Output:** `dist/` — served by Cloudflare Pages
- **Source maps:** Disabled in production
- **Dev server:** `0.0.0.0:5173` (all interfaces)
- **Code splitting:** Automatic via `React.lazy()` / `lazyWithRetry()` dynamic imports

### SPA Routing

**File:** `public/_redirects`

```
/* /index.html 200
```

All non-file requests redirect to `index.html` for client-side routing.

---

## Worker Deployment

### wrangler-worker.toml

**File:** `wrangler-worker.toml`

```toml
name = "wasabi-worker"
main = "worker.js"
compatibility_date = "2025-09-27"
compatibility_flags = ["nodejs_compat"]

[observability]
enabled = true

[[d1_databases]]
binding = "DB"
database_name = "wasabi-main"
database_id = "74c85b52-e230-43c1-8d7d-631402b6a682"

[[r2_buckets]]
binding = "DOCS"
bucket_name = "wasabi-docs"

[durable_objects]
bindings = [
  { name = "TABLE_ROOMS", class_name = "TableRoom" },
  { name = "USER_ROOMS", class_name = "UserRoom" }
]

[[migrations]]
tag = "v1"
new_sqlite_classes = ["TableRoom"]

[[migrations]]
tag = "v2"
new_sqlite_classes = ["UserRoom"]

[triggers]
crons = ["*/2 * * * *"]

[vars]
CORS_ORIGINS = "https://wasabi-platform.pages.dev,http://localhost:5173,http://127.0.0.1:5173"

# WASABI_SECRET set via: npx wrangler secret put WASABI_SECRET -c wrangler-worker.toml
```

### Deploy Command

```bash
npx wrangler deploy --config wrangler-worker.toml
```

### Check Deployment

```bash
npx wrangler deployments list --config wrangler-worker.toml
```

---

## Environment Variables & Secrets

### Worker Variables (set in wrangler-worker.toml `[vars]`)

| Variable | Value | Purpose |
|----------|-------|---------|
| CORS_ORIGINS | `https://wasabi-platform.pages.dev,http://localhost:5173,http://127.0.0.1:5173` | Allowed CORS origins, comma-separated |

### Worker Secrets (set via `wrangler secret put`)

| Secret | Purpose |
|--------|---------|
| WASABI_SECRET | JWT HMAC-SHA256 signing key. Set via `npx wrangler secret put WASABI_SECRET -c wrangler-worker.toml` |
| GOOGLE_CLIENT_ID | Google OAuth client ID (for Gmail/Calendar integration) |
| GOOGLE_CLIENT_SECRET | Google OAuth client secret |

### Frontend Variables

Variables prefixed with `VITE_` are embedded at build time and accessible in browser code:

| Variable | Purpose |
|----------|---------|
| VITE_WORKER_URL | Backend worker URL (default: `http://localhost:8787`) |

Set in Cloudflare Pages dashboard under Settings > Environment variables.

---

## Authentication

- **Password hashing:** PBKDF2, 100,000 iterations
- **Access token:** 15-minute JWT (HMAC-SHA256 with WASABI_SECRET), stored in memory
- **Refresh token:** 7-day JWT, stored as HttpOnly cookie
- **Rate limiting:** 5 failed attempts per 900 seconds per IP on auth endpoints
- **Session management:** `active_sessions` D1 table, per-device tracking, revocation support

---

## Responsive Breakpoints

```javascript
BP = { mobile: 768, tablet: 1194 }
```

These are the actual breakpoints used in `src/design/tokens.js` and `src/context/ViewportContext.jsx`. The `useViewport()` hook provides `isMobile` and `isTablet` flags. Graham uses Wasabi on iPad, so responsive design at these breakpoints is critical.

---

## Durable Objects

### TableRoom

Per-table WebSocket room for real-time collaboration:

- Endpoint: `ws://worker-url/ws/table/{tableId}?token={jwt}`
- Broadcasts cell changes to all connected clients
- Tracks concurrent edits via `cell_versions` for conflict detection
- SQLite-backed persistent state

### UserRoom

Per-user WebSocket room for multi-device state sync:

- Endpoint: `ws://worker-url/ws/user/{userId}?token={jwt}`
- Syncs page navigation, UI state across devices
- Handles disconnect/reconnect

Both instantiated via `env.TABLE_ROOMS.idFromName(tableId)` and `env.USER_ROOMS.idFromName(userId)`.

---

## Cron Trigger

Schedule: `*/2 * * * *` (every 2 minutes)

The cron handler runs three tasks:

1. **Automation engine** — Evaluates enabled automation rules, fires matching rules via Claude Haiku
2. **Sync flush** — Pushes `sync_dirty` rows to Notion for tables with active sync configs
3. **Cleanup** — Expires old rate limit entries, cleans stale sessions

---

## Local Development

```bash
# Install dependencies
npm install

# Start dev server
npm run dev
# → http://localhost:5173
```

The frontend connects to `VITE_WORKER_URL` (defaults to `http://localhost:8787`). To use the deployed worker:

```bash
VITE_WORKER_URL=https://your-worker.workers.dev npm run dev
```

---

## Troubleshooting

### npm ci / install fails with EBADPLATFORM

**Cause:** `package-lock.json` was generated with a different npm version than the build environment. Platform-specific packages (like `@esbuild/darwin-arm64`) are locked to a specific OS/arch.

**Fix:**
```bash
rm -rf node_modules package-lock.json && npx -y npm@10 install
```

Commit the regenerated lock file.

### Cloudflare Pages build fails

**Common causes:**
- Lock file version mismatch (see above)
- Node version incompatibility — Pages uses Node 22
- Missing environment variables — check VITE_WORKER_URL is set in Pages settings

### Worker deploy fails

**Common causes:**
- Missing or invalid Cloudflare API token — verify with `npx wrangler whoami`
- Token lacks Workers deploy permission
- D1 database ID in `wrangler-worker.toml` does not exist — verify with `npx wrangler d1 list`

### WebSocket connection drops

- Verify JWT token is not expired (15-min access token)
- Confirm WASABI_SECRET is the same between worker and token issuer
- Check Durable Object bindings in `wrangler-worker.toml`

### D1 query timeout

- Add `limit` parameter — do not query more than 10,000 rows at once
- Verify indexes exist for filtered columns (see `D1_INDEXES` in worker.js)
- Check worker CPU time in Cloudflare dashboard
