// ─── Page Shell ───
// Loads a page config, fetches data, renders the active view based on sidebar sub-nav.
// The page header is now in TopHeader. This component focuses on data + view rendering.

import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { C, FONT, RADIUS, SHADOW } from "../design/tokens.js";
import { S } from "../design/styles.js";
import { usePlatform } from "../context/PlatformContext.jsx";
import { queryAll } from "../notion/pagination.js";
import { detectSchema } from "../notion/schema.js";
import { updatePage, createPage, archivePage } from "../notion/client.js";
import { savePageConfig } from "../config/pageConfig.js";
import ViewRenderer from "../views/ViewRenderer.jsx";
import ChatPanel from "../views/ChatPanel.jsx";
import SubPageNav from "./SubPageNav.jsx";
import DatabaseBrowser from "./DatabaseBrowser.jsx";
import { ViewSkeleton } from "./ErrorBoundary.jsx";
import { IconWarning, IconRefresh, IconPlus, IconDatabase, IconClose } from "../design/icons.jsx";

const DEFAULT_REFRESH_MS = 30000; // 30 seconds

const REFRESH_OPTIONS = [
  { label: "15s", value: 15000 },
  { label: "30s", value: 30000 },
  { label: "1m", value: 60000 },
  { label: "2m", value: 120000 },
  { label: "5m", value: 300000 },
  { label: "Manual", value: 0 },
];

const refreshSelectStyle = {
  background: C.darkSurf2,
  border: `1px solid ${C.darkBorder}`,
  borderRadius: RADIUS.md,
  padding: "3px 8px",
  fontSize: 11,
  fontFamily: FONT,
  color: C.darkMuted,
  cursor: "pointer",
  outline: "none",
  height: 26,
};

