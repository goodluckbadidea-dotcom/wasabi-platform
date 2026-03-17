// ─── Color Mapping Context ───
// Provides unified color mapping resolution across the app.
// Global defaults stored as a synthetic pageConfig (page_type: "color-defaults").
// Per-view overrides stored as synthetic pageConfig entries (page_type: "color-view-config").
// All mappings store palette indices (0-10), not hex values, so they survive theme switches.

import React, { createContext, useContext, useCallback, useMemo } from "react";
import { usePages } from "./PagesContext.jsx";
import { savePageConfig } from "../config/pageConfig.js";

const ColorMappingContext = createContext(null);

const COLOR_DEFAULTS_TYPE = "color-defaults";
const COLOR_VIEW_TYPE = "color-view-config";

// Default global mappings (matches current hardcoded behavior)
const BUILT_IN_DEFAULTS = {
  colorField: null,  // null = auto-detect
  colorMapping: {
    High: 9, Medium: 3, Normal: 4, Low: 6,
    Design: 3, "Waiting on Deposit": 4, "Waiting on Vendor": 2,
    "Awaiting PO": 7, "In Production": 5, "Quality Check": 6,
    Shipping: 1, Delivered: 5, Cancelled: 2,
  },
};

export function ColorMappingProvider({ children }) {
  const { pages, updatePageConfig, addPage } = usePages();

  // Find the global defaults config entry
  const globalConfig = useMemo(
    () => pages.find((p) => p.page_type === COLOR_DEFAULTS_TYPE) || null,
    [pages]
  );

  // Merged global mapping: built-in defaults + user overrides
  const globalColorMapping = useMemo(() => {
    if (!globalConfig) return BUILT_IN_DEFAULTS.colorMapping;
    return { ...BUILT_IN_DEFAULTS.colorMapping, ...(globalConfig.colorMapping || {}) };
  }, [globalConfig]);

  const globalColorField = useMemo(() => {
    return globalConfig?.colorField ?? BUILT_IN_DEFAULTS.colorField;
  }, [globalConfig]);

  // All per-view config entries
  const viewConfigs = useMemo(
    () => pages.filter((p) => p.page_type === COLOR_VIEW_TYPE),
    [pages]
  );

  // Get color config for a specific view
  const getViewColorConfig = useCallback((viewKey) => {
    const entry = viewConfigs.find((p) => p.viewKey === viewKey);
    return entry ? { colorField: entry.colorField, colorMapping: entry.colorMapping || {}, dateChipColors: entry.dateChipColors || null } : null;
  }, [viewConfigs]);

  // Get the effective color mapping for a view (view override merged over global)
  const getEffectiveMapping = useCallback((viewKey) => {
    const viewConfig = getViewColorConfig(viewKey);
    if (!viewConfig) return { colorField: globalColorField, colorMapping: globalColorMapping };
    return {
      colorField: viewConfig.colorField ?? globalColorField,
      colorMapping: { ...globalColorMapping, ...(viewConfig.colorMapping || {}) },
    };
  }, [getViewColorConfig, globalColorField, globalColorMapping]);

  // Update global defaults
  const updateGlobalDefaults = useCallback(async (updates) => {
    if (globalConfig?.id) {
      updatePageConfig(globalConfig.id, updates);
    } else {
      // First time — create the synthetic pageConfig
      const newConfig = {
        name: "Color Defaults",
        icon: "palette",
        type: "page",
        page_type: COLOR_DEFAULTS_TYPE,
        pageType: COLOR_DEFAULTS_TYPE,
        _systemInternal: true,
        databaseIds: [],
        views: [],
        colorField: updates.colorField ?? BUILT_IN_DEFAULTS.colorField,
        colorMapping: { ...BUILT_IN_DEFAULTS.colorMapping, ...(updates.colorMapping || {}) },
      };
      try {
        const id = await savePageConfig(newConfig);
        addPage({ ...newConfig, id });
      } catch (err) {
        console.error("[ColorMapping] Failed to create global defaults:", err);
      }
    }
  }, [globalConfig, updatePageConfig, addPage]);

  // Update per-view color config
  const updateViewColorConfig = useCallback(async (viewKey, updates) => {
    const existing = viewConfigs.find((p) => p.viewKey === viewKey);
    if (existing?.id) {
      updatePageConfig(existing.id, updates);
    } else {
      const newConfig = {
        name: `Color Config: ${viewKey}`,
        icon: "palette",
        type: "page",
        page_type: COLOR_VIEW_TYPE,
        pageType: COLOR_VIEW_TYPE,
        _systemInternal: true,
        viewKey,
        databaseIds: [],
        views: [],
        colorField: updates.colorField ?? null,
        colorMapping: updates.colorMapping || {},
        dateChipColors: updates.dateChipColors || null,
      };
      try {
        const id = await savePageConfig(newConfig);
        addPage({ ...newConfig, id });
      } catch (err) {
        console.error("[ColorMapping] Failed to create view config:", err);
      }
    }
  }, [viewConfigs, updatePageConfig, addPage]);

  // Clear per-view overrides (revert to global defaults)
  const resetViewColorConfig = useCallback(async (viewKey) => {
    const existing = viewConfigs.find((p) => p.viewKey === viewKey);
    if (existing?.id) {
      updatePageConfig(existing.id, { colorField: null, colorMapping: {}, dateChipColors: null });
    }
  }, [viewConfigs, updatePageConfig]);

  const value = useMemo(() => ({
    globalColorMapping,
    globalColorField,
    getViewColorConfig,
    getEffectiveMapping,
    updateGlobalDefaults,
    updateViewColorConfig,
    resetViewColorConfig,
    globalConfig,
  }), [
    globalColorMapping, globalColorField,
    getViewColorConfig, getEffectiveMapping,
    updateGlobalDefaults, updateViewColorConfig,
    resetViewColorConfig, globalConfig,
  ]);

  return (
    <ColorMappingContext.Provider value={value}>
      {children}
    </ColorMappingContext.Provider>
  );
}

export function useColorMapping() {
  const ctx = useContext(ColorMappingContext);
  if (!ctx) throw new Error("useColorMapping must be used within ColorMappingProvider");
  return ctx;
}
