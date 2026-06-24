# Forms Feature — Plan

Living plan document for the Forms feature. Captures decisions agreed
during design discussion; gets updated as we make more calls. Open
questions and v2 deferrals listed at the bottom.

Status: **v1 shipped 2026-06-17** (commit `fd45000`). Worker version
`37761a8a-bcce-41af-97a7-1bdee9ae6156` is live with the three new D1
tables migrated. Frontend live on Cloudflare Pages.

> Note: v1 shipped as a single PR rather than the planned 3-ship cadence —
> the user explicitly opted into batching all phases when ready to test
> end-to-end live.

---

## What we're building

Two parallel uses of "Form" in one feature:

1. **Today's use (preserved):** A Form is a quick way to create a new
   record on a table.
2. **The new use:** A Form can be attached to an *existing* record. The
   user fills it out; the answers live on that record as a "submission."
   A record can have many forms attached, and the same form can be
   filled out multiple times on the same record (e.g. a weekly status
   update with 23 fills over time).

Both uses share the same form definition. One form, two contexts.

---

## Mental model

### Where form data lives

- A **Form Definition** is a first-class object on a table, like a
  column. A table has a list of forms.
- A **Submission** is one filled-out instance of a form on a specific
  record. It stores the answers for form-only fields as its own blob.
- A form **field** can optionally be **linked to a column** on the
  table. Linked fields are not stored in the submission — they read
  live from the column. The column is the single source of truth for
  linked fields.

### Linked-field overwrite behavior

The linked field and the column are the same piece of data, shown in
two places. Editing either updates both. No drift, no history of past
column values inside submissions.

Implication for repeating forms: if a form is filled many times and
has linked fields, every submission shows the current column value
for the linked field — there's no per-submission snapshot of what the
column was at fill time. (Open question below: do we restrict linked
fields on multi-fill forms, or accept this and let users discover it?)

### Form Type — single-instance vs. repeating

Every form has a **Form Type**, chosen when it's created in the
designer:

- **Single-instance** — can be connected to a record once. Filling
  it submits. Re-opening = editing the existing submission. Use
  case: Project Brief, Approval Sign-Off.
- **Repeating** — can be filled many times per record. Each fill
  creates a new submission. Use case: Weekly Status Update,
  Recurring Check-in.

The picker lives at the top of the designer next to form name and
description. Whether the type can be changed after submissions
exist is a v2 question — there are gotchas around what happens to
existing submissions when you change type.

### Multiplicity

- A record can have many form connections (different forms attached).
- A repeating form can carry many submissions per record.

---

## Designer location — the "hub" model

The existing Form view tab on a table becomes a **directory of all
forms defined on that table**.

- Click the Form tab → see a list of forms (name, field count, fill
  count, click-into).
- Click "+ New form" → start a fresh blank form (opens directly in
  designer mode).
- Click an existing form → open it (default: fill mode; "Edit form"
  button in the corner for users with edit rights).
- In **design mode**: fields become drag-to-reorder, each has a
  settings panel, "+ Add field" sits at the bottom, name and
  description inputs at the top.
- "Done" → back to fill mode. "Back" → return to the hub.

The same hub is the **picker** used in the record drawer's Forms tab —
forms are defined once on the table, reachable from two surfaces:

- Table-level Form tab → use to create new records.
- Record-drawer Forms tab → attach to the current record.

There is one Form view tab per table, never more. Multiplicity lives
inside the hub, not in the tab row.

---

## Designer UI

### Layout

Form-level controls at the top:

