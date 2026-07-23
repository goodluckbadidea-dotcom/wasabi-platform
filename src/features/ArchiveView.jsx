// ─── Archive (admin) ───
// Admin-only screen listing every archived page and row. Users get here
// via the Archive button in BottomBar. From this view they can:
//   - Unarchive an item (cascades to its subtree — reverses the archive)
//   - Delete an item permanently (irreversible; uses the existing
//     deletePageConfig / deleteRow endpoints)
//
// Layout: two grouped sections, "Pages" and "Records" — each a list of
// items sorted by most recently archived first.

import React, { useEffect, useMemo, useState, useCallback } from "react";
import { C, FONT, FONT_DISPLAY, RADIUS } from "../design/tokens.js";
import PanelHeader from "../core/PanelHeader.jsx";
import { IconArchive, IconTrash } from "../design/icons.jsx";
import { usePlatform } from "../context/PlatformContext.jsx";
import { isAdmin } from "../lib/roles.js";
import {
  listArchived, unarchivePage, unarchiveRow,
  deletePageConfig, deleteRow,
} from "../lib/api.js";

function formatWhen(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    const now = new Date();
    const sameYear = d.getFullYear() === now.getFullYear();
    const opts = sameYear
      ? { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }
      : { year: "numeric", month: "short", day: "numeric" };
    return d.toLocaleDateString(undefined, opts);
  } catch { return ""; }
}

function firstTextCell(cells) {
  if (!cells || typeof cells !== "object") return "";
  for (const v of Object.values(cells)) {
    if (typeof v === "string" && v.trim()) return v;
    if (v && typeof v === "object" && typeof v.value === "string" && v.value.trim()) return v.value;
  }
  return "";
}

