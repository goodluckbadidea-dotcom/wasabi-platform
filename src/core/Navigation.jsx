// ─── Sidebar Navigation ───
// Per-page sub-navigation sidebar. Shows sub-views for the active top-level page.
// Flame character at bottom opens the Wasabi Panel.
// Collapsible: 48px (icons) or 220px (full). Matches original app.
// Includes: "+" button for adding views/documents, drag reorder, Docs section.

import React, { useState, useCallback, useRef, useMemo } from "react";
import { C, FONT, RADIUS } from "../design/tokens.js";
import { usePlatform } from "../context/PlatformContext.jsx";
import { savePageConfig, archivePageConfig } from "../config/pageConfig.js";
import { createSubpage, archivePage, ensurePageActive } from "../notion/client.js";
import { IconDiamond, IconBolt, IconGear, IconStar, IconPlus, IconPage, IconClose, IconTrash } from "../design/icons.jsx";
import WasabiFlame from "./WasabiFlame.jsx";
import ConfirmDialog from "./ConfirmDialog.jsx";
import SheetUrlDialog from "./SheetUrlDialog.jsx";

// ── View type → human-readable label ──
const VIEW_LABELS = {
  table: "Table",
  gantt: "Timeline",
  calendar: "Calendar",
  cardGrid: "Cards",
  kanban: "Board",
  charts: "Charts",
  form: "Form",
  summaryTiles: "Summary",
  activityFeed: "Activity",
  document: "Document",
  notificationFeed: "Notifications",
  chat: "Chat",
  linked_sheet: "Linked Sheet",
};

// View types available for adding via "+" menu
const ADDABLE_VIEW_TYPES = [
  "table", "kanban", "cardGrid", "gantt", "calendar",
  "charts", "form", "summaryTiles", "activityFeed", "chat",
  "linked_sheet",
];

function getViewLabel(view) {
  return view.name || VIEW_LABELS[view.type] || view.type;
}

