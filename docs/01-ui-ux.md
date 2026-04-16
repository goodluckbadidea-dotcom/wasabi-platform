# 01 — Design System & UI/UX

## Product Context

Wasabi is an AI-native workspace where users build persistent semantic scaffolding that makes AI more accurate over time. The design system exists to serve two audiences: humans who need a fast, consistent interface for organizing data visually, and the AI agent that reasons over the structured context they create. See `docs/00-wasabi-overview.md` for the full platform description.

---

## Design Files

| File | Purpose |
|------|---------|
| `src/design/tokens.js` | Colors (C), fonts (FONT, MONO), shadows (SHADOW), radius (RADIUS), breakpoints (BP), z-index (Z), palettes |
| `src/design/styles.js` | Mutable shared style objects (S), rebuilt on theme change |
| `src/design/animations.js` | @keyframes injection, ANIM presets (33), TRANSITION presets (6) |
| `src/design/interactions.js` | hoverBg() and focusRing() inline event helpers |
| `src/design/icons.jsx` | 70 inline SVG icon components |

---

## Theme System

### 5 Themes (Mode-Locked)

Each theme is locked to its designed mode (dark or light). Users select a different theme to change modes rather than toggling dark/light within a theme.

| Theme | Mode | Accent | Description |
|-------|------|--------|-------------|
| **Shoji** | light | `#C0543A` | Washi paper warm light |
| **Obsidian** | dark | `#5CC63A` | Volcanic glass OLED dark (default) |
| **Hinoki** | dark | `#C4944A` | Cypress wood warm dark |
| **Kori** | light | `#2C72CC` | Glacier ice cool light |
| **Sumi** | dark | `#C86040` | Ink wash neutral dark |

### Background Gradient (2026-04-16)

Each theme defines a `bgGradient` — a radial gradient applied to the app root container (`App.jsx`). All views are transparent, so the gradient shows through everywhere.

All 5 themes use a standardized position and spread:
- **Position:** `ellipse at 50% -10%` (top center)
- **Spread:** `60%`

Burst colors are theme-specific:

| Theme | Burst Color | Effect |
|-------|-------------|--------|
| **Shoji** | `#EDD8D0` | Warm peach-orange glow |
| **Obsidian** | `#22223A` | Cool purple-black glow |
| **Hinoki** | `#281E0A` | Warm brown glow |
| **Kori** | `#D4E4F6` | Cool ice-blue glow |
| **Sumi** | `#2A2E3C` | Neutral blue-grey glow |

The sidebar (`Navigation.jsx`) has a separate vertical linear gradient (accent stripe) independent of the app gradient.

### Theme Data Structure

Each entry in the `THEMES` object contains:

- `label`, `description` — display strings
- `mode` — `"dark"` or `"light"` (locked)
- `accent` — primary accent hex
- `accentDim` — 22% darker accent (auto-computed)
- `accentPale` — soft accent background for badges/pills
- `palette` — 10-color array for data visualization
- `dark` / `light` — both point to the same token set (mode is locked)

### WCAG AA Contrast (March 2026)

All 5 themes were tuned so that `textMuted` achieves 4.5:1+ contrast against both `bg` and `surface`. Surface layers (`surface`, `surfaceRaised`, `border`) were widened to create visible elevation separation. `textSecondary` was also adjusted on light themes (Shoji, Kori) to maintain hierarchy. Token changes are in `_RAW_THEMES` in `src/design/tokens.js`.

### Theme Change Flow

1. User clicks theme selector in TopHeader
2. `ThemeContext.applyTheme(name)` called
3. Retrieves `THEMES[name]`, extracts tokens
4. Mutates `C` in place via `Object.assign(C, tokens)`
5. Rebuilds `SHADOW`, all palettes (`VIEW_PALETTE`, `SELECT_PALETTE`, `TIMELINE_PALETTE`, `WASABI_COLORS`, `STATUS_COLORS`), and `S` via `rebuildStyles()`
6. Updates CSS custom properties for scrollbar theming
7. Persists to `localStorage: wasabi-theme-name`
8. Components render with new values instantly (no re-import needed)

