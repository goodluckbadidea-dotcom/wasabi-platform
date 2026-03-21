# 06 — Build & Deployment

## Overview

Wasabi is deployed on **Cloudflare Pages** (frontend) and **Cloudflare Workers** (backend). The full tech stack uses:
- Frontend: React 18 with Vite build tool
- Backend: Cloudflare Workers with D1 SQLite and R2 storage
- Real-time sync: Durable Objects for WebSocket rooms
- Auth: JWT (HS256) with optional multi-user support

This document covers the complete build, configuration, and deployment process.

---

## Tech Stack & Versions

### Frontend Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| **react** | ^18.3.1 | Core UI framework |
| **react-dom** | ^18.3.1 | React DOM rendering |
| **jspdf** | ^4.2.0 | PDF generation for documents |

### Build & Dev Tools

| Package | Version | Purpose |
|---------|---------|---------|
| **vite** | ^5.4.11 | Lightning-fast build tool and dev server |
| **@vitejs/plugin-react** | ^4.3.4 | React Fast Refresh for HMR |

### Backend Runtime

- **Cloudflare Workers** with `nodejs_compat` compatibility flag
- Compatibility date: `2025-09-27`
- Language: JavaScript (ES modules)

### Cloud Infrastructure

- **Cloudflare Pages:** Frontend static hosting
- **Cloudflare Workers:** Backend API and routing
- **Cloudflare D1:** SQLite database (wasabi-main)
- **Cloudflare R2:** File/document storage (wasabi-docs)
- **Durable Objects:** Real-time WebSocket rooms for table sync and multi-device collaboration

---

## Build Process

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

**Key Settings:**
- **Output directory:** `dist/` (used by Cloudflare Pages)
- **Source maps:** Disabled in production for security
- **Dev server:** Listens on `0.0.0.0:5173` (all interfaces)
- **React plugin:** Enables Fast Refresh for hot module reloading
- **Code splitting:** Automatic via dynamic imports for lazy-loaded views

### Build Steps

1. **Vite bundles React code** → `dist/`
2. **Code splitting:** Large bundles (>100KB) split automatically for better caching
3. **Asset optimization:** Images, fonts, CSS minified
4. **Output:** HTML + JS + CSS ready for Cloudflare Pages

**Lazy-Loaded Chunks (estimated sizes):**
- `ZenTasksView` (~48 KB)
- `ZenChatPanel` (~5 KB)
- `NodeEditor` (~52 KB)
- `FunctionsPanel` (~23 KB)
- `BuildPage` (~24 KB)
- `SashimiDrawer` (~12 KB)
- `ZenGmail` (~14 KB)

### Build Performance

- **Dev build time:** ~1-2 seconds (Vite is instant)
- **Production build time:** ~10-15 seconds
- **Bundle size estimate:** ~300-400 KB (uncompressed, including jspdf)

---

## npm Scripts

### Development

```bash
npm run dev
```
Starts Vite dev server on `http://localhost:5173` with hot reload. All changes update instantly.

### Build

```bash
npm run build
```
Bundles React code and outputs to `dist/`. Used by Cloudflare Pages deployment.

### Preview

```bash
npm run preview
```
Preview production build locally (serves dist/ as static file server).

---

## Cloudflare Pages Configuration

**File:** `wrangler.toml`

```toml
name = "wasabi-platform"
pages_build_output_dir = "./dist"
```

**Deployment Flow:**
1. Pages monitors GitHub repo (via Cloudflare dashboard)
2. On push to main, Pages:
   - Runs `npm install`
   - Runs `npm run build`
   - Serves dist/ on `wasabi-platform.pages.dev`

**Custom Domain:** Configure in Cloudflare dashboard → Pages settings.

**Build Command (Cloudflare default):**
```bash
npm run build
```

**Environment Variables (Pages):**
Set via Cloudflare dashboard → Pages → Settings → Environment variables:
- `VITE_WORKER_URL` — Backend worker URL (e.g., `https://wasabi-api.example.com`)
- `VITE_PUBLIC_API_KEY` — Optional public API key (accessible in browser)

---

