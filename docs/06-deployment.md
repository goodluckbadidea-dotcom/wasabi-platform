# 06 — Deployment

## Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + Vite 5 (SPA) |
| Hosting | Cloudflare Pages |
| Backend | Cloudflare Worker (separate repo) |
| Database | Cloudflare D1 (SQLite) |
| Storage | Cloudflare R2 (object storage) |
| Auth | X-Wasabi-Key header + Google OAuth (server-side) |

## Build

```bash
npm run build     # vite build → dist/
npm run dev       # vite --host 0.0.0.0 (local dev)
npm run preview   # vite preview (local preview of build)
```

### Vite Config

- Plugin: `@vitejs/plugin-react`
- Output: `dist/` directory
- Code splitting via `React.lazy()` for large components

### Lazy-Loaded Chunks

These components are code-split into separate bundles:
- `ZenTasksView` (~48 KB)
- `ZenChatPanel` (~5 KB)
- `ZenNotes` (~6 KB)
- `ZenDashboard` (~1.5 KB)
- `ZenGmail` (~14 KB)
- `SashimiDrawer` (~12 KB)
- `FunctionsPanel` (~23 KB)
- `BuildPage` (~24 KB)
- `NodeEditor` (~52 KB)

## Deploy to Cloudflare Pages

```bash
npx wrangler pages deploy dist --project-name=wasabi-platform
```

### Pages Configuration

- `_redirects` file in dist for SPA routing
- All routes → `index.html` (client-side routing)

## Environment

### Frontend (no env vars needed)
- Worker URL + secret stored in `localStorage` key `wasabi_connection`
- Configured during Setup Wizard (`src/core/SetupWizard.jsx`)

### Backend (Cloudflare Worker — separate repo)
- D1 database binding
- R2 bucket binding
- Google OAuth credentials (client ID, client secret)
- Claude API key (for AI proxy)
- Notion API passthrough

## Architecture

```
┌─────────────────────┐     ┌──────────────────────┐
│  Cloudflare Pages   │     │  Cloudflare Worker    │
│  (wasabi-platform)  │────▶│  (wasabi-worker)      │
│                     │     │                       │
│  React SPA          │     │  ├─ D1 (SQLite)       │
│  Vite build         │     │  ├─ R2 (files/docs)   │
│  Static assets      │     │  ├─ Google OAuth       │
│                     │     │  ├─ Notion Proxy       │
│                     │     │  └─ Claude Proxy       │
└─────────────────────┘     └──────────────────────┘
```

### API Communication

- All API calls go through `src/lib/api.js` → `apiFetch()`
- Base URL: user's worker URL (e.g., `https://wasabi-worker.username.workers.dev`)
- Auth: `X-Wasabi-Key` header with user's secret
- Content-Type: `application/json`

## Dependencies

Minimal dependency footprint:

```json
{
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.3.4",
    "vite": "^5.4.11"
  }
}
```

No external UI libraries, no state management libraries, no CSS frameworks. Everything is built from scratch using React + inline styles.
