# Sub-Item Enhancement Plan

## Goal

Make sub-items a first-class feature across the platform. Parent items become containers with rollable timelines and progress tracking. Sub-items get full property parity and visibility in Gantt, Kanban, and Calendar views.

**Example:**
```
Parent: NY Launch          [Jan 1 ---- Mar 31]  Progress: 33%
  Sub: Tins                [Jan 1 -- Feb 15]    Complete
  Sub: Packaging           [Feb 1 --- Mar 15]   In Progress
  Sub: Merchandising       [Mar 1 ---- Apr 10]  Not Started  <-- CONFLICT: exceeds parent
```

---

## Phase 1: Status Categories

**Why first:** Meaningful roll-up requires the system to know what "done" means. Currently status options are flat `{name, color}` pairs with no semantic meaning. This phase adds a `category` field to each status option.

### 1A — Schema: Add `category` to status options

**Files:** `worker/handlers/tables.js`, `src/lib/dataSource.js`

- Extend the status option shape from `{name, color}` to `{name, color, category}`.
- Valid categories: `"not_started"`, `"in_progress"`, `"complete"`, `"on_hold"`, `"cancelled"`.
- Default category: `"not_started"` when not specified (backward compatible — existing options without `category` are treated as not_started).
- `normalizeOptions()` in `dataSource.js` (line ~700) gains a `category` passthrough:
  ```js
  category: o.category || "not_started"
  ```
- `assignOptionColor()` is unchanged — color and category are independent.
- No D1 migration needed — categories live inside the existing `options` JSON blob on each column.

### 1B — UI: Category selector in option management

**Files:** `src/views/table/ColumnContextMenu.jsx`, `src/views/RecordDetail.jsx`

- In the "Manage Options" panel (accessible from column context menu and RecordDetail), add a small dropdown next to each option row.
- Dropdown shows the five categories with a subtle icon/color indicator:
  - `not_started` — gray circle outline
  - `in_progress` — blue half-fill circle
  - `complete` — green checkmark circle
  - `on_hold` — yellow pause icon
  - `cancelled` — red x icon
- Selecting a category writes it back to the option object and calls `updateTableSchema` / `updateSubColumnSchema`.
- Default for new options: `"not_started"`.
- Works identically for parent columns and sub-columns (both are status type).

### 1C — Classify in schema pipeline

**Files:** `src/lib/dataSource.js`

- `d1SchemaToClassified()`: when classifying status fields, preserve `category` on each option so it's available to all consumers (Gantt, Kanban, RecordDetail, roll-up logic).
- `normalizeOptions()` already maps all option fields — just ensure `category` passes through.

### Deliverable

Status options carry semantic meaning. The system can now answer "is this record complete?" by reading its status value's category. No behavior changes yet — this is pure data enrichment.

---

## Phase 2: Timeline Roll-Up + Conflict Detection

**Why next:** With status categories in place, the parent can now derive its own progress. This phase adds automatic parent timeline calculation and conflict flagging.

### 2A — Roll-up computation utility

**Files:** `src/lib/subItemRollup.js` (new file)

Create a pure utility module:

```js
/**
 * computeSubItemRollup(parentPage, childPages, parentSchema, subSchema)
 *
 * Returns:
 * {
 *   computedStart: Date | null,       // earliest child start
 *   computedEnd: Date | null,         // latest child end
 *   progress: { total, complete, percent },
 *   hasConflict: boolean,             // children exceed parent range
 *   conflictDetails: { childrenStart, childrenEnd, parentStart, parentEnd }
 * }
 */
```

- Iterates child pages, reads all date fields from sub-schema, finds global min start / max end.
- Counts children by status category: complete + cancelled = "resolved", total - resolved = remaining.
- Progress percent = resolved / total (cancelled counts as resolved for progress purposes).
- Conflict detection: if parent has manually set dates AND children's computed range exceeds them, `hasConflict = true`.

### 2B — Roll-up display on parent record

**Files:** `src/views/RecordDetail.jsx`, `src/views/Table.jsx`

