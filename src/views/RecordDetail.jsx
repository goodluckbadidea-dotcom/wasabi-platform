// ─── Record Detail Panel ───
// Slide-out drawer showing all properties of a single record.
// Supports inline editing for text, number, select, status, multi-select, date, checkbox, URL.
// Read-only display for formula, rollup, created_time, last_edited_time, people, relation.

import React, { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { C, FONT, RADIUS, SHADOW, getSolidPillColor } from "../design/tokens.js";
import { readProp, buildProp } from "../notion/properties.js";
import { IconClose, IconEdit, IconExpand } from "../design/icons.jsx";
import { timeAgo } from "../utils/helpers.js";
import NeuronBadge from "../neurons/NeuronBadge.jsx";
import RecordNotes from "../components/RecordNotes.jsx";
import RecordComments from "../components/RecordComments.jsx";
import RecordFiles from "../components/RecordFiles.jsx";

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
]);

// ── Styles ──
const ds = {
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.55)",
    zIndex: 100,
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
    borderRadius: RADIUS.md,
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
};

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

// ── Main Component ──
export default function RecordDetail({ page, schema, onClose, onUpdate, onDelete, pageConfigId, resolvedLinks, onLinkField, onUnlinkField }) {
  const [editingField, setEditingField] = useState(null);
  const [editValue, setEditValue] = useState(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pendingChanges, setPendingChanges] = useState({});
  const [activeTab, setActiveTab] = useState("properties");

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
  }, []);

  // Commit an edit
  const commitEdit = useCallback((fieldName, type, value) => {
    const propPayload = buildProp(type, value);
    if (propPayload) {
      setPendingChanges((prev) => ({ ...prev, [fieldName]: { type, value, payload: propPayload } }));
    }
    setEditingField(null);
    setEditValue(null);
  }, []);

  // Save all pending changes
  const handleSave = useCallback(async () => {
    if (Object.keys(pendingChanges).length === 0) {
      onClose();
      return;
    }

    setSaving(true);
    try {
      const properties = {};
      for (const [fieldName, change] of Object.entries(pendingChanges)) {
        properties[fieldName] = change.payload;
      }
      await onUpdate(page.id, properties);
      setPendingChanges({});
      onClose();
    } catch (err) {
      console.error("Save failed:", err);
      alert("Failed to save: " + err.message);
    } finally {
      setSaving(false);
    }
  }, [pendingChanges, page.id, onUpdate, onClose]);

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

  return (
    <div style={ds.overlay} onClick={onClose} onKeyDown={(e) => e.stopPropagation()}>
      <div style={ds.drawer} onClick={(e) => e.stopPropagation()}>
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

        {/* Tab Bar */}
        <div style={ds.tabBar}>
          {[
            { key: "properties", label: "Properties" },
            { key: "notes", label: "Notes" },
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
              {properties.map(([fieldName, prop]) => {
                const isEditing = editingField === fieldName;
                const isEditable = EDITABLE_TYPES.has(prop.type);
                const hasPending = !!pendingChanges[fieldName];
                const cellKey = `${page.id}:${fieldName}`;
                const linkData = resolvedLinks?.get(cellKey);
                const isLinked = !!linkData;

                return (
                  <div
                    key={fieldName}
                    className="prop-row-hover"
                    style={{
                      ...ds.propRow,
                      background: hasPending ? `${C.accent}08` : "transparent",
                      borderLeft: isLinked ? `3px solid ${linkData.stale ? "#FF6B3D" : C.accent}` : "3px solid transparent",
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
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={linkData.stale ? "#FF6B3D" : C.accent} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                          </svg>
                        </button>
                      )}
                      {isEditable && !isEditing && !isLinked && (
                        <IconEdit size={10} color={C.darkMuted + "66"} />
                      )}
                    </div>
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
                    color: confirmDelete ? "#fff" : "#FF6B3D",
                    borderColor: "#FF6B3D",
                    background: confirmDelete ? "#FF6B3D" : "transparent",
                    marginRight: "auto",
                    fontSize: 11,
                  }}
                  onClick={() => {
                    if (confirmDelete) {
                      onDelete([page.id]);
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

        {/* Notes Tab */}
        {activeTab === "notes" && <RecordNotes recordId={page.id} pageConfigId={pageConfigId} />}

        {/* Comments Tab */}
        {activeTab === "comments" && <RecordComments recordId={page.id} pageConfigId={pageConfigId} />}

        {/* Files Tab */}
        {activeTab === "files" && <RecordFiles recordId={page.id} pageConfigId={pageConfigId} />}
      </div>
    </div>
  );
}

// ── Notes Tab ──
// NotesTab and CommentsTab have been extracted to shared components:
// src/components/RecordNotes.jsx and src/components/RecordComments.jsx

// ── Display a property value (read mode) ──
function DisplayValue({ prop, fieldName, schema, pendingValue, linkedValue }) {
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
        return (
          <span>
            {value.start || "—"}
            {value.end && <span style={{ color: C.darkMuted }}> → {value.end}</span>}
          </span>
        );
      }
      return <span>{String(value)}</span>;
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

    default:
      return <span style={{ color: C.darkMuted }}>{JSON.stringify(value)}</span>;
  }
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
function EditField({ fieldName, type, value, schemaField, onCommit, onCancel }) {
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
        />
      );

    default:
      return <span style={{ color: C.darkMuted }}>Not editable</span>;
  }
}

// ── Date Editor ──
function DateEditor({ value, onCommit, onCancel }) {
  const startVal = typeof value === "object" ? value?.start : value || "";
  const endVal = typeof value === "object" ? value?.end : "";
  const [start, setStart] = useState(startVal?.slice(0, 10) || "");
  const [end, setEnd] = useState(endVal?.slice(0, 10) || "");

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flex: 1 }} onClick={(e) => e.stopPropagation()}>
      <input
        type="date"
        value={start}
        onChange={(e) => setStart(e.target.value)}
        style={{ ...ds.input, width: "auto", flex: 1 }}
        autoFocus
        onKeyDown={(e) => {
          if (e.key === "Escape") onCancel();
          if (e.key === "Enter") onCommit(end ? { start, end } : start);
        }}
      />
      <span style={{ color: C.darkMuted, fontSize: 12 }}>to</span>
      <input
        type="date"
        value={end}
        onChange={(e) => setEnd(e.target.value)}
        style={{ ...ds.input, width: "auto", flex: 1 }}
        onKeyDown={(e) => {
          if (e.key === "Escape") onCancel();
          if (e.key === "Enter") onCommit(end ? { start, end } : start);
        }}
      />
      <button
        style={ds.btn(true)}
        onClick={() => onCommit(end ? { start, end } : start)}
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
function SelectEditor({ value, options, onCommit, onCancel, multi }) {
  const [selected, setSelected] = useState(
    multi ? (Array.isArray(value) ? value : []) : value
  );
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
