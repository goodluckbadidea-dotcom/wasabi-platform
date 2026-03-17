// ─── Zen Notes ───
// Full block editor scratchpad for Zen mode.
// Uses DocumentEditor in standalone mode with R2 storage.
// "Save to" copies the scratchpad into a new page.

import React, { useState, useCallback, useMemo } from "react";
import { C, FONT, RADIUS } from "../design/tokens.js";
import { ANIM } from "../design/animations.js";
import { usePlatform } from "../context/PlatformContext.jsx";
import { getDocument, saveDocument } from "../lib/api.js";
import { createStandaloneDocConfig, savePageConfig } from "../config/pageConfig.js";
import DocumentEditor from "../views/DocumentEditor.jsx";

const DOC_ID = "scratchpad";

const PAGE_CONFIG = { id: DOC_ID, standalone: true };

export default function NotesView() {
  const { addPage, folders } = usePlatform();

  const [resetKey, setResetKey] = useState(0);
  const [saveToOpen, setSaveToOpen] = useState(false);
  const [saveToName, setSaveToName] = useState("");
  const [saveToFolder, setSaveToFolder] = useState("");
  const [saveToStatus, setSaveToStatus] = useState(null); // "saving" | "done" | "error"

  // ── Clear note (resets editor via key change) ──
  const handleClear = useCallback(async () => {
    if (!window.confirm("Clear this note? This cannot be undone.")) return;
    try {
      await saveDocument(DOC_ID, { version: 1, blocks: [], word_count: 0 });
    } catch (err) {
      console.warn("[ZenNotes] Clear failed:", err);
    }
    setResetKey((k) => k + 1);
  }, []);

  // ── Save to page tree ──
  const handleSaveTo = useCallback(async () => {
    const name = saveToName.trim();
    if (!name || saveToStatus === "saving") return;

    setSaveToStatus("saving");
    try {
      // Create a standalone document page config
      const config = createStandaloneDocConfig(name, "page");
      if (saveToFolder) config.parentId = saveToFolder;

      // Save page config to D1
      const id = await savePageConfig(config);
      config.id = id;

      // Copy current scratchpad content to the new document
      const doc = await getDocument(DOC_ID);
      if (doc?.content) {
        await saveDocument(id, doc.content);
      }

      // Add to page tree
      addPage(config);

      setSaveToStatus("done");
      setTimeout(() => {
        setSaveToOpen(false);
        setSaveToStatus(null);
        setSaveToName("");
        setSaveToFolder("");
      }, 1200);
    } catch (err) {
      console.error("[ZenNotes] Save to failed:", err);
      setSaveToStatus("error");
      setTimeout(() => setSaveToStatus(null), 2000);
    }
  }, [saveToName, saveToFolder, saveToStatus, addPage]);

  // ── Folder options for Save To ──
  const folderOptions = useMemo(() => {
    return (folders || []).map((f) => ({
      id: f.id,
      name: f.name || "Untitled Folder",
    }));
  }, [folders]);

  return (
    <div style={{
      flex: 1, display: "flex", flexDirection: "column",
      overflow: "hidden", background: C.dark,
    }}>
      {/* ── Header ── */}
      <div style={{
        flexShrink: 0, padding: "14px 20px 12px",
        borderBottom: `1px solid ${C.darkBorder}`,
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <div style={{
          fontSize: 18, fontWeight: 600, fontFamily: FONT, color: C.darkText,
          display: "flex", alignItems: "center", gap: 10,
          animation: ANIM.snapUp(0.03),
        }}>
          <svg width="20" height="20" viewBox="0 0 16 16" fill="none">
            <rect x="3" y="2" width="10" height="12" rx="1.5" stroke={C.accent} strokeWidth="1.3" fill="none" />
            <line x1="5.5" y1="5.5" x2="10.5" y2="5.5" stroke={C.accent} strokeWidth="1" />
            <line x1="5.5" y1="8" x2="10.5" y2="8" stroke={C.accent} strokeWidth="1" />
            <line x1="5.5" y1="10.5" x2="8.5" y2="10.5" stroke={C.accent} strokeWidth="1" />
          </svg>
          Notes
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {/* Save To button */}
          <button
            onClick={() => {
              setSaveToOpen((v) => !v);
              setSaveToName("");
              setSaveToFolder("");
              setSaveToStatus(null);
            }}
            title="Save note to workspace"
            style={{
              background: saveToOpen ? C.accent + "22" : "transparent",
              border: `1px solid ${saveToOpen ? C.accent + "44" : C.darkBorder}`,
              borderRadius: RADIUS.md,
              padding: "6px 12px",
              fontSize: 11, fontFamily: FONT,
              minHeight: 30,
              color: saveToOpen ? C.accent : C.darkMuted,
              cursor: "pointer", outline: "none",
              display: "flex", alignItems: "center", gap: 4,
              transition: "all 0.15s",
            }}
          >
            <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
              <path d="M2 10V2h5.5L10 4.5V10H2z" stroke="currentColor" strokeWidth="1.2" fill="none" />
              <path d="M4 2v3h4" stroke="currentColor" strokeWidth="1" fill="none" />
            </svg>
            Save to
          </button>

          {/* Clear button */}
          <button
            onClick={handleClear}
            title="Clear note"
            style={{
              background: "none", border: "none", cursor: "pointer",
              padding: 8, display: "flex", opacity: 0.4,
              outline: "none", borderRadius: RADIUS.md,
              transition: "opacity 0.15s",
              minWidth: 30, minHeight: 30,
              alignItems: "center", justifyContent: "center",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.opacity = "0.8"; }}
            onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.4"; }}
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
              <path d="M4 4l8 8M12 4l-8 8" stroke={C.darkMuted} strokeWidth="1.3" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>

      {/* ── Save To panel (inline below header) ── */}
      {saveToOpen && (
        <div style={{
          flexShrink: 0, padding: "8px 14px",
          borderBottom: `1px solid ${C.darkBorder}`,
          display: "flex", alignItems: "center", gap: 8,
          background: C.darkSurf + "80",
        }}>
          <input
            autoFocus
            value={saveToName}
            onChange={(e) => setSaveToName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleSaveTo(); if (e.key === "Escape") setSaveToOpen(false); }}
            placeholder="Page name..."
            style={{
              flex: 1, background: C.darkSurf2, border: `1px solid ${C.darkBorder}`,
              borderRadius: RADIUS.md, padding: "7px 10px",
              fontSize: 12, fontFamily: FONT, color: C.darkText,
              outline: "none", minWidth: 0,
            }}
          />

          {folderOptions.length > 0 && (
            <select
              value={saveToFolder}
              onChange={(e) => setSaveToFolder(e.target.value)}
              style={{
                background: C.darkSurf2, border: `1px solid ${C.darkBorder}`,
                borderRadius: RADIUS.md, padding: "7px 8px",
                fontSize: 11, fontFamily: FONT, color: C.darkText,
                outline: "none", maxWidth: 140,
              }}
            >
              <option value="">No folder</option>
              {folderOptions.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          )}

          <button
            onClick={handleSaveTo}
            disabled={!saveToName.trim() || saveToStatus === "saving"}
            style={{
              background: saveToStatus === "done" ? "#2A6B38" : C.accent,
              color: "#fff", border: "none", borderRadius: RADIUS.md,
              padding: "7px 14px", fontSize: 11, fontFamily: FONT,
              fontWeight: 600, cursor: saveToName.trim() && saveToStatus !== "saving" ? "pointer" : "default",
              opacity: saveToName.trim() && saveToStatus !== "saving" ? 1 : 0.4,
              outline: "none", whiteSpace: "nowrap",
              transition: "background 0.2s",
            }}
          >
            {saveToStatus === "saving" ? "..." : saveToStatus === "done" ? "Saved!" : saveToStatus === "error" ? "Failed" : "Save"}
          </button>
        </div>
      )}

      {/* ── Document Editor ── */}
      <div style={{ flex: 1, overflow: "hidden" }}>
        <DocumentEditor key={resetKey} pageConfig={PAGE_CONFIG} />
      </div>
    </div>
  );
}
