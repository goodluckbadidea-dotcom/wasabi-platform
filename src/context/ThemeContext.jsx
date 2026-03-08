// ─── Theme Context ───
// Provides theme toggle + forces full re-render when theme changes.

import React, { createContext, useContext, useState, useCallback } from "react";
import { getTheme, applyTheme } from "../design/tokens.js";
import { rebuildStyles } from "../design/styles.js";

const ThemeContext = createContext({ theme: "dark", toggleTheme: () => {} });

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(getTheme);

  const toggleTheme = useCallback(() => {
    const next = theme === "dark" ? "light" : "dark";
    applyTheme(next);
    rebuildStyles();
    setTheme(next);
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
