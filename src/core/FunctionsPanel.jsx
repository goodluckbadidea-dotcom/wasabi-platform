// ─── Functions Panel ───
// Lists saved custom functions as detail cards.
// Toggles between card list view and FunctionBuilder (scaffold builder).
// Click card → opens Wasabi chat to run. "+ New" → opens builder.

import React, { useState, useEffect, useCallback } from "react";
import { C, FONT, MONO, RADIUS } from "../design/tokens.js";
import { IconFunction, IconPlus, IconSearch, IconTrash, IconPlay } from "../design/icons.jsx";
import * as api from "../lib/api.js";
import { timeAgo } from "../utils/helpers.js";
import FunctionBuilder from "./FunctionBuilder.jsx";

// ── Status badge colors ──
// Status colors — active uses theme accent, others are semantic
function getStatusColor(status) {
  if (status === "active") return C.accent;
  if (status === "error") return "#E05252";
  return "#FF9800"; // draft / default
}

const TYPE_COLORS = {
  transform: "#2196F3",
  aggregation: "#9C27B0",
  pipeline: "#FF9800",
  view: "#E91E63",
  plugin: "#7C4DFF",
  forecast: "#00BCD4",
  alert: "#FF5722",
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
      setFunctions(res?.entries || res?.functions || res?.data || []);
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
            background: `linear-gradient(135deg, ${C.accent}, ${C.accent}cc)`,
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
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const inputCount = (() => {
    try {
      const inputs = typeof fn.inputs === "string" ? JSON.parse(fn.inputs) : fn.inputs;
      return Object.keys(inputs || {}).length;
    } catch { return 0; }
  })();

  const toggleHistory = useCallback((e) => {
    e.stopPropagation();
    if (!showHistory) {
      setHistoryLoading(true);
      api.listFunctionExecutions({ function_id: fn.id, limit: 10 })
        .then((res) => setHistory(res?.executions || []))
        .catch(() => setHistory([]))
        .finally(() => setHistoryLoading(false));
    }
    setShowHistory((v) => !v);
  }, [showHistory, fn.id]);

  return (
    <div
      style={{
        background: C.darkSurf,
        border: `1px solid ${isHovered ? C.accent + "44" : C.darkBorder}`,
        borderRadius: RADIUS.lg,
        padding: 0,
        transition: "border-color 0.12s",
        opacity: isDeleting ? 0.5 : 1,
        overflow: "hidden",
      }}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
    >
      {/* Card body — clickable area */}
      <div style={{ padding: "14px 18px 10px", cursor: "pointer" }} onClick={onRun}>
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

          {/* Status badge */}
          <span style={{
            fontSize: 8, fontWeight: 600, fontFamily: FONT,
            color: getStatusColor(fn.status),
            background: getStatusColor(fn.status) + "18",
            padding: "2px 8px", borderRadius: 3, textTransform: "uppercase",
            letterSpacing: "0.04em",
          }}>
            {fn.status || "draft"}
          </span>
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
              color: fn.last_run_status === "success" ? C.accent : "#E05252",
            }}>
              {fn.last_run_status}
            </span>
          )}
        </div>
      </div>

      {/* Action bar — always visible */}
      <div style={{
        display: "flex", alignItems: "center", gap: 6,
        padding: "8px 18px 10px",
        borderTop: `1px solid ${C.darkBorder}`,
      }}>
        {/* Run button */}
        <button
          onClick={(e) => { e.stopPropagation(); onRun(); }}
          style={{
            display: "flex", alignItems: "center", gap: 5,
            background: `linear-gradient(135deg, ${C.accent}, ${C.accent}cc)`,
            border: "none", borderRadius: RADIUS.sm,
            color: "#fff", fontFamily: FONT, fontSize: 11, fontWeight: 600,
            padding: "5px 14px", cursor: "pointer", outline: "none",
          }}
        >
          <IconPlay size={10} color="#fff" />
          Run
        </button>

        {/* History toggle */}
        <button
          onClick={toggleHistory}
          style={{
            background: showHistory ? C.darkSurf2 : "transparent",
            border: `1px solid ${showHistory ? C.accent + "33" : C.darkBorder}`,
            borderRadius: RADIUS.sm, color: showHistory ? C.accent : C.darkMuted,
            fontFamily: FONT, fontSize: 10, padding: "4px 10px",
            cursor: "pointer", outline: "none",
          }}
        >
          History
        </button>

        <div style={{ flex: 1 }} />

        {/* Delete button */}
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          style={{
            display: "flex", alignItems: "center", gap: 4,
            background: "transparent",
            border: `1px solid ${isHovered ? "#E0525244" : C.darkBorder}`,
            borderRadius: RADIUS.sm, color: isHovered ? "#E05252" : C.darkMuted,
            fontFamily: FONT, fontSize: 10, padding: "4px 10px",
            cursor: "pointer", outline: "none",
            transition: "color 0.12s, border-color 0.12s",
          }}
        >
          <IconTrash size={10} color={isHovered ? "#E05252" : C.darkMuted} />
          Delete
        </button>
      </div>

      {/* Execution History (expandable) */}
      {showHistory && (
        <div style={{
          padding: "8px 18px 12px",
          borderTop: `1px solid ${C.darkBorder}`,
          background: C.darkBg + "80",
        }}>
          {historyLoading ? (
            <span style={{ fontSize: 10, color: C.darkMuted, fontFamily: FONT }}>Loading...</span>
          ) : history.length === 0 ? (
            <span style={{ fontSize: 10, color: C.darkMuted, fontFamily: FONT }}>No executions yet.</span>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {history.map((exec) => (
                <div key={exec.id} style={{
                  display: "flex", alignItems: "center", gap: 8,
                  fontSize: 10, fontFamily: MONO, color: C.darkMuted,
                }}>
                  <span style={{
                    width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
                    background: exec.status === "success" ? C.accent : "#E05252",
                  }} />
                  <span style={{ minWidth: 55 }}>{timeAgo(exec.executed_at)}</span>
                  <span style={{ minWidth: 40 }}>{exec.duration_ms}ms</span>
                  <span style={{
                    fontSize: 8, padding: "1px 5px", borderRadius: 2,
                    background: C.darkSurf2, color: C.darkMuted,
                    textTransform: "uppercase",
                  }}>
                    {exec.trigger_source}
                  </span>
                  {exec.error && (
                    <span style={{
                      color: "#E05252", flex: 1,
                      whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                    }}>
                      {exec.error}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
