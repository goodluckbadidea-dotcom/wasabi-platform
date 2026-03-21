# 01 — Design System & UI/UX

## Overview

Wasabi's design system is built on **mutable design tokens** and **theme-locked color palettes**. All visual design is defined in `src/design/` and uses **inline styles** — no CSS files or external UI dependencies. The system supports 5 Japanese-inspired themes, each locked to dark or light mode for visual consistency.

---

## Design Files

| File | Lines | Purpose |
|------|-------|---------|
| `src/design/tokens.js` | ~200 | Colors (C object), fonts, shadows, radius, breakpoints, palettes |
| `src/design/styles.js` | ~450 | Mutable style objects (rebuilt on theme change) |
| `src/design/animations.js` | ~250 | @keyframes definitions and animation presets |
| `src/design/icons.jsx` | ~500+ | 65+ SVG icons (no emojis, all inline) |

---

## Design Tokens (tokens.js)

### Color System: The Mutable C Object

All components import `C` from `tokens.js` and use it directly:

```javascript
import { C } from "../design/tokens.js";
// Then: background: C.dark, color: C.accent, etc.
```

**Key property:** `C` is mutable. When the user changes themes, `applyTheme()` mutates `C` in place. All components see the updated values without re-importing or re-rendering unnecessarily.

### Color Tokens (C object structure)

```javascript
C.dark              // Background color (theme.bg)
C.surface           // Secondary surface (theme.surface)
C.surfaceAlt        // Raised surface (theme.surfaceRaised)
C.border            // Border/divider (theme.border)
C.border2           // Secondary border (slightly lighter)
C.text              // Primary text color (theme.textPrimary)
C.textMid           // Secondary text (theme.textSecondary)
C.muted             // Muted/disabled text (theme.textMuted)
C.white             // Alias for primary text

// Accessibility aliases
C.darkText          // Alias: C.text
C.darkSurf          // Alias: C.surface
C.darkSurf2         // Alias: C.surfaceAlt
C.darkBorder        // Alias: C.border
C.darkMuted         // Alias: C.muted

// Edge lines (gradients)
C.edgeLine          // Sidebar/content edge separator

// Code blocks
C.codeBlockBg       // Code snippet background

// Overlays
C.overlayBg         // Modal/dialog overlay (theme-aware rgba)

// Accent colors (per-theme)
C.accent            // Theme accent color
C.accentDim         // Darkened accent (22% darker)
C.accentPale        // Soft accent background for pills/badges

// Fixed colors (unchanged across themes)
C.green             // "#2A6B38" (success)
C.orange            // "#FF4800" (warning/highlight)
```

### The 5 Themes

Each theme is **locked to its designed mode** (dark or light). Switching modes within a theme is not allowed; users must select a different theme for the opposite mode.

| Theme | Mode | Accent | Description |
|-------|------|--------|-------------|
| **shoji** | light | #C0543A | Washi paper warm light |
| **obsidian** | dark | #5CC63A (Wasabi) | Volcanic glass OLED dark (default) |
| **hinoki** | dark | #C4944A | Cypress wood warm dark |
| **kori** | light | #2C72CC | Glacier ice cool light |
| **sumi** | dark | #C86040 | Ink wash neutral dark |

### Theme Data Structure

Each theme in `THEMES` object:

```javascript
THEMES[themeId] = {
  label: "Obsidian",
  description: "Volcanic glass · OLED dark",
  mode: "dark",           // Locked mode
  accent: "#5CC63A",      // Theme accent
  accentDim: "#447E2A",   // Pre-calculated darker accent
  accentPale: "#142810",  // Soft accent background
  palette: [              // 10-color array for data viz
    { key: "base-dark", hex: "#080809", text: "#F2F2F3" },
    { key: "surface", hex: "#101012", text: "#F2F2F3" },
    { key: "raised", hex: "#18181C", text: "#F2F2F3" },
    // ... 7 more colors ...
  ],
  // Both point to same tokens (mode is locked)
  dark: { /* token set */ },
  light: { /* same token set */ },
}
```

### Typography

```javascript
FONT        // "'Outfit','DM Sans',sans-serif" — primary font
FONT_DISPLAY // "'Outfit',sans-serif" — display/headings
MONO        // "'DM Mono','Courier New',monospace" — code
```

