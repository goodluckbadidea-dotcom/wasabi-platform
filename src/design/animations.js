// ─── Wasabi Platform Animations ───
// All @keyframes + one-time injection utility

const KEYFRAMES = `
@keyframes fadeUp {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: translateY(0); }
}

@keyframes fadeIn {
  from { opacity: 0; }
  to   { opacity: 1; }
}

@keyframes rowReveal {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: translateY(0); }
}

@keyframes drawerFade {
  from { opacity: 0; }
  to   { opacity: 1; }
}

@keyframes drawerSlide {
  from { transform: translateX(100%); }
  to   { transform: translateX(0); }
}

@keyframes drawerSlideLeft {
  from { transform: translateX(-100%); }
  to   { transform: translateX(0); }
}

@keyframes bounce {
  0%, 80%, 100% { transform: translateY(0); }
  40% { transform: translateY(-4px); }
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

@keyframes blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}

@keyframes pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.6; transform: scale(0.85); }
}

@keyframes fadeSlideIn {
  from { opacity: 0; transform: translateY(-6px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes coordMorph {
  0%   { border-radius: 42% 58% 52% 48% / 46% 54% 46% 54%; }
  25%  { border-radius: 52% 48% 42% 58% / 54% 46% 54% 46%; }
  50%  { border-radius: 48% 52% 58% 42% / 46% 54% 46% 54%; }
  75%  { border-radius: 58% 42% 48% 52% / 54% 46% 54% 46%; }
  100% { border-radius: 42% 58% 52% 48% / 46% 54% 46% 54%; }
}

@keyframes coordPulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.04); }
}

@keyframes slideUp {
  from { opacity: 0; transform: translateY(12px); }
  to   { opacity: 1; transform: translateY(0); }
}

@keyframes scaleIn {
  from { opacity: 0; transform: scale(0.92); }
  to   { opacity: 1; transform: scale(1); }
}

@keyframes shimmer {
  0%   { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}

@keyframes navDrop {
  from { opacity: 0; transform: translateY(-6px) scale(0.96); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}

@keyframes panelSlideIn {
  from { width: 0; opacity: 0; }
  to   { opacity: 1; }
}

@keyframes slideInRight {
  from { transform: translateX(100%); opacity: 0; }
  to   { transform: translateX(0); opacity: 1; }
}

@keyframes nodeGlow {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 1; }
}

@keyframes dashFlow {
  to { stroke-dashoffset: -20; }
}

@keyframes snapUp {
  0%   { opacity: 0; transform: translateY(10px) scale(0.98); }
  60%  { opacity: 1; transform: translateY(-2px) scale(1.005); }
  80%  { transform: translateY(1px) scale(0.998); }
  100% { opacity: 1; transform: translateY(0) scale(1); }
}

@keyframes popIn {
  0%   { opacity: 0; transform: scale(0.92); }
  50%  { opacity: 1; transform: scale(1.03); }
  75%  { transform: scale(0.99); }
  100% { opacity: 1; transform: scale(1); }
}

@keyframes snapDown {
  0%   { opacity: 0; transform: translateY(-8px) scale(0.97); }
  60%  { opacity: 1; transform: translateY(2px) scale(1.005); }
  80%  { transform: translateY(-0.5px) scale(0.999); }
  100% { opacity: 1; transform: translateY(0) scale(1); }
}

@keyframes snapInRight {
  0%   { opacity: 0; transform: translateX(20px); }
  60%  { opacity: 1; transform: translateX(-3px); }
  80%  { transform: translateX(1px); }
  100% { opacity: 1; transform: translateX(0); }
}

@keyframes snapInLeft {
  0%   { opacity: 0; transform: translateX(-20px); }
  60%  { opacity: 1; transform: translateX(3px); }
  80%  { transform: translateX(-1px); }
  100% { opacity: 1; transform: translateX(0); }
}

@keyframes settleIn {
  0%   { opacity: 0; transform: translateY(6px) scale(0.96); }
  70%  { opacity: 1; transform: translateY(-1px) scale(1.01); }
  100% { opacity: 1; transform: translateY(0) scale(1); }
}

@keyframes modalPop {
  0%   { opacity: 0; transform: scale(0.88) translateY(8px); }
  50%  { opacity: 1; transform: scale(1.02) translateY(-2px); }
  75%  { transform: scale(0.995) translateY(0.5px); }
  100% { opacity: 1; transform: scale(1) translateY(0); }
}

@keyframes backdropFade {
  from { opacity: 0; }
  to   { opacity: 1; }
}

/* contentSwap — opacity-only. A non-none transform on the wrapper creates
   a new CSS containing block; position:fixed popups inside (context
   menus, dropdowns) get offset relative to the wrapper instead of the
   viewport. Opacity-only keeps the fade without that side effect. */
@keyframes contentSwap {
  0%   { opacity: 0; }
  100% { opacity: 1; }
}

@keyframes scrollReveal {
  0%   { opacity: 0; transform: translateY(5px) scale(0.995); }
  70%  { opacity: 1; transform: translateY(-0.5px) scale(1.002); }
  100% { opacity: 1; transform: translateY(0) scale(1); }
}

@keyframes fadeOut {
  from { opacity: 1; transform: scale(1); }
  to   { opacity: 0; transform: scale(0.96); }
}

@keyframes slideOutRight {
  from { transform: translateX(0); opacity: 1; }
  to   { transform: translateX(100%); opacity: 0; }
}

@keyframes slideOutLeft {
  from { transform: translateX(0); opacity: 1; }
  to   { transform: translateX(-100%); opacity: 0; }
}

@keyframes backdropFadeOut {
  from { opacity: 1; }
  to   { opacity: 0; }
}
`;

