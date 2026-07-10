// ─── DcWorkbook ───
// Market workbook fill UI. Pages (Packaging / Kitchen / Sales), categories
// inside Packaging (Drops / Smoky / Hemp), and item-type sections. Reads
// filtered items from the master sheet and lets the counter enter values
// live; auto-saves as a draft submission after each edit; review-and-submit
// modal at the bottom.
//
// Data model per fill:
//   1 dc_submission (draft) per (market, page[, category?]) tuple
//   N dc_submission_entries within that submission, upsert-per-item

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { C, FONT, MONO, RADIUS } from "../../design/tokens.js";
import { useTheme } from "../../context/ThemeContext.jsx";
import { TYPE_LABELS, computeTotal } from "./dcHelpers.js";
import { dcCreateSubmission, dcUpdateSubmission, dcUpsertEntry, dcListSubmissions, dcGetSubmission } from "../../lib/api.js";

// Debounce helper — 600ms after last keystroke before write
function useDebouncedCallback(fn, delay = 600) {
  const ref = useRef({ fn, timer: null });
  useEffect(() => { ref.current.fn = fn; }, [fn]);
  return useCallback((...args) => {
    if (ref.current.timer) clearTimeout(ref.current.timer);
    ref.current.timer = setTimeout(() => ref.current.fn(...args), delay);
  }, [delay]);
}

