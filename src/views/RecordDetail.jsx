// ─── Record Detail Panel ───
// Slide-out drawer showing all properties of a single record.
// Supports inline editing for text, number, select, status, multi-select, date, checkbox, URL.
// Read-only display for formula, rollup, created_time, last_edited_time, people, relation.

import React, { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { C, FONT, RADIUS, SHADOW, Z, getSolidPillColor } from "../design/tokens.js";
import { useViewport } from "../context/ViewportContext.jsx";
import { readProp, buildProp } from "../notion/properties.js";
import { IconClose, IconEdit, IconExpand, IconFigma } from "../design/icons.jsx";
import { timeAgo, formatDate } from "../utils/helpers.js";
import NeuronBadge from "../neurons/NeuronBadge.jsx";
import RecordComments from "../components/RecordComments.jsx";
import RecordFiles from "../components/RecordFiles.jsx";
import FigmaFilePicker from "../components/FigmaFilePicker.jsx";
import FigmaCellPreview from "../components/FigmaCellPreview.jsx";
import { useCollaboration } from "../context/CollaborationContext.jsx";
import { usePlatform } from "../context/PlatformContext.jsx";
import PresenceAvatars from "../components/PresenceAvatars.jsx";
import { listUserDirectory, updateRowOwner, listChildRows, createRows, listRows, listFigmaLinksForRecord, deleteFigmaCommentLink } from "../lib/api.js";
import { useNavigation } from "../context/NavigationContext.jsx";
import { IconPlus, IconChevronDown } from "../design/icons.jsx";
import { useRelationships } from "../context/RelationshipsContext.jsx";

// ── Property type labels ──
const TYPE_LABELS = {
  title: "Title",
  rich_text: "Text",
  number: "Number",
  select: "Select",
  status: "Status",
  multi_select: "Multi-Select",
  date: "Date",
  checkbox: "Checkbox",
  url: "URL",
  email: "Email",
  phone_number: "Phone",
  formula: "Formula",
  rollup: "Rollup",
  relation: "Relation",
  people: "People",
  files: "Files",
  created_time: "Created",
  last_edited_time: "Last Edited",
  created_by: "Created By",
  last_edited_by: "Last Edited By",
  unique_id: "ID",
};

// Editable property types
const EDITABLE_TYPES = new Set([
  "title", "rich_text", "number", "select", "status",
  "multi_select", "date", "checkbox", "url", "email", "phone_number",
  "figma_files",
]);

// ── Styles ──
// Returned from function so theme switches pick up fresh C values.
function getDs() { return {
  overlay: {
    position: "fixed",
    inset: 0,
    background: C.overlayBg,
    zIndex: Z.modal,
    display: "flex",
    alignItems: "stretch",
    justifyContent: "flex-end",
  },
  drawer: {
    width: 520,
    maxWidth: "94vw",
    background: C.darkSurf,
    borderLeft: `1px solid ${C.darkBorder}`,
    display: "flex",
    flexDirection: "column",
    boxShadow: SHADOW.dropdown,
    fontFamily: FONT,
    animation: "slideInRight 0.2s ease-out",
  },
  header: {
    display: "flex",
    alignItems: "center",
    padding: "16px 20px",
    borderBottom: `1px solid ${C.edgeLine}`,
    gap: 12,
    flexShrink: 0,
  },
  title: {
    flex: 1,
    fontSize: 17,
    fontWeight: 700,
    color: C.darkText,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: RADIUS.pill,
    border: `1px solid ${C.darkBorder}`,
    background: C.darkSurf2,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    transition: "background 0.15s",
  },
  body: {
    flex: 1,
    overflowY: "auto",
    padding: "12px 0",
  },
  propRow: {
    display: "flex",
    alignItems: "flex-start",
    padding: "10px 20px",
    gap: 12,
    borderBottom: `1px solid ${C.edgeLine}`,
    minHeight: 44,
    transition: "background 0.1s",
  },
  propLabel: {
    width: 130,
    flexShrink: 0,
    fontSize: 11,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    color: C.darkMuted,
    paddingTop: 4,
    display: "flex",
    flexDirection: "column",
    gap: 2,
  },
  propType: {
    fontSize: 9,
    fontWeight: 400,
    textTransform: "none",
    letterSpacing: "0.02em",
    color: C.darkMuted + "88",
  },
  propValue: {
    flex: 1,
    fontSize: 13,
    color: C.darkText,
    lineHeight: 1.55,
    minHeight: 24,
    display: "flex",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
  },
  input: {
    width: "100%",
    background: C.dark,
    border: `1px solid ${C.darkBorder}`,
    borderRadius: RADIUS.md,
    padding: "6px 10px",
    fontSize: 13,
    fontFamily: FONT,
    color: C.darkText,
    outline: "none",
    transition: "border-color 0.15s",
  },
  pill: (fill, text) => ({
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    padding: "2px 10px",
    borderRadius: RADIUS.pill,
    fontSize: 11,
    fontWeight: 600,
    color: text || "#fff",
    background: fill,
    cursor: "pointer",
    whiteSpace: "nowrap",
  }),
  tabBar: {
    display: "flex",
    gap: 4,
    padding: "8px 20px",
    borderBottom: `1px solid ${C.edgeLine}`,
    flexShrink: 0,
  },
  tab: (active) => ({
    padding: "5px 14px",
    borderRadius: RADIUS.pill,
    fontSize: 12,
    fontWeight: 600,
    fontFamily: FONT,
    cursor: "pointer",
    border: "none",
    transition: "all 0.15s",
    background: active ? C.accent : C.darkSurf2,
    color: active ? "#fff" : C.darkMuted,
  }),
  notesArea: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    padding: "16px 20px",
    gap: 8,
  },
  noteTextarea: {
    flex: 1,
    width: "100%",
    minHeight: 200,
    background: C.dark,
    border: `1px solid ${C.darkBorder}`,
    borderRadius: RADIUS.lg,
    padding: "12px 14px",
    fontSize: 13,
    fontFamily: FONT,
    color: C.darkText,
    outline: "none",
    resize: "vertical",
    lineHeight: 1.6,
    transition: "border-color 0.15s",
  },
  noteStatus: {
    fontSize: 11,
    fontWeight: 500,
    color: C.darkMuted,
    textAlign: "right",
    minHeight: 16,
  },
  commentsList: {
    flex: 1,
    overflowY: "auto",
    padding: "12px 20px",
  },
  commentItem: {
    padding: "10px 0",
    borderBottom: `1px solid ${C.edgeLine}`,
    display: "flex",
    alignItems: "flex-start",
    gap: 8,
  },
  commentContent: {
    flex: 1,
    fontSize: 13,
    color: C.darkText,
    lineHeight: 1.5,
  },
  commentMeta: {
    fontSize: 11,
    color: C.darkMuted,
    marginTop: 4,
  },
  commentDeleteBtn: {
    width: 22,
    height: 22,
    borderRadius: RADIUS.sm,
    border: "none",
    background: "transparent",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    color: C.darkMuted,
    fontSize: 14,
    transition: "background 0.15s, color 0.15s",
  },
  commentInput: {
    display: "flex",
    gap: 8,
    padding: "12px 20px",
    borderTop: `1px solid ${C.edgeLine}`,
    flexShrink: 0,
  },
  emptyState: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flex: 1,
    color: C.darkMuted,
    fontSize: 13,
    fontStyle: "italic",
    padding: 40,
  },
  selectDropdown: {
    position: "absolute",
    top: "100%",
    left: 0,
    right: 0,
    background: C.darkSurf,
    border: `1px solid ${C.darkBorder}`,
    borderRadius: RADIUS.lg,
    boxShadow: SHADOW.dropdown,
    zIndex: 10,
    maxHeight: 200,
    overflowY: "auto",
    marginTop: 4,
  },
  selectOption: {
    padding: "8px 12px",
    fontSize: 12,
    cursor: "pointer",
    transition: "background 0.1s",
    color: C.darkText,
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  footer: {
    padding: "12px 20px",
    borderTop: `1px solid ${C.edgeLine}`,
    display: "flex",
    gap: 8,
    justifyContent: "flex-end",
    flexShrink: 0,
  },
  btn: (primary) => ({
    padding: "7px 18px",
    borderRadius: RADIUS.pill,
    fontSize: 12,
    fontWeight: 600,
    fontFamily: FONT,
    cursor: "pointer",
    transition: "all 0.15s",
    border: primary ? "none" : `1px solid ${C.darkBorder}`,
    background: primary ? C.accent : C.darkSurf2,
    color: primary ? "#fff" : C.darkText,
  }),
}; }

// Inject slide-in animation
if (typeof document !== "undefined") {
  const styleId = "record-detail-anim";
  if (!document.getElementById(styleId)) {
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = `@keyframes slideInRight{from{transform:translateX(100%);opacity:0}to{transform:translateX(0);opacity:1}} .prop-row-hover:hover .link-btn-hover{opacity:1!important}`;
    document.head.appendChild(style);
  }
}

