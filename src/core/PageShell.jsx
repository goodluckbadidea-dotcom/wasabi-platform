// ─── Page Shell ───
// Loads a page config, fetches data, renders views + chat panel.

import React, { useState, useEffect, useCallback, useRef } from "react";
import { C, FONT, RADIUS } from "../design/tokens.js";
import { S } from "../design/styles.js";
import { usePlatform } from "../context/PlatformContext.jsx";
import { queryAll } from "../notion/pagination.js";
import { detectSchema } from "../notion/schema.js";
import { updatePage } from "../notion/client.js";
import { buildProp } from "../notion/properties.js";
import ViewRenderer from "../views/ViewRenderer.jsx";
import ChatPanel from "../views/ChatPanel.jsx";

const REFRESH_INTERVAL = 30000; // 30 seconds

export default function PageShell({ pageConfig }) {
  const { user } = usePlatform();
  const [data, setData] = useState([]);
  const [schema, setSchema] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const refreshTimer = useRef(null);

  // Determine if chat panel should show in sidebar
  const hasChatView = pageConfig.views?.some((v) => v.type === "chat");
  const nonChatViews = (pageConfig.views || []).filter((v) => v.type !== "chat");

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

  // Periodic refresh
  useEffect(() => {
    refreshTimer.current = setInterval(fetchData, REFRESH_INTERVAL);
    return () => clearInterval(refreshTimer.current);
  }, [fetchData]);

  // Handle inline edits from views
  const handleUpdate = useCallback(async (pageId, propertyName, value, propertyType) => {
    try {
      const prop = buildProp(propertyType, value);
      if (prop) {
        await updatePage(user.workerUrl, user.notionKey, pageId, {
          [propertyName]: prop,
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
                  // This is a simplified optimistic update
                  _localValue: value,
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
  }, [user, fetchData]);

  if (loading && data.length === 0) {
    return (
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        color: C.muted,
        fontSize: 14,
        gap: 8,
      }}>
        <span style={{ animation: "spin 1s linear infinite", display: "inline-block" }}>⟳</span>
        Loading {pageConfig.name}...
      </div>
    );
  }

  if (error && data.length === 0) {
    return (
      <div style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        color: C.muted,
        fontSize: 14,
        gap: 12,
        padding: 40,
      }}>
        <span style={{ fontSize: 24 }}>⚠️</span>
        <span>Failed to load data: {error}</span>
        <button onClick={fetchData} style={S.btnSecondary}>Retry</button>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Page header */}
      <div style={S.header}>
        <span style={{ fontSize: 18 }}>{pageConfig.icon || "📄"}</span>
        <span style={S.headerTitle}>{pageConfig.name}</span>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: C.muted }}>
          {data.length} record{data.length !== 1 ? "s" : ""}
        </span>
        <button
          onClick={fetchData}
          style={{
            ...S.btnGhost,
            fontSize: 12,
            padding: "4px 8px",
          }}
          title="Refresh"
        >
          ↻
        </button>
      </div>

      {/* Content */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* Views */}
        <div style={{ flex: 1, overflow: "hidden" }}>
          <ViewRenderer
            views={nonChatViews}
            data={data}
            schema={schema}
            onUpdate={handleUpdate}
            onRefresh={fetchData}
          />
        </div>

        {/* Chat sidebar */}
        {hasChatView && (
          <div style={{
            width: 360,
            minWidth: 360,
            borderLeft: `1px solid ${C.border}`,
            display: "flex",
            flexDirection: "column",
          }}>
            <ChatPanel
              pageConfig={pageConfig}
              schema={schema}
              data={data}
              onRefresh={fetchData}
            />
          </div>
        )}
      </div>
    </div>
  );
}
