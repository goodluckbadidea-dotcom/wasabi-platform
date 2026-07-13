// ─── DataCollectionView ───
// Top-level container for a Data Collection extension. Loads the extension
// config from the worker, manages which internal workspace is visible
// (tiles / master item sheet / inventory history / market workbook), and
// wires the "back to tiles" grid-icon button in the top bar.
//
// The extension config (extensions.ext_config) drives:
//   • markets — list of { key, label } for the market workbook tiles
//   • channels — Packaging page's sub-categories (Drops / Smoky / Hemp)
//   • pages — workbook pages (Packaging, Kitchen & Supplies, S&M)
//   • item_types — the section list inside a workbook page
//   • vendor_crm_page_id — Vendor CRM table id (for the item drawer combobox)

import React, { useEffect, useMemo, useState, useCallback } from "react";
import { C, FONT, MONO, RADIUS } from "../../design/tokens.js";
import { useTheme } from "../../context/ThemeContext.jsx";
import { getExtension, dcListItems, dcListSubmissions } from "../../lib/api.js";

import DcTilesLanding from "./DcTilesLanding.jsx";
import DcMasterItemSheet from "./DcMasterItemSheet.jsx";
import DcInventoryHistory from "./DcInventoryHistory.jsx";
import DcWorkbook from "./DcWorkbook.jsx";
import DcShareLinksModal from "./DcShareLinksModal.jsx";

export default function DataCollectionView({ extensionSlug }) {
  // useTheme() subscribes us to Wasabi theme changes so the render below
  // re-runs and the styles Proxy at the bottom returns fresh C values.
  useTheme();

  const [extension, setExtension] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [workspace, setWorkspace] = useState("tiles");   // tiles | master | history | market key
  const [items, setItems] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  const [itemsLoaded, setItemsLoaded] = useState(false);
  const [submissionsLoaded, setSubmissionsLoaded] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);

  // ── Load extension config ──
  useEffect(() => {
    if (!extensionSlug) return;
    let cancelled = false;
    setLoadError(null);
    getExtension(extensionSlug)
      .then((ext) => { if (!cancelled) setExtension(ext); })
      .catch((err) => { if (!cancelled) setLoadError(err.message || String(err)); });
    return () => { cancelled = true; };
  }, [extensionSlug]);

  // ── Load items whenever we need them ──
  const refreshItems = useCallback(async () => {
    if (!extension) return;
    try {
      const res = await dcListItems(extension.slug);
      setItems(res.items || []);
      setItemsLoaded(true);
    } catch (err) {
      // Non-fatal — surface an inline error in the master sheet later
      console.error("[DC] failed to load items", err);
      setItemsLoaded(true);
    }
  }, [extension]);

  // ── Load submissions when we need them ──
  const refreshSubmissions = useCallback(async () => {
    if (!extension) return;
    try {
      const res = await dcListSubmissions(extension.slug);
      setSubmissions(res.submissions || []);
      setSubmissionsLoaded(true);
    } catch (err) {
      console.error("[DC] failed to load submissions", err);
      setSubmissionsLoaded(true);
    }
  }, [extension]);

  useEffect(() => {
    if (!extension) return;
    // Items are needed by both master sheet and workbook. Load once.
    refreshItems();
    refreshSubmissions();
  }, [extension, refreshItems, refreshSubmissions]);

  const config = useMemo(() => extension?.ext_config || {}, [extension]);
  const markets = useMemo(() => Array.isArray(config.markets) ? config.markets : [], [config]);
  const marketKeys = useMemo(() => markets.map((m) => m.key), [markets]);

  // ── Loading / error states ──
  if (loadError) {
    return (
      <div style={styles.errorScreen}>
        <div style={{ color: C.error, fontWeight: 600, fontSize: 14 }}>Couldn't load extension</div>
        <div style={{ color: C.textMid, fontSize: 12, marginTop: 4 }}>{loadError}</div>
      </div>
    );
  }
  if (!extension) {
    return <div style={styles.loadingScreen}>Loading Inventory…</div>;
  }

  // ── Top-bar back button (grid icon, hidden on tiles) ──
  const onBackToTiles = () => setWorkspace("tiles");

  // ── Route to the active workspace ──
  const renderActive = () => {
    if (workspace === "tiles") {
      return (
        <DcTilesLanding
          extension={extension}
          markets={markets}
          submissions={submissions}
          items={items}
          onOpenMaster={() => setWorkspace("master")}
          onOpenHistory={() => setWorkspace("history")}
          onOpenMarket={(m) => setWorkspace(m)}
        />
      );
    }
    if (workspace === "master") {
      return (
        <DcMasterItemSheet
          extension={extension}
          items={items}
          itemsLoaded={itemsLoaded}
          onItemsChanged={refreshItems}
          onBack={onBackToTiles}
        />
      );
    }
    if (workspace === "history") {
      return (
        <DcInventoryHistory
          extension={extension}
          submissions={submissions}
          submissionsLoaded={submissionsLoaded}
          markets={markets}
          onSubmissionsChanged={refreshSubmissions}
          onBack={onBackToTiles}
        />
      );
    }
    // Market workbook
    if (marketKeys.includes(workspace)) {
      const market = markets.find((m) => m.key === workspace);
      return (
        <DcWorkbook
          extension={extension}
          market={market}
          items={items}
          itemsLoaded={itemsLoaded}
          onSubmitted={() => { refreshSubmissions(); onBackToTiles(); }}
          onBack={onBackToTiles}
        />
      );
    }
    // Fallback
    return (
      <div style={styles.errorScreen}>
        <div style={{ color: C.error, fontWeight: 600 }}>Unknown workspace: {workspace}</div>
      </div>
    );
  };

  return (
    <div style={styles.root}>
      {/* Top bar with brand + back button (context-sensitive) */}
      <div style={styles.topBar}>
        <div style={styles.brand}>
          {workspace !== "tiles" && (
            <button
              onClick={onBackToTiles}
              title="Back to Inventory tiles"
              aria-label="Back to Inventory tiles"
              style={styles.backBtn}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <rect x="1.5" y="1.5" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.4"/>
                <rect x="9.5" y="1.5" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.4"/>
                <rect x="1.5" y="9.5" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.4"/>
                <rect x="9.5" y="9.5" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.4"/>
              </svg>
            </button>
          )}
          <span style={styles.brandDot} />
          <span style={styles.brandText}>Inventory</span>
          <span style={styles.brandSep}>·</span>
          <span style={styles.brandSub}>Data Collection</span>
        </div>
        <div style={styles.brandRight}>
          {workspace !== "tiles" && (
            <span style={styles.crumb}>
              {workspace === "master" && "Master Item Sheet"}
              {workspace === "history" && "Inventory History"}
              {marketKeys.includes(workspace) && (markets.find((m) => m.key === workspace)?.label || workspace)}
            </span>
          )}
          <button
            onClick={() => setShareOpen(true)}
            title="Share links · anonymous submission URLs"
            style={styles.shareBtn}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M9.5 3l2 2-2 2M11.5 5H7c-1.5 0-3 .5-3 3v3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Share links
          </button>
        </div>
      </div>

      {/* Active workspace */}
      <div style={styles.activeShell}>
        {renderActive()}
      </div>

      {shareOpen && (
        <DcShareLinksModal
          extension={extension}
          onClose={() => setShareOpen(false)}
        />
      )}
    </div>
  );
}

