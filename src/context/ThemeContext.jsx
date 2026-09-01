// ─── Theme Context ───
// Provides theme name selection.
// Mode is inherent to each theme (no dark/light toggle).

import React, { createContext, useContext, useState, useCallback } from "react";
import { C, getThemeName, getThemeMode, applyTheme, THEMES } from "../design/tokens.js";
import { rebuildStyles } from "../design/styles.js";
import { injectScrollbarStyles, updateCSSCustomProperties } from "../design/animations.js";

const ThemeContext = createContext({
  themeName: "fuji",
  themeMode: "dark",
  setThemeName: () => {},
  toggleMode: () => {},
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
    injectScrollbarStyles(C);
    updateCSSCustomProperties(C);
    _setThemeName(name);
    // Mode is inherent to the theme
    const theme = THEMES[name];
    if (theme) _setThemeMode(theme.mode);
  }, []);

  // toggleMode cycles to next theme
  const toggleMode = useCallback(() => {
    const keys = Object.keys(THEMES);
    const idx = keys.indexOf(themeName);
    const next = keys[(idx + 1) % keys.length];
    setThemeName(next);
  }, [themeName, setThemeName]);

  return (
    <ThemeContext.Provider value={{
      themeName,
      themeMode,
      setThemeName,
      toggleMode,
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
