// ─── Search Modal ───
// Centered modal opened from the bottom bar's search button.
// Searches pages by name and database records by title.
// Replaces the inline sidebar search field.

import React, { useState, useEffect, useRef, useMemo } from "react";
import { C, FONT, RADIUS, SHADOW, Z } from "../design/tokens.js";
import { ANIM } from "../design/animations.js";
import { usePlatform } from "../context/PlatformContext.jsx";
import { searchRecords } from "../lib/api.js";
import { IconSearch } from "../design/icons.jsx";

export default function SearchModal({ open, onClose }) {
  const { pages, setActiveRightPane } = usePlatform();
  const [query, setQuery] = useState("");
  const [dbResults, setDbResults] = useState([]); // { pageId, pageName, rowId, title, tableId }
  const [searching, setSearching] = useState(false);
  const inputRef = useRef(null);
  const dbSearchTimer = useRef(null);

  // Focus input on open
  useEffect(() => {
    if (open && inputRef.current) {
      // Small delay so the focus lands after mount animation
      const t = setTimeout(() => inputRef.current?.focus(), 30);
      return () => clearTimeout(t);
    }
  }, [open]);

  // Reset query when reopened
  useEffect(() => {
    if (!open) {
      setQuery("");
      setDbResults([]);
      setSearching(false);
    }
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (e.key === "Escape") onClose?.(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  // ── Page name results (synchronous) ──
  const pageResults = useMemo(() => {
    if (!query || query.length < 1) return [];
    const q = query.toLowerCase();
    return pages
      .filter((p) => !p._systemInternal && p.name?.toLowerCase().includes(q))
      .slice(0, 10);
  }, [query, pages]);

  // ── Debounced database record search ──
  // Delegates to the worker's /search/records endpoint, which resolves each
  // table's title cell from the schema and matches server-side. No per-table
  // round-trips, no 500-row cap, no fallback-cell guessing.
  useEffect(() => {
    if (dbSearchTimer.current) clearTimeout(dbSearchTimer.current);
    if (!query || query.length < 2) {
      setDbResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    let cancelled = false;
    dbSearchTimer.current = setTimeout(async () => {
      try {
        const resp = await searchRecords(query, { limit: 50 });
        if (cancelled) return;
        setDbResults(resp?.results || []);
      } catch (err) {
        console.error("[SearchModal] DB search error:", err);
        if (!cancelled) setDbResults([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      if (dbSearchTimer.current) clearTimeout(dbSearchTimer.current);
    };
  }, [query]);

  if (!open) return null;

  const handlePageClick = (pageId) => {
    setActiveRightPane(pageId);
    onClose?.();
  };

  const inactiveColor = C.darkText + "BB";
  const noResults =
    query.length >= 2 &&
    !searching &&
    pageResults.length === 0 &&
    dbResults.length === 0;

  return (
    <div
      onClick={() => onClose?.()}
      style={{
        position: "fixed",
        inset: 0,
        background: C.overlayBg,
        zIndex: Z.modal,
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "12vh 20px 0",
        animation: ANIM.fadeIn?.() || undefined,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Search"
        style={{
          width: "100%",
          maxWidth: 600,
          background: C.darkSurf,
          border: `1px solid ${C.darkBorder}`,
          borderRadius: RADIUS.xl,
          boxShadow: SHADOW.dropdown,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          maxHeight: "70vh",
        }}
      >
        {/* Search input */}
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "16px 18px",
          borderBottom: `1px solid ${C.darkBorder}`,
          flexShrink: 0,
        }}>
          <IconSearch size={18} color={inactiveColor} />
          <input
            ref={inputRef}
            type="text"
            placeholder="Search pages and records..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              outline: "none",
              color: C.darkText,
              fontSize: 15,
              fontFamily: FONT,
              fontWeight: 400,
            }}
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                color: inactiveColor,
                fontSize: 18,
                padding: "2px 6px",
                outline: "none",
              }}
              aria-label="Clear search"
              title="Clear"
            >
              ×
            </button>
          )}
          <kbd style={{
            background: C.darkSurf2,
            color: inactiveColor,
            padding: "3px 6px",
            borderRadius: RADIUS.sm,
            fontSize: 10,
            fontFamily: FONT,
            border: `1px solid ${C.darkBorder}`,
          }}>
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div style={{ flex: 1, overflowY: "auto", padding: query ? "8px" : "32px 18px" }}>
          {!query && (
            <div style={{
              fontSize: 12,
              color: inactiveColor,
              fontFamily: FONT,
              textAlign: "center",
              padding: "20px 0",
            }}>
              Type to search across pages and records.
            </div>
          )}

          {/* Page name matches */}
          {pageResults.length > 0 && (
            <>
              <div style={sectionHeaderStyle(inactiveColor)}>Pages</div>
              {pageResults.map((p) => (
                <button
                  key={p.id}
                  onClick={() => handlePageClick(p.id)}
                  style={resultRowStyle()}
                  onMouseEnter={(e) => { e.currentTarget.style.background = C.darkSurf2; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                >
                  <span style={{ fontSize: 13, color: C.darkText, fontFamily: FONT, fontWeight: 500 }}>
                    {p.name}
                  </span>
                </button>
              ))}
            </>
          )}

          {/* Database record matches */}
          {dbResults.length > 0 && (
            <>
              <div style={sectionHeaderStyle(inactiveColor)}>Records</div>
              {dbResults.map((r) => (
                <button
                  key={`${r.tableId}-${r.rowId}`}
                  onClick={() => handlePageClick(r.pageId)}
                  style={{ ...resultRowStyle(), flexDirection: "column", alignItems: "flex-start", gap: 2 }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = C.darkSurf2; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                >
                  <span style={{ fontSize: 13, color: C.darkText, fontFamily: FONT, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%" }}>
                    {r.title}
                  </span>
                  <span style={{ fontSize: 10, color: inactiveColor, fontFamily: FONT, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                    {r.pageName}
                  </span>
                </button>
              ))}
            </>
          )}

          {/* Searching */}
          {searching && pageResults.length === 0 && dbResults.length === 0 && (
            <div style={{ fontSize: 12, color: inactiveColor, fontFamily: FONT, textAlign: "center", padding: "20px 0" }}>
              Searching...
            </div>
          )}

          {/* No results */}
          {noResults && (
            <div style={{ fontSize: 12, color: inactiveColor, fontFamily: FONT, textAlign: "center", padding: "20px 0" }}>
              No matches for "{query}"
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function sectionHeaderStyle(color) {
  return {
    fontSize: 10,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    color,
    padding: "10px 10px 4px",
    fontFamily: FONT,
  };
}

function resultRowStyle() {
  return {
    background: "transparent",
    border: "none",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "9px 10px",
    borderRadius: RADIUS.md,
    width: "100%",
    textAlign: "left",
    transition: "background 0.12s",
    outline: "none",
  };
}
