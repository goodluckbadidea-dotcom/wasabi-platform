// ─── Linked Sheet View ───
// Read-only table rendered from a Google Sheet or CSV URL.
// Self-contained: fetches its own data via worker proxy (ignores ViewRenderer data pipeline).
// Supports client-side sorting, text search, and auto column type detection.

import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { C, FONT, RADIUS } from "../design/tokens.js";
import { usePlatform } from "../context/PlatformContext.jsx";
import { useLinks } from "../context/LinksContext.jsx";
import { fetchSheetData, detectColumnTypes, getSourceLabel } from "../sheets/sheetClient.js";
import { debounce, formatDate, truncate, timeAgo } from "../utils/helpers.js";
import { IconConnect } from "../design/icons.jsx";
import LinkPicker from "../core/LinkPicker.jsx";

// ─── Styles (mirrors Table.jsx token usage) ───

const styles = {
  wrapper: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    overflow: "hidden",
    fontFamily: FONT,
  },

  toolbar: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "12px 16px",
    borderBottom: `1px solid ${C.edgeLine}`,
    background: C.darkSurf,
    flexShrink: 0,
    flexWrap: "wrap",
  },

  searchWrap: {
    display: "flex",
    alignItems: "center",
    background: C.darkSurf2,
    border: `1px solid ${C.darkBorder}`,
    borderRadius: RADIUS.md,
    padding: "0 10px",
    flex: "1 1 200px",
    maxWidth: 320,
    minWidth: 140,
    height: 34,
    transition: "border-color 0.15s, box-shadow 0.15s",
  },

  searchInput: {
    flex: 1,
    border: "none",
    outline: "none",
    background: "transparent",
    fontFamily: FONT,
    fontSize: 13,
    color: C.darkText,
    padding: "0 6px",
    height: "100%",
  },

  searchIcon: {
    fontSize: 13,
    color: C.darkMuted,
    flexShrink: 0,
  },

  badge: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "3px 10px",
    borderRadius: RADIUS.pill,
    background: C.darkSurf2,
    border: `1px solid ${C.darkBorder}`,
    fontSize: 10,
    fontWeight: 600,
    color: C.darkMuted,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    whiteSpace: "nowrap",
    flexShrink: 0,
  },

  refreshBtn: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 34,
    height: 34,
    borderRadius: RADIUS.md,
    border: `1px solid ${C.darkBorder}`,
    background: C.darkSurf2,
    cursor: "pointer",
    color: C.darkMuted,
    fontSize: 14,
    transition: "background 0.15s, color 0.15s",
    flexShrink: 0,
    fontFamily: FONT,
    outline: "none",
  },

  countLabel: {
    fontSize: 12,
    color: C.darkMuted,
    marginLeft: "auto",
    whiteSpace: "nowrap",
    flexShrink: 0,
  },

  sourceLink: {
    fontSize: 11,
    color: C.accent,
    textDecoration: "none",
    whiteSpace: "nowrap",
    flexShrink: 0,
  },

  cachedLabel: {
    fontSize: 10,
    color: C.darkMuted,
    padding: "0 16px 6px",
    background: C.darkSurf,
  },

  scrollArea: {
    flex: 1,
    overflowY: "auto",
    overflowX: "auto",
    background: C.darkSurf,
  },

  table: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: 13,
    tableLayout: "auto",
  },

  th: {
    textAlign: "left",
    padding: "10px 12px",
    fontSize: 11,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    color: C.darkMuted,
    borderBottom: `2px solid ${C.darkBorder}`,
    whiteSpace: "nowrap",
    cursor: "pointer",
    userSelect: "none",
    position: "sticky",
    top: 0,
    background: C.darkSurf,
    zIndex: 2,
    transition: "color 0.15s",
  },

  thActive: {
    color: C.darkText,
  },

  td: {
    padding: "8px 12px",
    borderBottom: `1px solid ${C.edgeLine}`,
    color: C.darkText,
    verticalAlign: "middle",
    fontSize: 13,
    lineHeight: 1.45,
    maxWidth: 280,
  },

  row: {
    transition: "background 0.12s",
    cursor: "default",
  },

  rowHover: {
    background: `${C.darkSurf2}88`,
  },

  centered: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flex: 1,
    flexDirection: "column",
    gap: 12,
    fontFamily: FONT,
    padding: 32,
    textAlign: "center",
  },
};

