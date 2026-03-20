// ─── Zen Dashboard ───
// Generic widget dashboard.
// Wraps WidgetGrid with D1 per-user persistence (localStorage as write-through cache).
// Users can pin views, shortcuts, text blocks, and plugin widgets.

import React, { useState, useCallback, useEffect, useRef } from "react";
import { C, FONT, FONT_DISPLAY, RADIUS } from "../design/tokens.js";
import { ANIM } from "../design/animations.js";
import WidgetGrid from "../components/WidgetGrid.jsx";
import RecordDrawer from "./RecordDrawer.jsx";
import { usePlatform } from "../context/PlatformContext.jsx";
import { useUserSync } from "../context/UserSyncContext.jsx";
import { getUserDashboard, putUserDashboard } from "../lib/api.js";

function storageKey(userId) {
  return userId ? `wasabi-dashboard-widgets:${userId}` : "wasabi-dashboard-widgets:default";
}

function loadWidgetsLocal(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveWidgetsLocal(key, widgets) {
  try {
    localStorage.setItem(key, JSON.stringify(widgets));
  } catch {}
}

export default function DashboardView() {
  const { identity } = usePlatform();
  const userSync = useUserSync();
  const key = storageKey(identity?.id);
  const [widgets, setWidgets] = useState(() => loadWidgetsLocal(key));
  const saveTimerRef = useRef(null);
  const hasLoadedFromD1 = useRef(false);
  const prevIdentityId = useRef(identity?.id);
  const isRemoteUpdate = useRef(false);

  // ── Reload widgets when user changes ──
  useEffect(() => {
    if (prevIdentityId.current !== identity?.id) {
      prevIdentityId.current = identity?.id;
      hasLoadedFromD1.current = false;
      const newKey = storageKey(identity?.id);
      setWidgets(loadWidgetsLocal(newKey));
    }
  }, [identity?.id]);

  // ── Load from D1 per-user on mount ──
  useEffect(() => {
    if (!identity?.id || hasLoadedFromD1.current) return;
    hasLoadedFromD1.current = true;
    getUserDashboard()
      .then(({ widgets: w }) => {
        if (w && w.length > 0) {
          setWidgets(w);
          saveWidgetsLocal(key, w);
        }
      })
      .catch(() => {}); // Fall back to localStorage
  }, [identity, key]);

  // ── Listen for dashboard updates from other devices ──
  useEffect(() => {
    if (!userSync?.onDashboardUpdate) return;
    return userSync.onDashboardUpdate((remoteWidgets) => {
      if (remoteWidgets && Array.isArray(remoteWidgets)) {
        isRemoteUpdate.current = true;
        setWidgets(remoteWidgets);
        saveWidgetsLocal(key, remoteWidgets);
        // Don't save to D1 — the sending device already did
      }
    });
  }, [userSync, key]);

  // Persist on every change (localStorage immediate, D1 debounced, broadcast to other devices)
  const handleUpdateWidgets = useCallback((newWidgets) => {
    setWidgets(newWidgets);
    saveWidgetsLocal(key, newWidgets);

    // If this was triggered by a remote update, skip D1 save and broadcast
    if (isRemoteUpdate.current) {
      isRemoteUpdate.current = false;
      return;
    }

    // Broadcast to other devices via WebSocket
    userSync?.sendDashboardUpdate(newWidgets);

    // Debounced D1 save
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      putUserDashboard(newWidgets).catch(() => {});
    }, 1000);
  }, [key, userSync]);

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
          fontSize: 18, fontWeight: 600, fontFamily: FONT_DISPLAY, color: C.darkText,
          display: "flex", alignItems: "center", gap: 10,
          animation: ANIM.snapUp(0.03),
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
      <RecordDrawer />
    </div>
  );
}
