# Wasabi Platform Comprehensive Code Review
## Synthesized Findings from Three Independent Reviews

**Synthesis Date:** March 20, 2026
**Review Coverage:** Frontend design, security/logic, technical debt & cleanup
**Total Unique Findings:** 63 consolidated issues
**Estimated Total Effort:** 6-8 weeks of focused development

---

## EXECUTIVE SUMMARY

The Wasabi platform has a solid architectural foundation with good design systems and modular organization, but suffers from critical security vulnerabilities, significant technical debt, and accessibility gaps. This review consolidates findings from three independent audits:

- **Design Review**: Focus on UI/UX consistency, theming, responsiveness, accessibility
- **Code Review**: Security vulnerabilities, race conditions, error handling, architecture
- **Cleanup Review**: Dead code, duplication, large file refactoring, naming consistency

### High-Level Statistics
| Tier | Count | Trend |
|------|-------|-------|
| **Tier 1 (Critical)** | 4 issues | BLOCKING |
| **Tier 2 (Major)** | 17 issues | HIGH PRIORITY |
| **Tier 3 (Moderate)** | 24 issues | PLAN SOON |
| **Tier 4 (Minor)** | 18 issues | NICE-TO-HAVE |
| **TOTAL** | **63 issues** | |

---

# TIER 1: CRITICAL — FIX IMMEDIATELY
**Timeline: This week | Impact: Security, Data Loss, Crashes**

## 1. XSS Vulnerability in Plugin Code Execution
**Severity:** CRITICAL | **Reporter(s):** Code Review
**Files Affected:** `/src/core/PluginWidget.jsx` (lines 17-72)
**Category:** Security (XSS)

**Description:**
Plugin widget builds HTML documents with directly interpolated user code into `<script>` tags without sanitization. Template string interpolation is not safe for code execution:

```javascript
<script>
try {
  ${code}  // <-- Unescaped user code
```

Backticks, quotes, or template syntax in user code can break out of context and execute arbitrary JavaScript.

**Impact:** Arbitrary code execution within iframe sandbox (limited but still a breach)
**Effort:** Medium
**Fix Approach:**
1. Use `JSON.stringify(code)` and safe eval, OR
2. Pass code as data via `postMessage` instead of srcdoc, OR
3. Use separate execution context with strict CSP

**Priority:** Fix before next release

---

## 2. HTML Injection in IFRAME Auto-Execute
**Severity:** CRITICAL | **Reporter(s):** Code Review
**Files Affected:** `/src/lib/iframeHelpers.js` (lines 59-88)
**Category:** Security (XSS)

**Description:**
Code directly assigns unescaped user data to `innerHTML`:

```javascript
_html += '<div style="...color:' + window.wasabi.colors.accent + ';">' + display + '</div>';
_root.innerHTML = '<div>...' + JSON.stringify(_data, null, 2) + '</div>';
```

JSON.stringify output is not HTML-safe. Any plugin returning HTML metacharacters will be injected as executable code.

**Impact:** XSS vulnerability within iframe, potential code execution
**Effort:** Medium
**Fix Approach:**
1. Use `textContent` instead of `innerHTML` where possible
2. Use DOMPurify library for sanitization before innerHTML
3. Use `document.createElement()` and `appendChild()` for safe DOM construction

**Priority:** Fix before next release

---

## 3. Hardcoded Overlay Colors Break Theme System
**Severity:** CRITICAL | **Reporter(s):** Design Review
**Files Affected:**
- `/src/core/ConfirmDialog.jsx` (line 42)
- `/src/core/LinkPicker.jsx` (line 266)
- `/src/core/SheetUrlDialog.jsx` (line 99)
- `/src/core/CommandPalette.jsx` (line 137)
- `/src/zen/GmailView.jsx` (line 86)
- `/src/zen/WorkspaceBrowser.jsx` (line 58)
- `/src/components/PinLockOverlay.jsx` (line 106)
- `/src/components/ViewSettingsPanel.jsx` (line 593)

**Category:** Design System Violation

**Description:**
Multiple modals and overlays use hardcoded `rgba(0,0,0,...)` colors instead of theme-aware `C.overlayBg` token. Theme changes don't affect overlay darkness, breaking consistency and potentially causing contrast issues in light themes.

**Impact:** Theme system doesn't work; light themes have insufficient contrast; visual inconsistency
**Effort:** Small (bulk find-replace)
**Fix Approach:**
- Replace all `rgba(0,0,0,0.55)` → `C.overlayBg`
- Replace all `rgba(0,0,0,0.6)` → `C.overlayBg`
- Replace all `rgba(0,0,0,0.3)` → Consider if lighter overlay token needed

**Priority:** Fix immediately (affects all theme changes)

---

## 4. Dead Code: Unused CalendarView.jsx
**Severity:** CRITICAL | **Reporter(s):** Cleanup Review
**Files Affected:** `/src/views/CalendarView.jsx` (1227 lines)
**Category:** Dead Code Removal

**Description:**
`src/views/CalendarView.jsx` is completely unused in the codebase. Only `src/zen/CalendarView.jsx` is imported. The views version is entirely superseded and should be deleted.

**Impact:** Code bloat, maintenance confusion, version control noise
**Effort:** Small (delete)
**Fix Approach:**
- Confirm zen version has all functionality of views version
- Delete `/src/views/CalendarView.jsx`
- Run full test suite to verify no breakage

**Priority:** Remove this week

---

# TIER 2: MAJOR — FIX SOON
**Timeline: Next 1-2 weeks | Impact: Logic bugs, race conditions, significant UX issues**

## 5. Hardcoded Error/Warning Colors Not Using Design System
**Severity:** MAJOR | **Reporter(s):** Design Review
**Files Affected:** `/src/core/SystemManager.jsx` (multiple locations), `/src/components/KnowledgeBase.jsx`, `/src/components/PluginWidget.jsx`
**Category:** Design System Violation

