// ─── Zen Workspaces Browser ───
// Drill-down card browser for Sashimi mode.
// Levels: Workspaces → Folders → Pages
// Clicking a page switches to Sushi Roll mode.

import React, { useState, useMemo, useCallback } from "react";
import { C, FONT, RADIUS } from "../design/tokens.js";
import { ANIM } from "../design/animations.js";
import { usePlatform } from "../context/PlatformContext.jsx";
import { useTheme } from "../context/ThemeContext.jsx";
import { IconFolder, IconSearch, IconChevronRight, IconGlobe, IconGear } from "../design/icons.jsx";
import { useSashimiDrawer } from "./SashimiDrawerContext.jsx";
import SashimiDrawer from "./SashimiDrawer.jsx";

// ── Card hover helpers ──
function applyHover(e) {
  e.currentTarget.style.borderColor = C.accent;
  e.currentTarget.style.background = C.darkSurf2;
  e.currentTarget.style.transform = "translateY(-1px)";
}
function removeHover(e) {
  e.currentTarget.style.borderColor = C.darkBorder;
  e.currentTarget.style.background = C.darkSurf;
  e.currentTarget.style.transform = "translateY(0)";
}

// ── Diamond icon for pages ──
function PageIcon({ size = 16, color = C.accent }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <rect x="3" y="2" width="10" height="12" rx="1.5" stroke={color} strokeWidth="1.3" fill="none" />
      <line x1="5.5" y1="5.5" x2="10.5" y2="5.5" stroke={color} strokeWidth="1" />
      <line x1="5.5" y1="8" x2="10.5" y2="8" stroke={color} strokeWidth="1" />
    </svg>
  );
}

