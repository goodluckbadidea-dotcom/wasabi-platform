// ─── Wasabi Interaction Utilities ───
// Shared hover and focus helpers for consistent interactive states.
// Import into any component: import { hoverBg, focusRing } from "../design/interactions.js";

import { C } from "./tokens.js";

/**
 * Hover background via inline event handlers.
 * Spread onto any element: <button {...hoverBg()} />
 * Custom colors: <div {...hoverBg(C.accent + "10", C.darkSurf)} />
 */
export const hoverBg = (bg = C.darkSurf2, reset = "transparent") => ({
  onMouseEnter: (e) => { e.currentTarget.style.background = bg; },
  onMouseLeave: (e) => { e.currentTarget.style.background = reset; },
});

/**
 * Focus ring for keyboard accessibility.
 * Uses :focus-visible to only show ring on keyboard navigation, not mouse clicks.
 * Spread onto any focusable element: <button {...focusRing()} />
 */
export const focusRing = (color = C.accent) => ({
  onFocus: (e) => {
    if (e.target.matches(":focus-visible")) {
      e.currentTarget.style.outline = `2px solid ${color}`;
      e.currentTarget.style.outlineOffset = "2px";
    }
  },
  onBlur: (e) => {
    e.currentTarget.style.outline = "none";
    e.currentTarget.style.outlineOffset = "";
  },
});