**Font size scale used across components:**
- Headers/titles: 16–18px, weight 600–700
- Body text: 12–14px, weight 400–500
- Labels/badges: 9–11px, weight 500–600
- Calendar events: 12px titles, 10–11px times
- Data tables: 12px rows, 11px headers

### Border Radius (RADIUS)

```javascript
RADIUS.sm       // 4px
RADIUS.md       // 6px
RADIUS.lg       // 8px
RADIUS.xl       // 12px
RADIUS.pill     // 999px (fully rounded)
```

### Shadows (SHADOW)

```javascript
SHADOW.card      // Subtle card shadow
SHADOW.cardHover // Darker on hover
SHADOW.dropdown  // Dropdown/popover shadow
SHADOW.inset     // Inset shadow for depth
```

*Note: SHADOW is mutable, rebuilt when theme changes.*

### Breakpoints (BP)

```javascript
BP.mobile   // 640px
BP.tablet   // 1024px
```

**Status:** Defined in tokens but **not yet used** for responsive styles. Desktop-only layout assumption throughout app.

### Color Palettes

Four mutable arrays rebuilt on theme change:

1. **VIEW_PALETTE** — 10-color array for record/row coloring in data views (Kanban cards, calendar event colors, etc.)
2. **TIMELINE_PALETTE** — Derived from VIEW_PALETTE for Gantt charts
3. **SELECT_PALETTE** — Reordered color set for select/status pills
4. **WASABI_COLORS** — Maps Notion's 18 color names to Wasabi fill colors

---

## Styles (styles.js)

Mutable style objects exported as `S`. All components import and use:

```javascript
import { S } from "../design/styles.js";
// Then: style={{ ...S.navItem, ...customOverrides }}
```

### Main Style Groups

**App shell:**
- `S.app` — Root container
- `S.sidebar`, `S.sidebarExpanded` — Sidebar (56px collapsed, 220px expanded)
- `S.main` — Main content area
- `S.header` — Top header bar

**Navigation:**
- `S.navItem` — Individual nav icon button
- `S.navItemActive` — Active state
- `S.navItemHover` — Hover state

**Messaging/Chat:**
- `S.messages` — Message container
- `S.msgOuter`, `S.msgInner` — Message wrapper
- `S.bubbleUser`, `S.bubbleAssistant` — Chat bubbles
- `S.avatarWrap` — Avatar circle

**Buttons & controls:**
- `S.btnGhost` — Transparent button
- `S.btnPrimary` — Accent-colored button
- `S.inputBase` — Input field base
- `S.inputFocused` — Input focus style

**Tables & lists:**
- `S.table`, `S.thead`, `S.tr`, `S.td` — Table elements
- `S.trHover` — Row hover state

**Overlays:**
- `S.overlay` — Modal backdrop (zIndex: 100)
- `S.modal` — Modal container (zIndex: 200)

*Note: rebuild `S` on theme change via `rebuildStyles()` call from ThemeContext.*

---

## Animations (animations.js)

### Keyframes Injection

All @keyframes are injected once on app load:

```javascript
// src/App.jsx
injectAnimations();
injectInteractionStyles();
injectScrollbarStyles(C);
updateCSSCustomProperties(C);
```

This creates a `<style>` tag with all animation definitions, avoiding duplicate @keyframes.

### Key Animation Presets (ANIM object)

```javascript
ANIM.snapUp(delay)          // Page/card entrance (translate + scale)
ANIM.popIn(delay)           // Modal/overlay entrance
ANIM.settleIn(delay)        // List item entrance
ANIM.slideUp(delay)         // Gentle upward slide
ANIM.scaleIn(delay)         // Zoom-in entrance
ANIM.fadeUp(delay)          // Fade + slight rise
ANIM.fadeIn(delay)          // Pure fade
ANIM.slideOutRight(delay)   // Exit to right
ANIM.slideInRight(delay)    // Entrance from right
ANIM.slideInLeft(delay)     // Entrance from left
ANIM.bounce(delay)          // Subtle bounce
ANIM.spin(delay)            // Rotation (loading spinners)
ANIM.blink(delay)           // Opacity pulse
ANIM.pulse(delay)           // Scale pulse
ANIM.shimmer(delay)         // Shimmer effect
ANIM.navDrop(delay)         // Nav dropdown entrance
ANIM.panelSlideIn(delay)    // Side panel entrance
ANIM.nodeGlow(delay)        // Glow effect (neurons)
ANIM.dashFlow(delay)        // Dash flow (SVG)
ANIM.coordMorph(delay)      // Border morphing (orbs)
```