- Form name (also serves as the form's label everywhere it appears)
- Description (optional, plain text, shown above the form when filling)
- **Form Type** — single-instance or repeating (see Mental Model section)

Below that, a **vertical stack of blocks** — the form fields and layout
blocks in display order.

A **"+ Add" button** at the bottom of the stack, styled in the Wasabi
pill style (matches the rest of the app). Clicking it opens a
single-select dropdown of building blocks.

### Reorder gesture

Drag-to-reorder via a left-edge handle on each block. Same handle and
feel as the row-drag we shipped in commit `e32ac48` for table rows —
deliberately consistent.

### The "+ Add" dropdown

Three sections in the dropdown, each with its own header:

**1. Insert from column**

One entry that opens a sub-list of every column on the table. Pick a
column → you get a field pre-labeled with the column's name, pre-typed
to match the column's type, auto-linked to that column. Same end state
as creating a blank field then linking it manually, collapsed into one
gesture.

**2. Form fields** (16 entries in v1)

| Block | Notes |
| --- | --- |
| Short text | single-line input |
| Long text | multi-line textarea |
| Number | numeric input |
| Date | single calendar picker |
| Date range | two calendars |
| Single-select | pick one option |
| Multi-select | pick many options |
| Status | single-select with colored pills |
| Checkbox | yes/no toggle |
| URL | text input with URL validation |
| Email | text input with email validation |
| Phone | text input with phone formatting |
| Person | picker against the team directory |
| Linked record | picker against another table's rows |
| File upload | uploads to R2, attaches to submission |
| Figma file | pasted Figma URL becomes pinned file |

Short text and Long text are intentionally separate entries — the
choice is known at insert time and not worth a second-step toggle.

**3. Layout** (3 entries in v1)

- Section header — bigger, bolder label between groups of fields.
- Description text — paragraph of explanatory copy, no input.
- Divider — thin horizontal line.

### What happens after picking a block

The block is inserted into the form at whatever position the "+" was
clicked, and **immediately opens in its settings panel** so the user
can customize without an extra click.

### Per-field settings panel

For every input block, the panel exposes:

- **Label** — the question/prompt the filler sees
- **Type** — the block type (locked if linked to a column)
- **Link to column** — dropdown listing every column on the table.
  Default: "None — form-only." Picking a column auto-matches the
  type and locks it.
- **Required** — yes/no toggle
- **Helper text** — small grey explanation below the field
- **Placeholder** — what the field shows before the user types
- **Default value** — what the field pre-fills with

For Section header / Description / Divider, the panel is smaller (just
the label/text content).

### Behavior when a linked column is deleted

The field doesn't break. It reverts to form-only with a small warning
badge in the designer saying "linked column was removed." The user can
either point it at a different column or leave it form-only.

---

---

## The record drawer's Forms tab

Lives between Comments and Files. Modeled on the Files tab's
"connected things" pattern.

Top of the tab: a **"Connect a form"** dropdown listing every form
defined on this table.

Below that, **three sorted buckets** (top to bottom):

### Drafts

Forms with an in-progress fill that hasn't been submitted yet. Each
card shows:

- The form name
- A draft icon
- The owner's name (the user who started the draft) and how long ago
- Click to continue the draft (per the fill-flow described below)

The drafts bucket only appears when at least one draft exists.

### Empty

Forms connected but with no submissions and no in-progress draft. Each
card shows:

- The form name
- "Not yet filled" (single-instance) or "No submissions yet" (repeating)
- Click to start filling (which creates a draft on first auto-save)

### Submitted

Forms with at least one completed submission. Two card shapes:

- **Single-instance:** "Submitted [date] by [name]." Click to read.
- **Repeating:** Shows the count ("4 submissions"), the latest date,
  a "+ Submit again" button, and an expand chevron to view all the
  submissions stacked underneath with their own dates.

### Where a form lives when it's in multiple states

A single-instance form is always in exactly one bucket. A repeating
form with both an active draft AND past submissions appears in
**both** Drafts (the active card to continue) and Submitted (the
history card with the count). Each surface serves a different action,
so the duplication is deliberate.

---

## The fill flow

Clicking a form in the record drawer's Forms tab triggers this
sequence:

1. The drawer closes.
2. The main panel switches to the table's Form tab and opens that
   specific form, with the current record locked in as context.
3. The form renders as a **single scrollable screen** — all fields
   stacked vertically as designed.
4. A **forms navigator** (visible by default, narrow left column,
   ~180–200px) lists every form defined on this table. The current
   form is highlighted. Clicking another form auto-saves the
   current draft and switches.
5. **Auto-save** is **debounced** — saves fire ~1 second after
   typing stops. A small "Draft saved" indicator next to the form
   name briefly fades in to confirm. Navigating away or closing the
   tab triggers a final save.
6. **Save button** at the bottom of the form (not sticky — sits
   after the last field). Same accent-pill style as today's
   "Create Record" button. No competing Cancel/Reset buttons.
7. Required fields are checked **only when Save is clicked**:
   - Empty required fields get a red outline.
   - Inline message below each: "Please fill this in."
   - Summary message just above the Save button.
   - Page scrolls to the first empty required field.
8. Type validation (URL, Email, Phone format) fires the same way —
   on save only.
9. **On successful save:**
   - The submission is recorded.
   - The drawer re-opens on the record's Forms tab.
   - The new submission is highlighted briefly in the Submitted
     bucket so the user can see it landed.
   - Any draft state on that connection is cleared.

### The fill screen layout

```
┌───────────────────────────────────────────────────────────────┐
│ ▶ Filling for: New York Launch                          [×]   │ ← sticky
├───────────────────────────────────────────────────────────────┤
│ FORMS      │  Production Brief                                │
│ ─────────  │  Detailed brief covering scope, channels, etc.   │
│ ▸ Project  │  ──────────────────────────────────────────────  │
│   Brief    │                                                  │
│            │  PROJECT TITLE *                                 │
│   Status   │  ┌─────────────────────────────────────────────┐ │
│   Update   │  │ New York Launch                              │ │
│            │  └─────────────────────────────────────────────┘ │
│   Approval │                                                  │
│   Sign-off │  …                                               │
│            │                                                  │
│            │  ┌──────────────────────────────────────────────┐│
│            │  │              Save submission                  ││
│            │  └──────────────────────────────────────────────┘│
└───────────────────────────────────────────────────────────────┘
```

- **Sticky context bar** at the top — always shows which record
  this fill is attached to. Clicking `[×]` clears the record
  context; the form then behaves as today's create-new-record
  Form view.
- **Forms navigator** on the left (visible by default).
- **Main column** capped at ~640px wide for readability. Form
  name + description at the top, then fields stacked, then Save.
- **Fields render in Wasabi's existing input styles** — uppercase
  label above, cream-tinted pill input below, red `*` for required.
  Same visual vocabulary as today's Form view; no new patterns.

### Read-only mode

Triggered when the viewer can't edit the submission/draft:

- Someone else's draft (any viewer who isn't the owner)
- A submitted form (unless the viewer has edit rights — see
  "editing a submitted form" open question)

