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
};
