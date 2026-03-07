// ─── Wasabi Home Page / Dashboard ───
// Persistent landing page. Shows quick-start templates, pinned pages,
// recent pages, and system status. Widget-based layout. localStorage persistence.

import React, { useState, useCallback, useMemo, useEffect } from "react";
import { C, FONT, RADIUS, SHADOW } from "../design/tokens.js";
import { ANIM } from "../design/animations.js";
import { usePlatform } from "../context/PlatformContext.jsx";
import { archivePageConfig, savePageConfig } from "../config/pageConfig.js";
import { archivePage, ensurePageActive } from "../notion/client.js";
import WasabiFlame from "./WasabiFlame.jsx";
import { TEMPLATES } from "./Onboarding.jsx";
import ConfirmDialog from "./ConfirmDialog.jsx";
import InlineEdit from "./InlineEdit.jsx";
import {
  IconStar, IconTable, IconDatabase, IconCalendar, IconKanban,
  IconTimeline, IconChart, IconBolt, IconGear, IconFolder,
  IconChevronRight, IconTrash,
} from "../design/icons.jsx";

// ── localStorage key for home config ──
const HOME_CONFIG_KEY = "wasabi_home_config";

function loadHomeConfig() {
  try {
    return JSON.parse(localStorage.getItem(HOME_CONFIG_KEY)) || {};
  } catch { return {}; }
}

function saveHomeConfig(config) {
  try {
    localStorage.setItem(HOME_CONFIG_KEY, JSON.stringify(config));
  } catch {}
}

// ── View type icon map ──
const VIEW_ICON_MAP = {
  table: IconTable,
  gantt: IconTimeline,
  calendar: IconCalendar,
  cardGrid: IconFolder,
  kanban: IconKanban,
  charts: IconChart,
  form: IconDatabase,
  summaryTiles: IconChart,
  activityFeed: IconBolt,
  document: IconFolder,
  notificationFeed: IconBolt,
};

