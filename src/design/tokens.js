// ─── Wasabi Platform Design Tokens ───
// 5 sushi-themed color system with dark + light mode per theme.
// Each theme defines 10 named colors that drive both UI tokens and the view palette.

const WASABI_GREEN = "#7DC143";

// ── Theme Definitions ──
export const THEMES = {
  nigiri: {
    label: "Nigiri",
    description: "Salmon, tuna & rice",
    accent: "#E8856A", accentDim: "#C84B4B", accentPale: "#F5EDD4",
    palette: [
      { key: "nori-black",   hex: "#0C0C0C", text: "#F5EDD4" },
      { key: "shadow",       hex: "#1C1614", text: "#F5EDD4" },
      { key: "stone",        hex: "#2E2520", text: "#F5EDD4" },
      { key: "rice-cream",   hex: "#F5EDD4", text: "#1C1614" },
      { key: "pale-silk",    hex: "#C8B99A", text: "#1C1614" },
      { key: "salmon",       hex: "#E8856A", text: "#fff" },
      { key: "tuna-red",     hex: "#C84B4B", text: "#fff" },
      { key: "soy-gold",     hex: "#D4A843", text: "#1C1614" },
      { key: "ginger-blush", hex: "#E8B09A", text: "#1C1614" },
      { key: "wasabi",       hex: WASABI_GREEN, text: "#fff" },
    ],
    dark: {
      bg: "#0C0C0C", surface: "#1C1614", surfaceAlt: "#2E2520",
      border: "#3D3128", border2: "#4A3E34",
      text: "#F5EDD4", textMid: "#C8B99A", muted: "#8A7E72", white: "#F5EDD4",
      dark: "#0C0C0C", darkSurf: "#1C1614", darkSurf2: "#2E2520",
      darkBorder: "#3D3128", darkMuted: "#8A7E72", darkText: "#F5EDD4",
      edgeLine: "#2E2520", codeBlockBg: "#080806", overlayBg: "rgba(0,0,0,0.55)",
    },
    light: {
      bg: "#FAF7F0", surface: "#F5EDD4", surfaceAlt: "#EDE5CC",
      border: "#D4CBAF", border2: "#C8B99A",
      text: "#1C1614", textMid: "#5A4E42", muted: "#8A7E72", white: "#FFFFFF",
      dark: "#F5EDD4", darkSurf: "#EDE5CC", darkSurf2: "#E5DCBF",
      darkBorder: "#D4CBAF", darkMuted: "#8A7E72", darkText: "#1C1614",
      edgeLine: "#C8B99A", codeBlockBg: "#F0E8D0", overlayBg: "rgba(0,0,0,0.25)",
    },
  },

  miso: {
    label: "Miso",
    description: "Broth, tofu & dashi",
    accent: "#C4892A", accentDim: "#8B5E2A", accentPale: "#F0DEB4",
    palette: [
      { key: "dark-clay",      hex: "#140E06", text: "#F0DEB4" },
      { key: "deep-umber",     hex: "#201408", text: "#F0DEB4" },
      { key: "bark",           hex: "#3D2E14", text: "#F0DEB4" },
      { key: "tofu-cream",     hex: "#F0DEB4", text: "#201408" },
      { key: "aged-parchment", hex: "#C8B07A", text: "#201408" },
      { key: "miso-gold",      hex: "#C4892A", text: "#fff" },
      { key: "dark-miso",      hex: "#8B5E2A", text: "#fff" },
      { key: "dashi-amber",    hex: "#E8C56A", text: "#201408" },
      { key: "kombu-brown",    hex: "#5E4020", text: "#F0DEB4" },
      { key: "wasabi",         hex: WASABI_GREEN, text: "#fff" },
    ],
    dark: {
      bg: "#140E06", surface: "#201408", surfaceAlt: "#3D2E14",
      border: "#4D3E24", border2: "#5E4E34",
      text: "#F0DEB4", textMid: "#C8B07A", muted: "#8A7A5A", white: "#F0DEB4",
      dark: "#140E06", darkSurf: "#201408", darkSurf2: "#3D2E14",
      darkBorder: "#4D3E24", darkMuted: "#8A7A5A", darkText: "#F0DEB4",
      edgeLine: "#3D2E14", codeBlockBg: "#0A0804", overlayBg: "rgba(0,0,0,0.55)",
    },
    light: {
      bg: "#FBF6EA", surface: "#F0DEB4", surfaceAlt: "#E8D6A8",
      border: "#D4C494", border2: "#C8B07A",
      text: "#201408", textMid: "#5A4A2A", muted: "#8A7A5A", white: "#FFFFFF",
      dark: "#F0DEB4", darkSurf: "#E8D6A8", darkSurf2: "#E0CE9C",
      darkBorder: "#D4C494", darkMuted: "#8A7A5A", darkText: "#201408",
      edgeLine: "#C8B07A", codeBlockBg: "#F0E8D0", overlayBg: "rgba(0,0,0,0.25)",
    },
  },

  nori: {
    label: "Nori",
    description: "Seaweed, ocean & tide",
    accent: "#2A7A5E", accentDim: "#1A5E4A", accentPale: "#C4E8DA",
    palette: [
      { key: "abyss",        hex: "#060D09", text: "#C4E8DA" },
      { key: "deep-kelp",    hex: "#0D1610", text: "#C4E8DA" },
      { key: "sea-floor",    hex: "#142218", text: "#C4E8DA" },
      { key: "sea-foam",     hex: "#8ED4B8", text: "#0D1610" },
      { key: "pale-tide",    hex: "#C4E8DA", text: "#0D1610" },
      { key: "sea-glass",    hex: "#4AB884", text: "#fff" },
      { key: "deep-current", hex: "#1A5E4A", text: "#C4E8DA" },
      { key: "brine-teal",   hex: "#2A7A5E", text: "#fff" },
      { key: "surf-mist",    hex: "#6ABAA4", text: "#0D1610" },
      { key: "wasabi",       hex: WASABI_GREEN, text: "#fff" },
    ],
    dark: {
      bg: "#060D09", surface: "#0D1610", surfaceAlt: "#142218",
      border: "#1E3228", border2: "#284238",
      text: "#C4E8DA", textMid: "#8ED4B8", muted: "#5A8A72", white: "#C4E8DA",
      dark: "#060D09", darkSurf: "#0D1610", darkSurf2: "#142218",
      darkBorder: "#1E3228", darkMuted: "#5A8A72", darkText: "#C4E8DA",
      edgeLine: "#142218", codeBlockBg: "#040A06", overlayBg: "rgba(0,0,0,0.55)",
    },
    light: {
      bg: "#F2FAF6", surface: "#C4E8DA", surfaceAlt: "#B4DED0",
      border: "#90C8B4", border2: "#8ED4B8",
      text: "#0D1610", textMid: "#2A4A3A", muted: "#5A8A72", white: "#FFFFFF",
      dark: "#C4E8DA", darkSurf: "#B4DED0", darkSurf2: "#A4D4C6",
      darkBorder: "#90C8B4", darkMuted: "#5A8A72", darkText: "#0D1610",
      edgeLine: "#8ED4B8", codeBlockBg: "#E4F4EC", overlayBg: "rgba(0,0,0,0.25)",
    },
  },

  tobiko: {
    label: "Tobiko",
    description: "Flying fish roe & spice",
    accent: "#E85C3A", accentDim: "#C43A6A", accentPale: "#F5D4A0",
    palette: [
      { key: "void",          hex: "#09070E", text: "#F5D4A0" },
      { key: "ink-well",      hex: "#150D1A", text: "#F5D4A0" },
      { key: "deep-plum",     hex: "#2A1A30", text: "#F5D4A0" },
      { key: "pearl",         hex: "#F5D4A0", text: "#150D1A" },
      { key: "pale-cream",    hex: "#E8C8A0", text: "#150D1A" },
      { key: "tobiko-red",    hex: "#E85C3A", text: "#fff" },
      { key: "scarlet-roe",   hex: "#C43A6A", text: "#fff" },
      { key: "golden-tobiko", hex: "#F0A030", text: "#150D1A" },
      { key: "blush-roe",     hex: "#D4607A", text: "#fff" },
      { key: "wasabi",        hex: WASABI_GREEN, text: "#fff" },
    ],
    dark: {
      bg: "#09070E", surface: "#150D1A", surfaceAlt: "#2A1A30",
      border: "#3A2A40", border2: "#4A3A50",
      text: "#F5D4A0", textMid: "#E8C8A0", muted: "#8A7A6A", white: "#F5D4A0",
      dark: "#09070E", darkSurf: "#150D1A", darkSurf2: "#2A1A30",
      darkBorder: "#3A2A40", darkMuted: "#8A7A6A", darkText: "#F5D4A0",
      edgeLine: "#2A1A30", codeBlockBg: "#06040A", overlayBg: "rgba(0,0,0,0.55)",
    },
    light: {
      bg: "#FDF8F0", surface: "#F5D4A0", surfaceAlt: "#EDCC98",
      border: "#D8BA88", border2: "#E8C8A0",
      text: "#150D1A", textMid: "#4A3A50", muted: "#8A7A6A", white: "#FFFFFF",
      dark: "#F5D4A0", darkSurf: "#EDCC98", darkSurf2: "#E5C490",
      darkBorder: "#D8BA88", darkMuted: "#8A7A6A", darkText: "#150D1A",
      edgeLine: "#E8C8A0", codeBlockBg: "#F5EDD8", overlayBg: "rgba(0,0,0,0.25)",
    },
  },

  uni: {
    label: "Uni",
    description: "Sea urchin & deep sea",
    accent: "#D4943A", accentDim: "#A06820", accentPale: "#F5E8C0",
    palette: [
      { key: "deep-ocean",    hex: "#080A12", text: "#F5E8C0" },
      { key: "midnight-blue", hex: "#10121C", text: "#F5E8C0" },
      { key: "slate-deep",    hex: "#1A1C2A", text: "#F5E8C0" },
      { key: "ivory-cream",   hex: "#F5E8C0", text: "#10121C" },
      { key: "sand-silk",     hex: "#D4C898", text: "#10121C" },
      { key: "uni-gold",      hex: "#D4943A", text: "#fff" },
      { key: "dark-urchin",   hex: "#A06820", text: "#F5E8C0" },
      { key: "bright-uni",    hex: "#E8C050", text: "#10121C" },
      { key: "briny-blue",    hex: "#3A6A9A", text: "#fff" },
      { key: "wasabi",        hex: WASABI_GREEN, text: "#fff" },
    ],
    dark: {
      bg: "#080A12", surface: "#10121C", surfaceAlt: "#1A1C2A",
      border: "#2A2C3A", border2: "#3A3C4A",
      text: "#F5E8C0", textMid: "#D4C898", muted: "#7A7A8A", white: "#F5E8C0",
      dark: "#080A12", darkSurf: "#10121C", darkSurf2: "#1A1C2A",
      darkBorder: "#2A2C3A", darkMuted: "#7A7A8A", darkText: "#F5E8C0",
      edgeLine: "#1A1C2A", codeBlockBg: "#06080E", overlayBg: "rgba(0,0,0,0.55)",
    },
    light: {
      bg: "#FDFAF0", surface: "#F5E8C0", surfaceAlt: "#EDE0B8",
      border: "#D8D0A8", border2: "#D4C898",
      text: "#10121C", textMid: "#3A3C4A", muted: "#7A7A8A", white: "#FFFFFF",
      dark: "#F5E8C0", darkSurf: "#EDE0B8", darkSurf2: "#E5D8B0",
      darkBorder: "#D8D0A8", darkMuted: "#7A7A8A", darkText: "#10121C",
      edgeLine: "#D4C898", codeBlockBg: "#F0E8D0", overlayBg: "rgba(0,0,0,0.25)",
    },
  },
};

