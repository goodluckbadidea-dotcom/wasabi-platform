// ─── Zen Notes ───
// Single scratchpad for Zen mode. Markdown-ready textarea with auto-save.
// "Save to" creates a new document page in the Samurai page tree.
// Persisted in R2 via the /docs API.

import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { C, FONT, MONO, RADIUS } from "../design/tokens.js";
import { usePlatform } from "../context/PlatformContext.jsx";
import { getDocument, saveDocument } from "../lib/api.js";
import { createStandaloneDocConfig, savePageConfig } from "../config/pageConfig.js";

const DOC_ID = "zen-scratchpad";
const SAVE_DEBOUNCE = 1500; // Auto-save after 1.5s of inactivity

export default function ZenNotes() {
  const { addPage, folders } = usePlatform();

  const [content, setContent] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState(null);
  const [saveToOpen, setSaveToOpen] = useState(false);
  const [saveToName, setSaveToName] = useState("");
  const [saveToFolder, setSaveToFolder] = useState("");
  const [saveToStatus, setSaveToStatus] = useState(null); // "saving" | "done" | "error"
  const textareaRef = useRef(null);
  const debounceRef = useRef(null);

  // ── Load note on mount ──
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        // Try localStorage cache first for instant display
        const cached = localStorage.getItem("wasabi_zen_notes_cache");
        if (cached && !cancelled) {
          setContent(cached);
        }

        const result = await getDocument(DOC_ID);
        if (cancelled) return;
        const text = typeof result?.content === "string"
          ? result.content
          : (result?.blocks?.map((b) => b.text || "").join("\n") || "");
        setContent(text);
        try { localStorage.setItem("wasabi_zen_notes_cache", text); } catch {}
      } catch (err) {
        // 404 is fine — first time use, no note yet
        if (err?.status !== 404) {
          console.warn("[ZenNotes] Load failed:", err);
        }
      } finally {
        if (!cancelled) setLoaded(true);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  // ── Auto-save with debounce ──
  const persistNote = useCallback(async (text) => {
    setSaving(true);
    try {
      await saveDocument(DOC_ID, text);
      try { localStorage.setItem("wasabi_zen_notes_cache", text); } catch {}
      setLastSaved(new Date());
    } catch (err) {
      console.warn("[ZenNotes] Save failed:", err);
    } finally {
      setSaving(false);
    }
  }, []);

  const handleChange = useCallback((e) => {
    const text = e.target.value;
    setContent(text);

    // Debounced auto-save
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => persistNote(text), SAVE_DEBOUNCE);
  }, [persistNote]);

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // ── Clear note ──
  const handleClear = useCallback(() => {
    if (!content.trim()) return;
    if (!window.confirm("Clear this note? This cannot be undone.")) return;
    setContent("");
    persistNote("");
  }, [content, persistNote]);

  // ── Save to Samurai page tree ──
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

      // Save the note content as the document body
      await saveDocument(id, content);

      // Add to Samurai page tree (this also navigates to it)
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
  }, [saveToName, saveToFolder, saveToStatus, content, addPage]);

  // ── Stats ──
  const stats = useMemo(() => {
    const chars = content.length;
    const words = content.trim() ? content.trim().split(/\s+/).length : 0;
    const lines = content.split("\n").length;
    return { chars, words, lines };
  }, [content]);

  // ── Folder options for Save To ──
  const folderOptions = useMemo(() => {
    return (folders || []).map((f) => ({
      id: f.id,
      name: f.name || "Untitled Folder",
    }));
  }, [folders]);

  if (!loaded) {
    return (
      <div style={{
        flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
        color: C.darkMuted, fontFamily: FONT, fontSize: 12,
      }}>
        Loading...
      </div>
    );
  }

  return (
    <div style={{
      flex: 1, display: "flex", flexDirection: "column",
      overflow: "hidden", background: C.dark,
    }}>
      {/* ── Header ── */}
      <div style={{
        flexShrink: 0, height: 44, padding: "0 14px",
        borderBottom: `1px solid ${C.darkBorder}`,
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <div style={{
          fontSize: 13, fontWeight: 600, fontFamily: FONT, color: C.darkText,
          display: "flex", alignItems: "center", gap: 8,
        }}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <rect x="3" y="2" width="10" height="12" rx="1.5" stroke={C.darkText} strokeWidth="1.3" fill="none" />
            <line x1="5.5" y1="5.5" x2="10.5" y2="5.5" stroke={C.darkText} strokeWidth="1" />
            <line x1="5.5" y1="8" x2="10.5" y2="8" stroke={C.darkText} strokeWidth="1" />
            <line x1="5.5" y1="10.5" x2="8.5" y2="10.5" stroke={C.darkText} strokeWidth="1" />
          </svg>
          Notes
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {/* Save status indicator */}
          {saving && (
            <span style={{ fontSize: 9, fontFamily: FONT, color: C.darkMuted, opacity: 0.6 }}>
              Saving...
            </span>
          )}
          {!saving && lastSaved && (
            <span style={{ fontSize: 9, fontFamily: FONT, color: C.darkMuted, opacity: 0.4 }}>
              Saved
            </span>
          )}

          {/* Save To button */}
          <button
            onClick={() => {
              setSaveToOpen((v) => !v);
              setSaveToName("");
              setSaveToFolder("");
              setSaveToStatus(null);
            }}
            title="Save note to Samurai workspace"
            style={{
              background: saveToOpen ? C.accent + "22" : "transparent",
              border: `1px solid ${saveToOpen ? C.accent + "44" : C.darkBorder}`,
              borderRadius: RADIUS.md,
              padding: "3px 8px",
              fontSize: 10, fontFamily: FONT,
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
              padding: 4, display: "flex", opacity: content.trim() ? 0.4 : 0.15,
              outline: "none", borderRadius: RADIUS.md,
              transition: "opacity 0.15s",
            }}
            onMouseEnter={(e) => { if (content.trim()) e.currentTarget.style.opacity = "0.8"; }}
            onMouseLeave={(e) => { e.currentTarget.style.opacity = content.trim() ? "0.4" : "0.15"; }}
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
              borderRadius: RADIUS.md, padding: "4px 8px",
              fontSize: 11, fontFamily: FONT, color: C.darkText,
              outline: "none", minWidth: 0,
            }}
          />

          {folderOptions.length > 0 && (
            <select
              value={saveToFolder}
              onChange={(e) => setSaveToFolder(e.target.value)}
              style={{
                background: C.darkSurf2, border: `1px solid ${C.darkBorder}`,
                borderRadius: RADIUS.md, padding: "4px 6px",
                fontSize: 10, fontFamily: FONT, color: C.darkText,
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
              padding: "4px 10px", fontSize: 10, fontFamily: FONT,
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

      {/* ── Textarea ── */}
      <textarea
        ref={textareaRef}
        value={content}
        onChange={handleChange}
        placeholder="Start writing...&#10;&#10;Markdown formatting is supported."
        spellCheck={true}
        style={{
          flex: 1,
          width: "100%",
          background: "transparent",
          border: "none",
          outline: "none",
          resize: "none",
          padding: "16px 20px",
          fontSize: 13,
          fontFamily: MONO,
          lineHeight: 1.7,
          color: C.darkText,
          caretColor: C.accent,
          letterSpacing: "0.01em",
          tabSize: 2,
        }}
      />

      {/* ── Footer stats ── */}
      <div style={{
        flexShrink: 0, padding: "4px 14px 6px",
        borderTop: `1px solid ${C.darkBorder}`,
        fontSize: 9, fontFamily: FONT, color: C.darkMuted,
        opacity: 0.5,
        display: "flex", gap: 12,
      }}>
        <span>{stats.words} words</span>
        <span>{stats.lines} lines</span>
        <span>{stats.chars} chars</span>
      </div>
    </div>
  );
}
