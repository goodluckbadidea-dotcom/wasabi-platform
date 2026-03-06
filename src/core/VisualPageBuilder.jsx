// ─── Visual Page Builder ───
// A drag-less visual editor for assembling page configs.
// Complementary to the chat-based PageBuilder.

import React, { useState, useCallback, useMemo } from "react";
import { C, FONT, RADIUS, SHADOW } from "../design/tokens.js";
import { S } from "../design/styles.js";
import { usePlatform } from "../context/PlatformContext.jsx";
import { savePageConfig } from "../config/pageConfig.js";
import { getDatabase } from "../notion/client.js";
import { detectSchema } from "../notion/schema.js";

// ── Available view types ──
const VIEW_TYPES = [
  { type: "table", label: "Table", desc: "Sortable, filterable data grid" },
  { type: "kanban", label: "Kanban", desc: "Drag-and-drop board by status" },
  { type: "cardGrid", label: "Card Grid", desc: "Visual cards with images" },
  { type: "gantt", label: "Gantt", desc: "Timeline / date-range chart" },
  { type: "charts", label: "Charts", desc: "Bar, pie, and line charts" },
  { type: "form", label: "Form", desc: "Create new records" },
  { type: "summaryTiles", label: "Summary Tiles", desc: "KPI metric tiles" },
  { type: "activityFeed", label: "Activity Feed", desc: "Recent changes stream" },
  { type: "document", label: "Document", desc: "Rich text page content" },
  { type: "chat", label: "Chat", desc: "AI chat with data context" },
];

const ICONS = [
  "page", "table", "kanban", "chart", "form", "list", "calendar",
  "folder", "star", "bolt", "users", "inbox", "bell", "gear",
];

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
  row: {
    display: "flex",
    gap: 12,
    alignItems: "center",
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
    fontSize: 14,
    color: active ? C.accent : C.darkMuted,
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
};

// ── Helper: icon lookup ──
function iconGlyph(icon) {
  const map = {
    page: "\u{1F4C4}", table: "\u{1F4CA}", kanban: "\u{1F4CB}", chart: "\u{1F4C8}",
    form: "\u{1F4DD}", list: "\u{1F4CB}", calendar: "\u{1F4C5}", folder: "\u{1F4C1}",
    star: "\u2B50", bolt: "\u26A1", users: "\u{1F465}", inbox: "\u{1F4E5}",
    bell: "\u{1F514}", gear: "\u2699",
  };
  return map[icon] || "\u{1F4C4}";
}

// ── Main Component ──
export default function VisualPageBuilder({ onCancel }) {
  const { user, platformIds, addPage } = usePlatform();

  // ── Page Config State ──
  const [pageName, setPageName] = useState("");
  const [pageIcon, setPageIcon] = useState("page");
  const [databaseId, setDatabaseId] = useState("");
  const [views, setViews] = useState([
    { type: "table", label: "Table", position: "main", config: {} },
  ]);
  const [refreshInterval, setRefreshInterval] = useState(30);

  // ── UI State ──
  const [addingView, setAddingView] = useState(false);
  const [validatingDb, setValidatingDb] = useState(false);
  const [dbValid, setDbValid] = useState(null); // null | true | "error msg"
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);

  // ── Database validation ──
  const validateDatabase = useCallback(async () => {
    if (!databaseId.trim()) return;
    setValidatingDb(true);
    setDbValid(null);
    try {
      const cleanId = databaseId.trim().replace(/-/g, "");
      await getDatabase(user.workerUrl, user.notionKey, cleanId);
      setDbValid(true);
    } catch (err) {
      setDbValid(err.message || "Could not access database");
    } finally {
      setValidatingDb(false);
    }
  }, [databaseId, user]);

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

  // ── Save ──
  const handleSave = useCallback(async () => {
    setError(null);
    if (!pageName.trim()) {
      setError("Page name is required");
      return;
    }
    if (!databaseId.trim()) {
      setError("Database ID is required");
      return;
    }
    if (views.length === 0) {
      setError("Add at least one view");
      return;
    }

    setSaving(true);
    try {
      const cleanDbId = databaseId.trim().replace(/-/g, "");
      const pageConfig = {
        name: pageName.trim(),
        icon: pageIcon,
        databaseIds: [cleanDbId],
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
  }, [pageName, pageIcon, databaseId, views, refreshInterval, user, platformIds, addPage]);

  return (
    <div style={vs.container}>
      {/* Header */}
      <div style={vs.header}>
        <div style={vs.headerTitle}>Visual Page Builder</div>
        <div style={vs.headerSub}>Design your page layout without code</div>
      </div>

      {/* Body */}
      <div style={vs.body}>
        {/* ── Page Identity ── */}
        <div style={vs.section}>
          <div style={vs.sectionTitle}>Page Identity</div>
          <div style={{ display: "flex", gap: 12, marginBottom: 14 }}>
            {/* Icon picker */}
            <div>
              <label style={vs.label}>Icon</label>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap", maxWidth: 200 }}>
                {ICONS.map((ic) => (
                  <span
                    key={ic}
                    style={vs.iconBtn(pageIcon === ic)}
                    onClick={() => setPageIcon(ic)}
                    title={ic}
                  >
                    {iconGlyph(ic)}
                  </span>
                ))}
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
          <div style={vs.sectionTitle}>Database Connection</div>
          <label style={vs.label}>Notion Database ID</label>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              style={{ ...vs.input, flex: 1 }}
              value={databaseId}
              onChange={(e) => { setDatabaseId(e.target.value); setDbValid(null); }}
              placeholder="Paste database ID or URL"
            />
            <button
              style={{ ...S.btnSecondary, whiteSpace: "nowrap", padding: "8px 16px" }}
              onClick={validateDatabase}
              disabled={validatingDb || !databaseId.trim()}
            >
              {validatingDb ? "Checking..." : "Validate"}
            </button>
          </div>
          {dbValid === true && (
            <div style={{ fontSize: 12, color: C.accent, marginTop: 6 }}>
              Database connected successfully
            </div>
          )}
          {dbValid && dbValid !== true && (
            <div style={{ fontSize: 12, color: "#E05252", marginTop: 6 }}>
              {dbValid}
            </div>
          )}
          <div style={{ fontSize: 11, color: C.darkMuted, marginTop: 6 }}>
            Tip: Open your Notion database, copy the URL, and paste the ID portion here.
          </div>
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
              {VIEW_TYPES.map((vt) => (
                <div
                  key={vt.type}
                  style={vs.viewTypeCard(false)}
                  onClick={() => addView(vt.type)}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = C.accent; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = C.darkBorder; }}
                >
                  <div style={{ fontSize: 13, fontWeight: 600, color: C.darkText, marginBottom: 2 }}>
                    {vt.label}
                  </div>
                  <div style={{ fontSize: 11, color: C.darkMuted, lineHeight: 1.4 }}>
                    {vt.desc}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Existing views */}
          {views.map((v, idx) => (
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

              {/* View type badge */}
              <span style={{
                fontSize: 10,
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                color: C.accent,
                background: `${C.accent}18`,
                border: `1px solid ${C.accent}40`,
                borderRadius: RADIUS.pill,
                padding: "2px 10px",
                whiteSpace: "nowrap",
              }}>
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
                style={{ cursor: "pointer", color: C.darkMuted, fontSize: 14, padding: "4px 8px" }}
                onClick={() => removeView(idx)}
                title="Remove view"
              >
                &#x2715;
              </span>
            </div>
          ))}

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
        {onCancel && (
          <button style={S.btnGhost} onClick={onCancel}>
            Cancel
          </button>
        )}
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
