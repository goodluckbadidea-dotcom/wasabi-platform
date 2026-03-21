// ─── Viewport Context ───
// Shared viewport state for responsive behavior.
// Replaces the local isNarrow detection in App.jsx.
// Any component can import useViewport() to adapt to screen size.

import React, { createContext, useContext, useState, useEffect } from "react";
import { BP } from "../design/tokens.js";

const ViewportContext = createContext({
  isNarrow: false,   // < BP.mobile (phones)
  isTablet: false,   // BP.mobile..BP.tablet (iPad)
  isTouch: false,    // touch-capable device
  width: 1280,       // current viewport width
});

export function ViewportProvider({ children }) {
  const [width, setWidth] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth : 1280
  );

  // Touch detection (stable — doesn't change during session)
  const [isTouch] = useState(() =>
    typeof navigator !== "undefined" && navigator.maxTouchPoints > 0
  );

  // Listen for resize via matchMedia for mobile and tablet breakpoints
  useEffect(() => {
    const mqNarrow = window.matchMedia(`(max-width: ${BP.mobile - 1}px)`);
    const mqTablet = window.matchMedia(`(min-width: ${BP.mobile}px) and (max-width: ${BP.tablet}px)`);

    const update = () => setWidth(window.innerWidth);

    mqNarrow.addEventListener("change", update);
    mqTablet.addEventListener("change", update);
    window.addEventListener("resize", update);

    return () => {
      mqNarrow.removeEventListener("change", update);
      mqTablet.removeEventListener("change", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  const isNarrow = width < BP.mobile;
  const isTablet = width >= BP.mobile && width <= BP.tablet;

  return (
    <ViewportContext.Provider value={{ isNarrow, isTablet, isTouch, width }}>
      {children}
    </ViewportContext.Provider>
  );
}

export function useViewport() {
  return useContext(ViewportContext);
}
