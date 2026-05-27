# mockups/

Bootstrap and historical reference artifacts for Wasabi Extensions
(custom-coded reports). These are **not** the source of truth for any
live report — they are design artifacts.

## What lives here

For each extension (report type) registered in Wasabi, a subfolder
holds:

- The original self-contained `.html` mockup used to bootstrap the
  template into D1 (`bootstrap.html`)
- Dated snapshots/checkpoints from the design iteration phase
- Any reference notes (reconciliation audits, data-shape memos) that
  helped author the template

After bootstrap, **the D1 row is the source of truth.** All
visual/schema/definition edits happen on the D1 row via the
`wasabi_extensions` MCP tool. The files in this directory should not be
re-edited.

If you find yourself opening one of these files to "fix the report" —
stop. Read `docs/18-extensions.md` and edit the D1 row instead.

## Current subfolders

| Folder | Extension | Notes |
|---|---|---|
| `inventory-production/` | `inventory-production-v2` (`ext_2c786a9dc7fd`) | Original bootstrap HTML + a dated checkpoint + PO reconciliation audit notes |

## Why these aren't deleted

Two reasons:

1. **Historical reference.** A bootstrap mockup captures the
   author's intent at the moment a template was created. Useful for
   archaeology when debugging a template that's drifted.
2. **Definition-authoring fodder.** Notes like reconciliation audits
   contain domain knowledge that should eventually land in the D1
   extension's `definition` field. Until that's done, they live here as
   raw working knowledge.

Once a definition is fully authored on the D1 row, the corresponding
notes file can be deleted (with the user's explicit permission).