### Transition Presets (TRANSITION object)

Common CSS transitions for consistency:

```javascript
TRANSITION.all              // all 0.15s
TRANSITION.color            // color 0.15s
TRANSITION.background       // background 0.15s
TRANSITION.transform        // transform 0.1s
TRANSITION.slow             // all 0.3s
```

---

## Icon Library (icons.jsx)

### Icon Set (65 icons total)

All icons are inline SVG components, no emoji anywhere.

**Navigation & Core:**
- `IconWasabi` — Wasabi leaf logo
- `IconWasabiNode` — Wasabi sphere (neurons)
- `IconGear` — Settings
- `IconSearch` — Search
- `IconMenu` — Hamburger menu
- `IconHamburger` — Alt hamburger

**Communication:**
- `IconMail` — Email/Gmail
- `IconChat` — Chat/messages
- `IconBell` — Notifications
- `IconUser` — Single user
- `IconUsers` — Multiple users
- `IconMention` — @mention
- `IconPhone` — Phone call

**Data & Views:**
- `IconDatabase` — Database
- `IconTable` — Table/spreadsheet
- `IconSheet` — Sheet view
- `IconKanban` — Kanban board
- `IconCalendar` — Calendar
- `IconTimeline` — Timeline/Gantt
- `IconGrid` — Grid/layout
- `IconCards` — Card layout
- `IconChart` — Charts/analytics

**Actions:**
- `IconPlus` — Add/create
- `IconClose` — Close/dismiss
- `IconTrash` — Delete
- `IconEdit` — Edit
- `IconCheck` — Checkmark
- `IconCheckSquare` — Checkbox checked
- `IconArrowUp` — Arrow up
- `IconArrowDown` — Arrow down
- `IconChevronLeft` — Chevron left
- `IconChevronRight` — Chevron right
- `IconChevronDown` — Chevron down

**Pages & Organization:**
- `IconPage` — Page/document
- `IconFolder` — Folder
- `IconInbox` — Inbox
- `IconQueue` — Task queue/list
- `IconBrain` — AI/intelligence
- `IconLightbulb` — Ideas/insights

**States & Indicators:**
- `IconWarning` — Warning/alert
- `IconStatusDot` — Status indicator
- `IconBlocked` — Blocked/denied
- `IconAlarm` — Alarm/timer
- `IconHourglass` — Pending/waiting
- `IconBolt` — Lightning (quick action)

**Utilities & Misc:**
- `IconLink` — Link/relationship
- `IconClipboard` — Copy/clipboard
- `IconExport` — Export/download
- `IconUpload` — Upload/import
- `IconRefresh` — Refresh/reload
- `IconExpand` — Expand
- `IconSun` — Light mode
- `IconMoon` — Dark mode
- `IconFilter` — Filter
- `IconSort` — Sort
- `IconBelt` — Belt/connector
- `IconForm` — Form/input
- `IconFunction` — Function/code
- `IconTransform` — Transform/convert
- `IconCondition` — Condition/logic
- `IconPlay` — Play/execute
- `IconDollar` — Currency/pricing
- `IconEyeOff` — Hide/privacy
- `IconDiamond` — Premium/highlight
- `IconBox` — Container/box
- `IconStar` — Favorite/important
- `IconConnect` — Connect/sync
- `IconHandshake` — Partnership/agreement
- `IconPaperclip` — Attachment
- `IconSend` — Send/submit
- `IconLog` — Activity log

### Icon Component Pattern

```jsx
import { IconPlus } from "../design/icons.jsx";

// Icon properties:
<IconPlus
  size={20}           // 20px (default), any size
  color="#5CC63A"     // custom color, or uses currentColor (default)
  style={{ ... }}     // inline style overrides
  aria-label="Add"    // MISSING (accessibility gap)
/>
```

**Implementation:** All icons use a shared `Icon` wrapper component that handles SVG setup. Each icon is a functional component returning SVG markup.

---

## Layout Architecture

### Main App Structure