Layout identical to the fill screen, but:

- Inputs render as displayed values (no borders, no cursor).
- The sticky bar at the top swaps to: "Submitted [date] by [name]"
  or "Draft started by [name]."
- Save button replaced with a "Back to record" link.
- (Future) For users with edit rights: an "Edit" button to flip
  into edit mode.

### Draft visibility and ownership

- Drafts are **visible to all users** with access to the record.
- Each draft has an **owner** — the user who started it. The owner
  is shown on the draft card.
- **Only the owner can continue editing their draft.** Other users
  can see the card and peek at what's been filled, but the form
  opens read-only for them. Collaborative draft editing is a v2
  consideration.
- For repeating forms, multiple users can each have their own
  in-progress draft on the same form (each draft is independent and
  owned by whoever started it).

---

## Storage shape

Three new D1 tables.

### `form_definitions`

One row per form. Created and edited via the designer.

| column | type | purpose |
| --- | --- | --- |
| `id` | TEXT | primary key |
| `table_id` | TEXT | the page (table) this form belongs to |
| `name` | TEXT | shown in tabs, picker, cards |
| `description` | TEXT | optional, shown above form when filling |
| `form_type` | TEXT | `single_instance` or `repeating` |
| `fields` | TEXT (JSON) | array of field definitions (see below) |
| `sort_order` | INTEGER | hub display order |
| `created_at`, `updated_at` | TEXT | timestamps |
| `created_by` | TEXT | user id |