export default function PageShell({
  pageConfig,
  activeViewIndex = 0,
  onSetActiveView,
  onAddSubPage,
}) {
  const {
    user, platformIds, updatePageConfig,
    activeSubPage, setActiveSubPage, getSubPages,
  } = usePlatform();

  // ── Sub-page awareness ──
  const subPages = getSubPages(pageConfig.id);
  const effectiveConfig = activeSubPage
    ? subPages.find((sp) => sp.id === activeSubPage) || pageConfig
    : pageConfig;
  // Sub-pages inherit parent DBs if they don't specify their own
  const effectiveDbs = effectiveConfig.databaseIds?.length
    ? effectiveConfig.databaseIds
    : pageConfig.databaseIds;
  const [data, setData] = useState([]);
  const [schema, setSchema] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const refreshTimer = useRef(null);
  const [showAddDb, setShowAddDb] = useState(false);

  // Detect document pages (no database fetch needed)
  const isDocumentPage = effectiveConfig.pageType === "document";
  // Detect linked-sheet-only pages (no database fetch needed, views are self-contained)
  const isLinkedSheetPage = effectiveConfig.pageType === "linked_sheet";

  // Get the active view config based on effective config (sub-page or parent)
  const views = effectiveConfig.views || [];
  let activeView = views[activeViewIndex] || views[0];

  // For document pages, inject editable: true into the document view config
  if (isDocumentPage && activeView?.type === "document") {
    activeView = {
      ...activeView,
      config: { ...activeView.config, editable: true },
    };
  }

  // Multi-database schema map: { dbId → schema }
  const [schemas, setSchemas] = useState({});

  // Fetch data from all connected databases
  const fetchData = useCallback(async () => {
    // Document pages and linked-sheet-only pages have no databases to fetch
    if (isDocumentPage || isLinkedSheetPage) {
      setLoading(false);
      return;
    }
    if (!user?.workerUrl || !user?.notionKey || !effectiveDbs?.length) {
      setLoading(false);
      return;
    }

    try {
      // Fetch schemas for ALL connected databases
      const schemaMap = {};
      for (const dbId of effectiveDbs) {
        try {
          const dbSchema = await detectSchema(user.workerUrl, user.notionKey, dbId);
          schemaMap[dbId] = dbSchema;
        } catch (err) {
          console.warn(`Schema fetch failed for ${dbId}:`, err.message);
        }
      }
      setSchemas(schemaMap);

      // Use primary database schema as the main schema (backward compat)
      const primaryDbId = effectiveDbs[0];
      setSchema(schemaMap[primaryDbId] || null);

      // Fetch data from all databases
      const allData = [];
      for (const dbId of effectiveDbs) {
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
  }, [user, effectiveDbs, isDocumentPage, isLinkedSheetPage]);

  // Initial fetch
  useEffect(() => {
    setLoading(true);
    fetchData();
  }, [fetchData]);

  // Periodic refresh — configurable per page via effectiveConfig.refreshInterval (ms)
  const refreshMs = effectiveConfig.refreshInterval ?? DEFAULT_REFRESH_MS;
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

  // Handle bulk delete (archive) from Table view
  const handleDelete = useCallback(
    async (pageIds) => {
      if (!user?.workerUrl || !user?.notionKey || !pageIds?.length) return;
      try {
        for (const id of pageIds) {
          await archivePage(user.workerUrl, user.notionKey, id);
        }
        await fetchData();
      } catch (err) {
        console.error("Bulk delete failed:", err);
      }
    },
    [user, fetchData]
  );

  // Handle refresh interval change
  const handleRefreshChange = useCallback(
    (val) => {
      if (effectiveConfig?.id) {
        updatePageConfig(effectiveConfig.id, { refreshInterval: val });
      }
    },
    [effectiveConfig, updatePageConfig]
  );

  // ── View management callbacks (for SubPageNav) ──
  const handleRenameView = useCallback((viewIdx, newLabel) => {
    const target = effectiveConfig;
    const updatedViews = (target.views || []).map((v, i) =>
      i === viewIdx ? { ...v, label: newLabel } : v
    );
    updatePageConfig(target.id, { views: updatedViews });
    if (user?.workerUrl && user?.notionKey && platformIds?.configDbId) {
      savePageConfig(user.workerUrl, user.notionKey, platformIds.configDbId, {
        ...target, views: updatedViews,
      }).catch(() => {});
    }
  }, [effectiveConfig, updatePageConfig, user, platformIds]);

  const handleDeleteView = useCallback((viewIdx) => {
    const target = effectiveConfig;
    const updatedViews = (target.views || []).filter((_, i) => i !== viewIdx);
    updatePageConfig(target.id, { views: updatedViews });
    if (user?.workerUrl && user?.notionKey && platformIds?.configDbId) {
      savePageConfig(user.workerUrl, user.notionKey, platformIds.configDbId, {
        ...target, views: updatedViews,
      }).catch(() => {});
    }
  }, [effectiveConfig, updatePageConfig, user, platformIds]);

  const handleReorderViews = useCallback((newViews) => {
    const target = effectiveConfig;
    updatePageConfig(target.id, { views: newViews });
    if (user?.workerUrl && user?.notionKey && platformIds?.configDbId) {
      savePageConfig(user.workerUrl, user.notionKey, platformIds.configDbId, {
        ...target, views: newViews,
      }).catch(() => {});
    }
  }, [effectiveConfig, updatePageConfig, user, platformIds]);

  // Connected database IDs for the DatabaseBrowser
  const connectedIds = useMemo(() => effectiveDbs || [], [effectiveDbs]);

  // Handle adding a new database connection post-creation
  // Operates on the effective config (could be a sub-page)
  const handleAddDatabase = useCallback(
    async ({ id, title, schema: newSchema }) => {
      const targetConfig = effectiveConfig;
      // Skip duplicates
      if (targetConfig.databaseIds?.includes(id)) {
        setShowAddDb(false);
        return;
      }

      const newDatabaseIds = [...(targetConfig.databaseIds || []), id];
      const newView = {
        type: "table",
        label: title || "New Table",
        position: "main",
        config: { databaseId: id },
      };
      const newViews = [...(targetConfig.views || []), newView];

      // Update local state immediately
      updatePageConfig(targetConfig.id, {
        databaseIds: newDatabaseIds,
        views: newViews,
      });

      // Persist to Notion config database
      try {
        await savePageConfig(user.workerUrl, user.notionKey, platformIds.configDbId, {
          ...targetConfig,
          databaseIds: newDatabaseIds,
          views: newViews,
        });
      } catch (err) {
        console.error("Failed to save updated page config:", err);
      }

      setShowAddDb(false);
      // Re-fetch to include the new database
      fetchData();
    },
    [effectiveConfig, updatePageConfig, user, platformIds, fetchData]
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
          <select
            style={refreshSelectStyle}
            value={refreshMs}
            onChange={(e) => handleRefreshChange(Number(e.target.value))}
          >
            {REFRESH_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
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
          pageConfig={effectiveConfig}
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
      {/* Sub-page pills + view tabs */}
      <SubPageNav
        parentPage={pageConfig}
        subPages={subPages}
        activeSubPage={activeSubPage}
        onSetActiveSubPage={setActiveSubPage}
        activeViewIndex={activeViewIndex}
        onSetActiveView={onSetActiveView}
        onAddSubPage={() => onAddSubPage?.()}
        onDeleteView={handleDeleteView}
        onRenameView={handleRenameView}
        onReorderViews={handleReorderViews}
        onAddView={() => setShowAddDb(true)}
      />

      {/* Header bar — simplified for document and linked-sheet-only pages */}
      {(isDocumentPage || isLinkedSheetPage) ? (
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
            {isDocumentPage ? "Document" : "Linked Sheet"}
          </span>
          <div style={{ flex: 1 }} />
        </div>
      ) : (
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
          {/* Add Database button */}
          <button
            onClick={() => setShowAddDb(true)}
            style={{
              ...S.btnGhost,
              fontSize: 11,
              padding: "3px 8px",
              display: "flex",
              alignItems: "center",
              gap: 4,
            }}
            title="Connect another database"
          >
            <IconPlus size={10} color={C.darkMuted} />
            <IconDatabase size={12} color={C.darkMuted} />
          </button>
          <select
            style={refreshSelectStyle}
            value={refreshMs}
            onChange={(e) => handleRefreshChange(Number(e.target.value))}
          >
            {REFRESH_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
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
          pageConfig={effectiveConfig}
        />

        {/* Add Database slide-out panel */}
        {showAddDb && (
          <>
            {/* Backdrop */}
            <div
              onClick={() => setShowAddDb(false)}
              style={{
                position: "fixed",
                top: 0, left: 0, right: 0, bottom: 0,
                background: "rgba(0,0,0,0.4)",
                zIndex: 99,
              }}
            />
            {/* Panel */}
            <div style={{
              position: "fixed",
              top: 0,
              right: 0,
              bottom: 0,
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