let injected = false;

/**
 * Inject all @keyframes into the document <head> once.
 * Safe to call multiple times — only injects on first call.
 */
export function injectAnimations() {
  if (injected || typeof document === "undefined") return;
  const style = document.createElement("style");
  style.id = "wasabi-animations";
  style.textContent = KEYFRAMES;
  document.head.appendChild(style);
  injected = true;
}

// Bouncy easing curve — slight overshoot, settles into place
const BOUNCE_EASE = "cubic-bezier(0.34, 1.56, 0.64, 1)";
const SETTLE_EASE = "cubic-bezier(0.22, 1.2, 0.36, 1)";

// Animation presets for components
export const ANIM = {
  fadeUp:      (delay = 0) => `fadeUp 0.25s ease ${delay}s both`,
  fadeIn:      (delay = 0) => `fadeIn 0.2s ease ${delay}s both`,
  rowReveal:   (idx = 0) => `rowReveal 0.2s ease ${idx * 0.02}s both`,
  drawerFade:  "drawerFade 0.18s ease",
  drawerSlide: "drawerSlide 0.22s cubic-bezier(0.16,1,0.3,1)",
  drawerSlideLeft: "drawerSlideLeft 0.22s cubic-bezier(0.16,1,0.3,1)",
  bounce:      (i = 0) => `bounce 1.2s ease-in-out ${i * 0.18}s infinite`,
  spin:        "spin 1s linear infinite",
  blink:       "blink 2.4s ease-in-out infinite",
  pulse:       "pulse 2s ease-in-out infinite",
  coordMorph:  "coordMorph 4s ease-in-out infinite",
  coordPulse:  "coordPulse 3s ease-in-out infinite",
  slideUp:     (delay = 0) => `slideUp 0.3s ease ${delay}s both`,
  scaleIn:     (delay = 0) => `scaleIn 0.2s ease ${delay}s both`,
  navDrop:     "navDrop 0.18s cubic-bezier(0.16,1,0.3,1)",
  panelSlideIn: "panelSlideIn 0.25s cubic-bezier(0.4,0,0.2,1)",
  nodeGlow:     "nodeGlow 1.5s ease-in-out infinite",
  dashFlow:     "dashFlow 0.6s linear infinite",

  // ── Bouncy / settling presets ──
  snapUp:      (delay = 0) => `snapUp 0.35s ${SETTLE_EASE} ${delay}s both`,
  popIn:       (delay = 0) => `popIn 0.3s ${BOUNCE_EASE} ${delay}s both`,
  snapDown:    (delay = 0) => `snapDown 0.3s ${SETTLE_EASE} ${delay}s both`,
  snapInRight: (delay = 0) => `snapInRight 0.32s ${SETTLE_EASE} ${delay}s both`,
  snapInLeft:  (delay = 0) => `snapInLeft 0.32s ${SETTLE_EASE} ${delay}s both`,
  settleIn:    (delay = 0) => `settleIn 0.28s ${SETTLE_EASE} ${delay}s both`,
  modalPop:    (delay = 0) => `modalPop 0.35s ${SETTLE_EASE} ${delay}s both`,
  backdropFade: "backdropFade 0.2s ease both",
  contentSwap: (delay = 0) => `contentSwap 0.38s ${SETTLE_EASE} ${delay}s both`,

  // Staggered list item entrance (bouncy)
  listItem:    (idx = 0) => `settleIn 0.28s ${SETTLE_EASE} ${idx * 0.03}s both`,

  // Table row scroll reveal (subtle, fast, playful)
  scrollReveal: (idx = 0) => `scrollReveal 0.22s ${SETTLE_EASE} ${idx * 0.015}s both`,

  // ── Exit animations ──
  fadeOut:          (dur = 0.18) => `fadeOut ${dur}s ease both`,
  slideOutRight:   "slideOutRight 0.22s cubic-bezier(0.4,0,1,1) both",
  slideOutLeft:    "slideOutLeft 0.22s cubic-bezier(0.4,0,1,1) both",
  backdropFadeOut: "backdropFadeOut 0.18s ease both",
};

