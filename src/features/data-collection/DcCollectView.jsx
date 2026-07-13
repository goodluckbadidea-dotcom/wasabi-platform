// ─── DcCollectView ───
// Public anonymous submission surface. Reached at /collect/:slug?t=<token>.
// Loads extension context + scoped items via the public share-link route,
// lets the user enter counts, and submits everything in one POST.
//
// Reuses much of DcWorkbook's shape but talks to /collect endpoints (no
// JWT). Intentionally minimal chrome: no top nav, no Wasabi theme switcher,
// no drawer. Just fill and submit.

import React, { useEffect, useMemo, useState } from "react";
import { C, FONT, MONO, RADIUS } from "../../design/tokens.js";
import { useTheme } from "../../context/ThemeContext.jsx";
import { TYPE_LABELS, computeTotal } from "./dcHelpers.js";
import { getWorkerUrl } from "../../lib/api.js";

export default function DcCollectView({ extensionSlug }) {
  useTheme();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [ctx, setCtx] = useState(null);           // { extension, share_link, items }
  const [entries, setEntries] = useState({});     // { [item_id]: partial entry }
  const [counterName, setCounterName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [page, setPage] = useState("");
  const [category, setCategory] = useState("");
  // Market picker state. Initialized from link.scope_market when ctx loads;
  // if the link is unscoped, we render a picker at the top so the counter
  // must choose before entering any values (each iPad = one market).
  const [pickedMarket, setPickedMarket] = useState("");

  // Parse token from URL
  const token = useMemo(() => {
    if (typeof window === "undefined") return "";
    return new URLSearchParams(window.location.search).get("t") || "";
  }, []);

  // Load context
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const workerBase = getWorkerUrl();
        const url = `${workerBase}/collect/${encodeURIComponent(extensionSlug)}?t=${encodeURIComponent(token)}`;
        const res = await fetch(url);
        const body = await res.json();
        if (!res.ok) throw new Error(body._error || `HTTP ${res.status}`);
        if (cancelled) return;
        setCtx(body);
        const link = body.share_link || {};
        setPage(link.scope_page || (body.extension?.ext_config?.pages?.[0]?.key || "packaging"));
        setCategory(body.extension?.ext_config?.channels?.[0]?.key || "");
      } catch (err) {
        if (!cancelled) setError(err.message || String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    if (extensionSlug && token) load();
    else if (!token) setError("Missing share-link token. Ask an admin for a new link.");
    return () => { cancelled = true; };
  }, [extensionSlug, token]);

  const config = ctx?.extension?.ext_config || {};
  const link = ctx?.share_link || {};
  const market = link.scope_market || pickedMarket || "";
  const marketLabel = (config.markets || []).find((m) => m.key === market)?.label || market;
  const pageDef = (config.pages || []).find((p) => p.key === page);
  const hasCategories = !!pageDef?.has_categories;
  const needsMarketPick = !link.scope_market && !pickedMarket;

  // Filter items to the scoped market + active page/category.
  // Backend already filters by scope_market when the link is scoped, but for
  // an unscoped link the server returned every item — client filters here.
  const filteredItems = useMemo(() => {
    return (ctx?.items || []).filter((it) => {
      if (!market) return false;
      if (Array.isArray(it.markets) && !it.markets.includes(market)) return false;
      if (page === "kitchen" && it.type_key !== "kitchen") return false;
      if (page === "sales" && it.type_key !== "marketing") return false;
      if (page === "packaging" && (it.type_key === "kitchen" || it.type_key === "marketing")) return false;
      if (hasCategories && it.channel && it.channel !== category) return false;
      return true;
    });
  }, [ctx, market, page, category, hasCategories]);

  const bySection = useMemo(() => {
    const groups = {};
    for (const it of filteredItems) {
      const t = it.type_key || "other";
      (groups[t] ||= []).push(it);
    }
    return groups;
  }, [filteredItems]);

  const counted = Object.values(entries).filter((e) => {
    if (!e) return false;
    if ((e.count_mode === "case" || e.count_mode === "roll")) return e.cases_count != null && Number(e.cases_count) !== 0;
    if (e.count_mode === "unit") return e.units_count != null && Number(e.units_count) !== 0;
    if (e.count_mode === "weight") return e.weight_value != null && Number(e.weight_value) !== 0;
    return false;
  }).length;
  const total = filteredItems.length;

  const onEntryChange = (item, patch) => {
    setEntries((prev) => {
      const cur = prev[item.id] || {
        item_id: item.id,
        count_mode: item.count_mode || "case",
        case_size_snapshot: item.case_size ?? null,
        weight_unit: item.weight_unit || null,
      };
      const next = { ...cur, ...patch };
      next.total_units = computeTotal(next.count_mode, next.cases_count, next.case_size_snapshot ?? item.case_size, next.units_count);
      return { ...prev, [item.id]: next };
    });
  };

  const doSubmit = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const workerBase = getWorkerUrl();
      const url = `${workerBase}/collect/${encodeURIComponent(extensionSlug)}/submissions?t=${encodeURIComponent(token)}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          market,
          page,
          category: hasCategories ? category : "",
          counter_name: counterName || "Guest",
          count_date: new Date().toISOString().slice(0, 10),
          entries: Object.values(entries).filter((e) => {
            if (!e) return false;
            if ((e.count_mode === "case" || e.count_mode === "roll")) return e.cases_count != null;
            if (e.count_mode === "unit") return e.units_count != null;
            if (e.count_mode === "weight") return e.weight_value != null;
            return false;
          }),
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body._error || `HTTP ${res.status}`);
      setSubmitted(true);
    } catch (err) {
      alert("Submit failed: " + (err.message || err));
    } finally {
      setSubmitting(false);
    }
  };

  // ── Render ──
  if (loading) return <div style={styles.centered}>Loading…</div>;
  if (error) return (
    <div style={styles.centered}>
      <div style={{ color: C.error, fontWeight: 600, marginBottom: 8 }}>Couldn't open this link</div>
      <div style={{ color: C.textMid, fontSize: 12, maxWidth: 460, textAlign: "center" }}>{error}</div>
    </div>
  );
  if (submitted) return (
    <div style={styles.centered}>
      <div style={{ color: C.success, fontSize: 32, marginBottom: 12 }}>✓</div>
      <div style={{ color: C.text, fontWeight: 600, marginBottom: 4 }}>Submitted</div>
      <div style={{ color: C.textMid, fontSize: 13, maxWidth: 460, textAlign: "center" }}>
        Your inventory count for {marketLabel || market} · {pageDef?.label || page} is saved. You can close this tab.
      </div>
    </div>
  );

  const pct = total === 0 ? 0 : Math.round((counted / total) * 100);

  return (
    <div style={styles.root}>
      <div style={styles.header}>
        <div style={styles.headerInner}>
          <div style={styles.headerLeft}>
            {market ? (
              <>
                <span style={styles.marketPill}>{market}</span>
                <h1 style={styles.h1}>{marketLabel || market}</h1>
              </>
            ) : (
              <h1 style={styles.h1}>Inventory count</h1>
            )}
            <span style={styles.linkLabel}>· {link.label || "Guest link"}</span>
          </div>
          <div style={styles.headerRight}>
            {market && (
              <div style={styles.progressText}>
                <strong style={{ color: C.text }}>{counted}</strong> of {total} rows
                {total > 0 ? ` · ${pct}%` : ""}
              </div>
            )}
          </div>
        </div>
      </div>

      <div style={styles.body}>
        {needsMarketPick && (
          <div style={styles.marketPickerCard}>
            <div style={styles.pickerKicker}>Choose a market to count</div>
            <div style={styles.pickerSub}>This link isn't scoped to a specific market. Pick the one you're counting for — the item list will filter to only that market's SKUs.</div>
            <div style={styles.pickerChoices}>
              {(config.markets || []).map((m) => (
                <button
                  key={m.key}
                  onClick={() => setPickedMarket(m.key)}
                  style={styles.pickerChoice}
                >
                  <span style={styles.pickerChoiceKey}>{m.key}</span>
                  <span style={styles.pickerChoiceLabel}>{m.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {!needsMarketPick && (
          <>
            {/* Page tabs — hidden if link is page-scoped */}
            {!link.scope_page && (
              <nav style={styles.pillTabs}>
                {(config.pages || []).map((p) => (
                  <button
                    key={p.key}
                    onClick={() => setPage(p.key)}
                    style={{ ...styles.pillTab, ...(page === p.key ? styles.pillTabOn : {}) }}
                  >{p.label}</button>
                ))}
              </nav>
            )}

            {/* Category tabs — Packaging only */}
            {hasCategories && (
              <nav style={{ ...styles.pillTabs, marginTop: 12 }}>
                {(config.channels || []).map((c) => (
                  <button
                    key={c.key}
                    onClick={() => setCategory(c.key)}
                    style={{ ...styles.pillTab, ...(category === c.key ? styles.pillTabOn : {}) }}
                  >{c.label}</button>
                ))}
              </nav>
            )}

            <main style={styles.sections}>
              {(config.item_types || [])
                .filter((t) => bySection[t.key]?.length)
                .map((t) => (
                  <Section key={t.key} title={TYPE_LABELS[t.key] || t.label} items={bySection[t.key]} entries={entries} onChange={onEntryChange} />
                ))}
              {total === 0 && (
                <div style={styles.emptyPage}>
                  No items to count for {marketLabel || market} · {pageDef?.label || page}
                  {hasCategories ? ` · ${config.channels.find(c => c.key === category)?.label || category}` : ""}.
                </div>
              )}
            </main>
          </>
        )}
      </div>

      <footer style={styles.footer}>
        <div style={styles.footerInner}>
          <div style={styles.footerId}>
            <div style={styles.footerField}>
              <label style={styles.footerLabel}>Your name</label>
              <input
                value={counterName}
                onChange={(e) => setCounterName(e.target.value)}
                placeholder="Type your name"
                style={styles.footerInput}
                autoComplete="off"
              />
            </div>
            <div style={styles.footerField}>
              <label style={styles.footerLabel}>Date</label>
              <div style={styles.footerValue}>{new Date().toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</div>
            </div>
          </div>
          <button
            onClick={doSubmit}
            disabled={submitting || counted === 0}
            style={{ ...styles.submitBtn, opacity: (submitting || counted === 0) ? 0.5 : 1, cursor: (submitting || counted === 0) ? "not-allowed" : "pointer" }}
          >
            {submitting ? "Submitting…" : "Submit count"}
          </button>
        </div>
      </footer>
    </div>
  );
}

function Section({ title, items, entries, onChange }) {
  return (
    <section style={styles.section}>
      <div style={styles.sectionHead}>
        <h2 style={styles.sectionH2}>{title}</h2>
      </div>
      <div style={styles.sectionCard}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={{ ...styles.th, width: "40%" }}>Item</th>
              <th style={{ ...styles.th, width: "20%" }}>Vendor</th>
              <th style={{ ...styles.th, ...styles.thNum, width: "12%" }}>Cases / Units</th>
              <th style={{ ...styles.th, ...styles.thNum, width: "14%" }}>Units per case</th>
              <th style={{ ...styles.th, ...styles.thNum, width: "14%", paddingRight: 24 }}>Total units</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <Row key={it.id} item={it} entry={entries[it.id]} onChange={onChange} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Row({ item, entry, onChange }) {
  const mode = item.count_mode || "case";
  const isCounted =
    ((mode === "case" || mode === "roll") && entry?.cases_count != null && Number(entry.cases_count) !== 0) ||
    (mode === "unit" && entry?.units_count != null && Number(entry.units_count) !== 0) ||
    (mode === "weight" && entry?.weight_value != null && Number(entry.weight_value) !== 0);

  const totalDisplay = entry?.total_units != null ? Math.round(Number(entry.total_units)).toLocaleString() :
                       (mode === "weight" && entry?.weight_value != null ? `${entry.weight_value} ${entry.weight_unit || item.weight_unit || ""}` : "—");

  return (
    <tr style={isCounted ? { ...styles.tr, ...styles.trCounted } : styles.tr}>
      <td style={styles.td}>
        <span style={styles.itemCode}>{item.sku}{item.description ? ` · ${item.description}` : ""}</span>
      </td>
      <td style={styles.td}>
        <span style={styles.vendorLabel}>{item.vendor_name || "—"}</span>
      </td>
      <td style={{ ...styles.td, ...styles.tdNum }}>
        {(mode === "case" || mode === "roll") && (
          <input type="number" step="any" defaultValue={entry?.cases_count ?? ""} placeholder="0" style={styles.numInput}
            onChange={(e) => onChange(item, { cases_count: e.target.value === "" ? null : Number(e.target.value), count_mode: mode, case_size_snapshot: item.case_size ?? null })} />
        )}
        {mode === "unit" && (
          <input type="number" step="any" defaultValue={entry?.units_count ?? ""} placeholder="0" style={styles.numInput}
            onChange={(e) => onChange(item, { units_count: e.target.value === "" ? null : Number(e.target.value), count_mode: "unit" })} />
        )}
        {mode === "weight" && (
          <input type="number" step="any" defaultValue={entry?.weight_value ?? ""} placeholder="0" style={styles.numInput}
            onChange={(e) => onChange(item, { weight_value: e.target.value === "" ? null : Number(e.target.value), count_mode: "weight", weight_unit: item.weight_unit })} />
        )}
      </td>
      <td style={{ ...styles.td, ...styles.tdNum }}>
        {(mode === "case" || mode === "roll") && <span style={styles.roCaseSize}>{item.case_size ?? "—"}</span>}
        {mode === "weight" && <span style={styles.roCaseSize}>{item.weight_unit || "—"}</span>}
        {mode === "unit" && <span style={styles.roCaseSize}>—</span>}
      </td>
      <td style={{ ...styles.td, ...styles.tdTotal }}>{totalDisplay}</td>
    </tr>
  );
}

function buildStyles() { return {
  root: {
    // Fixed viewport so header/footer stay pinned and body scrolls between.
    height: "100vh",
    maxHeight: "100vh",
    background: C.bg,
    color: C.text,
    fontFamily: FONT,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },
  centered: {
    minHeight: "100vh",
    background: C.bg,
    color: C.text,
    fontFamily: FONT,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: 40,
  },
  header: {
    // Transparent so the page's radial bgGradient flows through without a
    // seam between the header strip and the workspace below.
    background: "transparent",
    borderBottom: `1px solid ${C.edgeLine}`,
    padding: "16px 24px",
    position: "sticky",
    top: 0,
    zIndex: 30,
  },
  headerInner: {
    maxWidth: 1360,
    margin: "0 auto",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 20,
    flexWrap: "wrap",
  },
  headerLeft: { display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" },
  kicker: {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: "0.14em",
    textTransform: "uppercase",
    color: C.accent,
  },
  marketPill: {
    fontFamily: FONT,
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.14em",
    textTransform: "uppercase",
    color: C.accent,
    background: `color-mix(in srgb, ${C.accent} 14%, transparent)`,
    padding: "5px 11px",
    borderRadius: RADIUS.pill,
  },
  h1: {
    fontFamily: FONT,
    fontSize: 22,
    fontWeight: 700,
    letterSpacing: "-0.02em",
    color: C.text,
  },
  linkLabel: {
    fontFamily: FONT,
    fontSize: 12,
    fontWeight: 500,
    color: C.textMid,
  },
  headerRight: { display: "flex", alignItems: "center", gap: 12 },
  progressText: {
    fontFamily: FONT,
    color: C.textMid,
    fontVariantNumeric: "tabular-nums",
    fontSize: 13,
  },
  // Body scrolls between the sticky header and the sticky footer. Fixed
  // total viewport (100vh) minus a bottom pad big enough to clear the
  // sticky footer + typical mobile safe-area.
  body: {
    maxWidth: 1360,
    margin: "0 auto",
    padding: "24px 24px 140px",
    flex: 1,
    width: "100%",
    minHeight: 0,
    overflowY: "auto",
  },

  // Market picker (shown when the share link is unscoped)
  marketPickerCard: {
    background: C.surface,
    border: `1px solid ${C.border}`,
    borderRadius: RADIUS.lg,
    padding: 28,
    maxWidth: 640,
    margin: "0 auto",
    display: "flex",
    flexDirection: "column",
    gap: 14,
  },
  pickerKicker: {
    fontFamily: FONT,
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    color: C.accent,
  },
  pickerSub: {
    fontFamily: FONT,
    fontSize: 14,
    color: C.textMid,
    lineHeight: 1.5,
  },
  pickerChoices: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
    gap: 10,
    marginTop: 6,
  },
  pickerChoice: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: 4,
    padding: "14px 16px",
    background: C.dark,
    border: `1px solid ${C.border}`,
    borderRadius: RADIUS.md,
    fontFamily: FONT,
    cursor: "pointer",
    color: C.text,
    minHeight: 68,
    transition: "border-color 0.15s, background 0.15s",
  },
  pickerChoiceKey: {
    fontFamily: FONT,
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: "0.12em",
    color: C.accent,
  },
  pickerChoiceLabel: {
    fontFamily: FONT,
    fontSize: 14,
    fontWeight: 600,
    color: C.text,
  },

  // Row state + read-only cells (mirrors DcWorkbook)
  tr: {},
  trCounted: { boxShadow: `inset 3px 0 0 ${C.accent}` },
  roCaseSize: {
    display: "inline-block",
    padding: "9px 10px",
    fontFamily: FONT,
    fontSize: 13,
    color: C.textMid,
    fontVariantNumeric: "tabular-nums",
    minWidth: 60,
    textAlign: "right",
  },
  pillTabs: {
    display: "flex",
    gap: 4,
    padding: 4,
    background: C.surface,
    border: `1px solid ${C.border}`,
    borderRadius: RADIUS.pill,
    width: "fit-content",
  },
  pillTab: {
    fontFamily: FONT,
    fontWeight: 600,
    fontSize: 13,
    padding: "9px 20px",
    color: C.textMid,
    background: "transparent",
    border: "none",
    borderRadius: RADIUS.pill,
    cursor: "pointer",
  },
  pillTabOn: {
    background: C.accent,
    color: "#0A1114",
  },
  sections: { display: "flex", flexDirection: "column", gap: 32, marginTop: 24 },
  section: {},
  sectionHead: { marginBottom: 12 },
  sectionH2: {
    fontFamily: FONT,
    fontSize: 15,
    fontWeight: 700,
    letterSpacing: "-0.01em",
    color: C.text,
  },
  sectionCard: {
    background: C.surface,
    border: `1px solid ${C.border}`,
    borderRadius: RADIUS.lg,
    overflow: "hidden",
  },
  table: { width: "100%", borderCollapse: "collapse" },
  th: {
    textAlign: "left",
    padding: "11px 18px",
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
  thNum: { textAlign: "right" },
  td: {
    padding: "12px 18px",
    borderBottom: `1px solid ${C.edgeLine}`,
    color: C.text,
    fontSize: 13,
    verticalAlign: "middle",
  },
  tdNum: { textAlign: "right" },
  tdTotal: {
    textAlign: "right",
    paddingRight: 24,
    fontFamily: FONT,
    color: C.text,
    fontSize: 13,
    fontWeight: 500,
    fontVariantNumeric: "tabular-nums",
  },
  itemCode: {
    fontFamily: FONT,
    fontSize: 14,
    fontWeight: 500,
    color: C.text,
  },
  vendorLabel: {
    fontSize: 12,
    color: C.textMid,
  },
  numInput: {
    background: C.dark,
    border: `1px solid ${C.border}`,
    borderRadius: RADIUS.md,
    color: C.text,
    fontFamily: FONT,
    fontSize: 14,
    padding: "9px 12px",
    textAlign: "right",
    width: 108,
    outline: "none",
    fontVariantNumeric: "tabular-nums",
    minHeight: 40,
    fontWeight: 500,
  },
  emptyPage: {
    padding: 60,
    textAlign: "center",
    background: C.surface,
    border: `1px dashed ${C.border}`,
    borderRadius: RADIUS.lg,
    color: C.muted,
  },
  footer: {
    position: "fixed",
    left: 0, right: 0, bottom: 0,
    background: `color-mix(in srgb, ${C.bg} 90%, transparent)`,
    backdropFilter: "blur(14px)",
    WebkitBackdropFilter: "blur(14px)",
    borderTop: `1px solid ${C.edgeLine}`,
    padding: "14px 24px",
    zIndex: 40,
  },
  footerInner: {
    maxWidth: 1360,
    margin: "0 auto",
    display: "flex",
    alignItems: "center",
    gap: 24,
    justifyContent: "space-between",
  },
  footerId: { display: "flex", alignItems: "center", gap: 24, flex: 1, minWidth: 0 },
  footerField: { display: "flex", flexDirection: "column", gap: 2 },
  footerLabel: {
    fontFamily: FONT,
    fontSize: 9,
    fontWeight: 700,
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    color: C.muted,
  },
  footerInput: {
    background: "transparent",
    border: "none",
    borderBottom: `1px solid ${C.border2}`,
    color: C.text,
    fontFamily: FONT,
    fontSize: 14,
    fontWeight: 500,
    padding: "4px 0",
    outline: "none",
    width: 180,
  },
  footerValue: {
    fontFamily: FONT,
    fontSize: 14,
    fontWeight: 500,
    color: C.textMid,
    padding: "4px 0",
  },
  submitBtn: {
    background: `linear-gradient(135deg, ${C.accent}, color-mix(in srgb, ${C.accent} 80%, black))`,
    color: "#0A1114",
    border: "none",
    borderRadius: RADIUS.pill,
    padding: "11px 22px",
    fontFamily: FONT,
    fontSize: 13,
    fontWeight: 600,
    minHeight: 42,
  },
};
}

const styles = new Proxy({}, { get: (_, k) => buildStyles()[k] });