```
App
├── TopHeader (header bar: logo + breadcrumb + controls)
├── Layout (display: flex)
│   ├── WasabiPanel (optional left panel: chat, log, notifications)
│   ├── Navigation (sidebar: nav icons + expanded menu)
│   └── Main Content
│       ├── PageShell (if viewing a page)
│       │   ├── SubPageNav (page header: title, refresh, settings)
│       │   └── ViewRenderer (actual view: table, kanban, etc.)
│       ├── Or: Zen Views (if in zen mode)
│       │   ├── TasksView
│       │   ├── NotesView
│       │   ├── GmailView
│       │   ├── DashboardView
│       │   └── WorkspaceBrowser
│       └── System Panels (overlays)
│           ├── CommandPalette
│           ├── Modals (ConfirmDialog, NewRecordModal, etc.)
│           ├── Drawers (RecordDetail, etc.)
│           └── Neurons (visual overlay)
```

### Header: TopHeader.jsx

**Height:** 54px (including safe area padding)

**Layout:**
- **Left:** Wordmark "WASABI" (gradient text) + vertical divider + breadcrumb (page path)
- **Center:** Save status indicator (optional)
- **Right:** Refresh button, Neurons toggle, Theme cycle, User pill (avatar + dropdown)

**Styling:**
- Background: C.dark
- Border-bottom: 1px with gradient (accent-flavored)
- zIndex: 200

### Sidebar: Navigation.jsx

**Collapsed width:** 56px
**Expanded width:** 220px

**Sections:**
1. **Top icon bar** (always visible):
   - Wasabi logo (flame icon)
   - Search button (opens command palette)
   - Notifications bell (with badge)
   - Brain icon (neurons toggle)

2. **Page navigation** (expanded only):
   - Current folder pages (hierarchical)
   - Add/Create menu
   - Page context menu (right-click)

3. **Bottom nav** (expanded only):
   - Workspaces, Dashboard, To-Do, Notes, Gmail, Workspace Browser
   - Settings (gear icon)

**Styling:**
- Background: C.dark
- Border-right: 1px C.edgeLine
- zIndex: 10

### Right Panel: WasabiPanel.jsx

**Default width:** 320px (resizable: 280–640px)

**Tabs:**
1. **Chat** — AI conversation with context from current page
2. **Log** — Activity log of recent actions
3. **Notifications** — Notification feed (new in Phase 3)

**Controls:**
- Resize handle (bottom-right of panel header)
- Minimize button (snap to default width)
- Close button (hides panel)

**Styling:**
- Background: C.dark
- Drag handle: C.border
- zIndex: 100

---

## Component-Specific Patterns

### Buttons

**Ghost button (transparent):**
```javascript
style={{
  ...S.btnGhost,
  color: C.text,
  fontSize: 12,
}}
```

**Primary button (accent background):**
```javascript
style={{
  background: C.accent,
  color: "#fff",
  padding: "6px 12px",
  borderRadius: RADIUS.md,
  cursor: "pointer",
}}
```

### Input Fields

**Base style:**
```javascript
style={{
  ...S.inputBase,
  color: C.text,
  background: C.surface,
  borderColor: C.border,
}}
```

**Focused state (2px accent shadow):**
```javascript
onFocus: (e) => {
  e.target.style.boxShadow = `0 0 0 2px ${C.accent}33`;
}
```

### Modals & Overlays

**Overlay backdrop:**
```javascript
background: C.overlayBg,  // Theme-aware rgba
position: "fixed",
zIndex: 100,
inset: 0,
```

**Modal container:**
```javascript
position: "fixed",
zIndex: 200,
background: C.surface,
borderRadius: RADIUS.lg,
boxShadow: SHADOW.dropdown,
```

---

## Known Gaps & Issues

### Critical Gaps (from design review)

1. **Hardcoded Overlay Colors**
   - Multiple components use hardcoded `rgba(0,0,0,0.55)` instead of `C.overlayBg`
   - Affects: ConfirmDialog, LinkPicker, SheetUrlDialog, CommandPalette, GmailView, WorkspaceBrowser, PinLockOverlay, ViewSettingsPanel
   - **Impact:** Theme changes don't affect overlay darkness; light themes may have poor contrast
   - **Fix:** Replace all instances with `C.overlayBg`