## Cloudflare Worker Configuration

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
```

**Key Settings:**

- **D1 Binding:** `DB` → `wasabi-main` SQLite database
- **R2 Binding:** `DOCS` → `wasabi-docs` bucket for file storage
- **Durable Objects:**
  - `TABLE_ROOMS` (class `TableRoom`) — WebSocket rooms for table real-time sync
  - `USER_ROOMS` (class `UserRoom`) — WebSocket rooms for multi-device user state
- **Cron Trigger:** Every 2 minutes for automation rules and sync flush
- **Compatibility:** Node.js compatibility flag enabled for crypto APIs

### Deploying Worker

**Install Wrangler:**
```bash
npm install -g wrangler
```

**Deploy:**
```bash
wrangler deploy -c wrangler-worker.toml
```

**Set secrets (one-time):**
```bash
npx wrangler secret put WASABI_SECRET -c wrangler-worker.toml
```
This sets the shared authentication secret used to validate API requests.

**Check deployment status:**
```bash
wrangler deployments list -c wrangler-worker.toml
```

---

## Environment Variables & Secrets

### Frontend (Vite)

Variables prefixed with `VITE_` are available in browser:

```javascript
// src/main.jsx
const workerUrl = import.meta.env.VITE_WORKER_URL || "http://localhost:8787";
```

**Available variables:**
- `VITE_WORKER_URL` — Backend worker URL (default: localhost:8787)
- `VITE_PUBLIC_API_KEY` — Optional public API key

### Backend (Worker)

Environment variables set via Cloudflare dashboard or `wrangler secret put`:

- `WASABI_SECRET` — Shared authentication secret (required for multi-user mode, can be any strong string)
- D1 & R2 bindings are automatic via `wrangler-worker.toml`

**No hardcoded secrets:** JWT signing uses `WASABI_SECRET`. Google OAuth and Claude API keys are stored in D1 `connections` table.

---

## Local Development

### Setup

```bash
# Install dependencies
npm install

# Start dev server
npm run dev
```

Dev server runs on `http://localhost:5173`.

### Backend Testing

The frontend makes API calls to `import.meta.env.VITE_WORKER_URL`, which defaults to `http://localhost:8787`.

**Option 1: Use live worker**
```bash
export VITE_WORKER_URL=https://wasabi-api.example.com
npm run dev
```

**Option 2: Local worker (requires Cloudflare)**
Complex setup involving local Wrangler. Not recommended for development.

### Single-User Mode

If `WASABI_SECRET` is not set, the worker allows all requests (first-time setup mode). This works for local development and single-user deployments:
- No auth header required
- No JWT validation
- Any user can make any request

---

## Database Migrations

**D1 Migrations:** Stored in `wrangler-worker.toml` under `[[migrations]]`.

Currently defined:
- **v1:** Introduces `TableRoom` Durable Object with SQLite
- **v2:** Introduces `UserRoom` Durable Object

To add a migration:

1. Increment the version tag (v3, v4, etc.)
2. Add new table to `D1_SCHEMA` in `worker.js` (lines 16-319)
3. Add migration block:
   ```toml
   [[migrations]]
   tag = "v3"
   new_sqlite_classes = ["NewClass"]  # if adding Durable Objects
   ```
4. Deploy via `wrangler deploy -c wrangler-worker.toml`

---

## Durable Objects Configuration

### TableRoom (Class)

Handles WebSocket connections for table real-time sync (defined in `worker.js`).

**Endpoints:**
- `ws://api/ws/table/{tableId}?token={jwt}`
- Broadcast cell changes to all connected clients
- Track concurrent edits and version conflicts
- Stored state: SQL schema for persistingthe table's state

### UserRoom (Class)

Handles WebSocket connections for multi-device user state sync (defined in `worker.js`).

**Endpoints:**
- `ws://api/ws/user/{userId}?token={jwt}`
- Sync page state, scroll position, UI focus across devices
- Handle device disconnect/reconnect

Both Durable Objects are instantiated via `env.TABLE_ROOMS.idFromName(tableId)` and `env.USER_ROOMS.idFromName(userId)`.

---

## R2 Storage Configuration

**Bucket Name:** `wasabi-docs`
**Region:** Automatic (geographically distributed)

**Key structure:**
```
docs/{doc_id}.json         — Document content
files/{file_id}_{name}     — User-uploaded files
backups/{page_id}_{ts}.json — Sync backups
```

**File size limits:**
- Cloudflare R2 max object size: 5 TB
- Wasabi typical objects: 50 KB – 50 MB (documents, PDFs)

**Recommended lifecycle management:**
- Delete orphaned files older than 30 days
- Consider versioning sensitive documents
- Not yet implemented

---

## HTML Entry Point

**File:** `index.html`

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <title>Wasabi</title>
    <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,<svg>...</svg>" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=DM+Sans:wght@400;500;600;700&family=Outfit:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
    <style>
      *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
      html, body { height: 100%; width: 100%; overflow: hidden; }
      #root { position: fixed; top: 0; left: 0; right: 0; bottom: 0; overflow: hidden; }
      body { font-family: 'Outfit', 'DM Sans', sans-serif; -webkit-font-smoothing: antialiased; }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
