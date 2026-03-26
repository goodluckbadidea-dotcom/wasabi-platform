// ─── Owner Cell Components ───
// Display and picker for the Owner column in Table view.

import React, { useState, useEffect, useRef } from "react";
import { C, FONT, RADIUS, SHADOW } from "../../design/tokens.js";

/** Display owner user pills for a row */
export function OwnerCellDisplay({ ownerIds, users, onClick }) {
  if (!ownerIds || ownerIds.length === 0) {
    return (
      <span
        onClick={onClick}
        style={{ color: C.darkMuted, fontSize: 12, cursor: onClick ? "pointer" : "default", opacity: 0.6 }}
      >
        Unassigned
      </span>
    );
  }

  const userMap = {};
  (users || []).forEach((u) => { userMap[u.id] = u; });

  return (
    <div onClick={onClick} style={{ display: "flex", gap: 4, flexWrap: "wrap", cursor: onClick ? "pointer" : "default", alignItems: "center" }}>
      {ownerIds.map((uid) => {
        const u = userMap[uid];
        const name = u?.display_name || uid.slice(0, 8);
        const initial = name.charAt(0).toUpperCase();
        return (
          <span
            key={uid}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              background: C.accent + "18",
              border: `1px solid ${C.accent}33`,
              borderRadius: RADIUS.pill,
              padding: "1px 8px 1px 3px",
              fontSize: 11,
              fontWeight: 500,
              color: C.darkText,
              lineHeight: "20px",
              whiteSpace: "nowrap",
            }}
          >
            <span style={{
              width: 16, height: 16, borderRadius: "50%",
              background: `linear-gradient(135deg, ${C.accent}, ${C.accent}88)`,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 9, fontWeight: 700, color: "#fff", flexShrink: 0,
            }}>
              {initial}
            </span>
            {name}
          </span>
        );
      })}
    </div>
  );
}

/** Multi-select dropdown to pick owners */
export function OwnerPicker({ ownerIds, users, onCommit, onClose }) {
  const [selected, setSelected] = useState(new Set(ownerIds || []));
  const [filter, setFilter] = useState("");
  const ref = useRef(null);

  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [onClose]);

  const filtered = (users || []).filter((u) =>
    u.display_name?.toLowerCase().includes(filter.toLowerCase())
  );

  const toggle = (uid) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid); else next.add(uid);
      return next;
    });
  };

  const handleDone = () => {
    onCommit(Array.from(selected));
    onClose();
  };

  return (
    <div
      ref={ref}
      style={{
        position: "absolute",
        top: "100%",
        left: 0,
        zIndex: 200,
        background: C.darkSurf,
        border: `1px solid ${C.darkBorder}`,
        borderRadius: RADIUS.lg,
        boxShadow: SHADOW.dropdown,
        width: 220,
        maxHeight: 280,
        display: "flex",
        flexDirection: "column",
        fontFamily: FONT,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <input
        autoFocus
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Filter users..."
        style={{
          border: "none",
          borderBottom: `1px solid ${C.darkBorder}`,
          background: "transparent",
          color: C.darkText,
          padding: "8px 10px",
          fontSize: 12,
          outline: "none",
          fontFamily: FONT,
        }}
      />
      <div style={{ overflowY: "auto", flex: 1, padding: "4px 0" }}>
        {filtered.length === 0 && (
          <div style={{ padding: "8px 10px", fontSize: 11, color: C.darkMuted }}>No users found</div>
        )}
        {filtered.map((u) => {
          const isActive = selected.has(u.id);
          const initial = (u.display_name || "?").charAt(0).toUpperCase();
          return (
            <div
              key={u.id}
              onClick={() => toggle(u.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "6px 10px",
                cursor: "pointer",
                fontSize: 12,
                color: C.darkText,
                background: isActive ? C.accent + "14" : "transparent",
                transition: "background 0.1s",
              }}
              onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = C.darkSurf2; }}
              onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = "transparent"; }}
            >
              <span style={{
                width: 20, height: 20, borderRadius: "50%",
                background: `linear-gradient(135deg, ${C.accent}, ${C.accent}88)`,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 10, fontWeight: 700, color: "#fff", flexShrink: 0,
              }}>
                {initial}
              </span>
              <span style={{ flex: 1 }}>{u.display_name}</span>
              {isActive && <span style={{ color: C.accent, fontSize: 14, fontWeight: 700 }}>✓</span>}
            </div>
          );
        })}
      </div>
      <div style={{
        borderTop: `1px solid ${C.darkBorder}`,
        padding: "6px 10px",
        display: "flex",
        justifyContent: "flex-end",
      }}>
        <button
          onClick={handleDone}
          style={{
            background: C.accent,
            color: "#fff",
            border: "none",
            borderRadius: RADIUS.sm,
            padding: "4px 12px",
            fontSize: 11,
            fontWeight: 600,
            cursor: "pointer",
            fontFamily: FONT,
          }}
        >
          Done
        </button>
      </div>
    </div>
  );
}
