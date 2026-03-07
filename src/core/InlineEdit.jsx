// ─── InlineEdit ───
// Reusable double-click-to-edit inline text component.
// Used for renaming pages, views, automations, flows, etc.

import React, { useState, useRef, useEffect, useCallback } from "react";
import { C, FONT, RADIUS } from "../design/tokens.js";

export default function InlineEdit({
  value,
  onCommit,
  placeholder = "Untitled",
  fontSize = 13,
  fontWeight = 500,
  color = C.darkText,
  maxWidth = "100%",
  singleClick = false,
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(value || "");
  const inputRef = useRef(null);

  // Sync draft when value changes externally
  useEffect(() => {
    if (!isEditing) setDraft(value || "");
  }, [value, isEditing]);

  // Auto-focus and select all on enter edit mode
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const startEditing = useCallback((e) => {
    e.stopPropagation();
    e.preventDefault();
    setDraft(value || "");
    setIsEditing(true);
  }, [value]);

  const commit = useCallback(() => {
    const trimmed = draft.trim();
    setIsEditing(false);
    if (!trimmed) return;               // Empty → revert, no commit
    if (trimmed === (value || "")) return; // Unchanged → no-op
    onCommit(trimmed);
  }, [draft, value, onCommit]);

  const cancel = useCallback(() => {
    setDraft(value || "");
    setIsEditing(false);
  }, [value]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancel();
    }
    e.stopPropagation(); // Prevent keyboard shortcuts from firing while editing
  }, [commit, cancel]);

  if (isEditing) {
    return (
      <input
        ref={inputRef}
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={handleKeyDown}
        onClick={(e) => e.stopPropagation()}
        draggable={false}
        placeholder={placeholder}
        style={{
          background: "transparent",
          border: `1px solid ${C.accent}`,
          borderRadius: RADIUS.sm,
          padding: "1px 4px",
          fontSize,
          fontWeight,
          fontFamily: FONT,
          color,
          outline: "none",
          boxShadow: `0 0 0 2px ${C.accent}33`,
          maxWidth,
          width: "100%",
          lineHeight: "1.4",
          letterSpacing: "inherit",
          textTransform: "inherit",
        }}
      />
    );
  }

  return (
    <span
      onDoubleClick={singleClick ? undefined : startEditing}
      onClick={singleClick ? startEditing : undefined}
      title="Double-click to rename"
      style={{
        fontSize,
        fontWeight,
        fontFamily: "inherit",
        color: value ? color : C.darkMuted,
        cursor: "text",
        maxWidth,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        letterSpacing: "inherit",
        textTransform: "inherit",
        transition: "opacity 0.12s",
        display: "inline-block",
      }}
    >
      {value || placeholder}
    </span>
  );
}
