// ─── Dashboard ───
// Thin wrapper around WidgetGrid for folder-level and standalone dashboards.
// Widget logic (CRUD, drag/resize, picker) lives in WidgetGrid.

import React, { useCallback } from "react";
import { usePlatform } from "../context/PlatformContext.jsx";
import WidgetGrid from "../components/WidgetGrid.jsx";

export default function Dashboard({ dashboardConfig, isGlobal }) {
  const { updatePageConfig } = usePlatform();

  const widgets = dashboardConfig?.widgets || [];

  const handleUpdateWidgets = useCallback((newWidgets) => {
    if (!dashboardConfig?.id) return;
    updatePageConfig(dashboardConfig.id, { widgets: newWidgets });
  }, [dashboardConfig, updatePageConfig]);

  return (
    <WidgetGrid
      widgets={widgets}
      onUpdateWidgets={handleUpdateWidgets}
    />
  );
}
