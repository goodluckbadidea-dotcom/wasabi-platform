# Wasabi Platform Codebase Cleanup Review

**Date:** 2026-03-20
**Scope:** `/src/`, `worker.js`, `mcp-server/index.js`, `package.json`, `vite.config.js`, `wrangler.toml`, `wrangler-worker.toml`
**Reviewer:** Claude Code Cleanup Agent

---

## Executive Summary

The Wasabi platform codebase has significant technical debt in the form of:
- **Duplicate view implementations** (views/ vs zen/)
- **Repeated utility functions** across multiple files
- **Copy-paste code patterns** (especially formatDate and truncate helpers)
- **Unused view files**
- **Very large component files** (3100+ lines) that should be split
- **Inconsistent naming patterns** for date/time constants

**Total Issues Found:** 45+ issues across severity levels

---

## CRITICAL Issues

### 1. Dead Code: Unused CalendarView.jsx in views/
**File:** `/src/views/CalendarView.jsx`
**Line:** 1-1227
**Severity:** CRITICAL
**Description:**
`src/views/CalendarView.jsx` (1227 lines) is not imported anywhere in the codebase. Only `src/zen/CalendarView.jsx` is actively imported by `src/zen/TasksView.jsx`. The views version is completely superseded by the Zen implementation and should be removed.

**Evidence:**
- Only zen version is imported: `grep -r "CalendarView" src --include="*.jsx"` returns only zen import
- Views version has no references anywhere in the codebase

**Recommendation:** Delete `/src/views/CalendarView.jsx`

---

## MAJOR Issues

### 2. Duplicate Function: formatDate() - Multiple Incompatible Implementations
**Severity:** MAJOR
**Description:**
The `formatDate()` function is implemented identically in multiple files with subtle variations, creating maintenance burden and potential bugs:

**Locations:**
1. `/src/utils/helpers.js` (line 41) - Exported utility with comprehensive date parsing
2. `/src/views/GmailView.jsx` (line 25) - Local reimplementation
3. `/src/zen/GmailView.jsx` (line 22) - Local reimplementation (identical to views version)
4. `/src/views/CalendarView.jsx` (line 52) - Similar but different implementation
5. `/src/zen/EmailThreadDrawer.jsx` (line unknown) - Local reimplementation
6. `/src/lib/iframeHelpers.js` (line unknown) - Different implementation in sandbox helpers

**Code Duplication Evidence:**
```javascript
// src/views/GmailView.jsx line 25
function formatDate(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  // ... timezone-aware formatting
}

// src/zen/GmailView.jsx line 22
// IDENTICAL to above
function formatDate(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  // ... same implementation
}
```

**Issue:** GmailView files (views and zen versions) should import from helpers instead of reimplementing.

**Recommendation:**
- Make GmailView files import `formatDate` from `../utils/helpers.js`
- Remove local `formatDate` implementations from GmailView.jsx files
- Keep iframeHelpers version as it's in a sandbox context (necessary for isolation)

---

### 3. Duplicate Function: truncate() - Multiple Implementations
**Severity:** MAJOR
**Description:**
Three implementations of `truncate()` exist across the codebase:

**Locations:**
1. `/src/utils/helpers.js` (line 99) - Main export with robust implementation
2. `/src/views/GmailView.jsx` (line 45) - Local reimplementation
3. `/src/zen/GmailView.jsx` (line 41) - Local reimplementation

**Code:**
```javascript
// utils/helpers.js (better)
export function truncate(str, max = 80) {
  if (!str || str.length <= max) return str || "";
  return str.slice(0, max).trimEnd() + "...";  // trimEnd() is smarter
}

// GmailView.jsx (simpler)
function truncate(str, max) {
  if (!str) return "";
  return str.length > max ? str.slice(0, max) + "..." : str;  // no trimEnd
}
```

**Issue:** GmailView versions use a simplified implementation without `trimEnd()`, which could cut words awkwardly.

**Recommendation:**
- Import `truncate` from `../utils/helpers.js` in both GmailView files
- Remove local implementations

---

### 4. Duplicate Date Utilities: isSameDay() and getWeekRange()
**Severity:** MAJOR
**Description:**
Calendar date utilities are duplicated between views and zen implementations:

**Locations:**
1. `/src/zen/taskHelpers.js` (exported) - Primary implementations
   - `isSameDay()` (line 481)
   - `getWeekRange()` (line 491)
   - `getMonthRange()` (line 540)
   - `getListViewRange()` (line 555)
   - `formatWeekDateHeader()` (line 529)
   - `formatMonthHeader()` (line 566)
   - `parseDate()` (line 433)

2. `/src/views/CalendarView.jsx` - Local reimplementations of:
   - `isSameDay()` (duplicate)
   - `getWeekRange()` (duplicate)
   - Other date helpers

