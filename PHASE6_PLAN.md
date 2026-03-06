# Phase 6: Wasabi Platform — Full-Stack Upgrade

## Overview
Phase 6 transforms Wasabi from a "view-builder for Notion" into a **dynamic read/write Notion power-client** with database browsing, full CRUD, calendar/timeline views, a customizable home dashboard, and a cohesive design facelift.

**Priority order** (confirmed):
1. Connect pre-existing Notion Databases
2. Design Facelift (Wasabi palette, solid pills, unified dark mode)
3. Dynamic Filter Chips
4. Calendar/Timeline View
5. Persistent Home Page / Dashboard
6. Super User Notion CRUD
7. SVG Icons in Visual Builder

---

## Step 1: Connect Pre-existing Notion Databases
**Files: `src/core/DatabaseBrowser.jsx` (NEW), `src/core/VisualPageBuilder.jsx`, `src/core/PageShell.jsx`, `src/context/PlatformContext.jsx`, `src/notion/client.js`, `worker.js`**

### 1a. Worker: Add `/search-databases` endpoint
- Add `POST /search-databases` to `worker.js` that calls Notion's `POST /v1/search` with `filter: { value: "database", property: "object" }` and optional `query` parameter
- Returns list of databases the integration can see: `{ id, title, icon, properties_summary }`

### 1b. DatabaseBrowser component (NEW)
- Two modes: **Search/Browse** (calls `/search-databases`) and **Paste URL** (extracts DB ID from Notion URL using regex)
- Shows results as cards: DB name, icon, property count, "Connect" button
- On connect: calls `detectSchema()` → shows schema summary → "Does this look right?" confirmation
- After confirmation: passes `databaseId` back to parent (VisualPageBuilder or a new "Connect Database" flow)

### 1c. Update VisualPageBuilder
- Replace the plain "Database ID" text input with the DatabaseBrowser component
- Support connecting **multiple databases** per page: show list of connected DBs with "Add another" button
- Each connected DB shows its detected schema summary

### 1d. Update PageShell for multi-database
- `pageConfig.databaseIds` is already an array — PageShell already loops them
- Add `schemas` state (map of dbId → schema) so each database's schema is available
- Merge data from multiple DBs, tagging each record with `_databaseId` and `_schema`

### 1e. Update PlatformContext
- No structural changes needed — `addPage` already stores `databaseIds[]` in config

**Estimated LOC: ~400**

---

## Step 2: Design Facelift
**Files: `src/design/tokens.js`, `src/design/styles.js`, `src/views/Table.jsx`, `src/core/VisualPageBuilder.jsx`, all view components**

### 2a. Wasabi Color Palette (10 colors reinterpreting Notion's)
Add to `tokens.js`:
```js
export const WASABI_COLORS = {
  default:  { fill: "#6B7280", text: "#fff" },  // neutral gray
  gray:     { fill: "#9CA3AF", text: "#fff" },  // soft gray
  brown:    { fill: "#92704F", text: "#fff" },  // warm brown
  orange:   { fill: "#FF6B35", text: "#fff" },  // wasabi orange
  yellow:   { fill: "#F5B724", text: "#1A1812" }, // golden
  green:    { fill: "#7DC143", text: "#fff" },  // wasabi green
  blue:     { fill: "#3B82F6", text: "#fff" },  // bright blue
  purple:   { fill: "#8B6FBE", text: "#fff" },  // rich purple
  pink:     { fill: "#E87CA0", text: "#fff" },  // soft pink
  red:      { fill: "#E05252", text: "#fff" },  // alert red
};
```

Add `notionColorToWasabi(notionColor)` function that maps Notion's color names → Wasabi fills.

### 2b. Solid-fill pills everywhere
- Update `styles.pill()` in Table.jsx: change from `background: color + "18"` (transparent tint) → `background: color` with white text
- Apply same solid-fill pattern to Gantt sidebar pills, CardGrid badges, Kanban column headers
- Update `styles.js` global `S.btnPrimary`, `S.btnSecondary`, `S.btnGhost` for solid fills