```

**Key Details:**
- Loads fonts from Google Fonts (DM Mono, DM Sans, Outfit)
- Embedded SVG favicon (Wasabi logo)
- Full-height layout with fixed positioning (no scroll)
- Mounts React app into `#root`

---

## Redirect Rules

**File:** `public/_redirects`

```
/* /index.html 200
```

**Purpose:** React SPA routing. All non-file requests redirect to index.html, allowing React Router to handle navigation.

---

## CodeSandbox Configuration

**File:** `.codesandbox/tasks.json`

```json
{
  "$schema": "https://codesandbox.io/schemas/tasks.json",
  "setupTasks": [
    {
      "name": "Install Dependencies",
      "command": "npm install"
    }
  ],
  "tasks": {
    "dev": {
      "name": "Development Server",
      "command": "npm run dev",
      "runAtStart": true,
      "preview": {
        "port": 5173
      }
    }
  }
}
```

**Effect:** CodeSandbox automatically runs `npm install` then `npm run dev`, making the project runnable in the browser without local setup.

---

## Production Considerations

### Security

- **WASABI_SECRET:** Must be strong and kept secret. Used for auth header validation and JWT signing.
- **CORS:** Currently allows all origins (`Access-Control-Allow-Origin: *`). Should be restricted in production (see code review).
- **JWT Storage:** Currently in localStorage (vulnerable to XSS). Should use httpOnly cookies + refresh tokens.
- **SSL/TLS:** Cloudflare provides free SSL for all deployments.

### Performance

- **Caching:** Cloudflare Cache Rules can cache static assets (CSS, JS, images) for 1 day or more
- **Database:** D1 queries are typically <100ms. Use pagination for large result sets (>1000 rows).
- **R2:** Files cached via Cloudflare CDN. First access may be slower (~500ms).
- **Durable Objects:** Real-time sync adds <50ms latency per message (network + processing).

### Monitoring

**Cloudflare Analytics:**
- Worker CPU time, request count, errors
- Pages build logs and deployment history
- D1 query logs (enable in dashboard)

**Error Tracking:**
- Implement Sentry or similar for frontend error tracking
- Log backend errors to external service (not yet configured)

### Backup & Disaster Recovery

**Currently missing:**
- D1 database backups (Cloudflare may auto-backup, verify)
- R2 file versioning or replication
- No documented recovery procedure

**Recommendations:**
- Enable D1 backups via Cloudflare dashboard
- Enable R2 versioning or cross-region replication
- Regular export of page configs and critical data

---

## Troubleshooting

### Build Fails

**Issue:** `npm run build` fails with module errors
- Check Node.js version (should be 16+)
- Delete `node_modules/` and `package-lock.json`, run `npm install`
- Check for TypeScript errors in `src/`

### Worker Deploy Fails

**Issue:** `wrangler deploy` returns 401 or permission error
- Verify `CLOUDFLARE_API_TOKEN` is set correctly
- Check token has Worker deploy permissions
- Verify `database_id` in `wrangler-worker.toml` exists

### D1 Queries Timeout

**Issue:** `POST /tables/{id}/query` times out for large tables
- Add `limit` parameter (don't query >10000 rows at once)
- Add index on frequently filtered fields
- Check worker CPU time in Cloudflare dashboard

### WebSocket Connection Fails

**Issue:** `ws://api/ws/table/{id}` connection drops after a few seconds
- Check JWT token is valid (compare `exp` to current time)
- Verify `WASABI_SECRET` matches between Pages and Worker
- Check Durable Object is properly configured in `wrangler-worker.toml`

---

## Known Issues & Gaps

See `/sessions/focused-stoic-noether/code-review.md` for complete list. Key deployment issues:

1. **Missing monitoring:** No metrics, logs, or alerts for production issues
2. **No backup strategy:** D1 and R2 backups not configured
3. **CORS too permissive:** Should restrict to specific origins
4. **No rate limiting:** Can be spammed with requests (especially auth endpoints)
5. **No API versioning:** Breaking changes will affect all clients
6. **No canary/blue-green deployment:** Worker deploys are instant and global (risky)

---

## Resources

- **Vite Docs:** https://vitejs.dev
- **Cloudflare Workers Docs:** https://developers.cloudflare.com/workers
- **Cloudflare Pages Docs:** https://developers.cloudflare.com/pages
- **Cloudflare D1 Docs:** https://developers.cloudflare.com/d1
- **Cloudflare R2 Docs:** https://developers.cloudflare.com/r2
- **Durable Objects Docs:** https://developers.cloudflare.com/workers/runtime-apis/durable-objects