export default function ArchiveView() {
  const { identity } = usePlatform();
  const admin = isAdmin(identity);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [pages, setPages] = useState([]);
  const [rows, setRows] = useState([]);
  const [busyId, setBusyId] = useState(null);

  const refresh = useCallback(() => {
    setLoading(true);
    listArchived()
      .then((res) => {
        setPages(Array.isArray(res?.pages) ? res.pages : []);
        setRows(Array.isArray(res?.rows) ? res.rows : []);
        setError(null);
      })
      .catch((err) => setError(err?.message || "Failed to load archive"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { if (admin) refresh(); }, [admin, refresh]);

  const onUnarchivePage = useCallback(async (pageId) => {
    setBusyId(`page:${pageId}`);
    try {
      await unarchivePage(pageId);
      // Refresh pages list at the platform level so sidebar picks it up.
      window.dispatchEvent(new CustomEvent("wasabi:refresh-pages"));
      refresh();
    } catch (err) {
      setError(err?.message || "Unarchive failed");
    } finally {
      setBusyId(null);
    }
  }, [refresh]);

  const onDeletePage = useCallback(async (pageId, title) => {
    if (!window.confirm(`Delete "${title}" permanently? This cannot be undone.`)) return;
    setBusyId(`page:${pageId}`);
    try {
      await deletePageConfig(pageId);
      window.dispatchEvent(new CustomEvent("wasabi:refresh-pages"));
      refresh();
    } catch (err) {
      setError(err?.message || "Delete failed");
    } finally {
      setBusyId(null);
    }
  }, [refresh]);

  const onUnarchiveRow = useCallback(async (tableId, rowId) => {
    setBusyId(`row:${rowId}`);
    try {
      await unarchiveRow(tableId, rowId);
      refresh();
    } catch (err) {
      setError(err?.message || "Unarchive failed");
    } finally {
      setBusyId(null);
    }
  }, [refresh]);

  const onDeleteRow = useCallback(async (tableId, rowId, label) => {
    if (!window.confirm(`Delete "${label || "this record"}" permanently? This cannot be undone.`)) return;
    setBusyId(`row:${rowId}`);
    try {
      await deleteRow(tableId, rowId, { cascade: true, confirmDependents: true });
      refresh();
    } catch (err) {
      setError(err?.message || "Delete failed");
    } finally {
      setBusyId(null);
    }
  }, [refresh]);

  const groupedRows = useMemo(() => {
    const map = new Map();
    for (const r of rows) {
      const key = r.table_id || "";
      if (!map.has(key)) map.set(key, { table_id: key, table_title: r.table_title || "(unknown table)", items: [] });
      map.get(key).items.push(r);
    }
    return [...map.values()];
  }, [rows]);

  if (!admin) {
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", background: C.darkBg }}>
        <PanelHeader
          icon={<IconArchive size={20} color={C.accent} />}
          title="Archive"
          side="right"
        />
        <div style={{ padding: 32, color: C.darkMuted, fontFamily: FONT, fontSize: 14 }}>
          Admin only.
        </div>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", background: C.darkBg, minHeight: 0 }}>
      <PanelHeader
        icon={<IconArchive size={20} color={C.accent} />}
        title="Archive"
        side="right"
      >
        <button
          onClick={refresh}
          disabled={loading}
          style={{
            background: "transparent",
            border: `1px solid ${C.darkBorder}`,
            color: C.darkText,
            fontFamily: FONT,
            fontSize: 12,
            padding: "6px 12px",
            borderRadius: RADIUS.pill,
            cursor: loading ? "wait" : "pointer",
            opacity: loading ? 0.6 : 1,
          }}
        >{loading ? "Refreshing…" : "Refresh"}</button>
      </PanelHeader>

      <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px 40px" }}>
        {error && (
          <div style={{
            padding: 12, marginBottom: 16, borderRadius: RADIUS.md,
            background: C.errorDim, color: C.error, fontFamily: FONT, fontSize: 13,
          }}>
            {error}
          </div>
        )}

        {loading && !pages.length && !rows.length ? (
          <div style={{ color: C.darkMuted, fontFamily: FONT, fontSize: 14, padding: 16 }}>
            Loading archived items…
          </div>
        ) : (!pages.length && !rows.length) ? (
          <div style={{
            padding: 40, textAlign: "center", color: C.darkMuted,
            fontFamily: FONT, fontSize: 14, lineHeight: 1.6,
          }}>
            Nothing archived.<br />
            <span style={{ fontSize: 12, opacity: 0.7 }}>
              Right-click any page or record and choose "Archive" to move it here.
            </span>
          </div>
        ) : null}

        {pages.length > 0 && (
          <section style={{ marginBottom: 28 }}>
            <h2 style={{
              fontFamily: FONT_DISPLAY, fontSize: 13, fontWeight: 600,
              color: C.darkMuted, letterSpacing: "0.06em", textTransform: "uppercase",
              margin: "0 0 10px 0",
            }}>
              Pages ({pages.length})
            </h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {pages.map((p) => (
                <ArchiveRow
                  key={p.id}
                  primary={p.title || "(untitled)"}
                  secondary={p.page_type}
                  when={p.archived_at}
                  busy={busyId === `page:${p.id}`}
                  onUnarchive={() => onUnarchivePage(p.id)}
                  onDelete={() => onDeletePage(p.id, p.title)}
                />
              ))}
            </div>
          </section>
        )}

        {groupedRows.map((group) => (
          <section key={group.table_id} style={{ marginBottom: 28 }}>
            <h2 style={{
              fontFamily: FONT_DISPLAY, fontSize: 13, fontWeight: 600,
              color: C.darkMuted, letterSpacing: "0.06em", textTransform: "uppercase",
              margin: "0 0 10px 0",
            }}>
              {group.table_title} — Records ({group.items.length})
            </h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {group.items.map((r) => {
                const label = firstTextCell(r.cells) || `record ${r.id.slice(0, 6)}`;
                return (
                  <ArchiveRow
                    key={r.id}
                    primary={label}
                    secondary={r.parent_row_id ? "sub-item" : "record"}
                    when={r.archived_at}
                    busy={busyId === `row:${r.id}`}
                    onUnarchive={() => onUnarchiveRow(r.table_id, r.id)}
                    onDelete={() => onDeleteRow(r.table_id, r.id, label)}
                  />
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function ArchiveRow({ primary, secondary, when, busy, onUnarchive, onDelete }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 12,
      padding: "10px 14px",
      background: C.darkSurf,
      border: `1px solid ${C.darkBorder}`,
      borderRadius: RADIUS.md,
      opacity: busy ? 0.5 : 1,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontFamily: FONT, fontSize: 14, color: C.darkText,
          fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>{primary}</div>
        <div style={{
          fontFamily: FONT, fontSize: 11, color: C.darkMuted, marginTop: 2,
        }}>
          {secondary}{when ? ` · archived ${formatWhen(when)}` : ""}
        </div>
      </div>
      <button
        onClick={onUnarchive}
        disabled={busy}
        style={{
          background: "transparent",
          border: `1px solid ${C.darkBorder}`,
          color: C.darkText,
          fontFamily: FONT, fontSize: 12,
          padding: "6px 12px",
          borderRadius: RADIUS.pill,
          cursor: busy ? "wait" : "pointer",
        }}
      >Unarchive</button>
      <button
        onClick={onDelete}
        disabled={busy}
        title="Delete permanently"
        aria-label="Delete permanently"
        style={{
          background: "transparent",
          border: `1px solid ${C.darkBorder}`,
          color: C.error,
          fontFamily: FONT, fontSize: 12,
          padding: "6px 10px",
          borderRadius: RADIUS.pill,
          cursor: busy ? "wait" : "pointer",
          display: "inline-flex", alignItems: "center", gap: 6,
        }}
      >
        <IconTrash size={12} color={C.error} />
      </button>
    </div>
  );
}
