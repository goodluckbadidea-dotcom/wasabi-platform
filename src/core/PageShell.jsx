// ─── Page Shell ───
// Loads a page config, fetches data, renders the active view based on sidebar sub-nav.
// The page header is now in TopHeader. This component focuses on data + view rendering.

import React, { useState, useEffect, useCallback, useRef } from "react";
import { C, FONT, RADIUS } from "../design/tokens.js";
import { S } from "../design/styles.js";
import { usePlatform } from "../context/PlatformContext.jsx";
import { queryAll } from "../notion/pagination.js";
import { detectSchema } from "../notion/schema.js";
import { updatePage, createPage } from "../notion/client.js";
import ViewRenderer from "../views/ViewRenderer.jsx";
import ChatPanel from "../views/ChatPanel.jsx";
import { ViewSkeleton } from "./ErrorBoundary.jsx";
import { IconWarning, IconRefresh } from "../design/icons.jsx";

const DEFAULT_REFRESH_MS = 30000; // 30 seconds

export default function PageShell({ pageConfig, activeViewIndex = 0 }) {
  const { user } = usePlatform();
  const [data, setData] = useState([]);
  const [schema, setSchema] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const refreshTimer = useRef(null);

  // Get the active view config based on sidebar selection
  const views = pageConfig.views || [];
  const activeView = views[activeViewIndex] || views[0];

  // Fetch data from all connected databases
  const fetchData = useCallback(async () => {
    if (!user?.workerUrl || !user?.notionKey || !pageConfig.databaseIds?.length) return;

    try {
      // Fetch schema for primary database
      const primaryDbId = pageConfig.databaseIds[0];
      const dbSchema = await detectSchema(user.workerUrl, user.notionKey, primaryDbId);
      setSchema(dbSchema);

      // Fetch data from all databases
      const allData = [];
      for (const dbId of pageConfig.databaseIds) {
        const results = await queryAll(user.workerUrl, user.notionKey, dbId);
        allData.push(...results.map((r) => ({ ...r, _databaseId: dbId })));
      }
      setData(allData);
      setError(null);
    } catch (err) {
      console.error("Failed to fetch page data:", err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [user, pageConfig]);

  // Initial fetch
  useEffect(() => {
    setLoading(true);
    fetchData();
  }, [fetchData]);

  // Periodic refresh — configurable per page via pageConfig.refreshInterval (ms)
  const refreshMs = pageConfig.refreshInterval ?? DEFAULT_REFRESH_MS;
  useEffect(() => {
    if (refreshMs <= 0) return; // 0 or negative disables auto-refresh
    refreshTimer.current = setInterval(fetchData, refreshMs);
    return () => clearInterval(refreshTimer.current);
  }, [fetchData, refreshMs]);

  // Handle inline edits from views
  // Views call: onUpdate(pageId, fieldName, builtPropObject)
  // where builtPropObject is already constructed via buildProp()
  const handleUpdate = useCallback(
    async (pageId, propertyName, propPayload) => {
      try {
        if (propPayload) {
          await updatePage(user.workerUrl, user.notionKey, pageId, {
            [propertyName]: propPayload,
          });
          // Optimistic: update local data
          setData((prev) =>
            prev.map((page) => {
              if (page.id !== pageId) return page;
              return {
                ...page,
                properties: {
                  ...page.properties,
                  [propertyName]: {
                    ...page.properties[propertyName],
                    ...propPayload,
                  },
                },
              };
            })
          );
          // Full refresh after write
          setTimeout(fetchData, 500);
        }
      } catch (err) {
        console.error("Update failed:", err);
      }
    },
    [user, fetchData]
  );

  // Handle new record creation from Form view
  const handleCreate = useCallback(
    async (databaseId, properties) => {
      try {
        await createPage(user.workerUrl, user.notionKey, databaseId, properties);
        // Refresh to show the new record
        await fetchData();
      } catch (err) {
        console.error("Create failed:", err);
        throw err; // Let the Form view handle the error
      }
    },
    [user, fetchData]
  );

  if (loading && data.length === 0) {
    const firstViewType = activeView?.type || "default";
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
        {/* Compact header skeleton */}
        <div
          style={{
            height: 40,
            minHeight: 40,
            display: "flex",
            alignItems: "center",
            padding: "0 20px",
            borderBottom: `1px solid ${C.edgeLine}`,
            background: C.dark,
            gap: 12,
          }}
        >
          <span style={{ fontSize: 11, color: C.darkMuted }}>Loading...</span>
        </div>
        {/* View-type-aware skeleton */}
        <div style={{ flex: 1, overflow: "hidden" }}>
          <ViewSkeleton viewType={firstViewType} />
        </div>
      </div>
    );
  }

  if (error && data.length === 0) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          color: C.darkMuted,
          fontSize: 14,
          gap: 12,
          padding: 40,
        }}
      >
        <IconWarning size={24} />
        <span>Failed to load data: {error}</span>
        <button onClick={fetchData} style={S.btnSecondary}>
          Retry
        </button>
      </div>
    );
  }

  // If the active view is a chat view, render ChatPanel full-screen
  if (activeView?.type === "chat") {
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
        {/* Minimal header with record count + refresh */}
        <div
          style={{
            height: 40,
            minHeight: 40,
            display: "flex",
            alignItems: "center",
            padding: "0 20px",
            borderBottom: `1px solid ${C.edgeLine}`,
            background: C.dark,
            gap: 12,
          }}
        >
          <span style={{ fontSize: 11, color: C.darkMuted }}>
            {data.length} record{data.length !== 1 ? "s" : ""}
          </span>
          <div style={{ flex: 1 }} />
          <button
            onClick={fetchData}
            style={{
              ...S.btnGhost,
              fontSize: 12,
              padding: "4px 8px",
            }}
            title="Refresh"
          >
            <IconRefresh size={14} color={C.darkMuted} />
          </button>
        </div>

        <ChatPanel
          pageConfig={pageConfig}
          schema={schema}
          data={data}
          onRefresh={fetchData}
        />
      </div>
    );
  }

  // For non-chat views: render through ViewRenderer
  // We pass only the active view (single view at a time, per original design)
  const viewsToRender = activeView ? [activeView] : [];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Compact header: record count + refresh */}
      <div
        style={{
          height: 40,
          minHeight: 40,
          display: "flex",
          alignItems: "center",
          padding: "0 20px",
          borderBottom: `1px solid ${C.edgeLine}`,
          background: C.dark,
          gap: 12,
        }}
      >
        <span style={{ fontSize: 11, color: C.darkMuted }}>
          {data.length} record{data.length !== 1 ? "s" : ""}
        </span>
        <div style={{ flex: 1 }} />
        <button
          onClick={fetchData}
          style={{
            ...S.btnGhost,
            fontSize: 12,
            padding: "4px 8px",
          }}
          title="Refresh"
        >
          <IconRefresh size={14} color={C.darkMuted} />
        </button>
      </div>

      {/* Active view */}
      <div style={{ flex: 1, overflow: "hidden" }}>
        <ViewRenderer
          views={viewsToRender}
          data={data}
          schema={schema}
          onUpdate={handleUpdate}
          onRefresh={fetchData}
          onCreate={handleCreate}
          pageConfig={pageConfig}
        />
      </div>
    </div>
  );
}