// ── Owner Picker Dropdown ──
const OwnerPickerDropdown = React.forwardRef(function OwnerPickerDropdown({ ownerIds, users, onCommit, onClose }, ref) {
  const [selected, setSelected] = useState(new Set(ownerIds || []));
  const [filter, setFilter] = useState("");

  const filtered = (users || []).filter((u) =>
    u.display_name?.toLowerCase().includes(filter.toLowerCase())
  );

  const toggle = (uid) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid); else next.add(uid);
      return next;
    });
  };

  return (
    <div
      ref={ref}
      onClick={(e) => e.stopPropagation()}
      style={{
        position: "absolute", top: "100%", left: 0, zIndex: 200,
        background: C.darkSurf, border: `1px solid ${C.darkBorder}`,
        borderRadius: RADIUS.lg, boxShadow: SHADOW.dropdown,
        width: 240, maxHeight: 300, display: "flex", flexDirection: "column",
        fontFamily: FONT,
      }}
    >
      <input
        autoFocus
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Filter users..."
        style={{
          border: "none", borderBottom: `1px solid ${C.darkBorder}`,
          background: "transparent", color: C.darkText,
          padding: "8px 10px", fontSize: 12, outline: "none",
        }}
      />
      <div style={{ flex: 1, overflowY: "auto", padding: 4 }}>
        {filtered.map((u) => (
          <label
            key={u.id}
            style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "6px 8px", borderRadius: RADIUS.sm,
              cursor: "pointer", fontSize: 12, color: C.darkText,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = C.darkBorder; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
          >
            <input
              type="checkbox"
              checked={selected.has(u.id)}
              onChange={() => toggle(u.id)}
              style={{ accentColor: C.accent }}
            />
            <span style={{
              width: 20, height: 20, borderRadius: "50%",
              background: `linear-gradient(135deg, ${C.accent}, ${C.accent}88)`,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 10, fontWeight: 700, color: "#fff", flexShrink: 0,
            }}>{(u.display_name || "?").charAt(0).toUpperCase()}</span>
            <span style={{ flex: 1 }}>{u.display_name || u.id.slice(0, 8)}</span>
            <span style={{ fontSize: 10, color: C.darkMuted, textTransform: "capitalize" }}>{u.role}</span>
          </label>
        ))}
        {filtered.length === 0 && (
          <div style={{ padding: "12px 8px", fontSize: 11, color: C.darkMuted, textAlign: "center" }}>No users found</div>
        )}
      </div>
      <button
        onClick={() => onCommit(Array.from(selected))}
        style={{
          margin: 6, padding: "6px 0", border: "none",
          borderRadius: RADIUS.sm, background: C.accent, color: "#fff",
          fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: FONT,
        }}
      >Done</button>
    </div>
  );
});

