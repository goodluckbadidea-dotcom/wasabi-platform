// ─── Data Collection — shared palette + helpers ───
// Small utilities used across the DC feature: channel/type/vendor swatch
// colors, item-mode helpers, date formatting for history cards.
//
// Colors here are theme-agnostic — they identify semantic categories
// (channels, item types, vendor families). Wasabi's theme tokens (C) live
// in ../../design/tokens.js and drive surface / text / accent colors.

// Product-line identifiers → swatch color. Stored on dc_items as `channel`
// for backward compatibility; user-facing label everywhere is "Product Line".
export const CHANNEL_COLORS = {
  drops: "#5CC63A",
  smoky: "#C86040",
};

// Item type identifiers → swatch color
export const TYPE_COLORS = {
  tins:      "#5C9CE8",
  mp:        "#E5B26A",
  labels:    "#9480C4",
  tamper:    "#D28FE5",
  cover:     "#78788A",
  dram:      "#7BD4C7",
  paper:     "#E57373",
  kitchen:   "#7BC286",
  marketing: "#FF6B3D",
};

// Vendor family swatch fallback (when the vendor doesn't have a stored color)
export const VENDOR_COLORS = {
  global:      "#D88058",
  treeform:    "#5C9CE8",
  precision:   "#9480C4",
  raypress:    "#B474B4",
  uline:       "#78788A",
  other:       "#9A8A60",
};

// Deterministic swatch color for arbitrary vendor names (used when the
// vendor doesn't have a pre-mapped family). Hash the string → palette idx.
const VENDOR_FALLBACK_PALETTE = [
  "#5C9CE8", "#E5B26A", "#9480C4", "#D28FE5", "#7BC286", "#E57373",
  "#78788A", "#9A8A60", "#DC4878", "#C4944A", "#7BD4C7", "#B48FE5",
];
export function vendorSwatchFor(nameOrKey) {
  if (!nameOrKey) return VENDOR_COLORS.other;
  const known = VENDOR_COLORS[String(nameOrKey).toLowerCase()];
  if (known) return known;
  let h = 0;
  const s = String(nameOrKey);
  for (let i = 0; i < s.length; i++) h = s.charCodeAt(i) + ((h << 5) - h);
  return VENDOR_FALLBACK_PALETTE[Math.abs(h) % VENDOR_FALLBACK_PALETTE.length];
}

// Human labels for enum keys (used in read-only pill displays)
export const CHANNEL_LABELS = {
  drops: "Drops",
  smoky: "Smoky Flower",
};

export const TYPE_LABELS = {
  tins:      "Tins",
  mp:        "Masterpacks",
  labels:    "Compliance Labels",
  tamper:    "Tamper Seals",
  cover:     "Cover-up Labels",
  dram:      "Drams",
  paper:     "Paper Packages",
  kitchen:   "Kitchen & Supplies",
  marketing: "Sales & Marketing",
};

export const MODE_LABELS = {
  case:   "Case",
  unit:   "Unit",
  weight: "Weight",
  roll:   "Roll",
};

// Modes that use a "count × units-per-X" multiplier (share the same shape
// as Case). Both are backed by `case_size` on the item — differ only in
// user-facing label / semantics.
export const MULTIPLIER_MODES = new Set(["case", "roll"]);

export const WEIGHT_UNITS = ["lbs", "oz", "g", "kg"];

// Compute derived total units for a count entry (mirrors backend logic)
export function computeTotal(mode, casesCount, caseSize, unitsCount) {
  if (mode === "case" || mode === "roll") {
    const c = Number(casesCount);
    const s = Number(caseSize);
    if (!isFinite(c) || !isFinite(s)) return null;
    return c * s;
  }
  if (mode === "unit") {
    const u = Number(unitsCount);
    return isFinite(u) ? u : null;
  }
  return null;
}

// Nice date formatting for history cards: "08 Jul" + "Wed · 2 days ago"
export function formatDay(dateStr) {
  if (!dateStr) return { day: "—", rel: "" };
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return { day: dateStr.slice(0, 10), rel: "" };
  const day = String(d.getDate()).padStart(2, "0");
  const mon = d.toLocaleString(undefined, { month: "short" });
  const dow = d.toLocaleString(undefined, { weekday: "short" });
  const now = new Date();
  const diffDays = Math.round((now - d) / (1000 * 60 * 60 * 24));
  let rel;
  if (diffDays === 0) rel = `${dow} · today`;
  else if (diffDays === 1) rel = `${dow} · yesterday`;
  else if (diffDays < 7) rel = `${dow} · ${diffDays} days ago`;
  else if (diffDays < 30) rel = `${dow} · ${Math.round(diffDays / 7)} weeks ago`;
  else rel = `${dow} · ${Math.round(diffDays / 30)} months ago`;
  return { day: `${day} ${mon}`, rel };
}

// Two-letter market chip label (HEMP → HE)
export function marketChip(m) {
  return String(m || "").length <= 2 ? String(m || "").toUpperCase() : String(m).slice(0, 2).toUpperCase();
}

// ─── Report-mapping (inventory-production-v2 feed) ───
// Canonical short SKU codes the inventory-production-v2 report expects.
// 22 tin/label SKUs = 11 flavors × {DS = Drops Singles 2ct, D20 = Drops 20ct}.
// Also used for masterpack items — the pack format goes in report_pack_format.
export const REPORT_SKU_CODES = [
  "DSCH", "DSWM", "DSLI", "DSOR", "DSLE", "DSBC", "DSBB", "DSBLK", "DSCB", "DSRB", "DSSB",
  "D20CH", "D20WM", "D20LI", "D20OR", "D20LE", "D20BC", "D20BB", "D20BLK", "D20CB", "D20RB", "D20SB",
];

// Pack format enum for masterpack items. mp10c is a HEMP-only cartridge pack.
export const REPORT_PACK_FORMATS = [
  { key: "mp10",  label: "10pk Masterpack" },
  { key: "mp10c", label: "10pk Cartridge (HEMP)" },
  { key: "mp25",  label: "25pk Masterpack" },
  { key: "mp50",  label: "50pk Masterpack" },
];

// ─── Workbook/tile item filter ───
// Given the full items list, return only those in scope for a given
// (market, page, category?) tuple. Extracted from DcWorkbook so DcTilesLanding
// can compute total-rows for a market's active-draft progress bar without
// duplicating the filter rules.
//
// Page → type_key rule (simple + stable):
//   kitchen page   → type_key === 'kitchen'
//   sales page     → type_key === 'marketing'
//   packaging page → anything except 'kitchen' / 'marketing'
export function filterItemsForScope(items, market, page, category, hasCategories) {
  return (items || []).filter((it) => {
    if (!Array.isArray(it.markets) || !it.markets.includes(market)) return false;
    if (hasCategories && it.channel && it.channel !== category) return false;
    if (page === "kitchen"   && it.type_key !== "kitchen")   return false;
    if (page === "sales"     && it.type_key !== "marketing") return false;
    if (page === "packaging" && (it.type_key === "kitchen" || it.type_key === "marketing")) return false;
    return true;
  });
}

// Format big numbers with commas + optional decimal trim
export function fmtNum(n, opts = {}) {
  if (n == null || n === "") return opts.emptyDash ? "—" : "";
  const num = Number(n);
  if (!isFinite(num)) return String(n);
  const rounded = opts.integer ? Math.round(num) : num;
  return rounded.toLocaleString(undefined, {
    maximumFractionDigits: opts.integer ? 0 : 2,
  });
}
