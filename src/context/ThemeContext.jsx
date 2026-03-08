// ─── Theme Context ───
// Provides theme name + mode toggle, forces full re-render when theme changes.

import React, { createContext, useContext, useState, useCallback } from "react";
import { getThemeName, getThemeMode, applyTheme } from "../design/tokens.js";
import { rebuildStyles } from "../design/styles.js";

const ThemeContext = createContext({
  themeName: "wasabi",
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
    applyTheme(name, themeMode);
    rebuildStyles();
    _setThemeName(name);
  }, [themeMode]);

  const toggleMode = useCallback(() => {
    const next = themeMode === "dark" ? "light" : "dark";
    applyTheme(themeName, next);
    rebuildStyles();
    _setThemeMode(next);
  }, [themeName, themeMode]);

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
