// ─── DcMasterItemSheet ───
// Read-only master item catalog table. Editing happens in DcItemDrawer,
// opened via the pencil icon on each row (or the "+ New Item" button).

import React, { useMemo, useState } from "react";
import { C, FONT, MONO, RADIUS } from "../../design/tokens.js";
import { CHANNEL_COLORS, CHANNEL_LABELS, TYPE_COLORS, TYPE_LABELS, vendorSwatchFor } from "./dcHelpers.js";
import DcItemDrawer from "./DcItemDrawer.jsx";

export default function DcMasterItemSheet({ extension, items, itemsLoaded, onItemsChanged }) {
  const [drawerItem, setDrawerItem] = useState(null); // { item } or { newItem: true }
  const [query, setQuery] = useState("");
  const [channelFilter, setChannelFilter] = useState(null);
  const [typeFilter, setTypeFilter] = useState(null);
  const [marketFilter, setMarketFilter] = useState(null);

  const config = extension?.ext_config || {};
  const channels = Array.isArray(config.channels) ? config.channels : [];
  const itemTypes = Array.isArray(config.item_types) ? config.item_types : [];
  const markets = Array.isArray(config.markets) ? config.markets : [];

  // Filter items
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (items || []).filter((i) => {
      if (q && !(`${i.sku} ${i.description}`.toLowerCase().includes(q))) return false;
      if (channelFilter && i.channel !== channelFilter) return false;
      if (typeFilter && i.type_key !== typeFilter) return false;
      if (marketFilter && !(Array.isArray(i.markets) && i.markets.includes(marketFilter))) return false;
      return true;
    });
  }, [items, query, channelFilter, typeFilter, marketFilter]);

  return (
    <div style={styles.container}>
      <div style={styles.head}>
        <h1 style={styles.h1}>Master Item Sheet</h1>
        <div style={styles.sub}>
          The catalog every market workbook pulls from. Adding an item here makes it available across all matched (channel × market × type) combinations.
        </div>
      </div>

      <div style={styles.toolbar}>
        <div style={styles.search}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.3" />
            <path d="M9.5 9.5l3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
          <input
            type="search"
            placeholder="Search SKU, description, vendor…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={styles.searchInput}
          />
        </div>
        <FilterButton label="Channel" value={channelFilter} options={channels.map(c => ({ v: c.key, l: c.label }))} onChange={setChannelFilter} />
        <FilterButton label="Type"    value={typeFilter}    options={itemTypes.map(t => ({ v: t.key, l: t.label }))} onChange={setTypeFilter} />
        <FilterButton label="Market"  value={marketFilter}  options={markets.map(m => ({ v: m.key, l: m.label }))}  onChange={setMarketFilter} />
        <button style={styles.newBtn} onClick={() => setDrawerItem({ newItem: true })}>
          <span style={styles.plus}>+</span>New Item
        </button>
      </div>

      <div style={styles.sheet}>
        <div style={styles.sheetScroll}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={{ ...styles.th, width: "20%" }}>SKU / Item</th>
                <th style={{ ...styles.th, width: "11%" }}>Channel</th>
                <th style={{ ...styles.th, width: "17%" }}>Markets</th>
                <th style={{ ...styles.th, width: "11%" }}>Type</th>
                <th style={{ ...styles.th, width: "13%" }}>Vendor</th>
                <th style={{ ...styles.th, width: "10%" }}>Counted as</th>
                <th style={{ ...styles.th, width: "12%" }}>Case / Unit / Weight</th>
                <th style={{ ...styles.th, ...styles.thActions, width: 60 }} />
              </tr>
            </thead>
            <tbody>
              {!itemsLoaded && (
                <tr><td colSpan={8} style={styles.emptyRow}>Loading items…</td></tr>
              )}
              {itemsLoaded && filtered.length === 0 && (
                <tr><td colSpan={8} style={styles.emptyRow}>
                  {items.length === 0
                    ? "No items yet — click + New Item to add the first."
                    : "No items match your filters."}
                </td></tr>
              )}
              {filtered.map((item) => (
                <tr key={item.id} style={styles.tr}>
                  <td style={styles.td}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      <span style={styles.skuCode}>{item.sku}</span>
                      {item.description && <span style={styles.skuDesc}>{item.description}</span>}
                    </div>
                  </td>
                  <td style={styles.td}><ReadPill color={CHANNEL_COLORS[item.channel]} label={CHANNEL_LABELS[item.channel] || item.channel || "—"} /></td>
                  <td style={styles.td}><MarketsCluster markets={item.markets} allMarkets={markets} /></td>
                  <td style={styles.td}><ReadPill color={TYPE_COLORS[item.type_key]} label={TYPE_LABELS[item.type_key] || item.type_key || "—"} /></td>
                  <td style={styles.td}><ReadPill color={vendorSwatchFor(item.vendor_name || item.vendor_ref)} label={item.vendor_name || "—"} /></td>
                  <td style={styles.td}><span style={styles.modePill}>{(item.count_mode || "case").toUpperCase()}</span></td>
                  <td style={styles.td}>{renderCond(item)}</td>
                  <td style={{ ...styles.td, ...styles.tdActions }}>
                    <button style={styles.actionBtn} onClick={() => setDrawerItem({ item })} title="Edit">
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                        <path d="M9.5 2.5l2 2-6.5 6.5-2.5.5.5-2.5 6.5-6.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
                      </svg>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {itemsLoaded && (
          <div style={styles.sheetFooter}>
            <span><strong style={{ color: C.text }}>{filtered.length}</strong> of {items.length} items</span>
            <span style={{ opacity: 0.7 }}>Any change here syncs to every open workbook draft.</span>
          </div>
        )}
      </div>

      {drawerItem && (
        <DcItemDrawer
          extension={extension}
          item={drawerItem.item || null}
          onClose={() => setDrawerItem(null)}
          onSaved={() => { setDrawerItem(null); onItemsChanged(); }}
        />
      )}
    </div>
  );
}

// ── Small subcomponents ──

function ReadPill({ color, label }) {
  return (
    <span style={styles.roPill}>
      <span style={{ ...styles.roPillDot, background: color || C.muted }} />
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
    </span>
  );
}

function MarketsCluster({ markets, allMarkets }) {
  const set = new Set(Array.isArray(markets) ? markets : []);
  return (
    <div style={styles.marketsCluster}>
      {(allMarkets || []).map((m) => (
        <span
          key={m.key}
          style={{
            ...styles.marketChip,
            ...(set.has(m.key) ? styles.marketChipOn : {}),
          }}
        >
          {m.key.slice(0, 2)}
        </span>
      ))}
    </div>
  );
}

function renderCond(item) {
  const mode = item.count_mode || "case";
  if (mode === "case") {
    return (
      <span style={styles.roCond}>
        <span>{item.case_size ?? "—"}</span>
        <span style={styles.roCondUnit}>units / case</span>
      </span>
    );
  }
  if (mode === "weight") {
    return (
      <span style={styles.roCond}>
        <span style={styles.roCondUnit}>Weight unit</span>
        <span>{item.weight_unit || "—"}</span>
      </span>
    );
  }
  return <span style={{ color: C.muted, fontFamily: MONO, fontSize: 12 }}>— counted directly</span>;
}

function FilterButton({ label, value, options, onChange }) {
  const [open, setOpen] = useState(false);
  const activeOption = options.find((o) => o.v === value);
  return (
    <div style={{ position: "relative" }}>
      <button
        style={{ ...styles.filter, ...(value ? styles.filterActive : {}) }}
        onClick={() => setOpen((o) => !o)}
      >
        {label}{activeOption ? ` · ${activeOption.l}` : ""}
      </button>
      {open && (
        <>
          <div style={styles.filterMenuScrim} onClick={() => setOpen(false)} />
          <div style={styles.filterMenu}>
            <button
              style={{ ...styles.filterMenuItem, color: !value ? C.accent : C.text }}
              onClick={() => { onChange(null); setOpen(false); }}
            >All</button>
            {options.map((o) => (
              <button
                key={o.v}
                style={{ ...styles.filterMenuItem, color: o.v === value ? C.accent : C.text }}
                onClick={() => { onChange(o.v); setOpen(false); }}
              >{o.l}</button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

const styles = {
  container: { maxWidth: 1360, margin: "0 auto", padding: "24px 24px 60px" },
  head: { paddingBottom: 20 },
  h1: {
    fontFamily: FONT,
    fontSize: 26,
    fontWeight: 700,
    letterSpacing: "-0.02em",
    color: C.text,
  },
  sub: { fontSize: 13, color: C.textMid, marginTop: 6, maxWidth: 720 },
  toolbar: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginBottom: 18,
    flexWrap: "wrap",
  },
  search: {
    flex: 1,
    minWidth: 220,
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 14px",
    background: C.surface,
    border: `1px solid ${C.border}`,
    borderRadius: RADIUS.md,
    minHeight: 40,
    color: C.muted,
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
  },
  filter: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "8px 14px",
    background: C.surface,
    border: `1px solid ${C.border}`,
    borderRadius: RADIUS.md,
    color: C.textMid,
    fontSize: 13,
    fontWeight: 500,
    cursor: "pointer",
    minHeight: 40,
    fontFamily: FONT,
  },
  filterActive: {
    color: C.accent,
    borderColor: C.accent,
    background: `color-mix(in srgb, ${C.accent} 14%, transparent)`,
  },
  filterMenuScrim: { position: "fixed", inset: 0, zIndex: 40 },
  filterMenu: {
    position: "absolute",
    top: "100%",
    marginTop: 6,
    background: C.surface,
    border: `1px solid ${C.border}`,
    borderRadius: RADIUS.md,
    boxShadow: "0 8px 24px rgba(0,0,0,0.32)",
    zIndex: 50,
    padding: 4,
    minWidth: 180,
  },
  filterMenuItem: {
    display: "block",
    width: "100%",
    padding: "8px 12px",
    background: "transparent",
    border: "none",
    fontFamily: FONT,
    fontSize: 13,
    textAlign: "left",
    color: C.text,
    cursor: "pointer",
    borderRadius: RADIUS.sm,
  },
  newBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "9px 18px",
    background: C.accent,
    color: "#0A1114",
    border: "none",
    fontFamily: FONT,
    fontWeight: 600,
    fontSize: 13,
    letterSpacing: "0.02em",
    borderRadius: RADIUS.pill,
    minHeight: 40,
    cursor: "pointer",
  },
  plus: { fontSize: 16, fontWeight: 500, lineHeight: 1 },
  sheet: {
    background: C.surface,
    border: `1px solid ${C.border}`,
    borderRadius: RADIUS.lg,
    overflow: "hidden",
  },
  sheetScroll: { overflowX: "auto" },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    fontVariantNumeric: "tabular-nums",
    minWidth: 1180,
  },
  th: {
    textAlign: "left",
    padding: "12px 14px",
    fontFamily: FONT,
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: C.muted,
    background: C.surfaceAlt,
    borderBottom: `1px solid ${C.border}`,
    whiteSpace: "nowrap",
  },
  thActions: { textAlign: "right", paddingRight: 14 },
  tr: {},
  td: {
    padding: "12px 14px",
    borderBottom: `1px solid ${C.edgeLine}`,
    color: C.text,
    verticalAlign: "middle",
    fontSize: 13,
  },
  tdActions: { textAlign: "right", paddingRight: 14 },
  emptyRow: {
    padding: "40px 14px",
    color: C.muted,
    textAlign: "center",
    fontFamily: FONT,
    fontSize: 13,
  },
  skuCode: {
    fontFamily: MONO,
    fontSize: 13,
    fontWeight: 500,
    color: C.text,
    letterSpacing: "0.02em",
  },
  skuDesc: {
    fontFamily: FONT,
    fontSize: 11.5,
    color: C.muted,
  },
  roPill: {
    display: "inline-flex",
    alignItems: "center",
    gap: 7,
    padding: "4px 11px 4px 9px",
    background: `color-mix(in srgb, ${C.textMid} 6%, transparent)`,
    borderRadius: RADIUS.pill,
    fontFamily: FONT,
    fontSize: 12,
    fontWeight: 500,
    color: C.text,
    whiteSpace: "nowrap",
    maxWidth: "100%",
    overflow: "hidden",
  },
  roPillDot: { width: 7, height: 7, borderRadius: "50%", flexShrink: 0 },
  marketsCluster: { display: "inline-flex", gap: 3, alignItems: "center" },
  marketChip: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: 26,
    padding: "2px 7px",
    borderRadius: RADIUS.pill,
    fontFamily: MONO,
    fontSize: 9,
    fontWeight: 600,
    letterSpacing: "0.04em",
    background: C.dark,
    border: `1px solid ${C.border}`,
    color: C.muted,
    lineHeight: 1.3,
  },
  marketChipOn: {
    background: C.accent,
    color: "#0A1114",
    borderColor: C.accent,
  },
  modePill: {
    display: "inline-flex",
    alignItems: "center",
    padding: "3px 10px",
    background: `color-mix(in srgb, ${C.accent} 14%, transparent)`,
    color: C.accent,
    border: `1px solid color-mix(in srgb, ${C.accent} 24%, transparent)`,
    borderRadius: RADIUS.pill,
    fontFamily: FONT,
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: "0.08em",
  },
  roCond: {
    display: "inline-flex",
    alignItems: "baseline",
    gap: 6,
    fontFamily: MONO,
    fontSize: 13,
    color: C.text,
    fontWeight: 500,
  },
  roCondUnit: {
    fontFamily: FONT,
    fontSize: 10,
    fontWeight: 500,
    color: C.muted,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
  },
  actionBtn: {
    width: 28,
    height: 28,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: RADIUS.md,
    color: C.muted,
    background: "transparent",
    border: "none",
    cursor: "pointer",
  },
  sheetFooter: {
    display: "flex",
    justifyContent: "space-between",
    padding: "12px 16px",
    borderTop: `1px solid ${C.edgeLine}`,
    background: C.surfaceAlt,
    fontSize: 12,
    color: C.textMid,
    fontFamily: FONT,
  },
};