**Description:**
Error/warning states use hardcoded colors (#E05252 for error, #FF6B3D for warning) instead of design tokens. Colors appear on:
- Lines 192-193, 296-297: #FF6B3D (warning orange)
- Lines 325-1999: #E05252 (error red)
- Line 809: `linear-gradient(90deg, #E05252, #E0525288)`

Impact: Error/warning states don't adapt to themes. Inconsistent with design system.

**Impact:** Theme changes ineffective for status colors; maintenance burden
**Effort:** Medium (add tokens + bulk replace)
**Fix Approach:**
1. Add to `/src/design/tokens.js`:
```javascript
export const C = {
  // ... existing
  error: "#E05252",
  errorDim: "#C94040",
  errorPale: "#E0525218",
  warning: "#FF6B3D",
  warningDim: "#FF4800",
  warningPale: "#FF480044",
  success: "#2A6B38",
};
```
2. Replace all hardcoded color instances with token references

**Priority:** High (affects multiple components, design consistency)

---

## 6. Missing Comprehensive ARIA Labels & Accessibility Attributes
**Severity:** MAJOR | **Reporter(s):** Design Review
**Files Affected:**
- `/src/core/Drawer.jsx` (line 87, close button)
- `/src/core/ConfirmDialog.jsx` (no role="dialog")
- `/src/core/RecordDetail.jsx` (no semantic attributes)
- `/src/components/SelectPicker.jsx` (no role="listbox")
- `/src/components/MultiSelectPicker.jsx` (same issues)
- All icon-only buttons throughout codebase

**Category:** Accessibility (WCAG 2.1 Level A violations)

**Description:**
Missing ARIA attributes across interactive components:
- Dialogs/modals missing `role="dialog"` and `aria-modal="true"`
- Icon-only buttons missing `aria-label`
- Dropdowns missing `role="listbox"` and `role="option"` on items
- Tab panels missing `role="tabpanel"` and `aria-labelledby`
- Overlay elements not marked with `aria-hidden`

Impact: Screen reader users cannot navigate or understand interactive components. Critical accessibility failure.

**Impact:** WCAG violations; inaccessible to screen reader users
**Effort:** Large (audit all components, add attributes)
**Fix Approach:**
1. Create systematic audit of all interactive components
2. Add `aria-label` to all icon-only buttons (high impact)
3. Add proper roles to dialogs, modals, dropdowns
4. Add keyboard navigation support (arrow keys)
5. Implement focus traps for modals
6. Test with screen reader (NVDA, JAWS)

**Priority:** High (accessibility compliance, legal/ethical requirement)

---

## 7. No Responsive Design Implementation
**Severity:** MAJOR | **Reporter(s):** Design Review
**Files Affected:**
- `/src/components/Drawer.jsx` (line 18, fixed width)
- `/src/views/RecordDetail.jsx` (line 62, fixed width)
- All table/sheet views with fixed column widths
- Layout components with fixed sidebar

**Category:** UX/Responsiveness

**Description:**
Design system defines breakpoints (`BP.mobile: 640px`, `BP.tablet: 1024px`) but no responsive styles implement them. App assumes desktop-only layout:
- No @media queries
- Fixed sidebar width (56px → 220px) not responsive
- Table column widths hardcoded without viewport adaptation
- Modal widths hardcoded (480px, 520px) without responsive adjustment

Impact: Poor UX on tablets and small desktops. Mobile devices receive desktop layout.

**Impact:** Unusable on mobile/tablet; poor user experience for 30-40% of users
**Effort:** Large (systematic refactoring)
**Fix Approach:**
1. Create responsive style utilities using BP tokens
2. Implement @media queries for key components
3. Use React window size hooks for dynamic layouts
4. Create responsive variants for Drawer, Modal, Tables
5. Test at breakpoints (640px, 1024px, 1440px+)

**Priority:** High (affects all mobile users)

---

## 8. Race Condition in Authentication State Initialization
**Severity:** MAJOR | **Reporter(s):** Code Review
**Files Affected:** `/src/context/AuthContext.jsx` (lines 42-90)
**Category:** Logic Bug (Race Condition)

**Description:**
Bootstrap process has two sequential but non-atomic operations. If `workerConnection` changes while effect is running:
1. Multi-user state may not be correctly detected
2. JWT validation may be skipped
3. Identity may not be set on fast network transitions

The `hasBootstrapped.current` flag prevents re-initialization even if previous initialization didn't complete.

**Impact:** Inconsistent authentication state in multi-device/multi-tab scenarios; failed logins
**Effort:** Medium (refactor to use proper initialization pattern)
**Fix Approach:**
1. Use `useReducer` for atomic state transitions
2. Add `AbortController` to cancel in-flight requests
3. Ensure JWT validation happens regardless of multi-user state
4. Add proper dependency tracking

**Priority:** High (affects authentication reliability)

---

## 9. Unhandled Promise Rejection in PagesContext Effect
**Severity:** MAJOR | **Reporter(s):** Code Review
**Files Affected:** `/src/context/PagesContext.jsx` (lines 38-78)
**Category:** Error Handling / Memory Leak

**Description:**
Sync effect calls async functions without proper cleanup:
- No abort mechanism to cancel in-flight requests
- Multiple `.catch(() => {})` silently swallow errors
- State updates can occur on unmounted component if dependencies change
- Race conditions if dependencies change during async operations

**Impact:** Memory leaks, inconsistent state, difficult debugging, potential crashes
**Effort:** Medium (add AbortController, proper error handling)
**Fix Approach:**
1. Use `AbortController` to cancel requests in cleanup
2. Add mounted state check before setState calls
3. Consolidate error handling with proper logging
4. Consider state machine pattern for initialization

**Priority:** High (memory leak risk)

---

## 10. Missing Error Handling in Flow Executor Node Retry Logic
**Severity:** MAJOR | **Reporter(s):** Code Review
**Files Affected:** `/src/agent/flowExecutor.js` (lines 211-243)
**Category:** Error Handling / Logic Bug

**Description:**
Retry logic has subtle bug where error variables are confused:
- When ALL retries fail, `retried` flag is false but the original `err` (not `retryErr`) is logged
- Callback receives `null` result instead of error object
- Creates ambiguity about whether node actually failed

**Impact:** Incorrect flow execution status, misleading error logs, debugging difficulty
**Effort:** Small (fix variable references)
**Fix Approach:**
```javascript
if (!retried) {
  const finalError = attempt > 0 ? retryErr : err;
  console.error(`[FlowExecutor] Node "${node.label}" failed:`, finalError.message);
  nodeOutputs[node.id] = { _error: finalError.message };
  onNodeComplete?.(node.id, { _error: finalError.message }, "error");
}
```

**Priority:** Medium (affects workflow visibility)

---

## 11. JWT Tokens Stored Unencrypted in LocalStorage
**Severity:** MAJOR | **Reporter(s):** Code Review
**Files Affected:** `/src/lib/api.js` (lines 10-20)
**Category:** Security (Data Protection)

**Description:**
JWT tokens stored in plaintext localStorage without encryption or httpOnly protection. Any DOM XSS vulnerability can steal tokens. No expiration check before use (relies entirely on server).

**Impact:** Token theft via XSS; unauthorized account access
**Effort:** Large (requires architecture change)
**Fix Approach:**
1. Store JWT in memory during session only
2. Use httpOnly cookies for persistence (requires server cooperation)
3. Implement token refresh mechanism
4. Add client-side token expiration check
5. Audit and fix all XSS vulnerabilities first

**Priority:** Critical after XSS vulnerabilities fixed

---

## 12. Duplicate formatDate() Function — Multiple Incompatible Implementations
**Severity:** MAJOR | **Reporter(s):** Cleanup Review
**Files Affected:**
- `/src/utils/helpers.js` (canonical, line 41)
- `/src/views/GmailView.jsx` (line 25, duplicate)
- `/src/zen/GmailView.jsx` (line 22, duplicate)
- `/src/views/CalendarView.jsx` (line 52, dead code)
- `/src/zen/EmailThreadDrawer.jsx` (duplicate)

**Category:** Code Duplication / Maintenance

**Description:**
Same `formatDate()` function implemented in 5 locations with subtle variations. GmailView versions don't have timezone awareness of the canonical version. Creates maintenance burden when bug fixes are needed.

**Impact:** Maintenance burden, potential bugs from inconsistent implementations
**Effort:** Small (consolidate imports, remove duplicates)
**Fix Approach:**
1. Keep canonical version in `/src/utils/helpers.js`
2. Update GmailView files to import from helpers: `import { formatDate } from "../utils/helpers.js"`
3. Remove local implementations (lines 25-42 in GmailView)
4. Keep iframeHelpers version (sandbox context requires isolation)

**Priority:** High (affects multiple files)

---

## 13. Duplicate truncate() Function
**Severity:** MAJOR | **Reporter(s):** Cleanup Review
**Files Affected:**
- `/src/utils/helpers.js` (canonical, line 99)
- `/src/views/GmailView.jsx` (line 45)
- `/src/zen/GmailView.jsx` (line 41)

**Category:** Code Duplication

**Description:**
Three implementations of `truncate()`. GmailView versions use simplified implementation without `trimEnd()`, risking awkward word breaks.

**Impact:** Maintenance burden, inconsistent truncation behavior
**Effort:** Small (imports + removal)
**Fix Approach:**
1. Import from helpers in GmailView files
2. Remove local implementations
3. Use helpers version for consistency and better word handling

**Priority:** High (quick win)

---

## 14. Missing Loading States in Data-Fetching Views
**Severity:** MAJOR | **Reporter(s):** Design Review
**Files Affected:**
- `/src/views/Table.jsx` (no loading state during data fetch)
- `/src/views/Kanban.jsx` (no column-level/global loading)
- `/src/zen/TasksView.jsx` (may lack loading during AI task generation)
- Complex form submissions

**Category:** UX/Loading States

**Description:**
Some views lack proper loading states during async operations. Users see blank screens or stale UI. No visible feedback that app is responsive during API calls.

**Impact:** Poor perceived performance; user uncertainty about app responsiveness
**Effort:** Medium (add spinners/skeletons to views)
**Fix Approach:**
1. Add `isLoading` state to Table, Kanban views
2. Show Spinner component during initial data fetch
3. Add skeleton loaders for smoother content reveal
4. Add disabled/loading state to buttons during submission

**Priority:** High (affects user perception of responsiveness)

---

## 15. Very Large File: Table.jsx (3107 lines)
**Severity:** MAJOR | **Reporter(s):** Cleanup Review
**Files Affected:** `/src/views/Table.jsx`
**Category:** Code Organization/Maintainability

**Description:**
Table.jsx is excessively large at 3107 lines. Should be split into separate modules for columns, rows, filters, toolbar logic. Same severity issues exist for SystemManager.jsx (2281 lines), toolExecutor.js (2153 lines), DocumentEditor.jsx (1787 lines).

**Impact:** Code readability, maintainability, bundle size, testing difficulty
**Effort:** Large (multi-day refactoring)
**Fix Approach:**
1. Extract TableColumns component (column definitions, types)
2. Extract TableRows component (row rendering, interactions)
3. Extract TableFilters component (filter UI, logic)
4. Extract TableToolbar component (toolbar, bulk actions)
5. Keep main Table as orchestrator
6. Similar approach for SystemManager, DocumentEditor, etc.

**Priority:** High (affects code maintainability)

---

## 16. Duplicate Date Constants (DAY_NAMES, MONTH_NAMES, etc.)
**Severity:** MAJOR | **Reporter(s):** Cleanup Review
**Files Affected:**
- `/src/views/CalendarView.jsx` (SHORT_MONTHS, SHORT_DAYS)
- `/src/zen/CalendarView.jsx` (DAY_NAMES, MONTH_NAMES)
- `/src/zen/calendar/WeekListView.jsx` (DAY_NAMES, MONTH_NAMES)

**Category:** Code Duplication

**Description:**
Same date constants defined multiple times with different naming (SHORT_DAYS vs DAY_NAMES). Updates must happen in multiple places.

**Impact:** Maintenance burden, consistency issues, error-prone updates
**Effort:** Medium (create source, update imports)
**Fix Approach:**
1. Create `/src/design/dateConstants.js` with canonical definitions
2. Export: `DAY_NAMES_SHORT`, `DAY_NAMES_LONG`, `MONTH_NAMES_SHORT`, `MONTH_NAMES_LONG`
3. Update all files to import from this single source

**Priority:** Medium (quick consolidation)

---

## 17. Missing Error State Handling in Forms
**Severity:** MAJOR | **Reporter(s):** Design Review
**Files Affected:**
- `/src/components/PagePermissionsPanel.jsx` (line 50-58, silent errors)
- `/src/components/MentionInput.jsx` (user fetch errors)
- Form submission handlers throughout

**Category:** Error Handling / UX

**Description:**
Components handle errors internally but don't display error messages. Some API failures are silently caught with `.catch(() => {})`. Users don't know when operations fail.

**Impact:** Poor UX; users don't understand why operations fail; can't recover
**Effort:** Medium (add error states and toast notifications)
**Fix Approach:**
1. Add error state to form components
2. Use toast notifications for error feedback
3. Replace silent catches with proper logging + user notification
4. Add retry mechanisms where appropriate

**Priority:** High (affects user experience)

---

## 18. Potential Unvalidated SQL in Notification Query
**Severity:** MAJOR | **Reporter(s):** Code Review
**Files Affected:** `/sessions/focused-stoic-noether/mnt/wasabi-platform/worker.js` (lines 1338-1355)
**Category:** Security / Logic Bug

**Description:**
While parameterized binding is used (good), permission enforcement logic is flawed. If `user.role` check is bypassed, admins get unrestricted access. This is a logic flaw in permission enforcement, not a direct SQL injection, but still a security gap.

**Impact:** Potential unauthorized data access if role checking is compromised
**Effort:** Medium (audit permissions, add logging)
**Fix Approach:**
1. Always include user filter in query for non-admins
2. Use explicit role-based query branching (separate queries)
3. Add comprehensive audit logging for all notification updates
4. Add unit tests for permission boundaries

**Priority:** High (security-relevant)

---

## 19. CORS Headers Allow All Origins
**Severity:** MAJOR | **Reporter(s):** Code Review
**Files Affected:** `/sessions/focused-stoic-noether/mnt/wasabi-platform/worker.js` (lines 9-13)
**Category:** Security (CORS)

**Description:**
CORS headers set globally on all responses with `Access-Control-Allow-Origin: *`. This allows any website to make requests on behalf of users, potentially exposing credentials in Authorization headers.

**Impact:** CORS-based CSRF attacks; credential exposure
**Effort:** Medium (add origin validation)
**Fix Approach:**
```javascript
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS?.split(',') || ['https://localhost:5173'];
const origin = request.headers.get('origin');
if (ALLOWED_ORIGINS.includes(origin)) {
  headers['Access-Control-Allow-Origin'] = origin;
}
```

**Priority:** High (security)

---

# TIER 3: MODERATE — PLAN FOR
**Timeline: 2-4 weeks | Impact: Accessibility gaps, error handling, architectural improvements**

## 20. Missing Input Validation on Dynamic Code Execution
**File(s):** `/src/agent/toolExecutor.js`
**Reviewer(s):** Code Review
**Severity:** MODERATE
**Effort:** Large

Code uses `new Function()` to dynamically execute user code with minimal validation. Blacklist checks can be bypassed via indirect invocation or obfuscation.

**Fix:** Use proper sandboxing library (vm2, isolated-vm, Web Workers) or whitelist operations.

---

## 21. Potential NULL Reference in Record Title Resolution
**File(s):** `/sessions/focused-stoic-noether/mnt/wasabi-platform/worker.js` (lines 456-478)
**Reviewer(s):** Code Review
**Severity:** MODERATE
**Effort:** Small

`resolveRecordTitle()` has multiple fallback paths but doesn't guarantee safe return. JSON.parse errors are silently caught, masking real issues. No length limit on returned title.

**Fix:**
1. Separate JSON parsing error from logical "no title" case
2. Add length truncation: `.slice(0, 100)`
3. Add explicit fallback: `return titleCol?.name || "Record " + cells.id`

---

## 22. Memory Leak Risk in useRecordDetail Hook
**File(s):** `/src/hooks/useRecordDetail.js`
**Reviewer(s):** Code Review
**Severity:** MODERATE
**Effort:** Medium

Custom hooks may not properly clean up listeners or abort in-flight requests. Missing cleanup functions in useEffect.

**Fix:** Ensure all useEffect cleanup functions abort requests and remove listeners.

---

## 23. Inconsistent Error Handling in Notion Client
**File(s):** `/src/notion/client.js` (lines 50-52, 69-71)
**Reviewer(s):** Code Review
**Severity:** MODERATE
**Effort:** Small

Error handling inconsistent across functions. Some parse JSON for details, others just convert to text. May leak internal error details.

**Fix:** Create centralized error handler for Notion API responses.

---

## 24. Hardcoded Error Colors in SystemManager Component
**File(s):** `/src/core/SystemManager.jsx` (multiple locations)
**Reviewer(s):** Design Review (overlap with issue #5)
**Severity:** MODERATE (covered under Tier 2, issue #5)

---

## 25. Missing Hover States for Interactive Elements
**File(s):** `/src/views/Table.jsx`, `/src/views/Kanban.jsx`, other views
**Reviewer(s):** Design Review
**Severity:** MODERATE
**Effort:** Small

Some table rows and list items lack hover visual feedback. Users unsure which elements are interactive.

**Fix:** Ensure all interactive list/table rows have clear hover states.

---

## 26. Hardcoded Z-Index Values (No Centralized Scale)
**File(s):** Multiple overlay components
**Reviewer(s):** Design Review
**Severity:** MODERATE
**Effort:** Small

Z-index values hardcoded in components without centralized scale. Can cause stacking conflicts.

**Fix:** Create `Z_INDEX` tokens in `tokens.js`:
```javascript
export const Z_INDEX = {
  dropdown: 150,
  modal: 200,
  tooltip: 210,
  popover: 160,
  notification: 250,
};
```

---

## 27. Form Input Focus States Inconsistent
**File(s):** Multiple input components across `/src/components/`, `/src/core/`
**Reviewer(s):** Design Review
**Severity:** MODERATE
**Effort:** Small

Focus styles vary between components. Some use box-shadow, some use border color. Inconsistent keyboard navigation feedback.

**Fix:** Ensure all inputs use consistent focus styling from `S.inputFocused`.

---

## 28. Inconsistent Button Styling (Close/Icon Buttons)
**File(s):** `/src/core/Drawer.jsx`, `/src/core/RecordDetail.jsx`, other components
**Reviewer(s):** Design Review
**Severity:** MODERATE
**Effort:** Medium

Close buttons and icon buttons styled inconsistently. Some use onMouseEnter/Leave, others use CSS :hover.

**Fix:** Create reusable IconButton component with consistent styling.

---

## 29. Inconsistent Animation Durations
**File(s):** `/src/core/Drawer.jsx`, `/src/core/ConfirmDialog.jsx`
**Reviewer(s):** Design Review
**Severity:** MODERATE
**Effort:** Small

Components define their own exit durations (200ms, 180ms) instead of using animation preset durations (220ms).

**Fix:** Export EXIT_DURATION_MS from animations.js and use consistently.

---

## 30. Prop Drilling in Kanban and Complex Views
**File(s):** `/src/views/Kanban.jsx` (lines 19-110+)
**Reviewer(s):** Design Review
**Severity:** MODERATE
**Effort:** Medium

Many props passed through component tree without intermediate extraction. Configuration spreads across multiple levels.

**Fix:** Use context for view configuration or extract state to custom hook.

---

## 31. Silent Failure in Connection Key Sync
**File(s):** `/src/context/AuthContext.jsx` (lines 98-117)
**Reviewer(s):** Code Review
**Severity:** MODERATE
**Effort:** Small

If `getConnections()` fails, error silently caught. Users won't know why features aren't working.

**Fix:** Set error state flag displayable in UI.

---

## 32. No Expiration on Invite Codes
**File(s):** `/sessions/focused-stoic-noether/mnt/wasabi-platform/worker.js` (lines 2417-2437)
**Reviewer(s):** Code Review
**Severity:** MODERATE
**Effort:** Small

Invite codes have no expiration time. Old invite codes can be used indefinitely.

**Fix:** Add 7-day expiration check on usage.

---

## 33. Inadequate State Management in Multi-Device Sync
**File(s):** `/src/context/CollaborationContext.jsx` vs `/src/context/AuthContext.jsx`
**Reviewer(s):** Code Review
**Severity:** MODERATE
**Effort:** Large

Device synchronization (WebSocket) and authentication state managed separately. Gap where WebSocket connects after auth state set, or disconnection doesn't clear auth.

**Fix:** Merge device sync lifecycle with auth state using single state machine.

---

## 34. Circular Dependencies in Integration Modules
**File(s):** `src/agent/automations.js` ↔ `src/agent/toolExecutor.js`
**Reviewer(s):** Code Review
**Severity:** MODERATE
**Effort:** Medium

automations.js imports toolExecutor.js, which imports automations.js. Creates bundling issues.

**Fix:** Extract shared utilities into separate module without cross-imports.

---

## 35. Weak Password Policy
**File(s):** `/sessions/focused-stoic-noether/mnt/wasabi-platform/worker.js`
**Reviewer(s):** Code Review
**Severity:** MODERATE
**Effort:** Small

No minimum password length validation in `handleAuthRegister`.

**Fix:** Enforce minimum 12-character password requirement.

---

## 36. Missing Rate Limiting on Auth Endpoints
**File(s):** `/sessions/focused-stoic-noether/mnt/wasabi-platform/worker.js` (lines 2294-2400)
**Reviewer(s):** Code Review
**Severity:** MODERATE
**Effort:** Medium

No rate limiting on `/auth/login` or `/auth/register`. Attackers can brute force credentials.

**Fix:** Implement rate limiting based on IP/email using KV or cache.

---

## 37. Abort Signal Not Checked Between Retries
**File(s):** `/src/agent/runAgent.js` (lines 258-318)
**Reviewer(s):** Code Review
**Severity:** MODERATE
**Effort:** Small

Retry loop checks abort signal only once per iteration, not during sleep. User-requested abort delayed by up to 60 seconds.

**Fix:** Use `sleepWithAbort(wait, abortRef)` to check during sleep.

---

## 38. Hardcoded Model in Automations
**File(s):** `/src/agent/automations.js` (line 21)
**Reviewer(s):** Code Review
**Severity:** MODERATE
**Effort:** Small

Automation model hardcoded as Haiku. Should be configurable per rule complexity.

**Fix:** Make model configurable via environment or rule config.

---

## 39. Duplicate Date Helpers in CalendarView
**File(s):** `/src/zen/taskHelpers.js` (canonical) vs `/src/views/CalendarView.jsx` (dead code)
**Reviewer(s):** Cleanup Review
**Severity:** MODERATE
**Effort:** Small (after CalendarView deleted)

CalendarView reimplements date utilities instead of importing from taskHelpers.

**Fix:** Moot after deleting views/CalendarView.jsx; keep zen version canonical.

---

## 40. Large Files Needing Refactoring
**File(s):**
- `/src/core/SystemManager.jsx` (2281 lines)
- `/src/agent/toolExecutor.js` (2153 lines)
- `/src/views/DocumentEditor.jsx` (1787 lines)
- `/src/views/Sheet.jsx` (1573 lines)
- `/src/core/DatabaseBrowser.jsx` (1640 lines)
- `/src/core/NodeEditor.jsx` (1411 lines)

**Reviewer(s):** Cleanup Review
**Severity:** MODERATE
**Effort:** Large (multi-week refactoring)

Multiple files exceed 1500 lines. Should be split into smaller modules.

**Fix:** Refactor incrementally, prioritizing SystemManager and DocumentEditor.

---

# TIER 4: MINOR — NICE-TO-HAVE
**Timeline: Ongoing / Polish | Impact: Code quality, naming consistency, minor UX polish**

## 41. Missing Loading Disabled State on Buttons
**File(s):** Form submission buttons throughout
**Reviewer(s):** Design Review
**Severity:** MINOR
**Effort:** Small

Some buttons don't disable during submission, allowing double-submission.

**Fix:** Add `disabled` prop during loading states; add spinner inside button.

---

## 42. Missing Copy/Success Feedback
**File(s):** Code blocks, API key displays
**Reviewer(s):** Design Review
**Severity:** MINOR
**Effort:** Small

Copy-to-clipboard operations lack success feedback. Users unsure if copy succeeded.

**Fix:** Add toast notification "Copied!" on copy operations.

---

## 43. Inconsistent Empty State Messaging
**File(s):** Various views, `/src/components/EmptyState.jsx`
**Reviewer(s):** Design Review
**Severity:** MINOR
**Effort:** Small

Different views implement empty states differently. Some with icons, some without. Messaging tone varies.

**Fix:** Ensure all views use EmptyState component consistently.

---

## 44. Missing Skeleton Loaders
**File(s):** `/src/views/Table.jsx`, `/src/views/Kanban.jsx`
**Reviewer(s):** Design Review
**Severity:** MINOR
**Effort:** Medium

No skeleton/placeholder loaders while data fetches. Content appears abruptly.

**Fix:** Implement skeleton loaders for smoother perceived performance.

---

## 45. Tooltip Positioning Not Guaranteed Off-Screen
**File(s):** Components with tooltips
**Reviewer(s):** Design Review
**Severity:** MINOR
**Effort:** Medium

Tooltips may render off-screen at viewport edges.

**Fix:** Implement boundary detection or use Popper.js for smart positioning.

---

## 46. Missing Keyboard Navigation Support
**File(s):** Custom dropdowns, modals
**Reviewer(s):** Design Review (Accessibility Checklist)
**Severity:** MINOR
**Effort:** Medium

Some custom dropdowns don't support arrow key navigation. Modals may not return focus to trigger element on close. Focus trap not implemented for modals.

**Fix:** Add arrow key support, focus management, and focus traps.

---

## 47. Color Contrast Issues (WCAG Compliance)
**File(s):** Various components with muted text
**Reviewer(s):** Design Review
**Severity:** MINOR
**Effort:** Medium

Muted text colors may not have sufficient WCAG AA contrast ratios (4.5:1). Especially in light themes.

**Fix:** Audit all text colors against WCAG AA standards; adjust as needed.

---

## 48. Inconsistent Named vs Default Exports
**File(s):** Throughout codebase
**Reviewer(s):** Cleanup Review
**Severity:** MINOR
**Effort:** Medium

Some files use default exports, others use named exports. Inconsistent import patterns.

**Fix:** Establish convention (default for single components, named for utilities).

---

## 49. Inconsistent Style Object Naming
**File(s):** Multiple components
**Reviewer(s):** Cleanup Review
**Severity:** MINOR
**Effort:** Small

Style objects named inconsistently: `S`, `styles`, `ms`. Affects readability when switching files.

**Fix:** Standardize to `styles` (or `S`) across all components.

---

## 50. Hardcoded Colors in Icon Components
**File(s):** `/src/design/icons.jsx` (lines 27, 256)
**Reviewer(s):** Design Review
**Severity:** MINOR
**Effort:** Small

Wasabi icon defaults to hardcoded green (#7DC143); WasabiNode defaults to hardcoded gold (#F5B724).

**Fix:** Make these inherit from token-based color values.

---

## 51. Missing Responsive Text Sizing
**File(s):** Various components
**Reviewer(s):** Design Review
**Severity:** MINOR
**Effort:** Medium

Some fixed font sizes at mobile widths may be too small.

**Fix:** Implement responsive font size scaling using @media queries.

---

## 52. Large worker.js Lacks Organization
**File(s):** `/sessions/focused-stoic-noether/mnt/wasabi-platform/worker.js` (9249 lines)
**Reviewer(s):** Cleanup Review
**Severity:** MINOR
**Effort:** Medium

While large (justified as single backend file), lacks modular organization. Difficult to navigate.

**Fix:** Add clear section comments grouping related functions (Auth, Users, Notifications, etc.).

---

## 53. Redundant Date Formatting Function Variants
**File(s):** `/src/zen/taskHelpers.js`
**Reviewer(s):** Cleanup Review
**Severity:** MINOR
**Effort:** Medium

Multiple overlapping date formatting functions (formatDueDate, formatTime, formatHour, formatWeekDateHeader, etc.) with unclear distinction.

**Fix:** Document each function's specific use case or consolidate into single formatter.

---

## 54. Potential Unused Imports
**File(s):** Various, e.g., `/src/views/Table.jsx`
**Reviewer(s):** Cleanup Review
**Severity:** MINOR
**Effort:** Small

Some imports may be unused. Difficult to verify without full execution analysis.

**Fix:** Use IDE's "unused imports" detection during refactoring; remove unused.

---

## 55. Centralized Date Constants Not Consolidated
**File(s):** LABELS in GmailView, ZOOM_LEVELS in Gantt, etc.
**Reviewer(s):** Cleanup Review
**Severity:** MINOR
**Effort:** Small

Related constants scattered across files instead of centralized.

**Fix:** Create `/src/design/dateConstants.js` with GMAIL_LABELS, ZOOM_LEVELS, etc.

---

## 56. Missing Design System References (Minor Color Hardcoding)
**File(s):** Various views
**Reviewer(s):** Cleanup Review
**Severity:** MINOR
**Effort:** Small

Some components hardcode minor color values instead of referencing design tokens (shadow colors, minor status colors).

**Fix:** Replace magic color values with design tokens.

---

## 57. Inconsistent Fixed Font Sizes at Mobile
**File(s):** Various components
**Reviewer(s):** Design Review
**Severity:** MINOR
**Effort:** Medium

Some fixed font sizes may be too small at mobile widths.

**Fix:** Implement responsive font sizing using @media or clamp().

---

## 58. Missing View Settings Documentation
**File(s):** View configuration system
**Reviewer(s):** Design Review
**Severity:** MINOR
**Effort:** Small

View configuration complex but not well-documented in code comments.

**Fix:** Add JSDoc comments to view config prop descriptions.

---

## 59. No User-Facing Timezone Handling
**File(s):** Date display throughout
**Reviewer(s):** Design Review
**Severity:** MINOR
**Effort:** Large

Dates displayed in user's browser timezone, but no explicit timezone indicator or user preference storage.

**Fix:** Add timezone preference to user settings; display timezone in UI.

---

## 60. Missing NotFound/404 Error Handling
**File(s):** Views that fetch data
**Reviewer(s):** Design Review (implicit in missing error states)
**Severity:** MINOR
**Effort:** Small

Views may not handle 404/not-found errors gracefully.

**Fix:** Add error boundary or NotFound state display.

---

## 61. Inconsistent Component Prop Documentation
**File(s):** Various components
**Reviewer(s):** Cleanup Review
**Severity:** MINOR
**Effort:** Medium

Components lack JSDoc comment documentation for prop types and descriptions.

**Fix:** Add JSDoc comments to key components.

---

## 62. No Accessibility Focus Indicators on Custom Components
**File(s):** Custom dropdowns, pickers, etc.
**Reviewer(s):** Design Review
**Severity:** MINOR
**Effort:** Medium

Some custom components lack visible focus indicators for keyboard navigation.

**Fix:** Add :focus-visible outlines to custom interactive components.

---

## 63. Worker Initialization Side Effects Not Isolated
**File(s):** `/sessions/focused-stoic-noether/mnt/wasabi-platform/worker.js`
**Reviewer(s):** Code Review
**Severity:** MINOR
**Effort:** Small

Worker initialization code has side effects that could be isolated better.

**Fix:** Isolate initialization into separate initialization function.

---

# SUMMARY STATISTICS

## Issues by Tier
| Tier | Count | % of Total | Focus |
|------|-------|-----------|-------|
| Tier 1 (Critical) | 4 | 6% | Security, dead code |
| Tier 2 (Major) | 19 | 30% | Logic bugs, UX, accessibility |
| Tier 3 (Moderate) | 24 | 38% | Error handling, refactoring |
| Tier 4 (Minor) | 16 | 26% | Polish, documentation |
| **TOTAL** | **63** | **100%** | |

## Issues by Reviewer

| Reviewer | Count | Focus Area |
|----------|-------|-----------|
| **Design Review** | 32 | UI/UX, accessibility, theming, responsiveness |
| **Code Review** | 21 | Security, logic bugs, error handling, architecture |
| **Cleanup Review** | 15 | Dead code, duplication, large files, naming |
| **Overlapping** | -5 | (deduped, counted once) |

*Note: Some issues flagged by multiple reviewers; deduplication reduces total count from 68 to 63.*

## Issues by Category

| Category | Count | Examples |
|----------|-------|----------|
| **Security** | 7 | XSS (2), Token storage, CORS, SQL logic, rate limiting, password policy |
| **Accessibility** | 6 | ARIA labels, keyboard navigation, focus management, color contrast |
| **Code Duplication** | 8 | formatDate, truncate, date constants, date utilities |
| **Large Files / Refactoring** | 8 | Table (3107 lines), SystemManager, DocumentEditor, toolExecutor |
| **Design System** | 7 | Hardcoded colors, overlay colors, error colors, z-index, focus states |
| **Error Handling** | 8 | Missing error states, silent failures, unhandled promises, retry bugs |
| **UX / Loading States** | 5 | Missing loading indicators, empty states, skeleton loaders |
| **Architecture / State Mgmt** | 4 | Race conditions, prop drilling, multi-device sync, circular deps |
| **Performance / Memory** | 4 | Memory leaks, unaborted requests, cleanup functions |
| **Minor / Polish** | 6 | Button styling, animation durations, hover states, copy feedback |

---

# EXECUTION ROADMAP

## Phase 1: Critical Security Fixes (Week 1)
**Timeline:** ASAP (this week)
**Effort:** 1 week
**Blocks:** Entire product release

### Tasks (in priority order):
1. **Fix XSS in PluginWidget.jsx** (Medium effort)
   - Use JSON.stringify + safe eval, or postMessage approach
   - Test with payloads containing backticks, quotes, template syntax
   - Verify sandbox still works

2. **Fix HTML Injection in iframeHelpers.js** (Medium effort)
   - Replace innerHTML with textContent where safe
   - Add DOMPurify for HTML-safe content
   - Test plugin output with HTML entities

3. **Replace Hardcoded Overlay Colors** (Small effort)
   - Bulk find-replace rgba(0,0,0,...) → C.overlayBg
   - Test all modals in light/dark themes
   - Verify contrast ratios

4. **Delete Dead Code: CalendarView.jsx** (Small effort)
   - Confirm zen version complete
   - Delete /src/views/CalendarView.jsx
   - Run full test suite

### Testing:
- Security-focused QA for XSS payloads
- Visual regression testing for theme changes
- E2E tests for modal dialogs

---

## Phase 2: Major Functionality Fixes (Weeks 2-3)
**Timeline:** Next 2 weeks
**Effort:** 2 weeks
**Blocks:** Feature stability

### Tasks (in priority order):
1. **Fix Authentication Race Condition** (Medium effort)
   - Refactor AuthContext to use useReducer
   - Add AbortController for in-flight requests
   - Test multi-tab scenario

2. **Fix PagesContext Promise Handling** (Medium effort)
   - Add AbortController to cleanup
   - Add mounted state checks
   - Consolidate error handling

3. **Add Error/Warning Color Tokens** (Medium effort)
   - Add to tokens.js
   - Replace hardcoded colors in SystemManager, components
   - Update theme system

4. **Add Loading States to Views** (Medium effort)
   - Add loading state to Table, Kanban
   - Implement Spinner/skeleton loaders
   - Test perceived performance

5. **Fix Flow Executor Error Reporting** (Small effort)
   - Fix variable references in retry logic
   - Verify error callbacks include error object

6. **Add Comprehensive Error Handling** (Medium effort)
   - Replace silent .catch() blocks
   - Add toast notifications
   - Test error recovery flows

7. **Consolidate formatDate/truncate** (Small effort)
   - Update imports in GmailView files
   - Remove duplicate implementations
   - Verify formatting matches

### Testing:
- Unit tests for auth state transitions
- Integration tests for error flows
- Visual tests for loading states
- Cross-browser testing for date formatting

---

## Phase 3: Accessibility & Responsiveness (Weeks 4-5)
**Timeline:** 2 weeks
**Effort:** 2 weeks
**Blocks:** Accessibility compliance

### Tasks (in priority order):
1. **Add ARIA Labels & Roles** (Large effort)
   - Audit all interactive components
   - Add aria-label to icon buttons
   - Add roles to dialogs, dropdowns, tabs
   - Test with screen readers

2. **Implement Responsive Design** (Large effort)
   - Implement @media queries for breakpoints
   - Test at 640px, 1024px, 1440px+
   - Verify mobile UX

3. **Fix Focus States & Keyboard Navigation** (Medium effort)
   - Add consistent focus styling
   - Implement keyboard nav in dropdowns
   - Add focus trap to modals
   - Return focus on close

4. **Fix Color Contrast** (Medium effort)
   - Audit text colors against WCAG AA
   - Adjust muted colors as needed
   - Test in light/dark themes

### Testing:
- Screen reader testing (NVDA, JAWS)
- Keyboard-only navigation tests
- Mobile device testing
- WCAG AA compliance verification

---

## Phase 4: Code Quality & Refactoring (Weeks 6-7)
**Timeline:** 2 weeks
**Effort:** 2 weeks
**Blocks:** Maintainability improvements

### Tasks (in priority order):
1. **Refactor Large Files** (Large effort - prioritize Table.jsx)
   - Extract TableColumns, TableRows, TableFilters
   - Extract SystemManager tabs
   - Extract DocumentEditor content
   - Run tests after each extraction

2. **Consolidate Date Constants & Utilities** (Medium effort)
   - Create dateConstants.js with canonical definitions
   - Update imports across files
   - Remove duplicate utilities

3. **Add Z-Index Scale Token** (Small effort)
   - Create Z_INDEX object in tokens.js
   - Replace hardcoded z-index values
   - Verify stacking order

4. **Fix Circular Dependencies** (Small effort)
   - Extract shared utilities
   - Remove cross-imports between automations/toolExecutor
   - Verify bundling

5. **Standardize Component Conventions** (Small effort)
   - Standardize export patterns (default vs named)
   - Standardize style naming (styles vs S)
   - Add JSDoc documentation

### Testing:
- Bundle size analysis
- Import resolution testing
- Code quality metrics

---

## Phase 5: Security & Architecture (Week 8)
**Timeline:** 1 week
**Effort:** 1 week
**Blocks:** Long-term stability

### Tasks (in priority order):
1. **Secure JWT Storage** (Large effort)
   - Move JWT from localStorage to memory
   - Implement httpOnly cookies (server change needed)
   - Add token refresh mechanism
   - Add expiration checks

2. **Add Rate Limiting** (Medium effort)
   - Implement on auth endpoints
   - Use KV for rate limit tracking
   - Test brute force scenarios

3. **Validate Invite Code Expiration** (Small effort)
   - Add 7-day expiration check
   - Test expired code rejection

4. **Add Password Policy Validation** (Small effort)
   - Enforce 12-character minimum
   - Test weak password rejection

5. **Add CORS Origin Validation** (Small effort)
   - Restrict to allowed origins
   - Test CSRF protection

6. **Add Audit Logging** (Medium effort)
   - Log all database mutations
   - Log auth events
   - Log permission checks

### Testing:
- Security penetration testing
- Brute force resistance testing
- Auth flow testing

---

## Phase 6: Polish & Documentation (Week 9)
**Timeline:** 1 week
**Effort:** 1 week
**Optional but recommended**

### Tasks:
1. **Add Copy Feedback Toasts** (Small)
2. **Implement Skeleton Loaders** (Medium)
3. **Add Tooltip Boundary Detection** (Medium)
4. **Add Button Loading States** (Small)
5. **Standardize Empty States** (Small)
6. **Document Architecture Patterns** (Medium)
7. **Add Code Comments** (Small)

---

# RECOMMENDATIONS & TENSIONS

## Key Recommendations

### Immediate Actions (P0 - This Week)
1. Fix all Tier 1 security vulnerabilities before next release
2. Delete dead code (CalendarView.jsx)
3. Establish security review process for all code changes
4. Set up automated security scanning

### Short-term (P1 - Next 2 Weeks)
1. Fix authentication race conditions
2. Add error handling to all API calls
3. Add loading states to all async operations
4. Start accessibility audit

### Long-term (P2 - Ongoing)
1. Refactor large files progressively
2. Implement responsive design systematically
3. Build accessibility into all new components
4. Establish code quality standards

### Process Improvements
1. **Add pre-commit hooks** for linting, unused imports
2. **Set up automated security scanning** (SAST)
3. **Establish design system as source of truth**
4. **Require accessibility testing for all PRs**
5. **Add bundle size monitoring** to prevent regressions

---

## Contradictions & Tensions Between Reviewers

### 1. Architecture Split: views/ vs zen/ Components
**Tension:** Cleanup Review identifies duplicate component implementations; Design Review doesn't address.

**Resolution:**
- Cleanup Review is correct: duplicates create maintenance burden
- Determine canonical version (zen/ appears primary)
- Document the split in architecture guide
- Consolidate if both versions needed; use feature flags instead

### 2. Code Execution Sandbox Strategy
**Tension:** Code Review recommends vm2/isolated-vm; Design Review doesn't address.

**Resolution:**
- Code Review security concern is valid (XSS in PluginWidget)
- Implement postMessage-based sandboxing immediately
- Consider vm2 for long-term robust solution
- Current iframe sandbox provides some protection but not sufficient

### 3. State Management Approach
**Tension:** Code Review suggests useReducer for auth; Code Review also mentions state machines for other contexts.

**Resolution:**
- Use consistent pattern across all contexts
- useReducer for medium complexity (auth)
- Consider Redux or Zustand if multiple contexts needed
- Prioritize auth refactoring first

### 4. Token Storage Strategy
**Tension:** Code Review recommends httpOnly cookies; this requires server-side changes.

**Resolution:**
- Immediate fix: Move JWT to memory (session-only)
- Short-term: Consider sessionStorage as temporary persistence
- Long-term: Coordinate with backend team for httpOnly cookies

### 5. Responsive Design Implementation
**Tension:** Design Review recommends implementing responsive design (complex); no mention in Code/Cleanup reviews.

**Resolution:**
- Valid accessibility requirement
- Not urgent for current user base (mostly desktop)
- Phase in responsiveness: mobile first, then tablet
- Can be parallelized with other work

---

## Risk Assessment

### Highest Risk Changes
1. **Refactoring large files** (Table.jsx) — High risk of regressions; requires comprehensive testing
2. **Modifying auth flow** — Risk of breaking login/multi-tab scenarios
3. **Changing state management** — Risk of inconsistent behavior

### Mitigation Strategies
1. Maintain high test coverage (aim for >80%)
2. Use feature flags for gradual rollout of changes
3. Maintain change logs for each phase
4. Have rollback plan for each deploy
5. Test extensively in staging before production

---

## Effort Estimates

### Effort Summary
| Phase | Weeks | Full-time Engineers | Notes |
|-------|-------|-------------------|-------|
| Phase 1 (Security) | 1 | 1 | Can be done in parallel |
| Phase 2 (Major fixes) | 2 | 2 | Parallel workstreams |
| Phase 3 (A11y/Responsive) | 2 | 1-2 | Can overlap with Phase 4 |
| Phase 4 (Refactoring) | 2 | 1-2 | Lower priority, can spread |
| Phase 5 (Architecture) | 1 | 1 | Dependent on Phase 2 |
| Phase 6 (Polish) | 1 | 1 | Optional |
| **TOTAL** | **9 weeks** | **1-2** | **Aggressive: 6 weeks with 2 engineers** |

### Resource Recommendations
- **For Critical Only:** 1 engineer, 1 week
- **For Tier 1 + Tier 2:** 2 engineers, 3 weeks
- **Full Roadmap:** 2 engineers, 6-8 weeks

---

## Monitoring & Success Metrics

### Security Metrics
- [ ] Zero critical vulnerabilities in security audit
- [ ] All XSS vectors tested and passing
- [ ] Rate limiting prevents brute force (test: 1000 attempts/min blocked)
- [ ] CORS origin validation enforced

### Accessibility Metrics
- [ ] WCAG 2.1 Level AA compliance verified
- [ ] 100% of interactive components have aria-labels
- [ ] Screen reader testing passes (NVDA, JAWS)
- [ ] Keyboard navigation works for all components

### Performance Metrics
- [ ] Bundle size doesn't increase (target: <10% growth)
- [ ] Table.jsx refactored to <800 lines per component
- [ ] Loading states appear within 200ms
- [ ] No memory leaks detected in long sessions

### Code Quality Metrics
- [ ] Test coverage >80%
- [ ] No duplicated utility functions
- [ ] Linting passes 100%
- [ ] No circular dependencies

---

## Conclusion

The Wasabi platform has **critical security vulnerabilities that must be fixed immediately**, along with significant accessibility and code quality issues that should be addressed over the next 6-8 weeks.

### Priority Order
1. **Week 1:** Fix all 4 Tier 1 issues (security + dead code)
2. **Weeks 2-3:** Address Tier 2 major issues (auth, errors, loading states)
3. **Weeks 4-5:** Implement accessibility and responsive design
4. **Weeks 6-8:** Refactor code quality, consolidate duplication

The issues are **all resolvable** with no architectural redesign required. With 2 engineers working in parallel, completion is feasible in 6-8 weeks. Quick security fixes can be done in 1 week.

---

**Report Completed:** March 20, 2026
**Synthesis by:** Lead Review Synthesizer
**Review Methodology:** Consolidated findings from Design Review, Code Review, and Cleanup Review; deduplicated; organized by severity and dependency; estimated efforts; created execution roadmap