### 2c. Unified dark mode for VisualPageBuilder
- The builder already uses dark tokens (`C.darkSurf`, `C.darkBorder`, etc.)
- Fix the emoji-based `iconGlyph()` to use SVG icons (defer to Step 7)
- Ensure view type cards, section headers, and footer match the app's dark theme

### 2d. Global button update
- In `styles.js`: change `btnPrimary` from `background: C.accent` (already solid) — keep
- Change `btnSecondary` from outline/ghost → solid with dimmed accent
- All interactive buttons get solid fills with proper hover states

**Estimated LOC: ~250**

---

## Step 3: Dynamic Filter Chips
**Files: `src/views/Table.jsx`, `src/views/_viewHelpers.js`, `src/config/pageConfig.js`**

### 3a. Detect chip-eligible columns
- In Table.jsx, compute `chipFields` from schema: `select`, `multi_select`, `status`, `people`
- For each field, collect all unique options (from schema options + data scan for people)
- People chips show user names/avatars

### 3b. Chip UI component
- Render a horizontal scrollable chip bar below the search toolbar
- Each chip: solid-fill pill using `WASABI_COLORS` mapped from Notion color
- Active chips get full opacity + check icon; inactive chips get dimmed
- Click toggles: multi-select OR logic (clicking "Design" + "Production" shows rows matching either)
- "Clear all" chip at the end when any filter active

### 3c. Filter logic
- Replace current `<select>` dropdown filters with chip-based filtering
- Support multi-select: `activeFilters = { Status: ["Design", "Production"], Priority: ["High"] }`
- Filter pipeline: for each field, if any active values → row must match at least one (OR within field, AND across fields)

### 3d. Persist filters per page
- Save `activeFilters` to `pageConfig` via `updatePageConfig()`
- Load from `pageConfig.activeFilters` on mount
- Clear button resets and persists

**Estimated LOC: ~300**

---

## Step 4: Calendar / Timeline View
**Files: `src/views/Gantt.jsx` (major update), `src/views/Calendar.jsx` (NEW), `src/views/ViewRenderer.jsx`**

### 4a. Enhance existing Gantt.jsx
The current Gantt already has:
- 4 zoom levels (7d, 30d, 90d, 6mo)
- SVG bars with drag-to-reschedule
- Frozen sidebar with labels + status pills
- Today marker, tooltips, scroll sync

**Add:**
- Smooth zoom transitions (CSS transition on pxPerDay changes)
- Keyboard controls: arrow keys navigate between rows, Enter opens detail, +/- zoom
- Customizable cell content: config option to show title only, title + status, or mini card
- "Scroll to today" button in toolbar
- Bar labels show configurable fields (not just title)

### 4b. NEW Calendar.jsx (Month/Week view)
- Renders a standard month grid (7 columns x ~5 rows)
- Each cell shows events for that day as small colored pills
- Click a day to see full event list in a popover
- Events placed on start date; spanning events show on start day only (with duration indicator)
- Week view: 7 columns, hours on Y-axis (optional)
- Navigation: prev/next month, today button
- Events sourced from Notion date fields (same as Gantt)