`fields` JSON shape (each entry):
```json
{
  "id": "fld_abc",
  "kind": "field" | "layout",
  "type": "short_text" | "long_text" | "number" | "date" | ... | "section_header" | "divider",
  "label": "Project Title",
  "linked_column_id": "col_xyz" | null,
  "required": false,
  "helper_text": "",
  "placeholder": "",
  "default_value": null,
  "options": [...]
}
```

### `form_connections`

One row per "this form is attached to this record" relationship.
The Empty bucket is populated by querying connections with zero
submissions.

| column | type | purpose |
| --- | --- | --- |
| `id` | TEXT | primary key |
| `form_id` | TEXT | references `form_definitions.id` |
| `record_id` | TEXT | references `table_rows.id` |
| `table_id` | TEXT | denormalized for fast bucket queries |
| `connected_at` | TEXT | timestamp |
| `connected_by` | TEXT | user id |

Indexes: `(record_id)`, `(form_id, record_id)`.

### `form_submissions`

One row per actual fill — covers both drafts and submitted.

| column | type | purpose |
| --- | --- | --- |
| `id` | TEXT | primary key |
| `connection_id` | TEXT | references `form_connections.id` |
| `form_id` | TEXT | denormalized (so we can read submissions by form without joining) |
| `record_id` | TEXT | denormalized |
| `status` | TEXT | `draft` or `submitted` |
| `values` | TEXT (JSON) | answers keyed by field id |
| `draft_owner_id` | TEXT | set when `status='draft'` |
| `submitted_at` | TEXT | when status flipped to `submitted` |
| `submitted_by` | TEXT | user id |
| `edited_at` | TEXT | most recent edit after submission |
| `edited_by` | TEXT | user id of most recent editor |
| `created_at`, `updated_at` | TEXT | timestamps |

Indexes: `(connection_id)`, `(record_id, status)`,
`(record_id, form_id, status)`.

### Linked field values are not stored

`values` only contains answers for form-only fields. Linked fields
are read live from the record's column every time the submission is
opened — keeps the column as the single source of truth.

If a field's linked column is deleted, the field reverts to
form-only on read (no data loss; the form just displays a warning
badge in the designer).

### Auto-save semantics

- Typing in a form: debounced ~1s after last keystroke triggers
  `PATCH /form-submissions/:id` with the in-progress `values`.
- Navigate-away / close: forces an immediate save.
- A submission row gets created on first keystroke (status=draft).
- "Save submission" flips `status` to `submitted` and stamps
  `submitted_at` / `submitted_by`.

---

## v1 scope summary

- Hub model on the existing Form view tab
- Multiple form definitions per table
- Form Type picker per form (single-instance vs. repeating)
- Multiple form connections per record (and multiple submissions for
  repeating forms)
- Designer with 16 form-field types + 3 layout blocks + the
  "Insert from column" shortcut
- Per-field settings (label, type, link-to-column, required, helper,
  placeholder, default)
- Bidirectional sync for linked fields (column is source of truth)
- Drag-to-reorder fields
- Forms tab in record drawer between Comments and Files, with three
  buckets: Drafts / Empty / Submitted
- Auto-save drafts during fill; drafts visible to all with owner shown
- Fill flow: close drawer → open form on main panel → save → re-open
  drawer on Forms tab with new submission highlighted

---

## Open questions (still to resolve)

1. **Surfacing form data to other systems** — automations, Wasabi
   AI, neurons. Form-only field values need to be readable by these
   systems. Storage shape (below) is already designed to support
   this; the actual wiring is v2.

### Resolved

- ~~Single-instance vs. repeating~~ — both, picked at form creation.
- ~~Forms tab attachment flow~~ — clicking a connected form opens
  fill; repeating forms have "+ Submit again" inline.
- ~~Where the draft lives during fill~~ — auto-saved per-connection,
  owner is the user who started it.
