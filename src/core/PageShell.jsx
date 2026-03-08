// ─── Page Shell ───
// Loads a page config, fetches data, renders the active view.
// Page header controls (edit, refresh, count) are lifted to TopHeader via onRegisterControls.

import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { C, FONT, RADIUS, SHADOW } from "../design/tokens.js";
import { S } from "../design/styles.js";
import { usePlatform } from "../context/PlatformContext.jsx";
import { fetchDataSource, updateRecord, createRecord, deleteRecords, resolveSourceType } from "../lib/dataSource.js";
import { savePageConfig } from "../config/pageConfig.js";
import ViewRenderer from "../views/ViewRenderer.jsx";
import ChatPanel from "../views/ChatPanel.jsx";
import SubPageNav from "./SubPageNav.jsx";
import DatabaseBrowser from "./DatabaseBrowser.jsx";
import { ViewSkeleton } from "./ErrorBoundary.jsx";
import { IconWarning, IconPlus, IconClose } from "../design/icons.jsx";
import { ANIM } from "../design/animations.js";
import SyncPanel from "../components/SyncPanel.jsx";
import ViewSettingsPanel from "../components/ViewSettingsPanel.jsx";

const DEFAULT_REFRESH_MS = 30000;

export default function PageShell({
  pageConfig,
  activeViewIndex = 0,
  onSetActiveView,
  onRegisterControls, // callback to lift page controls to TopHeader
}) {
  const { user, updatePageConfig } = usePlatform();

  const [data, setData] = useState([]);
  const [schema, setSchema] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const refreshTimer = useRef(null);
  const [showAddDb, setShowAddDb] = useState(false);
  const [showSync, setShowSync] = useState(false);
  const [showViewSettings, setShowViewSettings] = useState(false);

  // Detect page types that don't need data fetching
  const sourceType = resolveSourceType(pageConfig);
  const isDocumentPage = pageConfig.pageType === "document" || pageConfig.page_type === "document";
  const isLinkedSheetPage = pageConfig.pageType === "linked_sheet" || pageConfig.page_type === "linked_sheet";
  const isSheetPage = pageConfig.pageType === "sheet" || pageConfig.page_type === "sheet";
  const isStandaloneTable = sourceType === "d1";

  // Get the active view config
  const views = pageConfig.views || [];
  let activeView = views[activeViewIndex] || views[0];

  // For document pages, inject editable: true
  if (isDocumentPage && activeView?.type === "document") {
    activeView = {
      ...activeView,
      config: { ...activeView.config, editable: true },
    };
  }

  // Multi-database schema map
  const [schemas, setSchemas] = useState({});

  const effectiveDbs = pageConfig.databaseIds || [];

  // ── Data fetching ──
  const fetchData = useCallback(async () => {
    if (isDocumentPage || isLinkedSheetPage || isSheetPage) {
      setLoading(false);
      return;
    }
    if (sourceType === "notion" && !user?.workerUrl) {
      setLoading(false);
      return;
    }
    if (sourceType === "notion" && !effectiveDbs?.length) {
      setLoading(false);
      return;
    }
    try {
      const result = await fetchDataSource(pageConfig, user);
      setData(result.data);
      setSchema(result.schema);
      setSchemas(result.schemas);
      setError(null);
    } catch (err) {
      console.error("Failed to fetch page data:", err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [user, pageConfig, effectiveDbs, sourceType, isDocumentPage, isLinkedSheetPage]);

  // Initial fetch
  useEffect(() => {
    setLoading(true);
    fetchData();
  }, [fetchData]);

  // Periodic refresh
  const refreshMs = pageConfig.refreshInterval ?? DEFAULT_REFRESH_MS;
  useEffect(() => {
    if (refreshMs <= 0) return;
    refreshTimer.current = setInterval(fetchData, refreshMs);
    return () => clearInterval(refreshTimer.current);
  }, [fetchData, refreshMs]);

  // ── Handle refresh interval change ──
  const handleRefreshChange = useCallback(
    (val) => {
      if (pageConfig?.id) {
        updatePageConfig(pageConfig.id, { refreshInterval: val });
      }
    },
    [pageConfig, updatePageConfig]
  );

  // ── Register page controls for TopHeader ──
  useEffect(() => {
    if (!onRegisterControls) return;

    const isDataPage = !isDocumentPage && !isLinkedSheetPage && !isSheetPage;
    onRegisterControls({
      recordCount: isDataPage ? data.length : null,
      refreshMs,
      onRefreshChange: handleRefreshChange,
      onRefresh: fetchData,
      onOpenViewSettings: () => setShowViewSettings(true),
      isStandaloneTable,
      showSync,
      onToggleSync: isStandaloneTable ? () => setShowSync((prev) => !prev) : null,
    });
  }, [data.length, refreshMs, isStandaloneTable, showSync, isDocumentPage, isLinkedSheetPage, isSheetPage, onRegisterControls, handleRefreshChange, fetchData]);

  // Unregister on unmount
  useEffect(() => {
    return () => onRegisterControls?.(null);
  }, [onRegisterControls]);

  // ── Inline edits ──
  const handleUpdate = useCallback(
    async (pageId, propertyName, propPayload) => {
      try {
        if (propPayload) {
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
        }
      } catch (err) {
        console.error("Update failed:", err);
      }
    },
    [pageConfig, user, fetchData]
  );

  const handleCreate = useCallback(
    async (databaseId, properties) => {
      try {
        await createRecord(pageConfig, properties, user);
        await fetchData();
      } catch (err) {
        console.error("Create failed:", err);
        throw err;
      }
    },
    [pageConfig, user, fetchData]
  );

  const handleDelete = useCallback(
    async (pageIds) => {
      if (!pageIds?.length) return;
      try {
        await deleteRecords(pageConfig, pageIds, user);
        await fetchData();
      } catch (err) {
        console.error("Bulk delete failed:", err);
      }
    },
    [pageConfig, user, fetchData]
  );

  // ── View management ──
  const handleRenameView = useCallback((viewIdx, newLabel) => {
    const updatedViews = (pageConfig.views || []).map((v, i) =>
      i === viewIdx ? { ...v, label: newLabel } : v
    );
    updatePageConfig(pageConfig.id, { views: updatedViews });
    savePageConfig({ ...pageConfig, views: updatedViews }).catch(() => {});
  }, [pageConfig, updatePageConfig]);

  const handleDeleteView = useCallback((viewIdx) => {
    const updatedViews = (pageConfig.views || []).filter((_, i) => i !== viewIdx);
    updatePageConfig(pageConfig.id, { views: updatedViews });
    savePageConfig({ ...pageConfig, views: updatedViews }).catch(() => {});
  }, [pageConfig, updatePageConfig]);

  const handleReorderViews = useCallback((newViews) => {
    updatePageConfig(pageConfig.id, { views: newViews });
    savePageConfig({ ...pageConfig, views: newViews }).catch(() => {});
  }, [pageConfig, updatePageConfig]);

  const handleViewConfigChange = useCallback((configUpdates) => {
    const updatedViews = (pageConfig.views || []).map((v, i) =>
      i === activeViewIndex
        ? { ...v, config: { ...v.config, ...configUpdates } }
        : v
    );
    updatePageConfig(pageConfig.id, { views: updatedViews });
    savePageConfig({ ...pageConfig, views: updatedViews }).catch(() => {});
  }, [pageConfig, activeViewIndex, updatePageConfig]);

  // Connected database IDs
  const connectedIds = useMemo(() => effectiveDbs || [], [effectiveDbs]);

  // Handle adding a new database connection
  const handleAddDatabase = useCallback(
    async ({ id, title, schema: newSchema }) => {
      if (pageConfig.databaseIds?.includes(id)) {
        setShowAddDb(false);
        return;
      }
      const newDatabaseIds = [...(pageConfig.databaseIds || []), id];
      const newView = {
        type: "table",
        label: title || "New Table",
        position: "main",
        config: { databaseId: id },
      };
      const newViews = [...(pageConfig.views || []), newView];
      updatePageConfig(pageConfig.id, {
        databaseIds: newDatabaseIds,
        views: newViews,
      });
      try {
        await savePageConfig({
          ...pageConfig,
          databaseIds: newDatabaseIds,
          views: newViews,
        });
      } catch (err) {
        console.error("Failed to save updated page config:", err);
      }
      setShowAddDb(false);
      fetchData();
    },
    [pageConfig, updatePageConfig, fetchData]
  );

  // ── Loading state ──
  if (loading && data.length === 0) {
    const firstViewType = activeView?.type || "default";
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
        <div
          style={{
            height: 40, minHeight: 40,
            display: "flex", alignItems: "center",
            padding: "0 20px",
            borderBottom: `1px solid ${C.edgeLine}`,
            background: C.dark, gap: 12,
          }}
        >
          <span style={{ fontSize: 11, color: C.darkMuted }}>Loading...</span>
        </div>
        <div style={{ flex: 1, overflow: "hidden" }}>
          <ViewSkeleton viewType={firstViewType} />
        </div>
      </div>
    );
  }

  // ── Error state ──
  if (error && data.length === 0) {
    return (
      <div
        style={{
          display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center",
          height: "100%", color: C.darkMuted,
          fontSize: 14, gap: 12, padding: 40,
        }}
      >
        <IconWarning size={24} />
        <span>Failed to load data: {error}</span>
        <button onClick={fetchData} style={S.btnSecondary}>Retry</button>
      </div>
    );
  }

  // ── Chat view (full-screen) ──
  if (activeView?.type === "chat") {
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
        <ChatPanel
          pageConfig={pageConfig}
          schema={schema}
          data={data}
          onRefresh={fetchData}
        />
      </div>
    );
  }

  // ── Normal view rendering ──
  const viewsToRender = activeView ? [activeView] : [];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* View tabs */}
      <SubPageNav
        views={views}
        activeViewIndex={activeViewIndex}
        onSetActiveView={onSetActiveView}
        onDeleteView={handleDeleteView}
        onRenameView={handleRenameView}
        onReorderViews={handleReorderViews}
        onAddView={() => setShowAddDb(true)}
      />

      {/* Sync panel (collapsible, standalone tables only) */}
      {showSync && isStandaloneTable && pageConfig.id && (
        <div style={{ padding: "12px 20px 0", background: C.dark }}>
          <SyncPanel tableId={pageConfig.id} />
        </div>
      )}

      {/* Active view */}
      <div style={{ flex: 1, overflow: "hidden", position: "relative" }}>
        <ViewRenderer
          views={viewsToRender}
          data={data}
          schema={schema}
          schemas={schemas}
          onUpdate={handleUpdate}
          onRefresh={fetchData}
          onCreate={handleCreate}
          onDelete={handleDelete}
          pageConfig={pageConfig}
          onViewConfigChange={handleViewConfigChange}
        />

        {/* View Settings slide-out */}
        {showViewSettings && activeView && (
          <ViewSettingsPanel
            viewConfig={activeView}
            schema={schema}
            onConfigChange={handleViewConfigChange}
            onClose={() => setShowViewSettings(false)}
          />
        )}

        {/* Add Database slide-out */}
        {showAddDb && (
          <>
            <div
              onClick={() => setShowAddDb(false)}
              style={{
                position: "fixed",
                top: 0, left: 0, right: 0, bottom: 0,
                background: "rgba(0,0,0,0.4)",
                zIndex: 99,
              }}
            />
            <div style={{
              position: "fixed",
              top: 0, right: 0, bottom: 0,
              width: 420,
              background: C.dark,
              borderLeft: `1px solid ${C.edgeLine}`,
              zIndex: 100,
              display: "flex",
              flexDirection: "column",
              boxShadow: SHADOW.dropdown,
              animation: "slideInRight 0.2s ease-out",
            }}>
              <div style={{
                padding: "16px 20px",
                borderBottom: `1px solid ${C.edgeLine}`,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                flexShrink: 0,
              }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: C.darkText, fontFamily: FONT }}>
                  Connect Database
                </span>
                <button
                  style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}
                  onClick={() => setShowAddDb(false)}
                >
                  <IconClose size={14} color={C.darkMuted} />
                </button>
              </div>
              <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
                <DatabaseBrowser
                  onConnect={handleAddDatabase}
                  connectedIds={connectedIds}
                  multi={true}
                />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