**Caveat:** Module-level style objects that capture `C.*` values in template literals at import time will hold stale strings after a theme switch. Style objects must be returned from **functions** called at render time, not defined as module-level constants. `tableStyles.js` was converted from `export const styles = {...}` to `export function getStyles() { return {...} }` in 2026-04-16 to fix this. Any new style files must follow the same pattern.

---

## Color Tokens (C Object)

`C` is a mutable token object. When the theme changes, `applyTheme()` mutates it in place so all importers see updated values without re-rendering.

```javascript
import { C } from "../design/tokens.js";
```

### Surface & Background

| Token | Purpose |
|-------|---------|
| `C.dark` | Root background (theme.bg) |
| `C.surface` | Secondary surface (theme.surface) |
| `C.surfaceAlt` | Raised surface (theme.surfaceRaised) |
| `C.border` | Primary border/divider |
| `C.border2` | Secondary border (slightly lighter in dark, darker in light) |

### Text

| Token | Purpose |
|-------|---------|
| `C.text` | Primary text color |
| `C.textMid` | Secondary text |
| `C.muted` | Muted/disabled text (WCAG AA 4.5:1+ on all surfaces) |
| `C.white` | Alias for `C.text` |

### Aliases (backward compatibility)

| Token | Alias for |
|-------|-----------|
| `C.darkText` | `C.text` |
| `C.darkSurf` | `C.surface` |
| `C.darkSurf2` | `C.surfaceAlt` |
| `C.darkBorder` | `C.border` |
| `C.darkMuted` | `C.muted` |

### Special Surfaces

| Token | Purpose |
|-------|---------|
| `C.edgeLine` | Sidebar/content edge separator (= surfaceRaised) |
| `C.codeBlockBg` | Code snippet background |
| `C.overlayBg` | Modal/dialog backdrop (dark: `rgba(0,0,0,0.55)`, light: `rgba(0,0,0,0.25)`) |

### Accent Colors (per-theme)

| Token | Purpose |
|-------|---------|
| `C.accent` | Theme accent color |
| `C.accentDim` | Darkened accent (22% darker) |
| `C.accentPale` | Soft accent background for pills/badges |

### Semantic Status Colors (fixed across themes)

| Token | Value | Purpose |
|-------|-------|---------|
| `C.error` | `#E05252` | Error/destructive states |
| `C.errorHover` | `#C94040` | Error hover/active state |
| `C.errorDim` | Theme-aware | Subtle error background (33% dark / 18% light alpha) |
| `C.warning` | `#FF6B3D` | Warning states |
| `C.warningDim` | Theme-aware | Subtle warning background |
| `C.success` | `#4CAF50` | Success states |
| `C.successDim` | Theme-aware | Subtle success background |

### Fixed Colors (unchanged across themes)

| Token | Value | Purpose |
|-------|-------|---------|
| `C.green` | `#2A6B38` | Legacy green |
| `C.orange` | `#FF4800` | TE highlight color |
| `C.orangeDim` | `#D93C00` | Darker orange |
| `C.orangePale` | `#FFF0E8` | Pale orange background |

---

## Typography

```javascript
FONT         = "'Outfit','DM Sans',sans-serif"    // Primary body + headings
FONT_DISPLAY = "'Outfit','DM Sans',sans-serif"    // Alias for FONT
MONO         = "'DM Mono','Courier New',monospace" // Code blocks, technical text
```

Font size conventions used across components:
- Headers/titles: 15-18px, weight 600-700
- Body text: 12-14px, weight 400-500
- Labels/badges: 9-11px, weight 500-600
- Data table rows: 12px; table headers: 11px

---

## Border Radius (RADIUS)

```javascript
RADIUS.sm   = 4     // Micro: checkboxes, inline code, tooltips
RADIUS.md   = 10    // Secondary interactive: inputs, small buttons, stacked cards
RADIUS.lg   = 14    // Content surfaces: cards, panels, dropdowns, modals
RADIUS.xl   = 14    // Alias for lg
RADIUS.pill = 999   // Primary/navigational: CTA buttons, search bars, tabs, nav items
```

---

## Shadows (SHADOW)

The `SHADOW` object is mutable and rebuilt on theme change. Each theme has a tint (warm or cool RGB) and shadows are softer for light themes, deeper for dark themes.