- ~~Post-save flow~~ — re-opens record drawer on Forms tab with new
  submission highlighted.
- ~~Draft edit permissions~~ — owner-only for v1.
- ~~Forms navigator on the fill screen~~ — visible by default.
- ~~Context bar `[×]` behavior~~ — clears record context; form
  behaves as create-new-record mode.
- ~~Auto-save trigger~~ — debounced (~1s after typing stops); save
  also fires on navigate-away.
- ~~Editing a submitted form~~ — editable by the original submitter
  and admins; "Edited [date] by [name]" stamp appears below the
  original submitted-on stamp.
- ~~Disconnect an Empty form~~ — anyone with edit rights, no
  confirmation.
- ~~Discard own draft~~ — anyone, no confirmation.
- ~~Discard someone else's draft~~ — admins only, confirmation
  prompt.
- ~~Delete a submission~~ — anyone with edit rights, confirmation
  prompt ("This can't be undone"). No undo.
- ~~Sorting in Submitted bucket~~ — most recent first, not
  configurable.
- ~~Form definition CRUD~~ — anyone with edit rights to the table.
- ~~Required field UX at design time~~ — red asterisk after the
  label.
- ~~Form Type switching after submissions exist~~ — blocked. The
  picker is disabled once any submission exists.

---

## Deferred to v2

Captured here so they're not lost:

- **Conditional show/hide** — "Show this field only if Status = X."
  Powerful but needs a logic-editing UI, and forms get hard to test.
- **Repeating sections** — "Add another line item" for nested rows of
  data. Storage gets gnarly (arrays of sub-blobs).
- **Rating / scale** — 1-to-5 stars or thumbs up/down. Useful for
  feedback forms; not central yet.
- **Signature** — a real drawn or typed signature for approvals.
  Worth doing eventually but needs its own component.
- **Multi-page forms** — splitting a long form across multiple steps.
  Adds navigation, progress, partial save.
- **Hidden / auto-filled fields** — "Submitter name" filled silently.
  Just-as-easy to surface as read-only fields if needed.
- **Image / banner block** — header imagery. Nice-to-have, no
  blocking dependency on anything else.

---

## Implementation — shipped 2026-06-17 (single PR)

All three planned phases were shipped together in commit `fd45000`.
Original three-ship plan retained below for reference (each row is what
*was* in scope; everything below the heading actually shipped).

**Files created:**
- `worker/handlers/forms.js` — backend CRUD for forms, connections, submissions
- `src/views/forms/FormsHub.jsx` — replaces the old auto-Form view; hub/designer/filler orchestrator
- `src/views/forms/FormDesigner.jsx` — inline editor
- `src/views/forms/FormFiller.jsx` — fill screen with sticky context bar + navigator
- `src/views/forms/BlockTypePicker.jsx` — "+ Add" dropdown
- `src/views/forms/FieldSettings.jsx` — per-field settings panel
- `src/views/forms/FieldRenderer.jsx` — per-type input renderer
- `src/views/forms/RecordFormsTab.jsx` — new tab inside `RecordDrawer` and `RecordDetail`
- `src/views/forms/formTypes.js` — block taxonomy + column-type mapping

**Files modified:**
- `worker.js` — wired forms routes
- `worker/handlers/init.js` — added 3 table migrations
- `src/lib/api.js` — `listForms`, `createForm`, `updateForm`, `deleteForm`,
  `listFormConnectionsForRecord`, `createFormConnection`,
  `deleteFormConnection`, `createFormSubmission`, `updateFormSubmission`,
  `deleteFormSubmission`
- `src/views/Form.jsx` — now a thin wrapper that listens for
  `wasabi:fill-form` events and threads `fillContext` into `FormsHub`
- `src/features/RecordDrawer.jsx` — added Forms tab between Comments and Files
- `src/views/RecordDetail.jsx` — same, for the table-view detail drawer

