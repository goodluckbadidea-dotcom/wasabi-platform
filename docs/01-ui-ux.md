# 01 — UI/UX: Design, Themes, Layout & Styling

## Design System

All design tokens live in `src/design/`:

| File | Purpose |
|------|---------|
| `src/design/tokens.js` | Colors, fonts, radius, shadows, breakpoints, palettes |
| `src/design/animations.js` | @keyframes, ANIM presets, TRANSITION presets |
| `src/design/icons.jsx` | Full SVG icon library (40+ icons, no emojis) |
| `src/design/styles.js` | Shared mutable style objects (rebuilt on theme change) |

## Themes

5 Japanese-inspired themes, each locked to dark or light mode:

| Theme | Mode | Accent | Description |
|-------|------|--------|-------------|
| `shoji` | light | `#C0543A` | Washi paper, warm light |
| `obsidian` | dark | `#5CC63A` (Wasabi green) | Volcanic glass, OLED dark (default) |
| `hinoki` | dark | `#C4944A` | Cypress wood, warm dark |
| `kori` | light | `#2C72CC` | Glacier ice, cool light |
| `sumi` | dark | `#C86040` | Ink wash, neutral dark |

### How Themes Work

- Each theme defines: `bg`, `surface`, `surfaceRaised`, `border`, `textPrimary`, `textSecondary`, `textMuted`, `accent`, `accentSoft`
- `_buildTokens()` generates the full token set from these 10 values
- **Mutable `C` object** (`tokens.js:187`) — all components import `C` and use it directly; `applyTheme()` mutates it in place so all files see updated values without re-import
- Theme persists in `localStorage` key: `wasabi-theme-name`
- Old theme names auto-migrate via `_OLD_TO_NEW` map (line 158)

### Color Token Map (C object)

```
C.dark          — background
C.darkSurf      — surface
C.darkSurf2     — raised surface
C.darkBorder    — border
C.darkText      — primary text
C.darkMuted     — muted text
C.edgeLine      — sidebar/content edge gradient line
C.accent        — theme accent color
C.accentDim     — darker accent
C.accentPale    — soft accent background
C.green         — "#2A6B38" (fixed)
C.orange        — "#FF4800" (TE highlight, fixed)
```

### Palettes

- `VIEW_PALETTE` — 10-color array for data visualization (index-based coloring)
- `TIMELINE_PALETTE` — derived from VIEW_PALETTE for Gantt charts
- `SELECT_PALETTE` — reordered for select/status pills
- `WASABI_COLORS` — maps Notion color names → Wasabi fill colors
- All palettes are **mutable arrays** rebuilt by `applyTheme()`

## Typography

```js
FONT = "'Outfit','DM Sans',sans-serif"  // Primary font
MONO = "'DM Mono','Courier New',monospace"  // Code blocks
```

Standard font size scale used across components:
- Headers/titles: 16-18px, fontWeight 600-700
- Body text: 12-13px, fontWeight 400-500
- Labels/badges: 9-11px, fontWeight 500-600
- Calendar events: 12px titles, 10-11px times

## Border Radius (`RADIUS`)

```js
sm: 4, md: 6, lg: 8, xl: 12, pill: 999
```

## Shadows (`SHADOW`)

```js
card, cardHover, dropdown, inset
```

## Breakpoints (`BP`)

```js
mobile: 640, tablet: 1024
```

## Animations

Keyframes injected once via `injectAnimations()` in `src/App.jsx:56`.

### Key Animation Presets (`ANIM`)

| Preset | Use Case |
|--------|----------|
| `snapUp(delay)` | Page/card entrance |
| `popIn(delay)` | Modal/overlay entrance |
| `settleIn(delay)` | List item entrance |
| `contentSwap(delay)` | View transition |
| `scrollReveal(idx)` | Staggered table/list rows |
| `snapInLeft/Right(delay)` | Panel slide-in |
| `modalPop(delay)` | Modal entrance |
| `drawerSlide` | Right drawer |
| `drawerSlideLeft` | Left drawer (Wasabi panel) |
| `rowReveal(idx)` | Table row stagger |
| `spin` | Loading spinner |

