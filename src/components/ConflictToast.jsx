import React from "react";

/**
 * ConflictToast — shows when two users edit the same field simultaneously.
 * Displays both values and lets the user choose which to keep.
 *
 * Props:
 *   conflicts: Array<{ field, yourValue, currentValue, currentVersion }>
 *   onResolve: (field, chosenValue) => void
 *   onDismiss: () => void
 */
export default function ConflictToast({ conflicts = [], onResolve, onDismiss }) {
  if (!conflicts.length) return null;

  return (
    <div style={styles.overlay}>
      <div style={styles.container}>
        <div style={styles.header}>
          <span style={styles.icon}>⚠️</span>
          <span style={styles.title}>Edit Conflict</span>
          <button onClick={onDismiss} style={styles.close}>✕</button>
        </div>
        <p style={styles.description}>
          Another user changed {conflicts.length === 1 ? "this field" : "these fields"} while you were editing.
        </p>
        {conflicts.map((c) => (
          <div key={c.field} style={styles.conflictRow}>
            <div style={styles.fieldName}>{c.field}</div>
            <div style={styles.options}>
              <button
                style={styles.optionBtn}
                onClick={() => onResolve(c.field, c.yourValue)}
              >
                <span style={styles.optionLabel}>Keep mine</span>
                <span style={styles.optionValue}>{formatValue(c.yourValue)}</span>
              </button>
              <button
                style={{ ...styles.optionBtn, ...styles.optionBtnTheirs }}
                onClick={() => onResolve(c.field, c.currentValue)}
              >
                <span style={styles.optionLabel}>Accept theirs</span>
                <span style={styles.optionValue}>{formatValue(c.currentValue)}</span>
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
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
    zIndex: 9999,
    maxWidth: 400,
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
