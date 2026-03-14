// ─── Theme Context ───
// Provides theme name selection and app mode (Zen / Samurai).
// Mode is inherent to each theme (no dark/light toggle).
// App mode persists in localStorage and triggers theme inversion on switch.

import React, { createContext, useContext, useState, useCallback } from "react";
import { getThemeName, getThemeMode, applyTheme, THEMES, INVERSE_THEME } from "../design/tokens.js";
import { rebuildStyles } from "../design/styles.js";

// Resolve initial app mode from localStorage
function _resolveAppMode() {
  if (typeof localStorage === "undefined") return "samurai";
  return localStorage.getItem("wasabi-app-mode") || "samurai";
}

const ThemeContext = createContext({
  themeName: "obsidian",
  themeMode: "dark",
  appMode: "samurai",
  setThemeName: () => {},
  toggleMode: () => {},
  setAppMode: () => {},
  toggleAppMode: () => {},
  // Backward compat aliases
  theme: "dark",
  toggleTheme: () => {},
});

export function ThemeProvider({ children }) {
  const [themeName, _setThemeName] = useState(getThemeName);
  const [themeMode, _setThemeMode] = useState(getThemeMode);
  const [appMode, _setAppMode] = useState(_resolveAppMode);

  const setThemeName = useCallback((name) => {
    applyTheme(name);
    rebuildStyles();
    _setThemeName(name);
    // Mode is inherent to the theme
    const theme = THEMES[name];
    if (theme) _setThemeMode(theme.mode);
  }, []);

  // toggleMode is kept for backward compat but cycles to next theme instead
  const toggleMode = useCallback(() => {
    const keys = Object.keys(THEMES);
    const idx = keys.indexOf(themeName);
    const next = keys[(idx + 1) % keys.length];
    setThemeName(next);
  }, [themeName, setThemeName]);

  // ── App Mode (Zen / Samurai) ──
  const setAppMode = useCallback((mode) => {
    _setAppMode(mode);
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("wasabi-app-mode", mode);
    }
  }, []);

  const toggleAppMode = useCallback(() => {
    const newMode = appMode === "samurai" ? "zen" : "samurai";
    setAppMode(newMode);
    // Invert theme (dark↔light)
    const inverse = INVERSE_THEME[themeName];
    if (inverse && inverse !== themeName) {
      setThemeName(inverse);
    }
  }, [appMode, themeName, setAppMode, setThemeName]);

  return (
    <ThemeContext.Provider value={{
      themeName,
      themeMode,
      appMode,
      setThemeName,
      toggleMode,
      setAppMode,
      toggleAppMode,
      // Backward compat
      theme: themeMode,
      toggleTheme: toggleMode,
    }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
