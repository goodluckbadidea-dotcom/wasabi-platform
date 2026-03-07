// ─── Visual Page Builder ───
// A drag-less visual editor for assembling page configs.
// Phase 6: Now uses DatabaseBrowser for connecting pre-existing Notion databases.

import React, { useState, useCallback, useMemo } from "react";
import { C, FONT, RADIUS, SHADOW } from "../design/tokens.js";
import { S } from "../design/styles.js";
import { usePlatform } from "../context/PlatformContext.jsx";
import { savePageConfig, createDocumentPageConfig, createFolderConfig } from "../config/pageConfig.js";
import { autoDetectViews } from "../notion/schema.js";
import { createSubpage, ensurePageActive } from "../notion/client.js";
import DatabaseBrowser from "./DatabaseBrowser.jsx";
import {
  IconPage, IconTable, IconKanban, IconChart, IconForm,
  IconCalendar, IconFolder, IconStar, IconBolt, IconUsers,
  IconInbox, IconBell, IconGear, IconCards, IconTimeline,
  IconDatabase, IconClose, IconChevronLeft, IconSheet,
} from "../design/icons.jsx";

// ── Available view types ──
const VIEW_TYPES = [
  { type: "table", label: "Table", desc: "Sortable, filterable data grid", Icon: IconTable },
  { type: "kanban", label: "Kanban", desc: "Drag-and-drop board by status", Icon: IconKanban },
  { type: "cardGrid", label: "Card Grid", desc: "Visual cards with images", Icon: IconCards },
  { type: "gantt", label: "Gantt", desc: "Timeline / date-range chart", Icon: IconTimeline },
  { type: "calendar", label: "Calendar", desc: "Month/week date calendar", Icon: IconCalendar },
  { type: "charts", label: "Charts", desc: "Bar, pie, and line charts", Icon: IconChart },
  { type: "form", label: "Form", desc: "Create new records", Icon: IconForm },
  { type: "summaryTiles", label: "Summary Tiles", desc: "KPI metric tiles", Icon: IconBolt },
  { type: "activityFeed", label: "Activity Feed", desc: "Recent changes stream", Icon: IconInbox },
  { type: "document", label: "Document", desc: "Rich text page content", Icon: IconPage },
  { type: "chat", label: "Chat", desc: "AI chat with data context", Icon: IconBell },
  { type: "linked_sheet", label: "Linked Sheet", desc: "Read-only Google Sheet or CSV", Icon: IconSheet },
];

// ── Icon map for page icon picker ──
const ICON_MAP = {
  page: IconPage,
  table: IconTable,
  kanban: IconKanban,
  chart: IconChart,
  form: IconForm,
  list: IconForm,
  calendar: IconCalendar,
  folder: IconFolder,
  star: IconStar,
  bolt: IconBolt,
  users: IconUsers,
  inbox: IconInbox,
  bell: IconBell,
  gear: IconGear,
};

const ICONS = Object.keys(ICON_MAP);