export default function DcWorkbook({ extension, market, items, onSubmitted, onBack }) {
  useTheme();
  const config = extension?.ext_config || {};
  const pages = Array.isArray(config.pages) ? config.pages : [];
  const channels = Array.isArray(config.channels) ? config.channels : [];
  const itemTypes = Array.isArray(config.item_types) ? config.item_types : [];

  const [activePage, setActivePage] = useState(pages[0]?.key || "packaging");
  const activePageDef = pages.find((p) => p.key === activePage);
  const hasCategories = !!activePageDef?.has_categories;
  const [activeCategory, setActiveCategory] = useState(channels[0]?.key || "drops");

  const [submission, setSubmission] = useState(null);
  const [entries, setEntries] = useState({}); // { [item_id]: entry }
  const [saveState, setSaveState] = useState("saved");
  const [counterName, setCounterName] = useState("");
  const [reviewOpen, setReviewOpen] = useState(false);

  // ── Filter items for the active page + category ──
  const filteredItems = useMemo(() => {
    return (items || []).filter((it) => {
      if (!Array.isArray(it.markets) || !it.markets.includes(market.key)) return false;
      if (hasCategories && it.channel && it.channel !== activeCategory) {
        // Some items may have empty channel — treat them as generic
        return false;
      }
      // Filter by page — items with type_key that belongs to this page
      // Simple rule: kitchen types → kitchen page, marketing → sales page,
      // everything else → packaging page.
      if (activePage === "kitchen"    && it.type_key !== "kitchen") return false;
      if (activePage === "sales"      && it.type_key !== "marketing") return false;
      if (activePage === "packaging"  && (it.type_key === "kitchen" || it.type_key === "marketing")) return false;
      return true;
    });
  }, [items, market, activePage, activeCategory, hasCategories]);

  // Group items by type
  const bySection = useMemo(() => {
    const groups = {};
    for (const it of filteredItems) {
      const t = it.type_key || "other";
      (groups[t] ||= []).push(it);
    }
    return groups;
  }, [filteredItems]);

  // ── Find or create the draft submission for (market, page[, category]) ──
  useEffect(() => {
    let cancelled = false;
    async function findOrCreate() {
      setSaveState("saved");
      try {
        // Try existing draft
        const filters = {
          market: market.key,
          page: activePage,
          status: "draft",
          limit: 20,
        };
        const res = await dcListSubmissions(extension.slug, filters);
        let draft = (res.submissions || []).find(
          (s) => (s.category || "") === (hasCategories ? activeCategory : "")
        );
        if (!draft) {
          const created = await dcCreateSubmission(extension.slug, {
            market: market.key,
            page: activePage,
            category: hasCategories ? activeCategory : "",
            status: "draft",
          });
          draft = created;
        }
        if (cancelled) return;
        setSubmission(draft);
        setCounterName(draft.counter_name || "");
        // Load full submission with entries
        const full = await dcGetSubmission(draft.id);
        if (cancelled) return;
        const entryMap = {};
        for (const e of (full.entries || [])) entryMap[e.item_id] = e;
        setEntries(entryMap);
      } catch (err) {
        console.error("[DcWorkbook] failed to open draft", err);
      }
    }
    if (extension && market) findOrCreate();
    return () => { cancelled = true; };
  }, [extension, market, activePage, activeCategory, hasCategories]);

  // ── Debounced counter-name save ──
  const saveCounterName = useDebouncedCallback(async (name) => {
    if (!submission) return;
    setSaveState("saving");
    try {
      await dcUpdateSubmission(submission.id, { counter_name: name });
      setSaveState("saved");
    } catch {
      setSaveState("saved");
    }
  });

  // ── Debounced entry write ──
  const writeEntry = useDebouncedCallback(async (itemId, patch) => {
    if (!submission) return;
    setSaveState("saving");
    try {
      const result = await dcUpsertEntry(submission.id, { item_id: itemId, ...patch });
      setEntries((prev) => ({ ...prev, [itemId]: result }));
      setSaveState("saved");
    } catch {
      setSaveState("saved");
    }
  }, 500);

  const onEntryChange = (item, patch) => {
    // Optimistic local state — compute total for display
    const prev = entries[item.id] || {
      submission_id: submission?.id,
      item_id: item.id,
      count_mode: item.count_mode || "case",
      case_size_snapshot: item.case_size ?? null,
      weight_unit: item.weight_unit || null,
    };
    const next = { ...prev, ...patch };
    next.total_units = computeTotal(next.count_mode, next.cases_count, next.case_size_snapshot ?? item.case_size, next.units_count);
    setEntries((cur) => ({ ...cur, [item.id]: next }));
    writeEntry(item.id, patch);
  };

  const counted = Object.values(entries).filter((e) => {
    if (!e) return false;
    if (e.count_mode === "case") return e.cases_count != null && Number(e.cases_count) !== 0;
    if (e.count_mode === "unit") return e.units_count != null && Number(e.units_count) !== 0;
    if (e.count_mode === "weight") return e.weight_value != null && Number(e.weight_value) !== 0;
    return false;
  }).length;
  const total = filteredItems.length;
  const pct = total === 0 ? 0 : Math.round((counted / total) * 100);
  const canSubmit = counted > 0;

  const doSubmit = async () => {
    if (!submission) return;
    setSaveState("saving");
    try {
      await dcUpdateSubmission(submission.id, {
        status: "submitted",
        counter_name: counterName,
        count_date: new Date().toISOString().slice(0, 10),
      });
      setSaveState("saved");
      onSubmitted();
    } catch (err) {
      alert("Submit failed: " + (err.message || err));
      setSaveState("saved");
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.head}>
        <div style={styles.titleRow}>
          <span style={styles.marketPill}>{market.key}</span>
          <h1 style={styles.h1}>{market.label}</h1>
        </div>
        <div style={styles.sub}>Weekly count. Each page is submitted independently by whoever counts it.</div>

        {/* Page pill tabs */}
        <nav style={styles.pillTabs} role="tablist">
          {pages.map((p) => (
            <button
              key={p.key}
              onClick={() => setActivePage(p.key)}
              style={{ ...styles.pillTab, ...(activePage === p.key ? styles.pillTabOn : {}) }}
            >{p.label}</button>
          ))}
        </nav>
      </div>

      {/* Category pill tabs (Packaging only) */}
      {hasCategories && (
        <div style={styles.categoryRow}>
          <div style={styles.pillTabs}>
            {channels.map((c) => (
              <button
                key={c.key}
                onClick={() => setActiveCategory(c.key)}
                style={{ ...styles.pillTab, ...(activeCategory === c.key ? styles.pillTabOn : {}) }}
              >{c.label}</button>
            ))}
          </div>
          <div style={styles.progressStrip}>
            <span style={{ fontFamily: MONO, color: C.text, fontVariantNumeric: "tabular-nums" }}>{counted} of {total} rows counted</span>
            <div style={styles.progressBar}>
              <div style={{ ...styles.progressFill, width: `${pct}%` }} />
            </div>
            <span style={{ ...styles.pct }}>{pct}%</span>
          </div>
        </div>
      )}

      {!hasCategories && (
        <div style={styles.progressStripSolo}>
          <span style={{ fontFamily: MONO, color: C.text, fontVariantNumeric: "tabular-nums" }}>{counted} of {total} rows counted</span>
          <div style={styles.progressBar}>
            <div style={{ ...styles.progressFill, width: `${pct}%` }} />
          </div>
          <span style={{ ...styles.pct }}>{pct}%</span>
        </div>
      )}

      {/* Sections */}
      <main style={styles.sections}>
        {itemTypes
          .filter((t) => bySection[t.key]?.length)
          .map((t) => (
            <Section
              key={t.key}
              title={TYPE_LABELS[t.key] || t.label}
              items={bySection[t.key]}
              entries={entries}
              onChange={onEntryChange}
            />
          ))}
        {total === 0 && (
          <div style={styles.emptyPage}>
            <div style={{ fontWeight: 600, marginBottom: 6, color: C.textMid }}>Nothing to count here yet.</div>
            <div style={{ fontSize: 12, color: C.muted, maxWidth: 420, textAlign: "center", lineHeight: 1.5 }}>
              No items in the Master Item Sheet match this market × page{hasCategories ? " × category" : ""}. Add items in the Master Sheet to see them here.
            </div>
          </div>
        )}
      </main>

      {/* Sticky footer */}
      <footer style={styles.footer}>
        <div style={styles.footerInner}>
          <div style={styles.footerId}>
            <div style={styles.footerField}>
              <label style={styles.footerLabel}>Counted by</label>
              <input
                value={counterName}
                onChange={(e) => { setCounterName(e.target.value); saveCounterName(e.target.value); }}
                placeholder="Your name"
                style={styles.footerInput}
                autoComplete="off"
              />
            </div>
            <div style={styles.footerField}>
              <label style={styles.footerLabel}>Date of count</label>
              <div style={styles.footerValue}>{new Date().toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</div>
            </div>
            <div style={styles.footerSave}>
              <span style={{ ...styles.saveDot, background: saveState === "saving" ? C.warning : C.success }} />
              <span>{saveState === "saving" ? "Saving draft…" : "Draft saved · just now"}</span>
            </div>
          </div>
          <div style={styles.footerRight}>
            <div style={styles.footerProgress}>
              <div><strong style={{ color: C.text }}>{counted}</strong> of {total} rows</div>
              <div style={{ opacity: 0.7 }}>{pct}% complete</div>
            </div>
            <button
              onClick={() => setReviewOpen(true)}
              disabled={!canSubmit}
              style={{ ...styles.submitBtn, opacity: canSubmit ? 1 : 0.5, cursor: canSubmit ? "pointer" : "not-allowed" }}
            >
              Review &amp; Submit
            </button>
          </div>
        </div>
      </footer>

      {reviewOpen && (
        <ReviewModal
          market={market}
          page={activePageDef}
          counter={counterName || "—"}
          counted={counted}
          total={total}
          onCancel={() => setReviewOpen(false)}
          onSubmit={doSubmit}
        />
      )}
    </div>
  );
}

// ── Section ──
function Section({ title, items, entries, onChange }) {
  const countedIn = items.filter((it) => {
    const e = entries[it.id];
    if (!e) return false;
    if (e.count_mode === "case") return e.cases_count != null && Number(e.cases_count) !== 0;
    if (e.count_mode === "unit") return e.units_count != null && Number(e.units_count) !== 0;
    if (e.count_mode === "weight") return e.weight_value != null && Number(e.weight_value) !== 0;
    return false;
  }).length;
  return (
    <section style={styles.section}>
      <div style={styles.sectionHead}>
        <h2 style={styles.sectionH2}>{title}</h2>
        <span style={styles.sectionCount}>{countedIn} of {items.length} counted</span>
      </div>
      <div style={styles.sectionCard}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={{ ...styles.th, width: "40%" }}>Item</th>
              <th style={{ ...styles.th, width: "20%" }}>Vendor</th>
              <th style={{ ...styles.th, ...styles.thNum, width: "12%" }}>{"Cases / Units"}</th>
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

// ── Row ──
function Row({ item, entry, onChange }) {
  const mode = item.count_mode || "case";
  const isCounted =
    (mode === "case" && entry?.cases_count != null && Number(entry.cases_count) !== 0) ||
    (mode === "unit" && entry?.units_count != null && Number(entry.units_count) !== 0) ||
    (mode === "weight" && entry?.weight_value != null && Number(entry.weight_value) !== 0);

  const totalDisplay = entry?.total_units != null ? Math.round(Number(entry.total_units)).toLocaleString() :
                       (mode === "weight" && entry?.weight_value != null ? `${entry.weight_value} ${entry.weight_unit || item.weight_unit || ""}` : "—");

  return (
    <tr style={isCounted ? { ...styles.tr, ...styles.trCounted } : styles.tr}>
      <td style={styles.td}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={styles.itemCode}>{item.sku}{item.description ? ` · ${item.description}` : ""}</span>
        </div>
      </td>
      <td style={styles.td}>
        <span style={styles.vendorLabel}>{item.vendor_name || "—"}</span>
      </td>
      <td style={{ ...styles.td, ...styles.tdNum }}>
        {mode === "case" && (
          <input
            type="number"
            step="any"
            defaultValue={entry?.cases_count ?? ""}
            onChange={(e) => onChange(item, { cases_count: e.target.value === "" ? null : Number(e.target.value), count_mode: "case", case_size_snapshot: item.case_size ?? null })}
            placeholder="0"
            style={styles.numInput}
          />
        )}
        {mode === "unit" && (
          <input
            type="number"
            step="any"
            defaultValue={entry?.units_count ?? ""}
            onChange={(e) => onChange(item, { units_count: e.target.value === "" ? null : Number(e.target.value), count_mode: "unit" })}
            placeholder="0"
            style={styles.numInput}
          />
        )}
        {mode === "weight" && (
          <input
            type="number"
            step="any"
            defaultValue={entry?.weight_value ?? ""}
            onChange={(e) => onChange(item, { weight_value: e.target.value === "" ? null : Number(e.target.value), count_mode: "weight", weight_unit: item.weight_unit })}
            placeholder="0"
            style={styles.numInput}
          />
        )}
      </td>
      <td style={{ ...styles.td, ...styles.tdNum }}>
        {mode === "case" && (
          <input
            type="number"
            step="any"
            defaultValue={entry?.case_size_snapshot ?? item.case_size ?? ""}
            onChange={(e) => onChange(item, { case_size_snapshot: e.target.value === "" ? null : Number(e.target.value), count_mode: "case" })}
            style={styles.numInputGhost}
          />
        )}
        {mode === "weight" && <span style={{ color: C.muted, fontFamily: MONO, fontSize: 11 }}>{item.weight_unit || "—"}</span>}
        {mode === "unit" && <span style={{ color: C.muted, fontFamily: MONO, fontSize: 11 }}>—</span>}
      </td>
      <td style={{ ...styles.td, ...styles.tdTotal }}>{totalDisplay}</td>
    </tr>
  );
}

// ── Review Modal ──
function ReviewModal({ market, page, counter, counted, total, onCancel, onSubmit }) {
  const blank = total - counted;
  return (
    <div style={styles.modalOverlay} onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div style={styles.modalCard}>
        <div style={styles.modalHead}>
          <h3 style={styles.modalTitle}>Review before submitting</h3>
          <p style={styles.modalSub}>You're submitting <strong>{page?.label || "the page"}</strong> for <strong>{market.label}</strong>. This is time-, date-, and user-stamped and feeds the inventory reports.</p>
        </div>
        <div style={styles.modalBody}>
          <ReviewRow label="Counted by" val={counter} />
          <ReviewRow label="Date of count" val={new Date().toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })} />
          <ReviewRow label="Rows counted" val={`${counted} of ${total}`} />
          <ReviewRow label="Rows left blank" val={String(blank)} warning={blank > 0} />
          {blank > 0 && (
            <div style={styles.warn}>
              <span style={{ color: C.warning, fontWeight: 700, fontSize: 12 }}>⚠</span>
              <div style={{ fontSize: 12, color: C.textMid, lineHeight: 1.5 }}>
                Blank rows are treated as <strong style={{ color: C.text }}>zero on-site</strong>. If you're only responsible for part of this page, coordinate with your teammate before submitting.
              </div>
            </div>
          )}
        </div>
        <div style={styles.modalFoot}>
          <button style={styles.secondaryBtn} onClick={onCancel}>Keep editing</button>
          <button style={styles.submitBtn} onClick={onSubmit}>Submit page</button>
        </div>
      </div>
    </div>
  );
}

function ReviewRow({ label, val, warning }) {
  return (
    <div style={{ ...styles.reviewRow, ...(warning ? { color: C.warning } : {}) }}>
      <span style={styles.reviewLabel}>{label}</span>
      <span style={{ ...styles.reviewVal, color: warning ? C.warning : C.text }}>{val}</span>
    </div>
  );
}

function buildStyles() { return {
  container: {
    maxWidth: 1360,
    margin: "0 auto",
    padding: "24px 24px 100px",
    position: "relative",
  },
  head: { paddingBottom: 12 },
  titleRow: { display: "flex", alignItems: "baseline", gap: 14, marginBottom: 6 },
  h1: {
    fontFamily: FONT,
    fontSize: 28,
    fontWeight: 700,
    letterSpacing: "-0.02em",
    color: C.text,
  },
  marketPill: {
    fontFamily: FONT,
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    color: C.accent,
    background: `color-mix(in srgb, ${C.accent} 14%, transparent)`,
    padding: "5px 11px",
    borderRadius: RADIUS.pill,
  },
  sub: { fontSize: 13, color: C.textMid, maxWidth: 720 },
  pillTabs: {
    display: "flex",
    gap: 4,
    padding: 4,
    background: C.surface,
    border: `1px solid ${C.border}`,
    borderRadius: RADIUS.pill,
    width: "fit-content",
    marginTop: 20,
  },
  pillTab: {
    fontFamily: FONT,
    fontWeight: 600,
    fontSize: 13,
    letterSpacing: "0.02em",
    padding: "9px 20px",
    color: C.textMid,
    background: "transparent",
    border: "none",
    borderRadius: RADIUS.pill,
    cursor: "pointer",
    minHeight: 40,
  },
  pillTabOn: {
    background: C.accent,
    color: "#0A1114",
  },
  categoryRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 20,
    marginTop: 6,
    marginBottom: 18,
    flexWrap: "wrap",
  },
  progressStrip: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    fontSize: 12,
    color: C.muted,
    padding: 12,
  },
  progressStripSolo: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    fontSize: 12,
    color: C.muted,
    padding: "16px 0 18px",
  },
  progressBar: {
    width: 180,
    height: 3,
    background: C.border,
    borderRadius: 2,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    background: C.accent,
    transition: "width 0.4s ease",
    borderRadius: 2,
  },
  pct: {
    fontFamily: MONO,
    fontVariantNumeric: "tabular-nums",
    color: C.text,
    fontWeight: 600,
    minWidth: 36,
    textAlign: "right",
  },
  sections: {
    display: "flex",
    flexDirection: "column",
    gap: 32,
  },
  section: {},
  sectionHead: {
    display: "flex",
    alignItems: "baseline",
    gap: 16,
    marginBottom: 12,
  },
  sectionH2: {
    fontFamily: FONT,
    fontSize: 15,
    fontWeight: 700,
    letterSpacing: "-0.01em",
    color: C.text,
  },
  sectionCount: {
    fontFamily: MONO,
    fontSize: 11,
    color: C.muted,
    fontVariantNumeric: "tabular-nums",
    marginLeft: "auto",
    letterSpacing: "0.04em",
  },
  sectionCard: {
    background: C.surface,
    border: `1px solid ${C.border}`,
    borderRadius: RADIUS.lg,
    overflow: "hidden",
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    fontVariantNumeric: "tabular-nums",
  },
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
  tr: {},
  trCounted: {
    boxShadow: `inset 3px 0 0 ${C.accent}`,
  },
  td: {
    padding: "12px 18px",
    borderBottom: `1px solid ${C.edgeLine}`,
    color: C.text,
    verticalAlign: "middle",
    fontSize: 13,
  },
  tdNum: { textAlign: "right" },
  tdTotal: {
    textAlign: "right",
    paddingRight: 24,
    fontFamily: MONO,
    color: C.text,
    fontSize: 13,
    fontWeight: 500,
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
    fontFamily: MONO,
    fontSize: 14,
    padding: "9px 12px",
    textAlign: "right",
    width: 108,
    outline: "none",
    fontVariantNumeric: "tabular-nums",
    minHeight: 40,
    fontWeight: 500,
  },
  numInputGhost: {
    background: "transparent",
    border: `1px solid transparent`,
    borderRadius: RADIUS.md,
    color: C.textMid,
    fontFamily: MONO,
    fontSize: 13,
    padding: "9px 10px",
    textAlign: "right",
    width: 80,
    outline: "none",
    fontVariantNumeric: "tabular-nums",
    minHeight: 40,
  },
  emptyPage: {
    background: C.surface,
    border: `1px dashed ${C.border}`,
    borderRadius: RADIUS.lg,
    padding: 60,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
  },
  // Sticky footer
  footer: {
    position: "fixed",
    left: 0, right: 0, bottom: 0,
    zIndex: 40,
    background: `color-mix(in srgb, ${C.bg} 90%, transparent)`,
    backdropFilter: "saturate(1.4) blur(14px)",
    WebkitBackdropFilter: "saturate(1.4) blur(14px)",
    borderTop: `1px solid ${C.edgeLine}`,
    padding: "14px 24px",
  },
  footerInner: {
    maxWidth: 1360,
    margin: "0 auto",
    display: "flex",
    alignItems: "center",
    gap: 28,
  },
  footerId: {
    display: "flex",
    alignItems: "center",
    gap: 24,
    flex: 1,
    minWidth: 0,
  },
  footerField: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
  },
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
    fontFamily: MONO,
    fontSize: 14,
    fontWeight: 500,
    color: C.textMid,
    padding: "4px 0",
  },
  footerSave: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 12,
    color: C.textMid,
  },
  saveDot: {
    width: 7, height: 7, borderRadius: "50%",
  },
  footerRight: {
    display: "flex",
    alignItems: "center",
    gap: 14,
    flexShrink: 0,
  },
  footerProgress: {
    fontFamily: MONO,
    fontSize: 12,
    color: C.textMid,
    fontVariantNumeric: "tabular-nums",
    textAlign: "right",
    lineHeight: 1.35,
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
    cursor: "pointer",
  },
  secondaryBtn: {
    background: C.surfaceAlt,
    color: C.text,
    border: `1px solid ${C.border}`,
    padding: "9px 18px",
    borderRadius: RADIUS.md,
    fontFamily: FONT,
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
  },
  // Modal
  modalOverlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.55)",
    backdropFilter: "blur(6px)",
    WebkitBackdropFilter: "blur(6px)",
    zIndex: 500,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  modalCard: {
    background: C.surface,
    border: `1px solid ${C.border}`,
    borderRadius: RADIUS.lg,
    boxShadow: "0 8px 32px rgba(0,0,0,0.32)",
    width: "100%",
    maxWidth: 560,
    overflow: "hidden",
  },
  modalHead: { padding: "22px 24px 14px", borderBottom: `1px solid ${C.edgeLine}` },
  modalTitle: {
    fontFamily: FONT,
    fontSize: 18,
    fontWeight: 700,
    letterSpacing: "-0.01em",
    color: C.text,
    marginBottom: 4,
  },
  modalSub: { fontSize: 13, color: C.textMid },
  modalBody: { padding: "18px 24px" },
  reviewRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
    padding: "10px 0",
    borderBottom: `1px solid ${C.edgeLine}`,
    fontSize: 13,
  },
  reviewLabel: { color: C.textMid },
  reviewVal: { fontFamily: MONO, color: C.text, fontVariantNumeric: "tabular-nums", fontWeight: 500 },
  warn: {
    marginTop: 14,
    padding: "12px 14px",
    background: `color-mix(in srgb, ${C.warning} 12%, transparent)`,
    border: `1px solid color-mix(in srgb, ${C.warning} 24%, transparent)`,
    borderRadius: RADIUS.md,
    display: "flex",
    gap: 10,
    alignItems: "flex-start",
  },
  modalFoot: {
    padding: "16px 24px",
    borderTop: `1px solid ${C.edgeLine}`,
    display: "flex",
    justifyContent: "flex-end",
    gap: 10,
    background: `color-mix(in srgb, ${C.surface} 60%, ${C.bg})`,
  },
};
}

const styles = new Proxy({}, { get: (_, k) => buildStyles()[k] });
