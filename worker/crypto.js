// ─── JWT Utilities (HS256 via Web Crypto) ───
export const REFRESH_TOKEN_DAYS = 7;       // Refresh token (HttpOnly cookie): 7 days
export const ACCESS_TOKEN_MINS = 15;        // Access token (in-memory): 15 minutes

export function base64UrlEncode(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64UrlDecode(str) {
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4) str += "=";
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function getJwtKey(env) {
  // Use WASABI_SECRET as the HMAC key material; fall back to a default for dev
  const secret = env.WASABI_SECRET || "wasabi-dev-secret";
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

export async function signJwt(payload, env, ttlSecs = ACCESS_TOKEN_MINS * 60) {
  const key = await getJwtKey(env);
  const header = { alg: "HS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const fullPayload = { ...payload, iat: now, exp: now + ttlSecs };
  const segments = [
    base64UrlEncode(new TextEncoder().encode(JSON.stringify(header))),
    base64UrlEncode(new TextEncoder().encode(JSON.stringify(fullPayload))),
  ];
  const sigInput = new TextEncoder().encode(segments.join("."));
  const sig = await crypto.subtle.sign("HMAC", key, sigInput);
  segments.push(base64UrlEncode(sig));
  return segments.join(".");
}

export async function verifyJwt(token, env) {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const key = await getJwtKey(env);
    const sigInput = new TextEncoder().encode(parts[0] + "." + parts[1]);
    const sig = base64UrlDecode(parts[2]);
    const valid = await crypto.subtle.verify("HMAC", key, sig, sigInput);
    if (!valid) return null;
    const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(parts[1])));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

// Build Set-Cookie header for JWT (HttpOnly, Secure, SameSite=None for cross-origin)
export function buildAuthCookie(token, maxAgeSecs = 7 * 24 * 60 * 60) {
  return `wasabi_jwt=${token}; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=${maxAgeSecs}`;
}
export function buildClearAuthCookie() {
  return "wasabi_jwt=; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=0";
}

// ─── PBKDF2 Password Hashing ───
// Replaces plain SHA-256. Stores as "salt:hash" (both base64url-encoded).
// 100k iterations, SHA-256, 16-byte salt.
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

export async function verifyPassword(text, stored) {
  // Detect legacy format: no ":" means old unsalted SHA-256
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

// Legacy SHA-256 hash (kept for backward-compat migration detection)
async function sha256(text) {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return base64UrlEncode(hash);
}

// ─── AES-256-GCM Secret Encryption ───
// Derives a dedicated DEK from WASABI_SECRET via HKDF — separate from the JWT signing key.
// Format stored in D1: "enc:v1:{base64url-iv}:{base64url-ciphertext}"

async function getDEK(env) {
  const raw = new TextEncoder().encode(env.WASABI_SECRET || "wasabi-dev-secret");
  const keyMaterial = await crypto.subtle.importKey("raw", raw, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new TextEncoder().encode("wasabi-dek-v1"),
      info: new TextEncoder().encode("secret-encryption"),
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function encryptSecret(plaintext, env) {
  const key = await getDEK(env);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext)
  );
  return "enc:v1:" + base64UrlEncode(iv) + ":" + base64UrlEncode(new Uint8Array(ct));
}

// Returns plaintext. If value doesn't start with "enc:v1:" it's legacy plaintext — returned unchanged.
export async function decryptSecret(value, env) {
  if (!value || !value.startsWith("enc:v1:")) return value;
  try {
    const parts = value.split(":");
    if (parts.length !== 4) return value;
    const key = await getDEK(env);
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: base64UrlDecode(parts[2]) },
      key,
      base64UrlDecode(parts[3])
    );
    return new TextDecoder().decode(plain);
  } catch {
    return value; // decryption failure — return raw, don't crash
  }
}
