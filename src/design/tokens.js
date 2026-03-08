// ─── Wasabi Platform Design Tokens ───
// Ported from production-pm-agent.jsx — canonical source of truth

// Color system: dark chrome + warm content areas
export const C = {
  // Light mode (content areas)
  bg:         "#F4EFE6",
  surface:    "#ECE6DC",
  surfaceAlt: "#E4DDD3",
  border:     "#D6CCBC",
  border2:    "#C8BDB0",
  text:       "#1A1812",
  textMid:    "#5A5048",
  muted:      "#9A8E82",
  white:      "#FBF8F3",

  // Wasabi green
  accent:     "#7DC143",
  accentDim:  "#619932",
  accentPale: "#E6F5D5",
  green:      "#2A6B38",

  // Orange
  orange:     "#FF4800",
  orangeDim:  "#D93C00",
  orangePale: "#FFF0E8",

  // Dark mode (chrome / sidebar / header)
  dark:       "#181818",
  darkSurf:   "#222222",
  darkSurf2:  "#2A2A2A",
  darkBorder: "#333333",
  darkMuted:  "#888888",
  darkText:   "#F0F0F0",
  edgeLine:   "#2E2E2E",
};

// Typography
export const FONT = "'Outfit','DM Sans',sans-serif";
export const MONO = "'DM Mono','Courier New',monospace";

// Border radius
export const RADIUS = {
  sm:   4,
  md:   6,
  lg:   8,
  xl:   12,
  pill: 999,
};

// Shadows
export const SHADOW = {
  card:      "0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)",
  cardHover: "0 4px 12px rgba(0,0,0,0.08), 0 2px 4px rgba(0,0,0,0.04)",
  dropdown:  "0 8px 32px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.10)",
  inset:     "inset 0 1px 3px rgba(0,0,0,0.1)",
};

// Responsive breakpoints
export const BP = {
  mobile: 640,
  tablet: 1024,
};

// Status colors (generic — maps status name → color)
export const STATUS_COLORS = {
  "Design":              "#FF4800",
  "Waiting on Deposit":  "#FF8C42",
  "Waiting on Vendor":   "#FFB347",
  "Awaiting PO":         "#FFC97A",
  "In Production":       "#7DC143",
  "Quality Check":       "#9DD467",
  "Shipping":            "#2A6B38",
  "Delivered":           "#7DC143",
  "Cancelled":           "#9A8E82",
};

// Fallback colors for items without a status
export const FALLBACK_COLORS = [
  "#8B7355", "#A0926E", "#B5A882", "#C9BD96",
  "#6B5E4A", "#7A6D58", "#89806B",
];

// Auto-assigned palette for timeline / Gantt fields
export const TIMELINE_PALETTE = [
  { color: "#8B6FBE", bg: "#F0EBF8" },
  { color: "#2A6B38", bg: "#E6F4E9" },
  { color: "#1C5C8A", bg: "#E3EFF8" },
  { color: "#C47A1A", bg: "#FDF3E3" },
  { color: "#A0303A", bg: "#FAE8EA" },
  { color: "#2A7A7A", bg: "#E3F5F5" },
  { color: "#6B5A2A", bg: "#F5F0E3" },
];

// Milestone phase colors
export const PHASE_COLORS = {
  design:     { color: "#F0C94E", bg: "#FDF8E3" },
  production: { color: "#7DC143", bg: "#E6F4E9" },
  shipping:   { color: "#2A6B38", bg: "#E6F4E9" },
};

// ── Global View Palette ──
// Canonical 10-color palette used by all views for property-driven coloring.
// Index-based: view configs store palette indices (0-9) in colorMapping.
export const VIEW_PALETTE = [
  { key: "slate",  hex: "#6B7280", text: "#fff" },   // 0
  { key: "gray",   hex: "#9CA3AF", text: "#fff" },   // 1
  { key: "brown",  hex: "#92704F", text: "#fff" },   // 2
  { key: "orange", hex: "#FF6B35", text: "#fff" },   // 3
  { key: "yellow", hex: "#F5B724", text: "#1A1812" }, // 4
  { key: "green",  hex: "#7DC143", text: "#fff" },   // 5
  { key: "blue",   hex: "#3B82F6", text: "#fff" },   // 6
  { key: "purple", hex: "#8B6FBE", text: "#fff" },   // 7
  { key: "pink",   hex: "#E87CA0", text: "#fff" },   // 8
  { key: "red",    hex: "#E05252", text: "#fff" },   // 9
];