// ── Styles ──
const vs = {
  container: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    overflow: "hidden",
    fontFamily: FONT,
  },
  header: {
    padding: "20px 24px",
    borderBottom: `1px solid ${C.edgeLine}`,
    background: C.darkSurf,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 700,
    color: C.darkText,
    letterSpacing: "-0.01em",
    marginBottom: 4,
  },
  headerSub: {
    fontSize: 12,
    color: C.darkMuted,
  },
  body: {
    flex: 1,
    overflowY: "auto",
    padding: 24,
    display: "flex",
    flexDirection: "column",
    gap: 24,
  },
  section: {
    background: C.darkSurf,
    border: `1px solid ${C.darkBorder}`,
    borderRadius: RADIUS.xl,
    padding: 20,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    color: C.darkMuted,
    marginBottom: 14,
  },
  input: {
    width: "100%",
    background: C.darkSurf2,
    border: `1px solid ${C.darkBorder}`,
    borderRadius: RADIUS.md,
    padding: "10px 14px",
    fontSize: 14,
    fontFamily: FONT,
    color: C.darkText,
    outline: "none",
    boxSizing: "border-box",
    transition: "border-color 0.15s",
  },
  label: {
    fontSize: 12,
    color: C.darkMuted,
    marginBottom: 6,
    display: "block",
  },
  viewCard: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "12px 14px",
    background: C.darkSurf2,
    border: `1px solid ${C.darkBorder}`,
    borderRadius: RADIUS.lg,
    marginBottom: 8,
    transition: "border-color 0.15s",
  },
  viewTypeGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
    gap: 8,
  },
  viewTypeCard: (selected) => ({
    padding: "12px 14px",
    background: selected ? `${C.accent}18` : C.darkSurf2,
    border: `1px solid ${selected ? C.accent : C.darkBorder}`,
    borderRadius: RADIUS.lg,
    cursor: "pointer",
    transition: "all 0.15s",
    display: "flex",
    flexDirection: "column",
    gap: 6,
  }),
  footer: {
    padding: "16px 24px",
    borderTop: `1px solid ${C.edgeLine}`,
    background: C.darkSurf,
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  iconBtn: (active) => ({
    width: 34,
    height: 34,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: RADIUS.md,
    border: `1px solid ${active ? C.accent : C.darkBorder}`,
    background: active ? `${C.accent}18` : "transparent",
    cursor: "pointer",
    transition: "all 0.15s",
  }),
  error: {
    padding: "10px 14px",
    background: "#E0525218",
    border: "1px solid #E0525240",
    borderRadius: RADIUS.md,
    color: "#E05252",
    fontSize: 13,
  },
  success: {
    padding: "10px 14px",
    background: `${C.accent}18`,
    border: `1px solid ${C.accent}40`,
    borderRadius: RADIUS.md,
    color: C.accent,
    fontSize: 13,
  },
  connectedDbChip: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 12px",
    background: C.darkSurf2,
    border: `1px solid ${C.darkBorder}`,
    borderRadius: RADIUS.lg,
    fontSize: 12,
    color: C.darkText,
    fontFamily: FONT,
  },
  suggestBanner: {
    padding: "10px 14px",
    background: `${C.accent}10`,
    border: `1px solid ${C.accent}30`,
    borderRadius: RADIUS.md,
    color: C.accent,
    fontSize: 12,
    display: "flex",
    alignItems: "center",
    gap: 8,
    cursor: "pointer",
    transition: "background 0.15s",
  },
};

