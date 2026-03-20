// ─── BatchQueue ───
// Batch processing component that renders within the WasabiPanel Log tab.
// Displays queued items with status dots, a "Process All" button, and
// a progress bar during batch processing. No emojis.

import React from "react";
import { C, FONT, MONO, RADIUS } from "../design/tokens.js";

// ── Status dot color map ──
function getStatusDot() {
  return {
    pending:    C.accent,
    processing: "#C8960A",
    actioned:   C.darkMuted,
  };
}

// ── Status row background / border ──
function getStatusRow() {
  return {
    pending: {
      bg: C.darkSurf2,
      border: `1px solid ${C.darkBorder}`,
    },
    processing: {
      bg: "rgba(200,150,10,0.06)",
      border: "1px solid rgba(200,150,10,0.3)",
    },
    actioned: {
      bg: C.dark,
      border: `1px solid ${C.darkBorder}`,
    },
  };
}

export default function BatchQueue({
  items = [],
  onProcess,
  onUpdateItem,
  onRemoveItem,
  isProcessing = false,
  processProgress = null, // { current, total }
}) {
  const STATUS_DOT = getStatusDot();
  const STATUS_ROW = getStatusRow();
  const pendingCount = items.filter((i) => i.status === "pending").length;
  const showProcessBtn = pendingCount > 0 && !isProcessing;

  // Progress percentage
  const progressPct =
    processProgress && processProgress.total > 0
      ? Math.round((processProgress.current / processProgress.total) * 100)
      : 0;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        fontFamily: FONT,
      }}
    >
      {/* ── Header area: Process All button + progress bar ── */}
      <div style={{ flexShrink: 0, padding: "10px 12px 0" }}>
        {/* Process All button */}
        {showProcessBtn && (
          <button
            onClick={onProcess}
            style={{
              width: "100%",
              padding: "8px 0",
              border: "none",
              borderRadius: RADIUS.md,
              background: C.accent,
              color: "#fff",
              fontFamily: FONT,
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              letterSpacing: "0.02em",
              transition: "background 0.15s",
              marginBottom: 8,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = C.accentDim;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = C.accent;
            }}
          >
            Process All ({pendingCount})
          </button>
        )}

        {/* Progress bar during processing */}
        {isProcessing && processProgress && (
          <div style={{ marginBottom: 8 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 10,
                color: C.darkMuted,
                marginBottom: 4,
                fontFamily: MONO,
              }}
            >
              <span>Processing...</span>
              <span>
                {processProgress.current}/{processProgress.total}
              </span>
            </div>
            <div
              style={{
                width: "100%",
                height: 4,
                borderRadius: RADIUS.pill,
                background: C.darkSurf,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${progressPct}%`,
                  height: "100%",
                  borderRadius: RADIUS.pill,
                  background: C.accent,
                  transition: "width 0.3s ease",
                }}
              />
            </div>
          </div>
        )}
      </div>

      {/* ── Item list ── */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "6px 12px 12px",
        }}
      >
        {items.length === 0 && (
          <div
            style={{
              textAlign: "center",
              color: C.darkMuted,
              fontSize: 10,
              marginTop: 40,
              lineHeight: 2,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
            }}
          >
            No items in queue
          </div>
        )}

        {items.map((item) => {
          const dot = STATUS_DOT[item.status] || STATUS_DOT.pending;
          const row = STATUS_ROW[item.status] || STATUS_ROW.pending;
          const isActioned = item.status === "actioned";

          return (
            <div
              key={item.id}
              style={{
                marginBottom: 8,
                borderRadius: RADIUS.lg,
                border: row.border,
                background: row.bg,
                padding: "9px 10px",
                opacity: isActioned ? 0.5 : 1,
                transition: "opacity 0.3s",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 8,
                }}
              >
                {/* Status dot */}
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: "50%",
                    background: dot,
                    flexShrink: 0,
                    marginTop: 4,
                  }}
                  title={item.status}
                />

                {/* Text content */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 12,
                      color: C.darkText,
                      lineHeight: 1.55,
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                      fontFamily: FONT,
                    }}
                  >
                    {item.text || "Queue item"}
                  </div>

                  {/* Result preview for actioned items */}
                  {isActioned && item.result && (
                    <div
                      style={{
                        fontSize: 11,
                        color: C.darkMuted,
                        lineHeight: 1.45,
                        marginTop: 4,
                        fontFamily: FONT,
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                      }}
                    >
                      {typeof item.result === "string"
                        ? item.result.length > 120
                          ? item.result.slice(0, 120) + "..."
                          : item.result
                        : JSON.stringify(item.result).slice(0, 120)}
                    </div>
                  )}
                </div>

                {/* Remove button (only for pending items) */}
                {item.status === "pending" && onRemoveItem && (
                  <button
                    onClick={() => onRemoveItem(item.id)}
                    title="Remove"
                    style={{
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      color: C.darkMuted,
                      fontSize: 14,
                      padding: 2,
                      flexShrink: 0,
                      lineHeight: 1,
                      display: "flex",
                      alignItems: "center",
                      transition: "color 0.12s",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.color = C.orange;
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.color = C.darkMuted;
                    }}
                  >
                    x
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
