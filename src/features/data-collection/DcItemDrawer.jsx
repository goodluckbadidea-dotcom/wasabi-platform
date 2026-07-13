// ─── DcItemDrawer ───
// Wasabi-style side drawer that edits (or creates) a Master Item Sheet row.
// Contains: SKU, description, channel, markets multi-select, type, vendor
// combobox (Vendor CRM), counted-as mode, and a conditional next field
// (units-per-case for case mode; weight unit for weight mode; nothing for
// unit mode).

import React, { useEffect, useMemo, useState } from "react";
import { C, FONT, MONO, RADIUS } from "../../design/tokens.js";
import { useTheme } from "../../context/ThemeContext.jsx";
import { WEIGHT_UNITS } from "./dcHelpers.js";
import { dcCreateItem, dcUpdateItem, dcDeleteItem } from "../../lib/api.js";
import DcVendorCombobox from "./DcVendorCombobox.jsx";

export default function DcItemDrawer({ extension, item, onClose, onSaved }) {
  useTheme();
  const isNew = !item;
  const config = extension?.ext_config || {};
  const channels = Array.isArray(config.channels) ? config.channels : [];
  const itemTypes = Array.isArray(config.item_types) ? config.item_types : [];
  const markets = Array.isArray(config.markets) ? config.markets : [];

  // Form state
  const [sku, setSku] = useState(item?.sku || "");
  const [description, setDescription] = useState(item?.description || "");
  const [channel, setChannel] = useState(item?.channel || channels[0]?.key || "");
  const [marketKeys, setMarketKeys] = useState(new Set(Array.isArray(item?.markets) ? item.markets : []));
  const [typeKey, setTypeKey] = useState(item?.type_key || itemTypes[0]?.key || "");
  const [vendor, setVendor] = useState({
    ref: item?.vendor_ref || "",
    name: item?.vendor_name || "",
  });
  const [countMode, setCountMode] = useState(item?.count_mode || "case");
  const [caseSize, setCaseSize] = useState(item?.case_size ?? "");
  const [weightUnit, setWeightUnit] = useState(item?.weight_unit || "lbs");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    // Focus the SKU input when the drawer opens
    const t = setTimeout(() => {
      const el = document.getElementById("dc-item-sku");
      if (el) el.focus();
    }, 40);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const toggleMarket = (k) => {
    setMarketKeys((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  };

  const canSave = useMemo(() => {
    if (!sku.trim()) return false;
    if (countMode === "case" && (caseSize === "" || Number.isNaN(Number(caseSize)))) return false;
    if (countMode === "weight" && !weightUnit) return false;
    return true;
  }, [sku, countMode, caseSize, weightUnit]);

  const onSave = async () => {
    if (!canSave || saving) return;
    setSaving(true);
    setError(null);
    const body = {
      sku: sku.trim(),
      description: description.trim(),
      channel,
      markets: Array.from(marketKeys),
      type_key: typeKey,
      vendor_ref: vendor.ref,
      vendor_name: vendor.name,
      count_mode: countMode,
      case_size: countMode === "case" ? Number(caseSize) : null,
      weight_unit: countMode === "weight" ? weightUnit : null,
    };
    try {
      if (isNew) await dcCreateItem(extension.slug, body);
      else await dcUpdateItem(item.id, body);
      onSaved();
    } catch (err) {
      setError(err.message || String(err));
      setSaving(false);
    }
  };

  const onDelete = async () => {
    if (!item || saving) return;
    if (!window.confirm(`Delete item "${item.sku}"? This cannot be undone.`)) return;
    setSaving(true);
    setError(null);
    try {
      await dcDeleteItem(item.id);
      onSaved();
    } catch (err) {
      setError(err.message || String(err));
      setSaving(false);
    }
  };

  return (
    <div style={styles.overlay} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <aside style={styles.drawer} role="dialog" aria-modal="true">
        <div style={styles.header}>
          <div>
            <div style={styles.kicker}>Master Item Sheet · {isNew ? "New" : "Editing"}</div>
            <h2 style={styles.title}>{isNew ? "New item" : "Edit item"}</h2>
          </div>
          <button onClick={onClose} style={styles.closeBtn} aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M3.5 3.5l9 9m0-9l-9 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        <div style={styles.body}>
          <Field label="SKU / Item">
            <input
              id="dc-item-sku"
              value={sku}
              onChange={(e) => setSku(e.target.value)}
              placeholder="e.g. D20CH"
              autoComplete="off"
              style={styles.input}
            />
          </Field>

          <Field label="Description">
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. 100 Sheep · 20-pack"
              autoComplete="off"
              style={styles.input}
            />
          </Field>

          <Field label="Product Line">
            <select
              value={channel}
              onChange={(e) => setChannel(e.target.value)}
              style={styles.select}
            >
              {channels.map((c) => (
                <option key={c.key} value={c.key}>{c.label}</option>
              ))}
            </select>
          </Field>

          <Field label="Markets" hint="Tap to toggle. An item can belong to multiple markets.">
            <div style={styles.marketChips}>
              {markets.map((m) => (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => toggleMarket(m.key)}
                  style={{
                    ...styles.marketChip,
                    ...(marketKeys.has(m.key) ? styles.marketChipOn : {}),
                  }}
                >
                  {m.key}
                </button>
              ))}
            </div>
          </Field>

          <Field label="Type">
            <select
              value={typeKey}
              onChange={(e) => setTypeKey(e.target.value)}
              style={styles.select}
            >
              {itemTypes.map((t) => (
                <option key={t.key} value={t.key}>{t.label}</option>
              ))}
            </select>
          </Field>

          <Field label="Vendor" hint={
            <>Pulls from the workspace <strong>Vendor CRM</strong>. Type to search · pick <em>New vendor</em> to add one (name only — details filled later in the CRM).</>
          }>
            <DcVendorCombobox
              value={vendor}
              onChange={setVendor}
              extension={extension}
            />
          </Field>

          <Field label="Counted as" hint={
            countMode === "case" ? "Count in whole or partial cases; the units-per-case field below drives derived totals."
            : countMode === "unit" ? "Counted individually — enter total units on hand at fill time."
            : "Weight-based item (e.g. sugar in lbs). No unit / case conversion."
          }>
            <div style={styles.seg}>
              {["case", "unit", "weight"].map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setCountMode(m)}
                  style={{
                    ...styles.segBtn,
                    ...(countMode === m ? styles.segBtnOn : {}),
                  }}
                >
                  {m[0].toUpperCase() + m.slice(1)}
                </button>
              ))}
            </div>
          </Field>

          <Field label={
            countMode === "case" ? "Units per case"
            : countMode === "weight" ? "Weight unit"
            : "No unit needed"
          }>
            <div style={styles.condBox}>
              {countMode === "case" && (
                <div style={styles.condInline}>
                  <input
                    type="number"
                    step="any"
                    value={caseSize}
                    onChange={(e) => setCaseSize(e.target.value)}
                    placeholder="e.g. 600"
                    style={{ ...styles.input, maxWidth: 180 }}
                  />
                  <span style={styles.condHint}>units / case</span>
                </div>
              )}
              {countMode === "weight" && (
                <div style={styles.condInline}>
                  <select
                    value={weightUnit}
                    onChange={(e) => setWeightUnit(e.target.value)}
                    style={{ ...styles.select, maxWidth: 200 }}
                  >
                    {WEIGHT_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                  </select>
                  <span style={styles.condHint}>per unit of measure</span>
                </div>
              )}
              {countMode === "unit" && (
                <span style={styles.condEmpty}>
                  — items are counted directly in units on hand. No case or weight conversion needed.
                </span>
              )}
            </div>
          </Field>

          {error && (
            <div style={{ color: C.error, fontSize: 12, fontFamily: FONT }}>{error}</div>
          )}
        </div>

        <div style={styles.footer}>
          <span style={styles.footerMeta}>
            {isNew
              ? "Draft · not yet saved"
              : `Last edited ${item?.updated_at || ""}`}
          </span>
          <div style={{ display: "flex", gap: 10 }}>
            {!isNew && (
              <button style={styles.dangerBtn} onClick={onDelete} disabled={saving}>Delete</button>
            )}
            <button style={styles.secondaryBtn} onClick={onClose} disabled={saving}>Cancel</button>
            <button
              style={{ ...styles.primaryBtn, opacity: canSave ? 1 : 0.5, cursor: canSave ? "pointer" : "not-allowed" }}
              onClick={onSave}
              disabled={!canSave || saving}
            >
              {saving ? "Saving…" : "Save item"}
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
}

