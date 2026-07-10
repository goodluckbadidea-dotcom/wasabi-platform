// ─── DcTilesLanding ───
// Landing view: Master Item Sheet + Inventory History + market workbook
// tiles. Progress bar per market tile is derived from the most recent
// submission for that market (draft = in-progress, submitted = done).

import React, { useMemo } from "react";
import { C, FONT, MONO, RADIUS } from "../../design/tokens.js";

export default function DcTilesLanding({ extension, markets, submissions, items, onOpenMaster, onOpenHistory, onOpenMarket }) {
  // Compute per-market status from submissions (most-recent per market)
  const marketStatus = useMemo(() => {
    const map = {};
    for (const s of submissions || []) {
      const m = s.market;
      if (!map[m]) map[m] = s;
      // submissions are already sorted by submitted_at desc, but be defensive
      const prevTs = map[m].submitted_at || map[m].created_at || "";
      const curTs  = s.submitted_at || s.created_at || "";
      if (curTs > prevTs) map[m] = s;
    }
    return map;
  }, [submissions]);

  const totalItems = items ? items.length : 0;

  const renderMarketTile = (m) => {
    const s = marketStatus[m.key];
    let state = "empty";
    let pct = 0;
    let subtitle = "No draft";
    if (s) {
      if (s.status === "draft") {
        state = "in-progress";
        pct = 40;
        subtitle = `${s.page ? s.page[0].toUpperCase() + s.page.slice(1) : "Draft"} · ${s.counter_name || "In progress"}`;
      } else {
        state = "done";
        pct = 100;
        subtitle = `Submitted ${s.submitted_at ? s.submitted_at.slice(0, 10) : ""} · ${s.counter_name || ""}`.trim();
      }
    }
    const fill = state === "done" ? C.success : state === "in-progress" ? C.warning : C.muted;
    return (
      <button key={m.key} style={styles.tile} onClick={() => onOpenMarket(m.key)}>
        <span style={{ ...styles.tileBadge, background: C.surfaceAlt, color: C.text }}>{m.key.slice(0, 2)}</span>
        <span style={styles.tileName}>{m.label}</span>
        <span style={styles.tileSub}>Weekly count</span>
        <span style={{ ...styles.tileStatus, color: state === "in-progress" ? C.warning : state === "done" ? C.success : C.muted }}>
          <span style={{ ...styles.statusDot, background: fill }} />
          {subtitle}
        </span>
        <div style={styles.progressBar}>
          <div style={{ ...styles.progressFill, background: fill, opacity: state === "empty" ? 0.3 : 1, width: `${pct}%` }} />
        </div>
        <div style={styles.progressMeta}>
          <span>{state === "empty" ? "—" : `${pct}%`}</span>
        </div>
      </button>
    );
  };

  const draftCount   = submissions?.filter((s) => s.status === "draft").length || 0;
  const savedCount   = submissions?.length || 0;
  const latestSaved  = submissions?.[0];

  return (
    <div style={styles.container}>
      <div style={styles.hero}>
        <div style={styles.kicker}>Extensions › {extension?.name || "Inventory"} · Data Collection</div>
        <h1 style={styles.h1}>What are you counting today?</h1>
        <div style={styles.sub}>
          Master Item Sheet governs every SKU across all markets. Each market has its own workbook that pulls rows from the master.
        </div>
      </div>

      <div style={styles.grid}>
        {/* Master Item Sheet tile (accent, span 2) */}
        <button style={{ ...styles.tile, ...styles.tileMaster }} onClick={onOpenMaster}>
          <span style={{ ...styles.tileBadge, background: C.accent, color: "#0A1114" }}>MS</span>
          <span style={styles.tileName}>Master Item Sheet</span>
          <span style={styles.tileSub}>
            Every SKU across every channel and market. Add new items · edit metadata · set count mode.
          </span>
          <span style={{ ...styles.tileStatus, color: C.textMid }}>
            <span style={{ ...styles.statusDot, background: C.muted }} />
            {totalItems} items
          </span>
        </button>

        {/* Inventory History tile (warm accent, span 2) */}
        <button style={{ ...styles.tile, ...styles.tileHistory }} onClick={onOpenHistory}>
          <span style={{ ...styles.tileBadge, background: C.warning, color: "#1A0F08" }}>IH</span>
          <span style={styles.tileName}>Inventory History</span>
          <span style={styles.tileSub}>
            Every saved count across markets, chronological. Filter by market, date, counter · reopen any submission.
          </span>
          <span style={{ ...styles.tileStatus, color: C.textMid }}>
            <span style={{ ...styles.statusDot, background: C.muted }} />
            {savedCount} counts saved
            {latestSaved?.submitted_at ? ` · last ${latestSaved.submitted_at.slice(0, 10)}` : ""}
          </span>
        </button>

        {/* Divider labeled MARKETS */}
        <div style={styles.divider}>
          <span style={styles.dividerLabel}>Markets</span>
          <span style={styles.dividerRule} />
        </div>

        {/* Market tiles */}
        {markets.map(renderMarketTile)}
      </div>

      {draftCount > 0 && (
        <div style={styles.footer}>
          <span style={{ color: C.warning, fontWeight: 600 }}>{draftCount}</span>
          <span style={{ marginLeft: 6, color: C.textMid }}>
            {draftCount === 1 ? "draft in progress" : "drafts in progress"}
          </span>
        </div>
      )}
    </div>
  );
}