**Naming gotcha resolved during build:** the forms-connection
DELETE handler was renamed `handleDeleteFormConnection` to avoid
colliding with the existing `handleDeleteConnection` (API-key
deletion) imported in `worker.js`. Easy mistake to repeat — if a
future session adds another "connection" handler, prefix with the
domain (`form_`, `oauth_`, etc.).

**Event-based wiring** (not the most elegant, but works without a new
context provider):
- `RecordFormsTab` dispatches `wasabi:fill-form` when the user clicks a
  card → `Form.jsx` listens → sets `fillContext` → `FormsHub` enters
  filler mode.
- `RecordFormsTab` also dispatches `wasabi:switch-to-form-view` so the
  host can route to the Form tab. This route hint is NOT wired to a
  page-level listener yet; the user has to click the Form tab manually
  for now. **First polish target.**
- `FormsHub` dispatches `wasabi:form-submitted` after a successful save
  so `RecordFormsTab` can re-fetch.

---

## Implementation plan — three ships (original, for reference)

The feature is big enough that shipping it as one PR is asking for
trouble. Three sequential ships, each independently testable:

### Ship 1 — Foundation: data layer + designer

What lands:

- Three new D1 tables (`form_definitions`, `form_connections`,
  `form_submissions`) with init.js migrations.
- Worker endpoints: CRUD for form definitions, list forms per table.
- Frontend API helpers.
- The existing Form view (`src/views/Form.jsx`) becomes the **hub** —
  shows a list of forms defined on the table, "+ New form" button,
  click-into.
- Click "+ New form" or an existing form's edit pencil to enter the
  **designer**: form name, description, Form Type picker, vertical
  block stack, "+ Add" dropdown with the three sections (Insert
  from column / Form fields / Layout), per-field settings panel,
  drag-to-reorder via left-edge handle.
- Save / Cancel buttons for form definition edits.

What's NOT in Ship 1: the fill flow, the record drawer's Forms tab.
End users can't fill forms yet — they can only build them. Tests via
the worker endpoints + a quick build-it-then-edit-it manual pass.

Risk: low. Mostly CRUD plumbing + designer UI. The drag-to-reorder
pattern is already proven (we shipped it for table rows in `e32ac48`).
The new tables are isolated — no foreign keys into existing schema
except `table_id` and `record_id` references.

**Sizing:** ~3–5 sessions of focused work.

### Ship 2 — Fill flow at table level

What lands:

- The fill screen visual (sticky context bar, forms navigator on
  left, main column with fields stacked).
- All 16 field types render in fill mode with correct inputs.
- Debounced auto-save → creates a `form_submissions` row with
  `status='draft'` on first keystroke; subsequent PATCHes update
  `values`.
- "Draft saved" indicator.
- Save submission → flips `status` to `submitted`, stamps timestamps.
- Required-field validation on Save.
- When opened from the Form view tab without a record context, Save
  creates a NEW record (preserving today's behavior) and attaches the
  submission to that new record.
- Read-only mode for already-submitted forms (anyone viewing) and
  for someone-else's drafts.
- Edit button on submitted forms (shown to submitter and admins),
  which flips back to fill mode; saving updates the existing
  submission row with `edited_at`/`edited_by`.

What's NOT in Ship 2: the record drawer's Forms tab, bucket UI,
"Connect a form" picker, "Submit again" for repeating forms. End
users CAN use a form to create a new record (current behavior, but
better-designed).

Risk: moderate. Lots of field types to render correctly. Auto-save
needs to handle network errors gracefully without losing draft
state. Read-only mode adds branching. The Form view replacing today's
behavior is the biggest user-visible change in this ship — need to
preserve the "create-new-record" flow precisely.

**Sizing:** ~5–8 sessions.

### Ship 3 — Record drawer attachment + lifecycle

What lands:

- New "Forms" tab in `RecordDrawer` between Comments and Files.
- "Connect a form" dropdown listing every form on the table.
- Three buckets (Drafts / Empty / Submitted) with their card
  layouts.
- Repeating-form card with count badge + "+ Submit again" + expand
  to show submission list.
- Click a card → close drawer → open form in main panel with record
  context locked in.
- Post-save: drawer re-opens on Forms tab with new submission
  highlighted.
- Submission lifecycle gestures:
  - Disconnect an Empty form (no confirmation).
  - Discard own draft.
  - Discard someone else's draft (admin, confirmation).
  - Delete a submission (confirmation, no undo).
- Form Type switch lock (designer disables picker once any
  submission exists).
- Linked-column-removed warning badge in designer.

What's NOT in Ship 3: the v2 deferrals (conditional logic, repeating
sections, etc.); collaborative draft editing; surfacing form data to
automations/AI/neurons.