- **RecordDetail:** When viewing a parent record that has sub-items, show a roll-up summary bar in the Sub-Items tab:
  - Progress bar (e.g., "2 of 4 complete — 50%") using status category counts.
  - Computed date range ("Jan 1 – Apr 10").
  - Conflict warning if applicable: amber banner — "Sub-item dates exceed parent timeline (parent ends Mar 31, sub-items end Apr 10)."
- **Table view:** Optional — show a small progress indicator in the parent row (could be a later refinement).

### 2C — Roll-up in data layer

**Files:** `src/lib/dataSource.js`

- After `fetchD1Table` builds all pages, compute roll-up for each parent that has children.
- Attach roll-up data to parent page object as `page._rollup = computeSubItemRollup(...)`.
- This makes roll-up available to all views without each view computing it independently.

### Deliverable

Parent records show live progress and computed date ranges from their children. Conflicts between parent and child timelines are visually flagged.

---

## Phase 3: Gantt Sub-Item Hierarchy

**Why next:** The Gantt view is the primary consumer of timeline data and the view Graham specifically wants hierarchical sub-items in.

### 3A — Data: tree structure in Gantt

**Files:** `src/views/Gantt.jsx`

- Filter the incoming `data` array into parent rows and sub-item rows.
- Build a tree: each parent gets a `children[]` array of its sub-items.
- Track expanded/collapsed state per parent (local state, keyed by pageId).
- The flattened render list becomes: `[parent1, ...parent1.children (if expanded), parent2, ...]`.
- Sub-items without date fields are included in the sidebar list but have no bars.

### 3B — Sidebar: indented hierarchy

**Files:** `src/views/Gantt.jsx`

- Parent rows render at current indent level with an expand/collapse chevron (right-pointing when collapsed, down when expanded).
- Sub-item rows render with left indent (~20px) and slightly reduced font size or lighter color to visually distinguish.
- Parent row shows roll-up progress badge from `page._rollup` (e.g., "2/4" or a mini progress bar).
- Sub-item count shown next to chevron when collapsed.

### 3C — Timeline bars: parent spanning + conflict indicator

**Files:** `src/views/Gantt.jsx`

- **Parent bar behavior:**
  - If parent has its own date fields set manually, render those as the parent bar (current behavior).
  - If parent has children with dates, render a computed range bar (lighter/translucent) spanning `_rollup.computedStart` to `_rollup.computedEnd`.
  - If both exist: show the manual bar as primary, and if there's a conflict, add a visual indicator — a small amber/red triangle icon or a dashed extension line showing where children extend beyond.
- **Sub-item bars:** Render using the sub-schema date fields. Same drag-to-reschedule behavior as parent bars, but `onUpdate` must thread `isSubItem` through.
- **Color:** Sub-item bars use the same color mode as parent bars but with slightly reduced opacity or a different shade to maintain visual hierarchy.

### 3D — Drag-to-reschedule for sub-items

**Files:** `src/views/Gantt.jsx`, `src/core/PageShell.jsx`

- When a sub-item bar is dragged, the `onUpdate` callback must include the sub-item's page ID and field name from the sub-schema.
- `PageShell.handleUpdate` already threads `isSubItem` — verify this works for Gantt-originated updates.
- After a sub-item date change, recompute parent roll-up and check for new conflicts.

### 3E — ViewSettingsPanel: sub-item date field selection

**Files:** `src/views/Gantt.jsx` (settings panel section)

- Add a "Sub-item date fields" selector to the Gantt settings panel, allowing users to choose which sub-column date fields appear as bars.
- Default: all sub-column date fields.

### Deliverable

Gantt view shows collapsible parent/child hierarchy with parent bars spanning child ranges, sub-item bars indented below, conflict indicators, and drag-to-reschedule for sub-items.

---

## Phase 4: Kanban + Calendar Sub-Item Awareness

### 4A — Kanban: hide sub-items

**Files:** `src/views/Kanban.jsx`

