// ─── Crypto Utilities ───
// Pure PBKDF2 password hashing functions.
// Extracted from worker.js for testability.
// Uses Web Crypto API (available in Node 20+, browsers, and Cloudflare Workers).

function base64UrlEncode(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(str) {
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4) str += "=";
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function sha256(text) {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return base64UrlEncode(hash);
}

/**
 * Hash a password with PBKDF2 (100k iterations, SHA-256, 16-byte salt).
 * Returns "salt:hash" (both base64url-encoded).
 */
export async function hashPassword(text) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(text), "PBKDF2", false, ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
    keyMaterial, 256
  );
  return base64UrlEncode(salt) + ":" + base64UrlEncode(bits);
}

/**
 * Verify a password against a stored hash.
 * Supports both new "salt:hash" format and legacy unsalted SHA-256.
 */
export async function verifyPassword(text, stored) {
  if (!stored.includes(":")) {
    return (await sha256(text)) === stored;
  }
  const [saltB64, hashB64] = stored.split(":");
  const salt = base64UrlDecode(saltB64);
  const keyMaterial = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(text), "PBKDF2", false, ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
    keyMaterial, 256
  );
  return base64UrlEncode(bits) === hashB64;
}
