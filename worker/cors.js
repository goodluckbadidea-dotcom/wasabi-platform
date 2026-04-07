// ─── CORS with Origin Whitelist ───
// Checks request Origin against CORS_ORIGINS env var (comma-separated).
// Falls back to allowing localhost dev origins if not set.

const DEFAULT_CORS_ORIGINS = "http://localhost:5173,http://127.0.0.1:5173";

export function getCorsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowed = (env?.CORS_ORIGINS || DEFAULT_CORS_ORIGINS)
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  // Allow if origin matches whitelist, or if no origin (same-origin / non-browser)
  const allowOrigin = !origin || allowed.includes(origin) ? origin || "*" : "";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Claude-Key, X-Wasabi-Key, X-Wasabi-Pin-Token",
    "Access-Control-Allow-Credentials": "true",
    ...(allowOrigin && allowOrigin !== "*" ? { "Vary": "Origin" } : {}),
  };
}