// ─── Component ───

export default function LinkedSheet({ config = {}, pageConfig }) {
  const { user } = usePlatform();
  const { createLink } = useLinks();
  const { sheetUrl, sheetType } = config;

  // Data state
  const [sheetData, setSheetData] = useState(null); // { columns, rows, cachedAt, sheetType, truncated }
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [columnTypes, setColumnTypes] = useState({});

  // UI state
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [sortField, setSortField] = useState(null);
  const [sortDir, setSortDir] = useState(null); // "asc" | "desc" | null
  const [searchFocused, setSearchFocused] = useState(false);
  const [hoveredRow, setHoveredRow] = useState(null);

  // Cell linking state
  const [hoveredCell, setHoveredCell] = useState(null); // { rowIdx, colIdx }
  const [linkPickerCell, setLinkPickerCell] = useState(null); // { rowIdx, colIdx, column, value }

  // Compute view index for this linked sheet within the page
  const viewIdx = useMemo(() => {
    if (!pageConfig?.views) return 0;
    return pageConfig.views.findIndex((v) => v.config?.sheetUrl === sheetUrl) ?? 0;
  }, [pageConfig, sheetUrl]);

  // Debounced search
  const debouncedSetSearch = useRef(
    debounce((v) => setDebouncedSearch(v), 200)
  ).current;

  const handleSearchChange = useCallback((e) => {
    const v = e.target.value;
    setSearch(v);
    debouncedSetSearch(v);
  }, [debouncedSetSearch]);

  // ── Fetch data ──
  const fetchData = useCallback(async () => {
    if (!user?.workerUrl || !sheetUrl) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchSheetData(user.workerUrl, sheetUrl);
      setSheetData(data);
      setColumnTypes(detectColumnTypes(data.columns, data.rows));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [user?.workerUrl, sheetUrl]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // ── Sort toggle ──
  const handleSort = useCallback((colName) => {
    setSortField((prev) => {
      if (prev !== colName) {
        setSortDir("asc");
        return colName;
      }
      setSortDir((d) => {
        if (d === "asc") return "desc";
        if (d === "desc") {
          setSortField(null);
          return null;
        }
        return "asc";
      });
      return colName;
    });
  }, []);

  // ── Processed data (search + sort) ──
  const processedRows = useMemo(() => {
    if (!sheetData) return [];
    let rows = [...sheetData.rows];

    // Search filter
    if (debouncedSearch) {
      const q = debouncedSearch.toLowerCase();
      rows = rows.filter((row) =>
        row.some((cell) => String(cell).toLowerCase().includes(q))
      );
    }

    // Sort
    if (sortField !== null && sortDir && sheetData.columns) {
      const colIdx = sheetData.columns.indexOf(sortField);
      if (colIdx >= 0) {
        const type = columnTypes[sortField] || "text";
        rows.sort((a, b) => {
          let va = a[colIdx] || "";
          let vb = b[colIdx] || "";
          if (type === "number") {
            const na = parseFloat(va);
            const nb = parseFloat(vb);
            if (isNaN(na)) return 1;
            if (isNaN(nb)) return -1;
            return sortDir === "asc" ? na - nb : nb - na;
          }
          const sa = String(va).toLowerCase();
          const sb = String(vb).toLowerCase();
          if (sa < sb) return sortDir === "asc" ? -1 : 1;
          if (sa > sb) return sortDir === "asc" ? 1 : -1;
          return 0;
        });
      }
    }

    return rows;
  }, [sheetData, debouncedSearch, sortField, sortDir, columnTypes]);

  // ── Render cell by type ──
  const renderCell = useCallback((value, colName) => {
    const v = value || "";
    const type = columnTypes[colName] || "text";

    switch (type) {
      case "number":
        return (
          <span style={{ fontVariantNumeric: "tabular-nums", textAlign: "right", display: "block" }}>
            {v}
          </span>
        );
      case "url":
        return (
          <a
            href={v}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: C.accent, textDecoration: "none", fontSize: 13 }}
            title={v}
          >
            {truncate(v, 60)}
          </a>
        );
      case "date":
        try {
          return formatDate(v);
        } catch {
          return v;
        }
      case "checkbox": {
        const isTrue = ["true", "yes", "1"].includes(String(v).toLowerCase());
        return (
          <span style={{ color: isTrue ? "#7DC143" : C.darkMuted, fontSize: 14 }}>
            {isTrue ? "✓" : "—"}
          </span>
        );
      }
      default:
        return truncate(v, 120);
    }
  }, [columnTypes]);

  // ── No URL configured ──
  if (!sheetUrl) {
    return (
      <div style={styles.wrapper}>
        <div style={styles.centered}>
          <div style={{ fontSize: 14, color: C.darkMuted }}>No sheet URL configured.</div>
        </div>
      </div>
    );
  }

  // ── Loading state ──
  if (loading) {
    return (
      <div style={styles.wrapper}>
        <div style={styles.centered}>
          <div style={{ fontSize: 14, color: C.darkMuted }}>Loading sheet data...</div>
        </div>
      </div>
    );
  }

  // ── Error state ──
  if (error) {
    return (
      <div style={styles.wrapper}>
        <div style={styles.centered}>
          <div style={{ fontSize: 14, color: "#E05252" }}>{error}</div>
          <button
            onClick={fetchData}
            style={{
              padding: "8px 18px",
              background: C.accent,
              border: "none",
              borderRadius: RADIUS.pill,
              color: "#fff",
              fontFamily: FONT,
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              outline: "none",
            }}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  // ── Empty data ──
  if (!sheetData || sheetData.columns.length === 0) {
    return (
      <div style={styles.wrapper}>
        <div style={styles.centered}>
          <div style={{ fontSize: 14, color: C.darkMuted }}>No data in this sheet.</div>
        </div>
      </div>
    );
  }

  const columns = sheetData.columns;

  return (
    <div style={styles.wrapper}>
      {/* Toolbar */}
      <div style={styles.toolbar}>
        {/* Search */}
        <div
          style={{
            ...styles.searchWrap,
            ...(searchFocused ? { borderColor: C.accent, boxShadow: `0 0 0 2px ${C.accent}33` } : {}),
          }}
        >
          <span style={styles.searchIcon}>&#128269;</span>
          <input
            style={styles.searchInput}
            type="text"
            placeholder="Search..."
            value={search}
            onChange={handleSearchChange}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
          />
        </div>

        {/* Read-only badge */}
        <div style={styles.badge}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: C.darkMuted }} />
          Read-only · Linked Sheet
        </div>

        {/* Refresh */}
        <button
          style={styles.refreshBtn}
          onClick={fetchData}
          title="Refresh sheet data"
          onMouseEnter={(e) => { e.currentTarget.style.background = C.darkBorder; e.currentTarget.style.color = C.darkText; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = C.darkSurf2; e.currentTarget.style.color = C.darkMuted; }}
        >
          &#x21bb;
        </button>

        {/* Count */}
        <span style={styles.countLabel}>
          {processedRows.length === sheetData.rows.length
            ? `${sheetData.rows.length} rows`
            : `${processedRows.length} of ${sheetData.rows.length} rows`}
        </span>

        {/* Source link */}
        <a
          href={sheetUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={styles.sourceLink}
        >
          {getSourceLabel(sheetType || sheetData.sheetType)} &rarr;
        </a>
      </div>

      {/* Cached timestamp + truncation notice */}
      {(sheetData.cachedAt || sheetData.truncated) && (
        <div style={styles.cachedLabel}>
          {sheetData.cachedAt && (
            <span>Last refreshed: {timeAgo(new Date(sheetData.cachedAt).toISOString())}</span>
          )}
          {sheetData.truncated && (
            <span style={{ marginLeft: sheetData.cachedAt ? 12 : 0, color: C.orange }}>
              Showing first 10,000 rows
            </span>
          )}
        </div>
      )}

      {/* Table */}
      <div style={styles.scrollArea}>
        <table style={styles.table}>
          <thead>
            <tr>
              {columns.map((col) => {
                const isSort = sortField === col;
                return (
                  <th
                    key={col}
                    onClick={() => handleSort(col)}
                    style={{
                      ...styles.th,
                      ...(isSort ? styles.thActive : {}),
                      ...(columnTypes[col] === "number" ? { textAlign: "right" } : {}),
                    }}
                  >
                    {col}
                    {isSort && sortDir === "asc" && " ▲"}
                    {isSort && sortDir === "desc" && " ▼"}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {processedRows.map((row, rowIdx) => (
              <tr
                key={rowIdx}
                style={{
                  ...styles.row,
                  ...(hoveredRow === rowIdx ? styles.rowHover : {}),
                }}
                onMouseEnter={() => setHoveredRow(rowIdx)}
                onMouseLeave={() => setHoveredRow(null)}
              >
                {columns.map((col, colIdx) => {
                  const isCellHovered = hoveredCell?.rowIdx === rowIdx && hoveredCell?.colIdx === colIdx;
                  return (
                    <td
                      key={colIdx}
                      style={{
                        ...styles.td,
                        ...(columnTypes[col] === "number" ? { textAlign: "right" } : {}),
                        position: "relative",
                      }}
                      onMouseEnter={() => setHoveredCell({ rowIdx, colIdx })}
                      onMouseLeave={() => setHoveredCell(null)}
                    >
                      {renderCell(row[colIdx], col)}
                      {/* Link icon on hover */}
                      {isCellHovered && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setLinkPickerCell({
                              rowIdx,
                              colIdx,
                              column: col,
                              value: String(row[colIdx] ?? ""),
                            });
                          }}
                          title="Link this value to another table"
                          style={{
                            position: "absolute", top: 2, right: 2,
                            background: C.darkSurf2, border: `1px solid ${C.darkBorder}`,
                            borderRadius: 4, padding: 2, cursor: "pointer",
                            display: "flex", alignItems: "center", justifyContent: "center",
                            opacity: 0.6, transition: "opacity 0.12s", zIndex: 2,
                          }}
                          onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; }}
                          onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.6"; }}
                        >
                          <IconConnect size={10} color={C.accent} />
                        </button>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
            {processedRows.length === 0 && (
              <tr>
                <td
                  colSpan={columns.length}
                  style={{
                    ...styles.td,
                    textAlign: "center",
                    color: C.darkMuted,
                    padding: 32,
                  }}
                >
                  {debouncedSearch ? "No matching rows" : "No data"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Cell Link Picker (target mode — sheet cell is the source, user picks a target) */}
      {linkPickerCell && (
        <LinkPicker
          mode="target"
          onCancel={() => setLinkPickerCell(null)}
          onSelect={async (selection) => {
            const { sourceRef: targetRef, sourcePageId: targetPageId, sourceViewIdx: targetViewIdx, sourceName } = selection;
            // Build the sheet source ref
            const sourceRef = {
              type: "sheet",
              sheetUrl,
              rowIndex: linkPickerCell.rowIdx,
              column: linkPickerCell.column,
            };
            const pageName = pageConfig?.name || "Untitled";
            const viewName = pageConfig?.views?.[viewIdx]?.name || "Linked Sheet";
            await createLink({
              name: `${pageName} → ${viewName} → ${sourceName}`,
              sourcePage: pageConfig?.id || "",
              sourceView: viewIdx,
              sourceRef,
              targetPage: targetPageId,
              targetView: targetViewIdx,
              targetRef,
              direction: "one_way",
            });
            setLinkPickerCell(null);
          }}
        />
      )}
    </div>
  );
}