// Common transition presets for inline styles
export const TRANSITION = {
  // Smooth hover transitions
  hover: "all 0.18s cubic-bezier(0.4, 0, 0.2, 1)",
  // Snappy size/position transitions
  snap: "all 0.25s cubic-bezier(0.22, 1.2, 0.36, 1)",
  // Sidebar collapse/expand — smooth deceleration, no overshoot (avoids content jitter)
  sidebar: "width 0.32s cubic-bezier(0.25, 1, 0.5, 1), padding 0.32s cubic-bezier(0.25, 1, 0.5, 1)",
  // Panel slide
  panel: "transform 0.3s cubic-bezier(0.22, 1.2, 0.36, 1), opacity 0.25s ease",
  // Color/background fade
  color: "background 0.15s ease, color 0.15s ease, border-color 0.15s ease",
  // Panel resize — smooth deceleration, no overshoot (matches sidebar easing)
  panelResize: "width 0.28s cubic-bezier(0.25, 1, 0.5, 1)",
};

// ── Global Interaction Styles ──
// Injects :active press feedback + :focus-visible keyboard ring.
// Uses CSS custom property --wasabi-accent set by updateCSSCustomProperties().

let interactionsInjected = false;

export function injectInteractionStyles() {
  if (interactionsInjected || typeof document === "undefined") return;
  const style = document.createElement("style");
  style.id = "wasabi-interactions";
  style.textContent = `
    /* Active press feedback */
    button:active:not(:disabled),
    [role="button"]:active,
    a:active {
      transform: scale(0.98) !important;
      transition: transform 0.08s ease !important;
    }

    /* Focus-visible keyboard ring */
    button:focus-visible,
    input:focus-visible,
    select:focus-visible,
    textarea:focus-visible,
    [role="button"]:focus-visible,
    a:focus-visible {
      outline: 2px solid var(--wasabi-accent, #5CC63A);
      outline-offset: 2px;
    }

    /* Suppress default outline for mouse/touch users */
    :focus:not(:focus-visible) {
      outline: none;
    }
  `;
  document.head.appendChild(style);
  interactionsInjected = true;
}

// ── Dynamic Scrollbar Styles ──
// Re-injectable on theme change — updates existing style tag.

let scrollbarStyleEl = null;

function _buildScrollbarCSS(C) {
  const thumb = C.darkBorder;
  const thumbHover = C.darkMuted;
  return `
    ::-webkit-scrollbar { width: 6px; height: 6px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: ${thumb}; border-radius: 3px; }
    ::-webkit-scrollbar-thumb:hover { background: ${thumbHover}; }
    * { scrollbar-width: thin; scrollbar-color: ${thumb} transparent; }
  `;
}

export function injectScrollbarStyles(C) {
  if (typeof document === "undefined") return;
  if (!scrollbarStyleEl) {
    scrollbarStyleEl = document.createElement("style");
    scrollbarStyleEl.id = "wasabi-scrollbars";
    document.head.appendChild(scrollbarStyleEl);
  }
  scrollbarStyleEl.textContent = _buildScrollbarCSS(C);
}

// ── CSS Custom Properties ──
// Sets accent color on <html> for use by injected interaction CSS.

export function updateCSSCustomProperties(C) {
  if (typeof document === "undefined") return;
  document.documentElement.style.setProperty("--wasabi-accent", C.accent);
}