Risk: highest. The Forms tab adds state to `RecordDrawer` which is
already complex. Bucket queries need to be efficient (could be slow
on records with many connections). The close-drawer-then-reopen
post-save dance needs to feel smooth, not jarring. Edge cases:
multiple drafts on the same repeating form by different users; what
happens to drafts when the form definition changes between draft
creation and submit.

**Sizing:** ~6–10 sessions.

### Cross-cutting risks

- **Linked field bidirectional sync.** Submissions read live column
  values. If the column is renamed/retyped/deleted, the form needs
  to handle it gracefully. Worker-side validation + frontend
  warning badge.
- **Race conditions on auto-save.** Two debounced saves overlapping
  could clobber. Worker uses last-write-wins on the submission row;
  values are PATCHed wholesale to avoid partial state.
- **`field id` stability.** Fields use generated `id`s in the
  definition's JSON. When fields are deleted, their answers in
  existing submissions become orphaned. Decision: orphaned answers
  are kept in `values` (no schema enforcement) so re-adding a field
  with the same id surfaces its old answers. Field ids are never
  reused for new fields (UUIDs).
- **The existing `Form.jsx` is rewritten in Ship 1.** It currently
  has callers (e.g. PageShell renders it for `form` view type).
  Need to preserve those entry points and only change internals
  during Ship 1. The "create new record" flow that's wired through
  `onCreate` moves to Ship 2.

---

## Change log

- 2026-06-04 — initial draft, designer UI agreed (hub model, building
  blocks, "+ Add" dropdown, drag-to-reorder, per-field settings).
- 2026-06-04 — added Form Type picker (single-instance vs. repeating);
  drafted record-drawer Forms tab with three buckets (Drafts / Empty /
  Submitted) and repeating-form expanded card UX; drafted fill flow
  (close drawer → open in Form tab → save → re-open drawer with
  highlight); confirmed auto-save drafts visible to all with owner
  shown; required check fires on Save only.
- 2026-06-04 — fill screen visual layout agreed: sticky context bar,
  forms navigator visible by default (~180–200px left), main column
  ~640px wide with Wasabi's existing input styles; debounced auto-save
  with "Draft saved" indicator; `[×]` on context bar clears record
  context; required-field error UX (red outlines, inline messages,
  scroll to first); drafted read-only mode for someone-else's-drafts
  and submitted forms.
- 2026-06-17 — **v1 shipped** in commit `fd45000`. Single-PR delivery
  rather than the planned three-ship cadence (user opted into batching).
  Frontend live on Cloudflare Pages; worker version
  `37761a8a-bcce-41af-97a7-1bdee9ae6156` deployed with the three D1
  table migrations applied. Open follow-ups: "Switch to Form view"
  route hint not wired to a page-level listener (user must click the
  Form tab manually after initiating fill from drawer); Person and
  Linked-record pickers are plain text inputs in v1; File upload is a
  placeholder.
- 2026-06-04 — final batch of cleanup resolutions: submissions editable
  by original submitter and admins with edit stamp; disconnect Empty
  (no confirm), discard own draft (no confirm), discard others' draft
  (admin + confirm), delete submission (confirm, no undo); sort
  Submitted bucket most-recent-first; form definitions editable by
  anyone with table edit rights; required-field design-time UX uses
  red asterisk; Form Type switching blocked once any submission exists;
  storage shape locked in (form_definitions, form_connections,
  form_submissions); implementation plan split into three ships.
