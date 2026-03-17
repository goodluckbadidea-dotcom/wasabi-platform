// ─── Sashimi Drawer Context ───
// Shared context for the right-side detail drawer.
// Any component can call openDrawer("task", data) or openDrawer("event", data)
// to open the drawer from anywhere in the view tree.
// Components can register onSave/onDelete listeners via the context
// so the drawer can notify any interested view after a save — regardless of
// which view originally rendered the drawer.

import React, { createContext, useContext, useState, useCallback, useRef } from "react";

const SashimiDrawerContext = createContext({
  drawerItem: null,
  openDrawer: () => {},
  closeDrawer: () => {},
  updateDrawerItem: () => {},
  notifySaved: () => {},
  notifyDeleted: () => {},
  onSaved: () => () => {},
  onDeleted: () => () => {},
});

export function SashimiDrawerProvider({ children }) {
  const [drawerItem, setDrawerItem] = useState(null);
  const saveListeners = useRef(new Set());
  const deleteListeners = useRef(new Set());

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

  // Call all registered save listeners (drawer calls this after save)
  const notifySaved = useCallback((type, data) => {
    for (const fn of saveListeners.current) fn(type, data);
  }, []);

  const notifyDeleted = useCallback((type, data) => {
    for (const fn of deleteListeners.current) fn(type, data);
  }, []);

  // Register a save listener — returns unsubscribe function
  const onSaved = useCallback((fn) => {
    saveListeners.current.add(fn);
    return () => saveListeners.current.delete(fn);
  }, []);

  const onDeleted = useCallback((fn) => {
    deleteListeners.current.add(fn);
    return () => deleteListeners.current.delete(fn);
  }, []);

  return (
    <SashimiDrawerContext.Provider value={{
      drawerItem, openDrawer, closeDrawer, updateDrawerItem,
      notifySaved, notifyDeleted, onSaved, onDeleted,
    }}>
      {children}
    </SashimiDrawerContext.Provider>
  );
}

export function useSashimiDrawer() {
  return useContext(SashimiDrawerContext);
}
