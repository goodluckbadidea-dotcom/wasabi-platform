// ─── Figma View ───
// Browse Figma team projects and files. Import design files as Wasabi records.

import React, { useState, useEffect, useCallback, useRef } from "react";
import { C, FONT, RADIUS, SHADOW } from "../design/tokens.js";
import { getFigmaProjects, getFigmaFiles, getFigmaFile, importFigmaFiles } from "../lib/api.js";
import { useNavigation } from "../context/NavigationContext.jsx";
import PanelHeader from "../core/PanelHeader.jsx";
import FigmaCommentPanel from "./FigmaCommentPanel.jsx";

// ── Figma icon (geometric logo) ──
function FigmaIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M8 24c2.2 0 4-1.8 4-4v-4H8c-2.2 0-4 1.8-4 4s1.8 4 4 4z" fill="#0ACF83" />
      <path d="M4 12c0-2.2 1.8-4 4-4h4v8H8c-2.2 0-4-1.8-4-4z" fill="#A259FF" />
      <path d="M4 4c0-2.2 1.8-4 4-4h4v8H8C5.8 8 4 6.2 4 4z" fill="#F24E1E" />
      <path d="M12 0h4c2.2 0 4 1.8 4 4s-1.8 4-4 4h-4V0z" fill="#FF7262" />
      <path d="M20 12c0 2.2-1.8 4-4 4s-4-1.8-4-4 1.8-4 4-4 4 1.8 4 4z" fill="#1ABCFE" />
    </svg>
  );
}