### 4c. Vertical Timeline (infinite scroll)
Add a "timeline" sub-mode to the Gantt component (toggle in toolbar):
- Vertical layout with date spine on the left
- Cards alternate left/right (matching old app's TimelineView)
- Infinite scroll: loads more data as user scrolls up/down
- Search/filter bar at top

### 4d. Register new view types
- Add `calendar` to VIEW_REGISTRY in ViewRenderer.jsx
- Add `calendar` to VIEW_TYPES in VisualPageBuilder.jsx
- Keep `gantt` as the timeline/Gantt chart view

**Estimated LOC: ~600**

---

## Step 5: Persistent Home Page / Dashboard
**Files: `src/core/HomePage.jsx` (NEW), `src/core/Onboarding.jsx` (update), `src/App.jsx`, `src/context/PlatformContext.jsx`**

### 5a. HomePage component (NEW)
- Default state (no widgets): shows the existing Onboarding content ("What do you want to build?")
- Customized state: widget-based grid layout

### 5b. Widget system
- Widget types:
  - **Page link**: click to navigate to a page (shows icon + name + record count)
  - **Pinned view**: renders a mini version of a view (table preview, chart, summary tiles)
  - **Quick stats**: shows aggregated numbers from a connected DB
  - **Recent activity**: last 5 changes across all pages
- Each widget: draggable card with remove/configure buttons
- Grid: CSS Grid with `auto-fill, minmax(280px, 1fr)`

### 5c. Dashboard configuration
- "Edit dashboard" mode: widgets become draggable, "Add widget" button appears
- Widget picker: lists available pages, views, and stat options
- Save to localStorage: `wasabi_home_config = { widgets: [...] }`

### 5d. Integration with App.jsx
- When `activePage === null` and pages exist → render HomePage instead of Onboarding
- When `activePage === null` and no pages → render Onboarding (first-time flow)
- HomePage gets a special entry in Navigation sidebar

**Estimated LOC: ~500**

---

## Step 6: Super User Notion CRUD
**Files: `src/core/SchemaEditor.jsx` (NEW), `src/core/RecordDetail.jsx` (NEW), `src/core/DatabaseCreator.jsx` (NEW), `src/views/Table.jsx`, `src/notion/client.js`, `worker.js`**

### 6a. RecordDetail panel (slide-out)
- Triggered by clicking a row in Table view (or a card in CardGrid/Kanban)
- Slides in from the right (360px wide panel)
- Shows ALL fields from the record, organized by type:
  - Title field (large editable heading)
  - Status/Select fields (dropdown pickers with colored pills)
  - Date fields (date picker with start/end range)
  - Number fields (numeric input)
  - Rich text fields (textarea with markdown preview)
  - Relation fields (linked record chips with click-to-navigate)
  - People fields (avatar chips)
  - Files fields (file list with download links)
  - Checkbox fields (toggle switches)
  - Formula/Rollup fields (read-only computed display)
- Save button commits all changes via PATCH
- Delete button archives the record
- "Open in Notion" link

### 6b. SchemaEditor component (NEW)
- Accessible from PageShell toolbar or System Manager
- Shows all columns in the connected database
- Actions per column:
  - **Rename**: inline editable name
  - **Change type**: dropdown (limited by Notion API — some types can't convert)
  - **Edit options**: for select/multi_select/status, edit option names + colors
  - **Delete column**: with confirmation
- **Add column**: name + type picker + options (if applicable)
- All changes go through `updateDatabase()` in client.js → worker's `PATCH /database/:id`

### 6c. DatabaseCreator component (NEW)
- Two modes: "From scratch" and "From template"
- **From scratch:**
  - Name input
  - Column builder: add columns with name + type + options
  - Preview of schema before creation
  - Creates via `createDatabase()` in client.js
- **From template:**
  - Template list (same as Onboarding templates but with predefined schemas)
  - Creates DB with pre-populated columns
- After creation: auto-connects the new DB to a page

### 6d. Update worker.js
- Ensure `PATCH /database/:id` supports full property updates (add, rename, remove, modify options)
- Add `POST /search` endpoint for Notion search API (used by DatabaseBrowser in Step 1)

### 6e. Inline editing enhancements in Table.jsx
- Click title cell → opens RecordDetail panel (instead of inline edit for title)
- Other cells remain inline-editable as-is
- Add "New Record" button in table toolbar → opens RecordDetail with empty fields

**Estimated LOC: ~900**

---

## Step 7: SVG Icons in Visual Builder
**Files: `src/design/icons.jsx`, `src/core/VisualPageBuilder.jsx`**

### 7a. Add missing icons to icons.jsx
New icons needed:
- `IconCalendar` (for calendar view type)
- `IconKanban` (for kanban view type)
- `IconTable` (for table view type)
- `IconForm` (for form view type)
- `IconCards` (for card grid view type)
- `IconTimeline` (for gantt/timeline view type)
- `IconStar` (for favorites/dashboard)
- `IconUsers` (for people/CRM)
- `IconInbox` (for inbox/activity)
- `IconFolder` (for folder/category)
- `IconDatabase` (for database icon)
- `IconEdit` (for edit/pencil)
- `IconExpand` (for expand/record detail)

### 7b. Replace emoji icons in VisualPageBuilder
- Delete the `iconGlyph()` function that maps to Unicode emojis
- Replace with an `iconComponent()` function that returns the appropriate SVG icon
- Update the ICONS array to reference SVG components
- Update the icon picker grid to render actual SVG icons

### 7c. Update Onboarding template icons
- Templates already use SVG icons from icons.jsx — no changes needed
- Ensure consistency across all icon usage points

**Estimated LOC: ~200**

---

## Architecture Notes

### Data Flow (with Phase 6 changes)
```
Notion API ←→ Cloudflare Worker ←→ React Client
                                     ├─ PlatformContext (global state)
                                     ├─ PageShell (data fetching, multi-DB)
                                     ├─ ViewRenderer (view type → component)
                                     │   ├─ Table (+ filter chips + record detail)
                                     │   ├─ Gantt (+ keyboard + zoom transitions)
                                     │   ├─ Calendar (NEW)
                                     │   ├─ Kanban, CardGrid, Charts, Form...
                                     │   └─ SchemaEditor (NEW)
                                     ├─ HomePage (NEW - dashboard grid)
                                     ├─ DatabaseBrowser (NEW)
                                     ├─ DatabaseCreator (NEW)
                                     └─ RecordDetail (NEW - slide-out panel)
```

### New Files (8)
1. `src/core/DatabaseBrowser.jsx` — Search/browse/paste Notion databases
2. `src/core/HomePage.jsx` — Persistent dashboard with widget grid
3. `src/core/RecordDetail.jsx` — Slide-out record detail panel
4. `src/core/SchemaEditor.jsx` — Database schema editor
5. `src/core/DatabaseCreator.jsx` — Create new databases from scratch/template
6. `src/views/Calendar.jsx` — Month/week calendar view
7. `src/views/FilterChips.jsx` — Reusable filter chip bar component
8. (no new file needed for icons — extend existing `icons.jsx`)

### Modified Files (~15)
- `src/design/tokens.js` — WASABI_COLORS palette, notionColorToWasabi()
- `src/design/styles.js` — Solid-fill button styles
- `src/design/icons.jsx` — 13+ new SVG icons
- `src/views/Table.jsx` — Filter chips, record detail trigger, new record button
- `src/views/Gantt.jsx` — Keyboard controls, zoom transitions, vertical timeline mode
- `src/views/ViewRenderer.jsx` — Register Calendar view type
- `src/core/VisualPageBuilder.jsx` — DatabaseBrowser integration, SVG icons, multi-DB
- `src/core/PageShell.jsx` — Multi-schema support, toolbar enhancements
- `src/core/Onboarding.jsx` — Integrate with HomePage
- `src/App.jsx` — HomePage routing, RecordDetail overlay
- `src/context/PlatformContext.jsx` — Home config persistence
- `src/notion/client.js` — searchDatabases() function
- `src/config/pageConfig.js` — Filter persistence, home config
- `worker.js` — /search-databases endpoint, search API proxy

### Estimated Total: ~3,150 LOC across 23 files (8 new + 15 modified)

---

## Implementation Order (within each step)

Each step is independently deployable. We build, test, and push after each step.

| Step | Features | Depends On | Est. LOC |
|------|----------|------------|----------|
| 1 | Database Browser + Multi-DB | — | 400 |
| 2 | Design Facelift | — | 250 |
| 3 | Filter Chips | Step 2 (colors) | 300 |
| 4 | Calendar/Timeline | Step 2 (colors) | 600 |
| 5 | Home Dashboard | Steps 1-4 (pages to pin) | 500 |
| 6 | Super User CRUD | Steps 1-2 (DB connection, design) | 900 |
| 7 | SVG Icons | — | 200 |

Steps 1, 2, and 7 can be parallelized. Steps 3 and 4 depend on Step 2's color system.
