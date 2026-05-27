# PO Reconciliation — Production Schedule Report

**Date:** May 12, 2026 (updated May 13 — added PO-296 / PO-297 verification)
**Scope:** Reconciled all 20 PO PDFs in `~/Desktop/Drops/Production Documents/POs` plus `Updated Treeform Drops Tin Priority List V6.xlsx` against `Production_Schedule_Report.html`.
**Verdict:** Mostly clean. **4 master-pack POs were mis-categorized as tins**, and **OR-816 had wrong SKU values** on top of that — all fixed and verified.

---

## What matches ✓

All 20 POs from the PDF folder are referenced in the report. Headline totals reconcile:

| PO | Market | Type | PDF total | Report total | Match |
|---|---|---|---|---|---|
| 0000296 | CA | DS Tin (11 SKUs) | 1,381,200 | 1,381,200 across B1+B2+B5 | ✓ |
| 0000297 | CA | D20 Tin (6 SKUs) | 60,000 | 60,000 in B5 | ✓ |
| 0000303 | CA | DS Tin (4 SKUs) | 48,400 | 48,400 | ✓ |
| 0000754 | OR | DS Tin (11 SKUs) | 710,000 | 710,000 across B1–B5 | ✓ |
| 0000756 | OR | D20 Tin (11 SKUs) | 304,400 | 304,400 across B1–B5 | ✓ |
| 0000771 | NV | DS Tin (11 SKUs) | 89,100 | 89,100 split air + ocean | ✓ |
| 0000772 | NV | D20 Tin (11 SKUs) | 35,200 | 35,200 split air + ocean | ✓ |
| 0000773 | OR | DS Tin (4 SKUs supp) | 40,700 | 40,700 | ✓ |
| 0000774 | NY | D20 Tin (11 SKUs) | 35,200 | 35,200 split air + ocean | ✓ |
| 0000780 | NY | DS Tin (11 SKUs) | 89,100 | 89,100 split air + ocean | ✓ |
| 0000799 | NY | DS Compliance Labels | 99,000 | on-site labels 99,000 | ✓ |
| 0000800 | NY | D20 Compliance Labels | 38,500 | on-site labels 38,500 | ✓ |
| 0000813 | HEMP | D20 10pk Masterpack | 67,600 packs | 67,600 packs (mp10) — fixed | ✓ |
| 0000815 | NY | D20 10pk Masterpack | 22,000 packs | 22,000 packs (mp10) | ✓ |
| 0000816 | OR | D20 10pk Masterpack | 8,800 packs | 8,800 packs (mp10) — fixed | ✓ |
| 0000817 | NV | DS 50pk Masterpack | 5,500 packs | 5,500 packs (mp50) — fixed | ✓ |
| 0000818 | NY | DS 50pk Masterpack | 11,000 packs | 11,000 packs (mp50) | ✓ |
| 0000819 | OR | DS 50pk Masterpack (8 SKUs) | 7,000 packs | 7,000 packs (mp50) — fixed | ✓ |
| 0000824 | OR | D20 Tin (10 SKUs supp) | 139,200 | 139,200 | ✓ |
| 0000825 | OR | DS Tin (9 SKUs supp) | 216,800 | 216,800 | ✓ |

Also reconciles against the xlsx priority list:
- PO-296 (CA DS Treeform): all 11 SKU totals match the xlsx batch breakdown ✓
- PO-297 (CA D20 Treeform): all 6 SKU totals match the xlsx Batch 5 row ✓
- OR-754 batches match xlsx batches 1–5 SKU-by-SKU ✓
- OR-756 batches match xlsx batches 1–5 SKU-by-SKU ✓

---

## Discrepancies found ✗ — all resolved May 13

### Issue 1 — Four master-pack POs were stored as `tins` instead of `packs`  **[FIXED]**

The report has a `tins` field and a `packs` field per shipment. Master-pack quantities for NY-815 and NY-818 were correctly in `packs`. But for **OR-816, OR-819, NV-817, and HEMP-813**, the master-pack counts were sitting in `tins`. That meant the report was treating, e.g., 7,000 OR DS 50pk masterpacks as 7,000 individual DS tins — drastically undercounting that PO's value and breaking the fulfillable-units math.