// Ordered list for settings UI
export const THEME_LIST = Object.keys(THEMES).map((key) => ({
  key,
  label: THEMES[key].label,
  description: THEMES[key].description,
  accent: THEMES[key].accent,
}));

// ── Resolve initial theme from localStorage (with migration) ──
function _resolveInitial() {
  if (typeof localStorage === "undefined") return { name: "nigiri", mode: "dark" };
  // Migrate from old single-key format
  const oldKey = localStorage.getItem("wasabi-theme");
  if (oldKey && !localStorage.getItem("wasabi-theme-name")) {
    localStorage.setItem("wasabi-theme-mode", oldKey === "light" ? "light" : "dark");
    localStorage.setItem("wasabi-theme-name", "nigiri");
    localStorage.removeItem("wasabi-theme");
  }
  const name = localStorage.getItem("wasabi-theme-name") || "nigiri";
  const mode = localStorage.getItem("wasabi-theme-mode") || "dark";
  return { name: THEMES[name] ? name : "nigiri", mode: mode === "light" ? "light" : "dark" };
}

let _currentThemeName = _resolveInitial().name;
let _currentThemeMode = _resolveInitial().mode;

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

// ── Global View Palette ──
// Mutable 10-color palette used by all views for property-driven coloring.
// Index-based: view configs store palette indices (0-9) in colorMapping.
export const VIEW_PALETTE = _theme.palette.map((p) => ({ ...p }));

