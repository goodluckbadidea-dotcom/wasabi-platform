// ─── Theme Context ───
// Provides theme name selection.
// Mode is inherent to each theme (no dark/light toggle).
// Theme persists independently. App is always in "zen" mode.

import React, { createContext, useContext, useState, useCallback } from "react";
import { getThemeName, getThemeMode, applyTheme, THEMES } from "../design/tokens.js";
import { rebuildStyles } from "../design/styles.js";

const ThemeContext = createContext({
  themeName: "obsidian",
  themeMode: "dark",
  appMode: "zen",
  setThemeName: () => {},
  toggleMode: () => {},
  setAppMode: () => {},
  // Backward compat aliases
  theme: "dark",
  toggleTheme: () => {},
});

export function ThemeProvider({ children }) {
  const [themeName, _setThemeName] = useState(getThemeName);
  const [themeMode, _setThemeMode] = useState(getThemeMode);

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

  // setAppMode kept as no-op for any straggling callers
  const setAppMode = useCallback(() => {}, []);

  return (
    <ThemeContext.Provider value={{
      themeName,
      themeMode,
      appMode: "zen",
      setThemeName,
      toggleMode,
      setAppMode,
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