// Map Notion color names → palette index for auto-mapping
const NOTION_TO_PALETTE_IDX = {
  default: 0, gray: 1, brown: 2, orange: 3, yellow: 4,
  green: 5, blue: 6, purple: 7, pink: 8, red: 9,
};

/**
 * Resolve a property value to a palette color entry.
 * Priority: explicit user mapping → Notion schema color → palette fallback.
 * Returns: { hex: string, text: string }
 */
export function resolveViewColor(value, colorMapping, schemaOptions) {
  // 1. Explicit user mapping (config.colorMapping: { "High": 9 })
  if (colorMapping && colorMapping[value] !== undefined) {
    const idx = colorMapping[value];
    return VIEW_PALETTE[idx] || VIEW_PALETTE[0];
  }
  // 2. Notion schema color → palette
  if (schemaOptions) {
    const opt = schemaOptions.find((o) => o.name === value);
    if (opt?.color && NOTION_TO_PALETTE_IDX[opt.color] !== undefined) {
      return VIEW_PALETTE[NOTION_TO_PALETTE_IDX[opt.color]];
    }
  }
  // 3. Fallback: hash to a palette index
  if (value) {
    let hash = 0;
    for (let i = 0; i < value.length; i++) {
      hash = value.charCodeAt(i) + ((hash << 5) - hash);
    }
    return VIEW_PALETTE[Math.abs(hash) % VIEW_PALETTE.length];
  }
  return VIEW_PALETTE[0];
}

// ── Wasabi Color Palette ──
// 10 solid-fill colors reinterpreting Notion's palette.
export const WASABI_COLORS = {
  default:  { fill: "#6B7280", text: "#fff" },
  gray:     { fill: "#9CA3AF", text: "#fff" },
  brown:    { fill: "#92704F", text: "#fff" },
  orange:   { fill: "#FF6B35", text: "#fff" },
  yellow:   { fill: "#F5B724", text: "#1A1812" },
  green:    { fill: "#7DC143", text: "#fff" },
  blue:     { fill: "#3B82F6", text: "#fff" },
  purple:   { fill: "#8B6FBE", text: "#fff" },
  pink:     { fill: "#E87CA0", text: "#fff" },
  red:      { fill: "#E05252", text: "#fff" },
};

/** Map a Notion color name → Wasabi fill color */
export function notionColorToWasabi(notionColor) {
  const entry = WASABI_COLORS[notionColor];
  return entry ? entry.fill : WASABI_COLORS.default.fill;
}

/** Get the full Wasabi color entry (fill + text) for a Notion color */
export function getWasabiColor(notionColor) {
  return WASABI_COLORS[notionColor] || WASABI_COLORS.default;
}

// Generic select option colors (for auto-coloring select fields)
export const SELECT_PALETTE = [
  "#7DC143", "#3B82F6", "#FF6B35", "#E87CA0", "#8B6FBE",
  "#F5B724", "#2A6B38", "#E05252", "#92704F", "#9CA3AF",
];

// Generate a color for a select option by index
export function getSelectColor(index) {
  return SELECT_PALETTE[index % SELECT_PALETTE.length];
}

// Get a status-like pill color, falling back to palette
export function getStatusColor(value, options = []) {
  if (STATUS_COLORS[value]) return STATUS_COLORS[value];
  const idx = options.indexOf(value);
  if (idx >= 0) return SELECT_PALETTE[idx % SELECT_PALETTE.length];
  // Hash fallback
  let hash = 0;
  for (let i = 0; i < (value || "").length; i++) {
    hash = value.charCodeAt(i) + ((hash << 5) - hash);
  }
  return FALLBACK_COLORS[Math.abs(hash) % FALLBACK_COLORS.length];
}

/**
 * Get a solid-fill pill style for a select/status value.
 * Uses the Notion color from schema, falling back to palette.
 */
export function getSolidPillColor(value, options = [], schemaOptions = []) {
  const opt = schemaOptions.find((o) => o.name === value);
  if (opt?.color) {
    const wasabi = WASABI_COLORS[opt.color];
    if (wasabi) return wasabi;
  }
  const idx = options.indexOf(value);
  const fill = idx >= 0 ? SELECT_PALETTE[idx % SELECT_PALETTE.length] : getStatusColor(value, options);
  return { fill, text: "#fff" };
}
