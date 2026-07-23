// ─── Search Modal ───
// Centered modal opened from the bottom bar's search button.
// Searches pages by name, database records by title, and neurons (topics)
// by name + member labels. Replaces the inline sidebar search field.

import React, { useState, useEffect, useRef, useMemo } from "react";
import { C, FONT, RADIUS, SHADOW, Z } from "../design/tokens.js";
import { ANIM } from "../design/animations.js";
import { usePlatform } from "../context/PlatformContext.jsx";
import { searchRecords, searchNeurons } from "../lib/api.js";
import { fuzzySimilarity, normalizeForFuzzy, FUZZY_THRESHOLD, FUZZY_MIN_QUERY_LENGTH } from "../lib/fuzzy.js";
import { IconSearch } from "../design/icons.jsx";
import NeuronTopicDialog from "./NeuronTopicDialog.jsx";

export default function SearchModal({ open, onClose }) {
  const { pages, setActiveRightPane } = usePlatform();
  const [query, setQuery] = useState("");
  const [dbResults, setDbResults] = useState([]); // { pageId, pageName, rowId, title, tableId, archived? }
  const [topicResults, setTopicResults] = useState([]); // { id, name, memberCount, members }
  const [searching, setSearching] = useState(false);
  const [openTopic, setOpenTopic] = useState(null); // a neuron object when its dialog is open
  // Archived results are fetched alongside active ones (server splits via
  // `archived` flag), hidden by default under a collapsible.
  const [showArchived, setShowArchived] = useState(false);
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
      setTopicResults([]);
      setSearching(false);
      setOpenTopic(null);
      setShowArchived(false);
    }
  }, [open]);

  // Close on Escape — but only when no topic dialog is open. The dialog
  // captures ESC first (capture-phase listener) so this fires for the
  // outer modal only.
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (openTopic) return;
      if (e.key === "Escape") onClose?.();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose, openTopic]);

  // ── Page name results (synchronous) ──
  // Exact substring first; if that comes back light AND the query is long
  // enough, supplement with fuzzy matches sorted by similarity. Pages are
  // already in memory so this stays cheap.
  //
  // We keep archived pages in the pool but tag them with `archived: true`
  // so the render step can split into "active" and "archived" sections.
  const pageResultsAll = useMemo(() => {
    if (!query || query.length < 1) return [];
    const q = query.toLowerCase();
    const visible = pages.filter((p) => !p._systemInternal);
    const exact = visible.filter((p) => p.name?.toLowerCase().includes(q));
    const exactIds = new Set(exact.map((p) => p.id));

    const normQuery = normalizeForFuzzy(query);
    if (exact.length >= 5 || normQuery.length < FUZZY_MIN_QUERY_LENGTH) {
      return exact.slice(0, 20);
    }
    const fuzzyHits = [];
    for (const p of visible) {
      if (exactIds.has(p.id)) continue;
      const score = fuzzySimilarity(normQuery, p.name || "");
      if (score >= FUZZY_THRESHOLD) fuzzyHits.push({ page: p, score });
    }
    fuzzyHits.sort((a, b) => b.score - a.score);
    return [...exact, ...fuzzyHits.map((h) => h.page)].slice(0, 20);
  }, [query, pages]);
  const pageResults = useMemo(() => pageResultsAll.filter((p) => !p.archived_at).slice(0, 10), [pageResultsAll]);
  const archivedPageResults = useMemo(() => pageResultsAll.filter((p) => p.archived_at).slice(0, 10), [pageResultsAll]);

  // ── Debounced record + neuron search ──
  // Runs both queries in parallel against the worker. Each table's title
  // cell is resolved schema-side; neurons match name OR member labels.
  useEffect(() => {
    if (dbSearchTimer.current) clearTimeout(dbSearchTimer.current);
    if (!query || query.length < 2) {
      setDbResults([]);
      setTopicResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    let cancelled = false;
    dbSearchTimer.current = setTimeout(async () => {
      try {
        // Pull active + archived in one request. The server sets an
        // `archived` boolean on each hit; the render step splits them.
        const [recs, neus] = await Promise.all([
          searchRecords(query, { limit: 100, includeArchived: true }).catch((e) => {
            console.error("[SearchModal] record search error:", e);
            return { results: [] };
          }),
          searchNeurons(query, { limit: 20 }).catch((e) => {
            console.error("[SearchModal] neuron search error:", e);
            return { results: [] };
          }),
        ]);
        if (cancelled) return;
        setDbResults(recs?.results || []);
        setTopicResults(neus?.results || []);
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

  const handleTopicMemberNavigate = (member) => {
    if (member?.targetPageId) setActiveRightPane(member.targetPageId);
    setOpenTopic(null);
    onClose?.();
  };

  const inactiveColor = C.darkText + "BB";
  const activeDbResults = useMemo(() => dbResults.filter((r) => !r.archived), [dbResults]);
  const archivedDbResults = useMemo(() => dbResults.filter((r) => r.archived), [dbResults]);
  const archivedCount = archivedPageResults.length + archivedDbResults.length;
  const noResults =
    query.length >= 2 &&
    !searching &&
    pageResults.length === 0 &&
    activeDbResults.length === 0 &&
    topicResults.length === 0 &&
    archivedCount === 0;

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
            placeholder="Search pages, records, and topics..."
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

          {/* Database record matches (active only) */}
          {activeDbResults.length > 0 && (
            <>
              <div style={sectionHeaderStyle(inactiveColor)}>Records</div>
              {activeDbResults.map((r) => (
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

          {/* Topic (neuron) matches */}
          {topicResults.length > 0 && (
            <>
              <div style={sectionHeaderStyle(inactiveColor)}>Topics</div>
              {topicResults.map((t) => {
                const previewLabels = (t.members || []).slice(0, 3).map((m) => m.label).filter(Boolean);
                const overflow = Math.max(0, (t.memberCount || 0) - previewLabels.length);
                const previewText = previewLabels.length > 0
                  ? `${previewLabels.join(", ")}${overflow > 0 ? `, +${overflow} more` : ""}`
                  : `${t.memberCount || 0} connection${(t.memberCount || 0) === 1 ? "" : "s"}`;
                return (
                  <button
                    key={t.id}
                    onClick={() => setOpenTopic(t)}
                    style={{ ...resultRowStyle(), flexDirection: "column", alignItems: "flex-start", gap: 2 }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = C.darkSurf2; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                  >
                    <span style={{ fontSize: 13, color: C.darkText, fontFamily: FONT, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%" }}>
                      {t.name}
                    </span>
                    <span style={{ fontSize: 11, color: inactiveColor, fontFamily: FONT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%" }}>
                      {previewText}
                    </span>
                  </button>
                );
              })}
            </>
          )}

          {/* Archived (collapsible — hidden by default). Both pages and
              records land here when they have archived_at set OR belong to
              an archived page. Existing links / neurons keep resolving to
              archived items elsewhere; this section only affects search. */}
          {query.length >= 1 && archivedCount > 0 && (
            <div style={{ marginTop: 12 }}>
              <button
                onClick={() => setShowArchived((v) => !v)}
                style={{
                  ...resultRowStyle(),
                  color: inactiveColor,
                  fontSize: 11,
                  fontFamily: FONT,
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = C.darkSurf2; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
              >
                <span>{showArchived ? "▾" : "▸"}</span>
                <span>Show archived results ({archivedCount})</span>
              </button>
              {showArchived && (
                <div style={{ opacity: 0.55, marginTop: 4 }}>
                  {archivedPageResults.map((p) => (
                    <button
                      key={`arch-page-${p.id}`}
                      onClick={() => handlePageClick(p.id)}
                      style={resultRowStyle()}
                      onMouseEnter={(e) => { e.currentTarget.style.background = C.darkSurf2; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                    >
                      <span style={{ fontSize: 13, color: C.darkText, fontFamily: FONT, fontWeight: 500 }}>
                        {p.name}
                      </span>
                      <span style={{ marginLeft: "auto", fontSize: 10, color: inactiveColor, fontFamily: FONT, textTransform: "uppercase" }}>
                        page · archived
                      </span>
                    </button>
                  ))}
                  {archivedDbResults.map((r) => (
                    <button
                      key={`arch-rec-${r.tableId}-${r.rowId}`}
                      onClick={() => handlePageClick(r.pageId)}
                      style={{ ...resultRowStyle(), flexDirection: "column", alignItems: "flex-start", gap: 2 }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = C.darkSurf2; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                    >
                      <span style={{ fontSize: 13, color: C.darkText, fontFamily: FONT, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%" }}>
                        {r.title}
                      </span>
                      <span style={{ fontSize: 10, color: inactiveColor, fontFamily: FONT, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                        {r.pageName} · archived
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Searching */}
          {searching && pageResults.length === 0 && activeDbResults.length === 0 && topicResults.length === 0 && (
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

      <NeuronTopicDialog
        neuron={openTopic}
        open={!!openTopic}
        onClose={() => setOpenTopic(null)}
        onNavigate={handleTopicMemberNavigate}
      />
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
