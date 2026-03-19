// ─── Mini View ───
// Interactive view component for dashboard widgets.
// Fetches data independently and renders via ViewRenderer.
// Supports full interactivity: editing, creating, deleting records.
// Per-widget filter/sort/saved views stored independently from workspace views.

import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { C, FONT } from "../design/tokens.js";
import { usePlatform } from "../context/PlatformContext.jsx";
import { fetchDataSource, resolveSourceType, updateRecord, createRecord, deleteRecords } from "../lib/dataSource.js";
import ViewRenderer from "../views/ViewRenderer.jsx";

export default function MiniView({
  pageId,
  viewIndex = 0,
  width,
  height,
  // Per-widget config (filters, sort, saved views — independent from workspace)
  widgetViewConfig,
  onWidgetViewConfigChange,
}) {
  const { pages, user } = usePlatform();

  const [data, setData] = useState([]);
  const [schema, setSchema] = useState(null);
  const [schemas, setSchemas] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const refreshTimer = useRef(null);

  // Find the page config
  const pageConfig = pages.find((p) => p.id === pageId);
  const views = pageConfig?.views || [];
  const baseView = views[viewIndex] || views[0];

  // Merge per-widget config overrides into the base view
  const activeView = useMemo(() => {
    if (!baseView) return null;
    if (!widgetViewConfig) return baseView;
    return {
      ...baseView,
      config: {
        ...baseView.config,
        ...widgetViewConfig,
      },
    };
  }, [baseView, widgetViewConfig]);

  // Determine if this page type needs data fetching
  const sourceType = pageConfig ? resolveSourceType(pageConfig) : null;
  const isDocumentPage = pageConfig?.pageType === "document" || pageConfig?.page_type === "document";
  const isLinkedSheetPage = pageConfig?.pageType === "linked_sheet" || pageConfig?.page_type === "linked_sheet";
  const isSheetPage = pageConfig?.pageType === "sheet" || pageConfig?.page_type === "sheet";

  // ── Fetch data ──
  const fetchData = useCallback(async () => {
    if (!pageConfig) { setLoading(false); return; }
    if (isDocumentPage || isLinkedSheetPage || isSheetPage) { setLoading(false); return; }
    if (sourceType === "notion" && !user?.workerUrl) { setLoading(false); return; }

    try {
      const result = await fetchDataSource(pageConfig, user);
      setData(result.data);
      setSchema(result.schema);
      setSchemas(result.schemas || {});
      setError(null);
    } catch (err) {
      console.error("[MiniView] Fetch failed:", err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [pageConfig, user, sourceType, isDocumentPage, isLinkedSheetPage, isSheetPage]);

  // Initial fetch
  useEffect(() => {
    setLoading(true);
    fetchData();
  }, [fetchData]);

  // Periodic refresh (use source page's refresh interval)
  useEffect(() => {
    const refreshMs = pageConfig?.refreshInterval ?? 30000;
    if (refreshMs <= 0) return;
    refreshTimer.current = setInterval(fetchData, refreshMs);
    return () => clearInterval(refreshTimer.current);
  }, [fetchData, pageConfig?.refreshInterval]);

  // ── Edit callbacks (real, not no-ops) ──
  const handleUpdate = useCallback(
    async (pageId, propertyName, propPayload) => {
      if (!propPayload || !pageConfig) return;
      try {
        await updateRecord(pageConfig, pageId, propertyName, propPayload, user);
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
        setTimeout(fetchData, 500);
      } catch (err) {
        console.error("[MiniView] Update failed:", err);
      }
    },
    [pageConfig, user, fetchData]
  );

  const handleCreate = useCallback(
    async (databaseId, properties) => {
      if (!pageConfig) return;
      try {
        await createRecord(pageConfig, properties, user);
        await fetchData();
      } catch (err) {
        console.error("[MiniView] Create failed:", err);
        throw err;
      }
    },
    [pageConfig, user, fetchData]
  );

  const handleDelete = useCallback(
    async (pageIds) => {
      if (!pageIds?.length || !pageConfig) return;
      try {
        await deleteRecords(pageConfig, pageIds, user);
        await fetchData();
      } catch (err) {
        console.error("[MiniView] Delete failed:", err);
      }
    },
    [pageConfig, user, fetchData]
  );

  // ── Per-widget view config changes (filters, sort, saved views) ──
  const handleViewConfigChange = useCallback((configUpdates) => {
    if (onWidgetViewConfigChange) {
      onWidgetViewConfigChange(configUpdates);
    }
  }, [onWidgetViewConfigChange]);

  // ── Missing page ──
  if (!pageConfig) {
    return (
      <div style={placeholderStyle}>
        <span style={{ fontSize: 10, color: C.darkMuted, fontFamily: FONT }}>
          Page not found
        </span>
      </div>
    );
  }

  // ── Loading ──
  if (loading) {
    return (
      <div style={placeholderStyle}>
        <span style={{ fontSize: 10, color: C.darkMuted, fontFamily: FONT }}>
          Loading...
        </span>
      </div>
    );
  }

  // ── Error ──
  if (error) {
    return (
      <div style={placeholderStyle}>
        <span style={{ fontSize: 10, color: C.darkMuted, fontFamily: FONT }}>
          ⚠ {error}
        </span>
      </div>
    );
  }

  // ── No view to render ──
  if (!activeView) {
    return (
      <div style={placeholderStyle}>
        <span style={{ fontSize: 10, color: C.darkMuted, fontFamily: FONT }}>
          No view configured
        </span>
      </div>
    );
  }

  // ── Render the view (fully interactive) ──
  return (
    <div style={{
      width: "100%",
      height: "100%",
      overflow: "hidden",
      position: "relative",
    }}>
      <ViewRenderer
        views={[activeView]}
        data={data}
        schema={schema}
        schemas={schemas}
        pageConfig={pageConfig}
        onUpdate={handleUpdate}
        onRefresh={fetchData}
        onCreate={handleCreate}
        onDelete={handleDelete}
        onViewConfigChange={handleViewConfigChange}
      />
    </div>
  );
}

const placeholderStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  height: "100%",
  width: "100%",
};