// ── Timeline Palette (Gantt) ──
// Mutable array derived from the vivid VIEW_PALETTE entries (indices 5-9, 3, 4).
// Skips indices 0-2 which are dark background colors with poor contrast on dark UIs.
const _TIMELINE_INDICES = [5, 6, 7, 8, 9, 3, 4];
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
  design:     { color: "#F0C94E", bg: "#FDF8E3" },
  production: { color: "#7DC143", bg: "#E6F4E9" },
  shipping:   { color: "#2A6B38", bg: "#E6F4E9" },
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
// Reordered so vivid accent colors (5-9) come before dark bg/light colors (3,4,0,1,2)
const _SELECT_INDICES = [5, 6, 7, 8, 9, 3, 4, 0, 1, 2];
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
  // Determine text color based on fill luminance
  const text = isLightColor(fill) ? "#1a1a1a" : "#fff";
  return { fill, text };
}

/** Apply a theme by name + mode. Mutates C and all palettes in place. */
export function applyTheme(name, mode) {
  // Support old single-arg call: applyTheme("dark")
  if (mode === undefined && (name === "dark" || name === "light")) {
    mode = name;
    name = _currentThemeName;
  }
  const theme = THEMES[name] || THEMES.nigiri;
  _currentThemeName = name;
  _currentThemeMode = mode || "dark";
  const tokens = theme[_currentThemeMode] || theme.dark;

  // Update C tokens
  Object.assign(C, tokens, {
    accent: theme.accent,
    accentDim: theme.accentDim,
    accentPale: theme.accentPale,
  });

  // Update VIEW_PALETTE in place
  const newPalette = theme.palette;
  for (let i = 0; i < newPalette.length; i++) {
    VIEW_PALETTE[i] = { ...newPalette[i] };
  }
  VIEW_PALETTE.length = newPalette.length;

  // Rebuild derived palettes
  _rebuildWasabiColors();
  _rebuildSelectPalette();
  _rebuildTimelinePalette();

  // Persist
  if (typeof localStorage !== "undefined") {
    localStorage.setItem("wasabi-theme-name", _currentThemeName);
    localStorage.setItem("wasabi-theme-mode", _currentThemeMode);
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
