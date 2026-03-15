// ─── Zen Dashboard ───
// Generic widget dashboard for Sashimi mode.
// Wraps WidgetGrid with localStorage persistence.
// Users can pin views, shortcuts, text blocks, and plugin widgets.

import React, { useState, useCallback, useEffect } from "react";
import { C, FONT, RADIUS } from "../design/tokens.js";
import { ANIM } from "../design/animations.js";
import WidgetGrid from "../components/WidgetGrid.jsx";
import SashimiDrawer from "./SashimiDrawer.jsx";

const STORAGE_KEY = "wasabi-zen-dashboard-widgets";

function loadWidgets() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveWidgets(widgets) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(widgets));
  } catch {}
}

export default function ZenDashboard() {
  const [widgets, setWidgets] = useState(() => loadWidgets());

  // Persist on every change
  const handleUpdateWidgets = useCallback((newWidgets) => {
    setWidgets(newWidgets);
    saveWidgets(newWidgets);
  }, []);

  return (
    <div style={{
      flex: 1, display: "flex", flexDirection: "column",
      overflow: "hidden", background: C.dark,
    }}>
      {/* Header */}
      <div style={{
        flexShrink: 0, padding: "14px 20px 12px",
        borderBottom: `1px solid ${C.darkBorder}`,
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <div style={{
          fontSize: 18, fontWeight: 600, fontFamily: FONT, color: C.darkText,
          display: "flex", alignItems: "center", gap: 10,
        }}>
          <svg width="20" height="20" viewBox="0 0 16 16" fill="none">
            <rect x="1" y="1" width="6" height="6" rx="1.5" stroke={C.accent} strokeWidth="1.3" fill="none" />
            <rect x="9" y="1" width="6" height="6" rx="1.5" stroke={C.accent} strokeWidth="1.3" fill="none" />
            <rect x="1" y="9" width="6" height="6" rx="1.5" stroke={C.accent} strokeWidth="1.3" fill="none" />
            <rect x="9" y="9" width="6" height="6" rx="1.5" stroke={C.accent} strokeWidth="1.3" fill="none" />
          </svg>
          Dashboard
        </div>
      </div>

      {/* Widget canvas */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden", animation: ANIM.contentSwap() }}>
        <WidgetGrid
          widgets={widgets}
          onUpdateWidgets={handleUpdateWidgets}
        />
      </div>

      {/* Sashimi drawer for widget interactions */}
      <SashimiDrawer />
    </div>
  );
}
