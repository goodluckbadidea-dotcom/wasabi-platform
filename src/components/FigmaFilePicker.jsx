// ─── Figma File Picker ───
// Multi-select picker used by the `figma_files` cell type. Re-uses the
// worker-proxied Figma listing endpoints (getFigmaProjects / getFigmaFiles)
// so the cell type works for any user whose workspace has Figma connected,
// regardless of their personal Figma login state.
//
// Modal layout: projects sidebar on the left, file thumbnail grid on the
// right. Selected files render with a green check overlay. Confirm
// commits the array shape that figma_files cells store directly:
//   [{ file_key, file_name, thumbnail_url }, ...]

import React, { useEffect, useState, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { C, FONT, RADIUS, SHADOW, Z } from "../design/tokens.js";
import { IconFigma, IconClose } from "../design/icons.jsx";
import { getFigmaProjects, getFigmaFiles } from "../lib/api.js";

export default function FigmaFilePicker({
  open,
  existing = [],            // current value of the cell (so we can show existing as pre-selected)
  onConfirm,                // (newValue: array) => void — replaces the cell value entirely
  onCancel,
  title = "Pick Figma files",
}) {
  const [projects, setProjects] = useState([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [projectsError, setProjectsError] = useState(null);
  const [selectedProject, setSelectedProject] = useState(null);

  const [files, setFiles] = useState([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [filesError, setFilesError] = useState(null);
  const filesCacheRef = useMemo(() => ({ current: {} }), []);

  const [search, setSearch] = useState("");

  // Selection state — keyed by file_key for stable dedup. Pre-seed from existing.
  const [selected, setSelected] = useState(() => {
    const m = new Map();
    for (const f of existing || []) {
      if (f?.file_key) m.set(f.file_key, f);
    }
    return m;
  });

  // Re-seed selection if `existing` changes between opens of the same picker.
  useEffect(() => {
    if (!open) return;
    const m = new Map();
    for (const f of existing || []) {
      if (f?.file_key) m.set(f.file_key, f);
    }
    setSelected(m);
  }, [open, existing]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setProjectsLoading(true);
    setProjectsError(null);
    getFigmaProjects()
      .then((res) => {
        if (cancelled) return;
        setProjects(res?.projects || []);
        if (res?.projects?.length && selectedProject == null) {
          setSelectedProject(res.projects[0].id);
        }
      })
      .catch((err) => {
        if (!cancelled) setProjectsError(err?.message || "Failed to load projects");
      })
      .finally(() => { if (!cancelled) setProjectsLoading(false); });
    return () => { cancelled = true; };
  }, [open]);  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open || !selectedProject) return;
    const cached = filesCacheRef.current[selectedProject];
    if (cached) {
      setFiles(cached);
      return;
    }
    let cancelled = false;
    setFilesLoading(true);
    setFilesError(null);
    setFiles([]);
    getFigmaFiles(selectedProject)
      .then((res) => {
        if (cancelled) return;
        const list = res?.files || [];
        filesCacheRef.current[selectedProject] = list;
        setFiles(list);
      })
      .catch((err) => {
        if (!cancelled) setFilesError(err?.message || "Failed to load files");
      })
      .finally(() => { if (!cancelled) setFilesLoading(false); });
    return () => { cancelled = true; };
  }, [open, selectedProject, filesCacheRef]);

  const filteredFiles = useMemo(() => {
    if (!search.trim()) return files;
    const q = search.toLowerCase();
    return files.filter((f) => f.name?.toLowerCase().includes(q));
  }, [files, search]);

  const toggle = useCallback((file) => {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(file.key)) {
        next.delete(file.key);
      } else {
        next.set(file.key, {
          file_key: file.key,
          file_name: file.name || "",
          thumbnail_url: file.thumbnail_url || "",
        });
      }
      return next;
    });
  }, []);

  const handleConfirm = useCallback(() => {
    const arr = Array.from(selected.values());
    onConfirm?.(arr);
  }, [selected, onConfirm]);

  if (!open) return null;

  return createPortal((
    <div
      style={{
        position: "fixed", inset: 0, background: C.overlayBg, zIndex: Z.modal,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontFamily: FONT,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onCancel?.(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="figma-file-picker-title"
        style={{
          width: "90vw", maxWidth: 900, height: "80vh", maxHeight: 700,
          background: C.darkSurf, border: `1px solid ${C.darkBorder}`,
          borderRadius: RADIUS.xl, boxShadow: SHADOW.dropdown,
          display: "flex", flexDirection: "column", overflow: "hidden",
        }}
      >
        {/* Header */}
        <div style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "14px 20px", borderBottom: `1px solid ${C.darkBorder}`,
        }}>
          <IconFigma size={16} />
          <div id="figma-file-picker-title" style={{ flex: 1, fontSize: 14, fontWeight: 600 }}>
            {title}
          </div>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter files…"
            style={{
              background: C.darkSurf2, border: `1px solid ${C.darkBorder}`,
              borderRadius: RADIUS.pill, padding: "5px 12px", fontSize: 12,
              fontFamily: FONT, color: C.darkText, outline: "none",
              width: 200,
            }}
          />
          <button
            onClick={onCancel}
            aria-label="Close picker"
            style={{
              width: 28, height: 28, display: "inline-flex", alignItems: "center",
              justifyContent: "center", padding: 0,
              borderRadius: RADIUS.pill,
              background: "transparent", border: `1px solid ${C.darkBorder}`,
              color: C.darkMuted, cursor: "pointer", outline: "none",
            }}
          >
            <IconClose size={12} color={C.darkMuted} />
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
          {/* Projects sidebar */}
          <div style={{
            width: 200, flexShrink: 0, borderRight: `1px solid ${C.darkBorder}`,
            display: "flex", flexDirection: "column", overflowY: "auto",
            background: C.dark,
          }}>
            <div style={{
              padding: "10px 14px 6px", fontSize: 10, fontWeight: 700,
              textTransform: "uppercase", letterSpacing: "0.06em", color: C.darkMuted,
            }}>
              Projects
            </div>
            {projectsLoading && (
              <div style={{ padding: "8px 14px", fontSize: 11, color: C.darkMuted }}>Loading…</div>
            )}
            {projectsError && (
              <div style={{ margin: "6px 10px", padding: "6px 10px", fontSize: 11, color: C.error, background: C.error + "12", borderRadius: RADIUS.md }}>
                {projectsError}
              </div>
            )}
            {projects.map((p) => {
              const isActive = selectedProject === p.id;
              return (
                <button
                  key={p.id}
                  onClick={() => setSelectedProject(p.id)}
                  style={{
                    display: "block", width: "100%", textAlign: "left",
                    padding: "7px 14px", fontSize: 12,
                    background: isActive ? C.accent + "18" : "transparent",
                    color: isActive ? C.accent : C.darkText,
                    border: "none", cursor: "pointer", fontFamily: FONT,
                    borderLeft: isActive ? `2px solid ${C.accent}` : "2px solid transparent",
                  }}
                  onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = C.darkSurf2; }}
                  onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = "transparent"; }}
                >
                  {p.name}
                </button>
              );
            })}
          </div>

          {/* Files grid */}
          <div style={{ flex: 1, overflowY: "auto", padding: 14, background: C.darkSurf }}>
            {filesLoading && (
              <div style={{ fontSize: 12, color: C.darkMuted }}>Loading files…</div>
            )}
            {filesError && (
              <div style={{ padding: "8px 12px", fontSize: 11, color: C.error, background: C.error + "12", borderRadius: RADIUS.md }}>
                {filesError}
              </div>
            )}
            {!filesLoading && !filesError && filteredFiles.length === 0 && (
              <div style={{ fontSize: 12, color: C.darkMuted }}>
                {search ? "No files match this filter." : "No files in this project."}
              </div>
            )}
            <div style={{
              display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
              gap: 12,
            }}>
              {filteredFiles.map((f) => {
                const isSelected = selected.has(f.key);
                return (
                  <button
                    key={f.key}
                    onClick={() => toggle(f)}
                    style={{
                      position: "relative", textAlign: "left",
                      padding: 0, background: "transparent",
                      border: `2px solid ${isSelected ? C.accent : "transparent"}`,
                      borderRadius: RADIUS.md, cursor: "pointer",
                      outline: "none", overflow: "hidden",
                      display: "flex", flexDirection: "column",
                    }}
                  >
                    <div style={{
                      width: "100%", aspectRatio: "4 / 3",
                      background: C.darkSurf2, overflow: "hidden",
                      borderRadius: RADIUS.sm,
                    }}>
                      {f.thumbnail_url ? (
                        <img
                          src={f.thumbnail_url}
                          alt={f.name}
                          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                        />
                      ) : (
                        <div style={{
                          width: "100%", height: "100%",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          color: C.darkMuted, fontSize: 11,
                        }}>
                          No preview
                        </div>
                      )}
                    </div>
                    <div style={{
                      padding: "6px 4px 2px", fontSize: 11, fontFamily: FONT,
                      color: C.darkText, fontWeight: 500, lineHeight: 1.25,
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>
                      {f.name}
                    </div>
                    {isSelected && (
                      <div
                        aria-hidden
                        style={{
                          position: "absolute", top: 6, right: 6,
                          width: 22, height: 22, borderRadius: "50%",
                          background: C.accent, color: "#fff",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          fontSize: 13, fontWeight: 700, boxShadow: "0 1px 2px rgba(0,0,0,0.3)",
                        }}
                      >
                        ✓
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={{
          flexShrink: 0, display: "flex", alignItems: "center",
          gap: 8, padding: "12px 16px",
          borderTop: `1px solid ${C.darkBorder}`, background: C.dark,
        }}>
          <span style={{ flex: 1, fontSize: 11, color: C.darkMuted }}>
            {selected.size} selected
          </span>
          <button
            onClick={onCancel}
            style={{
              padding: "7px 14px", fontSize: 12, fontFamily: FONT, fontWeight: 500,
              background: "transparent", color: C.darkText,
              border: `1px solid ${C.darkBorder}`, borderRadius: RADIUS.pill,
              cursor: "pointer", outline: "none",
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            style={{
              padding: "7px 16px", fontSize: 12, fontFamily: FONT, fontWeight: 600,
              background: C.accent, color: "#fff", border: "none",
              borderRadius: RADIUS.pill, cursor: "pointer", outline: "none",
            }}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  ), document.body);
}
