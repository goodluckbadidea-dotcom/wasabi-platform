// ─── Mini View ───
// Read-only, live-rendering view component for dashboard widgets.
// Fetches data independently and renders via ViewRenderer.

import React, { useState, useEffect, useCallback, useRef } from "react";
import { C, FONT } from "../design/tokens.js";
import { usePlatform } from "../context/PlatformContext.jsx";
import { fetchDataSource, resolveSourceType } from "../lib/dataSource.js";
import ViewRenderer from "../views/ViewRenderer.jsx";

export default function MiniView({
  pageId,
  viewIndex = 0,
  width,
  height,
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
  const activeView = views[viewIndex] || views[0];

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

  // ── Render the view (read-only) ──
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
        // Read-only — no editing callbacks
        onUpdate={() => {}}
        onRefresh={fetchData}
        onCreate={() => {}}
        onDelete={() => {}}
        onViewConfigChange={() => {}}
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
