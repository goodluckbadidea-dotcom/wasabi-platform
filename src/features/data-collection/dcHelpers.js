// ─── Data Collection — shared palette + helpers ───
// Small utilities used across the DC feature: channel/type/vendor swatch
// colors, item-mode helpers, date formatting for history cards.
//
// Colors here are theme-agnostic — they identify semantic categories
// (channels, item types, vendor families). Wasabi's theme tokens (C) live
// in ../../design/tokens.js and drive surface / text / accent colors.

// Channel identifiers → swatch color (product-line semantic)
export const CHANNEL_COLORS = {
  drops:        "#5CC63A",
  smoky:        "#C86040",
  "drops-hemp": "#9480C4",
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
  drops:        "Drops",
  smoky:        "Smoky Flower",
  "drops-hemp": "Drops Hemp",
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
};

export const WEIGHT_UNITS = ["lbs", "oz", "g", "kg"];

// Compute derived total units for a count entry (mirrors backend logic)
export function computeTotal(mode, casesCount, caseSize, unitsCount) {
  if (mode === "case") {
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
