// ─── Record Files ───
// Shared file attachments component for the record model.
// Supports R2 file uploads and external URL attachments.
// 50MB per file limit, enforced client-side.

import React, { useState, useCallback, useEffect, useRef } from "react";
import { C, FONT, RADIUS } from "../design/tokens.js";
import { listFilesByRecord, uploadFileToRecord, deleteFile, getFileUrl } from "../lib/api.js";

const FILE_MAX_BYTES = 52428800; // 50MB

function formatSize(bytes) {
  if (!bytes || bytes === 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

function getFileIcon(mimeType) {
  if (!mimeType) return "\ud83d\udcc4";
  if (mimeType.startsWith("image/")) return "\ud83d\uddbc\ufe0f";
  if (mimeType === "application/pdf") return "\ud83d\udcc4";
  if (mimeType.includes("spreadsheet") || mimeType.includes("excel")) return "\ud83d\udcca";
  if (mimeType.includes("document") || mimeType.includes("word")) return "\ud83d\udcc3";
  if (mimeType === "text/x-url") return "\ud83d\udd17";
  if (mimeType.startsWith("video/")) return "\ud83c\udfa5";
  if (mimeType.startsWith("audio/")) return "\ud83c\udfa7";
  return "\ud83d\udcc1";
}

export default function RecordFiles({ recordId, pageConfigId }) {
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [urlValue, setUrlValue] = useState("");
  const fileInputRef = useRef(null);

  const fetchFiles = useCallback(async () => {
    try {
      setError(null);
      const res = await listFilesByRecord(recordId);
      setFiles(res?.files || []);
    } catch (err) {
      console.error("[RecordFiles] Failed to load:", err);
      setError("Failed to load files.");
      setFiles([]);
    } finally {
      setLoading(false);
    }
  }, [recordId]);

  useEffect(() => { fetchFiles(); }, [fetchFiles]);

  const handleUpload = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > FILE_MAX_BYTES) {
      setError(`File too large (${formatSize(file.size)}). Maximum is 50MB.`);
      return;
    }
    setUploading(true);
    setError(null);
    try {
      await uploadFileToRecord(file, recordId, pageConfigId);
      await fetchFiles();
    } catch (err) {
      setError(err.message || "Upload failed.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, [recordId, pageConfigId, fetchFiles]);

  const handleAddUrl = useCallback(async () => {
    const url = urlValue.trim();
    if (!url) return;
    setUploading(true);
    setError(null);
    try {
      // Create a tiny text blob to use the upload API
      const name = url.split("/").pop()?.split("?")[0]?.slice(0, 40) || "External Link";
      const blob = new File([url], name, { type: "text/x-url" });
      await uploadFileToRecord(blob, recordId, pageConfigId);
      await fetchFiles();
    } catch (err) {
      setError(err.message || "Failed to add URL.");
    }
    setUrlValue("");
    setShowUrlInput(false);
    setUploading(false);
  }, [urlValue, recordId, pageConfigId, fetchFiles]);

  const handleDelete = useCallback(async (fileId) => {
    if (!window.confirm("Delete this file?")) return;
    try {
      setError(null);
      await deleteFile(fileId);
      setFiles((prev) => prev.filter((f) => f.id !== fileId));
    } catch (err) {
      setError("Failed to delete file.");
    }
  }, []);

  if (loading) {
    return <div style={s.empty}>Loading files...</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      {/* Actions */}
      <div style={s.actions}>
        <button onClick={() => fileInputRef.current?.click()} disabled={uploading} style={s.actionBtn}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          {uploading ? "Uploading..." : "Upload File"}
        </button>
        <button onClick={() => setShowUrlInput(!showUrlInput)} style={s.actionBtn}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
          </svg>
          Add URL
        </button>
        <input
          ref={fileInputRef}
          type="file"
          style={{ display: "none" }}
          onChange={handleUpload}
        />
      </div>

      {/* URL input */}
      {showUrlInput && (
        <div style={s.urlRow}>
          <input
            type="url"
            value={urlValue}
            onChange={(e) => setUrlValue(e.target.value)}
            placeholder="https://example.com/file.pdf"
            style={s.urlInput}
            onKeyDown={(e) => { if (e.key === "Enter") handleAddUrl(); }}
            autoFocus
          />
          <button onClick={handleAddUrl} disabled={!urlValue.trim()} style={{ ...s.sendBtn, opacity: urlValue.trim() ? 1 : 0.5 }}>
            Add
          </button>
        </div>
      )}

      {/* Error */}
      {error && <div style={s.error}>{error}</div>}

      {/* File list */}
      <div style={s.list}>
        {files.length === 0 && !showUrlInput && (
          <div style={s.empty}>No files attached</div>
        )}
        {files.map((file) => {
          const meta = typeof file.meta === "string" ? JSON.parse(file.meta || "{}") : (file.meta || {});
          const isUrl = file.mime_type === "text/x-url";
          const isImage = file.mime_type?.startsWith("image/");
          const href = isUrl ? (meta.url || "") : getFileUrl(file.id);
          return (
            <div key={file.id} style={s.fileItem}>
              {/* Thumbnail for images, icon for everything else */}
              {isImage ? (
                <a href={href} target="_blank" rel="noopener noreferrer" style={{ flexShrink: 0 }}>
                  <img
                    src={href}
                    alt={file.name}
                    style={s.thumbnail}
                    onError={(e) => { e.target.style.display = "none"; }}
                  />
                </a>
              ) : (
                <span style={s.fileIcon}>{getFileIcon(file.mime_type)}</span>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={s.fileName}
                  title={file.name}
                >
                  {file.name}
                </a>
                {!isUrl && (
                  <span style={s.fileSize}>{formatSize(file.size)}</span>
                )}
              </div>
              <button
                onClick={() => handleDelete(file.id)}
                style={s.deleteBtn}
                onMouseEnter={(e) => { e.currentTarget.style.color = "#E05252"; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = C.darkMuted; }}
                title="Remove file"
              >&times;</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const s = {
  actions: {
    display: "flex", gap: 8, padding: "8px 0", flexShrink: 0,
  },
  actionBtn: {
    display: "flex", alignItems: "center", gap: 6,
    background: C.darkSurf2, border: `1px solid ${C.darkBorder}`,
    borderRadius: RADIUS.pill, padding: "6px 12px",
    color: C.darkText, fontFamily: FONT, fontSize: 12,
    cursor: "pointer", outline: "none", transition: "background 0.15s",
  },
  urlRow: {
    display: "flex", gap: 6, marginBottom: 8,
  },
  urlInput: {
    flex: 1, background: C.dark, border: `1px solid ${C.darkBorder}`,
    borderRadius: RADIUS.pill, color: C.darkText, fontFamily: FONT,
    fontSize: 13, padding: "8px 12px", outline: "none",
  },
  sendBtn: {
    background: C.accent, color: "#fff", border: "none",
    borderRadius: RADIUS.pill, padding: "8px 14px",
    fontFamily: FONT, fontSize: 12, fontWeight: 600,
    cursor: "pointer", outline: "none", flexShrink: 0,
  },
  list: {
    flex: 1, overflowY: "auto", minHeight: 0,
  },
  empty: {
    fontSize: 12, fontFamily: FONT, color: C.darkMuted,
    padding: "20px 0", textAlign: "center",
  },
  error: {
    fontSize: 11, fontFamily: FONT, color: "#E05252",
    marginBottom: 8, padding: "6px 10px",
    background: "#E0525215", borderRadius: RADIUS.md,
  },
  fileItem: {
    display: "flex", alignItems: "center", gap: 8,
    padding: "8px 0", borderBottom: `1px solid ${C.darkBorder}`,
  },
  fileIcon: {
    fontSize: 16, flexShrink: 0, width: 36, textAlign: "center",
  },
  thumbnail: {
    width: 36,
    height: 36,
    objectFit: "cover",
    borderRadius: RADIUS.sm,
    border: `1px solid ${C.darkBorder}`,
    cursor: "pointer",
  },
  fileName: {
    fontSize: 13, fontFamily: FONT, color: C.accent,
    textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis",
    whiteSpace: "nowrap", display: "block",
  },
  fileSize: {
    fontSize: 10, fontFamily: FONT, color: C.darkMuted, marginLeft: 6,
  },
  deleteBtn: {
    background: "transparent", border: "none", color: C.darkMuted,
    cursor: "pointer", fontSize: 16, padding: "6px 8px", borderRadius: RADIUS.sm,
    outline: "none", flexShrink: 0, transition: "color 0.15s",
    minWidth: 28, minHeight: 28, display: "flex", alignItems: "center", justifyContent: "center",
  },
};