### Transition Presets (`TRANSITION`)

| Preset | Use Case |
|--------|----------|
| `hover` | General hover effects |
| `snap` | Bouncy size/position |
| `sidebar` | Sidebar collapse/expand |
| `panel` | Panel slide |
| `color` | Background/color fade |
| `panelResize` | Panel width changes |

## Layout Structure

Main layout in `src/App.jsx`:

```
<div> (full viewport)
  <TopHeader />              — 54px fixed header
  <div> (flex row, flex: 1)
    [WasabiPanel]            — Chat panel (conditional, left side)
    [Gradient bridge line]   — Accent gradient between sidebar/content
    <Navigation />           — Sidebar (48px collapsed, 220px expanded)
    <div> (content)          — Main content area (flex: 1)
      {renderContent()}      — Routed view
    </div>
  </div>
</div>
```

### TopHeader (`src/core/TopHeader.jsx`)
- Height: 54px
- Left: "WASABI" wordmark + breadcrumb
- Right: Neurons toggle (Sushi Roll only) + Sashimi/Sushi Roll toggle + theme cycle
- Border-bottom: gradient `borderImage` with accent color

### Navigation Sidebar (`src/core/Navigation.jsx`)
- Width: 48px collapsed, 220px expanded
- **Sashimi mode**: Simplified — SASHIMI label + spacer + bottom nav (Dashboard, To-Do & Calendar, Notes, Gmail, Settings)
- **Sushi Roll mode**: Full tree — search, folder hierarchy, page tree, bottom actions
- Gradient bridge line: `position: absolute` accent gradient at sidebar right edge

### Styling Approach
- **100% inline React styles** — no CSS files, no CSS-in-JS libraries
- Styles reference `C`, `FONT`, `RADIUS`, `SHADOW` from tokens
- Hover states managed via `onMouseEnter`/`onMouseLeave` event handlers
- Theme changes mutate `C` in place → `forceUpdate` via React state in ThemeContext

## Icon Library (`src/design/icons.jsx`)

40+ SVG icon components. All accept `size` and `color` props.

**Navigation**: IconWasabi, IconGear, IconBell, IconSearch, IconMenu, IconHamburger
**Content**: IconPage, IconFolder, IconEdit, IconTrash, IconPlus, IconClose, IconCheck
**Views**: IconTable, IconKanban, IconCalendar, IconTimeline, IconCards, IconChart, IconForm, IconGrid, IconSheet
**Actions**: IconSend, IconRefresh, IconFilter, IconExport, IconUpload, IconExpand
**Misc**: IconBolt, IconStar, IconBrain, IconGlobe, IconMail, IconFunction, IconDiamond
**Node Editor**: IconPlay, IconCondition, IconTransform, IconConnect, IconWasabiNode
**Arrows**: IconChevronLeft/Right/Down, IconArrowUp/Down

## Reusable Components (`src/components/`)

| Component | File | Purpose |
|-----------|------|---------|
| Breadcrumb | `src/components/Breadcrumb.jsx` | Navigation breadcrumb trail |
| ViewToolbar | `src/components/ViewToolbar.jsx` | View-level controls (filters, sort, etc.) |
| ViewSettingsPanel | `src/components/ViewSettingsPanel.jsx` | View configuration panel |
| FormulaBar | `src/components/FormulaBar.jsx` | Sheet formula input |
| SheetToolbar | `src/components/SheetToolbar.jsx` | Sheet-specific toolbar |
| SelectPicker | `src/components/SelectPicker.jsx` | Single-select dropdown |
| MultiSelectPicker | `src/components/MultiSelectPicker.jsx` | Multi-select dropdown |
| ColumnBuilder | `src/components/ColumnBuilder.jsx` | Table column configuration |
| InlineChart | `src/components/InlineChart.jsx` | Inline sparkline/chart |
| RecordDetailPortals | `src/components/RecordDetailPortals.jsx` | Record detail modal portals |
| WidgetGrid | `src/components/WidgetGrid.jsx` | Dashboard widget grid layout |
