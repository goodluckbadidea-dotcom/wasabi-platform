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
    // Semantic status colors
    error: "#E05252", errorHover: "#C94040", errorDim: isDark ? "#E0525233" : "#E0525218",
    warning: "#FF6B3D", warningDim: isDark ? "#FF6B3D33" : "#FF6B3D18",
    success: "#4CAF50", successDim: isDark ? "#4CAF5033" : "#4CAF5018",
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
    bg: "#F8F6F1", surface: "#EBE5D6", surfaceRaised: "#D8D0BE",
    border: "#AEA898",
    textPrimary: "#1A1714", textSecondary: "#524C44", textMuted: "#6D6558",
    accentSoft: "#EDD8D0",
    bgGradient: "radial-gradient(ellipse at 50% -10%, #EDD8D0 0%, #F8F6F1 60%)",
  },
  {
    id: "fuji",
    label: "Fuji",
    description: "Wisteria \xb7 lavender dark",
    mode: "dark",
    accent: "#9A7BD8",
    bg: "#17141F", surface: "#221E2E", surfaceRaised: "#2C2740",
    border: "#453D5E",
    textPrimary: "#EDEAF6", textSecondary: "#A79FC0", textMuted: "#8B82A8",
    accentSoft: "#2A2144",
    bgGradient: "radial-gradient(ellipse at 50% -10%, #3A2C5E 0%, #17141F 60%)",
  },
  {
    id: "murasaki",
    label: "Murasaki",
    description: "Twilight violet \xb7 ember dark",
    mode: "dark",
    accent: "#E8503A",
    bg: "#150C2E", surface: "#1C1426", surfaceRaised: "#2A1F38",
    border: "#3D2F52",
    textPrimary: "#F5EFE9", textSecondary: "#A99BBA", textMuted: "#8A7CA0",
    accentSoft: "#3A1520",
    bgGradient: "radial-gradient(ellipse at 50% -10%, #4A2280 0%, #150C2E 60%)",
  },
  {
    id: "kori",
    label: "Kori",
    description: "Glacier ice \xb7 cool light",
    mode: "light",
    accent: "#2C72CC",
    bg: "#F4F7FB", surface: "#E0E6F0", surfaceRaised: "#CCD4E2",
    border: "#A0AAC0",
    textPrimary: "#121820", textSecondary: "#48546C", textMuted: "#5A667E",
    accentSoft: "#D4E4F6",
    bgGradient: "radial-gradient(ellipse at 50% -10%, #D4E4F6 0%, #F4F7FB 60%)",
  },
  {
    id: "sumi",
    label: "Sumi",
    description: "Ink wash \xb7 neutral dark",
    mode: "dark",
    accent: "#C86040",
    bg: "#0E1014", surface: "#1C1E26", surfaceRaised: "#2C3038",
    border: "#42464E",
    textPrimary: "#E8ECF4", textSecondary: "#8490A8", textMuted: "#7E88A2",
    accentSoft: "#28180E",
    bgGradient: "radial-gradient(ellipse at 50% -10%, #2A2E3C 0%, #0E1014 60%)",
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
    bgGradient: t.bgGradient,
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
// Fuji replaced Obsidian (2026-09-01); Murasaki had earlier replaced Hinoki.
// Anyone stored on a retired id is carried across — without this they would
// fail the THEMES lookup in _resolveInitial and be silently reset to the
// default.
const _OLD_TO_NEW = { nigiri: "shoji", miso: "murasaki", hinoki: "murasaki", nori: "sumi", tobiko: "sumi", uni: "kori", obsidian: "fuji" };

function _resolveInitial() {
  if (typeof localStorage === "undefined") return { name: "fuji" };
  // Migrate from old single-key format
  const oldKey = localStorage.getItem("wasabi-theme");
  if (oldKey && !localStorage.getItem("wasabi-theme-name")) {
    localStorage.setItem("wasabi-theme-name", "fuji");
    localStorage.removeItem("wasabi-theme");
    localStorage.removeItem("wasabi-theme-mode");
  }
  let name = localStorage.getItem("wasabi-theme-name") || "fuji";
  // Migrate old theme names
  if (!THEMES[name] && _OLD_TO_NEW[name]) {
    name = _OLD_TO_NEW[name];
    localStorage.setItem("wasabi-theme-name", name);
  }
  // Remove stale mode key
  localStorage.removeItem("wasabi-theme-mode");
  return { name: THEMES[name] ? name : "fuji" };
}

let _currentThemeName = _resolveInitial().name;
let _currentThemeMode = THEMES[_currentThemeName].mode;

const _theme = THEMES[_currentThemeName];
const _initTokens = _theme[_currentThemeMode];

// Color system: mutable token object, updated by applyTheme()
export const C = {
  ..._initTokens,
  accent:      _theme.accent,
  accentDim:   _theme.accentDim,
  accentPale:  _theme.accentPale,
  bgGradient:  _theme.bgGradient,
  green:       "#2A6B38",

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

// ── Theme-Aware Informational Palettes ──
// 11 info colors per theme, tuned to each theme's temperature/saturation.
// Semantic colors (red, orange, blue, green) stay recognizable across themes.
// Non-semantic colors harmonize with the theme's accent and surface tones.
// Indices match Notion color names via NOTION_TO_PALETTE_IDX.
// Indices 3, 6, 9 align with Sashimi PRIORITY_COLORS (Medium, Low, High).
const _PALETTE_KEYS = ["default", "gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red", "orchid"];

const THEME_PALETTES = {
  // Fuji: lavender dark — cool violet undertone, accents read against #17141F
  fuji: [
    "#867EA0", "#867EA0", "#A08C64", "#D87858", "#D4BC5E",
    "#7EB464", "#5C94DC", "#A186D8", "#D85288", "#D44656", "#B47CC0",
  ],
  // Shoji: warm light — muted, dusty, earthy, darker for contrast on cream bg
  shoji: [
    "#968E86", "#968E86", "#8E7C5E", "#C4684A", "#B8A04A",
    "#7C9844", "#7080A8", "#8E7498", "#B8506A", "#B44448", "#9C7490",
  ],
  // Murasaki: violet dark — ember/amber warms against a violet ground
  murasaki: [
    "#8478A0", "#8478A0", "#A08A58", "#E86A48", "#E0B45C",
    "#7CB068", "#5C90D8", "#9C7CD0", "#D8507C", "#E8503A", "#B478C4",
  ],
  // Kori: cool light — cool-shifted, desaturated, darker for contrast on cool bg
  kori: [
    "#8490A4", "#8490A4", "#7C8474", "#C0703C", "#A89C54",
    "#589860", "#4480CC", "#7474B4", "#B84868", "#BC3848", "#8C6CA4",
  ],
  // Sumi: neutral dark — balanced, slight blue-gray undertone
  sumi: [
    "#747888", "#747888", "#8A7E60", "#CC7850", "#C4B85C",
    "#7CB048", "#6490C8", "#8878B0", "#C84E70", "#C44450", "#A070A0",
  ],
};

// Build palette entries with auto-computed text contrast
function _buildInfoPalette(hexes) {
  return hexes.map((hex, i) => ({
    key: _PALETTE_KEYS[i],
    hex,
    text: isLightColor(hex) ? "#1a1a1a" : "#fff",
  }));
}

// ── Global View Palette ──
// Mutable informational palette, rebuilt on theme switch.
// View configs store palette indices (0-11) in colorMapping.
export const VIEW_PALETTE = _buildInfoPalette(THEME_PALETTES[_currentThemeName] || THEME_PALETTES.fuji);

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

// Milestone phase colors (mutable, rebuilt on theme switch)
export const PHASE_COLORS = {
  design:     { color: VIEW_PALETTE[4].hex, bg: _paleTint(VIEW_PALETTE[4].hex) },
  production: { color: VIEW_PALETTE[5].hex, bg: _paleTint(VIEW_PALETTE[5].hex) },
  shipping:   { color: VIEW_PALETTE[6].hex, bg: _paleTint(VIEW_PALETTE[6].hex) },
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

// Status colors (mutable, rebuilt on theme switch from palette indices)
// Maps status name → palette index
const _STATUS_MAP = {
  "Design": 3, "Waiting on Deposit": 4, "Waiting on Vendor": 2,
  "Awaiting PO": 7, "In Production": 5, "Quality Check": 6,
  "Shipping": 1, "Delivered": 5, "Cancelled": 2,
};
export const STATUS_COLORS = {};
function _rebuildStatusColors() {
  for (const [name, idx] of Object.entries(_STATUS_MAP)) {
    STATUS_COLORS[name] = VIEW_PALETTE[idx].hex;
  }
}
_rebuildStatusColors();

// Fallback colors (mutable, rebuilt on theme switch)
const _FALLBACK_INDICES = [2, 1, 7, 10, 6, 3, 4];
export const FALLBACK_COLORS = _FALLBACK_INDICES.map((i) => VIEW_PALETTE[i].hex);
function _rebuildFallbackColors() {
  for (let i = 0; i < _FALLBACK_INDICES.length; i++) {
    FALLBACK_COLORS[i] = VIEW_PALETTE[_FALLBACK_INDICES[i]].hex;
  }
}

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

/**
 * Map an external calendar hex color to the nearest info palette entry.
 * Uses Euclidean RGB distance to find the closest match.
 * Returns the palette hex color (theme-aware).
 */
export function mapCalendarColor(hex) {
  if (!hex || hex.length < 7) return VIEW_PALETTE[0].hex;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  let bestIdx = 0;
  let bestDist = Infinity;
  // Skip index 0 (default gray) and 1 (gray duplicate) — prefer vivid matches
  for (let i = 2; i < VIEW_PALETTE.length; i++) {
    const ph = VIEW_PALETTE[i].hex;
    const pr = parseInt(ph.slice(1, 3), 16);
    const pg = parseInt(ph.slice(3, 5), 16);
    const pb = parseInt(ph.slice(5, 7), 16);
    const dist = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2;
    if (dist < bestDist) { bestDist = dist; bestIdx = i; }
  }
  return VIEW_PALETTE[bestIdx].hex;
}

// ── Unified Color Resolution ──
// Single entry point for all color mapping in the app.
// Resolution order: per-view mapping → global defaults → Notion schema → auto-detect.

/**
 * Resolve a value to a palette color using the unified mapping hierarchy.
 * @param {string} value — the property value to colorize (e.g. "High", "Design", "In Progress")
 * @param {object} opts
 * @param {object} [opts.viewColorMapping] — per-view color mapping { value: paletteIndex }
 * @param {object} [opts.globalColorMapping] — global default mapping { value: paletteIndex }
 * @param {Array}  [opts.schemaOptions] — Notion schema options [{ name, color }]
 * @param {Array}  [opts.options] — flat list of option names for index-based fallback
 * @returns {{ hex: string, text: string, paletteIndex: number, source: string }}
 */
export function resolveUnifiedColor(value, opts = {}) {
  const { viewColorMapping, globalColorMapping, schemaOptions, options } = opts;

  // 1. Per-view explicit mapping
  if (viewColorMapping && viewColorMapping[value] !== undefined) {
    const idx = viewColorMapping[value];
    const entry = VIEW_PALETTE[idx] || VIEW_PALETTE[0];
    return { hex: entry.hex, text: entry.text, paletteIndex: idx, source: "view" };
  }

  // 2. Global default mapping
  if (globalColorMapping && globalColorMapping[value] !== undefined) {
    const idx = globalColorMapping[value];
    const entry = VIEW_PALETTE[idx] || VIEW_PALETTE[0];
    return { hex: entry.hex, text: entry.text, paletteIndex: idx, source: "global" };
  }

  // 3. Notion schema color
  if (schemaOptions) {
    const opt = schemaOptions.find((o) => o.name === value);
    if (opt?.color && NOTION_TO_PALETTE_IDX[opt.color] !== undefined) {
      const idx = NOTION_TO_PALETTE_IDX[opt.color];
      const entry = VIEW_PALETTE[idx];
      return { hex: entry.hex, text: entry.text, paletteIndex: idx, source: "schema" };
    }
  }

  // 4. STATUS_COLORS named match
  if (STATUS_COLORS[value]) {
    const hex = STATUS_COLORS[value];
    return { hex, text: isLightColor(hex) ? "#1a1a1a" : "#fff", paletteIndex: -1, source: "status" };
  }

  // 5. Option index fallback
  if (options) {
    const idx = options.indexOf(value);
    if (idx >= 0) {
      const hex = SELECT_PALETTE[idx % SELECT_PALETTE.length];
      return { hex, text: isLightColor(hex) ? "#1a1a1a" : "#fff", paletteIndex: -1, source: "index" };
    }
  }

  // 6. Hash fallback
  if (value) {
    let hash = 0;
    for (let i = 0; i < value.length; i++) {
      hash = value.charCodeAt(i) + ((hash << 5) - hash);
    }
    const idx = Math.abs(hash) % VIEW_PALETTE.length;
    const entry = VIEW_PALETTE[idx];
    return { hex: entry.hex, text: entry.text, paletteIndex: idx, source: "hash" };
  }

  return { hex: VIEW_PALETTE[0].hex, text: VIEW_PALETTE[0].text, paletteIndex: 0, source: "default" };
}

/** Apply a theme by name. Mode is inherent to the theme. Mutates C and all palettes in place. */
export function applyTheme(name, _mode) {
  // _mode param accepted for backward compat but ignored — mode is locked per theme
  const theme = THEMES[name] || THEMES.fuji;
  _currentThemeName = name;
  _currentThemeMode = theme.mode;
  const tokens = theme[_currentThemeMode] || theme.dark;

  // Update C tokens
  Object.assign(C, tokens, {
    accent:     theme.accent,
    accentDim:  theme.accentDim,
    accentPale: theme.accentPale,
    bgGradient: theme.bgGradient,
  });

  // Rebuild info palette from theme-specific colors
  const newPalette = _buildInfoPalette(THEME_PALETTES[name] || THEME_PALETTES.fuji);
  for (let i = 0; i < newPalette.length; i++) {
    VIEW_PALETTE[i] = newPalette[i];
  }
  VIEW_PALETTE.length = newPalette.length;

  // Rebuild all derived palettes
  _rebuildWasabiColors();
  _rebuildSelectPalette();
  _rebuildTimelinePalette();
  _rebuildStatusColors();
  _rebuildFallbackColors();
  _rebuildShadows();
  // Update phase colors
  PHASE_COLORS.design = { color: VIEW_PALETTE[4].hex, bg: _paleTint(VIEW_PALETTE[4].hex) };
  PHASE_COLORS.production = { color: VIEW_PALETTE[5].hex, bg: _paleTint(VIEW_PALETTE[5].hex) };
  PHASE_COLORS.shipping = { color: VIEW_PALETTE[6].hex, bg: _paleTint(VIEW_PALETTE[6].hex) };

  // Persist
  if (typeof localStorage !== "undefined") {
    localStorage.setItem("wasabi-theme-name", _currentThemeName);
    // Clean up stale mode key
    localStorage.removeItem("wasabi-theme-mode");
  }
}

// Typography
export const FONT         = "'Outfit','DM Sans',sans-serif";
export const FONT_DISPLAY = FONT;
export const MONO         = "'DM Mono','Courier New',monospace";

// Border radius
export const RADIUS = {
  sm:   4,    // micro: checkboxes, inline code, tooltips
  md:   10,   // secondary interactive: inputs, small buttons, stacked cards
  lg:   14,   // content surfaces: cards, panels, dropdowns, modals
  xl:   14,   // alias for lg
  pill: 999,  // primary/navigational: CTA buttons, search bars, tabs, nav items
};

// ── Theme-aware Shadows ──
// Tinted per-theme for warm/cool temperature matching.
// Mutable object — rebuilt by applyTheme() like C tokens.
const _SHADOW_TINTS = {
  fuji:     { rgb: "16,10,32", light: false },
  shoji:    { rgb: "12,8,4",   light: true },
  murasaki: { rgb: "20,6,34",  light: false },
  kori:     { rgb: "0,6,20",   light: true },
  sumi:     { rgb: "6,8,16",   light: false },
};

function _buildShadows(themeName) {
  const tint = _SHADOW_TINTS[themeName] || _SHADOW_TINTS.fuji;
  const r = tint.rgb;
  // Light themes get softer shadows; dark themes get deeper ones
  if (tint.light) {
    return {
      card:             `0 1px 3px rgba(${r},0.05), 0 1px 2px rgba(${r},0.03)`,
      cardHover:        `0 4px 12px rgba(${r},0.07), 0 2px 4px rgba(${r},0.04)`,
      cardMaterial:     `inset 0 1px 0 rgba(255,255,255,0.85), inset 0 -1px 0 rgba(0,0,0,0.06), 0 2px 8px rgba(${r},0.07), 0 1px 2px rgba(${r},0.04)`,
      cardMaterialHover:`inset 0 1px 0 rgba(255,255,255,0.85), inset 0 -1px 0 rgba(0,0,0,0.06), 0 4px 12px rgba(${r},0.09), 0 2px 4px rgba(${r},0.05)`,
      dropdown:         `0 8px 32px rgba(${r},0.12), 0 2px 8px rgba(${r},0.06)`,
      inset:            `inset 0 1px 3px rgba(${r},0.06)`,
      glow:             `0 0 20px rgba(${r},0.08)`,
    };
  }
  return {
    card:             `0 1px 3px rgba(${r},0.12), 0 1px 2px rgba(${r},0.08)`,
    cardHover:        `0 4px 12px rgba(${r},0.16), 0 2px 4px rgba(${r},0.08)`,
    cardMaterial:     `inset 0 1px 0 rgba(255,255,255,0.08), inset 0 -1px 0 rgba(0,0,0,0.22), 0 2px 8px rgba(${r},0.14), 0 1px 2px rgba(${r},0.10)`,
    cardMaterialHover:`inset 0 1px 0 rgba(255,255,255,0.08), inset 0 -1px 0 rgba(0,0,0,0.22), 0 4px 14px rgba(${r},0.18), 0 2px 4px rgba(${r},0.10)`,
    dropdown:         `0 8px 32px rgba(${r},0.28), 0 2px 8px rgba(${r},0.14)`,
    inset:            `inset 0 1px 3px rgba(${r},0.12)`,
    glow:             `0 0 24px rgba(${r},0.14)`,
  };
}

export const SHADOW = _buildShadows(_currentThemeName);

function _rebuildShadows() {
  Object.assign(SHADOW, _buildShadows(_currentThemeName));
}

// Responsive breakpoints
export const BP = {
  mobile: 768,    // below = phone
  tablet: 1194,   // mobile..tablet = iPad (covers iPad Air landscape 1180px, Pro 11" 1194px)
};

// ── Z-Index Scale ──
// Centralized to prevent layer conflicts. Only use these for fixed/absolute overlays.
// Component-internal relative z-indexes (1-10) are fine inline.
export const Z = {
  sticky:       50,   // sticky headers, toolbars
  dropdown:    150,   // dropdowns, popovers, select pickers
  header:      200,   // top header bar
  modal:       500,   // modals, dialogs, command palette, context menus
  panel:       900,   // side panels (Gmail, Wasabi chat)
  lock:       1000,   // PIN lock overlay, document editor overlays
  toast:      9000,   // conflict toasts, notifications
  workspace:  9999,   // workspace browser (always on top)
};
