# Extensions — Typed Appendages Attached to Wasabi

**Status:** In development. Feature wired end-to-end and deployed.
Data Collection type shipped 2026-07-10; see §Data Collection below.

**See also:**
- `memory/project_extensions_feature.md` — current `inventory-production-v2`
  state, MCP-Generated feature spec, cumulative gotchas.
- `memory/project_data_collection_extension.md` — Data Collection
  architecture + Inventory extension state.

## What this is

An **extension** is a self-contained appendage attached to Wasabi. Two
broad types exist today:

| type | authoring | UI | storage |
|---|---|---|---|
| `mcp_generated` (default) | Claude in an MCP session using a local HTML mockup | sandboxed iframe rendered from `{{DATA}}` template + DATA blob | `extensions` row + `extension_snapshots` rows (DATA blob per snapshot, rendered HTML in R2) |
| `data_collection` | in-app (Master Item Sheet + admin UI) | native React (no iframe) | `extensions` row + four `dc_*` tables (items, submissions, submission_entries, share_links) |

Both types share the `extensions` table, distinguished by
`extensions.type`. The two paths never conflict — snapshot generation
refuses to run on a `data_collection` extension and vice versa.

## MCP-Generated (`mcp_generated`)

The classic Extensions workflow: a user designs a report visually as a
self-contained HTML mockup with sample data, hands it off to Claude in an
MCP-enabled session, and Wasabi turns it into a live, re-renderable report
template. After that initial bootstrap, future report runs ("snapshots")
are generated from real source data parsed by Claude and pushed into the
template via MCP.

The same workflow produces **any** report — an inventory snapshot, a
financial summary, a project handoff, a research synthesis. The platform
layer is data-agnostic; each report type lives entirely inside its own D1
extension row.

---

## The two halves: bootstrap vs. iterate

### Bootstrap (once per new report type)

A single Claude session does this end-to-end. The user has the source
data folder open and shares it with Claude via filesystem access.

1. User: "I want to create a new report template for Wasabi using this data."
2. Claude reads the source folder, asks the user about the visual design,
   discusses the data shape, troubleshoots edge cases.
3. Claude (with user) builds a self-contained `.html` mockup — full HTML
   + CSS + JS, with sample data inline as `const DATA = {…}` so it
   renders standalone in a browser.
4. User looks at the rendered mockup, gives feedback, iterates.
5. When the mockup is stable: user says "create the D1 template."
6. Claude calls `wasabi_extensions` with `action: "create"`:
   - `html`: the mockup with `const DATA = {…}` swapped for `const DATA = {{DATA}};`
   - `data_schema`: strict JSON Schema authored to match the mockup's data shape
   - `definition`: long-form markdown — glossary, calculations, source-document
     roles, parse rules, gotchas (see "The definition field" below)
   - `sample_data`: optional dev/test fixture; never used for real snapshots
7. Claude reads the source folder and parses it into a data payload matching
   the schema, then calls `wasabi_extension_snapshots` `generate` to produce
   the first live snapshot.

**After step 7, the local `.html` mockup is vestigial.** It served its purpose
as a bootstrap artifact. All future edits — visual, schema, definition,
data — happen on the D1 row via MCP. Never re-edit the mockup file.

### Refresh (recurring — new source data arrives)

A fresh Claude session each time. The user shares the updated source folder.

1. Claude reads `wasabi_extensions get <slug>` → `data_schema` + `definition`.
2. Claude reads `wasabi_extension_snapshots get_data <previous-snapshot-id>`
   → the previous DATA blob (for diffing).
3. User shares the new source folder.
4. Claude parses the new source folder into a fresh DATA shape that satisfies
   the schema, diffs against the previous snapshot, narrates changes to the user.
5. User confirms. Claude calls `wasabi_extension_snapshots`:
   - `update` on the same snapshot id (replaces in-place, re-renders R2 HTML), OR
   - `generate` with a new slug (creates a new dated snapshot, leaves the prior
     one intact for historical comparison).
