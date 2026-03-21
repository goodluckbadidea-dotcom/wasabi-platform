# Wasabi Platform Code Review
## Comprehensive Security and Logic Analysis

**Review Date:** March 20, 2026
**Scope:** Logic bugs, security issues, error handling, architecture, integrations
**Reviewed Files:** worker.js, src/lib/api.js, src/agent/*, src/context/*, src/utils/*, integration files

---

## CRITICAL SEVERITY ISSUES

### 1. **XSS Vulnerability via Plugin Code Execution (PluginWidget.jsx)**
**File:** `/sessions/focused-stoic-noether/mnt/wasabi-platform/src/core/PluginWidget.jsx`
**Lines:** 17-72, especially 62-68
**Category:** Security (XSS)
**Severity:** CRITICAL

**Issue:**
The plugin widget builds an srcdoc HTML document by directly interpolating user-supplied code into a `<script>` tag without any sanitization:

```javascript
function buildSrcdoc(code, themeColors) {
  return `<!DOCTYPE html>
...
<script>
...
try {
  ${code}  // <-- DIRECTLY INTERPOLATED USER CODE
  ...
```

While the code is wrapped in a try-catch, **template string interpolation is NOT safe**. If `code` contains backticks, template syntax, or breaks out of the script tag context, it can execute arbitrary JavaScript or modify the HTML structure.

**Example Attack:**
```javascript
code = "'; alert('XSS'); //"
// Results in: try { '; alert('XSS'); //
// Which comments out the closing code path
```

**Impact:** Arbitrary code execution within the iframe sandbox (limited by iframe sandbox attribute, but still a breach of security boundary)

**Fix:**
1. Use `JSON.stringify(code)` and eval it safely, OR
2. Use a worker/separate execution context with strict CSP, OR
3. Never allow user code in srcdoc directly; instead pass it as data and use postMessage

---

### 2. **Unescaped HTML Injection in IFRAME_AUTO_EXECUTE**
**File:** `/sessions/focused-stoic-noether/mnt/wasabi-platform/src/lib/iframeHelpers.js`
**Lines:** 59-88, specifically lines 73, 80-85
**Category:** Security (XSS)
**Severity:** CRITICAL

**Issue:**
The auto-execute code directly assigns unescaped user data to `innerHTML`:

```javascript
// Line 73:
_html += '<div style="...color:' + window.wasabi.colors.accent + ';">' + display + '</div>';

// Lines 80-85:
_root.innerHTML = '<div>...' + (typeof _data === 'object' ? JSON.stringify(_data, null, 2) : String(_data)) + '</div>';
```

If plugin code returns data with HTML metacharacters or if `window.wasabi.colors.accent` contains malicious content, it will be injected as HTML. Additionally, `JSON.stringify()` output is NOT HTML-safe.

**Example Attack:**
```javascript
// Plugin returns:
{ data: { message: "<script>alert('xss')</script>" } }
// Results in innerHTML assignment with executable script
```

**Impact:** XSS vulnerability within the iframe, potential code execution

**Fix:**
1. Use `textContent` instead of `innerHTML` where possible
2. Use a DOM sanitization library (DOMPurify) before innerHTML assignment
3. Use `document.createElement()` and `appendChild()` for safe DOM construction

---

### 3. **Unvalidated User-Supplied SQL in Notification Query Builder**
**File:** `/sessions/focused-stoic-noether/mnt/wasabi-platform/worker.js`
**Lines:** 1338-1344 (mark-all-read), 1349-1355 (unread-count)
**Category:** Logic Bug / Potential SQL Injection
**Severity:** CRITICAL

**Issue:**
While the query uses parameterized binding (good), the issue is that the query structure itself is dynamically built:

```javascript
let query = "UPDATE notifications SET status = 'read' WHERE status = 'unread'";
const params = [];
if (user && user.role !== "admin") {
  query += " AND (target_user_id = 'all' OR target_user_id = ?)";
  params.push(user.sub);
}
await env.DB.prepare(query).bind(...params).run();
```

While this particular implementation is safe due to parameterized binding, this pattern is error-prone and makes the code vulnerable to logic errors. More critically, if `user.role` check is bypassed or misconfigured, admins get unrestricted access. This is a logic flaw in permission enforcement.

**Impact:** Logic bypass risk, potential unauthorized data access by admins

**Fix:**
1. Always include the user filter in the query for non-admins
2. Consider explicit role-based query branching (separate queries for admin vs. non-admin)
3. Add audit logging for all notification updates

---

## MAJOR SEVERITY ISSUES

### 4. **Race Condition in Authentication State Initialization (AuthContext.jsx)**
**File:** `/sessions/focused-stoic-noether/mnt/wasabi-platform/src/context/AuthContext.jsx`
**Lines:** 42-90
**Category:** Logic Bug (Race Condition)
**Severity:** MAJOR

**Issue:**
The bootstrap process runs two sequential but non-atomic operations:

```javascript
const hasBootstrapped = useRef(false);
useEffect(() => {
  if (!workerConnection?.workerUrl || hasBootstrapped.current) return;
  hasBootstrapped.current = true;

  (async () => {
    // Step 1: Init DB and detect multi-user state
    const result = await initDatabase();
    // ... multi-user detection ...

    // Step 2: Validate JWT (only after init completes)
    const jwt = getJwt();
    if (!jwt) {
      setIdentityLoading(false);
      return;
    }

    try {
      const { user: u } = await authMe();
      // Set identity...
    }
  })();
}, [workerConnection]);
```

**Race Condition:** If `workerConnection` changes while the effect is running, `hasBootstrapped.current` will prevent re-initialization, but the previous initialization may not have completed. This means:
1. Multi-user state may not be correctly detected
2. JWT validation may be skipped
3. Identity may not be set on fast network transitions

Additionally, there's a **missing dependency** warning: the effect should depend on `hasBootstrapped` (though it's a ref) and possibly other state.

**Impact:** Inconsistent authentication state in multi-device/multi-tab scenarios

**Fix:**
1. Use a proper initialization pattern with `useReducer` to manage state transitions atomically
2. Add abort controller to cancel in-flight requests when effect re-runs
3. Ensure JWT validation happens regardless of multi-user detection state

---

### 5. **Unhandled Promise Rejection in useEffect (PagesContext.jsx)**
**File:** `/sessions/focused-stoic-noether/mnt/wasabi-platform/src/context/PagesContext.jsx`
**Lines:** 38-78
**Category:** Error Handling
**Severity:** MAJOR

**Issue:**
The sync effect calls async functions without proper error handling or cleanup:

```javascript
useEffect(() => {
  if (!workerConnection?.workerUrl || hasSynced.current) return;
  hasSynced.current = true;

  loadPageConfigs()
    .then(async (configs) => {
      // ... complex async logic ...
      archivePageConfig(s.id).catch(() => {});
    })
    .catch((err) => console.warn("[Pages] Failed to sync:", err));
}, [workerConnection, user]);
```

**Problems:**
1. If `workerConnection` changes while async operations are in flight, state updates may occur on unmounted component
2. No abort mechanism to cancel in-flight requests
3. Multiple `.catch(() => {})` silently swallow errors without logging
4. The `setPages()` call inside `.then()` can race with another effect run if dependencies change

**Impact:** Memory leaks, inconsistent state, difficult debugging

**Fix:**
1. Use `AbortController` to cancel requests when effect cleanup runs
2. Add explicit checks for mounted state: `if (!mounted) return;`
3. Consolidate error handling with proper logging
4. Consider using a state machine pattern for initialization

---

### 6. **Missing Error Handling in Flow Executor Node Retry Logic (flowExecutor.js)**
**File:** `/sessions/focused-stoic-noether/mnt/wasabi-platform/src/agent/flowExecutor.js`
**Lines:** 211-243
**Category:** Error Handling / Logic Bug
**Severity:** MAJOR

**Issue:**
The retry logic has a subtle bug where errors during retries may not be properly reported:

```javascript
try {
  const inputs = gatherInputs(node, connections, nodeOutputs);
  let result;
  // ... execute node ...
  nodeOutputs[node.id] = result;
  onNodeComplete?.(node.id, result, "success");
  retried = true;
  break;
} catch (retryErr) {
  if (attempt === retryCount) {
    console.error(`[FlowExecutor] Node "${node.label}" failed after ${retryCount} retries:`, retryErr);
  }
}

if (!retried) {
  console.error(`[FlowExecutor] Node "${node.label}" (${node.id}) failed:`, err);
  nodeOutputs[node.id] = { _error: err.message };
  onNodeComplete?.(node.id, null, "error");
}
```

**Problems:**
1. The `retried` flag is only set to `true` if the retry succeeds, but if ALL retries fail, `!retried` is true and the callback is called with `null` result
2. This creates ambiguity: is the node actually failed or did retries succeed?
3. The original `err` object from line 211 is logged again on line 240, not `retryErr`, which is misleading

**Impact:** Incorrect flow execution status reporting, difficulty debugging failures

**Fix:**
```javascript
if (!retried) {
  const finalError = attempt > 0 ? retryErr : err; // Use correct error
  console.error(`[FlowExecutor] Node "${node.label}" failed:`, finalError.message);
  nodeOutputs[node.id] = { _error: finalError.message };
  onNodeComplete?.(node.id, { _error: finalError.message }, "error");
}
```

---

### 7. **Unencrypted JWT Token in LocalStorage (api.js)**
**File:** `/sessions/focused-stoic-noether/mnt/wasabi-platform/src/lib/api.js`
**Lines:** 10-20
**Category:** Security (Data Protection)
**Severity:** MAJOR

**Issue:**
JWT tokens are stored in plaintext localStorage:

```javascript
const JWT_STORAGE_KEY = "wasabi_jwt";

export function getJwt() {
  try { return localStorage.getItem(JWT_STORAGE_KEY) || null; } catch { return null; }
}

export function saveJwt(token) {
  try { localStorage.setItem(JWT_STORAGE_KEY, token); } catch {}
}
```

**Problems:**
1. LocalStorage is susceptible to XSS attacks
2. Any DOM XSS vulnerability can steal the JWT
3. JWT is persisted across browser sessions without encryption
4. No expiration check before use (relies entirely on server validation)

**Impact:** Token theft via XSS, unauthorized access to user accounts

**Fix:**
1. Store JWT in memory only (during session)
2. Use httpOnly cookies for persistence (requires server cooperation)
3. Implement token refresh mechanism
4. Add client-side token validation (check expiry before use)

---

## MODERATE SEVERITY ISSUES

### 8. **Missing Input Validation on Table Query Execution (toolExecutor.js)**
**File:** `/sessions/focused-stoic-noether/mnt/wasabi-platform/src/agent/toolExecutor.js`
**Category:** Error Handling / Input Validation
**Severity:** MODERATE

**Issue:**
The sandbox execution in `executeTransform` and similar functions uses `new Function()` to dynamically execute user-provided code with minimal validation:

```javascript
const fn = new Function("datasets", ...helperNames, fnBody);
```

While there's a check for `eval` and `new Function`, this check is performed on the source code string, not on the actual execution. An attacker could:
1. Use indirect function invocation: `(function(){...})()`
2. Use `Function.constructor`
3. Bypass validation through minification or obfuscation

**Impact:** Code execution outside sandbox scope

**Fix:**
1. Use a proper sandboxing library like `vm2` or `isolated-vm` (if Node.js) or Web Workers
2. Whitelist specific operations rather than blacklist dangerous ones
3. Validate the generated Function parameters rigorously

---

### 9. **Potential NULL Reference in Record Title Resolution (worker.js)**
**File:** `/sessions/focused-stoic-noether/mnt/wasabi-platform/worker.js`
**Lines:** 456-478
**Category:** Error Handling / Robustness
**Severity:** MODERATE

**Issue:**
The `resolveRecordTitle` function has multiple fallback logic paths but doesn't guarantee a safe return:

```javascript
async function resolveRecordTitle(env, tableId, cells) {
  if (!cells || typeof cells !== "object") return "";
  try {
    const schema = await env.DB.prepare("SELECT columns FROM table_schemas WHERE id = ?").bind(tableId).first();
    if (schema?.columns) {
      const cols = JSON.parse(schema.columns);
      const titleCol = cols.find((c) => c.type === "title") || cols[0];
      if (titleCol?.name && cells[titleCol.name]) return String(cells[titleCol.name]);
    }
  } catch (_) {}
  // Fallback: scan common field name patterns...
  // Last resort: first non-empty string value
  for (const k of keys) {
    if (typeof cells[k] === "string" && cells[k].trim()) return cells[k];
  }
  return "";
}
```

**Problems:**
1. `JSON.parse()` can throw and is silently caught, masking real errors (corrupted schema)
2. If no title column exists and no common field names match, the function falls back to the first string value, which may not be descriptive
3. No length limit on returned title (could be very long)

**Impact:** Unclear record titles in notifications/logs, debugging difficulty

**Fix:**
1. Separate JSON parsing error from logical "no title found" case
2. Add length truncation: `return String(cells[titleCol.name]).slice(0, 100)`
3. Add explicit fallback: `return titleCol?.name || "Record " + (cells.id || cells.ID || "")`

---

### 10. **Missing CORS Validation for Notion Proxy (worker.js)**
**File:** `/sessions/focused-stoic-noether/mnt/wasabi-platform/worker.js`
**Lines:** 9-13
**Category:** Security (CORS)
**Severity:** MODERATE

**Issue:**
The CORS headers allow all origins:

```javascript
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Claude-Key, X-Wasabi-Key",
};
```

This is set globally and returned on all responses, including sensitive operations like:
- Notion API proxying
- Google OAuth callback handling
- User management endpoints

**Problems:**
1. Allows any website to make requests on behalf of users
2. Credentials/tokens may be exposed via Authorization headers
3. No origin validation for sensitive operations
4. Violates CSRF protection for state-changing operations

**Impact:** CORS-based CSRF attacks, credential exposure

**Fix:**
```javascript
// Only allow specific origins
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS?.split(',') || ['https://localhost:5173'];
const origin = request.headers.get('origin');
if (ALLOWED_ORIGINS.includes(origin)) {
  headers['Access-Control-Allow-Origin'] = origin;
}
```

---

### 11. **Memory Leak Risk in RecordDetail Hook (useRecordDetail.js)**
**File:** `/sessions/focused-stoic-noether/mnt/wasabi-platform/src/hooks/useRecordDetail.js`
**Lines:** (need to review)
**Category:** Error Handling / Memory
**Severity:** MODERATE

**Issue:**
Custom hooks may not properly clean up listeners or abort in-flight requests. This is a pattern issue across the codebase where useEffect cleanup functions may be missing.

**Fix:**
Ensure all useEffect with side effects have cleanup functions that abort requests and remove listeners.

---

### 12. **Inconsistent Error Handling in Notion Client (notion/client.js)**
**File:** `/sessions/focused-stoic-noether/mnt/wasabi-platform/src/notion/client.js`
**Lines:** 50-52, 69-71, etc.
**Category:** Error Handling
**Severity:** MODERATE

**Issue:**
Error handling is inconsistent across functions:

```javascript
// Line 50-52: Attempts to parse JSON for error details
const errData = await res.json().catch(() => ({}));
const detail = errData._error || errData.message || "";
throw new Error(`Failed to create page (${res.status})${detail ? ": " + detail : ""}`);

// Line 69-71: Just converts to text without attempting parse
const err = await res.text().catch(() => "");
throw new Error(`Failed to update page (${res.status}): ${err}`);
```

Different functions handle errors differently, making debugging difficult. Some may leak internal error details.

**Fix:**
Create a centralized error handler for Notion API responses.

---

## MINOR SEVERITY ISSUES

### 13. **Missing Abort on Multiple Requests (runAgent.js)**
**File:** `/sessions/focused-stoic-noether/mnt/wasabi-platform/src/agent/runAgent.js`
**Lines:** 258-318
**Category:** Error Handling / Performance
**Severity:** MINOR

**Issue:**
The retry loop in `callClaude()` doesn't check if the abort signal has been set between retries, only at the start:

```javascript
for (let attempt = 0; attempt < 5; attempt++) {
  if (abortRef?.current) throw new Error("Aborted");  // ← Only checked once per iteration
  try {
    const res = await fetch(...);
    // ...
  } catch (err) {
    lastError = err;
    if (err.message === "Aborted") throw err;
    const wait = Math.min(2000 * Math.pow(2, attempt), MAX_BACKOFF);
    await sleep(wait);  // ← User might abort during sleep
  }
}
```

**Impact:** User-requested abort may be delayed by up to MAX_BACKOFF (60 seconds)

**Fix:**
```javascript
await sleepWithAbort(wait, abortRef);
```

---

### 14. **Weak Password Policy (worker.js)**
**File:** `/sessions/focused-stoic-noether/mnt/wasabi-platform/worker.js`
**Category:** Security (Authentication)
**Severity:** MINOR

**Issue:**
No minimum password length validation is enforced in `handleAuthRegister`. This allows weak passwords.

**Fix:**
Add validation:
```javascript
if (password.length < 12) throw new Error("Password must be at least 12 characters");
```

---

### 15. **Missing Rate Limiting on Auth Endpoints**
**File:** `/sessions/focused-stoic-noether/mnt/wasabi-platform/worker.js`
**Lines:** 2294-2400
**Category:** Security (Brute Force)
**Severity:** MINOR

**Issue:**
No rate limiting on `/auth/login` or `/auth/register` endpoints. An attacker can brute force credentials or spam registrations.

**Fix:**
Implement rate limiting based on IP or email address using KV or a distributed cache.

---

### 16. **Silent Failure in Connection Key Sync (AuthContext.jsx)**
**File:** `/sessions/focused-stoic-noether/mnt/wasabi-platform/src/context/AuthContext.jsx`
**Lines:** 98-117
**Category:** Error Handling / Debugging
**Severity:** MINOR

**Issue:**
If `getConnections()` fails, the error is silently caught and logged only as a warning:

```javascript
getConnections()
  .then(({ connections }) => { ... })
  .catch((err) => console.warn("[Auth] Failed to sync connections:", err));
```

If external keys (Notion, Claude) aren't synced, users won't know why features aren't working.

**Fix:**
Set an error state flag that can be displayed in the UI.

---

### 17. **Hardcoded Model in Automations (automations.js)**
**File:** `/sessions/focused-stoic-noether/mnt/wasabi-platform/src/agent/automations.js`
**Lines:** 21
**Category:** Architecture / Configuration
**Severity:** MINOR

**Issue:**
The automation model is hardcoded as Haiku:

```javascript
const AUTOMATION_MODEL = "claude-haiku-4-5-20251001";
```

This should be configurable to allow different models based on rule complexity.

---

### 18. **No Expiration on Invite Codes (worker.js)**
**File:** `/sessions/focused-stoic-noether/mnt/wasabi-platform/worker.js`
**Lines:** 2417-2437
**Category:** Security (Authorization)
**Severity:** MINOR

**Issue:**
Invite codes have no expiration time. An old invite code can be used indefinitely.

**Fix:**
```javascript
if (Math.abs(new Date() - new Date(invite.created_at)) > 7 * 24 * 60 * 60 * 1000) {
  throw new Error("Invite code has expired");
}
```

---

## ARCHITECTURAL ISSUES

### 19. **Inadequate State Management in Multi-Device Sync (CollaborationContext.jsx vs AuthContext.jsx)**
**File:** `/sessions/focused-stoic-noether/mnt/wasabi-platform/src/context/CollaborationContext.jsx`
**Category:** Architecture
**Severity:** MAJOR

**Issue:**
Device synchronization relies on WebSocket user sync rooms but authentication state is managed separately in AuthContext. This creates a gap where:
1. WebSocket may connect after auth state is set
2. Disconnection doesn't clear auth state
3. No explicit state consistency checks between auth and sync

**Fix:**
Merge device sync lifecycle with auth state management using a single state machine.

---

### 20. **Circular Dependencies in Integration Modules**
**File:** src/agent/*, src/lib/*, src/notion/*
**Category:** Architecture
**Severity:** MINOR

**Issue:**
Multiple modules import from each other creating potential circular dependencies:
- automations.js imports toolExecutor.js
- toolExecutor.js imports automations.js (expandTemplate)

This can cause issues during bundling or dynamic imports.

**Fix:**
Extract shared utilities into a separate module without cross-imports.

---

## SUMMARY BY SEVERITY

| Severity | Count | Issues |
|----------|-------|--------|
| CRITICAL | 3 | XSS (2), SQL/Logic Bypass (1) |
| MAJOR | 4 | Race conditions, unhandled promises, token storage, sandbox execution |
| MODERATE | 5 | Input validation, NULL refs, CORS, memory leaks, error handling |
| MINOR | 8 | Password policy, rate limiting, configuration, invite expiration |
| ARCHITECTURAL | 2 | State management, circular dependencies |

---

## RECOMMENDATIONS

### Immediate Actions (P0)
1. **XSS Vulnerabilities:** Sanitize plugin code execution in PluginWidget.jsx and iframeHelpers.js
2. **Token Security:** Move JWT from localStorage to memory/httpOnly cookies
3. **SQL Logic:** Add explicit audit logging for all database mutations

### Short-term (P1)
1. Fix race conditions in AuthContext bootstrap
2. Add proper cleanup to all useEffect hooks with side effects
3. Implement rate limiting on auth endpoints
4. Add password policy validation

### Long-term (P2)
1. Refactor state management to use state machines
2. Add comprehensive error monitoring/alerting
3. Implement Web Worker sandboxing for code execution
4. Add integration tests for auth flow

---

## FILES REQUIRING ATTENTION (in priority order)

1. `/sessions/focused-stoic-noether/mnt/wasabi-platform/src/core/PluginWidget.jsx` - CRITICAL
2. `/sessions/focused-stoic-noether/mnt/wasabi-platform/src/lib/iframeHelpers.js` - CRITICAL
3. `/sessions/focused-stoic-noether/mnt/wasabi-platform/worker.js` - MAJOR (multiple issues)
4. `/sessions/focused-stoic-noether/mnt/wasabi-platform/src/context/AuthContext.jsx` - MAJOR
5. `/sessions/focused-stoic-noether/mnt/wasabi-platform/src/context/PagesContext.jsx` - MAJOR
6. `/sessions/focused-stoic-noether/mnt/wasabi-platform/src/lib/api.js` - MAJOR
7. `/sessions/focused-stoic-noether/mnt/wasabi-platform/src/agent/flowExecutor.js` - MAJOR
8. `/sessions/focused-stoic-noether/mnt/wasabi-platform/src/agent/automations.js` - MODERATE
9. `/sessions/focused-stoic-noether/mnt/wasabi-platform/src/notion/client.js` - MODERATE