// ── Checkmark icon ──
function CheckIcon({ size = 14, color = "#fff" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none">
      <path d="M3 7l3 3 5-5.5" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ── Time formatting ──
function formatRelative(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const diff = now - d;
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString();
}

// ── Main Component ──
export default function FigmaView() {
  const { setActiveRightPane, consumePendingFigmaFile } = useNavigation();

  // Project state
  const [projects, setProjects] = useState([]);
  const [selectedProject, setSelectedProject] = useState(null);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [projectError, setProjectError] = useState(null);

  // File state
  const [files, setFiles] = useState([]);
  const [projectName, setProjectName] = useState("");
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [fileError, setFileError] = useState(null);

  // File detail state
  const [selectedFile, setSelectedFile] = useState(null);
  const [fileDetail, setFileDetail] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Search
  const [search, setSearch] = useState("");

  // Selection + import
  const [selected, setSelected] = useState(new Set());
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);

  // In-app viewer (Phase 1)
  const [viewingFile, setViewingFile] = useState(null);
  const [viewerHintDismissed, setViewerHintDismissed] = useState(false);
  const [viewerHintVisible, setViewerHintVisible] = useState(false);

  // Comment panel (Phase 2) — persists across files
  const [commentPanelOpen, setCommentPanelOpen] = useState(false);

  // Notification click-through: if NavigationContext stashed a pending file
  // (from a Figma @-mention notification), open it in the in-app viewer.
  // Only consume once per mount to avoid loops.
  useEffect(() => {
    if (!consumePendingFigmaFile) return;
    const f = consumePendingFigmaFile();
    if (f?.fileKey) {
      setViewingFile({ key: f.fileKey, name: f.fileName || "Figma file" });
    }
  }, [consumePendingFigmaFile]);

  // File cache: projectId → { name, files }
  const fileCacheRef = useRef({});

  // ── Load projects on mount ──
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingProjects(true);
      setProjectError(null);
      try {
        const res = await getFigmaProjects();
        if (cancelled) return;
        setProjects(res.projects || []);
        if (res.projects?.length > 0) {
          setSelectedProject(res.projects[0].id);
        }
      } catch (err) {
        if (!cancelled) setProjectError(err.message || "Failed to load projects");
      } finally {
        if (!cancelled) setLoadingProjects(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ── Load files when project changes ──
  useEffect(() => {
    if (!selectedProject) return;
    let cancelled = false;

    const cached = fileCacheRef.current[selectedProject];
    if (cached) {
      setFiles(cached.files);
      setProjectName(cached.name);
      setLoadingFiles(false);
      return;
    }

    (async () => {
      setLoadingFiles(true);
      setFileError(null);
      setFiles([]);
      setSelectedFile(null);
      setFileDetail(null);
      setSelected(new Set());
      try {
        const res = await getFigmaFiles(selectedProject);
        if (cancelled) return;
        const fileList = res.files || [];
        setFiles(fileList);
        setProjectName(res.name || "");
        fileCacheRef.current[selectedProject] = { name: res.name, files: fileList };
      } catch (err) {
        if (!cancelled) setFileError(err.message || "Failed to load files");
      } finally {
        if (!cancelled) setLoadingFiles(false);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedProject]);

  // ── Load file detail ──
  const openFileDetail = useCallback(async (file) => {
    setSelectedFile(file);
    setLoadingDetail(true);
    try {
      const res = await getFigmaFile(file.key);
      setFileDetail(res);
    } catch {
      setFileDetail(null);
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  // ── Selection toggle ──
  const toggleSelect = useCallback((fileKey, e) => {
    e.stopPropagation();
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(fileKey)) next.delete(fileKey);
      else next.add(fileKey);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelected(new Set(filteredFiles.map((f) => f.key)));
  }, [files, search]);

  const clearSelection = useCallback(() => {
    setSelected(new Set());
  }, []);

  // ── Import ──
  const handleImport = useCallback(async () => {
    if (selected.size === 0) return;
    setImporting(true);
    setImportResult(null);
    try {
      const filesToImport = files
        .filter((f) => selected.has(f.key))
        .map((f) => ({
          key: f.key,
          name: f.name,
          thumbnail_url: f.thumbnail_url,
          last_modified: f.last_modified,
          projectName: projectName,
        }));

      const res = await importFigmaFiles(filesToImport);
      setImportResult(res);
      setSelected(new Set());
    } catch (err) {
      setImportResult({ error: err.message || "Import failed" });
    } finally {
      setImporting(false);
    }
  }, [selected, files, projectName]);

  // ── Filtered files ──
  const filteredFiles = search
    ? files.filter((f) => f.name.toLowerCase().includes(search.toLowerCase()))
    : files;

  // ── In-app viewer: escape-to-close ──
  useEffect(() => {
    if (!viewingFile) return;
    const handler = (e) => { if (e.key === "Escape") setViewingFile(null); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [viewingFile]);

  // ── In-app viewer: sign-in hint after 4s ──
  useEffect(() => {
    setViewerHintDismissed(false);
    setViewerHintVisible(false);
    if (!viewingFile) return;
    const t = setTimeout(() => setViewerHintVisible(true), 4000);
    return () => clearTimeout(t);
  }, [viewingFile]);

  // ── Takeover: in-app viewer ──
  if (viewingFile) {
    const embedSrc = `https://www.figma.com/embed?embed_host=wasabi-platform&url=${encodeURIComponent(`https://www.figma.com/file/${viewingFile.key}`)}`;
    return (
      <div style={{
        flex: 1, display: "flex", flexDirection: "column", fontFamily: FONT,
        color: C.darkText, overflow: "hidden", height: "100%", background: C.dark,
      }}>
        {/* Header strip */}
        <div style={{
          height: 48, flexShrink: 0, display: "flex", alignItems: "center",
          gap: 12, padding: "0 16px",
          borderBottom: `1px solid ${C.darkBorder}`, background: C.darkSurf,
        }}>
          <FigmaIcon size={16} />
          <div style={{
            flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {viewingFile.name}
          </div>
          <button
            onClick={() => setCommentPanelOpen((v) => !v)}
            style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "6px 14px", fontSize: 12, fontWeight: 600, fontFamily: FONT,
              background: C.accent, color: "#fff",
              border: "none", borderRadius: RADIUS.pill,
              cursor: "pointer", outline: "none",
              boxShadow: commentPanelOpen
                ? `inset 0 0 0 2px ${C.dark}33, 0 1px 2px rgba(0,0,0,0.2)`
                : "0 1px 2px rgba(0,0,0,0.2)",
              transition: "box-shadow 0.12s, filter 0.12s",
              filter: commentPanelOpen ? "brightness(0.9)" : "none",
            }}
            title={commentPanelOpen ? "Hide comments" : "Show comments"}
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
              <path d="M2 3h12v8H5l-3 3V3z" stroke="currentColor" strokeWidth="1.5" fill="none" />
            </svg>
            Comments
          </button>
          <a
            href={`https://www.figma.com/design/${viewingFile.key}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "6px 12px", fontSize: 12, fontWeight: 500, fontFamily: FONT,
              background: "transparent", color: C.darkMuted,
              border: `1px solid ${C.darkBorder}`, borderRadius: RADIUS.pill,
              textDecoration: "none", cursor: "pointer",
            }}
            title="Open this file in Figma"
          >
            Open in Figma
          </a>
          <button
            onClick={() => setViewingFile(null)}
            title="Close (Esc)"
            aria-label="Close in-app viewer"
            style={{
              width: 32, height: 32, display: "flex", alignItems: "center",
              justifyContent: "center", borderRadius: RADIUS.pill,
              background: "transparent", border: `1px solid ${C.darkBorder}`,
              color: C.darkMuted, fontSize: 18, lineHeight: 1, cursor: "pointer",
              outline: "none",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = C.darkSurf2; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
          >
            &times;
          </button>
        </div>

        {/* Sign-in hint banner */}
        {viewerHintVisible && !viewerHintDismissed && (
          <div style={{
            padding: "8px 16px", background: C.accent + "12",
            borderBottom: `1px solid ${C.accent}33`, fontSize: 11,
            color: C.darkText, display: "flex", alignItems: "center", gap: 12,
          }}>
            <span style={{ flex: 1 }}>
              Seeing a Figma sign-in screen below? Sign in to Figma in another browser tab, then reload this view.
            </span>
            <button
              onClick={() => setViewerHintDismissed(true)}
              style={{
                background: "transparent", border: "none", color: C.darkMuted,
                fontSize: 16, cursor: "pointer", padding: "0 4px", outline: "none",
              }}
              aria-label="Dismiss hint"
            >
              &times;
            </button>
          </div>
        )}

        {/* Iframe + (optional) comment panel */}
        <div style={{ flex: 1, display: "flex", minHeight: 0, overflow: "hidden" }}>
          <iframe
            key={viewingFile.key}
            src={embedSrc}
            title={`Figma: ${viewingFile.name}`}
            allow="clipboard-write; fullscreen"
            allowFullScreen
            style={{ flex: 1, minWidth: 0, border: "none", background: C.dark }}
          />
          {commentPanelOpen && (
            <FigmaCommentPanel
              fileKey={viewingFile.key}
              fileName={viewingFile.name}
              onClose={() => setCommentPanelOpen(false)}
            />
          )}
        </div>
      </div>
    );
  }

  // ── Render ──
  return (
    <div style={{
      flex: 1, display: "flex", flexDirection: "column", fontFamily: FONT,
      color: C.darkText, overflow: "hidden", height: "100%",
    }}>
      <PanelHeader
        side="right"
        title="Figma"
        icon={<FigmaIcon size={18} />}
      />
      <div style={{ flex: 1, display: "flex", overflow: "hidden", minHeight: 0 }}>
      {/* ── Project Sidebar ── */}
      <div style={{
        width: 220, flexShrink: 0, borderRight: `1px solid ${C.darkBorder}`,
        display: "flex", flexDirection: "column", background: C.darkSurf,
        overflowY: "auto",
      }}>
        <div style={{
          padding: "16px 14px 10px", fontSize: 10, fontWeight: 700,
          textTransform: "uppercase", letterSpacing: "0.08em", color: C.darkMuted,
          display: "flex", alignItems: "center", gap: 6,
        }}>
          <FigmaIcon size={14} />
          Projects
        </div>

        {loadingProjects && (
          <div style={{ padding: "20px 14px", fontSize: 12, color: C.darkMuted }}>
            Loading projects...
          </div>
        )}

        {projectError && (
          <div style={{
            margin: "8px 10px", padding: "10px 12px", fontSize: 11, color: C.error,
            background: C.error + "12", borderRadius: RADIUS.md, lineHeight: 1.4,
          }}>
            {projectError}
          </div>
        )}

        {!loadingProjects && !projectError && projects.length === 0 && (
          <div style={{ padding: "20px 14px", fontSize: 12, color: C.darkMuted, lineHeight: 1.5 }}>
            No projects found. Check your Figma Team ID in Settings.
          </div>
        )}

        {projects.map((p) => (
          <button
            key={p.id}
            onClick={() => setSelectedProject(p.id)}
            style={{
              display: "block", width: "100%", textAlign: "left",
              padding: "8px 14px", fontSize: 13, fontFamily: FONT,
              background: selectedProject === p.id ? C.accent + "18" : "transparent",
              color: selectedProject === p.id ? C.accent : C.darkText,
              border: "none", cursor: "pointer",
              borderLeft: selectedProject === p.id ? `2px solid ${C.accent}` : "2px solid transparent",
              transition: "background 0.12s, color 0.12s",
            }}
            onMouseEnter={(e) => {
              if (selectedProject !== p.id) e.target.style.background = C.darkSurf2;
            }}
            onMouseLeave={(e) => {
              if (selectedProject !== p.id) e.target.style.background = "transparent";
            }}
          >
            {p.name}
          </button>
        ))}
      </div>

      {/* ── Main Content ── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* Header bar */}
        <div style={{
          padding: "12px 20px", borderBottom: `1px solid ${C.darkBorder}`,
          display: "flex", alignItems: "center", gap: 12, flexShrink: 0,
        }}>
          <span style={{ fontSize: 15, fontWeight: 600, flex: 1 }}>
            {projectName || "Select a project"}
          </span>

          {/* Selection actions */}
          {filteredFiles.length > 0 && (
            <button
              onClick={selected.size === filteredFiles.length ? clearSelection : selectAll}
              style={{
                background: "transparent", border: `1px solid ${C.darkBorder}`,
                borderRadius: RADIUS.sm, padding: "4px 10px", fontSize: 11,
                fontFamily: FONT, color: C.darkMuted, cursor: "pointer",
              }}
            >
              {selected.size === filteredFiles.length ? "Deselect All" : "Select All"}
            </button>
          )}

          {selected.size > 0 && (
            <button
              onClick={handleImport}
              disabled={importing}
              style={{
                background: importing ? C.darkSurf2 : C.accent,
                border: "none", borderRadius: RADIUS.pill,
                padding: "5px 14px", fontSize: 12, fontWeight: 600,
                fontFamily: FONT, color: "#fff", cursor: importing ? "wait" : "pointer",
                opacity: importing ? 0.6 : 1,
                display: "flex", alignItems: "center", gap: 6,
              }}
            >
              {importing ? "Importing..." : `Import ${selected.size} file${selected.size > 1 ? "s" : ""}`}
            </button>
          )}

          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter files..."
            style={{
              width: 200, background: C.dark,
              border: `1px solid ${C.darkBorder}`, borderRadius: RADIUS.pill,
              padding: "6px 12px", fontSize: 12, fontFamily: FONT,
              color: C.darkText, outline: "none",
            }}
            onFocus={(e) => { e.target.style.borderColor = C.accent; }}
            onBlur={(e) => { e.target.style.borderColor = C.darkBorder; }}
          />
        </div>

        {/* Import result toast */}
        {importResult && (
          <div style={{
            margin: "8px 20px 0", padding: "10px 14px", fontSize: 12, lineHeight: 1.4,
            borderRadius: RADIUS.md,
            background: importResult.error ? C.error + "15" : C.accent + "15",
            color: importResult.error ? C.error : C.accent,
            display: "flex", alignItems: "center", justifyContent: "space-between",
          }}>
            <span>
              {importResult.error
                ? `Import failed: ${importResult.error}`
                : `Imported ${importResult.imported} file${importResult.imported !== 1 ? "s" : ""}${importResult.skipped > 0 ? ` (${importResult.skipped} already existed)` : ""}`
              }
            </span>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              {importResult.pageId && (
                <button
                  onClick={() => setActiveRightPane(importResult.pageId)}
                  style={{
                    background: C.accent, color: "#fff", border: "none",
                    borderRadius: RADIUS.sm, padding: "3px 10px", fontSize: 11,
                    fontWeight: 600, fontFamily: FONT, cursor: "pointer",
                  }}
                >
                  Open Design Assets
                </button>
              )}
              <button
                onClick={() => setImportResult(null)}
                style={{
                  background: "none", border: "none", cursor: "pointer",
                  color: importResult.error ? C.error : C.accent, fontSize: 14,
                }}
              >
                &times;
              </button>
            </div>
          </div>
        )}

        {/* File grid + detail */}
        <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
          {/* File grid */}
          <div style={{
            flex: 1, overflowY: "auto", padding: 20,
            display: "flex", flexWrap: "wrap", gap: 16,
            alignContent: "flex-start",
          }}>
            {loadingFiles && (
              <div style={{ width: "100%", padding: 40, textAlign: "center", fontSize: 13, color: C.darkMuted }}>
                Loading files...
              </div>
            )}

            {fileError && (
              <div style={{
                width: "100%", margin: "20px 0", padding: "14px 16px",
                fontSize: 12, color: C.error, background: C.error + "12",
                borderRadius: RADIUS.md, lineHeight: 1.4,
              }}>
                {fileError}
              </div>
            )}

            {!loadingFiles && !fileError && filteredFiles.length === 0 && selectedProject && (
              <div style={{ width: "100%", padding: 40, textAlign: "center", fontSize: 13, color: C.darkMuted }}>
                {search ? "No files match your filter." : "No files in this project."}
              </div>
            )}

            {!loadingFiles && filteredFiles.map((f) => {
              const isSelected = selected.has(f.key);
              return (
                <div
                  key={f.key}
                  onClick={() => openFileDetail(f)}
                  style={{
                    width: 200, cursor: "pointer", position: "relative",
                    background: C.darkSurf,
                    border: `1px solid ${isSelected ? C.accent : selectedFile?.key === f.key ? C.accent : C.darkBorder}`,
                    borderRadius: RADIUS.lg,
                    overflow: "hidden",
                    transition: "border-color 0.15s, box-shadow 0.15s",
                    boxShadow: isSelected ? `0 0 0 1px ${C.accent}40` : selectedFile?.key === f.key ? `0 0 0 1px ${C.accent}40` : "none",
                  }}
                  onMouseEnter={(e) => {
                    if (!isSelected && selectedFile?.key !== f.key) e.currentTarget.style.borderColor = C.darkMuted;
                  }}
                  onMouseLeave={(e) => {
                    if (!isSelected && selectedFile?.key !== f.key) e.currentTarget.style.borderColor = C.darkBorder;
                  }}
                >
                  {/* Selection checkbox */}
                  <div
                    onClick={(e) => toggleSelect(f.key, e)}
                    style={{
                      position: "absolute", top: 8, left: 8, zIndex: 2,
                      width: 22, height: 22, borderRadius: RADIUS.sm,
                      background: isSelected ? C.accent : C.dark + "CC",
                      border: `1.5px solid ${isSelected ? C.accent : C.darkBorder}`,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      cursor: "pointer", transition: "background 0.12s",
                    }}
                  >
                    {isSelected && <CheckIcon size={14} />}
                  </div>

                  {/* Thumbnail */}
                  <div style={{
                    width: "100%", height: 130, background: C.dark,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    overflow: "hidden",
                  }}>
                    {f.thumbnail_url ? (
                      <img
                        src={f.thumbnail_url}
                        alt={f.name}
                        style={{ width: "100%", height: "100%", objectFit: "cover" }}
                        loading="lazy"
                      />
                    ) : (
                      <FigmaIcon size={32} />
                    )}
                  </div>
                  {/* Info */}
                  <div style={{ padding: "10px 12px" }}>
                    <div style={{
                      fontSize: 12, fontWeight: 600, color: C.darkText,
                      whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                    }}>
                      {f.name}
                    </div>
                    <div style={{ fontSize: 10, color: C.darkMuted, marginTop: 4 }}>
                      {formatRelative(f.last_modified)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* File detail panel */}
          {selectedFile && (
            <div style={{
              width: 280, flexShrink: 0, borderLeft: `1px solid ${C.darkBorder}`,
              background: C.darkSurf, overflowY: "auto", padding: "16px 14px",
              display: "flex", flexDirection: "column", gap: 14,
            }}>
              {/* Close button */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: C.darkMuted }}>
                  File Details
                </span>
                <button
                  onClick={() => { setSelectedFile(null); setFileDetail(null); }}
                  style={{
                    background: "none", border: "none", cursor: "pointer",
                    color: C.darkMuted, fontSize: 16, padding: "2px 6px",
                  }}
                >
                  &times;
                </button>
              </div>

              {/* Thumbnail */}
              {selectedFile.thumbnail_url && (
                <div style={{
                  width: "100%", borderRadius: RADIUS.md, overflow: "hidden",
                  border: `1px solid ${C.darkBorder}`,
                }}>
                  <img
                    src={selectedFile.thumbnail_url}
                    alt={selectedFile.name}
                    style={{ width: "100%", display: "block" }}
                  />
                </div>
              )}

              {/* Name */}
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.3 }}>
                  {selectedFile.name}
                </div>
                <div style={{ fontSize: 11, color: C.darkMuted, marginTop: 4 }}>
                  Modified {formatRelative(selectedFile.last_modified)}
                </div>
              </div>

              {/* Open buttons */}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  onClick={() => setViewingFile(selectedFile)}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 6,
                    padding: "7px 14px", fontSize: 12, fontWeight: 600, fontFamily: FONT,
                    background: C.accent, color: "#fff", borderRadius: RADIUS.pill,
                    border: "none", cursor: "pointer", outline: "none",
                  }}
                  title="View this file inside Wasabi"
                >
                  <FigmaIcon size={13} />
                  Open in App
                </button>
                <a
                  href={`https://www.figma.com/design/${selectedFile.key}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 6,
                    padding: "7px 14px", fontSize: 12, fontWeight: 600, fontFamily: FONT,
                    background: "transparent", color: C.darkText,
                    border: `1px solid ${C.darkBorder}`, borderRadius: RADIUS.pill,
                    textDecoration: "none", cursor: "pointer",
                  }}
                >
                  Open in Figma
                </a>
              </div>

              {/* Pages */}
              {loadingDetail && (
                <div style={{ fontSize: 11, color: C.darkMuted }}>Loading details...</div>
              )}
              {fileDetail?.pages && fileDetail.pages.length > 0 && (
                <div>
                  <div style={{
                    fontSize: 10, fontWeight: 700, textTransform: "uppercase",
                    letterSpacing: "0.08em", color: C.darkMuted, marginBottom: 6,
                  }}>
                    Pages ({fileDetail.pages.length})
                  </div>
                  {fileDetail.pages.map((page) => (
                    <div key={page.id} style={{
                      fontSize: 12, color: C.darkText, padding: "4px 0",
                      borderBottom: `1px solid ${C.edgeLine}`,
                    }}>
                      {page.name}
                    </div>
                  ))}
                </div>
              )}

              {/* Version */}
              {fileDetail?.version && (
                <div style={{ fontSize: 11, color: C.darkMuted }}>
                  Version: {fileDetail.version}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      </div>
    </div>
  );
}