6. Schema validation happens server-side. Bad shapes return 422 with a
   `validation_errors` array — Claude fixes and retries.

### Refine (visual or logic improvements to the template)

Same fresh-session model.

1. Claude reads `wasabi_extensions get <slug>` → current `html` + `data_schema`
   + `definition`.
2. User describes what's wrong or what to change.
3. Claude edits in-memory, calls `wasabi_extensions update` with any subset
   of `html` / `data_schema` / `definition`.
4. Re-render an existing snapshot by calling `wasabi_extension_snapshots
   update` on that snapshot's id with `data` set to its current value (or any
   no-op update). The worker re-substitutes `{{DATA}}` into the new template
   and writes fresh HTML to R2.
5. **If the schema changes, update `definition` in the same session** so
   future refresh sessions stay in sync with what each field means.

---

## The definition field

The single most important field on an extension. It is the long-form
markdown that Claude reads at the start of any refresh or refine session
so the session doesn't need to re-derive the report's logic from scratch.

What belongs in `definition`:

- **Purpose** — what the report is, who reads it, what decision it informs.
- **Glossary** — every domain term, every acronym, every internal nickname.
- **Source-document roles** — for each file type the source folder may
  contain, what role it plays. Which file is the source of truth for what,
  which files are reference-only, which files override others.
- **Field meanings** — for each field in `data_schema`, what real-world
  thing it represents and how it should be filled. Especially: enum values
  and what each value means semantically.
- **Parse rules** — the multi-step process that turns source documents into
  data records. Per-source nuances, ambiguities, the right way to interpret
  ambiguous columns.
- **Calculations** — every derived/computed quantity in the template, with
  the formula.
- **Gotchas** — class-of-bug warnings that have bitten past sessions, with
  enough context that the next session avoids them.

Treat `definition` as the session's brief to its successor. If a refresh
session needs to ask the user "what does field X mean?" — the answer
should have already been in `definition`.

---

## Source-folder parsing — the discipline

Each report type has its own parse rules (captured in `definition`). The
**generic process** that applies to any report type is:

**Step 0 — Scope check.** Is this source document in scope for this
report? Strain reports, Smoky line, etc. may be out of scope.

**Steps 1–6 — Source-derivable facts.** For each in-scope document,
extract the facts that are unambiguously in the source. For a PO PDF
this typically means: vendor, destination, line items, order date,
production timeline (when present), shipping method (when present).

**Step 7 — Interview.** What's *not* in the source (production schedules
for some POs, transit dates for direct shipments, splits between
markets) is filled with a batched user interview. Confirm steps 1–3
with the user simultaneously to catch authoring errors.

**Discovery before push.** Always produce a discovery report covering all
source files BEFORE making any data push. Surface ambiguities + needed
human input as a structured list, not a stream of one-off questions.

**Watch for source-doc traps.** Things like wrong "Ship To" addresses,
vendor names that don't mean what they look like (e.g. "Global Print LA"
is not an LA production location), and partial-box rows in inventory
files that need a confirmed interpretation. The first time a class of
trap bites, document it in `definition`.

---

## Validation

The worker enforces shape via a JSON Schema validator (`validateData()` in
[worker/handlers/extensions.js](../worker/handlers/extensions.js)). Subset
supported: `type`, `required`, `properties`, `additionalProperties`, `items`,
`enum`, `minimum`, `maximum`, `minLength`, `maxLength`, `minItems`,
`maxItems`, `pattern`.

Validation runs on both:
- `POST /extensions/:id/snapshots` (generation)
- `PATCH /extensions/snapshots/:id` (data update)

On failure the response is `422` with `validation_errors: [{ path, message }]`.

**Schema discipline is the primary guardrail against bad data.** A strict
schema rejects the wrong shape before it ever lands as a snapshot. The
schema and `definition` should evolve together — every new field, enum
value, or invariant gets documented in both places.