const styles = {
  container: {
    maxWidth: 1360,
    width: "100%",
    margin: "0 auto",
    padding: "24px 24px 60px",
  },
  hero: { padding: "20px 0 24px" },
  kicker: {
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: "0.14em",
    textTransform: "uppercase",
    color: C.accent,
    marginBottom: 10,
  },
  h1: {
    fontFamily: FONT,
    fontSize: 30,
    fontWeight: 700,
    letterSpacing: "-0.02em",
    lineHeight: 1.15,
    color: C.text,
    maxWidth: 720,
  },
  sub: {
    fontSize: 14,
    color: C.textMid,
    marginTop: 8,
    maxWidth: 640,
    lineHeight: 1.5,
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
    gap: 14,
  },
  tile: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: 10,
    padding: "22px 22px 20px",
    background: C.surface,
    border: `1px solid ${C.border}`,
    borderRadius: RADIUS.lg,
    cursor: "pointer",
    minHeight: 148,
    color: "inherit",
    fontFamily: FONT,
    textAlign: "left",
    position: "relative",
    overflow: "hidden",
    transition: "border-color 0.15s, transform 0.12s",
  },
  tileMaster: {
    gridColumn: "span 2",
    background: `linear-gradient(135deg, color-mix(in srgb, ${C.accent} 14%, ${C.surface}) 0%, ${C.surface} 100%)`,
    borderColor: `color-mix(in srgb, ${C.accent} 30%, ${C.border})`,
  },
  tileHistory: {
    gridColumn: "span 2",
    background: `linear-gradient(135deg, color-mix(in srgb, ${C.warning} 10%, ${C.surface}) 0%, ${C.surface} 100%)`,
    borderColor: `color-mix(in srgb, ${C.warning} 20%, ${C.border})`,
  },
  tileBadge: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 44,
    height: 44,
    borderRadius: RADIUS.md,
    fontFamily: FONT,
    fontWeight: 700,
    fontSize: 13,
    letterSpacing: "0.06em",
  },
  tileName: {
    fontFamily: FONT,
    fontSize: 18,
    fontWeight: 600,
    letterSpacing: "-0.01em",
    color: C.text,
    lineHeight: 1.2,
  },
  tileSub: {
    fontSize: 12,
    color: C.textMid,
    lineHeight: 1.45,
  },
  tileStatus: {
    marginTop: "auto",
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    fontSize: 11,
    fontFamily: MONO,
    letterSpacing: "0.03em",
  },
  statusDot: { width: 6, height: 6, borderRadius: "50%" },
  progressBar: {
    width: "100%",
    height: 3,
    background: C.border,
    borderRadius: 2,
    overflow: "hidden",
    marginTop: 6,
  },
  progressFill: {
    height: "100%",
    borderRadius: 2,
    transition: "width 0.4s ease",
  },
  progressMeta: {
    display: "flex",
    justifyContent: "flex-end",
    fontFamily: MONO,
    fontSize: 10,
    color: C.muted,
    letterSpacing: "0.04em",
    marginTop: 4,
    width: "100%",
  },
  divider: {
    gridColumn: "1 / -1",
    display: "flex",
    alignItems: "center",
    gap: 14,
    margin: "18px 0 4px",
  },
  dividerLabel: {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: "0.14em",
    textTransform: "uppercase",
    color: C.muted,
  },
  dividerRule: { flex: 1, height: 1, background: C.edgeLine },
  footer: {
    marginTop: 24,
    fontSize: 12,
    color: C.textMid,
    fontFamily: FONT,
  },
};
