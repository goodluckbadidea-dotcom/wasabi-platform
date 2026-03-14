// ─── Knowledge Base ───
// Three-tab knowledge management interface: Files, Network, Context.
// Files: browsable R2 file directory with upload/delete.
// Network: force-directed graph of automations + neurons.
// Context: manage KB entries injected into Wasabi's system prompt.

import React, { useState, useCallback, useEffect, useRef } from "react";
import { C, FONT, MONO, RADIUS } from "../design/tokens.js";
import { IconBrain, IconUpload, IconTrash, IconSearch } from "../design/icons.jsx";
import { usePlatform } from "../context/PlatformContext.jsx";
import * as api from "../lib/api.js";
import NetworkGraph from "../views/NetworkGraph.jsx";

// ── Tab button style ──
const tabBtn = (active) => ({
  padding: "6px 18px",
  border: "none",
  cursor: "pointer",
  fontFamily: FONT,
  fontSize: 12,
  fontWeight: active ? 600 : 400,
  background: active ? `linear-gradient(135deg, ${C.accent}, ${C.accent}cc)` : "transparent",
  color: active ? "#fff" : C.darkMuted,
  borderRadius: RADIUS.lg,
  transition: "background 0.14s, color 0.14s",
  outline: "none",
  whiteSpace: "nowrap",
});