function Field({ label, hint, children }) {
  return (
    <div style={styles.field}>
      <label style={styles.fieldLabel}>{label}</label>
      {children}
      {hint && <div style={styles.fieldHint}>{hint}</div>}
    </div>
  );
}

function buildStyles() { return {
  overlay: {
    position: "fixed",
    // Stop 68px above the viewport bottom to clear Wasabi's BottomBar
    // (src/core/BottomBar.jsx BAR_HEIGHT), otherwise the drawer's footer
    // — Save / Cancel — sits behind it and is unreachable.
    top: 0,
    right: 0,
    bottom: 68,
    left: 0,
    background: "rgba(0,0,0,0.55)",
    backdropFilter: "blur(6px)",
    WebkitBackdropFilter: "blur(6px)",
    zIndex: 600,
    display: "flex",
    alignItems: "stretch",
    justifyContent: "flex-end",
  },
  drawer: {
    width: 520,
    maxWidth: "96vw",
    // Drawer height matches the (viewport - BottomBar) overlay height, so
    // the flex layout below can clamp the body and pin the footer.
    height: "100%",
    maxHeight: "100%",
    background: C.surface,
    borderLeft: `1px solid ${C.border}`,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    fontFamily: FONT,
  },
  header: {
    padding: "20px 22px 14px",
    borderBottom: `1px solid ${C.edgeLine}`,
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 14,
  },
  kicker: {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: "0.14em",
    textTransform: "uppercase",
    color: C.accent,
    marginBottom: 6,
  },
  title: {
    fontFamily: FONT,
    fontSize: 18,
    fontWeight: 700,
    letterSpacing: "-0.01em",
    color: C.text,
  },
  closeBtn: {
    width: 32,
    height: 32,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: RADIUS.md,
    color: C.textMid,
    background: "transparent",
    border: "none",
    cursor: "pointer",
  },
  body: {
    padding: "22px 22px 28px",
    overflowY: "auto",
    flex: 1,
    // Critical for flex-scroll: without minHeight:0, the body would take its
    // intrinsic content height and push the footer off-screen.
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    gap: 18,
  },
  field: { display: "flex", flexDirection: "column", gap: 7 },
  fieldLabel: {
    fontFamily: FONT,
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: "0.14em",
    textTransform: "uppercase",
    color: C.muted,
  },
  fieldHint: { fontSize: 11, color: C.muted, marginTop: 4, lineHeight: 1.45 },
  input: {
    background: C.dark,
    border: `1px solid ${C.border}`,
    borderRadius: RADIUS.md,
    color: C.text,
    fontFamily: FONT,
    fontSize: 14,
    fontWeight: 500,
    padding: "11px 14px",
    outline: "none",
    minHeight: 44,
    width: "100%",
  },
  select: {
    background: C.dark,
    border: `1px solid ${C.border}`,
    borderRadius: RADIUS.md,
    color: C.text,
    fontFamily: FONT,
    fontSize: 14,
    fontWeight: 500,
    padding: "11px 14px",
    outline: "none",
    minHeight: 44,
    width: "100%",
    cursor: "pointer",
  },
  marketChips: { display: "flex", flexWrap: "wrap", gap: 6 },
  marketChip: {
    padding: "6px 12px",
    fontSize: 11,
    minWidth: 40,
    minHeight: 30,
    fontFamily: FONT,
    fontWeight: 600,
    letterSpacing: "0.04em",
    background: C.dark,
    border: `1px solid ${C.border}`,
    color: C.muted,
    borderRadius: RADIUS.pill,
    cursor: "pointer",
  },
  marketChipOn: {
    background: C.accent,
    color: "#0A1114",
    borderColor: C.accent,
  },
  seg: {
    display: "inline-flex",
    padding: 3,
    background: C.dark,
    border: `1px solid ${C.border}`,
    borderRadius: RADIUS.pill,
    width: "fit-content",
  },
  segBtn: {
    padding: "8px 16px",
    borderRadius: RADIUS.pill,
    fontFamily: FONT,
    fontSize: 12,
    fontWeight: 600,
    letterSpacing: "0.04em",
    color: C.muted,
    background: "transparent",
    border: "none",
    cursor: "pointer",
    minHeight: 34,
  },
  segBtnOn: { background: C.accent, color: "#0A1114" },
  condBox: {
    padding: "12px 14px",
    background: C.dark,
    border: `1px dashed ${C.border}`,
    borderRadius: RADIUS.md,
    minHeight: 60,
    display: "flex",
    alignItems: "center",
  },
  condInline: { display: "flex", alignItems: "center", gap: 10, width: "100%" },
  condHint: {
    fontSize: 11,
    color: C.muted,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    fontWeight: 600,
  },
  condEmpty: { fontSize: 12, color: C.muted, fontStyle: "italic" },
  footer: {
    padding: "14px 22px",
    borderTop: `1px solid ${C.edgeLine}`,
    display: "flex",
    justifyContent: "space-between",
    gap: 10,
    alignItems: "center",
    background: `color-mix(in srgb, ${C.surface} 60%, ${C.dark})`,
  },
  footerMeta: {
    fontSize: 11,
    color: C.muted,
    fontFamily: FONT,
  },
  primaryBtn: {
    background: C.accent,
    color: "#0A1114",
    border: "none",
    padding: "10px 20px",
    borderRadius: RADIUS.pill,
    fontFamily: FONT,
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    minHeight: 40,
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
    minHeight: 40,
  },
  dangerBtn: {
    background: "transparent",
    color: C.error,
    border: `1px solid ${C.error}`,
    padding: "9px 18px",
    borderRadius: RADIUS.md,
    fontFamily: FONT,
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    minHeight: 40,
  },
};
}

const styles = new Proxy({}, { get: (_, k) => buildStyles()[k] });