// ── Styles ──
const hs = {
  wrapper: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    overflow: "auto",
    background: C.dark,
    fontFamily: FONT,
  },
  hero: {
    padding: "48px 40px 32px",
    display: "flex",
    alignItems: "center",
    gap: 20,
  },
  heroText: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  heroTitle: {
    fontSize: 26,
    fontWeight: 700,
    color: C.darkText,
    letterSpacing: "-0.03em",
  },
  heroSub: {
    fontSize: 14,
    color: C.darkMuted,
    lineHeight: 1.5,
  },
  section: {
    padding: "0 40px 28px",
  },
  sectionHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    color: C.darkMuted,
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
    gap: 12,
  },
  card: (delay = 0) => ({
    background: C.darkSurf,
    border: `1px solid ${C.darkBorder}`,
    borderRadius: RADIUS.xl,
    padding: "18px 16px",
    cursor: "pointer",
    transition: "all 0.15s",
    fontFamily: FONT,
    animation: ANIM.fadeUp(delay),
    position: "relative",
    display: "flex",
    flexDirection: "column",
    gap: 8,
  }),
  cardTitle: {
    fontSize: 14,
    fontWeight: 600,
    color: C.darkText,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  cardMeta: {
    fontSize: 11,
    color: C.darkMuted,
    lineHeight: 1.4,
  },
  pinBtn: {
    position: "absolute",
    top: 10,
    right: 10,
    background: "none",
    border: "none",
    cursor: "pointer",
    padding: 4,
    borderRadius: RADIUS.sm,
    transition: "all 0.15s",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    opacity: 0.4,
  },
  viewBadges: {
    display: "flex",
    gap: 4,
    flexWrap: "wrap",
  },
  viewBadge: {
    display: "inline-flex",
    alignItems: "center",
    gap: 3,
    padding: "2px 7px",
    borderRadius: RADIUS.pill,
    background: C.darkSurf2,
    fontSize: 10,
    fontWeight: 500,
    color: C.darkMuted,
    whiteSpace: "nowrap",
  },
  templateBtn: (delay = 0) => ({
    background: C.darkSurf,
    border: `1px solid ${C.darkBorder}`,
    borderRadius: RADIUS.xl,
    padding: "14px 16px",
    cursor: "pointer",
    transition: "all 0.15s",
    fontFamily: FONT,
    animation: ANIM.fadeUp(delay),
    display: "flex",
    alignItems: "center",
    gap: 12,
    textAlign: "left",
  }),
  statCard: {
    background: C.darkSurf,
    border: `1px solid ${C.darkBorder}`,
    borderRadius: RADIUS.xl,
    padding: "16px 18px",
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  statValue: {
    fontSize: 28,
    fontWeight: 700,
    color: C.darkText,
    letterSpacing: "-0.02em",
  },
  statLabel: {
    fontSize: 11,
    fontWeight: 500,
    color: C.darkMuted,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
  },
};

// ── Hover helper ──
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

// ── Main Component ──
export default function HomePage({ onStartBlank, onStartTemplate, onNavigate }) {
  const {
    pages, activePage, setActivePage, removePage, updatePageConfig, user, platformIds,
    pageTree, setActiveFolder, folders,
  } = usePlatform();
  const [homeConfig, setHomeConfig] = useState(() => loadHomeConfig());
  const [confirmDelete, setConfirmDelete] = useState(null);

  // ── Delete page ──
  const handleDeletePage = useCallback(async (pageConfig) => {
    // Always remove from local state first — Notion cleanup is best-effort
    removePage(pageConfig.id);
    setConfirmDelete(null);
    if (user?.workerUrl && user?.notionKey) {
      try {
        if (platformIds?.rootPageId) {
          await ensurePageActive(user.workerUrl, user.notionKey, platformIds.rootPageId);
        }
      } catch {}
      archivePageConfig(user.workerUrl, user.notionKey, pageConfig.id).catch(() => {});
      for (const dbId of (pageConfig.databaseIds || [])) {
        archivePage(user.workerUrl, user.notionKey, dbId).catch(() => {});
      }
      if (pageConfig.pageType === "document" && pageConfig.notionPageId) {
        archivePage(user.workerUrl, user.notionKey, pageConfig.notionPageId).catch(() => {});
      }
    }
  }, [user, platformIds, removePage]);

  // ── Rename Page ──
  const handleRenamePage = useCallback((pageId, newName) => {
    const page = pages.find((p) => p.id === pageId);
    if (!page) return;
    updatePageConfig(pageId, { name: newName });
    if (user?.workerUrl && user?.notionKey && platformIds?.configDbId) {
      savePageConfig(user.workerUrl, user.notionKey, platformIds.configDbId, {
        ...page,
        name: newName,
      }).catch((err) => console.error("[HomePage] Failed to persist page rename:", err));
    }
  }, [pages, updatePageConfig, user, platformIds]);

  const pinnedIds = homeConfig.pinned || [];

  // Persist config changes
  const updateConfig = useCallback((updates) => {
    setHomeConfig((prev) => {
      const next = { ...prev, ...updates };
      saveHomeConfig(next);
      return next;
    });
  }, []);

  // Toggle pin for a page
  const togglePin = useCallback((pageId) => {
    setHomeConfig((prev) => {
      const pins = prev.pinned || [];
      const next = pins.includes(pageId)
        ? pins.filter((id) => id !== pageId)
        : [...pins, pageId];
      const updated = { ...prev, pinned: next };
      saveHomeConfig(updated);
      return updated;
    });
  }, []);

  // Exclude folders and sub-pages from card lists (they show via folder cards)
  const visiblePages = useMemo(
    () => pages.filter((p) => p.type !== "folder" && p.type !== "sub_page"),
    [pages]
  );

  // Split pages: pinned vs recent
  const pinnedPages = useMemo(
    () => visiblePages.filter((p) => pinnedIds.includes(p.id)),
    [visiblePages, pinnedIds]
  );

  const recentPages = useMemo(
    () => visiblePages.filter((p) => !pinnedIds.includes(p.id)).slice(0, 8),
    [visiblePages, pinnedIds]
  );

  // Get greeting based on time of day
  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    if (hour < 17) return "Good afternoon";
    return "Good evening";
  }, []);

  // Stats
  const totalViews = useMemo(
    () => visiblePages.reduce((sum, p) => sum + (p.views?.length || 0), 0),
    [visiblePages]
  );

  const viewTypeCounts = useMemo(() => {
    const counts = {};
    for (const p of pages) {
      for (const v of p.views || []) {
        counts[v.type] = (counts[v.type] || 0) + 1;
      }
    }
    return counts;
  }, [pages]);

  return (
    <div style={hs.wrapper}>
      {/* ── Hero ── */}
      <div style={hs.hero}>
        <div style={{ animation: ANIM.fadeUp(0) }}>
          <WasabiFlame size={56} />
        </div>
        <div style={hs.heroText}>
          <div style={{ ...hs.heroTitle, animation: ANIM.fadeUp(0.03) }}>
            {greeting}
          </div>
          <div style={{ ...hs.heroSub, animation: ANIM.fadeUp(0.06) }}>
            {visiblePages.length === 0
              ? "Welcome to Wasabi. Let's build your first page."
              : `${folders.length} folder${folders.length !== 1 ? "s" : ""} \u00b7 ${visiblePages.length} page${visiblePages.length !== 1 ? "s" : ""} \u00b7 ${totalViews} view${totalViews !== 1 ? "s" : ""}`}
          </div>
        </div>
      </div>

      {/* ── Folders ── */}
      {pageTree.length > 0 && (
        <div style={hs.section}>
          <div style={hs.sectionHeader}>
            <span style={hs.sectionTitle}>
              <IconFolder size={11} color={C.darkMuted} /> Folders
            </span>
          </div>
          <div style={hs.grid}>
            {pageTree.map((folder, i) => (
              <div
                key={folder.id}
                style={hs.card(i * 0.02)}
                onClick={() => {
                  setActiveFolder(folder.id);
                  // If folder has pages, navigate to the first one
                  if (folder.children?.length > 0) {
                    setActivePage(folder.children[0].id);
                  }
                }}
                onMouseEnter={applyHover}
                onMouseLeave={removeHover}
              >
                <IconFolder size={18} color={C.accent} />
                <div style={hs.cardTitle}>{folder.name}</div>
                <div style={hs.cardMeta}>
                  {folder.children?.length || 0} page{(folder.children?.length || 0) !== 1 ? "s" : ""}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Quick Start (always shown if < 6 pages, or if no pages) ── */}
      {visiblePages.length < 6 && (
        <div style={hs.section}>
          <div style={hs.sectionHeader}>
            <span style={hs.sectionTitle}>Quick Start</span>
          </div>
          <div style={{ ...hs.grid, gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))" }}>
            {TEMPLATES.slice(0, 4).map((tpl, i) => {
              const TplIcon = tpl.icon;
              return (
                <button
                  key={tpl.id}
                  style={hs.templateBtn(0.05 + i * 0.02)}
                  onClick={() => onStartTemplate(tpl)}
                  onMouseEnter={applyHover}
                  onMouseLeave={removeHover}
                >
                  <TplIcon size={20} color={C.accent} />
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: C.darkText }}>{tpl.name}</div>
                    <div style={{ fontSize: 11, color: C.darkMuted }}>{tpl.desc}</div>
                  </div>
                </button>
              );
            })}
            {/* Blank page */}
            <button
              style={hs.templateBtn(0.15)}
              onClick={onStartBlank}
              onMouseEnter={applyHover}
              onMouseLeave={removeHover}
            >
              <span style={{ fontSize: 18, color: C.accent, fontWeight: 300, width: 20, textAlign: "center" }}>+</span>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: C.darkText }}>Blank Page</div>
                <div style={{ fontSize: 11, color: C.darkMuted }}>Start from scratch</div>
              </div>
            </button>
          </div>
        </div>
      )}

      {/* ── Pinned Pages ── */}
      {pinnedPages.length > 0 && (
        <div style={hs.section}>
          <div style={hs.sectionHeader}>
            <span style={hs.sectionTitle}>
              <IconStar size={11} color={C.darkMuted} /> Pinned
            </span>
          </div>
          <div style={hs.grid}>
            {pinnedPages.map((page, i) => (
              <PageCard
                key={page.id}
                page={page}
                delay={i * 0.02}
                isPinned={true}
                onTogglePin={() => togglePin(page.id)}
                onClick={() => setActivePage(page.id)}
                onDelete={() => setConfirmDelete(page)}
                onRename={(newName) => handleRenamePage(page.id, newName)}
              />
            ))}
          </div>
        </div>
      )}

      {/* ── Recent Pages ── */}
      {recentPages.length > 0 && (
        <div style={hs.section}>
          <div style={hs.sectionHeader}>
            <span style={hs.sectionTitle}>Pages</span>
            {visiblePages.length > 8 && (
              <span style={{ fontSize: 11, color: C.accent, cursor: "pointer", fontWeight: 500 }}>
                View all ({visiblePages.length})
              </span>
            )}
          </div>
          <div style={hs.grid}>
            {recentPages.map((page, i) => (
              <PageCard
                key={page.id}
                page={page}
                delay={i * 0.02}
                isPinned={false}
                onTogglePin={() => togglePin(page.id)}
                onClick={() => setActivePage(page.id)}
                onDelete={() => setConfirmDelete(page)}
                onRename={(newName) => handleRenamePage(page.id, newName)}
              />
            ))}
          </div>
        </div>
      )}

      {/* ── Stats Row ── */}
      {visiblePages.length > 0 && (
        <div style={hs.section}>
          <div style={hs.sectionHeader}>
            <span style={hs.sectionTitle}>Overview</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 12 }}>
            <div style={{ ...hs.statCard, animation: ANIM.fadeUp(0.1) }}>
              <span style={hs.statValue}>{folders.length}</span>
              <span style={hs.statLabel}>Folders</span>
            </div>
            <div style={{ ...hs.statCard, animation: ANIM.fadeUp(0.12) }}>
              <span style={hs.statValue}>{visiblePages.length}</span>
              <span style={hs.statLabel}>Pages</span>
            </div>
            <div style={{ ...hs.statCard, animation: ANIM.fadeUp(0.14) }}>
              <span style={hs.statValue}>{totalViews}</span>
              <span style={hs.statLabel}>Views</span>
            </div>
            <div style={{ ...hs.statCard, animation: ANIM.fadeUp(0.16) }}>
              <span style={hs.statValue}>{new Set(visiblePages.flatMap((p) => p.databaseIds || [p.databaseId]).filter(Boolean)).size}</span>
              <span style={hs.statLabel}>Databases</span>
            </div>
          </div>
        </div>
      )}

      {/* ── Shortcut Hints ── */}
      <div style={{ ...hs.section, paddingBottom: 40 }}>
        <div style={{
          display: "flex",
          gap: 16,
          flexWrap: "wrap",
          animation: ANIM.fadeUp(0.2),
        }}>
          {[
            { keys: "\u2318K", label: "Search" },
            { keys: "\u2318N", label: "New page" },
            { keys: "\u2318B", label: "Sidebar" },
            { keys: "\u2318W", label: "Wasabi" },
          ].map((s) => (
            <div key={s.keys} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <kbd style={{
                background: C.darkSurf2,
                border: `1px solid ${C.darkBorder}`,
                borderRadius: RADIUS.sm,
                padding: "2px 6px",
                fontSize: 10,
                fontWeight: 600,
                color: C.darkMuted,
                fontFamily: FONT,
              }}>
                {s.keys}
              </kbd>
              <span style={{ fontSize: 11, color: C.darkMuted + "99" }}>{s.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Confirm delete dialog */}
      {confirmDelete && (
        <ConfirmDialog
          title="Delete Page"
          message={`Are you sure you want to delete "${confirmDelete.name}"? This action cannot be undone.`}
          onConfirm={() => handleDeletePage(confirmDelete)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}

// ── Page Card Sub-component ──
function PageCard({ page, delay, isPinned, onTogglePin, onClick, onDelete, onRename }) {
  const viewTypes = (page.views || []).map((v) => v.type);
  const uniqueTypes = [...new Set(viewTypes)];

  return (
    <div
      style={hs.card(delay)}
      onClick={onClick}
      onMouseEnter={applyHover}
      onMouseLeave={removeHover}
    >
      {/* Pin button */}
      <button
        style={{
          ...hs.pinBtn,
          opacity: isPinned ? 1 : undefined,
          color: isPinned ? C.accent : C.darkMuted,
        }}
        onClick={(e) => {
          e.stopPropagation();
          onTogglePin();
        }}
        onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; }}
        onMouseLeave={(e) => { if (!isPinned) e.currentTarget.style.opacity = "0.4"; }}
        title={isPinned ? "Unpin" : "Pin to home"}
      >
        <IconStar size={12} color={isPinned ? C.accent : C.darkMuted} />
      </button>

      {/* Delete button */}
      <button
        style={{ ...hs.pinBtn, top: 32 }}
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; }}
        onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.4"; }}
        title="Delete page"
      >
        <IconTrash size={11} color={C.darkMuted} />
      </button>

      <InlineEdit
        value={page.name}
        onCommit={onRename}
        placeholder="Untitled"
        fontSize={14}
        fontWeight={600}
        color={C.darkText}
      />

      {/* View badges */}
      {uniqueTypes.length > 0 && (
        <div style={hs.viewBadges}>
          {uniqueTypes.slice(0, 4).map((type) => {
            const VIcon = VIEW_ICON_MAP[type] || IconFolder;
            return (
              <span key={type} style={hs.viewBadge}>
                <VIcon size={9} color={C.darkMuted} />
                {type}
              </span>
            );
          })}
          {uniqueTypes.length > 4 && (
            <span style={hs.viewBadge}>+{uniqueTypes.length - 4}</span>
          )}
        </div>
      )}

      <div style={hs.cardMeta}>
        {page.views?.length || 0} view{(page.views?.length || 0) !== 1 ? "s" : ""}
        {page.databaseIds?.length > 1 && ` \u00b7 ${page.databaseIds.length} DBs`}
      </div>
    </div>
  );
}