---

## Snapshot lifecycle

```
generate (or update) → Draft
                       ↓ (publish)
                     Published
```

- **Draft** — generated; lives in `extension_snapshots`; HTML in R2; a Draft
  row exists in the workspace-wide Reports DB.
- **Published** — promoted via `wasabi_extension_snapshots publish`. Reports
  DB row flips to Published. Publishing doesn't re-render; it just changes
  status. Visibility (`workspace` vs `public`) is independent of status.

The Reports DB (`system_reports` page) is system-managed; every snapshot
gets a row there. The user sees Drafts and Published reports in one place.
Clicking a Reports DB row opens the snapshot in `ExtensionViewer.jsx`
(sandboxed iframe + Wasabi theme handshake via postMessage).

---

## Visibility

| Visibility | Who can view |
|---|---|
| `workspace` (default) | Authenticated Wasabi users |
| `public` | Anyone with the URL (no auth) |

Set via `wasabi_extension_snapshots set_visibility` or at generation time.
The HTML serve endpoint (`/extensions/:slug/:snap_slug`) checks visibility
on every request — workspace snapshots require an authenticated JWT or the
MCP shared-secret header.

---

## Architecture

### D1 tables

`extensions` — template definitions, one per report type.

| Column | Purpose |
|---|---|
| `id`, `slug`, `name`, `icon`, `description` | Identity + UI display |
| `definition` | Long-form markdown for Claude (this doc's centerpiece) |
| `html` | Template with `{{DATA}}` placeholder |
| `data_schema` | JSON Schema (TEXT, serialized JSON) |
| `sample_data` | Dev/test fixture; never used for real snapshots |
| `theme_preference` | `inherit` (apply Wasabi theme via postMessage) or `static` |
| `version` | Bumps on every `html` / `data_schema` / `sample_data` edit |
| `status` | `active` / `archived` |

`extension_snapshots` — concrete generated reports.

| Column | Purpose |
|---|---|
| `id`, `slug`, `title` | Identity |
| `extension_id` | FK to `extensions.id` |
| `data` | The DATA blob (TEXT, serialized JSON) |
| `html_key` | R2 key for the rendered HTML (`extensions/{ext_slug}/{slug}.html`) |
| `template_version` | Frozen at generation time — which template version produced this |
| `source_snapshot_id` | Optional — set when a snapshot was composed from a previous one |
| `status` | `draft` / `published` |
| `visibility` | `workspace` / `public` |
| `reports_row_id` | FK to the Reports DB row mirroring this snapshot |

### Worker routes

All routes live in [worker.js](../worker.js) and call out to
[worker/handlers/extensions.js](../worker/handlers/extensions.js).

| Method + Path | Purpose |
|---|---|
| `GET /extensions` | List templates |
| `POST /extensions` | Create template |
| `GET /extensions/:id` | Get template (id or slug) |
| `PATCH /extensions/:id` | Update template |
| `DELETE /extensions/:id` | Delete (only if no snapshots) |
| `GET /extensions/:id/snapshots` | List snapshots for a template |
| `POST /extensions/:id/snapshots` | Generate snapshot (validates DATA) |
| `GET /extensions/snapshots` | List all snapshots |
| `GET /extensions/snapshots/:id` | Get snapshot metadata |
| `GET /extensions/snapshots/:id/data` | Get snapshot DATA blob |
| `PATCH /extensions/snapshots/:id` | Update snapshot (re-renders if data changes) |
| `DELETE /extensions/snapshots/:id` | Delete snapshot (cleans R2 + Reports row) |
| `POST /extensions/snapshots/:id/publish` | Draft → Published |
| `GET /extensions/snapshots/:id/links` | List snapshot ↔ workspace links |
| `POST /extensions/snapshots/:id/links` | Add link (neuron or record_comment) |
| `GET /extensions/:slug/:snap_slug` | Public-aware HTML serve (auth checked) |

### MCP tools

Both tools are in [mcp-server/index.js](../mcp-server/index.js).

| Tool | Actions |
|---|---|
| `wasabi_extensions` | `list`, `get`, `create`, `update`, `delete` |
| `wasabi_extension_snapshots` | `list`, `get`, `generate`, `update`, `delete`, `get_data`, `publish`, `set_visibility`, `add_link`, `list_links` |

The tool descriptions instruct Claude to fetch `data_schema` + `definition`
before any data write, and to treat the D1 row as the source of truth.

### Frontend

- [src/features/ExtensionViewer.jsx](../src/features/ExtensionViewer.jsx) —
  sandboxed iframe renderer for snapshots. Loaded via App.jsx routing when
  the user clicks a Reports DB row. Applies Wasabi theme tokens to the
  iframe via `postMessage` if `theme_preference === "inherit"`.
- Reports DB row click → "Open report" banner in
  [src/views/RecordDetail.jsx](../src/views/RecordDetail.jsx) → ExtensionViewer.
- Reports DB itself is seeded by
  [worker/handlers/init.js](../worker/handlers/init.js) (REPORTS_BOOTSTRAP_VERSION).

---

## Source-folder pipeline

This is the path real data takes from physical source documents to a
rendered snapshot. **There is no committed parser script.** Each report
type's "parser" is Claude in a session with filesystem access — reading
source files, transforming, calling MCP. The transformation logic is
captured in `definition` (so future sessions can reproduce it), not as a
checked-in `.py` or `.js` file.

```
User shares source folder (local files only)
        ↓
Claude session reads files via filesystem tools
        ↓
Claude transforms to match the extension's data_schema
        ↓ (validates locally against the schema before pushing)
wasabi_extension_snapshots update OR generate
        ↓ (worker re-runs validation — 422 on failure)
Snapshot DATA stored in D1; rendered HTML written to R2
        ↓
ExtensionViewer renders from R2 with Wasabi theme handshake
```

**The Cloudflare worker never reads the source folder.** It only sees the
shaped, validated DATA payload that Claude produces.

---

## Authoring discipline (what makes the workflow durable)

1. **The HTML mockup file is bootstrap-only.** After it's translated into
   D1, do not re-edit it. The mockup becomes a historical reference, nothing
   more.
2. **All future edits happen on the D1 row via MCP.** Template logic, data
   schema, conceptual model — all on the D1 row.
3. **`definition` is mandatory at create time** and should be updated
   whenever the schema or calculation logic changes. A thin `definition`
   guarantees the next refresh session will re-derive logic from scratch
   and get something wrong.
4. **Schema first, data second.** A strict `data_schema` catches authoring
   errors at the worker boundary. If a class of bug ships, the first
   question should be "should the schema have rejected this?" — and the
   answer is usually yes.
5. **Don't iterate template + data in the same change.** Push template
   fix; verify; then push data fix; verify. Two re-renders, but the cause
   of each visible change is unambiguous.
6. **Discovery before push.** When updating data, produce a discovery
   report covering all source files first. Surface ambiguities as a
   structured interview, not a stream of one-off questions.
7. **Source folders are local; the worker only sees DATA.** This means
   the parser-as-Claude pattern is fine forever — there's no need to
   centralize parsers as worker code.

---

## Mockup files in the repo

`mockups/` holds the bootstrap HTML files that produced live D1 templates.
These are historical reference, not active iteration surfaces.

| File | Status | Notes |
|---|---|---|
| `mockups/inventory-production-v2-bootstrap.html` *(planned move)* | Vestigial reference | Produced `inventory-production-v2` (`ext_2c786a9dc7fd`). Currently at `Production_Schedule_Report.html` in repo root pending housekeeping. |

Do not edit files in `mockups/`. To change the live template, edit the D1
row via `wasabi_extensions update`.

---

## Schema version

Current: **v12** (2026-05-22) — added `definition` TEXT column on
`extensions` + `markets[*].sellThrough` (per-SKU `{avg, target}`) on the
inventory-production data_schema (template-level addition).

When adding new columns or tables to the extensions subsystem, follow the
standard pattern documented in `docs/06-deployment.md`:

1. Update `worker/schema.js` (canonical CREATE TABLE)
2. Add idempotent ALTER to `worker/handlers/init.js` migrations array
3. Add inline CREATE to the same migrations array (for first-boot databases)
4. Bump `CURRENT_SCHEMA_VERSION`
5. Deploy worker; first `/init` runs the migration

---

## Live template feature spec (inventory-production-v2)

Beyond the bootstrap workflow, the live `inventory-production-v2` template
has substantial domain-specific logic. Documented in full in
`memory/project_extensions_feature.md` §5; highlights:

- **Multi-pool stockout analysis** — per-SKU sim tracks tins · compliance
  labels · masterpacks (in tin-equivalents). Cover = min across pools.
  Binding pool named in cells.
- **Timeline-aware** — walks forward at target rate, adds shipments on
  their actual arrival dates, reports first stockout AND first recovery
  (with gap days). "No recovery scheduled" = new-order signal.
- **Card-style row UX** — each SKU is a click-to-expand card. Detail
  panel shows per-pool inventory + cover + suggested action.
- **Suggested actions** are production-lead-time based (~3mo first batch,
  ~5mo full PO, ~2.5mo direct), no shipping mode recommendations.
- **Pill filter** (Component Balance pills also filter Stockout Risk) —
  single SKU pill auto-expands the row; "All SKUs" force-collapses all.
- **Market tab order** is controlled by a `MARKET_ORDER` constant in the
  template (current: `OR · CA · NY · NV · HEMP`).

The `markets[*].sellThrough` schema field is required for any market that
should render the Stockout Risk section. Shape: `{[sku]: {avg, target}}`.

## Data Collection (`data_collection`)

Data Collection extensions are Wasabi-native input surfaces backed by
four extension-owned D1 tables. The **Inventory** extension (slug
`inventory-collection`) is the first live instance — iPad-optimized
weekly count workbooks per market that pull rows from a shared Master
Item Sheet and submit page-scoped fills as timestamped submissions.

### Data model

Four tables per Data Collection extension, all keyed by
`extensions.id` (the extension's row).

| table | purpose | key columns |
|---|---|---|
| `dc_items` | Master Item Sheet catalog | `sku`, `description`, `channel`, `markets` (JSON array), `type_key`, `vendor_ref` (Vendor CRM row id), `vendor_name`, `count_mode` (case/unit/weight), `case_size`, `weight_unit` |
| `dc_submissions` | one row per workbook page fill | `market`, `page`, `category`, `status` (draft/submitted), `counter_name`, `share_link_id`, `count_date`, `submitted_at` |
| `dc_submission_entries` | one row per counted item within a submission | `submission_id`, `item_id`, `count_mode`, `cases_count`, `units_count`, `weight_value`, `case_size_snapshot`, `total_units` |
| `dc_share_links` | anonymous submission tokens for iPads without accounts | `token` (unique), `label`, `scope_market`, `scope_page`, `submission_limit`, `submission_count`, `revoked_at` |

Unique index on `(submission_id, item_id)` in `dc_submission_entries`
enforces at most one entry per item per submission (upsert-per-item is
the client's write pattern).

### Extension config (`extensions.ext_config`)

JSON blob per DC extension. For `inventory-collection`:

```json
{
  "vendor_crm_page_id": "b44ace79-05fb-4402-bcba-1f52cef2af97",
  "vendor_name_field": "Vendor Name",
  "markets":    [{"key":"OR","label":"Drops OR"}, ...],
  "channels":   [{"key":"drops","label":"Drops"}, {"key":"smoky","label":"Smoky Flower"}],
  "pages":      [{"key":"packaging","label":"Packaging","has_categories":true}, ...],
  "item_types": [{"key":"tins","label":"Tins"}, ...]
}
```

The frontend reads `ext_config` on load and drives every dimension of
the UI from it — no hardcoded market/page/category lists in the React
components.

### Worker routes

| method + path | purpose | auth |
|---|---|---|
| `GET /data-collection/:extRef/items` | list items (filters: channel, market, type, archived, q) | JWT |
| `POST /data-collection/:extRef/items` | create item | JWT |
| `GET/PATCH/DELETE /data-collection/items/:id` | CRUD one item | JWT |
| `GET/POST /data-collection/:extRef/submissions` | list / create submission | JWT |
| `GET/PATCH/DELETE /data-collection/submissions/:id` | CRUD one submission | JWT |
| `GET /data-collection/submissions/:id/csv` | CSV export | JWT |
| `POST /data-collection/submissions/:id/entries` | upsert entry by item_id | JWT |
| `DELETE /data-collection/entries/:id` | delete entry | JWT |
| `GET/POST /data-collection/:extRef/share-links` | list / create share link | JWT |
| `PATCH/DELETE /data-collection/share-links/:id` | update (revoke) / delete | JWT |
| `GET /collect/:slug?t=<token>` | public: extension context + scoped items | share-link token |
| `POST /collect/:slug/submissions?t=<token>` | public: anonymous submission | share-link token |

All handlers live in [worker/handlers/data-collection.js](../worker/handlers/data-collection.js).

### Frontend routing

Data Collection extensions render via
[src/features/data-collection/DataCollectionView.jsx](../src/features/data-collection/DataCollectionView.jsx),
not `ExtensionViewer`. App.jsx picks the component based on the page's
`page_type`:

- `data_collection_extension` → `DataCollectionView`
- (Reports DB row with a snapshot) → `ExtensionViewer`

The sidebar page for the Inventory extension is bootstrapped in
`init.js` with id `system_inventory_collection`, page_type
`data_collection_extension`, parent `62fcde4f-…` (the existing Inventory
Management workspace), config carrying `extension_slug:
"inventory-collection"`.

The public `/collect/:slug` route bypasses auth via a short-circuit in
[main.jsx](../src/main.jsx) — the route guard swaps the App root for
`DcCollectView` before the auth stack runs.

### Component tree (all files in `src/features/data-collection/`)

- `DataCollectionView.jsx` — top-level workspace switcher (tiles /
  master / history / market workbook)
- `DcTilesLanding.jsx` — landing tiles (Master Item Sheet, Inventory
  History, market workbook tiles with progress bars)
- `DcMasterItemSheet.jsx` — read-only catalog table + toolbar
- `DcItemDrawer.jsx` — Wasabi-style side drawer for editing / creating
  an item (SKU, description, channel, markets multi-select, type,
  vendor combobox, counted-as toggle, conditional units-per-case /
  weight-unit / none field)
- `DcVendorCombobox.jsx` — searchable vendor picker backed by the
  workspace Vendor CRM (`listRows(vendorPageId)`); "+ New vendor" posts
  a new row to the CRM
- `DcInventoryHistory.jsx` — row-card list of every saved submission
  with download CSV / edit / delete per card; delete opens a
  confirmation modal
- `DcWorkbook.jsx` — market workbook fill UI with page + category pill
  tabs, per-item-type sections, debounced auto-save on every input
  change, sticky footer with counter / date / save state / submit
- `DcShareLinksModal.jsx` — create / list / revoke share links
- `DcCollectView.jsx` — public share-link submission surface (no auth)
- `dcHelpers.js` — colors, labels, `computeTotal()`, market chip helper

### Theme reactivity (styles Proxy)

DC components use a Proxy pattern so `styles.foo` recomputes from the
current mutable `C` token object on every access — theme cycling with
`applyTheme()` mutates C in place, and the Proxy hits `buildStyles()`
fresh. Main components add `useTheme()` to trigger re-renders on cycle.
Direct `const styles = {…}` at module scope would freeze theme values
at import time and produce stuck accents on switch.

```js
function buildStyles() { return { root: { color: C.text } /* ... */ }; }
const styles = new Proxy({}, { get: (_, k) => buildStyles()[k] });
```

### The `type` guard

- `handleGenerateSnapshot` refuses to run on `data_collection` extensions
  (400 with a clear error message).
- `handleDeleteExtension` on a `data_collection` extension refuses if any
  submissions exist; empty catalog + orphan share links are dropped
  automatically. Archive instead of deleting an extension with history.

### Bootstrap versioning gotcha

Both bootstraps (Reports DB, Inventory extension) live inside the "full
init" block of `handleInit`, which is gated by a fast-path early-return:

```js
if (row?.value === CURRENT_SCHEMA_VERSION) return jsonResponse({ ok: true, ... });
```

Bumping just `INVENTORY_BOOTSTRAP_VERSION` from `v1` to `v2` does NOT
re-run the bootstrap on an existing DB because the schema-version
fast-path short-circuits before reaching the bootstrap block. To
actually refresh `ext_config`, either PATCH the extension row directly
(`PATCH /extensions/inventory-collection`) or bump
`CURRENT_SCHEMA_VERSION` to force a full init.

## Open work

### MCP-Generated (`inventory-production-v2` etc.)

Tracked in `memory/project_extensions_feature.md` § "What's open for next
session." Highlights:

- **Author the `definition` field** on `inventory-production-v2` (still has
  a smoke-test placeholder). Highest leverage for next-session continuity.
- **Tighten the `data_schema`** to constrain `shipments[items]` shape —
  required fields, enums for `method` / `status` / `air_class` /
  `ocean_class`. Until done, bad shipment shapes pass server validation.
- **`wasabi_extensions preview` action** (render template + sample_data
  without persisting a snapshot) is a planned but not-yet-implemented
  developer convenience.

### Data Collection (`inventory-collection`)

Tracked in `memory/project_data_collection_extension.md`. Highlights:

- **Seed the Master Item Sheet.** Empty on landing; needs the OR SKU
  list (Tins × supplier, Masterpacks × pack size, Compliance Labels,
  Tamper Seals, Cover-up Labels, Drams, Paper Packages) plus Kitchen +
  Marketing rows. Options: hand-add via the drawer, or programmatic
  seed via `dcCreateItem` calls in a one-off script.
- **Phase 6 — wire `inventory-production-v2` to pull from `dc_*` tables**
  instead of parsing CSVs. Path B per the plan: MCP still pushes the
  DATA blob to the report, but the source is `dc_submissions` +
  `dc_submission_entries` queried via `wasabi_data` instead of Claude
  parsing CSV files each week.
- **iPad hardware test.** All UX was built against a browser at iPad
  dimensions; needs a real hardware pass for touch target sizes,
  keyboard behavior, share-link authentication flow.
- **Admin-only Share Links visibility.** Anyone with the extension open
  can currently create share links from the top-bar button; scope to
  workspace admins before wider rollout.
- **Master Item Sheet: "+ New Item" mid-count.** Deferred per V1 scope
  (Graham: "Locked for now. We will build after V1 is live"). Requires
  a modal accessible from the workbook fill UI that creates the item
  in the master, then makes it available in the current fill session.
- **Editing a submitted history record.** The edit pencil on history
  cards currently shows a stub alert. Wire it to reopen the workbook
  in edit mode with counts pre-filled, and let save either update the
  same submission or spawn a new one.
- **Bootstrap gating.** See "Bootstrap versioning gotcha" above. Options
  for a future dev session:
  1. Move Reports + Inventory bootstraps ABOVE the schema-version
     fast-path (small cost per init).
  2. Track bootstrap versions separately in `connections` with their
     own version comparison, independent of `schema_version`.
