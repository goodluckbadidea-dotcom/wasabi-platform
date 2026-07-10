// ─── DcVendorCombobox ───
// Searchable dropdown backed by the workspace Vendor CRM. Reads vendor
// rows via listRows(vendorCrmPageId) and lets the user pick an existing
// vendor or add a new one (name only — richer CRM fields fill later).
//
// The extension's ext_config carries vendor_crm_page_id and
// vendor_name_field (which cell holds the vendor name).

import React, { useEffect, useMemo, useRef, useState } from "react";
import { C, FONT, MONO, RADIUS } from "../../design/tokens.js";
import { useTheme } from "../../context/ThemeContext.jsx";
import { vendorSwatchFor } from "./dcHelpers.js";
import { apiFetch, listRows } from "../../lib/api.js";

export default function DcVendorCombobox({ value, onChange, extension }) {
  useTheme();
  const [open, setOpen] = useState(false);
  const [vendors, setVendors] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const wrapRef = useRef(null);
  const inputRef = useRef(null);

  const cfg = extension?.ext_config || {};
  const vendorPageId = cfg.vendor_crm_page_id;
  const nameField = cfg.vendor_name_field || "Vendor Name";

  // Load vendors on first open
  useEffect(() => {
    if (!open || loaded || !vendorPageId) return;
    let cancelled = false;
    listRows(vendorPageId, { limit: 500 })
      .then((res) => {
        if (cancelled) return;
        const rows = res?.rows || [];
        const parsed = rows.map((r) => ({
          id: r.id,
          name: (r.cells && r.cells[nameField]) || "(unnamed)",
        })).filter((v) => v.name && v.name !== "(unnamed)");
        parsed.sort((a, b) => a.name.localeCompare(b.name));
        setVendors(parsed);
        setLoaded(true);
      })
      .catch(() => {
        setLoaded(true);
      });
    return () => { cancelled = true; };
  }, [open, loaded, vendorPageId, nameField]);

  // Focus search on open
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 30);
  }, [open]);

  // Close on outside click / ESC
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return vendors;
    return vendors.filter((v) => v.name.toLowerCase().includes(q));
  }, [vendors, query]);

  const exactMatch = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q && vendors.some((v) => v.name.toLowerCase() === q);
  }, [query, vendors]);

  const select = (v) => {
    onChange({ ref: v.id, name: v.name });
    setOpen(false);
  };

  const createNew = async () => {
    const name = query.trim();
    if (!name || creating || !vendorPageId) return;
    setCreating(true);
    try {
      // POST new row to the Vendor CRM
      const res = await apiFetch(`/tables/${vendorPageId}/rows`, {
        method: "POST",
        body: {
          rows: [{
            cells: { [nameField]: name, "Status": "Prospect" },
          }],
        },
      });
      const created = res?.rows?.[0] || res?.[0] || res;
      const id = created?.id || `new_${Date.now()}`;
      // Refresh local list
      const newEntry = { id, name };
      setVendors((prev) => {
        const next = [...prev, newEntry];
        next.sort((a, b) => a.name.localeCompare(b.name));
        return next;
      });
      onChange({ ref: id, name });
      setOpen(false);
    } catch (err) {
      alert("Failed to create vendor: " + (err.message || err));
    } finally {
      setCreating(false);
    }
  };

  const swatch = vendorSwatchFor(value?.name || value?.ref);
  const displayLabel = value?.name || "Pick a vendor…";

  return (
    <div ref={wrapRef} style={styles.wrap}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{ ...styles.trigger, ...(open ? styles.triggerOpen : {}) }}
      >
        <span style={{ ...styles.swatch, background: swatch }} />
        <span style={styles.label}>{displayLabel}</span>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ color: C.muted, transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}>
          <path d="M3 5l3 3 3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>

      {open && (
        <div style={styles.menu}>
          <div style={styles.menuHead}>
            <span>Vendor CRM</span>
            <span style={{ color: C.accent }}>{vendors.length} vendors</span>
          </div>
          <div style={styles.searchWrap}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ color: C.muted }}>
              <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.3"/>
              <path d="M9.5 9.5l3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
            </svg>
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search vendors…"
              style={styles.searchInput}
              autoComplete="off"
            />
          </div>
          <div style={styles.list}>
            {!loaded && (
              <div style={styles.empty}>Loading Vendor CRM…</div>
            )}
            {loaded && filtered.length === 0 && !query && (
              <div style={styles.empty}>No vendors yet — add one below.</div>
            )}
            {loaded && filtered.length === 0 && query && (
              <div style={styles.empty}>No vendors match — try a different search or add a new one.</div>
            )}
            {filtered.map((v) => {
              const active = value?.ref === v.id;
              return (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => select(v)}
                  style={{
                    ...styles.option,
                    ...(active ? styles.optionActive : {}),
                  }}
                >
                  <span style={{ ...styles.optSwatch, background: vendorSwatchFor(v.name) }} />
                  <span style={styles.optName}>{v.name}</span>
                </button>
              );
            })}
          </div>
          {query && !exactMatch && (
            <div style={styles.newRow}>
              <button type="button" onClick={createNew} disabled={creating} style={styles.newBtn}>
                <span style={styles.newPlus}>+</span>
                <span>
                  {creating ? "Creating…" : <>New vendor · <strong style={{ color: C.text }}>{query.trim()}</strong></>}
                </span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function buildStyles() { return {
  wrap: { position: "relative", width: "100%" },
  trigger: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    width: "100%",
    background: C.dark,
    border: `1px solid ${C.border}`,
    borderRadius: RADIUS.md,
    color: C.text,
    fontFamily: FONT,
    fontSize: 14,
    fontWeight: 500,
    padding: "11px 14px",
    minHeight: 44,
    cursor: "pointer",
    textAlign: "left",
  },
  triggerOpen: { borderColor: C.accent },
  swatch: { width: 9, height: 9, borderRadius: "50%", flexShrink: 0 },
  label: {
    flex: 1,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  menu: {
    position: "absolute",
    top: "calc(100% + 6px)",
    left: 0,
    right: 0,
    background: C.surface,
    border: `1px solid ${C.border}`,
    borderRadius: RADIUS.md,
    boxShadow: "0 8px 32px rgba(0,0,0,0.32)",
    zIndex: 700,
    overflow: "hidden",
    maxHeight: 340,
    display: "flex",
    flexDirection: "column",
  },
  menuHead: {
    display: "flex",
    justifyContent: "space-between",
    padding: "8px 14px 6px",
    borderBottom: `1px solid ${C.edgeLine}`,
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: "0.14em",
    textTransform: "uppercase",
    color: C.muted,
    fontFamily: FONT,
  },
  searchWrap: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "10px 14px",
    borderBottom: `1px solid ${C.edgeLine}`,
  },
  searchInput: {
    flex: 1,
    border: "none",
    outline: "none",
    background: "transparent",
    color: C.text,
    fontFamily: FONT,
    fontSize: 14,
    padding: 0,
    minWidth: 0,
  },
  list: { overflowY: "auto", flex: 1, padding: "4px 0" },
  empty: {
    padding: "16px 14px",
    color: C.muted,
    fontSize: 12,
    textAlign: "center",
    fontStyle: "italic",
    fontFamily: FONT,
  },
  option: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    width: "100%",
    padding: "8px 14px",
    color: C.text,
    background: "transparent",
    border: "none",
    fontFamily: FONT,
    fontSize: 13.5,
    fontWeight: 500,
    textAlign: "left",
    cursor: "pointer",
  },
  optionActive: { background: `color-mix(in srgb, ${C.accent} 14%, transparent)` },
  optSwatch: { width: 8, height: 8, borderRadius: "50%", flexShrink: 0 },
  optName: {
    flex: 1,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  newRow: {
    borderTop: `1px solid ${C.edgeLine}`,
    background: `color-mix(in srgb, ${C.accent} 5%, transparent)`,
  },
  newBtn: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    width: "100%",
    padding: "10px 14px",
    color: C.accent,
    fontFamily: FONT,
    fontSize: 13.5,
    fontWeight: 600,
    background: "transparent",
    border: "none",
    cursor: "pointer",
  },
  newPlus: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 20,
    height: 20,
    borderRadius: "50%",
    background: C.accent,
    color: "#0A1114",
    fontSize: 14,
    fontWeight: 600,
    lineHeight: 1,
    flexShrink: 0,
  },
};
}

const styles = new Proxy({}, { get: (_, k) => buildStyles()[k] });