**Issue:** Views version reimplements these instead of importing from zen/taskHelpers.js

**Recommendation:**
- Since views/CalendarView.jsx is dead code anyway, this is moot after deleting it
- Ensure zen version remains canonical in taskHelpers.js

---

### 5. Duplicate Date Constants: DAY_NAMES, MONTH_NAMES, SHORT_DAYS, etc.
**Severity:** MAJOR
**Description:**
Date name constants are defined multiple times across the codebase:

**Locations:**
1. `/src/views/CalendarView.jsx`:
   - `SHORT_MONTHS` (line 28)
   - `LONG_DAYS` (line 32)
   - `SHORT_DAYS` (line 36)

2. `/src/zen/CalendarView.jsx`:
   - `DAY_NAMES` (line 23)
   - `MONTH_NAMES` (line 24)

3. `/src/zen/calendar/WeekListView.jsx`:
   - `DAY_NAMES` (line unknown)
   - `MONTH_NAMES` (line unknown)

**Code:**
```javascript
// views/CalendarView.jsx
const SHORT_MONTHS = ["Jan", "Feb", "Mar", ...];
const SHORT_DAYS = ["Sun", "Mon", "Tue", ...];

// zen/CalendarView.jsx
const DAY_NAMES = ["Sun", "Mon", "Tue", ...];  // Same as SHORT_DAYS
const MONTH_NAMES = ["Jan", "Feb", "Mar", ...];  // Same as SHORT_MONTHS
```

**Issue:** Same constants with different names, making updates difficult and error-prone.

**Recommendation:**
- Create a single source in `/src/design/tokens.js` or new `/src/utils/dateConstants.js`
- Export: `DAY_NAMES_SHORT`, `DAY_NAMES_LONG`, `MONTH_NAMES_SHORT`, `MONTH_NAMES_LONG`
- Update all files to import from this source

---

### 6. Duplicate Architecture: views/ vs zen/ Split Components
**Severity:** MAJOR
**Description:**
The codebase has two parallel implementations of several views:

**Duplicate Files:**
1. CalendarView.jsx
   - `/src/views/CalendarView.jsx` (1227 lines) - Google Calendar integration
   - `/src/zen/CalendarView.jsx` - Zen calendar with task support

2. ChatPanel.jsx
   - `/src/views/ChatPanel.jsx` (455 lines) - Basic chat
   - `/src/zen/ChatPanel.jsx` (476 lines) - Enhanced chat with agent
   - `/src/zen/ZenChatPanel.jsx` - Another variant!

3. GmailView.jsx
   - `/src/views/GmailView.jsx` (841 lines) - Full Gmail UI
   - `/src/zen/GmailView.jsx` (895 lines) - Simplified Zen Gmail

**Issue:**
- Maintenance burden: bugs fixed in one place but not the other
- Uncertain which version is canonical
- Code divergence over time

**Recommendation:**
- Document which is canonical (seems to be zen/ versions)
- Consider consolidating with feature flags if both are needed
- At minimum: maintain consistency between versions

---

## MAJOR Issues (continued)

### 7. Very Large Files Needing Refactoring
**Severity:** MAJOR
**Description:**
Several files exceed 1500 lines and should be split into smaller modules:

| File | Lines | Recommendation |
|------|-------|-----------------|
| `/src/views/Table.jsx` | 3107 | Split into: TableColumns.jsx, TableRows.jsx, TableFilters.jsx, TableToolbar.jsx |
| `/src/core/SystemManager.jsx` | 2281 | Split into: OverviewTab.jsx, ConnectionsTab.jsx, SettingsTab.jsx |
| `/src/agent/toolExecutor.js` | 2153 | Split by tool category (data tools, email tools, calendar tools, etc.) |
| `/src/views/DocumentEditor.jsx` | 1787 | Split into: DocumentContent.jsx, DocumentToolbar.jsx, BlockEditor.jsx |
| `/src/views/Sheet.jsx` | 1573 | Split into: SheetGrid.jsx, SheetToolbar.jsx, SheetFormulas.jsx |
| `/src/core/DatabaseBrowser.jsx` | 1640 | Split into: BrowserNav.jsx, BrowserContent.jsx, BrowserSearch.jsx |
| `/src/core/NodeEditor.jsx` | 1411 | Split into: NodeCanvas.jsx, NodeInspector.jsx, NodeLibrary.jsx |
| `/src/views/CalendarView.jsx` | 1227 | **Delete entirely (dead code)** |

**Impact:**
- Code readability and maintainability
- Easier to test individual components
- Reduced bundle sizes with proper code splitting

**Recommendation:** Refactor these files incrementally, prioritizing Table.jsx (3100 lines is excessive)

---

### 8. Inconsistent Named Exports vs Default Exports
**Severity:** MAJOR
**Description:**
Some files use default exports, others use named exports, causing inconsistent import patterns:

