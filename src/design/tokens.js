// ─── Wasabi Platform Design Tokens ───
// 5-theme color system with dark + light mode per theme.

// ── Theme Definitions ──
// Each theme: accent colors + dark/light surface token sets.
export const THEMES = {
  wasabi: {
    label: "Wasabi",
    accent: "#7DC143", accentDim: "#619932", accentPale: "#E6F5D5",
    dark: {
      bg: "#F4EFE6", surface: "#ECE6DC", surfaceAlt: "#E4DDD3",
      border: "#D6CCBC", border2: "#C8BDB0",
      text: "#1A1812", textMid: "#5A5048", muted: "#9A8E82", white: "#FBF8F3",
      dark: "#181818", darkSurf: "#222222", darkSurf2: "#2A2A2A",
      darkBorder: "#333333", darkMuted: "#888888", darkText: "#F0F0F0",
      edgeLine: "#2E2E2E", codeBlockBg: "#111111", overlayBg: "rgba(0,0,0,0.55)",
    },
    light: {
      bg: "#FAF7F2", surface: "#F5F1EB", surfaceAlt: "#EDE8E0",
      border: "#C8BFB3", border2: "#B8B0A4",
      text: "#2C2824", textMid: "#6B6058", muted: "#9A9088", white: "#FFFFFF",
      dark: "#F5F1EB", darkSurf: "#EDE8E0", darkSurf2: "#E5DFD6",
      darkBorder: "#C8BFB3", darkMuted: "#8A8078", darkText: "#2C2824",
      edgeLine: "#B8B0A4", codeBlockBg: "#F0ECE6", overlayBg: "rgba(0,0,0,0.25)",
    },
  },
  ocean: {
    label: "Ocean",
    accent: "#3B82F6", accentDim: "#2563EB", accentPale: "#DBEAFE",
    dark: {
      bg: "#E8ECF2", surface: "#DFE4EC", surfaceAlt: "#D6DCE6",
      border: "#B8C2D0", border2: "#A8B4C4",
      text: "#141820", textMid: "#485060", muted: "#7888A0", white: "#F2F5FA",
      dark: "#161A1F", darkSurf: "#1C2128", darkSurf2: "#242A33",
      darkBorder: "#2D3544", darkMuted: "#7090B0", darkText: "#E8EDF5",
      edgeLine: "#252D38", codeBlockBg: "#0E1218", overlayBg: "rgba(0,0,0,0.55)",
    },
    light: {
      bg: "#F5F7FA", surface: "#EDF0F5", surfaceAlt: "#E3E8EF",
      border: "#B8C2D0", border2: "#A0ACBC",
      text: "#1A2030", textMid: "#506078", muted: "#7888A0", white: "#FFFFFF",
      dark: "#EDF0F5", darkSurf: "#E3E8EF", darkSurf2: "#D8DFE8",
      darkBorder: "#B8C2D0", darkMuted: "#6878A0", darkText: "#1A2030",
      edgeLine: "#A0ACBC", codeBlockBg: "#E8ECF2", overlayBg: "rgba(0,0,0,0.25)",
    },
  },
  sunset: {
    label: "Sunset",
    accent: "#F59E0B", accentDim: "#D97706", accentPale: "#FEF3C7",
    dark: {
      bg: "#F2EDE4", surface: "#EBE4D8", surfaceAlt: "#E3DACB",
      border: "#D0C4AE", border2: "#C2B49C",
      text: "#1C1810", textMid: "#5C5040", muted: "#9A8C78", white: "#FAF6EE",
      dark: "#1A1816", darkSurf: "#23201C", darkSurf2: "#2C2822",
      darkBorder: "#3A3428", darkMuted: "#A08860", darkText: "#F5EEDF",
      edgeLine: "#2E2820", codeBlockBg: "#12100C", overlayBg: "rgba(0,0,0,0.55)",
    },
    light: {
      bg: "#FBF8F0", surface: "#F5F0E4", surfaceAlt: "#EDE6D6",
      border: "#D0C4AE", border2: "#C0B098",
      text: "#2C2418", textMid: "#6B5C48", muted: "#9A8C78", white: "#FFFFFF",
      dark: "#F5F0E4", darkSurf: "#EDE6D6", darkSurf2: "#E5DCC8",
      darkBorder: "#D0C4AE", darkMuted: "#8A7C68", darkText: "#2C2418",
      edgeLine: "#C0B098", codeBlockBg: "#F0EAD8", overlayBg: "rgba(0,0,0,0.25)",
    },
  },
  lavender: {
    label: "Lavender",
    accent: "#8B6FBE", accentDim: "#7455A8", accentPale: "#EDE5F5",
    dark: {
      bg: "#EDE8F0", surface: "#E4DEE8", surfaceAlt: "#DBD4E0",
      border: "#C4BAD4", border2: "#B4A8C6",
      text: "#181420", textMid: "#504860", muted: "#8880A0", white: "#F5F2FA",
      dark: "#19181E", darkSurf: "#211F28", darkSurf2: "#2A2832",
      darkBorder: "#363244", darkMuted: "#8878B0", darkText: "#ECE8F5",
      edgeLine: "#2C2838", codeBlockBg: "#100E16", overlayBg: "rgba(0,0,0,0.55)",
    },
    light: {
      bg: "#F8F5FC", surface: "#F0ECF6", surfaceAlt: "#E8E2F0",
      border: "#C4BAD4", border2: "#B0A4C6",
      text: "#201830", textMid: "#605078", muted: "#8880A0", white: "#FFFFFF",
      dark: "#F0ECF6", darkSurf: "#E8E2F0", darkSurf2: "#E0D8EA",
      darkBorder: "#C4BAD4", darkMuted: "#7870A0", darkText: "#201830",
      edgeLine: "#B0A4C6", codeBlockBg: "#ECE6F2", overlayBg: "rgba(0,0,0,0.25)",
    },
  },
  ember: {
    label: "Ember",
    accent: "#E05252", accentDim: "#C94040", accentPale: "#FDE8E8",
    dark: {
      bg: "#F0E8E8", surface: "#E8DEDE", surfaceAlt: "#E0D4D4",
      border: "#D4C0C0", border2: "#C6B0B0",
      text: "#1C1414", textMid: "#604848", muted: "#A08080", white: "#FAF4F4",
      dark: "#1C1818", darkSurf: "#252020", darkSurf2: "#2E2828",
      darkBorder: "#3D3333", darkMuted: "#B07070", darkText: "#F5ECEC",
      edgeLine: "#302828", codeBlockBg: "#140E0E", overlayBg: "rgba(0,0,0,0.55)",
    },
    light: {
      bg: "#FCF6F6", surface: "#F6EFEF", surfaceAlt: "#EFE6E6",
      border: "#D4C0C0", border2: "#C4ACAC",
      text: "#2C2020", textMid: "#6B5858", muted: "#A08080", white: "#FFFFFF",
      dark: "#F6EFEF", darkSurf: "#EFE6E6", darkSurf2: "#E8DCDC",
      darkBorder: "#D4C0C0", darkMuted: "#907070", darkText: "#2C2020",
      edgeLine: "#C4ACAC", codeBlockBg: "#F0E8E8", overlayBg: "rgba(0,0,0,0.25)",
    },
  },
};