2. **Missing Error/Warning Color Tokens**
   - Error red (#E05252) and warning orange (#FF6B3D) are hardcoded in SystemManager and other files
   - No dedicated `C.error`, `C.warning`, `C.success` tokens
   - **Impact:** Error states don't adapt to theme changes
   - **Fix:** Add to C object and use throughout
   - **Suggested tokens:**
     ```javascript
     C.error: "#E05252",
     C.errorDim: "#C94040",
     C.errorPale: "#E0525218",
     C.warning: "#FF6B3D",
     C.warningDim: "#FF4800",
     C.warningPale: "#FF480044",
     C.success: "#2A6B38",
     ```

3. **Missing Z-Index Scale**
   - Z-index values hardcoded throughout: 100, 150, 200, 1000, etc.
   - No centralized `Z_INDEX` constant for stacking context
   - **Impact:** Potential z-index stacking conflicts; hard to reason about layer order
   - **Fix:** Create `Z_INDEX` tokens:
     ```javascript
     export const Z_INDEX = {
       dropdown: 150,
       overlay: 100,
       modal: 200,
       tooltip: 210,
       notification: 250,
     };
     ```

4. **No Responsive Design Implementation**
   - Breakpoints defined (`BP.mobile: 640px`, `BP.tablet: 1024px`) but unused
   - No @media queries or responsive style variants
   - Fixed sidebar width, fixed drawer widths, fixed column widths
   - **Impact:** Poor UX on tablets and mobile; desktop-only experience
   - **Fix:** Implement @media queries using BP tokens or React window size hooks

5. **Hardcoded Icon Colors**
   - `IconWasabi` defaults to hardcoded "#7DC143" (should be dynamic)
   - `IconWasabiNode` defaults to hardcoded "#F5B724"
   - **Impact:** Icons don't adapt if brand colors change
   - **Fix:** Accept color props or use theme-aware defaults

### Major Gaps

6. **Missing Accessibility Attributes**
   - No `aria-label` on icon-only buttons
   - No `role="dialog"` on modals
   - No `aria-modal`, `aria-hidden` on overlays
   - No `role="listbox"` on dropdowns
   - **Impact:** Screen reader users cannot navigate components (WCAG 2.1 Level A violations)
   - **Fix:** Add ARIA attributes to all interactive components

7. **Missing Loading/Empty States**
   - Some views show blank screens during data fetch (Table.jsx, Kanban.jsx)
   - No skeleton loaders or spinners
   - **Impact:** Users uncertain if app is responsive
   - **Fix:** Add Spinner components and skeleton loaders during data fetch

8. **Inconsistent Animation Durations**
   - Components define their own EXIT_DURATION (200ms, 180ms) instead of using ANIM presets
   - Drawer uses 200ms, ConfirmDialog uses 180ms
   - **Impact:** Animations feel out of sync
   - **Fix:** Export EXIT_DURATION_MS from animations.js and use consistently

9. **Missing Hover States**
   - Some table rows and list items lack clear hover visual feedback
   - Not all interactive elements have :hover styles
   - **Impact:** Users unsure which elements are interactive
   - **Fix:** Ensure all interactive list/table rows have clear hover states

10. **Inconsistent Focus Styles**
    - Input focus styles vary between components (box-shadow vs. border color)
    - Some custom inputs don't follow S.inputFocused pattern
    - **Impact:** Inconsistent keyboard navigation feedback
    - **Fix:** Ensure all inputs use consistent focus styling

11. **Missing Copy/Success Feedback**
    - Copy-to-clipboard operations lack feedback
    - No toast notifications or temporary "Copied!" messages
    - **Impact:** Users unsure if copy succeeded
    - **Fix:** Add toast notification on copy operations

12. **Inconsistent Button Styling**
    - Close buttons have different styling across components (onMouseEnter/Leave vs. CSS :hover)
    - Mix of S.btnGhost and inline styles
    - **Impact:** Visual inconsistency
    - **Fix:** Create reusable IconButton component

---

## Theme Change Flow

1. User clicks theme selector in header
2. `ThemeContext.applyTheme()` is called with new theme ID
3. Function retrieves `THEMES[themeId]` and extracts tokens
4. Mutates `C` object in place: `Object.assign(C, newTokens)`
5. Calls `rebuildStyles()` to regenerate `S` object
6. Updates CSS custom properties for scrollbars
7. Persists to localStorage: `wasabi-theme-name`
8. Components render with new colors (no re-import needed)

---

## Summary

Wasabi's design system is **minimal and mutable**, prioritizing simplicity and performance over framework abstractions. The key pattern — mutable `C` object — allows all components to use the same reference and see updates instantly without prop drilling or context subscriptions. Combined with theme-locked color palettes and inline styles, this creates a lean, fast, and cohesive visual system.

**For developers:** Always import and use `C` and `S` directly. On theme changes, styles update automatically in place. No need to pass colors as props or wrap components in additional context providers.