- Filter out sub-items from the card data before the grouping `useMemo`.
- Single line: `const filteredData = data.filter(p => !p._parentRowId);`
- Sub-items are accessible only by opening the parent record's detail view.
- Parent cards could optionally show a sub-item count badge (e.g., "3 sub-items") — lightweight indicator.

### 4B — Calendar: sub-items on expand

**Files:** `src/views/Calendar.jsx`

- Filter out sub-items from the main `eventMap` build (exclude `page._parentRowId`).
- When a parent event is clicked in the day popover, show its sub-items inline below it (read from children in the data set, not a new API call since all rows are already loaded).
- Sub-item events render with indent and lighter styling in the popover.
- Optionally: parent event pill shows a small indicator (dot or count) when it has sub-items with dates.

### Deliverable

Sub-items no longer pollute Kanban and Calendar as orphaned cards/events. They appear contextually through their parent.

---

## Phase 5: RecordSubItems Upgrade

### 5A — Interactive sub-item list

**Files:** `src/views/RecordDetail.jsx`

- Replace the read-only title list with a richer component showing:
  - Title (clickable — opens sub-item in RecordDetail)
  - Status pill (with category-aware coloring)
  - Date range (if set)
  - Progress/category icon
- Clicking a sub-item opens it in RecordDetail (already supported by the schema-switch logic — just need to wire the click handler).

### 5B — Inline sub-item creation

**Files:** `src/views/RecordDetail.jsx`

- Add a ghost row / "+ Add sub-item" button at the bottom of the sub-item list.
- On click/enter: creates a sub-item via `createRecord` with `parentRowId` set.
- Inline title editing (same pattern as table ghost row).

### 5C — Roll-up summary bar

**Files:** `src/views/RecordDetail.jsx`

- Above the sub-item list, show the roll-up summary:
  - Progress bar with fraction (e.g., "2 of 4 complete")
  - Computed date range
  - Conflict warning (amber banner) if sub-item dates exceed parent dates

### Deliverable

The Sub-Items tab becomes a useful mini-dashboard for managing children: see status, dates, progress, create new ones, click into any of them.

---

## Execution Notes

### Order matters

Phases are ordered by dependency:
1. **Status categories** — prerequisite for roll-up
2. **Timeline roll-up** — prerequisite for Gantt conflict indicators
3. **Gantt hierarchy** — the biggest visual deliverable, depends on 1 + 2
4. **Kanban/Calendar** — independent but benefits from roll-up data
5. **RecordSubItems** — polish, benefits from everything above

### Risk areas

- **Gantt performance:** Adding tree expansion doubles the complexity of the row rendering loop. Keep the expanded set small by defaulting to collapsed.
- **Roll-up recomputation:** Must be efficient — runs on every data refresh. The utility function should be pure and memoizable.
- **Sub-item drag in Gantt:** The `onUpdate` → `handleUpdate` → `updateRecord` chain must correctly thread `isSubItem`. Test thoroughly.
- **Backward compatibility:** Existing status options without `category` must work — default to `"not_started"`.

### Files touched (summary)

| File | Phases |
|------|--------|
| `src/lib/dataSource.js` | 1A, 1C, 2C |
| `src/lib/subItemRollup.js` (new) | 2A |
| `src/views/table/ColumnContextMenu.jsx` | 1B |
| `src/views/RecordDetail.jsx` | 1B, 2B, 5A, 5B, 5C |
| `src/views/Gantt.jsx` | 3A, 3B, 3C, 3D, 3E |
| `src/views/Kanban.jsx` | 4A |
| `src/views/Calendar.jsx` | 4B |
| `src/core/PageShell.jsx` | 3D |
| `worker/handlers/tables.js` | 1A (no changes needed — options are in JSON blob) |

### What this plan does NOT include

- Multi-level nesting (sub-sub-items) — explicitly excluded per Graham's direction
- Sub-item filtering in Table view filter pipeline
- Sub-item sorting within a parent group
- Gantt dependency arrows between sub-items
- Notion sync for status categories (Notion has its own groups model — bridging is a separate effort)