// Build styles fresh each render so theme changes are picked up. The
// module-scoped `C` token object is mutated in-place by applyTheme(), so
// reading its properties at render time returns the current theme.
function buildStyles() { return {
  root: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    background: "transparent",
    overflow: "hidden",
    fontFamily: FONT,
    color: C.text,
    minHeight: 0,
  },
  topBar: {
    // Match Wasabi's canonical PanelHeader dimensions so my top bar's
    // hairline lands on the same y as the Tasks / other panel headers.
    // PANEL_HEADER_HEIGHT = 48, borderBottom uses C.darkBorder (stronger
    // than edgeLine), asymmetric padding 0 16px 0 20px.
    height: 48,
    minHeight: 48,
    borderBottom: `1px solid ${C.darkBorder}`,
    background: "transparent",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "0 16px 0 20px",
    gap: 16,
  },
  brand: {
    display: "flex",
    alignItems: "center",
    gap: 10,
  },
  brandDot: {
    width: 10,
    height: 10,
    borderRadius: "50%",
    background: C.accent,
    boxShadow: `0 0 10px ${C.accent}44`,
  },
  brandText: {
    fontFamily: FONT,
    fontWeight: 700,
    fontSize: 14,
    color: C.text,
    letterSpacing: "-0.005em",
  },
  brandSep: { color: C.muted, fontWeight: 400 },
  brandSub: {
    color: C.textMid,
    fontSize: 13,
    fontWeight: 500,
  },
  backBtn: {
    width: 34,
    height: 34,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: RADIUS.md,
    color: C.textMid,
    background: "transparent",
    border: `1px solid ${C.border}`,
    cursor: "pointer",
    marginRight: 6,
  },
  brandRight: {
    display: "flex",
    alignItems: "center",
    gap: 12,
  },
  shareBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "7px 12px",
    background: "transparent",
    color: C.textMid,
    border: `1px solid ${C.border}`,
    borderRadius: RADIUS.md,
    fontFamily: FONT,
    fontSize: 12,
    fontWeight: 500,
    cursor: "pointer",
  },
  crumb: {
    fontFamily: FONT,
    fontSize: 11,
    color: C.textMid,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
  },
  activeShell: {
    flex: 1,
    minHeight: 0,
    overflow: "auto",
    position: "relative",
  },
  loadingScreen: {
    flex: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: C.textMid,
    fontFamily: FONT,
    fontSize: 14,
  },
  errorScreen: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    fontFamily: FONT,
    padding: 40,
  },
};
}
const styles = new Proxy({}, { get: (_, k) => buildStyles()[k] });
