// ─── Wasabi Platform Design Tokens ───
// 5 Japanese-inspired themes, each locked to its designed mode (dark or light).
// Each theme defines 10 named colors that drive both UI tokens and the view palette.

const WASABI = "#5CC63A";

// ── Helper: darken a hex color by a factor (0-1) ──
function _darken(hex, factor) {
  const r = Math.round(parseInt(hex.slice(1, 3), 16) * (1 - factor));
  const g = Math.round(parseInt(hex.slice(3, 5), 16) * (1 - factor));
  const b = Math.round(parseInt(hex.slice(5, 7), 16) * (1 - factor));
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

// ── Helper: lighten a hex color by a factor (0-1) ──
function _lighten(hex, factor) {
  const r = Math.round(parseInt(hex.slice(1, 3), 16) + (255 - parseInt(hex.slice(1, 3), 16)) * factor);
  const g = Math.round(parseInt(hex.slice(3, 5), 16) + (255 - parseInt(hex.slice(3, 5), 16)) * factor);
  const b = Math.round(parseInt(hex.slice(5, 7), 16) + (255 - parseInt(hex.slice(5, 7), 16)) * factor);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

// ── Build theme token block from the new compact format ──
function _buildTokens(t) {
  const isDark = t.mode === "dark";
  const border2 = isDark ? _lighten(t.border, 0.12) : _darken(t.border, 0.08);
  const accentDim = _darken(t.accent, 0.22);
  const edgeLine = t.surfaceRaised;
  const codeBlockBg = isDark ? _darken(t.bg, 0.3) : _lighten(t.bg, 0.3);
  const overlayBg = isDark ? "rgba(0,0,0,0.55)" : "rgba(0,0,0,0.25)";

  return {
    bg: t.bg, surface: t.surface, surfaceAlt: t.surfaceRaised,
    border: t.border, border2,
    text: t.textPrimary, textMid: t.textSecondary, muted: t.textMuted, white: t.textPrimary,
    dark: t.bg, darkSurf: t.surface, darkSurf2: t.surfaceRaised,
    darkBorder: t.border, darkMuted: t.textMuted, darkText: t.textPrimary,
    edgeLine, codeBlockBg, overlayBg,
  };
}

// ── Theme Definitions ──
const _RAW_THEMES = [
  {
    id: "shoji",
    label: "Shoji",
    description: "Washi paper \xb7 warm light",
    mode: "light",
    accent: "#C0543A",
    bg: "#F8F6F1", surface: "#EEEADE", surfaceRaised: "#E4E0D4",
    border: "#CDC8BE",
    textPrimary: "#1A1714", textSecondary: "#6B6560", textMuted: "#A8A29A",
    accentSoft: "#EDD8D0",
  },
  {
    id: "obsidian",
    label: "Obsidian",
    description: "Volcanic glass \xb7 OLED dark",
    mode: "dark",
    accent: WASABI,
    bg: "#080809", surface: "#101012", surfaceRaised: "#18181C",
    border: "#242428",
    textPrimary: "#F2F2F3", textSecondary: "#9898A4", textMuted: "#4E4E58",
    accentSoft: "#142810",
  },
  {
    id: "hinoki",
    label: "Hinoki",
    description: "Cypress wood \xb7 warm dark",
    mode: "dark",
    accent: "#C4944A",
    bg: "#0B0906", surface: "#141009", surfaceRaised: "#1E170E",
    border: "#2E2318",
    textPrimary: "#F4EDD8", textSecondary: "#9E8E72", textMuted: "#5C4E3A",
    accentSoft: "#281F10",
  },
  {
    id: "kori",
    label: "Kori",
    description: "Glacier ice \xb7 cool light",
    mode: "light",
    accent: "#2C72CC",
    bg: "#F4F7FB", surface: "#EAEEF5", surfaceRaised: "#DEE4EE",
    border: "#C8D0E0",
    textPrimary: "#121820", textSecondary: "#58647A", textMuted: "#8C96AA",
    accentSoft: "#D4E4F6",
  },
  {
    id: "sumi",
    label: "Sumi",
    description: "Ink wash \xb7 neutral dark",
    mode: "dark",
    accent: "#C86040",
    bg: "#0E1014", surface: "#16181E", surfaceRaised: "#1E2028",
    border: "#2A2C38",
    textPrimary: "#E8ECF4", textSecondary: "#8490A8", textMuted: "#484E64",
    accentSoft: "#28180E",
  },
];

// Build the full THEMES object expected by the rest of the system
export const THEMES = {};
for (const t of _RAW_THEMES) {
  const tokens = _buildTokens(t);
  const accentDim = _darken(t.accent, 0.22);
  const isDark = t.mode === "dark";

  // Generate 10-color palette
  // 0-2: dark tones, 3-4: neutrals, 5-8: vivid accents, 9: wasabi
  const palette = isDark ? [
    { key: "base-dark",   hex: t.bg,            text: t.textPrimary },
    { key: "surface",     hex: t.surface,        text: t.textPrimary },
    { key: "raised",      hex: t.surfaceRaised,  text: t.textPrimary },
    { key: "neutral-1",   hex: t.textMuted,      text: t.textPrimary },
    { key: "neutral-2",   hex: t.textSecondary,  text: isDark ? t.bg : "#fff" },
    { key: "accent",      hex: t.accent,         text: "#fff" },
    { key: "accent-dim",  hex: accentDim,        text: "#fff" },
    { key: "warm",        hex: _lighten(t.accent, 0.25), text: t.bg },
    { key: "cool",        hex: _darken(t.accent, 0.10),  text: "#fff" },
    { key: "wasabi",      hex: WASABI,           text: "#fff" },
  ] : [
    { key: "base-light",  hex: t.textPrimary,    text: t.bg },
    { key: "mid-dark",    hex: t.textSecondary,  text: t.bg },
    { key: "mid-light",   hex: t.textMuted,      text: t.textPrimary },
    { key: "neutral-1",   hex: t.border,         text: t.textPrimary },
    { key: "neutral-2",   hex: t.surfaceRaised,  text: t.textPrimary },
    { key: "accent",      hex: t.accent,         text: "#fff" },
    { key: "accent-dim",  hex: accentDim,        text: "#fff" },
    { key: "warm",        hex: _lighten(t.accent, 0.25), text: t.textPrimary },
    { key: "cool",        hex: _darken(t.accent, 0.10),  text: "#fff" },
    { key: "wasabi",      hex: WASABI,           text: "#fff" },
  ];

  THEMES[t.id] = {
    label: t.label,
    description: t.description,
    mode: t.mode,
    accent: t.accent,
    accentDim,
    accentPale: t.accentSoft,
    palette,
    // Both keys point to the same tokens (mode is locked)
    dark: tokens,
    light: tokens,
  };
}

// Ordered list for settings UI
export const THEME_LIST = _RAW_THEMES.map((t) => ({
  key: t.id,
  label: t.label,
  description: t.description,
  accent: t.accent,
  mode: t.mode,
}));

// ── Resolve initial theme from localStorage (with migration) ──
const _OLD_TO_NEW = { nigiri: "shoji", miso: "hinoki", nori: "sumi", tobiko: "sumi", uni: "kori" };

function _resolveInitial() {
  if (typeof localStorage === "undefined") return { name: "obsidian" };
  // Migrate from old single-key format
  const oldKey = localStorage.getItem("wasabi-theme");
  if (oldKey && !localStorage.getItem("wasabi-theme-name")) {
    localStorage.setItem("wasabi-theme-name", "obsidian");
    localStorage.removeItem("wasabi-theme");
    localStorage.removeItem("wasabi-theme-mode");
  }
  let name = localStorage.getItem("wasabi-theme-name") || "obsidian";
  // Migrate old theme names
  if (!THEMES[name] && _OLD_TO_NEW[name]) {
    name = _OLD_TO_NEW[name];
    localStorage.setItem("wasabi-theme-name", name);
  }
  // Remove stale mode key
  localStorage.removeItem("wasabi-theme-mode");
  return { name: THEMES[name] ? name : "obsidian" };
}

let _currentThemeName = _resolveInitial().name;
let _currentThemeMode = THEMES[_currentThemeName].mode;

const _theme = THEMES[_currentThemeName];
const _initTokens = _theme[_currentThemeMode];

// Color system: mutable token object, updated by applyTheme()
export const C = {
  ..._initTokens,
  accent:     _theme.accent,
  accentDim:  _theme.accentDim,
  accentPale: _theme.accentPale,
  green:      "#2A6B38",

  // Orange — TE highlight color (unchanged across themes)
  orange:     "#FF4800",
  orangeDim:  "#D93C00",
  orangePale: "#FFF0E8",
};

/** Get the current theme mode ('dark' | 'light') */
export function getThemeMode() { return _currentThemeMode; }
/** Get the current theme name */
export function getThemeName() { return _currentThemeName; }
/** Backward compat alias */
export function getTheme() { return _currentThemeMode; }

// ── Mutable Palettes ──
// These arrays/objects are mutated in-place by applyTheme() so all importers
// see updated values after a theme switch (same pattern as the C token object).

// Helper: check if a hex color is light (for contrast-aware text colors)
export function isLightColor(hex) {
  if (!hex || hex.length < 7) return false;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  // Relative luminance (simplified sRGB)
  return (r * 0.299 + g * 0.587 + b * 0.114) > 160;
}

// Helper: compute a very pale tint of a hex color (for Gantt bar backgrounds)
function _paleTint(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const tr = Math.round(r * 0.15 + 255 * 0.85);
  const tg = Math.round(g * 0.15 + 255 * 0.85);
  const tb = Math.round(b * 0.15 + 255 * 0.85);
  return `#${tr.toString(16).padStart(2, "0")}${tg.toString(16).padStart(2, "0")}${tb.toString(16).padStart(2, "0")}`;
}

// ── Fixed Informational Palette ──
// Theme-independent colors for data visualization (pills, bars, charts, badges).
// Indices match Notion color names via NOTION_TO_PALETTE_IDX.
// Indices 3, 6, 9 align with Sashimi PRIORITY_COLORS (Medium, Low, High).
const INFO_PALETTE = [
  { key: "default", hex: "#848490", text: "#fff" },      // 0: neutral gray
  { key: "gray",    hex: "#848490", text: "#fff" },      // 1: neutral gray
  { key: "brown",   hex: "#9E8C5C", text: "#fff" },      // 2: olive
  { key: "orange",  hex: "#E0845C", text: "#fff" },      // 3: coral
  { key: "yellow",  hex: "#DACA68", text: "#1a1a1a" },   // 4: warm gold
  { key: "green",   hex: "#A0CC42", text: "#1a1a1a" },   // 5: lime
  { key: "blue",    hex: "#70AAF0", text: "#fff" },      // 6: cornflower
  { key: "purple",  hex: "#9C84C0", text: "#fff" },      // 7: lavender
  { key: "pink",    hex: "#E54B78", text: "#fff" },      // 8: rose
  { key: "red",     hex: "#DA4060", text: "#fff" },      // 9: crimson
  { key: "orchid",  hex: "#BE7ABE", text: "#fff" },      // 10: orchid
];

// ── Global View Palette ──
// Fixed informational palette for all views. Theme-independent.
// View configs store palette indices (0-11) in colorMapping.
export const VIEW_PALETTE = INFO_PALETTE.map((p) => ({ ...p }));

// ── Timeline Palette (Gantt) ──
// Mutable array derived from vivid VIEW_PALETTE entries.
const _TIMELINE_INDICES = [3, 5, 6, 7, 8, 9, 10, 4, 2];
export const TIMELINE_PALETTE = [];
function _rebuildTimelinePalette() {
  TIMELINE_PALETTE.length = 0;
  for (const i of _TIMELINE_INDICES) {
    if (i < VIEW_PALETTE.length) {
      TIMELINE_PALETTE.push({ color: VIEW_PALETTE[i].hex, bg: _paleTint(VIEW_PALETTE[i].hex) });
    }
  }
}
_rebuildTimelinePalette();

// Milestone phase colors
export const PHASE_COLORS = {
  design:     { color: "#DACA68", bg: "#F5F0D8" },
  production: { color: "#A0CC42", bg: "#E6F2D0" },
  shipping:   { color: "#70AAF0", bg: "#DDE8FA" },
};

// Map Notion color names → palette index for auto-mapping
const NOTION_TO_PALETTE_IDX = {
  default: 0, gray: 1, brown: 2, orange: 3, yellow: 4,
  green: 5, blue: 6, purple: 7, pink: 8, red: 9,
};

// Notion color name keys in palette index order
const NOTION_COLOR_NAMES = ["default", "gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red"];

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
// Mutable map of Notion color names → { fill, text }. Rebuilt from VIEW_PALETTE.
export const WASABI_COLORS = {};
function _rebuildWasabiColors() {
  NOTION_COLOR_NAMES.forEach((name, i) => {
    WASABI_COLORS[name] = { fill: VIEW_PALETTE[i].hex, text: VIEW_PALETTE[i].text };
  });
}
_rebuildWasabiColors();

/** Map a Notion color name → Wasabi fill color */
export function notionColorToWasabi(notionColor) {
  const entry = WASABI_COLORS[notionColor];
  return entry ? entry.fill : WASABI_COLORS.default.fill;
}

/** Get the full Wasabi color entry (fill + text) for a Notion color */
export function getWasabiColor(notionColor) {
  return WASABI_COLORS[notionColor] || WASABI_COLORS.default;
}

// Generic select option colors (mutable, derived from VIEW_PALETTE vivid entries first)
// Reordered so vivid accent colors come before neutral tones
const _SELECT_INDICES = [3, 5, 6, 7, 8, 9, 10, 4, 2, 0];
export const SELECT_PALETTE = _SELECT_INDICES.map((i) => VIEW_PALETTE[i].hex);
function _rebuildSelectPalette() {
  for (let si = 0; si < _SELECT_INDICES.length; si++) {
    SELECT_PALETTE[si] = VIEW_PALETTE[_SELECT_INDICES[si]].hex;
  }
  SELECT_PALETTE.length = _SELECT_INDICES.length;
}

// Generate a color for a select option by index
export function getSelectColor(index) {
  return SELECT_PALETTE[index % SELECT_PALETTE.length];
}

// Status colors (generic — maps status name → color)
export const STATUS_COLORS = {
  "Design":              "#E0845C",
  "Waiting on Deposit":  "#DACA68",
  "Waiting on Vendor":   "#9E8C5C",
  "Awaiting PO":         "#9C84C0",
  "In Production":       "#A0CC42",
  "Quality Check":       "#70AAF0",
  "Shipping":            "#848490",
  "Delivered":           "#A0CC42",
  "Cancelled":           "#9E8C5C",
};

// Fallback colors for items without a status
export const FALLBACK_COLORS = [
  "#9E8C5C", "#848490", "#9C84C0", "#BE7ABE",
  "#70AAF0", "#E0845C", "#DACA68",
];

// Get a status-like pill color, falling back to palette
export function getStatusColor(value, options = [], colorMapping = null) {
  // User color mapping takes priority
  if (colorMapping && colorMapping[value] !== undefined) {
    const entry = VIEW_PALETTE[colorMapping[value]] || VIEW_PALETTE[0];
    return entry.hex;
  }
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
export function getSolidPillColor(value, options = [], schemaOptions = [], colorMapping = null) {
  // User color mapping takes priority
  if (colorMapping && colorMapping[value] !== undefined) {
    const entry = VIEW_PALETTE[colorMapping[value]] || VIEW_PALETTE[0];
    return { fill: entry.hex, text: isLightColor(entry.hex) ? "#1a1a1a" : "#fff" };
  }
  const opt = schemaOptions.find((o) => o.name === value);
  if (opt?.color) {
    const wasabi = WASABI_COLORS[opt.color];
    if (wasabi) return wasabi;
  }
  const idx = options.indexOf(value);
  const fill = idx >= 0 ? SELECT_PALETTE[idx % SELECT_PALETTE.length] : getStatusColor(value, options);
  // Determine text color based on fill luminance
  const text = isLightColor(fill) ? "#1a1a1a" : "#fff";
  return { fill, text };
}

/** Apply a theme by name. Mode is inherent to the theme. Mutates C and all palettes in place. */
export function applyTheme(name, _mode) {
  // _mode param accepted for backward compat but ignored — mode is locked per theme
  const theme = THEMES[name] || THEMES.obsidian;
  _currentThemeName = name;
  _currentThemeMode = theme.mode;
  const tokens = theme[_currentThemeMode] || theme.dark;

  // Update C tokens
  Object.assign(C, tokens, {
    accent: theme.accent,
    accentDim: theme.accentDim,
    accentPale: theme.accentPale,
  });

  // NOTE: VIEW_PALETTE, SELECT_PALETTE, TIMELINE_PALETTE, WASABI_COLORS are now
  // fixed informational colors (INFO_PALETTE) — not rebuilt on theme switch.
  // Only C tokens (bg, surface, text, accent) change with theme.

  // Persist
  if (typeof localStorage !== "undefined") {
    localStorage.setItem("wasabi-theme-name", _currentThemeName);
    // Clean up stale mode key
    localStorage.removeItem("wasabi-theme-mode");
  }
}

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
