// ─── Sashimi Drawer Context ───
// Shared context for the right-side detail drawer in Sashimi mode.
// Any component can call openDrawer("task", data) or openDrawer("event", data)
// to open the drawer from anywhere in the Sashimi view tree.

import React, { createContext, useContext, useState, useCallback } from "react";

const SashimiDrawerContext = createContext({
  drawerItem: null,
  openDrawer: () => {},
  closeDrawer: () => {},
  updateDrawerItem: () => {},
});

export function SashimiDrawerProvider({ children }) {
  const [drawerItem, setDrawerItem] = useState(null);

  const openDrawer = useCallback((type, data) => {
    setDrawerItem({ type, data });
  }, []);

  const closeDrawer = useCallback(() => {
    setDrawerItem(null);
  }, []);

  const updateDrawerItem = useCallback((updates) => {
    setDrawerItem((prev) =>
      prev ? { ...prev, data: { ...prev.data, ...updates } } : null
    );
  }, []);

  return (
    <SashimiDrawerContext.Provider value={{ drawerItem, openDrawer, closeDrawer, updateDrawerItem }}>
      {children}
    </SashimiDrawerContext.Provider>
  );
}

export function useSashimiDrawer() {
  return useContext(SashimiDrawerContext);
}
