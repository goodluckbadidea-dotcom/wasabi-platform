// ─── Wasabi Platform Shared Styles ───
// Full dark theme throughout. Matches original Wasabi production app.

import { C, FONT, MONO, RADIUS, SHADOW } from "./tokens.js";

export const S = {
  // ─── App Shell ───
  app: {
    display: "flex",
    height: "100vh",
    width: "100vw",
    fontFamily: FONT,
    color: C.darkText,
    background: C.dark,
    overflow: "hidden",
  },

  // ─── Sidebar / Navigation ───
  sidebar: {
    width: 56,
    minWidth: 56,
    background: C.dark,
    borderRight: `1px solid ${C.edgeLine}`,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    padding: "12px 0",
    gap: 4,
    overflowY: "auto",
    overflowX: "hidden",
    zIndex: 10,
  },

  sidebarExpanded: {
    width: 220,
    minWidth: 220,
    padding: "12px 8px",
    alignItems: "stretch",
  },

  navItem: {
    width: 40,
    height: 40,
    borderRadius: RADIUS.lg,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    transition: "background 0.15s, color 0.15s",
    color: C.darkMuted,
    fontSize: 18,
    border: "none",
    background: "transparent",
    position: "relative",
  },

  navItemActive: {
    background: C.accent + "22",
    color: C.accent,
  },

  navItemHover: {
    background: C.darkSurf2,
    color: C.darkText,
  },

  // ─── Main Content Area ───
  main: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    background: C.dark,
    overflow: "hidden",
    position: "relative",
  },

  // ─── Header Bar ───
  header: {
    height: 52,
    minHeight: 52,
    display: "flex",
    alignItems: "center",
    padding: "0 20px",
    borderBottom: `1px solid ${C.edgeLine}`,
    background: C.dark,
    gap: 12,
  },

  headerTitle: {
    fontSize: 15,
    fontWeight: 600,
    color: C.darkText,
    letterSpacing: "-0.01em",
  },

  // ─── Chat / Message Styles ───
  messages: {
    flex: 1,
    overflowY: "auto",
    padding: "24px 0",
  },

  msgOuter: {
    display: "flex",
    justifyContent: "center",
    padding: "4px 20px",
  },

  msgInner: {
    maxWidth: 680,
    width: "100%",
    display: "flex",
    gap: 12,
    alignItems: "flex-start",
  },

  avatarWrap: {
    width: 32,
    height: 32,
    borderRadius: RADIUS.lg,
    background: C.accent,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    fontSize: 14,
    color: "#fff",
    fontWeight: 600,
  },

  bubbleUser: {
    background: C.darkSurf2,
    borderRadius: 18,
    padding: "10px 16px",
    fontSize: 14,
    lineHeight: 1.55,
    color: C.darkText,
    maxWidth: "85%",
    marginLeft: "auto",
  },

  bubbleAssistant: {
    background: "transparent",
    fontSize: 14,
    lineHeight: 1.65,
    color: C.darkText,
    flex: 1,
  },

  // ─── Input Area ───
  inputBox: {
    display: "flex",
    alignItems: "flex-end",
    gap: 8,
    padding: "12px 20px 16px",
    borderTop: `1px solid ${C.edgeLine}`,
    background: C.dark,
  },

  inputWrap: {
    flex: 1,
    display: "flex",
    alignItems: "flex-end",
    background: C.darkSurf,
    borderRadius: 22,
    padding: "8px 16px",
    border: `1px solid ${C.darkBorder}`,
    transition: "border-color 0.15s, box-shadow 0.15s",
    minHeight: 44,
  },

  inputWrapFocused: {
    borderColor: C.accent,
    boxShadow: `0 0 0 2px ${C.accent}33`,
  },

  textarea: {
    flex: 1,
    border: "none",
    outline: "none",
    background: "transparent",
    fontFamily: FONT,
    fontSize: 14,
    lineHeight: 1.5,
    color: C.darkText,
    resize: "none",
    minHeight: 24,
    maxHeight: 140,
  },

  sendBtn: {
    width: 36,
    height: 36,
    borderRadius: "50%",
    border: "none",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    transition: "background 0.15s, transform 0.1s",
    flexShrink: 0,
  },

  // ─── Buttons ───
  btnPrimary: {
    background: C.accent,
    color: "#fff",
    border: "none",
    borderRadius: RADIUS.pill,
    padding: "8px 20px",
    fontSize: 13,
    fontWeight: 600,
    fontFamily: FONT,
    cursor: "pointer",
    transition: "background 0.15s, transform 0.1s, box-shadow 0.15s",
    letterSpacing: "0.01em",
  },

  btnSecondary: {
    background: "transparent",
    color: C.darkMuted,
    border: `1px solid ${C.darkBorder}`,
    borderRadius: RADIUS.pill,
    padding: "7px 18px",
    fontSize: 13,
    fontWeight: 500,
    fontFamily: FONT,
    cursor: "pointer",
    transition: "background 0.15s, border-color 0.15s, color 0.15s",
  },

  btnGhost: {
    background: "transparent",
    color: C.darkMuted,
    border: "none",
    borderRadius: RADIUS.md,
    padding: "6px 12px",
    fontSize: 13,
    fontWeight: 500,
    fontFamily: FONT,
    cursor: "pointer",
    transition: "background 0.15s, color 0.15s",
  },

  btnChoice: {
    background: C.accent + "14",
    color: C.accent,
    border: `1px solid ${C.accent}44`,
    borderRadius: RADIUS.pill,
    padding: "8px 18px",
    fontSize: 13,
    fontWeight: 600,
    fontFamily: FONT,
    cursor: "pointer",
    transition: "all 0.15s",
    letterSpacing: "0.01em",
  },

  // ─── Cards ───
  card: {
    background: C.darkSurf,
    borderRadius: RADIUS.xl,
    border: `1px solid ${C.darkBorder}`,
    padding: 16,
    transition: "border-color 0.15s",
  },

  cardHover: {
    borderColor: C.accent + "66",
  },

  // ─── Tables ───
  table: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: 13,
  },

  th: {
    textAlign: "left",
    padding: "10px 12px",
    fontSize: 11,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    color: C.darkMuted,
    borderBottom: `1px solid ${C.darkBorder}`,
    whiteSpace: "nowrap",
    cursor: "pointer",
    userSelect: "none",
  },

  td: {
    padding: "10px 12px",
    borderBottom: `1px solid ${C.edgeLine}`,
    color: C.darkText,
    verticalAlign: "middle",
  },

  trHover: {
    background: C.darkSurf + "88",
  },

  // ─── Status Pill ───
  pill: (color) => ({
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    color: "#fff",
    background: color,
    borderRadius: RADIUS.pill,
    padding: "3px 10px",
    fontSize: 10,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    lineHeight: 1.6,
    whiteSpace: "nowrap",
  }),

  // ─── Inputs ───
  input: {
    background: C.darkSurf,
    border: `1px solid ${C.darkBorder}`,
    borderRadius: RADIUS.md,
    padding: "8px 12px",
    fontSize: 13,
    fontFamily: FONT,
    color: C.darkText,
    outline: "none",
    transition: "border-color 0.15s, box-shadow 0.15s",
    width: "100%",
  },

  inputFocused: {
    borderColor: C.accent,
    boxShadow: `0 0 0 2px ${C.accent}33`,
  },

  inputDark: {
    background: C.darkSurf,
    border: `1px solid ${C.darkBorder}`,
    borderRadius: RADIUS.md,
    padding: "8px 12px",
    fontSize: 13,
    fontFamily: FONT,
    color: C.darkText,
    outline: "none",
    transition: "border-color 0.15s",
  },

  select: {
    background: C.darkSurf,
    border: `1px solid ${C.darkBorder}`,
    borderRadius: RADIUS.md,
    padding: "8px 12px",
    fontSize: 13,
    fontFamily: FONT,
    color: C.darkText,
    outline: "none",
    cursor: "pointer",
    appearance: "none",
    width: "100%",
  },

  // ─── Modal / Drawer Overlay ───
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.55)",
    zIndex: 100,
    display: "flex",
    alignItems: "stretch",
    justifyContent: "flex-end",
  },

  drawer: {
    width: 480,
    maxWidth: "92vw",
    background: C.darkSurf,
    borderLeft: `1px solid ${C.darkBorder}`,
    display: "flex",
    flexDirection: "column",
    boxShadow: SHADOW.dropdown,
    overflowY: "auto",
  },

  // ─── Badges ───
  badge: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    background: C.orange,
    color: "#fff",
    fontSize: 10,
    fontWeight: 700,
    padding: "0 5px",
    lineHeight: 1,
  },

  // ─── Typography ───
  h1: {
    fontSize: 22,
    fontWeight: 700,
    letterSpacing: "-0.02em",
    color: C.darkText,
    lineHeight: 1.3,
  },

  h2: {
    fontSize: 17,
    fontWeight: 600,
    letterSpacing: "-0.01em",
    color: C.darkText,
    lineHeight: 1.35,
  },

  h3: {
    fontSize: 14,
    fontWeight: 600,
    color: C.darkText,
    lineHeight: 1.4,
  },

  label: {
    fontSize: 11,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    color: C.darkMuted,
    marginBottom: 4,
  },

  caption: {
    fontSize: 12,
    color: C.darkMuted,
    lineHeight: 1.4,
  },

  // ─── Code ───
  code: {
    fontFamily: MONO,
    fontSize: 12,
    background: C.darkSurf2,
    borderRadius: RADIUS.sm,
    padding: "2px 6px",
    color: C.darkMuted,
  },

  codeBlock: {
    fontFamily: MONO,
    fontSize: 12,
    background: "#111111",
    color: C.darkText,
    borderRadius: RADIUS.lg,
    padding: "14px 18px",
    overflowX: "auto",
    lineHeight: 1.55,
    margin: "8px 0",
  },

  // ─── Divider ───
  divider: {
    height: 1,
    background: C.edgeLine,
    margin: "12px 0",
    border: "none",
  },

  // ─── Empty State ───
  empty: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: 48,
    gap: 12,
    color: C.darkMuted,
    fontSize: 14,
    textAlign: "center",
  },

  // ─── Thinking Dots ───
  thinkingDot: (i) => ({
    width: 4,
    height: 4,
    borderRadius: "50%",
    background: C.darkMuted,
  }),

  // ─── Tooltip ───
  tooltip: {
    position: "absolute",
    background: C.darkSurf2,
    color: C.darkText,
    fontSize: 11,
    padding: "4px 8px",
    borderRadius: RADIUS.sm,
    whiteSpace: "nowrap",
    pointerEvents: "none",
    zIndex: 200,
    boxShadow: SHADOW.dropdown,
  },

  // ─── Dropdown ───
  dropdown: {
    position: "absolute",
    background: C.darkSurf,
    border: `1px solid ${C.darkBorder}`,
    borderRadius: RADIUS.lg,
    boxShadow: SHADOW.dropdown,
    zIndex: 150,
    overflowY: "auto",
    maxHeight: 280,
    minWidth: 160,
  },

  dropdownItem: {
    padding: "8px 14px",
    fontSize: 13,
    cursor: "pointer",
    transition: "background 0.1s",
    color: C.darkText,
    border: "none",
    background: "transparent",
    width: "100%",
    textAlign: "left",
    fontFamily: FONT,
  },

  dropdownItemHover: {
    background: C.darkSurf2,
  },
};
