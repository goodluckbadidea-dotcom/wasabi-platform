// ─── Record Detail Panel ───
// Slide-out drawer showing all properties of a single record.
// Supports inline editing for text, number, select, status, multi-select, date, checkbox, URL.
// Read-only display for formula, rollup, created_time, last_edited_time, people, relation.

import React, { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { C, FONT, RADIUS, SHADOW, getSolidPillColor } from "../design/tokens.js";
import { readProp, buildProp } from "../notion/properties.js";
import { IconClose, IconEdit, IconExpand } from "../design/icons.jsx";
import {
  getRecordNote, saveRecordNote,
  listRecordComments, createRecordComment, deleteRecordComment,
} from "../lib/api.js";
import { timeAgo } from "../utils/helpers.js";

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
    style.textContent = `@keyframes slideInRight{from{transform:translateX(100%);opacity:0}to{transform:translateX(0);opacity:1}}`;
    document.head.appendChild(style);
  }
}

// ── Main Component ──
export default function RecordDetail({ page, schema, onClose, onUpdate, pageConfigId }) {
  const [editingField, setEditingField] = useState(null);
  const [editValue, setEditValue] = useState(null);
  const [saving, setSaving] = useState(false);
  const [pendingChanges, setPendingChanges] = useState({});
  const [activeTab, setActiveTab] = useState("properties");

  if (!page) return null;

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

  return (
    <div style={ds.overlay} onClick={onClose}>
      <div style={ds.drawer} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={ds.header}>
          <div style={ds.title}>{title}</div>
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

                return (
                  <div
                    key={fieldName}
                    style={{
                      ...ds.propRow,
                      background: hasPending ? `${C.accent}08` : "transparent",
                      cursor: isEditable ? "pointer" : "default",
                    }}
                    onClick={() => !isEditing && isEditable && startEdit(fieldName, prop)}
                  >
                    {/* Label */}
                    <div style={ds.propLabel}>
                      <span>{fieldName}</span>
                      <span style={ds.propType}>{TYPE_LABELS[prop.type] || prop.type}</span>
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
                        />
                      )}
                      {isEditable && !isEditing && (
                        <IconEdit size={10} color={C.darkMuted + "66"} />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Footer — only on Properties tab */}
            <div style={ds.footer}>
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
        {activeTab === "notes" && <NotesTab recordId={page.id} pageConfigId={pageConfigId} />}

        {/* Comments Tab */}
        {activeTab === "comments" && <CommentsTab recordId={page.id} pageConfigId={pageConfigId} />}
      </div>
    </div>
  );
}

// ── Notes Tab ──
function NotesTab({ recordId, pageConfigId }) {
  const [content, setContent] = useState("");
  const [status, setStatus] = useState("");      // "", "Saving...", "Saved"
  const [loading, setLoading] = useState(true);
  const debounceRef = useRef(null);
  const latestContentRef = useRef("");

  // Fetch note on mount
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getRecordNote(recordId, pageConfigId)
      .then((res) => {
        if (!cancelled) {
          const text = res?.note?.content || "";
          setContent(text);
          latestContentRef.current = text;
        }
      })
      .catch(() => {
        if (!cancelled) setContent("");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [recordId, pageConfigId]);

  // Auto-save helper
  const doSave = useCallback(async (text) => {
    setStatus("Saving...");
    try {
      await saveRecordNote(recordId, pageConfigId, text);
      setStatus("Saved");
    } catch {
      setStatus("Save failed");
    }
  }, [recordId, pageConfigId]);

  // Debounced save on change
  const handleChange = useCallback((e) => {
    const val = e.target.value;
    setContent(val);
    latestContentRef.current = val;
    setStatus("");
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSave(val), 1000);
  }, [doSave]);

  // Save on blur
  const handleBlur = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    doSave(latestContentRef.current);
  }, [doSave]);

  // Cleanup timer
  useEffect(() => {
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, []);

  if (loading) {
    return <div style={ds.emptyState}>Loading notes...</div>;
  }

  return (
    <div style={ds.notesArea}>
      <textarea
        style={ds.noteTextarea}
        value={content}
        onChange={handleChange}
        onBlur={handleBlur}
        placeholder="Write notes about this record..."
        onFocus={(e) => { e.currentTarget.style.borderColor = C.accent; }}
        onMouseLeave={() => {}}
        onBlurCapture={(e) => { e.currentTarget.style.borderColor = C.darkBorder; }}
      />
      <div style={ds.noteStatus}>{status}</div>
    </div>
  );
}