```javascript
SHADOW.card       // Subtle resting card shadow
SHADOW.cardHover  // Elevated card on hover
SHADOW.dropdown   // Dropdown/popover/modal shadow
SHADOW.inset      // Inset shadow for depth
SHADOW.glow       // Glow effect (neurons, highlights)
```

Shadow tints per theme: obsidian `(0,8,24)`, shoji `(12,8,4)`, hinoki `(18,10,0)`, kori `(0,6,20)`, sumi `(6,8,16)`.

---

## Breakpoints (BP)

```javascript
BP.mobile = 768    // Below 768 = phone. 768 = iPad portrait cutoff
BP.tablet = 1194   // 768..1194 = tablet. Covers iPad Air landscape (1180px), iPad Pro 11" (1194px)
```

Breakpoints are actively used via `ViewportContext` (see below) for responsive layout decisions.

---

## Z-Index Scale (Z)

All fixed/absolute overlays must use these tokens. Component-internal relative z-indexes (1-10) are fine inline.

```javascript
Z.sticky    =    50  // Sticky headers, toolbars
Z.dropdown  =   150  // Dropdowns, popovers, select pickers
Z.header    =   200  // TopHeader bar
Z.modal     =   500  // Modals, dialogs, command palette, context menus
Z.panel     =   900  // Side panels (WasabiPanel, Gmail)
Z.lock      =  1000  // PIN lock overlay, document editor overlays
Z.toast     =  9000  // Conflict toasts, notifications
Z.workspace =  9999  // Workspace browser (always on top)
```

---

## Animations (ANIM) — 33 Presets

Keyframes are injected once on app load via `injectAnimations()`. The `ANIM` object provides preset strings for the `animation` CSS property.

### Entrance Animations

| Preset | Description |
|--------|-------------|
| `ANIM.snapUp(delay)` | Page/card entrance (translate + scale + overshoot settle) |
| `ANIM.popIn(delay)` | Modal/overlay entrance (scale bounce) |
| `ANIM.settleIn(delay)` | List item entrance (subtle translate + scale) |
| `ANIM.slideUp(delay)` | Gentle upward slide |
| `ANIM.scaleIn(delay)` | Zoom-in entrance |
| `ANIM.fadeUp(delay)` | Fade + slight upward rise |
| `ANIM.fadeIn(delay)` | Pure opacity fade |
| `ANIM.snapDown(delay)` | Entrance from above (reverse snapUp) |
| `ANIM.snapInRight(delay)` | Entrance from right with bounce |
| `ANIM.snapInLeft(delay)` | Entrance from left with bounce |
| `ANIM.modalPop(delay)` | Modal entrance (scale + translate settle) |
| `ANIM.contentSwap(delay)` | Content swap transition |
| `ANIM.navDrop` | Nav dropdown entrance |
| `ANIM.panelSlideIn` | Side panel entrance |
| `ANIM.backdropFade` | Backdrop fade-in |
| `ANIM.drawerFade` | Drawer overlay fade |
| `ANIM.drawerSlide` | Drawer slide from right |
| `ANIM.drawerSlideLeft` | Drawer slide from left |

### Staggered / Row Animations

| Preset | Description |
|--------|-------------|
| `ANIM.rowReveal(idx)` | Table row reveal with stagger (0.02s per index) |
| `ANIM.listItem(idx)` | List item entrance with stagger (0.03s per index) |
| `ANIM.scrollReveal(idx)` | Scroll-triggered row reveal (0.015s per index) |

### Looping Animations

| Preset | Description |
|--------|-------------|
| `ANIM.bounce(i)` | Subtle bounce (loading dots) |
| `ANIM.spin` | 360-degree rotation (loading spinners) |
| `ANIM.blink` | Opacity pulse |
| `ANIM.pulse` | Scale pulse |
| `ANIM.coordMorph` | Border-radius morphing (orbs) |
| `ANIM.coordPulse` | Scale breathing (orbs) |
| `ANIM.nodeGlow` | Glow effect (neurons) |
| `ANIM.dashFlow` | SVG dash flow (neuron lines) |
| `ANIM.shimmer` | Shimmer effect (skeleton loaders) |

### Exit Animations

