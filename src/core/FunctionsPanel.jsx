// ─── Functions Panel ───
// Lists saved custom functions as detail cards.
// Toggles between card list view and FunctionBuilder (scaffold builder).
// Click card → opens Wasabi chat to run. "+ New" → opens builder.

import React, { useState, useEffect, useCallback } from "react";
import { C, FONT, MONO, RADIUS } from "../design/tokens.js";
import { IconFunction, IconPlus, IconSearch, IconTrash } from "../design/icons.jsx";
import * as api from "../lib/api.js";
import { timeAgo } from "../utils/helpers.js";
import FunctionBuilder from "./FunctionBuilder.jsx";

// ── Status badge colors ──
const STATUS_COLORS = {
  active: "#4CAF50",
  draft: "#FF9800",
  error: "#E05252",
};

const TYPE_COLORS = {
  transform: "#2196F3",
  aggregation: "#9C27B0",
  pipeline: "#FF9800",
};

export default function FunctionsPanel({ onOpenChat }) {
  const [functions, setFunctions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [view, setView] = useState("list"); // "list" | "builder"
  const [hovered, setHovered] = useState(null);
  const [deleting, setDeleting] = useState(null);

  // ── Load functions ──
  const loadFunctions = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.listCustomFunctions();
      setFunctions(res?.functions || res?.data || []);
    } catch (err) {
      console.error("[Functions] Failed to load:", err);
      setFunctions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadFunctions(); }, [loadFunctions]);

  // ── Delete handler ──
  const handleDelete = useCallback(async (id) => {
    setDeleting(id);
    try {
      await api.deleteCustomFunction(id);
      setFunctions((prev) => prev.filter((f) => f.id !== id));
    } catch (err) {
      console.error("[Functions] Delete failed:", err);
    } finally {
      setDeleting(null);
    }
  }, []);

  // ── Run function via chat ──
  const handleRun = useCallback((fn) => {
    onOpenChat?.(`Run my custom function "${fn.name}" (ID: ${fn.id})`);
  }, [onOpenChat]);

  // ── After builder submits, go back to list and refresh ──
  const handleBuilderSubmit = useCallback((scaffoldPrompt) => {
    onOpenChat?.(scaffoldPrompt);
    setView("list");
    // Refresh after a delay to catch the new function
    setTimeout(loadFunctions, 3000);
  }, [onOpenChat, loadFunctions]);

  // ── Filter ──
  const filtered = functions.filter((fn) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      (fn.name || "").toLowerCase().includes(q) ||
      (fn.description || "").toLowerCase().includes(q) ||
      (fn.type || "").toLowerCase().includes(q)
    );
  });

  // ── Builder view ──
  if (view === "builder") {
    return (
      <FunctionBuilder
        onSubmit={handleBuilderSubmit}
        onBack={() => setView("list")}
      />
    );
  }

  // ── List view ──
  return (
    <div style={{
      flex: 1, display: "flex", flexDirection: "column",
      background: C.darkBg, padding: "24px 32px", overflow: "auto",
    }}>
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", gap: 12,
        marginBottom: 20,
      }}>
        <IconFunction size={22} color={C.accent} />
        <h2 style={{
          fontFamily: FONT, fontSize: 18, fontWeight: 600,
          color: "#fff", margin: 0, flex: 1,
        }}>
          Functions
        </h2>
        <button
          onClick={() => setView("builder")}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            background: `linear-gradient(135deg, #7DC143, ${C.accent})`,
            border: "none", borderRadius: RADIUS.lg,
            color: "#fff", fontFamily: FONT, fontSize: 12, fontWeight: 600,
            padding: "8px 16px", cursor: "pointer", outline: "none",
          }}
        >
          <IconPlus size={14} color="#fff" />
          New Function
        </button>
      </div>

      {/* Search bar */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        background: C.darkSurf, border: `1px solid ${C.darkBorder}`,
        borderRadius: RADIUS.lg, padding: "8px 12px", marginBottom: 16,
      }}>
        <IconSearch size={14} color={C.darkMuted} />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search functions..."
          style={{
            flex: 1, background: "transparent", border: "none",
            color: "#fff", fontFamily: FONT, fontSize: 13, outline: "none",
          }}
        />
      </div>

      {/* Content */}
      {loading ? (
        <div style={{
          flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
          color: C.darkMuted, fontFamily: FONT, fontSize: 13,
        }}>
          Loading functions...
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState hasSearch={!!search} onCreate={() => setView("builder")} />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {filtered.map((fn) => (
            <FunctionCard
              key={fn.id}
              fn={fn}
              isHovered={hovered === fn.id}
              isDeleting={deleting === fn.id}
              onHover={(h) => setHovered(h ? fn.id : null)}
              onRun={() => handleRun(fn)}
              onDelete={() => handleDelete(fn.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Empty State ──
function EmptyState({ hasSearch, onCreate }) {
  return (
    <div style={{
      flex: 1, display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", gap: 12,
      padding: 40,
    }}>
      <IconFunction size={40} color={C.darkBorder} />
      <p style={{
        fontFamily: FONT, fontSize: 14, color: C.darkMuted,
        textAlign: "center", margin: 0, lineHeight: 1.5,
      }}>
        {hasSearch
          ? "No functions match your search."
          : "No custom functions yet. Create one to automate data transforms, calculations, and analytics."}
      </p>
      {!hasSearch && (
        <button
          onClick={onCreate}
          style={{
            marginTop: 8, display: "flex", alignItems: "center", gap: 6,
            background: C.darkSurf, border: `1px solid ${C.darkBorder}`,
            borderRadius: RADIUS.lg, color: "#fff", fontFamily: FONT,
            fontSize: 13, fontWeight: 500, padding: "8px 20px",
            cursor: "pointer", outline: "none",
          }}
        >
          <IconPlus size={14} color={C.accent} />
          Create your first function
        </button>
      )}
    </div>
  );
}

// ── Function Card ──
function FunctionCard({ fn, isHovered, isDeleting, onHover, onRun, onDelete }) {
  const inputCount = (() => {
    try {
      const inputs = typeof fn.inputs === "string" ? JSON.parse(fn.inputs) : fn.inputs;
      return Object.keys(inputs || {}).length;
    } catch { return 0; }
  })();

  return (
    <div
      style={{
        background: C.darkSurf,
        border: `1px solid ${isHovered ? C.accent + "44" : C.darkBorder}`,
        borderRadius: RADIUS.lg,
        padding: "14px 18px",
        cursor: "pointer",
        transition: "border-color 0.12s",
        opacity: isDeleting ? 0.5 : 1,
      }}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      onClick={onRun}
    >
      {/* Top row: name + status */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        {/* Type badge */}
        <span style={{
          fontSize: 9, fontWeight: 600,
          color: TYPE_COLORS[fn.type] || C.darkMuted,
          background: (TYPE_COLORS[fn.type] || C.darkMuted) + "18",
          padding: "2px 8px", borderRadius: 3, textTransform: "uppercase",
          letterSpacing: "0.04em", fontFamily: FONT,
        }}>
          {fn.type || "transform"}
        </span>

        {/* Name */}
        <span style={{
          fontSize: 14, fontWeight: 600, color: "#fff",
          fontFamily: FONT, flex: 1,
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        }}>
          {fn.name || "Untitled"}
        </span>

        {/* Status dot */}
        <span style={{
          width: 8, height: 8, borderRadius: "50%",
          background: STATUS_COLORS[fn.status] || STATUS_COLORS.draft,
          flexShrink: 0,
        }} />

        {/* Actions on hover */}
        {isHovered && (
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            style={{
              background: "transparent", border: `1px solid #E0525233`,
              borderRadius: RADIUS.sm, color: "#E05252",
              fontFamily: FONT, fontSize: 10, padding: "2px 8px",
              cursor: "pointer", outline: "none",
            }}
          >
            Delete
          </button>
        )}
      </div>

      {/* Description */}
      {fn.description && (
        <p style={{
          fontSize: 12, color: C.darkMuted, fontFamily: FONT,
          margin: "0 0 8px", lineHeight: 1.4,
          display: "-webkit-box", WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical", overflow: "hidden",
        }}>
          {fn.description}
        </p>
      )}

      {/* Meta row */}
      <div style={{
        display: "flex", alignItems: "center", gap: 12,
        fontSize: 10, color: C.darkMuted, fontFamily: MONO,
      }}>
        {inputCount > 0 && (
          <span>{inputCount} input{inputCount !== 1 ? "s" : ""}</span>
        )}
        {fn.version > 1 && <span>v{fn.version}</span>}
        {fn.last_run_at && <span>Last run {timeAgo(fn.last_run_at)}</span>}
        {fn.last_run_status && (
          <span style={{
            color: fn.last_run_status === "success" ? "#4CAF50" : "#E05252",
          }}>
            {fn.last_run_status}
          </span>
        )}
      </div>
    </div>
  );
}