export default function ZenWorkspaces() {
  const { pageTree, pages, setActivePage, setActiveFolder } = usePlatform();
  const { setAppMode } = useTheme();
  const { openDrawer } = useSashimiDrawer();

  // Breadcrumb path: array of { id, name, node }
  const [path, setPath] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchAll, setSearchAll] = useState(false);

  // ── Resolve current level items ──
  const currentItems = useMemo(() => {
    if (path.length === 0) {
      // Top level: show all workspace/folder root nodes
      return pageTree.map((node) => ({
        ...node,
        itemType: "folder",
        pageCount: (node.children?.length || 0) + (node.childFolders || []).reduce(
          (sum, f) => sum + (f.children?.length || 0), 0
        ),
      }));
    }

    // Find the node at the current path
    let current = null;
    let nodes = pageTree;
    for (const segment of path) {
      current = nodes.find((n) => n.id === segment.id);
      if (!current) break;
      nodes = [...(current.childFolders || [])];
    }

    if (!current) return [];

    const items = [];
    // Child folders
    for (const folder of (current.childFolders || [])) {
      items.push({
        ...folder,
        itemType: "folder",
        pageCount: (folder.children?.length || 0),
      });
    }
    // Child pages
    for (const page of (current.children || [])) {
      items.push({
        ...page,
        itemType: "page",
      });
    }
    return items;
  }, [path, pageTree]);

  // ── Search filtering ──
  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return searchAll ? [] : currentItems;

    if (searchAll) {
      // Search all pages (flat)
      return pages
        .filter((p) => !p._zenInternal && p.name?.toLowerCase().includes(q))
        .map((p) => ({
          ...p,
          itemType: p.type === "folder" ? "folder" : "page",
          pageCount: p.type === "folder"
            ? pages.filter((c) => c.parentId === p.id && c.type !== "folder").length
            : undefined,
        }));
    }

    return currentItems.filter((item) =>
      item.name?.toLowerCase().includes(q)
    );
  }, [searchQuery, searchAll, currentItems, pages]);

  const displayItems = searchQuery.trim() ? filteredItems : currentItems;

  // ── Navigation handlers ──
  const handleDrillDown = useCallback((node) => {
    setPath((prev) => [...prev, { id: node.id, name: node.name }]);
    setSearchQuery("");
    setSearchAll(false);
  }, []);

  const handleOpenPage = useCallback((page) => {
    setAppMode("samurai");
    setActivePage(page.id);
    if (page.parentId) setActiveFolder(page.parentId);
  }, [setAppMode, setActivePage, setActiveFolder]);

  const handleOpenSettings = useCallback((e, item) => {
    e.stopPropagation();
    openDrawer("workspace-settings", item);
  }, [openDrawer]);

  const handleBreadcrumb = useCallback((index) => {
    // index -1 = home (root)
    if (index < 0) {
      setPath([]);
    } else {
      setPath((prev) => prev.slice(0, index + 1));
    }
    setSearchQuery("");
    setSearchAll(false);
  }, []);

  // ── Styles ──
  const styles = {
    wrapper: {
      display: "flex", flexDirection: "column", height: "100%",
      overflow: "auto", background: C.dark, fontFamily: FONT,
    },
    header: {
      padding: "24px 28px 0", flexShrink: 0,
    },
    breadcrumb: {
      display: "flex", alignItems: "center", gap: 4,
      marginBottom: 16, flexWrap: "wrap",
    },
    breadcrumbSegment: (isLast) => ({
      fontSize: 13, fontWeight: isLast ? 600 : 400, fontFamily: FONT,
      color: isLast ? C.darkText : C.darkMuted,
      cursor: isLast ? "default" : "pointer",
      background: "none", border: "none", padding: "2px 4px",
      borderRadius: RADIUS.sm, transition: "color 0.15s",
    }),
    backBtn: {
      background: "none", border: "none", cursor: "pointer",
      padding: "4px 6px", borderRadius: RADIUS.sm,
      display: "flex", alignItems: "center", transition: "background 0.15s",
    },
    searchRow: {
      display: "flex", alignItems: "center", gap: 8,
      marginBottom: 20, position: "relative",
    },
    searchInput: {
      flex: 1, padding: "9px 12px 9px 34px",
      background: C.darkSurf, border: `1px solid ${C.darkBorder}`,
      borderRadius: RADIUS.lg, fontSize: 13, fontFamily: FONT,
      color: C.darkText, outline: "none", transition: "border-color 0.15s",
    },
    searchIcon: {
      position: "absolute", left: 10, top: "50%",
      transform: "translateY(-50%)", pointerEvents: "none",
    },
    searchAllToggle: {
      fontSize: 11, fontWeight: 500, fontFamily: FONT,
      color: C.accent, cursor: "pointer", whiteSpace: "nowrap",
      background: "none", border: "none", padding: "4px 8px",
      borderRadius: RADIUS.sm, transition: "opacity 0.15s",
    },
    grid: {
      display: "grid",
      gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
      gap: 12, padding: "0 28px 28px",
    },
    card: (delay = 0) => ({
      background: C.darkSurf, border: `1px solid ${C.darkBorder}`,
      borderRadius: RADIUS.xl, padding: "18px 16px",
      cursor: "pointer", transition: "all 0.15s", fontFamily: FONT,
      animation: ANIM.settleIn(delay), display: "flex",
      flexDirection: "column", gap: 8,
    }),
    cardTitle: {
      fontSize: 14, fontWeight: 600, color: C.darkText,
      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
    },
    cardMeta: {
      fontSize: 11, color: C.darkMuted, lineHeight: 1.4,
    },
    empty: {
      padding: "40px 28px", textAlign: "center",
      fontSize: 13, color: C.darkMuted, fontFamily: FONT,
    },
  };

  return (
    <div style={styles.wrapper}>
      <div style={styles.header}>
        {/* ── Breadcrumb ── */}
        <div style={styles.breadcrumb}>
          {path.length > 0 && (
            <button
              style={styles.backBtn}
              onClick={() => handleBreadcrumb(path.length - 2)}
              onMouseEnter={(e) => { e.currentTarget.style.background = C.darkSurf2; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
              title="Go back"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path d="M10 3L5 8l5 5" stroke={C.darkMuted} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}
          <button
            style={styles.breadcrumbSegment(path.length === 0)}
            onClick={() => handleBreadcrumb(-1)}
            onMouseEnter={(e) => { if (path.length > 0) e.currentTarget.style.color = C.accent; }}
            onMouseLeave={(e) => { if (path.length > 0) e.currentTarget.style.color = C.darkMuted; }}
          >
            Workspaces
          </button>
          {path.map((segment, i) => (
            <React.Fragment key={segment.id}>
              <IconChevronRight size={10} color={C.darkMuted} />
              <button
                style={styles.breadcrumbSegment(i === path.length - 1)}
                onClick={() => handleBreadcrumb(i)}
                onMouseEnter={(e) => { if (i < path.length - 1) e.currentTarget.style.color = C.accent; }}
                onMouseLeave={(e) => { if (i < path.length - 1) e.currentTarget.style.color = C.darkMuted; }}
              >
                {segment.name}
              </button>
            </React.Fragment>
          ))}
        </div>

        {/* ── Search ── */}
        <div style={styles.searchRow}>
          <div style={{ position: "relative", flex: 1 }}>
            <div style={styles.searchIcon}>
              <IconSearch size={14} color={C.darkMuted} />
            </div>
            <input
              type="text"
              placeholder={searchAll ? "Search all pages..." : `Search ${path.length > 0 ? path[path.length - 1].name : "workspaces"}...`}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={styles.searchInput}
              onFocus={(e) => { e.target.style.borderColor = C.accent; }}
              onBlur={(e) => { e.target.style.borderColor = C.darkBorder; }}
            />
            {searchQuery && (
              <button
                onClick={() => { setSearchQuery(""); setSearchAll(false); }}
                style={{
                  position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)",
                  background: "none", border: "none", cursor: "pointer",
                  fontSize: 14, color: C.darkMuted, padding: "2px 4px",
                }}
              >
                ×
              </button>
            )}
          </div>
          <button
            style={{
              ...styles.searchAllToggle,
              opacity: searchAll ? 1 : 0.6,
              textDecoration: searchAll ? "underline" : "none",
            }}
            onClick={() => setSearchAll((v) => !v)}
            title={searchAll ? "Search current level" : "Search all pages"}
          >
            {searchAll ? "All" : "All"}
          </button>
        </div>
      </div>

      {/* ── Cards Grid ── */}
      {displayItems.length > 0 ? (
        <div style={styles.grid}>
          {displayItems.map((item, i) => (
            <div
              key={item.id}
              style={styles.card(i * 0.02)}
              onClick={() => {
                if (item.itemType === "folder") {
                  handleDrillDown(item);
                } else {
                  handleOpenPage(item);
                }
              }}
              onMouseEnter={applyHover}
              onMouseLeave={removeHover}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                {item.itemType === "folder" ? (
                  <IconFolder size={18} color={C.accent} />
                ) : (
                  <PageIcon size={18} color={C.accent} />
                )}
                {path.length === 0 && item.itemType === "folder" && (
                  <button
                    onClick={(e) => handleOpenSettings(e, item)}
                    style={{
                      background: "none", border: "none", cursor: "pointer",
                      padding: 4, borderRadius: RADIUS.sm, display: "flex",
                      alignItems: "center", justifyContent: "center",
                      opacity: 0.4, transition: "opacity 0.15s",
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.4"; }}
                    title="Workspace settings"
                  >
                    <IconGear size={14} color={C.darkMuted} />
                  </button>
                )}
              </div>
              <div style={styles.cardTitle}>{item.name}</div>
              <div style={styles.cardMeta}>
                {item.itemType === "folder"
                  ? `${item.pageCount || 0} page${(item.pageCount || 0) !== 1 ? "s" : ""}`
                  : `${item.views?.length || 0} view${(item.views?.length || 0) !== 1 ? "s" : ""}`
                }
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div style={styles.empty}>
          {searchQuery
            ? "No results found"
            : path.length > 0
              ? "This folder is empty"
              : "No workspaces yet"
          }
        </div>
      )}

      {/* Drawer for workspace settings */}
      <SashimiDrawer />
    </div>
  );
}
