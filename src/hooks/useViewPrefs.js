// ─── Per-User View Preferences ───
// Stores user-specific view overrides (filters, sorts, visible columns) in D1 via user_state.
// Shared pageConfig provides defaults; user overrides win when present.

import { useState, useEffect, useCallback, useRef } from "react";
import { getUserState, putUserState } from "../lib/api.js";
import { usePlatform } from "../context/PlatformContext.jsx";

export default function useViewPrefs() {
  const { identity } = usePlatform();
  const [prefs, setPrefs] = useState({});
  const prefsRef = useRef({});
  const saveTimerRef = useRef(null);
  const loadedRef = useRef(false);

  // Load on identity available
  useEffect(() => {
    if (!identity?.id) return;
    if (loadedRef.current) return;
    loadedRef.current = true;
    getUserState().then((res) => {
      const vp = res?.state?.view_prefs || {};
      setPrefs(vp);
      prefsRef.current = vp;
    }).catch(err => console.warn("[useViewPrefs] getUserState:", err.message || err));
    return () => { loadedRef.current = false; };
  }, [identity?.id]);

  // Debounced save (500ms)
  const flushSave = useCallback(() => {
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      putUserState({ view_prefs: prefsRef.current }).catch((err) =>
        console.warn("[ViewPrefs] Save failed:", err.message)
      );
    }, 500);
  }, []);

  // Cleanup timer on unmount
  useEffect(() => () => clearTimeout(saveTimerRef.current), []);

  // Get effective config: shared defaults merged with user overrides
  const getEffectiveConfig = useCallback((pageId, viewIdx, sharedConfig) => {
    const key = `${pageId}_${viewIdx}`;
    const userOverrides = prefsRef.current[key];
    if (!userOverrides) return sharedConfig;
    return { ...sharedConfig, ...userOverrides };
  }, []);

  // Save user-specific view config override
  const setUserViewConfig = useCallback((pageId, viewIdx, overrides) => {
    const key = `${pageId}_${viewIdx}`;
    const updated = { ...prefsRef.current, [key]: { ...(prefsRef.current[key] || {}), ...overrides } };
    prefsRef.current = updated;
    setPrefs(updated);
    flushSave();
  }, [flushSave]);

  // Clear user overrides (reset to shared defaults)
  const clearUserViewConfig = useCallback((pageId, viewIdx) => {
    const key = `${pageId}_${viewIdx}`;
    const updated = { ...prefsRef.current };
    delete updated[key];
    prefsRef.current = updated;
    setPrefs(updated);
    flushSave();
  }, [flushSave]);

  return { prefs, getEffectiveConfig, setUserViewConfig, clearUserViewConfig };
}