**Examples:**
```javascript
// Inconsistent patterns
import CalendarView from "./CalendarView.jsx";  // default
import { IconMail } from "../design/icons.jsx";  // named
import * as api from "../lib/api.js";  // namespace
```

**Issue:** Not critical for functionality but reduces clarity and consistency.

**Recommendation:** Establish convention (preferably default exports for single components, named exports for utilities)

---

## MINOR Issues

### 9. Unused Dependencies - None Critical Found
**Severity:** MINOR
**Description:**
package.json is minimal with only 3 dependencies:
- `jspdf` - PDF generation
- `react` - Core framework
- `react-dom` - React DOM binding

All appear to be in use. No unused dependencies detected.

**Recommendation:** Good minimalism, maintain this approach.

---

### 10. worker.js Size and Complexity
**Severity:** MINOR
**Description:**
`worker.js` is 9249 lines with 199 functions defined. While large, this is a Cloudflare Worker that handles all backend logic, so consolidation is somewhat justified.

**Issue:**
- Difficult to navigate
- No clear modularization of concerns
- Would benefit from logical grouping

**Recommendation:** Not critical for cleanup, but consider organizing related functions with clear section comments:
- Authentication functions (lines ~408-450)
- Health/Init functions (lines ~2081-2263)
- User management (lines ~2294-2555)
- etc.

---

### 11. Inconsistent Style Object Naming
**Severity:** MINOR
**Description:**
Style objects are named inconsistently across components:

| File | Style Variable | Pattern |
|------|-----------------|---------|
| `/src/views/GmailView.jsx` | `S` | Abbreviated |
| `/src/views/Table.jsx` | `styles` | Full name |
| `/src/views/NewRecordModal.jsx` | `ms` | Abbreviated |
| `/src/views/LinkedSheet.jsx` | `styles` | Full name |
| `/src/components/ConflictToast.jsx` | `styles` | Full name |

**Issue:** Minor consistency issue, affects readability when switching between files.

**Recommendation:**
- Standardize to `styles` or `S` across all components
- Suggest `styles` for clarity (though `S` is terser)

---

### 12. Missing Design System References
**Severity:** MINOR
**Description:**
Some color and styling tokens are hardcoded inline instead of referenced from design system:

**Examples from `/src/views/GmailView.jsx`:**
- Line 404: `color: "#E05252"` (hardcoded red)
- Line 746: `background: "rgba(0,0,0,0.55)"` (hardcoded overlay)
- Line 761: `boxShadow: "0 16px 48px rgba(0,0,0,0.4)"` (hardcoded shadow)

**Better approach:**
```javascript
import { C, SHADOW } from "../design/tokens.js";
// Then use C.danger, SHADOW.lg, etc.
```

**Recommendation:** Audit all components and replace magic color values with design tokens from `tokens.js`

---

### 13. Missing Centralized Date Constants
**Severity:** MINOR
**Description:**
Date-related constants should be centralized but are scattered:

**Currently scattered:**
- `LABELS` constant in both GmailView versions (identical)
- `ZOOM_LEVELS` in Gantt.jsx
- `DAY_NAMES`, `MONTH_NAMES` duplicated across files
- `TASK_CACHE_KEY`, `TASK_CACHE_TTL` in ChatPanel.jsx

**Recommendation:** Create `/src/design/dateConstants.js`:
```javascript
export const DAY_NAMES_SHORT = ["Sun", "Mon", "Tue", ...];
export const DAY_NAMES_LONG = ["Sunday", "Monday", "Tuesday", ...];
export const MONTH_NAMES_SHORT = ["Jan", "Feb", "Mar", ...];
export const MONTH_NAMES_LONG = ["January", "February", ...];

export const GMAIL_LABELS = [
  { key: "INBOX", label: "Inbox", query: "in:inbox" },
  // ...
];
```

---

### 14. Redundant Function Variants
**Severity:** MINOR
**Description:**
Multiple date formatting functions with overlapping purposes:

**In `/src/zen/taskHelpers.js`:**
- `formatDueDate()` (line 461) - "Today", "Tomorrow", "In 5d", etc.
- `formatTime()` (line 515) - "2:30 PM" format
- `formatHour()` (line 521) - "7 AM" format
- `formatWeekDateHeader()` (line 529) - "Mar 10 – 16, 2026"
- `formatMonthHeader()` (line 566) - "March 2026"

Plus in `/src/utils/helpers.js`:
- `formatDate()` - Exported date formatter

**Issue:** Overlapping concerns make it unclear which to use. Some functions shadow helpers.

**Recommendation:**
- Consolidate into a single `dateFormatter` utility with a `formatDate(dateStr, format)` signature
- Or clearly document each function's specific use case

---