// ── Main Component ──
export default function RecordDetail({ page, schema, onClose, onUpdate, onDelete, pageConfigId, resolvedLinks, onLinkField, onUnlinkField, onRefresh, onCreateOption, parentTitle }) {
  const ds = getDs();
  const { isTablet } = useViewport();
  const { identity, pages, setActiveRightPane } = usePlatform();

  // ── Extensions: detect when this record is a snapshot in the Reports DB ──
  // The Reports page_config is flagged via `_extensionsReportsDb: true` in its
  // stored config blob. d1ToFrontend() spreads `...config` into the page object,
  // so on the frontend the flag lives at `page._extensionsReportsDb` (NOT
  // page.config._extensionsReportsDb). When detected, surface a prominent
  // "Open report" banner that routes to ExtensionViewer via
  // App.jsx's `extension-snapshot:<id>` activeRightPane value.
  const reportsSnapshotId = (() => {
    if (!page || !pageConfigId) return null;
    const reportsPage = pages?.find?.((p) => p.id === pageConfigId);
    if (!reportsPage?._extensionsReportsDb) return null;
    // snapshot_id was written by the worker into the row's "Snapshot ID"
    // property at generation time. Read via readProp like every other cell.
    const prop = page.properties?.["Snapshot ID"];
    if (!prop) return null;
    const val = readProp(prop);
    return typeof val === "string" && val.length > 0 ? val : null;
  })();
  const handleViewReport = useCallback(() => {
    if (!reportsSnapshotId) return;
    onClose?.();
    setActiveRightPane(`extension-snapshot:${reportsSnapshotId}`);
  }, [reportsSnapshotId, onClose, setActiveRightPane]);
  const [editingField, setEditingField] = useState(null);
  const [editValue, setEditValue] = useState(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pendingChanges, setPendingChanges] = useState({});
  // Mirror pendingChanges in a ref so handleSave can read the freshest value
  // even when an in-flight edit's blur queued a state update that hasn't yet
  // re-rendered before the Done click handler runs.
  const pendingChangesRef = useRef({});
  useEffect(() => { pendingChangesRef.current = pendingChanges; }, [pendingChanges]);
  const [activeTab, setActiveTab] = useState("properties");
  const collab = useCollaboration();
  // Stable ref for collab actions — avoids re-firing effects on every presence update
  const collabRef = useRef(collab);
  collabRef.current = collab;

  // ── Owner state ──
  const [ownerIds, setOwnerIds] = useState(page?._ownerUserIds || []);
  const [teamUsers, setTeamUsers] = useState([]);
  const [ownerPickerOpen, setOwnerPickerOpen] = useState(false);
  const ownerPickerRef = useRef(null);

  useEffect(() => { setOwnerIds(page?._ownerUserIds || []); }, [page?.id]);

  useEffect(() => {
    listUserDirectory()
      .then((res) => {
        setTeamUsers(res.users || []);
      })
      .catch(err => console.warn("[RecordDetail] listUserDirectory:", err.message || err));
  }, []);

  // Close owner picker on outside click
  useEffect(() => {
    if (!ownerPickerOpen) return;
    const h = (e) => { if (ownerPickerRef.current && !ownerPickerRef.current.contains(e.target)) setOwnerPickerOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [ownerPickerOpen]);

  // ── Collaboration: focus/blur on open/close ──
  // Uses collabRef to avoid re-firing on every activeUsers change (which would
  // cause a blur→focus feedback loop between concurrent viewers, strobing the UI).
  useEffect(() => {
    if (!page?.id || !collabRef.current) return;
    collabRef.current.focusRecord(page.id);
    return () => collabRef.current?.blurRecord();
  }, [page?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Clear typing indicator when user stops editing a field (clicks away, switches field)
  useEffect(() => {
    if (!editingField && collabRef.current) collabRef.current.stopTyping();
  }, [editingField]); // eslint-disable-line react-hooks/exhaustive-deps

  // Get ordered property list from schema
  const properties = useMemo(() => {
    if (!page?.properties) return [];
    const entries = Object.entries(page.properties);
    // Title first, then sort by type priority
    const typePriority = ["title", "status", "select", "multi_select", "number", "date", "rich_text", "checkbox", "url", "email", "phone_number"];
    return entries.sort(([, a], [, b]) => {
      const ai = typePriority.indexOf(a.type);
      const bi = typePriority.indexOf(b.type);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });
  }, [page]);

  // Get title
  const title = useMemo(() => {
    for (const [, prop] of Object.entries(page.properties || {})) {
      if (prop.type === "title") return readProp(prop) || "Untitled";
    }
    return "Untitled";
  }, [page]);

  // Start editing a field
  const startEdit = useCallback((fieldName, prop) => {
    if (!EDITABLE_TYPES.has(prop.type)) return;
    setEditingField(fieldName);
    setEditValue(readProp(prop));
    if (collab && page?.id) collab.startTyping(page.id, fieldName);
  }, [collab, page?.id]);

  // Commit an edit. Mirror to the ref synchronously so a Done click that
  // immediately follows the blur reads the freshest pendingChanges even
  // before React re-renders.
  const commitEdit = useCallback((fieldName, type, value) => {
    const propPayload = buildProp(type, value);
    if (propPayload) {
      pendingChangesRef.current = {
        ...pendingChangesRef.current,
        [fieldName]: { type, value, payload: propPayload },
      };
      setPendingChanges(pendingChangesRef.current);
    }
    setEditingField(null);
    setEditValue(null);
    if (collab) collab.stopTyping();
  }, [collab]);

  // Save all pending changes
  const handleSave = useCallback(async () => {
    // Force any in-flight input edit to commit before reading the queue:
    // mousedown on the Done button blurs the active input, which fires
    // commitEdit synchronously. By the time we get here, pendingChangesRef
    // is up to date even if a re-render hasn't run yet.
    if (typeof document !== "undefined" && document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }

    const changes = pendingChangesRef.current;
    if (Object.keys(changes).length === 0) {
      onClose();
      return;
    }

    setSaving(true);
    try {
      // Call onUpdate per field — PageShell expects (pageId, fieldName, propPayload)
      for (const [fieldName, change] of Object.entries(changes)) {
        await onUpdate(page.id, fieldName, change.payload);
      }
      pendingChangesRef.current = {};
      setPendingChanges({});
      onClose();
    } catch (err) {
      console.error("Save failed:", err);
      alert("Failed to save: " + err.message);
    } finally {
      setSaving(false);
    }
  }, [page.id, onUpdate, onClose]);

  // Get schema field info
  const getSchemaField = useCallback((fieldName, type) => {
    if (!schema) return null;
    const buckets = {
      select: "selects",
      status: "statuses",
      multi_select: "multiSelects",
    };
    const bucket = buckets[type];
    if (!bucket || !schema[bucket]) return null;
    return schema[bucket].find((f) => f.name === fieldName);
  }, [schema]);

  if (!page) return null;

  // Portal the overlay to document.body so position:fixed is viewport-anchored,
  // regardless of any ancestor that may create a containing block (e.g. via
  // transform, filter, will-change, contain). Without the portal the overlay
  // can render constrained to the right-pane wrapper and the Save-button
  // footer ends up hidden under BottomBar.
  return createPortal((
    <div style={ds.overlay} onClick={onClose} onKeyDown={(e) => e.stopPropagation()}>
      <div style={{ ...ds.drawer, ...(isTablet ? { width: 400 } : {}) }} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={ds.header}>
          <div style={{ ...ds.title, display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{title}</span>
            <NeuronBadge nodeId={page.id} />
          </div>
          {Object.keys(pendingChanges).length > 0 && (
            <span style={{ fontSize: 11, color: C.accent, fontWeight: 600 }}>
              {Object.keys(pendingChanges).length} unsaved
            </span>
          )}
          <button
            style={ds.closeBtn}
            onClick={onClose}
            onMouseEnter={(e) => { e.currentTarget.style.background = C.darkBorder; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = C.darkSurf2; }}
          >
            <IconClose size={12} color={C.darkMuted} />
          </button>
        </div>

        {/* Collaboration banner */}
        {(() => {
          const others = collab?.getUsersOnRecord?.(page.id) || [];
          if (others.length === 0) return null;
          const anyTyping = others.some((u) => u.isTyping);
          return (
            <div style={{
              padding: "6px 16px", background: C.accent + "12",
              borderBottom: `1px solid ${C.accent}22`,
              fontSize: 11, color: C.accent, display: "flex", alignItems: "center", gap: 8,
            }}>
              <PresenceAvatars users={others} size={22} maxVisible={4} />
              <span>
                {others.map(u => u.userName || "User").join(", ")}{" "}
                {anyTyping ? <>editing {others.filter(u => u.isTyping && u.typingField).map(u => u.typingField).filter((v, i, a) => a.indexOf(v) === i).join(", ")}</> : "viewing"} — changes merge automatically
              </span>
            </div>
          );
        })()}

        {/* Extension snapshot — prominent "View Report" CTA */}
        {reportsSnapshotId && (
          <div
            onClick={handleViewReport}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") handleViewReport(); }}
            style={{
              padding: "12px 16px",
              background: `linear-gradient(135deg, ${C.accent}1f, ${C.accent}0f)`,
              borderBottom: `1px solid ${C.accent}33`,
              display: "flex", alignItems: "center", gap: 10,
              cursor: "pointer", transition: "background 0.15s",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = `linear-gradient(135deg, ${C.accent}33, ${C.accent}1f)`; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = `linear-gradient(135deg, ${C.accent}1f, ${C.accent}0f)`; }}
          >
            <div style={{
              width: 32, height: 32, borderRadius: 8,
              background: C.accent, display: "flex",
              alignItems: "center", justifyContent: "center", flexShrink: 0,
            }}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M2 4h12v8H2z" stroke={C.bg} strokeWidth="1.5" />
                <path d="M5 7h6M5 9h4" stroke={C.bg} strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: C.darkText, fontFamily: FONT }}>
                Open report
              </div>
              <div style={{ fontSize: 11, color: C.darkMuted, marginTop: 2 }}>
                Render the generated report inside Wasabi
              </div>
            </div>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
              <path d="M6 4l4 4-4 4" stroke={C.accent} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        )}

        {/* Tab Bar */}
        <div style={ds.tabBar}>
          {[
            { key: "properties", label: "Properties" },
            ...(page?._source === "d1" && !page?._parentRowId ? [{ key: "subitems", label: "Sub-Items" }] : []),
            ...(page?._source === "d1" ? [{ key: "dependencies", label: "Dependencies" }] : []),
            { key: "comments", label: "Comments" },
            { key: "files", label: "Files" },
          ].map((t) => (
            <button
              key={t.key}
              style={ds.tab(activeTab === t.key)}
              onClick={() => setActiveTab(t.key)}
              onMouseEnter={(e) => { if (activeTab !== t.key) e.currentTarget.style.background = C.darkBorder; }}
              onMouseLeave={(e) => { if (activeTab !== t.key) e.currentTarget.style.background = C.darkSurf2; }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Properties Tab */}
        {activeTab === "properties" && (
          <>
            <div style={ds.body}>
              {/* ── Owner Field (top of properties) ── */}
              {teamUsers.length > 0 && (
                <div
                  className="prop-row-hover"
                  style={{ ...ds.propRow, cursor: "pointer", position: "relative" }}
                  onClick={() => setOwnerPickerOpen((v) => !v)}
                >
                  <div style={{ ...ds.propLabel, display: "flex", alignItems: "center", gap: 6 }}>
                    <span>Owner</span>
                    <span style={ds.propType}>People</span>
                  </div>
                  <div style={{ ...ds.propValue, position: "relative" }}>
                    {ownerIds.length === 0 ? (
                      <span style={{ color: C.darkMuted, opacity: 0.6, fontSize: 13 }}>Unassigned</span>
                    ) : (
                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
                        {ownerIds.map((uid) => {
                          const u = teamUsers.find((t) => t.id === uid);
                          const name = u?.display_name || uid.slice(0, 8);
                          return (
                            <span key={uid} style={{
                              display: "inline-flex", alignItems: "center", gap: 4,
                              background: C.accent + "18", border: `1px solid ${C.accent}33`,
                              borderRadius: 12, padding: "1px 8px 1px 3px",
                              fontSize: 11, fontWeight: 500, color: C.darkText, lineHeight: "20px",
                            }}>
                              <span style={{
                                width: 16, height: 16, borderRadius: "50%",
                                background: `linear-gradient(135deg, ${C.accent}, ${C.accent}88)`,
                                display: "flex", alignItems: "center", justifyContent: "center",
                                fontSize: 9, fontWeight: 700, color: "#fff", flexShrink: 0,
                              }}>{name.charAt(0).toUpperCase()}</span>
                              {name}
                            </span>
                          );
                        })}
                      </div>
                    )}
                    <IconEdit size={10} color={C.darkMuted + "66"} />
                    {ownerPickerOpen && (
                      <OwnerPickerDropdown
                        ref={ownerPickerRef}
                        ownerIds={ownerIds}
                        users={teamUsers}
                        onCommit={async (ids) => {
                          setOwnerIds(ids);
                          setOwnerPickerOpen(false);
                          if (pageConfigId) {
                            try {
                              await updateRowOwner(pageConfigId, page.id, ids);
                              if (onRefresh) setTimeout(onRefresh, 300);
                            } catch (err) { console.error("Owner update failed:", err); }
                          }
                        }}
                        onClose={() => setOwnerPickerOpen(false)}
                      />
                    )}
                  </div>
                </div>
              )}

              {/* Parent Record Link */}
              {page?._parentRowId && (
                <div className="prop-row-hover" style={ds.propRow}>
                  <div style={{ ...ds.propLabel, display: "flex", alignItems: "center", gap: 6 }}>
                    <span>Parent</span>
                    <span style={ds.propType}>Relation</span>
                  </div>
                  <div style={{ ...ds.propValue, color: C.accent, fontSize: 13 }}>
                    {parentTitle || page._parentRowId.slice(0, 8) + "..."}
                    <span style={{ marginLeft: 4, fontSize: 10, opacity: 0.7 }}>&#x2197;</span>
                  </div>
                </div>
              )}

              {properties.map(([fieldName, prop]) => {
                const isEditing = editingField === fieldName;
                const isEditable = EDITABLE_TYPES.has(prop.type);
                const hasPending = !!pendingChanges[fieldName];
                const cellKey = `${page.id}:${fieldName}`;
                const linkData = resolvedLinks?.get(cellKey);
                const isLinked = !!linkData;
                const hasConflict = collab?.pendingConflicts?.some((c) => c.field === fieldName && c.recordId === page.id);

                return (
                  <div
                    key={fieldName}
                    className="prop-row-hover"
                    style={{
                      ...ds.propRow,
                      background: hasConflict ? "#c9822a08" : hasPending ? `${C.accent}08` : "transparent",
                      borderLeft: hasConflict ? "3px solid #c9822a" : isLinked ? `3px solid ${linkData.stale ? C.warning : C.accent}` : "3px solid transparent",
                      cursor: isEditable ? "pointer" : "default",
                      position: "relative",
                    }}
                    onClick={() => !isEditing && isEditable && !isLinked && startEdit(fieldName, prop)}
                  >
                    {/* Label */}
                    <div style={{ ...ds.propLabel, display: "flex", alignItems: "center", gap: 6 }}>
                      <span>{fieldName}</span>
                      <span style={ds.propType}>{TYPE_LABELS[prop.type] || prop.type}</span>
                      {/* Link icon — visible on hover for editable unlinked fields */}
                      {isEditable && !isLinked && !isEditing && onLinkField && (
                        <button
                          className="link-btn-hover"
                          onClick={(e) => { e.stopPropagation(); onLinkField(fieldName, prop.type); }}
                          title="Link to another field"
                          style={{
                            background: "none", border: "none", cursor: "pointer",
                            padding: 2, borderRadius: 3, display: "flex", alignItems: "center",
                            opacity: 0, transition: "opacity 0.15s",
                          }}
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={C.darkMuted} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                          </svg>
                        </button>
                      )}
                    </div>

                    {/* Value */}
                    <div style={ds.propValue}>
                      {isEditing ? (
                        <EditField
                          fieldName={fieldName}
                          type={prop.type}
                          value={editValue}
                          schemaField={getSchemaField(fieldName, prop.type)}
                          onCommit={(val) => commitEdit(fieldName, prop.type, val)}
                          onCancel={() => { setEditingField(null); setEditValue(null); }}
                          onCreateOption={onCreateOption}
                        />
                      ) : (
                        <DisplayValue
                          prop={prop}
                          fieldName={fieldName}
                          schema={schema}
                          pendingValue={pendingChanges[fieldName]?.value}
                          linkedValue={linkData?.value}
                        />
                      )}
                      {/* Linked indicator — small tag icon */}
                      {isLinked && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (window.confirm(`Remove link from "${linkData.link?.name || fieldName}"?`)) {
                              onUnlinkField?.(linkData.link.id);
                            }
                          }}
                          title={`Linked from: ${linkData.link?.name || "unknown source"}${linkData.stale ? " (stale)" : ""}`}
                          style={{
                            background: "none", border: "none", cursor: "pointer",
                            padding: 2, borderRadius: 3, display: "flex", alignItems: "center",
                            flexShrink: 0,
                          }}
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={linkData.stale ? C.warning : C.accent} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                          </svg>
                        </button>
                      )}
                      {isEditable && !isEditing && !isLinked && (
                        <IconEdit size={10} color={C.darkMuted + "66"} />
                      )}
                    </div>
                    {/* Per-field typing indicator */}
                    {(() => {
                      const others = collab?.getUsersOnRecord?.(page.id) || [];
                      const typingHere = others.filter((u) => u.isTyping && u.typingField === fieldName);
                      if (typingHere.length === 0) return null;
                      return (
                        <div style={{
                          fontSize: 10, color: typingHere[0].color, padding: "1px 0 0 0",
                          display: "flex", alignItems: "center", gap: 4, gridColumn: "1 / -1",
                        }}>
                          <span style={{
                            width: 6, height: 6, borderRadius: "50%", background: typingHere[0].color,
                            animation: "presence-pulse 1.5s ease-in-out infinite",
                          }} />
                          {typingHere.map((u) => u.userName || "User").join(", ")} typing...
                        </div>
                      );
                    })()}
                  </div>
                );
              })}
            </div>

            {/* Footer — only on Properties tab */}
            <div style={ds.footer}>
              {onDelete && (
                <button
                  style={{
                    ...ds.btn(false),
                    color: confirmDelete ? "#fff" : C.warning,
                    borderColor: C.warning,
                    background: confirmDelete ? C.warning : "transparent",
                    marginRight: "auto",
                    fontSize: 11,
                  }}
                  onClick={async () => {
                    if (confirmDelete) {
                      await onDelete([page.id]);
                      onClose();
                    } else {
                      setConfirmDelete(true);
                    }
                  }}
                  onMouseLeave={() => setConfirmDelete(false)}
                >
                  {confirmDelete ? "Confirm Delete" : "Delete"}
                </button>
              )}
              <button
                style={ds.btn(false)}
                onClick={onClose}
              >
                Cancel
              </button>
              <button
                style={{
                  ...ds.btn(true),
                  opacity: saving ? 0.6 : 1,
                }}
                onClick={handleSave}
                disabled={saving}
              >
                {saving ? "Saving..." : Object.keys(pendingChanges).length > 0 ? "Save Changes" : "Done"}
              </button>
            </div>
          </>
        )}

        {/* Sub-Items Tab */}
        {activeTab === "subitems" && (
          <RecordSubItems
            parentPage={page}
            parentId={page.id}
            tableId={page._tableId || pageConfigId}
            schema={schema}
            onRefresh={onRefresh}
            onUpdate={onUpdate}
            onDelete={onDelete}
            pageConfigId={pageConfigId}
          />
        )}

        {/* Comments Tab */}
        {/* Dependencies Tab */}
        {activeTab === "dependencies" && (
          <RecordDependencies
            recordId={page.id}
            tableId={page._tableId || pageConfigId}
            pageConfigId={pageConfigId}
            schema={schema}
            onUpdate={onUpdate}
            onDelete={onDelete}
            onRefresh={onRefresh}
          />
        )}

        {activeTab === "comments" && (
          <>
            <FigmaCommentsFromRecord recordId={page.id} />
            <RecordComments recordId={page.id} pageConfigId={pageConfigId} userId={identity?.id} userName={identity?.display_name} userRole={identity?.role} />
          </>
        )}

        {/* Files Tab */}
        {activeTab === "files" && <RecordFiles recordId={page.id} pageConfigId={pageConfigId} />}
      </div>
    </div>
  ), document.body);
}

// ── Sub-Items Tab Component ──
function RecordSubItems({ parentPage, parentId, tableId, schema, onRefresh, onUpdate, onDelete, pageConfigId }) {
  const [children, setChildren] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openChild, setOpenChild] = useState(null); // page object for nested RecordDetail
  const [newTitle, setNewTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const newInputRef = useRef(null);

  const subCols = useMemo(() => schema?._subColumns || [], [schema]);
  const subSchema = useMemo(() => schema?._subSchema || null, [schema]);

  // Resolve key sub-column IDs
  const titleColId = useMemo(() => {
    if (subCols.length === 0) return null;
    return (subCols.find((c) => c.type === "title") || subCols[0])?.id;
  }, [subCols]);

  const statusCol = useMemo(() => subCols.find((c) => c.type === "status"), [subCols]);
  const dateCol = useMemo(() => subCols.find((c) => c.type === "date"), [subCols]);

  useEffect(() => {
    if (!tableId || !parentId) return;
    setLoading(true);
    listChildRows(tableId, parentId, { limit: 200 })
      .then((res) => {
        const kids = (res?.rows || [])
          .filter((r) => !r.archived)
          .map((r) => {
            const cells = typeof r.cells === "string" ? JSON.parse(r.cells) : (r.cells || {});
            const title = titleColId ? (cells[titleColId] ? String(cells[titleColId]) : r.id.slice(0, 8)) : r.id.slice(0, 8);
            const statusVal = statusCol ? cells[statusCol.id] || null : null;
            const dateVal = dateCol ? cells[dateCol.id] || null : null;

            // Resolve status category
            let statusCategory = null;
            if (statusVal && statusCol?.options) {
              const opt = statusCol.options.find((o) => o.name === statusVal);
              statusCategory = opt?.category || "not_started";
            }

            // Build a lightweight page object so RecordDetail can open it
            const page = { id: r.id, _parentRowId: parentId, _tableId: tableId, _source: "d1", properties: {} };
            for (const col of subCols) {
              const val = cells[col.id];
              if (val === undefined || val === null) continue;
              // Wrap in Notion-compatible format
              if (col.type === "title") {
                page.properties[col.name] = { type: "title", title: [{ plain_text: String(val) }] };
              } else if (col.type === "status") {
                page.properties[col.name] = { type: "status", status: { name: String(val) } };
              } else if (col.type === "select") {
                page.properties[col.name] = { type: "select", select: { name: String(val) } };
              } else if (col.type === "date") {
                const dateObj = typeof val === "object" ? val : { start: String(val) };
                page.properties[col.name] = { type: "date", date: dateObj };
              } else if (col.type === "number") {
                page.properties[col.name] = { type: "number", number: Number(val) };
              } else if (col.type === "checkbox") {
                page.properties[col.name] = { type: "checkbox", checkbox: !!val };
              } else {
                page.properties[col.name] = { type: "rich_text", rich_text: [{ plain_text: String(val) }] };
              }
            }

            return { id: r.id, title, statusVal, statusCategory, dateVal, page };
          });
        setChildren(kids);
      })
      .catch((err) => console.warn("[RecordSubItems] fetch:", err.message || err))
      .finally(() => setLoading(false));
  }, [parentId, tableId, schema, subCols, titleColId, statusCol, dateCol]);

  const rollup = parentPage?._rollup;

  // Inline creation
  const handleCreate = useCallback(async () => {
    const trimmed = newTitle.trim();
    if (!trimmed || !tableId || creating) return;
    setCreating(true);
    try {
      const cells = {};
      if (titleColId) cells[titleColId] = trimmed;
      await createRows(tableId, [{ cells, parent_row_id: parentId }]);
      setNewTitle("");
      onRefresh?.();
      // Re-fetch children
      const res = await listChildRows(tableId, parentId, { limit: 200 });
      const kids = (res?.rows || []).filter((r) => !r.archived).map((r) => {
        const c = typeof r.cells === "string" ? JSON.parse(r.cells) : (r.cells || {});
        return { id: r.id, title: titleColId ? (c[titleColId] ? String(c[titleColId]) : r.id.slice(0, 8)) : r.id.slice(0, 8), statusVal: null, statusCategory: null, dateVal: null, page: { id: r.id, _parentRowId: parentId, _tableId: tableId, _source: "d1", properties: {} } };
      });
      setChildren(kids);
    } catch (err) {
      console.error("[RecordSubItems] create:", err);
    } finally {
      setCreating(false);
      requestAnimationFrame(() => newInputRef.current?.focus());
    }
  }, [newTitle, tableId, parentId, titleColId, creating, onRefresh]);

  // Format date for display
  const fmtDate = (val) => {
    if (!val) return null;
    const s = typeof val === "object" ? val.start : String(val);
    if (!s) return null;
    try {
      const d = new Date(s);
      return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    } catch { return null; }
  };

  // Status category icon
  const categoryIcon = (cat) => {
    switch (cat) {
      case "complete": return { icon: "✓", color: "#22c55e" };
      case "in_progress": return { icon: "◐", color: "#3b82f6" };
      case "on_hold": return { icon: "❚❚", color: "#eab308" };
      case "cancelled": return { icon: "✕", color: "#ef4444" };
      default: return { icon: "○", color: C.darkMuted };
    }
  };

  if (loading) {
    return (
      <div style={{ padding: "24px 16px", color: C.darkMuted, fontSize: 13, fontFamily: FONT }}>
        Loading sub-items...
      </div>
    );
  }

  return (
    <div style={{ padding: "12px 16px" }}>
      {/* Roll-up Summary */}
      {rollup && children.length > 0 && (
        <RollupSummary rollup={rollup} />
      )}

      {children.length === 0 ? (
        <div style={{ color: C.darkMuted, fontSize: 13, fontFamily: FONT, padding: "12px 0" }}>
          No sub-items yet. Add one below.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {children.map((child) => {
            const cat = categoryIcon(child.statusCategory);
            const dateStr = fmtDate(child.dateVal);
            return (
              <div
                key={child.id}
                style={{
                  display: "flex", alignItems: "center", gap: 8,
                  padding: "8px 12px", borderRadius: RADIUS.sm,
                  background: C.darkSurf2, cursor: "pointer",
                  fontSize: 13, fontFamily: FONT, color: C.darkText,
                  transition: "background 0.1s",
                }}
                onClick={() => setOpenChild(child.page)}
                onMouseEnter={(e) => { e.currentTarget.style.background = C.darkBorder; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = C.darkSurf2; }}
              >
                {/* Status category indicator */}
                {statusCol && (
                  <span style={{ fontSize: 11, color: cat.color, flexShrink: 0, width: 14, textAlign: "center" }}>
                    {cat.icon}
                  </span>
                )}

                {/* Title */}
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {child.title}
                </span>

                {/* Status pill */}
                {child.statusVal && (
                  <span style={{
                    fontSize: 10, fontWeight: 600,
                    color: cat.color, background: cat.color + "18",
                    borderRadius: RADIUS.pill, padding: "1px 6px",
                    whiteSpace: "nowrap", flexShrink: 0,
                  }}>
                    {child.statusVal}
                  </span>
                )}

                {/* Date */}
                {dateStr && (
                  <span style={{ fontSize: 10, color: C.darkMuted, flexShrink: 0 }}>
                    {dateStr}
                  </span>
                )}

                {/* Open indicator */}
                <span style={{ fontSize: 10, color: C.darkMuted, opacity: 0.5, flexShrink: 0 }}>&#x2197;</span>
              </div>
            );
          })}
        </div>
      )}

      {/* Inline creation */}
      <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
        <input
          ref={newInputRef}
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); }}
          placeholder="+ Add sub-item..."
          style={{
            flex: 1, padding: "6px 10px", fontSize: 12,
            background: C.darkSurf2, border: `1px solid ${C.darkBorder}`,
            borderRadius: RADIUS.sm, color: C.darkText, outline: "none",
            fontFamily: FONT, boxSizing: "border-box",
          }}
        />
        {newTitle.trim() && (
          <button
            onClick={handleCreate}
            disabled={creating}
            style={{
              background: C.accent, border: "none", borderRadius: RADIUS.sm,
              padding: "6px 12px", fontSize: 11, fontFamily: FONT,
              color: "#fff", cursor: creating ? "default" : "pointer",
              fontWeight: 600, opacity: creating ? 0.5 : 1, flexShrink: 0,
            }}
          >
            {creating ? "..." : "Add"}
          </button>
        )}
      </div>

      <div style={{ marginTop: 6, fontSize: 11, color: C.darkMuted, fontFamily: FONT }}>
        {children.length} sub-item{children.length !== 1 ? "s" : ""}
      </div>

      {/* Nested RecordDetail for clicked sub-item */}
      {openChild && subSchema && (
        <RecordDetail
          page={openChild}
          schema={subSchema}
          onClose={() => setOpenChild(null)}
          onUpdate={onUpdate}
          onDelete={onDelete}
          pageConfigId={pageConfigId}
          onRefresh={() => { onRefresh?.(); }}
          parentTitle={parentPage?._rollup ? undefined : undefined}
        />
      )}
    </div>
  );
}

// ── Dependencies Tab Component ──
// Renders depends_on edges in two sections: "Depends On" (upstream — this
// record is the source) and "Blocks" (downstream — this record is the target).
// Both sections write the same edge type ('depends_on'); the picker just
// flips source/target so the resulting view is symmetric.
function RecordDependencies({ recordId, tableId, pageConfigId, schema, onUpdate, onDelete, onRefresh }) {
  const { loadForEntity, createEdge, deleteEdge } = useRelationships();
  const [edges, setEdges] = useState([]);
  const [loading, setLoading] = useState(true);
  const [recordsById, setRecordsById] = useState({});
  const [pickerMode, setPickerMode] = useState(null); // null | 'depends_on' | 'blocks'
  const [pickerQuery, setPickerQuery] = useState("");
  const [openChild, setOpenChild] = useState(null);
  const [busyEdgeId, setBusyEdgeId] = useState(null);

  const titleColId = schema?.title?.id || null;
  const statusCol = useMemo(
    () => (schema?._columns || []).find((c) => c.type === "status"),
    [schema]
  );
  // Sub-item schema lookups — sub-items store titles + status in sub_columns,
  // so we resolve them with a separate column ID to keep titles human-readable
  // in the picker / linked list.
  const subTitleColId = useMemo(() => {
    const subCols = schema?._subColumns || [];
    return (subCols.find((c) => c.type === "title") || subCols[0])?.id || null;
  }, [schema]);
  const subStatusCol = useMemo(
    () => (schema?._subColumns || []).find((c) => c.type === "status"),
    [schema]
  );

  const refreshEdges = useCallback(async () => {
    if (!recordId) return;
    setLoading(true);
    try {
      const items = await loadForEntity("record", recordId, { types: ["depends_on"] });
      setEdges(items);
    } catch (err) {
      console.warn("[RecordDependencies] load:", err.message || err);
    } finally {
      setLoading(false);
    }
  }, [recordId, loadForEntity]);

  useEffect(() => { refreshEdges(); }, [refreshEdges]);

  // Pull all rows in this table for picker results + title display.
  // Two-pass build so sub-items can prefix their parent's title in the
  // displayed label ("Parent › Sub Title").
  useEffect(() => {
    if (!tableId) return;
    listRows(tableId, { limit: 1000 })
      .then((res) => {
        const rows = (res?.rows || []).filter((r) => !r.archived);
        const parentTitleById = {};
        const map = {};

        // Pass 1: parents
        for (const r of rows) {
          if (r.parent_row_id) continue;
          const cells = typeof r.cells === "string" ? JSON.parse(r.cells || "{}") : (r.cells || {});
          const title = titleColId && cells[titleColId]
            ? String(cells[titleColId])
            : r.id.slice(0, 8);
          const statusVal = statusCol ? cells[statusCol.id] || null : null;
          let statusCategory = null;
          if (statusVal && statusCol?.options) {
            const opt = statusCol.options.find((o) => o.name === statusVal);
            statusCategory = opt?.category || "not_started";
          }
          parentTitleById[r.id] = title;
          map[r.id] = { id: r.id, title, statusVal, statusCategory, isSubItem: false, parentTitle: null };
        }

        // Pass 2: sub-items (titles live in sub_columns, status uses subStatusCol)
        for (const r of rows) {
          if (!r.parent_row_id) continue;
          const cells = typeof r.cells === "string" ? JSON.parse(r.cells || "{}") : (r.cells || {});
          const ownTitle = subTitleColId && cells[subTitleColId]
            ? String(cells[subTitleColId])
            : r.id.slice(0, 8);
          const parentTitle = parentTitleById[r.parent_row_id] || null;
          const title = parentTitle ? `${parentTitle} › ${ownTitle}` : ownTitle;
          const statusVal = subStatusCol ? cells[subStatusCol.id] || null : null;
          let statusCategory = null;
          if (statusVal && subStatusCol?.options) {
            const opt = subStatusCol.options.find((o) => o.name === statusVal);
            statusCategory = opt?.category || "not_started";
          }
          map[r.id] = { id: r.id, title, statusVal, statusCategory, isSubItem: true, parentTitle };
        }

        setRecordsById(map);
      })
      .catch((err) => console.warn("[RecordDependencies] listRows:", err.message || err));
  }, [tableId, titleColId, statusCol, subTitleColId, subStatusCol]);

  const upstream = useMemo(() => edges.filter((e) => e.source_id === recordId), [edges, recordId]);
  const downstream = useMemo(() => edges.filter((e) => e.target_id === recordId), [edges, recordId]);

  const linkedIds = useMemo(() => {
    const set = new Set();
    for (const e of edges) {
      if (e.source_id === recordId) set.add(e.target_id);
      if (e.target_id === recordId) set.add(e.source_id);
    }
    return set;
  }, [edges, recordId]);

  const pickerResults = useMemo(() => {
    if (!pickerMode) return [];
    const q = pickerQuery.trim().toLowerCase();
    return Object.values(recordsById)
      .filter((r) => r.id !== recordId && !linkedIds.has(r.id))
      .filter((r) => !q || r.title.toLowerCase().includes(q))
      .slice(0, 10);
  }, [pickerMode, pickerQuery, recordsById, recordId, linkedIds]);

  const categoryIcon = (cat) => {
    switch (cat) {
      case "complete": return { icon: "\u2713", color: "#22c55e" };
      case "in_progress": return { icon: "\u25D0", color: "#3b82f6" };
      case "on_hold": return { icon: "\u275A\u275A", color: "#eab308" };
      case "cancelled": return { icon: "\u2715", color: "#ef4444" };
      default: return { icon: "\u25CB", color: C.darkMuted };
    }
  };

  const handleAdd = async (otherId) => {
    if (!otherId) return;
    try {
      // For both modes the underlying type is 'depends_on'. The picker simply
      // flips which entity is source vs target so "Blocks" reads as the
      // inverse of "Depends On".
      const body = pickerMode === "depends_on"
        ? {
            type: "depends_on", origin: "user_declared",
            source_type: "record", source_id: recordId, source_page_id: tableId,
            target_type: "record", target_id: otherId, target_page_id: tableId,
          }
        : {
            type: "depends_on", origin: "user_declared",
            source_type: "record", source_id: otherId, source_page_id: tableId,
            target_type: "record", target_id: recordId, target_page_id: tableId,
          };
      await createEdge(body);
      setPickerMode(null);
      setPickerQuery("");
      await refreshEdges();
    } catch (err) {
      console.error("[RecordDependencies] add:", err);
    }
  };

  const handleRemove = async (edge) => {
    if (!edge?.id) return;
    setBusyEdgeId(edge.id);
    try {
      await deleteEdge(edge.id);
      await refreshEdges();
    } catch (err) {
      console.error("[RecordDependencies] remove:", err);
    } finally {
      setBusyEdgeId(null);
    }
  };

  const buildOpenPage = (rid) => {
    if (!rid) return null;
    return { id: rid, _tableId: tableId, _source: "d1", properties: {} };
  };

  if (loading) {
    return (
      <div style={{ padding: "24px 16px", color: C.darkMuted, fontSize: 13, fontFamily: FONT }}>
        Loading dependencies...
      </div>
    );
  }

  const renderSection = (titleText, subtitle, items, mode) => (
    <div style={{ marginBottom: 18 }}>
      <div style={{
        fontSize: 11, fontWeight: 700, letterSpacing: 0.5,
        color: C.darkMuted, marginBottom: 2, textTransform: "uppercase",
        fontFamily: FONT,
      }}>{titleText}</div>
      <div style={{ fontSize: 11, color: C.darkMuted, marginBottom: 8, opacity: 0.7, fontFamily: FONT }}>
        {subtitle}
      </div>

      {items.length === 0 ? (
        <div style={{ color: C.darkMuted, fontSize: 12, fontStyle: "italic", padding: "4px 0 8px", fontFamily: FONT }}>
          None yet. {pickerMode === mode ? "Pick one below." : "Add the first one below."}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 2, marginBottom: 8 }}>
          {items.map((edge) => {
            const otherId = mode === "depends_on" ? edge.target_id : edge.source_id;
            const r = recordsById[otherId] || { id: otherId, title: otherId.slice(0, 8), statusVal: null, statusCategory: null };
            const cat = categoryIcon(r.statusCategory);
            return (
              <div
                key={edge.id}
                style={{
                  display: "flex", alignItems: "center", gap: 8,
                  padding: "8px 12px", borderRadius: RADIUS.sm,
                  background: C.darkSurf2, cursor: "pointer",
                  fontSize: 13, fontFamily: FONT, color: C.darkText,
                  transition: "background 0.1s",
                  opacity: busyEdgeId === edge.id ? 0.5 : 1,
                }}
                onClick={() => setOpenChild(buildOpenPage(otherId))}
                onMouseEnter={(e) => { e.currentTarget.style.background = C.darkBorder; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = C.darkSurf2; }}
              >
                <span style={{ fontSize: 11, color: cat.color, flexShrink: 0, width: 14, textAlign: "center" }}>
                  {cat.icon}
                </span>
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {r.title}
                </span>
                {r.statusVal && (
                  <span style={{
                    fontSize: 10, fontWeight: 600, color: cat.color,
                    background: cat.color + "18", borderRadius: RADIUS.pill,
                    padding: "1px 6px", whiteSpace: "nowrap", flexShrink: 0,
                  }}>{r.statusVal}</span>
                )}
                <button
                  onClick={(e) => { e.stopPropagation(); handleRemove(edge); }}
                  title="Remove dependency"
                  style={{
                    background: "transparent", border: "none",
                    color: C.darkMuted, cursor: "pointer", fontSize: 16,
                    padding: "0 4px", flexShrink: 0, lineHeight: 1,
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = "#ef4444"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = C.darkMuted; }}
                >&times;</button>
              </div>
            );
          })}
        </div>
      )}

      {pickerMode === mode ? (
        <div style={{
          background: C.darkSurf2, borderRadius: RADIUS.sm,
          border: `1px solid ${C.darkBorder}`, padding: 8,
        }}>
          <input
            autoFocus
            placeholder="Search for a task..."
            value={pickerQuery}
            onChange={(e) => setPickerQuery(e.target.value)}
            style={{
              width: "100%", padding: "6px 10px", fontSize: 12,
              background: C.darkSurf, border: `1px solid ${C.darkBorder}`,
              borderRadius: RADIUS.sm, color: C.darkText, outline: "none",
              fontFamily: FONT, boxSizing: "border-box", marginBottom: 6,
            }}
            onKeyDown={(e) => { if (e.key === "Escape") { setPickerMode(null); setPickerQuery(""); } }}
          />
          {pickerResults.length === 0 ? (
            <div style={{ color: C.darkMuted, fontSize: 11, padding: "6px 0", fontStyle: "italic", fontFamily: FONT }}>
              {pickerQuery ? "No matches in this database." : "Start typing to search\u2026"}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 1, maxHeight: 200, overflowY: "auto" }}>
              {pickerResults.map((r) => (
                <div
                  key={r.id}
                  onClick={() => handleAdd(r.id)}
                  style={{
                    padding: "6px 8px", borderRadius: RADIUS.sm,
                    cursor: "pointer", fontSize: 12, fontFamily: FONT,
                    color: C.darkText,
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = C.darkBorder; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                >
                  {r.title}
                </div>
              ))}
            </div>
          )}
          <button
            onClick={() => { setPickerMode(null); setPickerQuery(""); }}
            style={{
              background: "transparent", border: "none",
              color: C.darkMuted, cursor: "pointer", fontSize: 11,
              padding: "4px 0 0", fontFamily: FONT,
            }}
          >Cancel</button>
        </div>
      ) : (
        <button
          onClick={() => setPickerMode(mode)}
          style={{
            background: "transparent", border: `1px dashed ${C.darkBorder}`,
            color: C.darkMuted, cursor: "pointer", fontSize: 12,
            padding: "6px 10px", borderRadius: RADIUS.sm, fontFamily: FONT,
            width: "100%", textAlign: "left", boxSizing: "border-box",
            transition: "color 0.1s",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = C.darkText; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = C.darkMuted; }}
        >
          + {mode === "depends_on" ? "Add upstream task" : "Add downstream task"}
        </button>
      )}
    </div>
  );

  return (
    <div style={{ padding: "12px 16px" }}>
      {renderSection(
        "Depends On",
        "Things that must happen before this task",
        upstream,
        "depends_on"
      )}
      {renderSection(
        "Blocks",
        "Things that are waiting on this task",
        downstream,
        "blocks"
      )}

      {openChild && (
        <RecordDetail
          page={openChild}
          schema={schema}
          onClose={() => setOpenChild(null)}
          onUpdate={onUpdate}
          onDelete={onDelete}
          pageConfigId={pageConfigId}
          onRefresh={() => { onRefresh?.(); refreshEdges(); }}
        />
      )}
    </div>
  );
}