export default function Navigation({
  collapsed,
  onToggleCollapse,
  wasabiPanelOpen,
  onToggleWasabiPanel,
  activeView,
  onSetActiveView,
  isThinking,
}) {
  const { user, platformIds, pages, activePage, setActivePage, updatePageConfig, removePage } = usePlatform();
  const [hoveredItem, setHoveredItem] = useState(null);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [showDocsExpanded, setShowDocsExpanded] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null); // { type: 'page'|'view', pageConfig?, viewIdx? }
  const [sheetDialogOpen, setSheetDialogOpen] = useState(false);

  // Drag reorder state
  const dragIdxRef = useRef(null);
  const [dropIndicatorIdx, setDropIndicatorIdx] = useState(null);

  const SIDEBAR_W = collapsed ? 48 : 220;

  // Get current page's views for sub-nav
  const currentPage = pages.find((p) => p.id === activePage);

  // Synthetic sub-items for the Automations pseudo-page
  const AUTOMATION_SUB_ITEMS = [
    { id: 0, label: "Node Editor", type: "nodeEditor" },
    { id: 1, label: "Simple Rules", type: "simpleRules" },
    { id: 2, label: "Upload", type: "upload" },
  ];

  const subItems = activePage === "automations"
    ? AUTOMATION_SUB_ITEMS
    : (currentPage?.views || []).map((view, idx) => ({
        id: idx,
        label: getViewLabel(view),
        type: view.type,
      }));

  // Standalone document pages (for Docs section)
  const standaloneDocPages = useMemo(() =>
    pages.filter((p) => p.pageType === "document"),
    [pages]
  );

  // Section label: current page name or section indicator
  const sectionLabel = currentPage
    ? currentPage.name
    : activePage === "system"
    ? "System Manager"
    : activePage === "automations"
    ? "Automations"
    : activePage === "wasabi"
    ? "New Page"
    : "Home";

  // ── Drag Reorder ──
  const handleReorderViews = useCallback((fromIdx, toIdx) => {
    if (!currentPage || fromIdx === toIdx) return;
    const views = [...currentPage.views];
    const [moved] = views.splice(fromIdx, 1);
    views.splice(toIdx > fromIdx ? toIdx - 1 : toIdx, 0, moved);
    updatePageConfig(currentPage.id, { views });
    // Persist to Notion
    if (user?.workerUrl && user?.notionKey && platformIds?.configDbId) {
      savePageConfig(user.workerUrl, user.notionKey, platformIds.configDbId, {
        ...currentPage,
        views,
      }).catch((err) => console.error("Failed to persist view reorder:", err));
    }
  }, [currentPage, updatePageConfig, user, platformIds]);

  // ── Add View ──
  const handleAddView = useCallback((type) => {
    if (!currentPage) return;
    if (type === "linked_sheet") {
      setSheetDialogOpen(true);
      setShowAddMenu(false);
      return;
    }
    const label = VIEW_LABELS[type] || type;
    const newView = { type, label, position: "main", config: {} };
    const newViews = [...(currentPage.views || []), newView];
    updatePageConfig(currentPage.id, { views: newViews });
    setShowAddMenu(false);
    // Persist
    if (user?.workerUrl && user?.notionKey && platformIds?.configDbId) {
      savePageConfig(user.workerUrl, user.notionKey, platformIds.configDbId, {
        ...currentPage,
        views: newViews,
      }).catch((err) => console.error("Failed to persist new view:", err));
    }
    // Switch to new view
    onSetActiveView(newViews.length - 1);
  }, [currentPage, updatePageConfig, user, platformIds, onSetActiveView]);

  // ── Create Document (sub-view of current page) ──
  const handleCreateDocument = useCallback(async () => {
    if (!currentPage || !user?.workerUrl || !user?.notionKey) return;
    setShowAddMenu(false);
    try {
      const notionPage = await createSubpage(
        user.workerUrl,
        user.notionKey,
        platformIds.rootPageId,
        `${currentPage.name} - Document`
      );
      const newView = {
        type: "document",
        label: "Document",
        position: "main",
        config: { pageId: notionPage.id, editable: true },
      };
      const newViews = [...(currentPage.views || []), newView];
      updatePageConfig(currentPage.id, { views: newViews });
      // Persist
      if (platformIds?.configDbId) {
        savePageConfig(user.workerUrl, user.notionKey, platformIds.configDbId, {
          ...currentPage,
          views: newViews,
        }).catch((err) => console.error("Failed to persist document view:", err));
      }
      onSetActiveView(newViews.length - 1);
    } catch (err) {
      console.error("Failed to create document:", err);
    }
  }, [currentPage, user, platformIds, updatePageConfig, onSetActiveView]);

  // ── Link Sheet (confirm from SheetUrlDialog) ──
  const handleSheetConfirm = useCallback(({ sheetUrl, sheetType }) => {
    if (!currentPage) return;
    const newView = {
      type: "linked_sheet",
      label: "Linked Sheet",
      position: "main",
      config: { sheetUrl, sheetType },
    };
    const newViews = [...(currentPage.views || []), newView];
    updatePageConfig(currentPage.id, { views: newViews });
    setSheetDialogOpen(false);
    if (user?.workerUrl && user?.notionKey && platformIds?.configDbId) {
      savePageConfig(user.workerUrl, user.notionKey, platformIds.configDbId, {
        ...currentPage,
        views: newViews,
      }).catch((err) => console.error("Failed to persist linked sheet view:", err));
    }
    onSetActiveView(newViews.length - 1);
  }, [currentPage, updatePageConfig, user, platformIds, onSetActiveView]);

  // ── Delete Page ──
  const handleDeletePage = useCallback(async (pageConfig) => {
    try {
      if (user?.workerUrl && user?.notionKey) {
        // Ensure root page is active before archiving children
        if (platformIds?.rootPageId) {
          await ensurePageActive(user.workerUrl, user.notionKey, platformIds.rootPageId);
        }
        await archivePageConfig(user.workerUrl, user.notionKey, pageConfig.id);
        // Archive associated databases
        for (const dbId of (pageConfig.databaseIds || [])) {
          archivePage(user.workerUrl, user.notionKey, dbId).catch(() => {});
        }
        // Archive document page if applicable
        if (pageConfig.pageType === "document" && pageConfig.notionPageId) {
          archivePage(user.workerUrl, user.notionKey, pageConfig.notionPageId).catch(() => {});
        }
      }
      removePage(pageConfig.id);
    } catch (err) {
      console.error("[Navigation] Failed to delete page:", err);
    }
    setConfirmDelete(null);
  }, [user, platformIds, removePage]);

  // ── Delete View ──
  const handleDeleteView = useCallback((viewIdx) => {
    if (!currentPage) return;
    const newViews = currentPage.views.filter((_, idx) => idx !== viewIdx);
    updatePageConfig(currentPage.id, { views: newViews });
    // Persist to Notion
    if (user?.workerUrl && user?.notionKey && platformIds?.configDbId) {
      savePageConfig(user.workerUrl, user.notionKey, platformIds.configDbId, {
        ...currentPage,
        views: newViews,
      }).catch((err) => console.error("[Navigation] Failed to persist view deletion:", err));
    }
    // Adjust active view
    if (activeView === viewIdx) {
      onSetActiveView(Math.max(0, viewIdx - 1));
    } else if (activeView > viewIdx) {
      onSetActiveView(activeView - 1);
    }
    setConfirmDelete(null);
  }, [currentPage, updatePageConfig, user, platformIds, activeView, onSetActiveView]);

  // Bottom button style helper
  const bottomBtnStyle = (isActive) => ({
    background: isActive ? C.accent : "none",
    border: "none",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: collapsed ? 0 : 10,
    padding: collapsed ? "8px 0" : "7px 10px",
    borderRadius: RADIUS.lg,
    transition: "background 0.15s",
    outline: "none",
    width: "100%",
    justifyContent: collapsed ? "center" : "flex-start",
  });

  const bottomLabelStyle = (isActive) => ({
    fontFamily: "'Outfit',sans-serif",
    fontSize: 12,
    fontWeight: isActive ? 600 : 400,
    color: isActive ? "#fff" : C.darkMuted,
    letterSpacing: "0.02em",
  });

  return (
    <div
      style={{
        width: SIDEBAR_W,
        flexShrink: 0,
        background: C.dark,
        borderRight: `1px solid ${C.edgeLine}`,
        display: "flex",
        flexDirection: "column",
        transition: "width 0.25s cubic-bezier(0.4,0,0.2,1)",
        position: "relative",
        boxShadow: "2px 0 8px rgba(0,0,0,0.2)",
        overflow: "hidden",
      }}
    >
      {/* Section label header */}
      {!collapsed && (
        <div
          style={{
            padding: "18px 20px 12px",
            borderBottom: `1px solid ${C.darkBorder}`,
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span
            style={{
              fontFamily: "'Outfit',sans-serif",
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: "0.2em",
              textTransform: "uppercase",
              color: C.darkMuted,
            }}
          >
            {sectionLabel}
          </span>
          {currentPage && (
            <button
              onClick={() => setConfirmDelete({ type: "page", pageConfig: currentPage })}
              title="Delete page"
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: 4,
                display: "flex",
                alignItems: "center",
                opacity: 0.3,
                transition: "opacity 0.15s",
                outline: "none",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; }}
              onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.3"; }}
            >
              <IconTrash size={11} color={C.darkMuted} />
            </button>
          )}
        </div>
      )}
      {collapsed && (
        <div
          style={{
            height: 49,
            borderBottom: `1px solid ${C.darkBorder}`,
            flexShrink: 0,
          }}
        />
      )}

      {/* Sub-nav items (with drag reorder) */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          paddingTop: 8,
          paddingBottom: 48,
        }}
      >
        {subItems.length === 0 && !collapsed && (
          <div
            style={{
              padding: "16px 20px",
              fontFamily: "'Outfit',sans-serif",
              fontSize: 11,
              color: C.darkBorder,
              letterSpacing: "0.04em",
            }}
          >
            No sub-views
          </div>
        )}

        {subItems.map((item) => {
          const isActive = activeView === item.id;
          const isHovered = hoveredItem === item.id;
          const showDropBefore = dropIndicatorIdx === item.id;

          return (
            <React.Fragment key={item.id}>
              {/* Drop indicator line */}
              {showDropBefore && (
                <div style={{
                  height: 2,
                  background: C.accent,
                  margin: collapsed ? "0" : "0 8px",
                  borderRadius: 1,
                }} />
              )}
              <button
                draggable={!collapsed}
                onDragStart={(e) => {
                  dragIdxRef.current = item.id;
                  e.dataTransfer.effectAllowed = "move";
                  // Make drag preview subtle
                  e.dataTransfer.setData("text/plain", item.label);
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  if (dragIdxRef.current !== item.id) {
                    setDropIndicatorIdx(item.id);
                  }
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragIdxRef.current != null && dragIdxRef.current !== item.id) {
                    handleReorderViews(dragIdxRef.current, item.id);
                  }
                  dragIdxRef.current = null;
                  setDropIndicatorIdx(null);
                }}
                onDragEnd={() => {
                  dragIdxRef.current = null;
                  setDropIndicatorIdx(null);
                }}
                onClick={() => onSetActiveView(item.id)}
                onMouseEnter={() => setHoveredItem(item.id)}
                onMouseLeave={() => setHoveredItem(null)}
                title={collapsed ? item.label : undefined}
                style={{
                  width: collapsed ? "100%" : "calc(100% - 16px)",
                  margin: collapsed ? "0" : "6px 8px",
                  border: isActive ? "none" : `1px solid ${C.darkBorder}`,
                  cursor: "pointer",
                  outline: "none",
                  display: "flex",
                  alignItems: "center",
                  gap: collapsed ? 0 : 10,
                  justifyContent: collapsed ? "center" : "flex-start",
                  padding: collapsed ? "13px 0" : "10px 14px",
                  borderRadius: collapsed ? 0 : 999,
                  background: isActive
                    ? C.accent
                    : isHovered
                    ? C.darkSurf2
                    : "transparent",
                  transition: "all 0.12s",
                  fontFamily: "'Outfit',sans-serif",
                }}
              >
                <IconDiamond
                  size={8}
                  color={isActive ? "#fff" : C.darkBorder}
                />
                {!collapsed && (
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: isActive ? 600 : 400,
                      color: isActive ? "#fff" : C.darkMuted,
                      letterSpacing: "0.01em",
                      whiteSpace: "nowrap",
                      transition: "color 0.12s",
                    }}
                  >
                    {item.label}
                  </span>
                )}
                {/* Hover: show delete X (only for real views, not automation tabs, and not the last view) */}
                {isHovered && !collapsed && currentPage && activePage !== "automations" && subItems.length > 1 && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setConfirmDelete({ type: "view", viewIdx: item.id });
                    }}
                    title="Delete view"
                    style={{
                      marginLeft: "auto",
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      padding: 2,
                      display: "flex",
                      alignItems: "center",
                      opacity: 0.5,
                      transition: "opacity 0.12s",
                      outline: "none",
                      flexShrink: 0,
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.5"; }}
                  >
                    <IconClose size={8} color={isActive ? "#fff" : C.darkMuted} />
                  </button>
                )}
                {/* Active dot (only when not hovered) */}
                {isActive && !collapsed && !isHovered && (
                  <div
                    style={{
                      marginLeft: "auto",
                      width: 5,
                      height: 5,
                      borderRadius: "50%",
                      background: "#fff",
                      flexShrink: 0,
                      boxShadow: "0 0 4px rgba(255,255,255,0.4)",
                    }}
                  />
                )}
              </button>
            </React.Fragment>
          );
        })}

        {/* "+" Add button — below sub-items */}
        {currentPage && !collapsed && (
          <div style={{ padding: "4px 8px", position: "relative" }}>
            <button
              onClick={() => setShowAddMenu(!showAddMenu)}
              style={{
                width: "calc(100% - 0px)",
                border: `1px dashed ${C.darkBorder}`,
                background: "transparent",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 14px",
                borderRadius: 999,
                fontFamily: "'Outfit',sans-serif",
                fontSize: 12,
                color: C.darkMuted,
                outline: "none",
                transition: "all 0.12s",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = C.accent; e.currentTarget.style.color = C.accent; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = C.darkBorder; e.currentTarget.style.color = C.darkMuted; }}
            >
              <IconPlus size={10} color="currentColor" />
              <span>Add</span>
            </button>

            {/* Add menu dropdown */}
            {showAddMenu && (
              <>
                {/* Backdrop */}
                <div
                  onClick={() => setShowAddMenu(false)}
                  style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 98 }}
                />
                <div
                  style={{
                    position: "absolute",
                    left: 8,
                    top: "100%",
                    marginTop: 4,
                    background: C.darkSurf,
                    border: `1px solid ${C.darkBorder}`,
                    borderRadius: RADIUS.lg,
                    boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
                    zIndex: 99,
                    padding: "4px 0",
                    minWidth: 180,
                    maxHeight: 320,
                    overflowY: "auto",
                  }}
                >
                  {/* Section: Add View */}
                  <div style={{
                    padding: "6px 12px 4px",
                    fontSize: 10,
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    color: C.darkMuted,
                  }}>
                    Add View
                  </div>
                  {ADDABLE_VIEW_TYPES.map((vt) => (
                    <button
                      key={vt}
                      onClick={() => handleAddView(vt)}
                      style={{
                        display: "block",
                        width: "100%",
                        background: "none",
                        border: "none",
                        padding: "7px 14px",
                        textAlign: "left",
                        cursor: "pointer",
                        color: C.darkText,
                        fontFamily: "'Outfit',sans-serif",
                        fontSize: 13,
                        outline: "none",
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = C.darkSurf2; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}
                    >
                      {VIEW_LABELS[vt] || vt}
                    </button>
                  ))}

                  {/* Divider */}
                  <div style={{ height: 1, background: C.darkBorder, margin: "4px 0" }} />

                  {/* Create Document */}
                  <div style={{
                    padding: "6px 12px 4px",
                    fontSize: 10,
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    color: C.darkMuted,
                  }}>
                    Create
                  </div>
                  <button
                    onClick={handleCreateDocument}
                    style={{
                      display: "flex",
                      width: "100%",
                      background: "none",
                      border: "none",
                      padding: "7px 14px",
                      textAlign: "left",
                      cursor: "pointer",
                      color: C.darkText,
                      fontFamily: "'Outfit',sans-serif",
                      fontSize: 13,
                      outline: "none",
                      alignItems: "center",
                      gap: 8,
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = C.darkSurf2; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}
                  >
                    <IconPage size={14} color={C.darkMuted} />
                    Document
                  </button>
                </div>
              </>
            )}
          </div>
        )}
        {currentPage && collapsed && (
          <button
            onClick={() => setShowAddMenu(!showAddMenu)}
            title="Add view or document"
            style={{
              width: "100%",
              border: "none",
              background: "transparent",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "10px 0",
              outline: "none",
            }}
          >
            <IconPlus size={12} color={C.darkMuted} />
          </button>
        )}
      </div>

      {/* Bottom action buttons */}
      <div
        style={{
          flexShrink: 0,
          borderTop: `1px solid ${C.darkBorder}`,
          padding: collapsed ? "8px 0" : "8px 12px",
          display: "flex",
          flexDirection: "column",
          gap: 2,
          overflow: "hidden",
          transition: "padding 0.25s",
        }}
      >
        {/* Home button */}
        <button
          onClick={() => setActivePage(null)}
          title="Home"
          style={bottomBtnStyle(activePage === null)}
          onMouseEnter={(e) => { if (activePage !== null) e.currentTarget.style.background = C.darkSurf2; }}
          onMouseLeave={(e) => { if (activePage !== null) e.currentTarget.style.background = "transparent"; }}
        >
          <IconStar size={collapsed ? 16 : 14} color={activePage === null ? "#fff" : C.darkMuted} />
          {!collapsed && <span style={bottomLabelStyle(activePage === null)}>Home</span>}
        </button>

        {/* Docs button (only when standalone docs exist) */}
        {standaloneDocPages.length > 0 && (
          <>
            <button
              onClick={() => setShowDocsExpanded(!showDocsExpanded)}
              title="Documents"
              style={bottomBtnStyle(false)}
              onMouseEnter={(e) => { e.currentTarget.style.background = C.darkSurf2; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
            >
              <IconPage size={collapsed ? 16 : 14} color={C.darkMuted} />
              {!collapsed && (
                <span style={bottomLabelStyle(false)}>
                  Docs
                  <span style={{ fontSize: 10, marginLeft: 4, color: C.darkBorder }}>
                    {standaloneDocPages.length}
                  </span>
                </span>
              )}
            </button>
            {/* Expanded docs list */}
            {showDocsExpanded && !collapsed && (
              <div style={{ paddingLeft: 8, marginBottom: 4 }}>
                {standaloneDocPages.map((doc) => {
                  const isDocActive = activePage === doc.id;
                  return (
                    <div
                      key={doc.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        position: "relative",
                      }}
                    >
                      <button
                        onClick={() => setActivePage(doc.id)}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          flex: 1,
                          background: isDocActive ? C.accent : "transparent",
                          border: "none",
                          borderRadius: RADIUS.sm,
                          padding: "5px 8px",
                          cursor: "pointer",
                          outline: "none",
                          fontFamily: "'Outfit',sans-serif",
                          fontSize: 11,
                          color: isDocActive ? "#fff" : C.darkMuted,
                          transition: "background 0.12s",
                          minWidth: 0,
                        }}
                        onMouseEnter={(e) => { if (!isDocActive) e.currentTarget.style.background = C.darkSurf2; }}
                        onMouseLeave={(e) => { if (!isDocActive) e.currentTarget.style.background = "transparent"; }}
                      >
                        <IconDiamond size={6} color={isDocActive ? "#fff" : C.darkBorder} />
                        <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {doc.name}
                        </span>
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setConfirmDelete({ type: "page", pageConfig: doc });
                        }}
                        title="Delete document"
                        style={{
                          background: "none",
                          border: "none",
                          cursor: "pointer",
                          padding: 3,
                          display: "flex",
                          alignItems: "center",
                          opacity: 0,
                          transition: "opacity 0.12s",
                          outline: "none",
                          flexShrink: 0,
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.opacity = "0"; }}
                      >
                        <IconClose size={7} color={C.darkMuted} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* Automations button */}
        <button
          onClick={() => setActivePage("automations")}
          title="Automations"
          style={bottomBtnStyle(activePage === "automations")}
          onMouseEnter={(e) => { if (activePage !== "automations") e.currentTarget.style.background = C.darkSurf2; }}
          onMouseLeave={(e) => { if (activePage !== "automations") e.currentTarget.style.background = "transparent"; }}
        >
          <IconBolt size={collapsed ? 16 : 14} color={activePage === "automations" ? "#fff" : C.darkMuted} />
          {!collapsed && <span style={bottomLabelStyle(activePage === "automations")}>Automations</span>}
        </button>

        {/* System button */}
        <button
          onClick={() => setActivePage("system")}
          title="System"
          style={bottomBtnStyle(activePage === "system")}
          onMouseEnter={(e) => { if (activePage !== "system") e.currentTarget.style.background = C.darkSurf2; }}
          onMouseLeave={(e) => { if (activePage !== "system") e.currentTarget.style.background = "transparent"; }}
        >
          <IconGear size={collapsed ? 16 : 14} color={activePage === "system" ? "#fff" : C.darkMuted} />
          {!collapsed && <span style={bottomLabelStyle(activePage === "system")}>System</span>}
        </button>

        {/* Wasabi flame */}
        {!wasabiPanelOpen && (
          <button
            onClick={onToggleWasabiPanel}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: collapsed ? 0 : 10,
              padding: collapsed ? "6px 0" : "6px 8px",
              borderRadius: RADIUS.lg,
              transition: "background 0.15s",
              outline: "none",
              width: "100%",
              justifyContent: collapsed ? "center" : "flex-start",
              marginTop: 2,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = C.darkSurf2; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
            title="Open Wasabi"
          >
            <WasabiFlame size={collapsed ? 26 : 30} isThinking={isThinking} />
            {!collapsed && (
              <span
                style={{
                  fontFamily: "'Outfit',sans-serif",
                  fontSize: 12,
                  fontWeight: 500,
                  color: C.darkMuted,
                  letterSpacing: "0.02em",
                }}
              >
                Wasabi
              </span>
            )}
          </button>
        )}
      </div>

      {/* Collapse toggle tab — right edge */}
      <button
        onClick={onToggleCollapse}
        title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        style={{
          position: "absolute",
          top: "50%",
          right: -12,
          transform: "translateY(-50%)",
          width: 22,
          height: 44,
          background: C.darkSurf2,
          border: `1px solid ${C.darkBorder}`,
          borderRadius: "0 8px 8px 0",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          outline: "none",
          zIndex: 10,
          transition: "background 0.12s",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = "#363636"; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = C.darkSurf2; }}
      >
        <svg width="8" height="12" viewBox="0 0 8 12" fill="none">
          <path
            d={collapsed ? "M2 2L6 6L2 10" : "M6 2L2 6L6 10"}
            stroke={C.darkMuted}
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {/* Confirm dialogs */}
      {confirmDelete?.type === "page" && (
        <ConfirmDialog
          title="Delete Page"
          message={`Are you sure you want to delete "${confirmDelete.pageConfig.name}"? This action cannot be undone.`}
          onConfirm={() => handleDeletePage(confirmDelete.pageConfig)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
      {confirmDelete?.type === "view" && (
        <ConfirmDialog
          title="Delete View"
          message="Are you sure you want to delete this view? This action cannot be undone."
          onConfirm={() => handleDeleteView(confirmDelete.viewIdx)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}

      {/* Sheet URL dialog */}
      {sheetDialogOpen && (
        <SheetUrlDialog
          onConfirm={handleSheetConfirm}
          onCancel={() => setSheetDialogOpen(false)}
        />
      )}
    </div>
  );
}
