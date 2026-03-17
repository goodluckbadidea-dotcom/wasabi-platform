// ─── Breadcrumb ───
// Shows navigation path: Workspace > Folder > Page.
// Each segment is clickable to navigate. Current page is bold.

import React, { useMemo } from "react";
import { C, FONT } from "../design/tokens.js";
import { usePlatform } from "../context/PlatformContext.jsx";
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
  const { activePage, pages, setActivePage } = usePlatform();
  const segments = useMemo(() => {
    // No active page → Home
    if (!activePage) return [];

    // Special pages (system, automations, inbox, etc.)
    if (SPECIAL_PAGES[activePage]) {
      return [{ label: SPECIAL_PAGES[activePage], id: activePage, isCurrent: true }];
    }

    // Zen-prefixed pages don't show breadcrumbs
    if (typeof activePage === "string" && activePage.startsWith("zen-")) return [];

    // Find page config
    const pageConfig = pages.find((p) => p.id === activePage);
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
        isCurrent: current.id === activePage,
        isFolder: current.type === "folder",
      });
      current = current.parentId ? byId[current.parentId] : null;
    }

    // Prepend "Workspaces" root for navigation back
    if (chain.length > 0) {
      chain.unshift({ label: "Workspaces", id: "zen-workspaces", isCurrent: false, isFolder: false });
    }

    return chain;
  }, [activePage, pages]);

  if (segments.length === 0) return null;

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
              // Clicking a folder goes back to workspaces browser
              if (seg.isFolder) {
                setActivePage("zen-workspaces");
              } else {
                setActivePage(seg.id);
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
              maxWidth: seg.isCurrent ? 200 : 140,
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
