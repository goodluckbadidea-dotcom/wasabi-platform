import React, { useState, useEffect } from "react";
import { Z } from "../design/tokens.js";

/**
 * ConflictToast — shows when two users edit the same field simultaneously.
 * Displays both values with diff highlighting and lets the user choose which to keep.
 * Auto-dismisses after 30 seconds with "Accept theirs" as default.
 *
 * Props:
 *   conflicts: Array<{ field, yourValue, currentValue, currentVersion, detectedAt }>
 *   onResolve: (field, chosenValue) => void
 *   onDismiss: () => void
 */

const AUTO_DISMISS_MS = 30000;

export default function ConflictToast({ conflicts = [], onResolve, onDismiss }) {
  const [countdown, setCountdown] = useState(null);

  // Auto-dismiss timer — starts from oldest conflict's detectedAt
  useEffect(() => {
    if (!conflicts.length) return;
    const oldest = Math.min(...conflicts.map((c) => c.detectedAt || Date.now()));
    const remaining = Math.max(0, AUTO_DISMISS_MS - (Date.now() - oldest));

    const tick = setInterval(() => {
      const left = Math.max(0, AUTO_DISMISS_MS - (Date.now() - oldest));
      setCountdown(Math.ceil(left / 1000));
      if (left <= 0) {
        clearInterval(tick);
        // Auto-accept theirs for all remaining conflicts
        conflicts.forEach((c) => onResolve(c.field, c.currentValue));
      }
    }, 1000);

    setCountdown(Math.ceil(remaining / 1000));
    return () => clearInterval(tick);
  }, [conflicts.length]);

  if (!conflicts.length) return null;

  const handleKeepAllMine = () => {
    conflicts.forEach((c) => onResolve(c.field, c.yourValue));
  };

  const handleAcceptAllTheirs = () => {
    conflicts.forEach((c) => onResolve(c.field, c.currentValue));
  };

  return (
    <div style={styles.overlay}>
      <div style={styles.container}>
        <div style={styles.header}>
          <span style={styles.icon}>&#x26A0;&#xFE0F;</span>
          <span style={styles.title}>
            Edit Conflict{conflicts.length > 1 ? ` (${conflicts.length})` : ""}
          </span>
          {countdown !== null && countdown > 0 && (
            <span style={styles.countdown}>Auto-accepting in {countdown}s</span>
          )}
          <button onClick={onDismiss} style={styles.close}>&#x2715;</button>
        </div>
        <p style={styles.description}>
          Another user changed {conflicts.length === 1 ? "this field" : "these fields"} while you were editing.
        </p>

        {/* Batch buttons for multiple conflicts */}
        {conflicts.length > 1 && (
          <div style={styles.batchRow}>
            <button style={styles.batchBtn} onClick={handleKeepAllMine}>
              Keep all mine
            </button>
            <button style={{ ...styles.batchBtn, ...styles.batchBtnTheirs }} onClick={handleAcceptAllTheirs}>
              Accept all theirs
            </button>
          </div>
        )}

        {conflicts.map((c) => (
          <div key={c.field} style={styles.conflictRow}>
            <div style={styles.fieldName}>{c.field}</div>
            <div style={styles.options}>
              <button
                style={styles.optionBtn}
                onClick={() => onResolve(c.field, c.yourValue)}
              >
                <span style={styles.optionLabel}>Keep mine</span>
                <span style={styles.optionValue}>
                  <DiffValue value={c.yourValue} other={c.currentValue} color="#6ea8fe" />
                </span>
              </button>
              <button
                style={{ ...styles.optionBtn, ...styles.optionBtnTheirs }}
                onClick={() => onResolve(c.field, c.currentValue)}
              >
                <span style={styles.optionLabel}>Accept theirs</span>
                <span style={styles.optionValue}>
                  <DiffValue value={c.currentValue} other={c.yourValue} color="#c9822a" />
                </span>
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Highlights the changed portion of a value compared to the other value */
function DiffValue({ value, other, color }) {
  const a = formatValue(value);
  const b = formatValue(other);
  if (a === b) return <span>{a}</span>;

  // Find longest common prefix/suffix
  let prefixLen = 0;
  while (prefixLen < a.length && prefixLen < b.length && a[prefixLen] === b[prefixLen]) prefixLen++;
  let suffixLen = 0;
  while (
    suffixLen < a.length - prefixLen &&
    suffixLen < b.length - prefixLen &&
    a[a.length - 1 - suffixLen] === b[b.length - 1 - suffixLen]
  ) suffixLen++;

  const prefix = a.slice(0, prefixLen);
  const changed = a.slice(prefixLen, a.length - suffixLen || undefined);
  const suffix = suffixLen > 0 ? a.slice(a.length - suffixLen) : "";

  if (!changed) return <span>{a}</span>;
  return (
    <span>
      {prefix}
      <mark style={{ background: color + "33", color, borderRadius: 2, padding: "0 1px" }}>{changed}</mark>
      {suffix}
    </span>
  );
}

function formatValue(val) {
  if (val === null || val === undefined) return "(empty)";
  if (typeof val === "object") return JSON.stringify(val);
  return String(val);
}

const styles = {
  overlay: {
    position: "fixed",
    bottom: 24,
    right: 24,
    zIndex: Z.toast,
    maxWidth: 480,
    animation: "slideUp 0.2s ease-out",
  },
  container: {
    background: "#1a1a1e",
    border: "1px solid #c9822a",
    borderRadius: 12,
    padding: "16px 20px",
    boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
  },
  icon: { fontSize: 18 },
  title: {
    color: "#c9822a",
    fontWeight: 600,
    fontSize: 14,
    flex: 1,
  },
  countdown: {
    color: "#8e8e98",
    fontSize: 10,
    fontWeight: 500,
    flexShrink: 0,
  },
  close: {
    background: "none",
    border: "none",
    color: "#6e6e78",
    cursor: "pointer",
    fontSize: 14,
    padding: "2px 6px",
  },
  description: {
    color: "#8e8e98",
    fontSize: 12,
    margin: "0 0 12px",
  },
  batchRow: {
    display: "flex",
    gap: 8,
    marginBottom: 12,
  },
  batchBtn: {
    flex: 1,
    background: "#242428",
    border: "1px solid #444",
    borderRadius: 6,
    padding: "6px 10px",
    cursor: "pointer",
    color: "#d0d0d8",
    fontSize: 11,
    fontWeight: 600,
    textAlign: "center",
    transition: "border-color 0.15s",
  },
  batchBtnTheirs: {
    borderColor: "#c9822a44",
    color: "#c9822a",
  },
  conflictRow: {
    marginBottom: 12,
  },
  fieldName: {
    color: "#d0d0d8",
    fontSize: 12,
    fontWeight: 600,
    marginBottom: 6,
    textTransform: "uppercase",
    letterSpacing: "0.5px",
  },
  options: {
    display: "flex",
    gap: 8,
  },
  optionBtn: {
    flex: 1,
    background: "#242428",
    border: "1px solid #333",
    borderRadius: 8,
    padding: "8px 12px",
    cursor: "pointer",
    textAlign: "left",
    transition: "border-color 0.15s",
  },
  optionBtnTheirs: {
    borderColor: "#444",
  },
  optionLabel: {
    display: "block",
    color: "#8e8e98",
    fontSize: 10,
    marginBottom: 2,
  },
  optionValue: {
    display: "block",
    color: "#e0e0e8",
    fontSize: 13,
    fontWeight: 500,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
};