| Preset | Description |
|--------|-------------|
| `ANIM.fadeOut(dur)` | Fade + scale down exit |
| `ANIM.slideOutRight` | Slide out to right |
| `ANIM.slideOutLeft` | Slide out to left |
| `ANIM.backdropFadeOut` | Backdrop fade-out |

---

## Transitions (TRANSITION) — 6 Presets

Common CSS transition strings for inline styles:

```javascript
TRANSITION.hover       // "all 0.18s cubic-bezier(0.4, 0, 0.2, 1)"        — smooth hover
TRANSITION.snap        // "all 0.25s cubic-bezier(0.22, 1.2, 0.36, 1)"    — snappy resize
TRANSITION.sidebar     // "width 0.32s ..., padding 0.32s ..."            — sidebar collapse
TRANSITION.panel       // "transform 0.3s ..., opacity 0.25s ease"        — panel slide
TRANSITION.color       // "background 0.15s, color 0.15s, border 0.15s"   — color fade
TRANSITION.panelResize // "width 0.28s cubic-bezier(0.25, 1, 0.5, 1)"    — panel drag resize
```

---

## Interaction Helpers (interactions.js)

Two exported functions for consistent hover and focus behavior via inline event handlers:

### hoverBg(bg, reset)

Spread onto any element for hover background transitions:

```jsx
<button {...hoverBg()}>Default</button>
<div {...hoverBg(C.accent + "10", C.darkSurf)}>Custom</div>
```

Sets `onMouseEnter` / `onMouseLeave` handlers that update `style.background`.

### focusRing(color)

Spread onto any focusable element for keyboard-only focus rings:

```jsx
<button {...focusRing()}>Accessible</button>
```

Uses `:focus-visible` detection to show a 2px accent outline only on keyboard navigation.

---

## Shared Styles (S Object) — 52 Keys

`S` is a mutable style object rebuilt on theme change via `rebuildStyles()`. Components import and spread:

```javascript
import { S } from "../design/styles.js";
// Usage: style={{ ...S.card, ...customOverrides }}
```

### Key Style Groups

**App Shell:** `app`, `sidebar`, `sidebarExpanded`, `main`, `header`, `headerTitle`

**Navigation:** `navItem`, `navItemActive`, `navItemHover`

**Chat/Messaging:** `messages`, `msgOuter`, `msgInner`, `avatarWrap`, `bubbleUser`, `bubbleAssistant`, `inputBox`, `inputWrap`, `inputWrapFocused`, `textarea`, `sendBtn`

**Buttons:** `btnPrimary`, `btnSecondary`, `btnGhost`, `btnChoice`

**Cards:** `card`, `cardHover`

**Tables:** `table`, `th`, `td`, `trHover`

**Inputs:** `input`, `inputFocused`, `inputDark`, `select`

**Overlays:** `overlay`, `drawer`, `dropdown`, `dropdownItem`, `dropdownItemHover`

**Typography:** `h1`, `h2`, `h3`, `label`, `caption`, `code`, `codeBlock`

**Misc:** `pill(color)`, `badge`, `divider`, `empty`, `thinkingDot(i)`, `tooltip`

---

## Icon Library — 70 Icons

All icons are inline SVG components in `src/design/icons.jsx`. No emoji anywhere. Every icon accepts `size` (default 20), `color` (default `currentColor`), and `style` props.

```jsx
import { IconPlus } from "../design/icons.jsx";
<IconPlus size={20} color={C.accent} />
```

Icons cover navigation, communication, data views, actions, pages, states, and utilities. All share an internal `Icon` wrapper component.

---

## Layout Dimensions

### TopHeader (`src/core/TopHeader.jsx`)

- **Height:** 52px
- **Background:** `C.dark`, border-bottom with `C.edgeLine`
- **Z-index:** `Z.header` (200)
- **Layout:** Left (wordmark + breadcrumb) | Center (save status) | Right (refresh, neurons, theme, user pill)

### Sidebar / Navigation (`src/core/Navigation.jsx`)

- **Collapsed width:** 56px (icon-only nav)
- **Expanded width:** 220px (page list + nav items)
- **Background:** `C.dark`, border-right with `C.edgeLine`

### WasabiPanel (`src/core/WasabiPanel.jsx`)

