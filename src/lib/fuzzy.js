// ─── Fuzzy matching helpers ───
// Used by SearchModal for client-side page name fallback. Worker uses an
// equivalent implementation inline in worker/handlers/search.js so the
// two run independently — no module-sharing across worker/frontend.
//
// Approach: normalized Levenshtein distance, computed against both the
// full candidate string and each whitespace-delimited token. Returns the
// best similarity (0–1). Threshold ~0.7 catches single-character typos
// without surfacing noise from coincidental short overlaps.

export function normalizeForFuzzy(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const m = a.length, n = b.length;
  let prev = new Array(n + 1);
  let curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

function similarity(a, b) {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

// Best similarity between query and a candidate string. Tries the full
// normalized candidate, plus each token, and returns the max. This lets
// "treform" match "1st Run Tins (Treeform)" because the "treeform" token
// alone is close enough — even though the full string is far off.
export function fuzzySimilarity(query, candidate) {
  const q = normalizeForFuzzy(query);
  const c = normalizeForFuzzy(candidate);
  if (!q || !c) return 0;
  let best = similarity(q, c);
  for (const token of c.split(" ")) {
    if (!token) continue;
    const s = similarity(q, token);
    if (s > best) best = s;
  }
  return best;
}

export const FUZZY_THRESHOLD = 0.7;
export const FUZZY_MIN_QUERY_LENGTH = 3;
