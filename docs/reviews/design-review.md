# Wasabi Platform Frontend Design Review

## Executive Summary

This review examines the Wasabi platform codebase focusing on component structure, design token usage, accessibility, UX consistency, and responsive design. The codebase has a well-organized design system with comprehensive tokens, but there are several areas for improvement: hardcoded colors not using the design system, missing accessibility attributes, inconsistent responsive patterns, and missing error/loading states in some components.

---

## CRITICAL ISSUES

### 1. Hardcoded Overlay Colors (Multiple Locations)
**Severity: Critical**
**Files:** Multiple core and view components
**Issue:** Multiple modals, dialogs, and overlays use hardcoded `rgba(0,0,0,...)` colors instead of the theme-aware `C.overlayBg` token from tokens.js.

**Examples:**
- `/src/core/ConfirmDialog.jsx:42` - `background: "rgba(0,0,0,0.55)"` should use `C.overlayBg`
- `/src/core/LinkPicker.jsx:266` - `background: "rgba(0,0,0,0.55)"`
- `/src/core/SheetUrlDialog.jsx:99` - `background: "rgba(0,0,0,0.55)"`
- `/src/core/CommandPalette.jsx:137` - `background: "rgba(0,0,0,0.55)"`
- `/src/zen/GmailView.jsx:86` - `background: "rgba(0,0,0,0.6)"`
- `/src/zen/WorkspaceBrowser.jsx:58` - `background: "rgba(0,0,0,0.6)"`
- `/src/components/PinLockOverlay.jsx:106` - `background: "rgba(0,0,0,0.3)"`
- `/src/components/ViewSettingsPanel.jsx:593` - `background: "rgba(0,0,0,0.35)"`

**Impact:** Theme changes don't affect overlay darkness, breaking theme consistency. Light themes may have insufficient contrast.

**Fix:** Replace all hardcoded `rgba(0,0,0,...)` with `C.overlayBg` from the design tokens.

---

## MAJOR ISSUES