- **Default width:** 320px
- **Resizable:** 280-640px via drag handle
- **Tabs:** Chat, Log, Notifications
- **Z-index:** `Z.panel` (900)

---

## ViewportContext

`src/context/ViewportContext.jsx` provides responsive state to any component via the `useViewport()` hook.

```jsx
import { useViewport } from "../context/ViewportContext.jsx";

function MyComponent() {
  const { isNarrow, isTablet, isTouch, width } = useViewport();
  // isNarrow:  width < 768  (phone)
  // isTablet:  768 <= width <= 1194  (iPad range)
  // isTouch:   navigator.maxTouchPoints > 0
  // width:     current viewport width in px
}
```

Uses `matchMedia` listeners on BP breakpoints for efficient updates.

---

## StateIndicators

`src/components/StateIndicators.jsx` exports three reusable components for loading, empty, and error states:

### SkeletonLoader

```jsx
<SkeletonLoader rows={5} style={{}} />
```

Renders shimmer-animated placeholder rows during data fetch.

### EmptyState

```jsx
<EmptyState icon={IconInbox} message="Nothing here yet" action="Add item" onAction={handleAdd} />
```

Centered message with optional icon and action button.

### ErrorState

```jsx
<ErrorState message="Something went wrong" onRetry={handleRetry} />
```

Error message with optional retry button.

---

## ToastContext

`src/context/ToastContext.jsx` provides a global toast notification system.

### useToast() Hook

```jsx
import { useToast } from "../context/ToastContext.jsx";

function MyComponent() {
  const { showToast } = useToast();
  showToast("Page saved", "success");
  showToast("Save failed", "error");
  showToast("Check connection", "warning");
  showToast("Sync complete", "info");
}
```

### globalToast()

For non-component code (e.g., context providers):

```javascript
import { globalToast } from "../context/ToastContext.jsx";
globalToast("Operation failed", "error", 4000);
```

### Toast Types

| Type | Usage |
|------|-------|
| `success` | Successful operations (save, create, sync) |
| `error` | Failed operations, validation errors |
| `warning` | Non-blocking alerts, degraded states |
| `info` | Informational notifications |

Toasts auto-dismiss after 4 seconds (configurable via `durationMs` parameter) and support fade-out exit animation.

---

## Color Palettes

Four mutable palette systems, all rebuilt on theme change:

1. **VIEW_PALETTE** — 11-entry array (key, hex, text) for data visualization. Theme-tuned for temperature/saturation. Indices map to Notion color names via `NOTION_TO_PALETTE_IDX`.
2. **TIMELINE_PALETTE** — Derived from VIEW_PALETTE vivid entries for Gantt bar colors. Includes `color` and `bg` (pale tint) per entry.
3. **SELECT_PALETTE** — Reordered vivid-first color set for select/status pill backgrounds.
4. **WASABI_COLORS** — Maps Notion's 10 color names to Wasabi fill+text pairs.

Color resolution follows a priority chain: per-view mapping, global defaults, Notion schema color, STATUS_COLORS, option index, hash fallback. The `resolveUnifiedColor()` function is the single entry point.

---

## Style Rules

1. **Always use design tokens** — `C.error` not `"#E05252"`, `Z.modal` not `500`, `FONT` not `"'Outfit'..."`
2. **Inline styles only** — no CSS files, no styled-components, no CSS-in-JS libraries
3. **Z-index must use Z tokens** — never hardcode z-index values for fixed/absolute overlays
4. **All overlays use `C.overlayBg`** — never hardcode `rgba(0,0,0,...)`
5. **ARIA on all dialogs** — `role="dialog"`, `aria-modal="true"`, `aria-labelledby`
6. **iPad-aware** — use `useViewport()` for responsive behavior, test at 768px and 1194px
7. **All record editing through RecordDrawer** — table cells are read-only (click opens drawer)
8. **Use S styles as base** — spread `S.card`, `S.btnGhost`, etc. and override with inline additions
9. **Use interaction helpers** — `{...hoverBg()}` and `{...focusRing()}` for consistent interactive states
10. **Use StateIndicators** — `SkeletonLoader`, `EmptyState`, `ErrorState` for loading/empty/error states
11. **Use ToastContext** — `showToast()` for user feedback on operations