// ── Roll-Up Summary Bar ──
function RollupSummary({ rollup }) {
  const { progress, computedStart, computedEnd, hasConflict, conflictDetails } = rollup;
  const pct = progress.percent;

  const fmtDate = (d) => {
    if (!d) return "—";
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  };

  return (
    <div style={{ marginBottom: 12, fontFamily: FONT }}>
      {/* Progress bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
        <div style={{
          flex: 1, height: 6, borderRadius: 3,
          background: C.darkSurf2, overflow: "hidden",
        }}>
          <div style={{
            width: `${pct}%`, height: "100%", borderRadius: 3,
            background: pct === 100 ? "#22c55e" : "#3b82f6",
            transition: "width 0.3s ease",
          }} />
        </div>
        <span style={{ fontSize: 11, color: C.darkMuted, flexShrink: 0, minWidth: 70, textAlign: "right" }}>
          {progress.complete} of {progress.total} done
        </span>
      </div>

      {/* Date range */}
      {(computedStart || computedEnd) && (
        <div style={{ fontSize: 11, color: C.darkMuted, marginBottom: hasConflict ? 6 : 0 }}>
          Sub-item range: {fmtDate(computedStart)} — {fmtDate(computedEnd)}
        </div>
      )}

      {/* Conflict warning */}
      {hasConflict && conflictDetails && (
        <div style={{
          display: "flex", alignItems: "flex-start", gap: 6,
          padding: "6px 10px", borderRadius: RADIUS.sm,
          background: "#eab30815", border: "1px solid #eab30833",
          fontSize: 11, color: "#eab308", lineHeight: 1.4,
        }}>
          <span style={{ flexShrink: 0, fontSize: 13, lineHeight: 1 }}>&#9888;</span>
          <span>
            Sub-item dates exceed parent timeline
            {conflictDetails.parentEnd && (
              <> (parent ends {fmtDate(conflictDetails.parentEnd)}, sub-items end {fmtDate(conflictDetails.childrenEnd)})</>
            )}
          </span>
        </div>
      )}
    </div>
  );
}