// Ordered list for settings UI
export const THEME_LIST = Object.keys(THEMES).map((key) => ({
  key,
  label: THEMES[key].label,
  accent: THEMES[key].accent,
}));

// ── Resolve initial theme from localStorage (with migration) ──
function _resolveInitial() {
  if (typeof localStorage === "undefined") return { name: "wasabi", mode: "dark" };
  // Migrate from old single-key format
  const oldKey = localStorage.getItem("wasabi-theme");
  if (oldKey && !localStorage.getItem("wasabi-theme-name")) {
    localStorage.setItem("wasabi-theme-mode", oldKey === "light" ? "light" : "dark");
    localStorage.setItem("wasabi-theme-name", "wasabi");
    localStorage.removeItem("wasabi-theme");
  }
  const name = localStorage.getItem("wasabi-theme-name") || "wasabi";
  const mode = localStorage.getItem("wasabi-theme-mode") || "dark";
  return { name: THEMES[name] ? name : "wasabi", mode: mode === "light" ? "light" : "dark" };
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
/** Get the current theme name ('wasabi' | 'ocean' | ...) */
export function getThemeName() { return _currentThemeName; }
/** Backward compat alias */
export function getTheme() { return _currentThemeMode; }

/** Apply a theme by name + mode. Mutates C in place. */
export function applyTheme(name, mode) {
  // Support old single-arg call: applyTheme("dark")
  if (mode === undefined && (name === "dark" || name === "light")) {
    mode = name;
    name = _currentThemeName;
  }
  const theme = THEMES[name] || THEMES.wasabi;
  _currentThemeName = name;
  _currentThemeMode = mode || "dark";
  const tokens = theme[_currentThemeMode] || theme.dark;
  Object.assign(C, tokens, {
    accent: theme.accent,
    accentDim: theme.accentDim,
    accentPale: theme.accentPale,
  });
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