### 2. Hardcoded Error/Warning Colors
**Severity: Major**
**File:** `/src/core/SystemManager.jsx` (multiple lines)
**Issue:** Error and warning states use hardcoded colors (#E05252, #FF6B3D) instead of design tokens.

**Examples:**
- Line 192, 193, 296, 297: Orange indicator color #FF6B3D hardcoded
- Lines 325, 327, 328, 1512-1535, 1903, 1949-1950, 1998-1999: Error red #E05252 hardcoded
- Line 809: `background: "linear-gradient(90deg, #E05252, #E0525288)"`

**Impact:** Error and warning states don't adapt to theme changes. Inconsistent with design system intent.

**Fix:** Define error and warning color tokens in `tokens.js` and use them throughout SystemManager.jsx and other components like KnowledgeBase.jsx, PluginWidget.jsx.

---

### 3. Missing Accessibility Attributes Throughout Codebase
**Severity: Major**
**Scope:** All interactive components and modals
**Issue:** No `aria-label`, `aria-hidden`, `role` attributes found in audit. Key accessibility gaps:

- Dialogs and modals missing `role="dialog"` attribute
- Icon-only buttons missing `aria-label` (e.g., close buttons)
- Buttons in interactive contexts missing proper semantic roles
- Overlay elements not marked with `aria-modal` or `aria-hidden`

**Affected Components:**
- `/src/core/Drawer.jsx` - Close button (line 87) lacks `aria-label`
- `/src/core/ConfirmDialog.jsx` - Dialog root lacks `role="dialog"` and `aria-modal="true"`
- `/src/core/RecordDetail.jsx` - Drawer lacks semantic attributes
- `/src/components/SelectPicker.jsx` - Dropdown lacks `role="listbox"` and options lack `role="option"`
- `/src/components/MultiSelectPicker.jsx` - Same issues
- All interactive icon buttons lack `aria-label`

**Impact:** Screen reader users cannot navigate or understand interactive components. WCAG 2.1 Level A violations.

**Fix:** Add proper ARIA attributes to all interactive components, dialogs, and modals. Audit and add aria-labels to all icon-only buttons.

---

### 4. No Responsive Design Implementation
**Severity: Major**
**Scope:** Layout and grid components
**Issue:** Design system defines breakpoints (`BP.mobile: 640px`, `BP.tablet: 1024px`) but no responsive styles implemented. App assumes desktop-only layout.

**Evidence:**
- Grep for responsive patterns returns no @media queries or conditional styling based on `BP` tokens
- Fixed sidebar width (56px expanded to 220px) not responsive
- Table/Sheet views have fixed column widths without viewport adaptation
- Modal/Drawer widths hardcoded (480px, 520px) without max-width responsive adjustments

**Affected Components:**
- `/src/components/Drawer.jsx:18` - Fixed `width: 480, maxWidth: "92vw"` (maxWidth is workaround, not true responsive)
- `/src/views/RecordDetail.jsx:62` - `width: 520, maxWidth: "94vw"`
- All table/sheet views with fixed cell widths

**Impact:** Poor UX on tablets and smaller desktops. Mobile devices receive desktop layout.

**Fix:** Implement @media queries or React window size hooks using `BP` tokens. Create responsive style variants for key layout components.

---

### 5. Missing Loading/Empty States in Several Views
**Severity: Major**
**Scope:** Views and complex components
**Issue:** Some views lack proper loading states while data fetches. Users see blank screens or stale UI during API calls.

**Affected Areas:**
- `/src/views/Table.jsx` - No visible loading state during initial data fetch (only shows search/filter UI)
- `/src/views/Kanban.jsx` - No column-level or global loading indicator
- `/src/zen/TasksView.jsx` - May lack loading state during AI task generation
- Complex form submissions don't show pending states

**Impact:** Users uncertain if app is responsive during async operations. Poor perceived performance.

**Fix:** Add Spinner components or skeleton loaders to views during data fetch. Add disabled/loading state to buttons during submission.

---

### 6. Missing Error State Handling
**Severity: Major**
**Scope:** Forms and data mutations
**Issue:** Components handle errors internally but don't display error messages consistently. Some API failures are silently caught.

**Examples:**
- `/src/components/PagePermissionsPanel.jsx:50-58` - Error caught silently in `catch (_) {}`
- `/src/components/MentionInput.jsx` - User fetch errors don't show feedback
- Form submissions sometimes fail silently without user notification

**Impact:** Users don't know when operations fail. Poor UX for error recovery.

**Fix:** Implement consistent error message display. Use toast notifications or inline error states.

---

## MINOR ISSUES

### 7. Inconsistent Button Styling
**Severity: Minor**
**File:** Multiple components
**Issue:** Close buttons and icon buttons have slightly different styling across components.

**Examples:**
- `/src/core/Drawer.jsx:87-107` - Close button uses `onMouseEnter/Leave` for hover state instead of CSS `:hover`
- `/src/core/RecordDetail.jsx:89-101` - Close button styled differently
- Some buttons use `S.btnGhost`, others define inline styles

**Impact:** Visual inconsistency in UI. Maintenance burden.

**Fix:** Create reusable IconButton component with consistent hover/active states.

---

### 8. Hardcoded Colors in Icon Components
**Severity: Minor**
**File:** `/src/design/icons.jsx`
**Issue:** Icon colors for Wasabi logo and Wasabi node are hardcoded instead of accepting theme colors.

- Line 27: `IconWasabi` defaults to `color = "#7DC143"` (hardcoded green)
- Line 256: `IconWasabiNode` defaults to `color = "#F5B724"` (hardcoded gold)

**Impact:** Icons don't adapt if brand colors change per theme in the future.

**Fix:** Make these inherit from token-based color values or accept props more flexibly.

---

### 9. Prop Drilling in Kanban and Complex Views
**Severity: Minor**
**File:** `/src/views/Kanban.jsx` (lines 19-110+)
**Issue:** Many props passed through component tree without intermediate extraction or context. Configuration spreads across multiple levels.

**Props chain:**
- `Kanban` receives `data, schema, config, onUpdate, onRefresh, onCreate, onDelete, onViewConfigChange, pageConfig`
- Column rendering functions receive nested props and config objects
- Card rendering receives multiple callbacks and configuration objects

**Impact:** Difficult to refactor. Hard to understand component contract. Props easily missed or duplicated.

**Fix:** Consider context for view configuration or extract view state management to custom hook.

---

### 10. Inconsistent Animation Durations
**Severity: Minor**
**File:** `/src/design/animations.js` and component usage
**Issue:** Components define their own exit durations instead of using animation preset durations.

**Examples:**
- `/src/core/Drawer.jsx:10` - `EXIT_DURATION = 200` hardcoded
- `/src/core/ConfirmDialog.jsx:10` - `EXIT_DURATION = 180` hardcoded

Should match `ANIM.slideOutRight` duration (0.22s = 220ms) or other presets.

**Impact:** Animations occasionally feel out of sync. Difficult to maintain animation consistency.

**Fix:** Export EXIT_DURATION_MS from animations.js and use consistently.

---

### 11. Missing Hover States for Interactive Elements
**Severity: Minor**
**Scope:** Tables and lists
**Issue:** Some table rows and list items lack hover visual feedback.

- Table rows in `/src/views/Table.jsx` have `trHover` style but not all views apply it
- Kanban cards might not have clear hover state
- Some dropdown items lack hover color

**Impact:** Users unsure which elements are interactive.

**Fix:** Ensure all interactive list/table rows have clear hover states defined in styles.

---

### 12. Hardcoded Z-Index Values
**Severity: Minor**
**Scope:** Multiple overlay components
**Issue:** Z-index values hardcoded in components without centralized z-index scale.

**Examples:**
- `/src/core/ConfirmDialog.jsx:45` - `zIndex: 200`
- `/src/components/PinLockOverlay.jsx` - Uses `zIndex: 1000`
- `/src/core/Drawer.jsx` - Inherits from `S.overlay` (zIndex: 100)
- `/src/core/CommandPalette.jsx` - `zIndex: 200`

**Impact:** Potential z-index stacking conflicts. Difficult to reason about layer order. No centralized scale.

**Fix:** Create `Z_INDEX` tokens object in design/tokens.js with layers: `{ overlay: 100, modal: 200, tooltip: 200, popover: 150 }`, etc.

---

### 13. Form Input Focus States Inconsistent
**Severity: Minor**
**File:** Multiple input components
**Issue:** Focus styles vary between components. Some use box-shadow, some use border color.

**Examples:**
- `/src/components/SelectPicker.jsx` - Focus handled by global styles
- `/src/design/styles.js:339-342` - Input focused uses `boxShadow: 0 0 0 2px ${C.accent}33`
- Some custom inputs don't follow this pattern

**Impact:** Inconsistent keyboard navigation feedback. Some inputs harder to see when focused.

**Fix:** Ensure all inputs use consistent focus styling from `S.inputFocused`.

---

### 14. Missing Copy/Success Feedback
**Severity: Minor**
**Scope:** Copy-to-clipboard operations
**Issue:** Code blocks and API keys likely have copy buttons without success feedback.

No visible confirmation when text is copied. Users unsure if copy succeeded.

**Fix:** Add toast notification or temporary "Copied!" feedback message on copy operations.

---

### 15. Inconsistent Empty State Messaging
**Severity: Minor**
**File:** `/src/components/EmptyState.jsx` and individual views
**Issue:** Different views implement empty states differently. No unified component usage.

- Some views might show "No results" text without icon
- Some use EmptyState component, others inline custom empty UI
- Consistency of messaging tone varies

**Impact:** Inconsistent UX pattern. Some empty states not discoverable to users.

**Fix:** Ensure all empty states use the EmptyState component or follow consistent pattern.

---

### 16. Missing Skeleton Loaders
**Severity: Minor**
**Scope:** Data-loading views
**Issue:** No skeleton/placeholder loaders while data fetches. Users see abrupt content appearance.

**Affected Views:**
- Table/Sheet views - rows appear suddenly
- Kanban columns - cards appear suddenly

**Impact:** Perceived performance feels worse. Not smooth content reveal.

**Fix:** Implement skeleton loaders or placeholder cards during loading state.

---

### 17. Tooltip Positioning Not Guaranteed Off-Screen
**Severity: Minor**
**File:** Components with tooltips
**Issue:** Tooltips positioned with `position: absolute` but no boundary detection. Tooltips may render off-screen on edges.

**Impact:** Tooltips cut off or hidden at viewport edges.

**Fix:** Implement tooltip boundary detection or use Popper.js library for smart positioning.

---

### 18. Missing Loading Disabled State on Buttons
**Severity: Minor**
**Scope:** Submit buttons across forms
**Issue:** Some buttons don't disable during submission, allowing double-submission.

**Examples:**
- Form submission buttons should disable and show loading spinner
- Delete confirmation buttons sometimes don't prevent multiple clicks

**Impact:** Potential duplicate operations or multiple API calls.

**Fix:** Add `disabled` prop to buttons during loading/submission states. Add loading spinner inside button.

---

## ACCESSIBILITY CHECKLIST (Detailed)

### Missing ARIA Labels
- All icon-only buttons lack `aria-label`
- Dropdown/select components lack proper `role` attributes
- Dialogs/modals missing `role="dialog"` and `aria-modal="true"`
- Tab panels missing `role="tabpanel"` and `aria-labelledby`

### Missing Keyboard Navigation
- Some custom dropdowns may not support arrow keys for navigation
- Modals may not return focus to trigger element on close
- Focus trap not implemented for modals (focus can escape)

### Color Contrast
- Ensure all text meets WCAG AA contrast ratios (4.5:1 for normal text)
- Muted text colors might not have sufficient contrast in light themes

### Responsive Text
- Some fixed font sizes at mobile widths may be too small

---

## DESIGN SYSTEM IMPROVEMENTS

### 1. Define Error/Warning Color Tokens
**Suggested additions to tokens.js:**
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
  // ...
};
```

### 2. Define Z-Index Scale
```javascript
export const Z_INDEX = {
  dropdown: 150,
  modal: 200,
  tooltip: 210,
  popover: 160,
  notification: 250,
};
```

### 3. Define Icon Button Component
Create `/src/components/IconButton.jsx` to standardize icon-only button styling across all uses.

---

## RECOMMENDATIONS

### High Priority
1. Replace all hardcoded `rgba(0,0,0,...)` overlay colors with `C.overlayBg`
2. Define and use error/warning color tokens throughout codebase
3. Add comprehensive ARIA labels and roles to all interactive components
4. Implement responsive design patterns for mobile/tablet viewports
5. Add loading states to data-fetching views

### Medium Priority
6. Create centralized Z-INDEX tokens
7. Implement consistent error message display across forms
8. Add skeleton loaders for data loading states
9. Extract view configuration to context to reduce prop drilling
10. Audit and fix all button focus states

### Low Priority
11. Create reusable IconButton component
12. Add copy feedback toasts
13. Implement tooltip boundary detection
14. Add consistent button disabled states during submission

---

## FILES REQUIRING ATTENTION

### Critical (Requires Changes)
- `/src/design/tokens.js` - Add error, warning, and z-index tokens
- `/src/core/ConfirmDialog.jsx` - Use C.overlayBg
- `/src/core/LinkPicker.jsx` - Use C.overlayBg and add ARIA
- `/src/components/SelectPicker.jsx` - Add ARIA roles and labels
- `/src/components/MultiSelectPicker.jsx` - Add ARIA roles and labels
- `/src/core/SystemManager.jsx` - Replace hardcoded error colors

### Major (Recommendations)
- `/src/core/Drawer.jsx` - Add ARIA, improve focus handling
- `/src/views/Table.jsx` - Add loading state, loading spinner
- `/src/views/Kanban.jsx` - Add loading state, reduce prop drilling
- `/src/components/RecordDetail.jsx` - Add ARIA attributes
- All modal/dialog components - Add proper ARIA attributes

### Cleanup
- All components using hardcoded colors
- All overlay elements using hardcoded rgba colors

---

## CONCLUSION

The Wasabi platform has a strong design foundation with comprehensive tokens and animations. The main gaps are:

1. **Design system usage**: Hardcoded colors bypass theme system
2. **Accessibility**: Missing ARIA attributes and keyboard navigation
3. **Responsiveness**: No mobile/tablet layouts implemented
4. **State handling**: Missing loading and error states in some views

Addressing these issues will significantly improve design consistency, accessibility, and user experience across the platform.