// ── Display a property value (read mode) ──
function DisplayValue({ prop, fieldName, schema, pendingValue, linkedValue }) {
  const ds = getDs();
  const value = linkedValue !== undefined ? linkedValue : (pendingValue !== undefined ? pendingValue : readProp(prop));

  if (value === null || value === undefined || value === "") {
    return <span style={{ color: C.darkMuted + "66", fontStyle: "italic", fontSize: 12 }}>Empty</span>;
  }

  switch (prop.type) {
    case "title":
    case "rich_text":
      return <span>{String(pendingValue ?? value)}</span>;

    case "number":
      return <span style={{ fontVariantNumeric: "tabular-nums" }}>{(pendingValue ?? value)?.toLocaleString()}</span>;

    case "select":
    case "status": {
      const val = pendingValue ?? value;
      const schemaField = findSchemaField(schema, fieldName, prop.type);
      const optNames = schemaField?.options?.map((o) => o.name) || [];
      const { fill, text } = getSolidPillColor(val, optNames, schemaField?.options || []);
      return <span style={ds.pill(fill, text)}>{val}</span>;
    }

    case "multi_select": {
      const vals = pendingValue ?? value;
      const schemaField = findSchemaField(schema, fieldName, prop.type);
      const optNames = schemaField?.options?.map((o) => o.name) || [];
      return (
        <>
          {(Array.isArray(vals) ? vals : []).map((v) => {
            const { fill, text } = getSolidPillColor(v, optNames, schemaField?.options || []);
            return <span key={v} style={ds.pill(fill, text)}>{v}</span>;
          })}
        </>
      );
    }

    case "date": {
      if (typeof value === "object") {
        const startFmt = formatDate(value.start) || "—";
        const endFmt = value.end ? formatDate(value.end) : null;
        return (
          <span>
            {startFmt}
            {endFmt && <span style={{ color: C.darkMuted }}> – {endFmt}</span>}
          </span>
        );
      }
      return <span>{formatDate(String(value)) || String(value)}</span>;
    }

    case "checkbox":
      return (
        <span style={{
          width: 18,
          height: 18,
          borderRadius: RADIUS.sm,
          border: `2px solid ${value ? C.accent : C.darkBorder}`,
          background: value ? C.accent : "transparent",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#fff",
          fontSize: 12,
          fontWeight: 700,
        }}>
          {value && "✓"}
        </span>
      );

    case "url":
      return (
        <a
          href={value}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: C.accent, textDecoration: "none", fontSize: 13, wordBreak: "break-all" }}
          onClick={(e) => e.stopPropagation()}
        >
          {value}
        </a>
      );

    case "people":
      return (
        <>
          {(Array.isArray(value) ? value : []).map((p) => (
            <span key={p.id || p.name} style={{
              ...ds.pill("#3B82F6", "#fff"),
              fontSize: 10,
            }}>
              {p.name || p.email || p.id}
            </span>
          ))}
        </>
      );

    case "relation":
      return (
        <span style={{ color: C.darkMuted, fontSize: 12 }}>
          {Array.isArray(value) ? `${value.length} linked` : "—"}
        </span>
      );

    case "formula":
    case "rollup":
      return <span style={{ color: C.darkMuted }}>{String(value)}</span>;

    case "created_time":
    case "last_edited_time":
      return <span style={{ fontSize: 12, color: C.darkMuted }}>{value ? new Date(value).toLocaleString() : "—"}</span>;

    case "files":
      return (
        <>
          {(Array.isArray(value) ? value : []).map((f) => (
            <a
              key={f.url}
              href={f.url}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: C.accent, fontSize: 12 }}
              onClick={(e) => e.stopPropagation()}
            >
              {f.name}
            </a>
          ))}
        </>
      );

    case "figma_files":
      return <FigmaFilesDisplay value={pendingValue ?? value} />;

    default:
      return <span style={{ color: C.darkMuted }}>{JSON.stringify(value)}</span>;
  }
}