| Shipment ID | PO | Market | Pack type | Total qty | Was | Now |
|---|---|---|---|---|---|---|
| `OR-816` | PO-0000816 | OR | D20 10pk | 8,800 packs | `tins.D20*` | `packs.D20*.mp10` ✓ |
| `OR-819` | PO-0000819 | OR | DS 50pk | 7,000 packs | `tins.DS*` | `packs.DS*.mp50` ✓ |
| `NV-817` | PO-0000817 | NV | DS 50pk | 5,500 packs | `tins.DS*` | `packs.DS*.mp50` ✓ |
| `HEMP-813` | PO-0000813 | HEMP | D20 10pk | 67,600 packs | `tins.D20*` | `packs.D20*.mp10` ✓ |

All four shipments now have their `tins` fields zeroed and their pack quantities in the correct `packs.<sku>.<format>` slot. Verified by re-parsing the report JSON after the edit.

### Issue 2 — OR-816 had wrong SKU values (independent of Issue 1)  **[FIXED]**

Even after moving OR-816 into `packs`, **5 of the 11 SKU values were wrong**. Looked like a one-row offset somewhere in the original entry plus three SKUs that got dropped entirely. All 11 SKUs were corrected as part of the same edit pass.

| SKU | PDF PO-816 | Old report | New report |
|---|---|---|---|
| D20CH | 600 | 600 | 600 ✓ |
| D20WM | 800 | 0 | **800 ✓** |
| D20LI | 600 | 800 | **600 ✓** |
| D20OR | 800 | 0 | **800 ✓** |
| D20LE | 1,000 | 1,000 | 1,000 ✓ |
| D20BC | 1,400 | 1,400 | 1,400 ✓ |
| D20BB | 800 | 800 | 800 ✓ |
| D20BLK | 1,200 | 1,200 | 1,200 ✓ |
| D20CB | 600 | 600 | 600 ✓ |
| D20RB | 600 | 0 | **600 ✓** |
| D20SB | 400 | 0 | **400 ✓** |
| **Total** | **8,800 packs** | 6,400 packs | **8,800 packs ✓** |

---

## Other observations (no action needed, flagging for awareness)

- **PO-0000813's notes say "Universal 10pk Master Pack Order, OR Hemp"** — the report correctly routes this to HEMP (not OR), matching the intent of the note. Just confirming.
- **POs 771, 772, 774, 780** have ship-to address "Drops OR" on the PDF but the SKU codes and Notes section make clear they're for NV (771, 772) and NY (774, 780). Report routes them correctly. This is a PDF-template quirk, not a data error.
- **CA has no masterpack POs** in the folder. CA's `packFormats` allows DS/mp50 and D20/mp10 but no shipments exist yet. If CA is supposed to have masterpacks, those POs may be missing from the folder.
- **PO-0000296 and PO-0000297** (CA Treeform tin orders, 1.38M + 60K) were originally flagged as missing PDFs — the PDFs were added to the folder May 13 and verified: all 17 SKU quantities across both POs match the xlsx and the report exactly. Notes on PO-296 confirm the B1/B2/B5 split; PO-297 confirms Batch 5 ETA of 7/24/26.

---

## Fixes applied (May 13)

1. Moved 4 master-pack shipments (`OR-816`, `OR-819`, `NV-817`, `HEMP-813`) from `tins` → `packs.<size>` keyed by their pack format (`mp10` or `mp50`); zeroed the `tins` entries. ✓
2. Corrected the 5 wrong SKU values on `OR-816` (D20WM 800, D20LI 600, D20OR 800, D20RB 600, D20SB 400). ✓
3. Verified post-edit by re-parsing the JSON; all four shipments now show correct pack totals and zero tins. ✓
4. PO-296 and PO-297 PDFs landed in the folder May 13 and verified against the report — no changes needed. ✓

Backup of the pre-fix HTML is at `Production_Schedule_Report.backup-20260513-054915.html` in the same folder.