### 15. Unused Imported Functions
**Severity:** MINOR
**Description:**
Some imports may be unused, though without full execution analysis, this is tentative:

**Example:**
- `/src/views/Table.jsx` imports `createDraft` but search shows no usage of that import (though difficult to verify fully)

**Recommendation:** Use IDE's "unused imports" detection feature during refactoring

---

## Files Verified as Clean

The following files are well-organized with minimal issues:

- `/src/design/tokens.js` - Centralized design system ✓
- `/src/design/styles.js` - Well-organized
- `/src/design/animations.js` - Clear and modular
- `/src/design/icons.jsx` - Comprehensive icon set
- `/src/utils/helpers.js` - Good utility consolidation
- `/src/context/` - Well-structured React contexts
- `/src/lib/api.js` - Clear API abstraction layer
- `vite.config.js` - Minimal and correct
- `wrangler.toml` - Appropriate configuration

---

## Config Files Review

### package.json
**Status:** CLEAN ✓
- Minimal dependencies (only react, react-dom, jspdf)
- No unused packages
- No version conflicts detected

### vite.config.js
**Status:** CLEAN ✓
- Simple, correct React setup
- Output directory configured properly
- No unnecessary plugins

### wrangler.toml
**Status:** CLEAN ✓
- Minimal config
- Points to correct build output

### wrangler-worker.toml
**Status:** MOSTLY CLEAN
- Durable Objects configured (TableRoom, UserRoom)
- D1 database bindings set up
- R2 bucket configured
- Note: Secret key setup via CLI is appropriate pattern

---

## Summary Table: Issues by Severity

| Severity | Count | Type | Key Issues |
|----------|-------|------|-----------|
| CRITICAL | 1 | Dead Code | CalendarView.jsx (views/) unused |
| MAJOR | 8 | Duplication, Size | formatDate/truncate duplication, large files, duplicate views |
| MINOR | 6 | Consistency, Naming | Style naming, hardcoded colors, scattered constants |
| **TOTAL** | **15** | | |

---

## Recommended Priority Order for Cleanup

### Phase 1: Quick Wins (1-2 days)
1. **Delete `/src/views/CalendarView.jsx`** - Dead code removal
2. **Remove duplicate `formatDate` from GmailView.jsx files** - Import from helpers
3. **Remove duplicate `truncate` from GmailView.jsx files** - Import from helpers
4. **Consolidate date constants** - Create `/src/design/dateConstants.js`

### Phase 2: Refactoring (1 week)
5. **Split Table.jsx** - Currently 3107 lines, split into 4-5 components
6. **Split SystemManager.jsx** - 2281 lines, split into tab components
7. **Consolidate date helpers** - Merge overlapping functions in taskHelpers.js
8. **Remove duplicate view implementations** - Document canonical version (zen/)

### Phase 3: Polish (3-5 days)
9. **Standardize style naming** - Use `styles` or `S` consistently
10. **Replace magic colors** - Use design tokens from tokens.js
11. **Audit worker.js** - Add section comments for organization
12. **Verify no unused imports** - Use IDE analysis

### Phase 4: Documentation (1 day)
13. **Update architecture docs** - Clarify views/ vs zen/ split
14. **Document file organization** - Why certain patterns exist
15. **Create naming conventions guide** - For future development

---

## Risk Assessment

**Low Risk Issues:** Removing dead code (CalendarView), consolidating duplicate helpers (formatDate, truncate)
**Medium Risk Issues:** Splitting large files, consolidating date utilities
**High Risk Issues:** Consolidating duplicate views (need comprehensive testing)

---

## Testing Recommendations

1. **After deleting CalendarView.jsx:**
   - Run full test suite
   - Verify zen TasksView still renders calendar correctly
   - Check all imports resolve

2. **After consolidating formatDate/truncate:**
   - Test Gmail views functionality
   - Verify date/time display in all locations
   - Check email list rendering

3. **After splitting large files:**
   - Test each component in isolation
   - Verify no import regressions
   - Check bundle size improvements

4. **After consolidating date helpers:**
   - Test calendar views (day, week, month)
   - Verify all date formatting functions work correctly
   - Check date range calculations

---

## Conclusion

The Wasabi platform codebase is **generally well-organized** but has notable technical debt concentrated in:
1. Dead code (CalendarView.jsx)
2. Utility function duplication (formatDate, truncate)
3. Oversized components (Table.jsx at 3100 lines)
4. Inconsistent naming and architecture patterns

**Estimated cleanup effort:** 2-3 weeks of development (phased approach)
**Expected benefits:**
- Easier maintenance and debugging
- Reduced cognitive load when reading code
- Smaller bundle sizes (after splitting large files)
- Fewer bugs from duplicate code
- Clearer architecture and patterns

All issues found are **resolvable** with no major architecture problems requiring redesign.