// ── "From Figma" section — inbound Figma comments linked to this record ──
// Shown at the top of the Comments tab. Fetches figma_comment_links rows
// where record_id matches the open record; renders the snapshot stored on
// each link (message/author/created_at). Clicking the file name opens the
// in-app viewer via NavigationContext.
function FigmaCommentsFromRecord({ recordId }) {
  const ds = getDs();
  const nav = useNavigation();
  const [links, setLinks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!recordId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await listFigmaLinksForRecord(recordId);
      setLinks(res?.links || []);
    } catch (err) {
      setError(err?.message || "Failed to load Figma comments");
    } finally {
      setLoading(false);
    }
  }, [recordId]);

  useEffect(() => { load(); }, [load]);

  const handleUnlink = useCallback(async (linkId) => {
    try {
      await deleteFigmaCommentLink(linkId);
      setLinks((prev) => prev.filter((l) => l.id !== linkId));
    } catch (err) {
      setError(err?.message || "Failed to remove link");
    }
  }, []);

  // Strip the `[Name via Wasabi]:` prefix off snapshot messages so the body
  // reads cleanly — same treatment FigmaCommentPanel applies.
  const renderMessage = (raw) => {
    const match = /^\[(.+) via Wasabi\]:\s*([\s\S]*)$/.exec(raw || "");
    if (!match) return <span style={{ whiteSpace: "pre-wrap" }}>{raw || ""}</span>;
    return (
      <>
        <span style={{
          display: "inline-block", fontSize: 9, fontWeight: 700,
          textTransform: "uppercase", letterSpacing: "0.06em",
          padding: "1px 6px", borderRadius: RADIUS.sm,
          background: C.accent + "22", color: C.accent, marginBottom: 4,
        }}>
          {match[1]} via Wasabi
        </span>
        <div style={{ whiteSpace: "pre-wrap" }}>{match[2]}</div>
      </>
    );
  };

  if (loading) return null; // Avoid flicker — RecordComments below renders immediately
  if (error) {
    return (
      <div style={{
        margin: "0 0 12px 0", padding: "8px 10px",
        background: C.error + "12", color: C.error,
        borderRadius: RADIUS.md, fontSize: 11,
      }}>
        {error}
      </div>
    );
  }
  if (links.length === 0) return null;

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{
        fontSize: 10, fontWeight: 700, textTransform: "uppercase",
        letterSpacing: "0.06em", color: C.darkMuted,
        marginBottom: 8, display: "flex", alignItems: "center", gap: 6,
      }}>
        <IconFigma size={11} />
        From Figma ({links.length})
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {links.map((l) => (
          <div
            key={l.id}
            style={{
              padding: "10px 12px", background: C.darkSurf2,
              border: `1px solid ${C.darkBorder}`, borderRadius: RADIUS.md,
              fontSize: 12, lineHeight: 1.45,
            }}
          >
            <div style={{
              display: "flex", alignItems: "center", gap: 8,
              marginBottom: 6, fontSize: 11, color: C.darkMuted,
            }}>
              <button
                onClick={() => nav?.navigateToFigmaFile?.(l.figma_file_key, l.figma_file_name)}
                title="Open file in app"
                style={{
                  display: "inline-flex", alignItems: "center", gap: 4,
                  padding: 0, background: "transparent", border: "none",
                  color: C.accent, font: "inherit", cursor: "pointer",
                  outline: "none", fontWeight: 600,
                }}
              >
                <IconFigma size={11} />
                {l.figma_file_name || "Figma file"}
              </button>
              {l.comment_author && (
                <>
                  <span>·</span>
                  <span>{l.comment_author}</span>
                </>
              )}
              {l.comment_created_at && (
                <>
                  <span>·</span>
                  <span>{new Date(l.comment_created_at).toLocaleDateString()}</span>
                </>
              )}
              <span style={{ flex: 1 }} />
              <button
                onClick={() => handleUnlink(l.id)}
                title="Remove this link"
                aria-label="Remove link"
                style={{
                  background: "transparent", border: "none", padding: "0 2px",
                  color: C.darkMuted, fontSize: 13, lineHeight: 1, cursor: "pointer",
                  outline: "none",
                }}
              >
                &times;
              </button>
            </div>
            <div style={{ color: C.darkText }}>
              {renderMessage(l.comment_message)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Figma files display (used inside renderField/DisplayValue) ──
function FigmaFilesDisplay({ value }) {
  const [previewFile, setPreviewFile] = useState(null);
  const files = Array.isArray(value) ? value : [];
  if (files.length === 0) {
    return <span style={{ color: C.darkMuted, fontStyle: "italic", fontSize: 13 }}>No files</span>;
  }
  return (
    <span style={{ display: "inline-flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
      {files.map((f) => (
        <button
          key={f.file_key}
          onClick={(e) => { e.stopPropagation(); setPreviewFile(f); }}
          title={f.file_name || "Figma file"}
          style={{
            display: "inline-flex", alignItems: "center", gap: 5,
            padding: "2px 8px 2px 6px", height: 22, lineHeight: 1,
            background: C.darkSurf2, border: `1px solid ${C.darkBorder}`,
            borderRadius: RADIUS.pill, color: C.darkText,
            fontSize: 11, fontFamily: FONT, fontWeight: 500,
            cursor: "pointer", outline: "none",
            maxWidth: 200, overflow: "hidden",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = C.darkBorder; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = C.darkSurf2; }}
        >
          <IconFigma size={11} />
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {f.file_name || "Untitled"}
          </span>
        </button>
      ))}
      {previewFile && (
        <FigmaCellPreview file={previewFile} onClose={() => setPreviewFile(null)} />
      )}
    </span>
  );
}

// ── Figma files editor (mounts the picker modal) ──
// Used as the inline editor for figma_files in EditField. Auto-opens the
// picker on mount and commits the chosen array back through onCommit.
function FigmaFilesEditor({ value, onCommit, onCancel }) {
  return (
    <FigmaFilePicker
      open
      existing={Array.isArray(value) ? value : []}
      onConfirm={(arr) => onCommit(arr)}
      onCancel={onCancel}
      title="Pick Figma files for this field"
    />
  );
}

// ── Auto-resizing Textarea ──
function AutoResizeTextarea({ inputRef, defaultValue, style, onKeyDown, onBlur, onClick }) {
  const resize = useCallback((el) => {
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  }, []);

  useEffect(() => {
    if (inputRef.current) resize(inputRef.current);
  }, []);

  return (
    <textarea
      ref={inputRef}
      defaultValue={defaultValue}
      rows={1}
      style={{
        ...style,
        resize: "none",
        minHeight: 32,
        maxHeight: 200,
        overflowY: "auto",
        lineHeight: 1.55,
        display: "block",
      }}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
      onClick={onClick}
      onInput={(e) => resize(e.target)}
    />
  );
}

// ── Edit Field (inline editor) ──
function EditField({ fieldName, type, value, schemaField, onCommit, onCancel, onCreateOption }) {
  const ds = getDs();
  const inputRef = useRef(null);

  useEffect(() => {
    if (inputRef.current) inputRef.current.focus();
  }, []);

  const handleKeyDown = (e) => {
    if (e.key === "Escape") onCancel();
    if (e.key === "Enter" && !e.shiftKey && type !== "rich_text") {
      onCommit(inputRef.current?.value ?? value);
    }
  };

  switch (type) {
    case "rich_text":
      return (
        <AutoResizeTextarea
          inputRef={inputRef}
          defaultValue={value || ""}
          style={ds.input}
          onKeyDown={(e) => {
            if (e.key === "Escape") onCancel();
            // Shift+Enter for newline, plain Enter does nothing special (keeps editing)
          }}
          onBlur={(e) => onCommit(e.target.value)}
          onClick={(e) => e.stopPropagation()}
        />
      );

    case "title":
    case "url":
    case "email":
    case "phone_number":
      return (
        <input
          ref={inputRef}
          type="text"
          defaultValue={value || ""}
          style={ds.input}
          onKeyDown={handleKeyDown}
          onBlur={(e) => onCommit(e.target.value)}
          onClick={(e) => e.stopPropagation()}
        />
      );

    case "number":
      return (
        <input
          ref={inputRef}
          type="number"
          defaultValue={value ?? ""}
          style={ds.input}
          onKeyDown={handleKeyDown}
          onBlur={(e) => onCommit(parseFloat(e.target.value) || null)}
          onClick={(e) => e.stopPropagation()}
        />
      );

    case "date":
      return (
        <DateEditor
          value={value}
          onCommit={onCommit}
          onCancel={onCancel}
        />
      );

    case "checkbox":
      return (
        <CheckboxEditor
          value={value}
          onCommit={onCommit}
        />
      );

    case "select":
    case "status":
      return (
        <SelectEditor
          value={value}
          options={schemaField?.options || []}
          onCommit={onCommit}
          onCancel={onCancel}
          multi={false}
          onCreateOption={onCreateOption ? (name) => onCreateOption(fieldName, name) : null}
        />
      );

    case "figma_files":
      return (
        <FigmaFilesEditor
          value={value}
          onCommit={onCommit}
          onCancel={onCancel}
        />
      );

    case "multi_select":
      return (
        <SelectEditor
          value={value}
          options={schemaField?.options || []}
          onCommit={onCommit}
          onCancel={onCancel}
          multi={true}
          onCreateOption={onCreateOption ? (name) => onCreateOption(fieldName, name) : null}
        />
      );

    default:
      return <span style={{ color: C.darkMuted }}>Not editable</span>;
  }
}

// ── Date Editor ──
function DateEditor({ value, onCommit, onCancel }) {
  const ds = getDs();
  const startVal = typeof value === "object" ? value?.start : value || "";
  const endVal = typeof value === "object" ? value?.end : "";
  const [start, setStart] = useState(startVal?.slice(0, 10) || "");
  const [end, setEnd] = useState(endVal?.slice(0, 10) || "");
  const startRef = useRef(start);
  const endRef = useRef(end);

  const commit = () => {
    const s = startRef.current;
    const e = endRef.current;
    onCommit(e ? { start: s, end: e } : s);
  };

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flex: 1 }} onClick={(e) => e.stopPropagation()}>
      <input
        type="date"
        value={start}
        onChange={(e) => { setStart(e.target.value); startRef.current = e.target.value; }}
        style={{ ...ds.input, width: "auto", flex: 1 }}
        autoFocus
        onKeyDown={(e) => {
          if (e.key === "Escape") onCancel();
          if (e.key === "Enter") commit();
        }}
      />
      <span style={{ color: C.darkMuted, fontSize: 12 }}>to</span>
      <input
        type="date"
        value={end}
        onChange={(e) => { setEnd(e.target.value); endRef.current = e.target.value; }}
        style={{ ...ds.input, width: "auto", flex: 1 }}
        onKeyDown={(e) => {
          if (e.key === "Escape") onCancel();
          if (e.key === "Enter") commit();
        }}
      />
      <button
        style={ds.btn(true)}
        onClick={commit}
      >
        Set
      </button>
    </div>
  );
}

// ── Checkbox Editor ──
function CheckboxEditor({ value, onCommit }) {
  return (
    <button
      style={{
        width: 24,
        height: 24,
        borderRadius: RADIUS.sm,
        border: `2px solid ${!value ? C.accent : C.darkBorder}`,
        background: !value ? C.accent : "transparent",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        color: "#fff",
        fontSize: 14,
        fontWeight: 700,
      }}
      onClick={(e) => {
        e.stopPropagation();
        onCommit(!value);
      }}
    >
      {!value && "✓"}
    </button>
  );
}

// ── Select / Multi-Select Editor ──
function SelectEditor({ value, options, onCommit, onCancel, multi, onCreateOption }) {
  const ds = getDs();
  const [selected, setSelected] = useState(
    multi ? (Array.isArray(value) ? value : []) : value
  );
  const [newOptionText, setNewOptionText] = useState("");
  const [creating, setCreating] = useState(false);
  const wrapRef = useRef(null);

  // Close on outside click
  useEffect(() => {
    const handler = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        onCommit(selected);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [selected, onCommit]);

  const toggle = (optName) => {
    if (multi) {
      setSelected((prev) => {
        const arr = Array.isArray(prev) ? prev : [];
        return arr.includes(optName) ? arr.filter((v) => v !== optName) : [...arr, optName];
      });
    } else {
      onCommit(optName);
    }
  };

  const optNames = options.map((o) => o.name);

  const handleCreate = async () => {
    const name = newOptionText.trim();
    if (!name || !onCreateOption || creating) return;
    if (optNames.includes(name)) {
      // Already exists — just select it
      setNewOptionText("");
      if (multi) {
        setSelected((prev) => {
          const arr = Array.isArray(prev) ? prev : [];
          return arr.includes(name) ? arr : [...arr, name];
        });
      } else {
        onCommit(name);
      }
      return;
    }
    setCreating(true);
    try {
      await onCreateOption(name);
      setNewOptionText("");
      if (multi) {
        setSelected((prev) => {
          const arr = Array.isArray(prev) ? prev : [];
          return [...arr, name];
        });
      } else {
        onCommit(name);
      }
    } finally {
      setCreating(false);
    }
  };

  return (
    <div ref={wrapRef} style={{ position: "relative", flex: 1 }} onClick={(e) => e.stopPropagation()}>
      {/* Current selection display */}
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 4, minHeight: 24 }}>
        {multi && Array.isArray(selected) && selected.map((v) => {
          const { fill, text } = getSolidPillColor(v, optNames, options);
          return <span key={v} style={ds.pill(fill, text)}>{v}</span>;
        })}
        {!multi && selected && (() => {
          const { fill, text } = getSolidPillColor(selected, optNames, options);
          return <span style={ds.pill(fill, text)}>{selected}</span>;
        })()}
      </div>

      {/* Dropdown */}
      <div style={ds.selectDropdown}>
        {options.map((opt) => {
          const isSelected = multi
            ? (Array.isArray(selected) && selected.includes(opt.name))
            : selected === opt.name;
          const { fill, text } = getSolidPillColor(opt.name, optNames, options);

          return (
            <div
              key={opt.name}
              style={{
                ...ds.selectOption,
                background: isSelected ? `${C.accent}14` : "transparent",
              }}
              onClick={() => toggle(opt.name)}
              onMouseEnter={(e) => { e.currentTarget.style.background = C.darkSurf2; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = isSelected ? `${C.accent}14` : "transparent"; }}
            >
              {multi && (
                <span style={{
                  width: 14,
                  height: 14,
                  borderRadius: 3,
                  border: `2px solid ${isSelected ? C.accent : C.darkBorder}`,
                  background: isSelected ? C.accent : "transparent",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#fff",
                  fontSize: 9,
                  fontWeight: 700,
                  flexShrink: 0,
                }}>
                  {isSelected && "✓"}
                </span>
              )}
              <span style={{
                ...ds.pill(fill, text),
                fontSize: 11,
              }}>
                {opt.name}
              </span>
            </div>
          );
        })}
        {onCreateOption && (
          <div
            style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "6px 8px",
              borderTop: `1px solid ${C.edgeLine}`,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <input
              type="text"
              value={newOptionText}
              onChange={(e) => setNewOptionText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); handleCreate(); }
                if (e.key === "Escape") { e.preventDefault(); setNewOptionText(""); }
                e.stopPropagation();
              }}
              onMouseDown={(e) => e.stopPropagation()}
              placeholder="+ Create new option"
              disabled={creating}
              style={{
                flex: 1,
                border: `1px solid ${C.darkBorder}`,
                borderRadius: RADIUS.sm,
                background: C.darkSurf2,
                color: C.darkText,
                fontFamily: FONT,
                fontSize: 11,
                padding: "4px 8px",
                outline: "none",
              }}
            />
            {newOptionText.trim() && (
              <button
                onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); handleCreate(); }}
                disabled={creating}
                style={{
                  background: C.accent, color: "#fff", border: "none",
                  borderRadius: RADIUS.sm, padding: "4px 8px",
                  fontSize: 11, fontWeight: 600, cursor: "pointer",
                  opacity: creating ? 0.5 : 1,
                }}
              >
                {creating ? "…" : "Add"}
              </button>
            )}
          </div>
        )}
        {multi && (
          <div
            style={{ ...ds.selectOption, justifyContent: "center", borderTop: `1px solid ${C.edgeLine}` }}
            onClick={() => onCommit(selected)}
          >
            <span style={{ fontSize: 12, fontWeight: 600, color: C.accent }}>Done</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Helpers ──
function findSchemaField(schema, fieldName, type) {
  if (!schema) return null;
  const bucketMap = {
    select: "selects",
    status: "statuses",
    multi_select: "multiSelects",
  };
  const bucket = bucketMap[type];
  if (!bucket || !schema[bucket]) return null;
  return schema[bucket].find((f) => f.name === fieldName);
}