// ── File size formatter ──
function formatSize(bytes) {
  if (!bytes || bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

// ── File type icon/color ──
function getFileType(name) {
  const ext = (name || "").split(".").pop().toLowerCase();
  const map = {
    pdf: { label: "PDF", color: "#E05252" },
    csv: { label: "CSV", color: "#4CAF50" },
    xlsx: { label: "XLS", color: "#2196F3" },
    xls: { label: "XLS", color: "#2196F3" },
    json: { label: "JSON", color: "#FF9800" },
    txt: { label: "TXT", color: C.darkMuted },
    md: { label: "MD", color: C.darkMuted },
    png: { label: "IMG", color: "#9C27B0" },
    jpg: { label: "IMG", color: "#9C27B0" },
    jpeg: { label: "IMG", color: "#9C27B0" },
    gif: { label: "IMG", color: "#9C27B0" },
    svg: { label: "SVG", color: "#9C27B0" },
    doc: { label: "DOC", color: "#2196F3" },
    docx: { label: "DOC", color: "#2196F3" },
  };
  return map[ext] || { label: ext.toUpperCase() || "FILE", color: C.darkMuted };
}

// ════════════════════════════════════════════════════════════════════════════
// FILES TAB
// ════════════════════════════════════════════════════════════════════════════

function FilesTab() {
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const fileInputRef = useRef(null);
  const fetched = useRef(false);

  // Load files
  useEffect(() => {
    if (fetched.current) return;
    fetched.current = true;
    setLoading(true);
    api.listFiles()
      .then((data) => setFiles(data.files || []))
      .catch((err) => console.warn("Failed to load files:", err))
      .finally(() => setLoading(false));
  }, []);

  const handleUpload = useCallback(async (e) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;
    setUploading(true);
    try {
      for (const file of fileList) {
        const result = await api.uploadFile(file);
        setFiles((prev) => [{ id: result.id, name: file.name, size: file.size, type: file.type, created_at: new Date().toISOString(), ...result }, ...prev]);
      }
    } catch (err) {
      console.error("Upload failed:", err);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, []);

  const handleDelete = useCallback(async (fileId) => {
    try {
      await api.deleteFile(fileId);
      setFiles((prev) => prev.filter((f) => f.id !== fileId));
    } catch (err) {
      console.error("Delete failed:", err);
    }
  }, []);

  const handleDownload = useCallback((fileId, fileName) => {
    const url = api.getFileUrl(fileId);
    if (url) {
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName || "download";
      a.target = "_blank";
      a.click();
    }
  }, []);

  const filteredFiles = searchQuery
    ? files.filter((f) => (f.name || "").toLowerCase().includes(searchQuery.toLowerCase()))
    : files;

  return (
    <div style={{ padding: "24px 32px" }}>
      {/* Toolbar */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        {/* Search */}
        <div style={{
          flex: 1, display: "flex", alignItems: "center", gap: 8,
          background: C.darkSurf, border: `1px solid ${C.darkBorder}`,
          borderRadius: RADIUS.lg, padding: "8px 12px",
        }}>
          <IconSearch size={13} color={C.darkMuted} />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search files..."
            style={{
              flex: 1, background: "transparent", border: "none", outline: "none",
              fontFamily: FONT, fontSize: 13, color: C.darkText, padding: 0,
            }}
          />
        </div>
        {/* Upload */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          style={{ display: "none" }}
          onChange={handleUpload}
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "8px 16px", borderRadius: RADIUS.lg,
            background: C.accent, border: "none", cursor: uploading ? "default" : "pointer",
            fontFamily: FONT, fontSize: 12, fontWeight: 600, color: "#fff",
            opacity: uploading ? 0.6 : 1, outline: "none", flexShrink: 0,
          }}
        >
          <IconUpload size={12} color="#fff" />
          {uploading ? "Uploading..." : "Upload"}
        </button>
      </div>

      {/* File list */}
      {loading ? (
        <div style={{ color: C.darkMuted, fontSize: 12, textAlign: "center", padding: 40 }}>
          Loading files...
        </div>
      ) : filteredFiles.length === 0 ? (
        <div style={{
          color: C.darkMuted, fontSize: 12, textAlign: "center", padding: 40,
          background: C.darkSurf, border: `1px solid ${C.darkBorder}`, borderRadius: RADIUS.lg,
        }}>
          {searchQuery ? "No matching files" : "No files uploaded yet. Click Upload to add files."}
        </div>
      ) : (
        <div style={{
          background: C.darkSurf, border: `1px solid ${C.darkBorder}`,
          borderRadius: RADIUS.lg, overflow: "hidden",
        }}>
          {/* Header */}
          <div style={{
            display: "grid", gridTemplateColumns: "40px 1fr 80px 100px 40px",
            padding: "8px 14px", borderBottom: `1px solid ${C.darkBorder}`,
            gap: 10,
          }}>
            {["Type", "Name", "Size", "Date", ""].map((h) => (
              <span key={h} style={{
                fontSize: 9, fontWeight: 600, textTransform: "uppercase",
                letterSpacing: "0.06em", color: C.darkMuted, fontFamily: FONT,
              }}>
                {h}
              </span>
            ))}
          </div>
          {/* Rows */}
          {filteredFiles.map((file) => {
            const ft = getFileType(file.name);
            return (
              <FileRow
                key={file.id}
                file={file}
                fileType={ft}
                onDownload={handleDownload}
                onDelete={handleDelete}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function FileRow({ file, fileType, onDownload, onDelete }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      style={{
        display: "grid", gridTemplateColumns: "40px 1fr 80px 100px 40px",
        padding: "10px 14px", gap: 10, alignItems: "center",
        borderBottom: `1px solid ${C.edgeLine}`,
        background: hovered ? C.darkSurf2 : "transparent",
        transition: "background 0.1s", cursor: "pointer",
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => onDownload(file.id, file.name)}
    >
      {/* Type badge */}
      <span style={{
        fontSize: 8, fontWeight: 700, color: fileType.color, fontFamily: MONO,
        background: fileType.color + "18", padding: "2px 6px", borderRadius: 3,
        textAlign: "center", letterSpacing: "0.04em",
      }}>
        {fileType.label}
      </span>
      {/* Name */}
      <span style={{
        fontSize: 12, color: C.darkText, fontFamily: FONT,
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>
        {file.name || "Untitled"}
      </span>
      {/* Size */}
      <span style={{ fontSize: 11, color: C.darkMuted, fontFamily: MONO }}>
        {formatSize(file.size)}
      </span>
      {/* Date */}
      <span style={{ fontSize: 11, color: C.darkMuted, fontFamily: MONO }}>
        {file.created_at ? new Date(file.created_at).toLocaleDateString([], { month: "short", day: "numeric" }) : "--"}
      </span>
      {/* Delete */}
      {hovered && (
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(file.id); }}
          title="Delete file"
          style={{
            background: "none", border: "none", cursor: "pointer", padding: 4,
            display: "flex", alignItems: "center", outline: "none",
            opacity: 0.5, transition: "opacity 0.12s",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; }}
          onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.5"; }}
        >
          <IconTrash size={10} color="#E05252" />
        </button>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// CONTEXT TAB
// ════════════════════════════════════════════════════════════════════════════

function ContextTab() {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [addKey, setAddKey] = useState("");
  const [addCategory, setAddCategory] = useState("general");
  const [addContent, setAddContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editContent, setEditContent] = useState("");
  const fetched = useRef(false);

  // Load KB entries
  useEffect(() => {
    if (fetched.current) return;
    fetched.current = true;
    setLoading(true);
    api.listKB()
      .then((data) => setEntries(data.entries || []))
      .catch((err) => console.warn("Failed to load KB:", err))
      .finally(() => setLoading(false));
  }, []);

  const handleAdd = useCallback(async () => {
    if (!addKey.trim() || !addContent.trim()) return;
    setSaving(true);
    try {
      const result = await api.createKBEntry({
        key: addKey.trim(),
        category: addCategory,
        content: addContent.trim(),
        source: "manual",
      });
      setEntries((prev) => [{ id: result.id, key: addKey.trim(), category: addCategory, content: addContent.trim(), source: "manual", created_at: new Date().toISOString() }, ...prev]);
      setAddKey("");
      setAddContent("");
      setShowAdd(false);
    } catch (err) {
      console.error("Failed to add KB entry:", err);
    } finally {
      setSaving(false);
    }
  }, [addKey, addCategory, addContent]);

  const handleDelete = useCallback(async (id) => {
    try {
      await api.deleteKBEntry(id);
      setEntries((prev) => prev.filter((e) => e.id !== id));
    } catch (err) {
      console.error("Failed to delete KB entry:", err);
    }
  }, []);

  const handleUpdate = useCallback(async (id) => {
    if (!editContent.trim()) return;
    setSaving(true);
    try {
      await api.updateKBEntry(id, { content: editContent.trim() });
      setEntries((prev) => prev.map((e) => e.id === id ? { ...e, content: editContent.trim() } : e));
      setEditingId(null);
      setEditContent("");
    } catch (err) {
      console.error("Failed to update KB entry:", err);
    } finally {
      setSaving(false);
    }
  }, [editContent]);

  // Character count for all entries combined
  const totalChars = entries.reduce((sum, e) => sum + (e.content || "").length, 0);
  const estimatedTokens = Math.round(totalChars / 4);

  return (
    <div style={{ padding: "24px 32px" }}>
      {/* Info banner */}
      <div style={{
        background: C.accent + "12", border: `1px solid ${C.accent}33`,
        borderRadius: RADIUS.lg, padding: "12px 16px", marginBottom: 16,
        display: "flex", alignItems: "flex-start", gap: 10,
      }}>
        <IconBrain size={16} color={C.accent} style={{ flexShrink: 0, marginTop: 1 }} />
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: C.darkText, fontFamily: FONT, marginBottom: 4 }}>
            Knowledge Base Context
          </div>
          <div style={{ fontSize: 11, color: C.darkMuted, fontFamily: FONT, lineHeight: 1.5 }}>
            Entries here are injected into Wasabi's system prompt, giving the AI permanent context about your projects, preferences, and workflows. Keep entries concise for optimal token usage.
          </div>
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: "flex", gap: 16, marginBottom: 16, alignItems: "center" }}>
        <span style={{ fontSize: 11, color: C.darkMuted, fontFamily: FONT }}>
          {entries.length} {entries.length === 1 ? "entry" : "entries"}
        </span>
        <span style={{ fontSize: 11, color: C.darkMuted, fontFamily: MONO }}>
          ~{estimatedTokens.toLocaleString()} tokens
        </span>
        <span style={{ fontSize: 11, color: totalChars > 20000 ? "#E05252" : C.darkMuted, fontFamily: MONO }}>
          {totalChars.toLocaleString()} chars
        </span>
        <div style={{ flex: 1 }} />
        <button
          onClick={() => setShowAdd((o) => !o)}
          style={{
            padding: "7px 16px", borderRadius: RADIUS.lg,
            background: showAdd ? C.darkSurf2 : C.accent,
            border: "none", cursor: "pointer", fontFamily: FONT,
            fontSize: 12, fontWeight: 600, color: showAdd ? C.darkMuted : "#fff",
            outline: "none",
          }}
        >
          {showAdd ? "Cancel" : "+ Add Entry"}
        </button>
      </div>

      {/* Add form */}
      {showAdd && (
        <div style={{
          background: C.darkSurf, border: `1px solid ${C.darkBorder}`,
          borderRadius: RADIUS.lg, padding: 16, marginBottom: 16,
        }}>
          <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
            <input
              type="text"
              value={addKey}
              onChange={(e) => setAddKey(e.target.value)}
              placeholder="Entry title / key"
              style={{
                flex: 1, background: C.dark, border: `1px solid ${C.darkBorder}`,
                borderRadius: RADIUS.md, color: C.darkText, fontFamily: FONT,
                fontSize: 12, padding: "8px 10px", outline: "none",
              }}
              onFocus={(e) => { e.target.style.borderColor = C.accent; }}
              onBlur={(e) => { e.target.style.borderColor = C.darkBorder; }}
            />
            <select
              value={addCategory}
              onChange={(e) => setAddCategory(e.target.value)}
              style={{
                background: C.dark, border: `1px solid ${C.darkBorder}`,
                borderRadius: RADIUS.md, color: C.darkText, fontFamily: FONT,
                fontSize: 12, padding: "8px 10px", outline: "none",
              }}
            >
              <option value="general">General</option>
              <option value="project">Project</option>
              <option value="preference">Preference</option>
              <option value="workflow">Workflow</option>
              <option value="reference">Reference</option>
            </select>
          </div>
          <textarea
            value={addContent}
            onChange={(e) => setAddContent(e.target.value)}
            placeholder="Entry content... (this gets injected into Wasabi's context)"
            rows={5}
            style={{
              width: "100%", background: C.dark, border: `1px solid ${C.darkBorder}`,
              borderRadius: RADIUS.md, color: C.darkText, fontFamily: FONT,
              fontSize: 12, padding: "8px 10px", outline: "none", resize: "vertical",
              lineHeight: 1.5, boxSizing: "border-box",
            }}
            onFocus={(e) => { e.target.style.borderColor = C.accent; }}
            onBlur={(e) => { e.target.style.borderColor = C.darkBorder; }}
          />
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10 }}>
            <span style={{ fontSize: 10, color: C.darkMuted, fontFamily: MONO }}>
              {addContent.length} chars / ~{Math.round(addContent.length / 4)} tokens
            </span>
            <button
              onClick={handleAdd}
              disabled={saving || !addKey.trim() || !addContent.trim()}
              style={{
                padding: "7px 20px", borderRadius: RADIUS.md,
                background: saving || !addKey.trim() || !addContent.trim() ? C.darkSurf2 : C.accent,
                border: "none", cursor: saving || !addKey.trim() || !addContent.trim() ? "default" : "pointer",
                fontFamily: FONT, fontSize: 12, fontWeight: 600, color: "#fff",
                opacity: saving || !addKey.trim() || !addContent.trim() ? 0.5 : 1,
                outline: "none",
              }}
            >
              {saving ? "Saving..." : "Save Entry"}
            </button>
          </div>
        </div>
      )}

      {/* Entries list */}
      {loading ? (
        <div style={{ color: C.darkMuted, fontSize: 12, textAlign: "center", padding: 40 }}>
          Loading entries...
        </div>
      ) : entries.length === 0 ? (
        <div style={{
          color: C.darkMuted, fontSize: 12, textAlign: "center", padding: 40,
          background: C.darkSurf, border: `1px solid ${C.darkBorder}`, borderRadius: RADIUS.lg,
        }}>
          No knowledge base entries yet. Add entries to give Wasabi permanent context.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {entries.map((entry) => (
            <KBEntryCard
              key={entry.id}
              entry={entry}
              isEditing={editingId === entry.id}
              editContent={editingId === entry.id ? editContent : ""}
              onStartEdit={() => { setEditingId(entry.id); setEditContent(entry.content || ""); }}
              onCancelEdit={() => { setEditingId(null); setEditContent(""); }}
              onEditChange={setEditContent}
              onSaveEdit={() => handleUpdate(entry.id)}
              onDelete={() => handleDelete(entry.id)}
              saving={saving}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function KBEntryCard({ entry, isEditing, editContent, onStartEdit, onCancelEdit, onEditChange, onSaveEdit, onDelete, saving }) {
  const [hovered, setHovered] = useState(false);

  const categoryColors = {
    general: C.darkMuted,
    project: "#2196F3",
    preference: "#9C27B0",
    workflow: "#FF9800",
    reference: "#4CAF50",
  };

  return (
    <div
      style={{
        background: C.darkSurf, border: `1px solid ${C.darkBorder}`,
        borderRadius: RADIUS.lg, padding: "12px 16px",
        transition: "border-color 0.12s",
        borderColor: hovered ? C.accent + "44" : C.darkBorder,
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: isEditing ? 10 : 4 }}>
        <span style={{
          fontSize: 9, fontWeight: 600, color: categoryColors[entry.category] || C.darkMuted,
          background: (categoryColors[entry.category] || C.darkMuted) + "18",
          padding: "2px 8px", borderRadius: 3, textTransform: "uppercase",
          letterSpacing: "0.04em", fontFamily: FONT,
        }}>
          {entry.category || "general"}
        </span>
        <span style={{ fontSize: 13, fontWeight: 500, color: C.darkText, fontFamily: FONT, flex: 1 }}>
          {entry.key || "Untitled"}
        </span>
        <span style={{ fontSize: 10, color: C.darkMuted, fontFamily: MONO }}>
          {(entry.content || "").length} chars
        </span>
        {hovered && !isEditing && (
          <div style={{ display: "flex", gap: 4 }}>
            <button
              onClick={onStartEdit}
              style={{
                background: C.darkSurf2, border: `1px solid ${C.darkBorder}`, borderRadius: RADIUS.sm,
                color: C.darkMuted, fontFamily: FONT, fontSize: 10, padding: "2px 8px", cursor: "pointer", outline: "none",
              }}
            >
              Edit
            </button>
            <button
              onClick={onDelete}
              style={{
                background: "transparent", border: `1px solid #E0525233`, borderRadius: RADIUS.sm,
                color: "#E05252", fontFamily: FONT, fontSize: 10, padding: "2px 8px", cursor: "pointer", outline: "none",
              }}
            >
              Delete
            </button>
          </div>
        )}
      </div>

      {/* Content */}
      {isEditing ? (
        <>
          <textarea
            value={editContent}
            onChange={(e) => onEditChange(e.target.value)}
            rows={5}
            style={{
              width: "100%", background: C.dark, border: `1px solid ${C.darkBorder}`,
              borderRadius: RADIUS.md, color: C.darkText, fontFamily: FONT,
              fontSize: 12, padding: "8px 10px", outline: "none", resize: "vertical",
              lineHeight: 1.5, boxSizing: "border-box",
            }}
            onFocus={(e) => { e.target.style.borderColor = C.accent; }}
            onBlur={(e) => { e.target.style.borderColor = C.darkBorder; }}
            autoFocus
          />
          <div style={{ display: "flex", gap: 8, marginTop: 8, justifyContent: "flex-end" }}>
            <button
              onClick={onCancelEdit}
              style={{
                background: C.darkSurf2, border: `1px solid ${C.darkBorder}`, borderRadius: RADIUS.md,
                color: C.darkMuted, fontFamily: FONT, fontSize: 11, padding: "5px 12px", cursor: "pointer", outline: "none",
              }}
            >
              Cancel
            </button>
            <button
              onClick={onSaveEdit}
              disabled={saving}
              style={{
                background: C.accent, border: "none", borderRadius: RADIUS.md,
                color: "#fff", fontFamily: FONT, fontSize: 11, fontWeight: 600,
                padding: "5px 16px", cursor: saving ? "default" : "pointer",
                opacity: saving ? 0.5 : 1, outline: "none",
              }}
            >
              {saving ? "..." : "Save"}
            </button>
          </div>
        </>
      ) : (
        <div style={{
          fontSize: 11, color: C.darkMuted, fontFamily: FONT, lineHeight: 1.5,
          whiteSpace: "pre-wrap", maxHeight: 100, overflow: "hidden",
          maskImage: (entry.content || "").length > 200 ? "linear-gradient(180deg, #000 70%, transparent)" : "none",
          WebkitMaskImage: (entry.content || "").length > 200 ? "linear-gradient(180deg, #000 70%, transparent)" : "none",
        }}>
          {entry.content || ""}
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// KNOWLEDGE BASE (Main Component)
// ════════════════════════════════════════════════════════════════════════════

export default function KnowledgeBase({ automationEngine }) {
  const [tab, setTab] = useState("files");

  return (
    <div style={{
      display: "flex", flexDirection: "column", height: "100%",
      background: C.dark, fontFamily: FONT, overflow: "hidden",
    }}>
      {/* Tab bar */}
      <div style={{
        flexShrink: 0, padding: "16px 32px 0",
        borderBottom: `1px solid ${C.darkBorder}`,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <IconBrain size={22} color={C.accent} />
          <span style={{ fontSize: 18, fontWeight: 600, color: "#fff", fontFamily: FONT }}>
            Knowledge Base
          </span>
        </div>
        <div style={{
          display: "flex", gap: 3, marginBottom: 12,
          background: C.darkSurf, borderRadius: RADIUS.pill, padding: 3, width: "fit-content",
        }}>
          <button style={tabBtn(tab === "files")} onClick={() => setTab("files")}>
            Files
          </button>
          <button style={tabBtn(tab === "network")} onClick={() => setTab("network")}>
            Network
          </button>
          <button style={tabBtn(tab === "context")} onClick={() => setTab("context")}>
            Context
          </button>
        </div>
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflow: "auto", minHeight: 0 }}>
        {tab === "files" && <FilesTab />}
        {tab === "network" && <NetworkGraph automationEngine={automationEngine} />}
        {tab === "context" && <ContextTab />}
      </div>
    </div>
  );
}
