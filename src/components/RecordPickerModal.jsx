// ─── Record Picker Modal ───
// Lightweight workspace-wide record picker. Two-step: pick a database page,
// then pick a row inside it. Lives at z-index Z.modal + 1 so it can be
// opened from inside another modal (e.g. FigmaCommentPanel) without being
// covered.
//
// Returns the picked record via onPick({ record_id, record_name, page_config_id, page_name }).

import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { C, FONT, RADIUS, SHADOW, Z } from "../design/tokens.js";
import { IconClose } from "../design/icons.jsx";
import { usePlatform } from "../context/PlatformContext.jsx";
import { getTableSchema, listRows } from "../lib/api.js";

export default function RecordPickerModal({ open, title = "Pick a record", onPick, onCancel }) {
  const { pages } = usePlatform();
  const [step, setStep] = useState("page"); // "page" | "row"
  const [pageQuery, setPageQuery] = useState("");
  const [rowQuery, setRowQuery] = useState("");
  const [selectedPage, setSelectedPage] = useState(null);
  const [rows, setRows] = useState([]);
  const [rowsLoading, setRowsLoading] = useState(false);
  const [rowsError, setRowsError] = useState(null);
  const [titleCol, setTitleCol] = useState(null);

  // Reset state on each open
  useEffect(() => {
    if (!open) return;
    setStep("page");
    setPageQuery("");
    setRowQuery("");
    setSelectedPage(null);
    setRows([]);
    setRowsError(null);
    setTitleCol(null);
  }, [open]);

  // Only real database pages — skip folders, system-internal, etc.
  const databasePages = useMemo(
    () => (pages || []).filter((p) =>
      p.page_type === "database" && !p._systemInternal
    ),
    [pages]
  );

  const filteredPages = useMemo(() => {
    const q = pageQuery.trim().toLowerCase();
    if (!q) return databasePages;
    return databasePages.filter((p) => (p.title || p.name || "").toLowerCase().includes(q));
  }, [databasePages, pageQuery]);

  const filteredRows = useMemo(() => {
    if (!titleCol) return rows;
    const q = rowQuery.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      const t = String(r.cells?.[titleCol.id] || "").toLowerCase();
      return t.includes(q);
    });
  }, [rows, rowQuery, titleCol]);

  const loadRows = async (page) => {
    setSelectedPage(page);
    setStep("row");
    setRowsLoading(true);
    setRowsError(null);
    setRows([]);
    setTitleCol(null);
    try {
      const [schemaRes, rowsRes] = await Promise.all([
        getTableSchema(page.id),
        listRows(page.id, { limit: 500, topLevelOnly: true }),
      ]);
      const cols = schemaRes?.columns || [];
      // Title detection mirrors d1SchemaToClassified: explicit "title" type or first col.
      const tc = cols.find((c) => c.type === "title") || cols[0] || null;
      setTitleCol(tc);
      setRows(rowsRes?.rows || []);
    } catch (err) {
      setRowsError(err?.message || "Failed to load records");
    } finally {
      setRowsLoading(false);
    }
  };

  const handlePickRow = (row) => {
    onPick?.({
      record_id: row.id,
      record_name: titleCol ? (row.cells?.[titleCol.id] || "Untitled") : "Untitled",
      page_config_id: selectedPage.id,
      page_name: selectedPage.title || selectedPage.name || "",
    });
  };

  if (!open) return null;

  return createPortal((
    <div
      style={{
        position: "fixed", inset: 0, background: C.overlayBg,
        zIndex: Z.modal + 1, fontFamily: FONT,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onCancel?.(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        style={{
          width: "min(560px, 90vw)", height: "min(560px, 80vh)",
          background: C.darkSurf, border: `1px solid ${C.darkBorder}`,
          borderRadius: RADIUS.xl, boxShadow: SHADOW.dropdown,
          display: "flex", flexDirection: "column", overflow: "hidden",
        }}
      >
        {/* Header */}
        <div style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "14px 18px", borderBottom: `1px solid ${C.darkBorder}`,
        }}>
          {step === "row" && (
            <button
              onClick={() => setStep("page")}
              title="Back to databases"
              aria-label="Back"
              style={{
                width: 26, height: 26, display: "flex", alignItems: "center", justifyContent: "center",
                background: "transparent", border: `1px solid ${C.darkBorder}`,
                borderRadius: RADIUS.pill, color: C.darkMuted, fontSize: 14,
                cursor: "pointer", outline: "none",
              }}
            >
              ‹
            </button>
          )}
          <div style={{ flex: 1, fontSize: 13, fontWeight: 600, color: C.darkText, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {step === "page" ? title : (selectedPage?.title || selectedPage?.name || "Records")}
          </div>
          <button
            onClick={onCancel}
            aria-label="Close picker"
            style={{
              width: 26, height: 26, display: "inline-flex", alignItems: "center", justifyContent: "center",
              padding: 0,
              background: "transparent", border: `1px solid ${C.darkBorder}`,
              borderRadius: RADIUS.pill, color: C.darkMuted,
              cursor: "pointer", outline: "none",
            }}
          >
            <IconClose size={11} color={C.darkMuted} />
          </button>
        </div>

        {/* Search */}
        <div style={{ padding: "10px 16px", borderBottom: `1px solid ${C.darkBorder}` }}>
          <input
            value={step === "page" ? pageQuery : rowQuery}
            onChange={(e) => step === "page" ? setPageQuery(e.target.value) : setRowQuery(e.target.value)}
            placeholder={step === "page" ? "Search databases…" : "Search records…"}
            autoFocus
            style={{
              width: "100%", boxSizing: "border-box",
              background: C.darkSurf2, border: `1px solid ${C.darkBorder}`,
              borderRadius: RADIUS.md, padding: "7px 10px",
              fontSize: 12, fontFamily: FONT, color: C.darkText, outline: "none",
            }}
          />
        </div>

        {/* List */}
        <div style={{ flex: 1, overflowY: "auto", padding: "6px 0" }}>
          {step === "page" && (
            <>
              {filteredPages.length === 0 && (
                <div style={{ padding: 16, fontSize: 12, color: C.darkMuted }}>
                  {pageQuery ? "No matching databases." : "No databases in this workspace yet."}
                </div>
              )}
              {filteredPages.map((p) => (
                <button
                  key={p.id}
                  onClick={() => loadRows(p)}
                  style={{
                    display: "flex", width: "100%", textAlign: "left",
                    padding: "9px 16px", background: "transparent",
                    border: "none", cursor: "pointer", outline: "none",
                    fontSize: 12, fontFamily: FONT, color: C.darkText,
                    alignItems: "center", gap: 8,
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = C.darkSurf2; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                >
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {p.title || p.name || "Untitled"}
                  </span>
                  <span style={{ color: C.darkMuted, fontSize: 11 }}>›</span>
                </button>
              ))}
            </>
          )}
          {step === "row" && (
            <>
              {rowsLoading && (
                <div style={{ padding: 16, fontSize: 12, color: C.darkMuted }}>Loading records…</div>
              )}
              {rowsError && !rowsLoading && (
                <div style={{ margin: "8px 14px", padding: "8px 10px", fontSize: 11, color: C.error, background: C.error + "12", borderRadius: RADIUS.md }}>
                  {rowsError}
                </div>
              )}
              {!rowsLoading && !rowsError && filteredRows.length === 0 && (
                <div style={{ padding: 16, fontSize: 12, color: C.darkMuted }}>
                  {rowQuery ? "No matching records." : "No records in this database."}
                </div>
              )}
              {filteredRows.map((r) => {
                const name = titleCol ? (r.cells?.[titleCol.id] || "Untitled") : "Untitled";
                return (
                  <button
                    key={r.id}
                    onClick={() => handlePickRow(r)}
                    style={{
                      display: "flex", width: "100%", textAlign: "left",
                      padding: "8px 16px", background: "transparent",
                      border: "none", cursor: "pointer", outline: "none",
                      fontSize: 12, fontFamily: FONT, color: C.darkText,
                      alignItems: "center", gap: 8,
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = C.darkSurf2; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                  >
                    <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {String(name)}
                    </span>
                  </button>
                );
              })}
            </>
          )}
        </div>
      </div>
    </div>
  ), document.body);
}
