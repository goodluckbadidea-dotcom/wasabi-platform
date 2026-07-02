// ─── Team Priorities (admin) ───
// Admin-only screen that stacks every user's AI-curated ("zen") task list
// as a collapsible card. Admin expands one or many users' cards, sees the
// same ordered list that user would see, and (starting commit 4) can drag
// tasks to pin them at the top of that user's list.
//
// Rendering flow:
//   TeamPrioritiesView (this file) — user list + expansion state
//     └─ PriorityUserCard (one per user, alphabetical)
//           └─ useAICuratedTasks({ overrideIdentity: user }) — lazy on first expand
//
// Expansion set is persisted to localStorage per admin, so the layout the
// admin left the screen in comes back on next visit.

import React, { useEffect, useState, useMemo, useCallback } from "react";
import { C, FONT, RADIUS } from "../design/tokens.js";
import PanelHeader from "../core/PanelHeader.jsx";
import { IconUsers } from "../design/icons.jsx";
import { usePlatform } from "../context/PlatformContext.jsx";
import { isAdmin } from "../lib/roles.js";
import { listUsers } from "../lib/api.js";
import PriorityUserCard from "./PriorityUserCard.jsx";

const EXPANDED_STORAGE_KEY = "wasabi_team_priorities_expanded";

function loadExpanded() {
  try {
    const raw = localStorage.getItem(EXPANDED_STORAGE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function saveExpanded(set) {
  try {
    localStorage.setItem(EXPANDED_STORAGE_KEY, JSON.stringify([...set]));
  } catch {
    // localStorage full or blocked — silently drop; layout just won't persist
  }
}

export default function TeamPrioritiesView() {
  const { identity } = usePlatform();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expandedIds, setExpandedIds] = useState(() => loadExpanded());

  useEffect(() => {
    let cancelled = false;
    listUsers()
      .then((res) => {
        if (cancelled) return;
        const list = (res?.users || []).filter((u) => !u.deleted_at);
        setUsers(list);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err?.message || "Failed to load users");
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  // Alphabetical by display_name (Graham's call). Admins appear too.
  const sortedUsers = useMemo(
    () => [...users].sort((a, b) =>
      (a.display_name || "").localeCompare(b.display_name || "", undefined, { sensitivity: "base" })
    ),
    [users]
  );

  const toggleExpanded = useCallback((userId) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId); else next.add(userId);
      saveExpanded(next);
      return next;
    });
  }, []);

  const expandAll = useCallback(() => {
    const next = new Set(sortedUsers.map((u) => u.id));
    saveExpanded(next);
    setExpandedIds(next);
  }, [sortedUsers]);

  const collapseAll = useCallback(() => {
    saveExpanded(new Set());
    setExpandedIds(new Set());
  }, []);

  // Admin gate. Reaching this screen without admin means the router wiring
  // is wrong somewhere upstream — surface it rather than silently rendering
  // an empty page.
  if (!isAdmin(identity)) {
    return (
      <div style={outerShellStyle()}>
        <PanelHeader side="right" title="Team Priorities" icon={<IconUsers size={20} color={C.accent} />} />
        <div style={emptyStateStyle()}>Admins only.</div>
      </div>
    );
  }

  return (
    <div style={outerShellStyle()}>
      <PanelHeader
        side="right"
        title="Team Priorities"
        icon={<IconUsers size={20} color={C.accent} />}
      >
        <button onClick={expandAll} style={pillButtonStyle()}>Expand all</button>
        <button onClick={collapseAll} style={pillButtonStyle()}>Collapse all</button>
      </PanelHeader>

      <div style={scrollAreaStyle()}>
        {loading && <div style={emptyStateStyle()}>Loading users…</div>}
        {error && <div style={{ ...emptyStateStyle(), color: C.error }}>Error: {error}</div>}
        {!loading && !error && sortedUsers.length === 0 && (
          <div style={emptyStateStyle()}>No users to manage.</div>
        )}
        {!loading && !error && sortedUsers.map((u) => (
          <PriorityUserCard
            key={u.id}
            user={u}
            isExpanded={expandedIds.has(u.id)}
            onToggle={() => toggleExpanded(u.id)}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Styles ───

function outerShellStyle() {
  return {
    display: "flex", flexDirection: "column", height: "100%",
    overflow: "hidden", background: "transparent", fontFamily: FONT,
  };
}

function scrollAreaStyle() {
  return {
    flex: 1, overflowY: "auto", padding: "16px 20px",
    display: "flex", flexDirection: "column", gap: 12,
  };
}

function emptyStateStyle() {
  return {
    padding: "40px 20px", textAlign: "center",
    color: C.darkMuted, fontSize: 14,
  };
}

function pillButtonStyle() {
  return {
    background: "transparent",
    color: C.darkText,
    border: `1px solid ${C.darkBorder}`,
    borderRadius: RADIUS.pill,
    padding: "4px 10px",
    fontSize: 12,
    fontFamily: FONT,
    cursor: "pointer",
  };
}