// ── Main Component ──
export default function VisualPageBuilder({ onCancel, parentFolderId, parentPageId }) {
  const { user, platformIds, addPage, activeFolder } = usePlatform();

  // Resolve effective parent IDs (props override context)
  const folderId = parentFolderId || activeFolder || null;
  const subPageParent = parentPageId || null;

  // ── Page Type Selection ── (null = show picker, "database", "document", or "folder")
  const [pageType, setPageType] = useState(null);

  // ── Page Config State ──
  const [pageName, setPageName] = useState("");
  const [pageIcon, setPageIcon] = useState("page");
  const [connectedDbs, setConnectedDbs] = useState([]); // [{ id, title, schema }]
  const [views, setViews] = useState([
    { type: "table", label: "Table", position: "main", config: {} },
  ]);
  const [refreshInterval, setRefreshInterval] = useState(30);

  // ── UI State ──
  const [addingView, setAddingView] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);

  // Get IDs of connected databases
  const connectedIds = useMemo(() => connectedDbs.map((db) => db.id), [connectedDbs]);

  // ── Handle database connection from DatabaseBrowser ──
  const handleDbConnect = useCallback(
    ({ id, title, schema }) => {
      // Avoid duplicate
      if (connectedDbs.some((db) => db.id === id)) return;

      const newDbs = [...connectedDbs, { id, title, schema }];
      setConnectedDbs(newDbs);

      // Auto-detect suggested views from the first connected database
      if (newDbs.length === 1 && schema) {
        setShowSuggestions(true);
      }
    },
    [connectedDbs]
  );

  // Remove a connected database
  const handleDbRemove = useCallback((dbId) => {
    setConnectedDbs((prev) => prev.filter((db) => db.id !== dbId));
  }, []);

  // Handle connecting a Google Sheet / CSV as a Linked Sheet view
  const handleSheetConnect = useCallback(({ sheetUrl, sheetType }) => {
    const newView = {
      type: "linked_sheet",
      label: "Linked Sheet",
      position: "main",
      config: { sheetUrl, sheetType },
    };
    setViews((prev) => {
      // If no Notion databases connected and the only view is the default empty Table,
      // replace it with the linked sheet instead of appending
      const isDefaultTableOnly = connectedDbs.length === 0
        && prev.length === 1
        && prev[0].type === "table"
        && Object.keys(prev[0].config || {}).length === 0;
      if (isDefaultTableOnly) return [newView];
      return [...prev, newView];
    });
  }, [connectedDbs]);

  // Apply auto-detected views — always ensure Table is first
  const applySuggestedViews = useCallback(() => {
    if (connectedDbs.length === 0) return;
    const schema = connectedDbs[0].schema;
    if (!schema) return;

    const suggested = autoDetectViews(schema);
    const newViews = suggested.slice(0, 4).map((s) => ({
      type: s.type,
      label: VIEW_TYPES.find((vt) => vt.type === s.type)?.label || s.type,
      position: "main",
      config: {},
    }));
    // Ensure Table is first view
    if (newViews[0]?.type !== "table") {
      const tableIdx = newViews.findIndex((v) => v.type === "table");
      if (tableIdx > 0) {
        const [t] = newViews.splice(tableIdx, 1);
        newViews.unshift(t);
      } else {
        newViews.unshift({ type: "table", label: "Table", position: "main", config: {} });
      }
    }
    setViews(newViews);
    setShowSuggestions(false);
  }, [connectedDbs]);

  // ── View management ──
  const addView = useCallback((type) => {
    const meta = VIEW_TYPES.find((v) => v.type === type);
    setViews((prev) => [
      ...prev,
      { type, label: meta?.label || type, position: "main", config: {} },
    ]);
    setAddingView(false);
  }, []);

  const removeView = useCallback((idx) => {
    setViews((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const moveView = useCallback((idx, dir) => {
    setViews((prev) => {
      const arr = [...prev];
      const newIdx = idx + dir;
      if (newIdx < 0 || newIdx >= arr.length) return prev;
      [arr[idx], arr[newIdx]] = [arr[newIdx], arr[idx]];
      return arr;
    });
  }, []);

  const updateViewLabel = useCallback((idx, label) => {
    setViews((prev) => prev.map((v, i) => (i === idx ? { ...v, label } : v)));
  }, []);

  // ── Save Database Page ──
  const hasLinkedSheets = views.some((v) => v.type === "linked_sheet");

  const handleSave = useCallback(async () => {
    setError(null);
    if (!pageName.trim()) {
      setError("Page name is required");
      return;
    }
    if (connectedDbs.length === 0 && !hasLinkedSheets) {
      setError("Connect at least one database or linked sheet");
      return;
    }
    if (views.length === 0) {
      setError("Add at least one view");
      return;
    }

    setSaving(true);
    try {
      const pageConfig = {
        name: pageName.trim(),
        icon: pageIcon,
        type: subPageParent ? "sub_page" : "page",
        parentId: subPageParent || folderId || null,
        pageType: "database",
        databaseIds: connectedDbs.map((db) => db.id),
        views,
        refreshInterval: refreshInterval * 1000,
      };

      // Save to Notion config DB
      const pageId = await savePageConfig(
        user.workerUrl,
        user.notionKey,
        platformIds.configDbId,
        pageConfig
      );

      // Add to local state
      addPage({ ...pageConfig, id: pageId });
      setSuccess(true);
    } catch (err) {
      setError(err.message || "Failed to save page");
    } finally {
      setSaving(false);
    }
  }, [pageName, pageIcon, connectedDbs, views, refreshInterval, user, platformIds, addPage, hasLinkedSheets]);

  // ── Save Document Page ──
  const handleSaveDocument = useCallback(async () => {
    setError(null);
    if (!pageName.trim()) {
      setError("Page name is required");
      return;
    }

    setSaving(true);
    try {
      // Ensure root page is active (auto-unarchive if needed)
      await ensurePageActive(user.workerUrl, user.notionKey, platformIds.rootPageId);

      // Create a Notion subpage under the root page
      const notionPage = await createSubpage(
        user.workerUrl,
        user.notionKey,
        platformIds.rootPageId,
        pageName.trim()
      );

      // Build document page config
      const docConfig = {
        ...createDocumentPageConfig(pageName.trim(), pageIcon, notionPage.id),
        type: subPageParent ? "sub_page" : "page",
        parentId: subPageParent || folderId || null,
      };

      // Save to Notion config DB
      const configId = await savePageConfig(
        user.workerUrl,
        user.notionKey,
        platformIds.configDbId,
        docConfig
      );

      // Add to local state
      addPage({ ...docConfig, id: configId });
      setSuccess(true);
    } catch (err) {
      setError(err.message || "Failed to create document page");
    } finally {
      setSaving(false);
    }
  }, [pageName, pageIcon, user, platformIds, addPage]);

  // ── Save Folder ──
  const handleSaveFolder = useCallback(async () => {
    setError(null);
    if (!pageName.trim()) {
      setError("Folder name is required");
      return;
    }
    setSaving(true);
    try {
      const config = createFolderConfig(pageName.trim(), pageIcon);
      const configId = await savePageConfig(
        user.workerUrl, user.notionKey, platformIds.configDbId, config
      );
      addPage({ ...config, id: configId });
      setSuccess(true);
    } catch (err) {
      setError(err.message || "Failed to create folder");
    } finally {
      setSaving(false);
    }
  }, [pageName, pageIcon, user, platformIds, addPage]);

  // ── Contextual header text ──
  const contextLabel = subPageParent
    ? "New Sub-page"
    : folderId
    ? "New Page"
    : "+ Create New";

  // ── Page Type Selection Screen ──
  if (!pageType) {
    // If creating a sub-page, skip folder option
    const showFolderOption = !subPageParent && !folderId;
    return (
      <div style={vs.container}>
        <div style={vs.header}>
          <div style={vs.headerTitle}>{contextLabel}</div>
          <div style={vs.headerSub}>Choose what kind of page to create</div>
        </div>
        <div style={{ ...vs.body, alignItems: "center", justifyContent: "center" }}>
          <div style={{ display: "flex", gap: 20, maxWidth: showFolderOption ? 740 : 560, width: "100%" }}>
            {/* Folder card (only at top level, not when creating inside a folder or as a sub-page) */}
            {showFolderOption && (
              <div
                style={{
                  flex: 1,
                  padding: 28,
                  background: C.darkSurf,
                  border: `1px solid ${C.darkBorder}`,
                  borderRadius: RADIUS.xl,
                  cursor: "pointer",
                  transition: "all 0.15s",
                  textAlign: "center",
                }}
                onClick={() => setPageType("folder")}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = C.accent; e.currentTarget.style.background = `${C.accent}08`; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = C.darkBorder; e.currentTarget.style.background = C.darkSurf; }}
              >
                <div style={{ marginBottom: 14 }}>
                  <IconFolder size={32} color={C.accent} />
                </div>
                <div style={{ fontSize: 16, fontWeight: 700, color: C.darkText, marginBottom: 8 }}>
                  Folder
                </div>
                <div style={{ fontSize: 13, color: C.darkMuted, lineHeight: 1.5 }}>
                  Organize your pages into groups. No database required.
                </div>
              </div>
            )}

            {/* Database Page card */}
            <div
              style={{
                flex: 1,
                padding: 28,
                background: C.darkSurf,
                border: `1px solid ${C.darkBorder}`,
                borderRadius: RADIUS.xl,
                cursor: "pointer",
                transition: "all 0.15s",
                textAlign: "center",
              }}
              onClick={() => setPageType("database")}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = C.accent; e.currentTarget.style.background = `${C.accent}08`; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = C.darkBorder; e.currentTarget.style.background = C.darkSurf; }}
            >
              <div style={{ marginBottom: 14 }}>
                <IconDatabase size={32} color={C.accent} />
              </div>
              <div style={{ fontSize: 16, fontWeight: 700, color: C.darkText, marginBottom: 8 }}>
                Database Page
              </div>
              <div style={{ fontSize: 13, color: C.darkMuted, lineHeight: 1.5 }}>
                Connect to Notion databases. Add tables, charts, kanban boards, and more.
              </div>
            </div>

            {/* Document Page card */}
            <div
              style={{
                flex: 1,
                padding: 28,
                background: C.darkSurf,
                border: `1px solid ${C.darkBorder}`,
                borderRadius: RADIUS.xl,
                cursor: "pointer",
                transition: "all 0.15s",
                textAlign: "center",
              }}
              onClick={() => setPageType("document")}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = C.accent; e.currentTarget.style.background = `${C.accent}08`; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = C.darkBorder; e.currentTarget.style.background = C.darkSurf; }}
            >
              <div style={{ marginBottom: 14 }}>
                <IconPage size={32} color={C.accent} />
              </div>
              <div style={{ fontSize: 16, fontWeight: 700, color: C.darkText, marginBottom: 8 }}>
                Document Page
              </div>
              <div style={{ fontSize: 13, color: C.darkMuted, lineHeight: 1.5 }}>
                Create a rich text document for notes, SOPs, and reference content.
              </div>
            </div>
          </div>
        </div>
        {/* Footer */}
        <div style={vs.footer}>
          {onCancel && (
            <button style={S.btnGhost} onClick={onCancel}>Cancel</button>
          )}
          <div style={{ flex: 1 }} />
        </div>
      </div>
    );
  }

  // ── Folder Creation Flow ──
  if (pageType === "folder") {
    return (
      <div style={vs.container}>
        <div style={vs.header}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              style={{ cursor: "pointer", display: "flex", alignItems: "center" }}
              onClick={() => setPageType(null)}
              title="Back to type selection"
            >
              <IconChevronLeft size={16} color={C.darkMuted} />
            </span>
            <div>
              <div style={vs.headerTitle}>New Folder</div>
              <div style={vs.headerSub}>Create an organizational folder for your pages</div>
            </div>
          </div>
        </div>
        <div style={vs.body}>
          <div style={vs.section}>
            <div style={vs.sectionTitle}>Folder Identity</div>
            <div style={{ display: "flex", gap: 12, marginBottom: 14 }}>
              <div>
                <label style={vs.label}>Icon</label>
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap", maxWidth: 200 }}>
                  {ICONS.map((ic) => {
                    const Ic = ICON_MAP[ic];
                    return (
                      <span key={ic} style={vs.iconBtn(pageIcon === ic)} onClick={() => setPageIcon(ic)} title={ic}>
                        <Ic size={16} color={pageIcon === ic ? C.accent : C.darkMuted} />
                      </span>
                    );
                  })}
                </div>
              </div>
              <div style={{ flex: 1 }}>
                <label style={vs.label}>Folder Name</label>
                <input
                  style={vs.input}
                  value={pageName}
                  onChange={(e) => setPageName(e.target.value)}
                  placeholder="e.g. Projects"
                  autoFocus
                />
              </div>
            </div>
          </div>

          <div style={{
            padding: "12px 16px", background: `${C.accent}10`,
            border: `1px solid ${C.accent}30`, borderRadius: RADIUS.md,
            fontSize: 13, color: C.darkMuted, lineHeight: 1.5,
          }}>
            Folders are purely organizational. Add pages inside them after creation.
          </div>

          {error && <div style={vs.error}>{error}</div>}
          {success && <div style={vs.success}>Folder created successfully!</div>}
        </div>
        <div style={vs.footer}>
          <button style={S.btnGhost} onClick={() => setPageType(null)}>Back</button>
          <div style={{ flex: 1 }} />
          <button
            style={{
              ...S.btnPrimary,
              padding: "10px 28px",
              fontSize: 14,
              fontWeight: 600,
              opacity: saving ? 0.6 : 1,
              cursor: saving ? "not-allowed" : "pointer",
            }}
            onClick={handleSaveFolder}
            disabled={saving}
          >
            {saving ? "Creating..." : "Create Folder"}
          </button>
        </div>
      </div>
    );
  }

  // ── Document Page Flow (simplified) ──
  if (pageType === "document") {
    return (
      <div style={vs.container}>
        <div style={vs.header}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              style={{ cursor: "pointer", display: "flex", alignItems: "center" }}
              onClick={() => setPageType(null)}
              title="Back to page type selection"
            >
              <IconChevronLeft size={16} color={C.darkMuted} />
            </span>
            <div>
              <div style={vs.headerTitle}>New Document</div>
              <div style={vs.headerSub}>Create a rich text document page</div>
            </div>
          </div>
        </div>
        <div style={vs.body}>
          {/* Page Identity */}
          <div style={vs.section}>
            <div style={vs.sectionTitle}>Page Identity</div>
            <div style={{ display: "flex", gap: 12, marginBottom: 14 }}>
              <div>
                <label style={vs.label}>Icon</label>
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap", maxWidth: 200 }}>
                  {ICONS.map((ic) => {
                    const Ic = ICON_MAP[ic];
                    return (
                      <span key={ic} style={vs.iconBtn(pageIcon === ic)} onClick={() => setPageIcon(ic)} title={ic}>
                        <Ic size={16} color={pageIcon === ic ? C.accent : C.darkMuted} />
                      </span>
                    );
                  })}
                </div>
              </div>
              <div style={{ flex: 1 }}>
                <label style={vs.label}>Document Name</label>
                <input
                  style={vs.input}
                  value={pageName}
                  onChange={(e) => setPageName(e.target.value)}
                  placeholder="e.g. Team Handbook"
                  autoFocus
                />
              </div>
            </div>
          </div>

          <div style={{ padding: "12px 16px", background: `${C.accent}10`, border: `1px solid ${C.accent}30`, borderRadius: RADIUS.md, fontSize: 13, color: C.darkMuted, lineHeight: 1.5 }}>
            A new Notion page will be created and linked to Wasabi. You can edit it using the built-in rich text editor.
          </div>

          {error && <div style={vs.error}>{error}</div>}
          {success && <div style={vs.success}>Document created successfully!</div>}
        </div>
        <div style={vs.footer}>
          <button style={S.btnGhost} onClick={() => setPageType(null)}>Back</button>
          <div style={{ flex: 1 }} />
          <button
            style={{
              ...S.btnPrimary,
              padding: "10px 28px",
              fontSize: 14,
              fontWeight: 600,
              opacity: saving ? 0.6 : 1,
              cursor: saving ? "not-allowed" : "pointer",
            }}
            onClick={handleSaveDocument}
            disabled={saving}
          >
            {saving ? "Creating..." : "Create Document"}
          </button>
        </div>
      </div>
    );
  }

  // ── Database Page Flow (existing) ──
  return (
    <div style={vs.container}>
      {/* Header */}
      <div style={vs.header}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{ cursor: "pointer", display: "flex", alignItems: "center" }}
            onClick={() => setPageType(null)}
            title="Back to page type selection"
          >
            <IconChevronLeft size={16} color={C.darkMuted} />
          </span>
          <div>
            <div style={vs.headerTitle}>New Database Page</div>
            <div style={vs.headerSub}>Connect databases, choose views, design your layout</div>
          </div>
        </div>
      </div>

      {/* Body */}
      <div style={vs.body}>
        {/* ── Page Identity ── */}
        <div style={vs.section}>
          <div style={vs.sectionTitle}>Page Identity</div>
          <div style={{ display: "flex", gap: 12, marginBottom: 14 }}>
            {/* Icon picker — now SVG */}
            <div>
              <label style={vs.label}>Icon</label>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap", maxWidth: 200 }}>
                {ICONS.map((ic) => {
                  const Ic = ICON_MAP[ic];
                  return (
                    <span
                      key={ic}
                      style={vs.iconBtn(pageIcon === ic)}
                      onClick={() => setPageIcon(ic)}
                      title={ic}
                    >
                      <Ic
                        size={16}
                        color={pageIcon === ic ? C.accent : C.darkMuted}
                      />
                    </span>
                  );
                })}
              </div>
            </div>

            {/* Name */}
            <div style={{ flex: 1 }}>
              <label style={vs.label}>Page Name</label>
              <input
                style={vs.input}
                value={pageName}
                onChange={(e) => setPageName(e.target.value)}
                placeholder="e.g. Project Tracker"
              />
            </div>
          </div>
        </div>

        {/* ── Database Connection ── */}
        <div style={vs.section}>
          <div style={vs.sectionTitle}>
            Database Connection{connectedDbs.length > 0 ? ` (${connectedDbs.length})` : ""}
          </div>

          {/* Connected databases list */}
          {connectedDbs.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
              {connectedDbs.map((db) => (
                <div key={db.id} style={vs.connectedDbChip}>
                  <IconDatabase size={14} color={C.accent} />
                  <span style={{ fontWeight: 500 }}>{db.title}</span>
                  <span
                    style={{ cursor: "pointer", padding: "0 2px", display: "flex" }}
                    onClick={() => handleDbRemove(db.id)}
                    title="Remove database"
                  >
                    <IconClose size={10} color={C.darkMuted} />
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Auto-detect views suggestion */}
          {showSuggestions && connectedDbs.length > 0 && (
            <div
              style={vs.suggestBanner}
              onClick={applySuggestedViews}
              onMouseEnter={(e) => { e.currentTarget.style.background = `${C.accent}18`; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = `${C.accent}10`; }}
            >
              <IconBolt size={14} color={C.accent} />
              <span>
                Database detected! Click here to auto-configure recommended views for <strong>{connectedDbs[0]?.title}</strong>
              </span>
            </div>
          )}

          {/* Database browser */}
          <DatabaseBrowser
            onConnect={handleDbConnect}
            onConnectSheet={handleSheetConnect}
            connectedIds={connectedIds}
            multi={true}
          />
        </div>

        {/* ── Views ── */}
        <div style={vs.section}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <div style={vs.sectionTitle}>Views ({views.length})</div>
            <button
              style={{ ...S.btnGhost, fontSize: 12, padding: "4px 12px" }}
              onClick={() => setAddingView(!addingView)}
            >
              {addingView ? "Cancel" : "+ Add View"}
            </button>
          </div>

          {/* Add view grid */}
          {addingView && (
            <div style={{ ...vs.viewTypeGrid, marginBottom: 16 }}>
              {VIEW_TYPES.map((vt) => {
                const VtIcon = vt.Icon;
                return (
                  <div
                    key={vt.type}
                    style={vs.viewTypeCard(false)}
                    onClick={() => addView(vt.type)}
                    onMouseEnter={(e) => { e.currentTarget.style.borderColor = C.accent; }}
                    onMouseLeave={(e) => { e.currentTarget.style.borderColor = C.darkBorder; }}
                  >
                    <VtIcon size={16} color={C.darkMuted} />
                    <div style={{ fontSize: 13, fontWeight: 600, color: C.darkText }}>
                      {vt.label}
                    </div>
                    <div style={{ fontSize: 11, color: C.darkMuted, lineHeight: 1.4 }}>
                      {vt.desc}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Existing views */}
          {views.map((v, idx) => {
            const vtMeta = VIEW_TYPES.find((vt) => vt.type === v.type);
            const VtIcon = vtMeta?.Icon || IconPage;
            return (
              <div key={idx} style={vs.viewCard}>
                {/* Reorder arrows */}
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <span
                    style={{ cursor: idx > 0 ? "pointer" : "not-allowed", opacity: idx > 0 ? 1 : 0.3, fontSize: 10, color: C.darkMuted }}
                    onClick={() => moveView(idx, -1)}
                  >
                    &#x25B2;
                  </span>
                  <span
                    style={{ cursor: idx < views.length - 1 ? "pointer" : "not-allowed", opacity: idx < views.length - 1 ? 1 : 0.3, fontSize: 10, color: C.darkMuted }}
                    onClick={() => moveView(idx, 1)}
                  >
                    &#x25BC;
                  </span>
                </div>

                {/* View type badge — solid pill */}
                <span style={{
                  fontSize: 10,
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  color: "#fff",
                  background: C.accent,
                  borderRadius: RADIUS.pill,
                  padding: "3px 10px",
                  whiteSpace: "nowrap",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                }}>
                  <VtIcon size={11} color="#fff" />
                  {v.type}
                </span>

                {/* Editable label */}
                <input
                  style={{
                    flex: 1,
                    background: "transparent",
                    border: "none",
                    outline: "none",
                    fontSize: 13,
                    fontFamily: FONT,
                    color: C.darkText,
                    padding: "4px 0",
                  }}
                  value={v.label}
                  onChange={(e) => updateViewLabel(idx, e.target.value)}
                  placeholder="View label"
                />

                {/* Remove button */}
                <span
                  style={{ cursor: "pointer", display: "flex", padding: "4px 8px" }}
                  onClick={() => removeView(idx)}
                  title="Remove view"
                >
                  <IconClose size={10} color={C.darkMuted} />
                </span>
              </div>
            );
          })}

          {views.length === 0 && (
            <div style={{ textAlign: "center", color: C.darkMuted, fontSize: 13, padding: 20 }}>
              No views added yet. Click "+ Add View" above.
            </div>
          )}
        </div>

        {/* ── Settings ── */}
        <div style={vs.section}>
          <div style={vs.sectionTitle}>Settings</div>
          <label style={vs.label}>Auto-refresh interval (seconds)</label>
          <input
            type="number"
            style={{ ...vs.input, maxWidth: 120 }}
            value={refreshInterval}
            onChange={(e) => setRefreshInterval(Math.max(0, parseInt(e.target.value) || 0))}
            min="0"
            step="5"
          />
          <div style={{ fontSize: 11, color: C.darkMuted, marginTop: 4 }}>
            Set to 0 to disable auto-refresh.
          </div>
        </div>

        {/* Status messages */}
        {error && <div style={vs.error}>{error}</div>}
        {success && <div style={vs.success}>Page created successfully!</div>}
      </div>

      {/* Footer */}
      <div style={vs.footer}>
        <button style={S.btnGhost} onClick={() => setPageType(null)}>
          Back
        </button>
        <div style={{ flex: 1 }} />
        <button
          style={{
            ...S.btnPrimary,
            padding: "10px 28px",
            fontSize: 14,
            fontWeight: 600,
            opacity: saving ? 0.6 : 1,
            cursor: saving ? "not-allowed" : "pointer",
          }}
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? "Saving..." : "Create Page"}
        </button>
      </div>
    </div>
  );
}
