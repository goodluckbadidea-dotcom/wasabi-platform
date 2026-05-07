// ─── Breadcrumb ───
// Shows navigation path: Workspace > Folder > Page.
// Each segment is clickable to navigate. Current page is bold.

import React, { useMemo, useCallback } from "react";
import { C, FONT } from "../design/tokens.js";
import { usePlatform } from "../context/PlatformContext.jsx";
import { useNavigation } from "../context/NavigationContext.jsx";
import { useViewport } from "../context/ViewportContext.jsx";
// Special page labels
const SPECIAL_PAGES = {
  system: "System",
  automations: "Automations",
  inbox: "Inbox",
  "knowledge-base": "Knowledge Base",
  wasabi: "New Page",
  dashboard: "Dashboard",
};

// Chevron separator
function Chevron() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ flexShrink: 0, opacity: 0.35 }}>
      <path d="M4.5 2.5L7.5 6L4.5 9.5" stroke={C.darkMuted} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function Breadcrumb() {
  const { activeRightPane, pages, setActiveRightPane } = usePlatform();
  const { setTargetFolderPath } = useNavigation();
  const { isNarrow, isTablet } = useViewport();
  const segments = useMemo(() => {
    // No active page → Home
    if (!activeRightPane) return [];

    // Special pages (system, automations, inbox, etc.)
    if (SPECIAL_PAGES[activeRightPane]) {
      return [{ label: SPECIAL_PAGES[activeRightPane], id: activeRightPane, isCurrent: true }];
    }

    // Built-in pages don't show breadcrumbs
    const BUILTIN_PAGES = new Set(["workspaces", "tasks", "notes", "gmail", "notifications", "knowledge", "dashboard"]);
    if (BUILTIN_PAGES.has(activeRightPane)) return [];

    // Find page config
    const pageConfig = pages.find((p) => p.id === activeRightPane);
    if (!pageConfig) return [];

    // Walk up parentId chain to build breadcrumb
    const chain = [];
    const byId = {};
    for (const p of pages) byId[p.id] = p;

    let current = pageConfig;
    const visited = new Set();
    while (current) {
      if (visited.has(current.id)) break;
      visited.add(current.id);
      chain.unshift({
        label: current.name || "Untitled",
        id: current.id,
        isCurrent: current.id === activeRightPane,
        isFolder: current.type === "folder",
      });
      current = current.parentId ? byId[current.parentId] : null;
    }

    // Prepend "Workspaces" root for navigation back
    if (chain.length > 0) {
      chain.unshift({ label: "Workspaces", id: "workspaces", isCurrent: false, isFolder: false });
    }

    return chain;
  }, [activeRightPane, pages]);

  if (segments.length === 0 || isNarrow) return null;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        minWidth: 0,
        overflow: "hidden",
      }}
    >
      {segments.map((seg, i) => (
        <React.Fragment key={seg.id}>
          {i > 0 && <Chevron />}
          <button
            onClick={() => {
              if (seg.isCurrent) return;
              if (seg.isFolder) {
                // Compute the path from root to this folder for WorkspaceBrowser
                const byId = {};
                for (const p of pages) byId[p.id] = p;
                const folderPath = [];
                let cur = byId[seg.id];
                const seen = new Set();
                while (cur) {
                  if (seen.has(cur.id)) break;
                  seen.add(cur.id);
                  folderPath.unshift({ id: cur.id, name: cur.name || "Untitled" });
                  cur = cur.parentId ? byId[cur.parentId] : null;
                }
                setTargetFolderPath(folderPath);
                setActiveRightPane("workspaces");
              } else {
                setActiveRightPane(seg.id);
              }
            }}
            style={{
              background: "none",
              border: "none",
              cursor: seg.isCurrent ? "default" : "pointer",
              fontFamily: FONT,
              fontSize: 12,
              fontWeight: seg.isCurrent ? 600 : 400,
              color: seg.isCurrent ? C.darkText : C.darkMuted,
              padding: "4px 8px",
              borderRadius: 6,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              maxWidth: seg.isCurrent ? (isTablet ? 140 : 200) : (isTablet ? 100 : 140),
              outline: "none",
              transition: "color 0.12s, background 0.12s",
            }}
            onMouseEnter={(e) => {
              if (!seg.isCurrent) {
                e.currentTarget.style.color = C.darkText;
                e.currentTarget.style.background = C.darkSurf2;
              }
            }}
            onMouseLeave={(e) => {
              if (!seg.isCurrent) {
                e.currentTarget.style.color = C.darkMuted;
                e.currentTarget.style.background = "none";
              }
            }}
          >
            {seg.label}
          </button>
        </React.Fragment>
      ))}
    </div>
  );
}