// ── Comments Tab ──
function CommentsTab({ recordId, pageConfigId }) {
  const [comments, setComments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newComment, setNewComment] = useState("");
  const [sending, setSending] = useState(false);
  const inputRef = useRef(null);

  // Fetch comments on mount
  const fetchComments = useCallback(async () => {
    try {
      const res = await listRecordComments(recordId, pageConfigId);
      setComments(res?.comments || []);
    } catch {
      setComments([]);
    } finally {
      setLoading(false);
    }
  }, [recordId, pageConfigId]);

  useEffect(() => { fetchComments(); }, [fetchComments]);

  // Add comment
  const handleSend = useCallback(async () => {
    const text = newComment.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      await createRecordComment(recordId, pageConfigId, text);
      setNewComment("");
      await fetchComments();
      if (inputRef.current) inputRef.current.focus();
    } catch (err) {
      console.error("Failed to add comment:", err);
    } finally {
      setSending(false);
    }
  }, [newComment, sending, recordId, pageConfigId, fetchComments]);

  // Delete comment
  const handleDelete = useCallback(async (commentId) => {
    try {
      await deleteRecordComment(recordId, commentId);
      setComments((prev) => prev.filter((c) => c.id !== commentId));
    } catch (err) {
      console.error("Failed to delete comment:", err);
    }
  }, [recordId]);

  // Enter to send
  const handleKeyDown = useCallback((e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  if (loading) {
    return <div style={ds.emptyState}>Loading comments...</div>;
  }

  return (
    <>
      <div style={ds.commentsList}>
        {comments.length === 0 && (
          <div style={ds.emptyState}>No comments yet</div>
        )}
        {comments.map((comment) => (
          <div key={comment.id} style={ds.commentItem}>
            <div style={{ flex: 1 }}>
              <div style={ds.commentContent}>{comment.content}</div>
              <div style={ds.commentMeta}>
                {comment.created_at ? timeAgo(comment.created_at) : ""}
              </div>
            </div>
            <button
              style={ds.commentDeleteBtn}
              onClick={() => handleDelete(comment.id)}
              onMouseEnter={(e) => { e.currentTarget.style.background = C.darkSurf2; e.currentTarget.style.color = "#E05252"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = C.darkMuted; }}
              title="Delete comment"
            >
              &times;
            </button>
          </div>
        ))}
      </div>

      {/* New comment input */}
      <div style={ds.commentInput}>
        <input
          ref={inputRef}
          type="text"
          value={newComment}
          onChange={(e) => setNewComment(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Add a comment..."
          style={{ ...ds.input, flex: 1 }}
        />
        <button
          style={{
            ...ds.btn(true),
            opacity: sending || !newComment.trim() ? 0.5 : 1,
          }}
          onClick={handleSend}
          disabled={sending || !newComment.trim()}
        >
          {sending ? "..." : "Send"}
        </button>
      </div>
    </>
  );
}

// ── Display a property value (read mode) ──
function DisplayValue({ prop, fieldName, schema, pendingValue }) {
  const value = pendingValue !== undefined ? pendingValue : readProp(prop);

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

// ── Edit Field (inline editor) ──
function EditField({ fieldName, type, value, schemaField, onCommit, onCancel }) {
  const inputRef = useRef(null);

  useEffect(() => {
    if (inputRef.current) inputRef.current.focus();
  }, []);

  const handleKeyDown = (e) => {
    if (e.key === "Escape") onCancel();
    if (e.key === "Enter" && type !== "rich_text") {
      onCommit(inputRef.current?.value ?? value);
    }
  };

  switch (type) {
    case "title":
    case "rich_text":
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
