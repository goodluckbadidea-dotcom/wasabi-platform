// ─── Multi-Select Picker ───
// Tag picker with pills + searchable dropdown for multi-select fields.
// Replaces comma-separated text input with a Notion-style multi-select.

import React, { useState, useRef, useEffect, useCallback } from "react";
import { C, FONT, RADIUS, SHADOW, getSolidPillColor, Z } from "../design/tokens.js";

/**
 * @param {Object} props
 * @param {string[]} props.value - Currently selected values
 * @param {Array<{name:string, color?:string}>} props.options - Available options
 * @param {Function} props.onChange - Called with updated array of selected values
 * @param {Function} props.onClose - Called when picker should close
 * @param {boolean} [props.allowCreate] - Show "Create option" button (D1 tables)
 * @param {Function} [props.onCreateOption] - Called with new option name
 * @param {{top:number, left:number, width:number}} [props.anchor] - Position anchor
 * @param {string} [props.initialChar] - Character that triggered opening
 */
export default function MultiSelectPicker({
  value = [],
  options = [],
  onChange,
  onClose,
  allowCreate = false,
  onCreateOption,
  anchor,
  initialChar = "",
}) {
  const [search, setSearch] = useState(initialChar);
  const [highlightIdx, setHighlightIdx] = useState(-1);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const containerRef = useRef(null);

  const optionNames = options.map((o) => (typeof o === "string" ? o : o.name));

  // Filter options by search
  const filtered = optionNames.filter((name) =>
    name.toLowerCase().includes(search.toLowerCase())
  );

  const canCreate =
    allowCreate &&
    search.trim() &&
    !optionNames.some((n) => n.toLowerCase() === search.trim().toLowerCase());

  useEffect(() => {
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  useEffect(() => {
    setHighlightIdx(search ? 0 : -1);
  }, [search]);

  // Click outside
  useEffect(() => {
    const handler = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  useEffect(() => {
    if (highlightIdx >= 0 && listRef.current) {
      const el = listRef.current.children[highlightIdx];
      if (el) el.scrollIntoView({ block: "nearest" });
    }
  }, [highlightIdx]);

  const toggleOption = useCallback(
    (name) => {
      if (value.includes(name)) {
        onChange(value.filter((v) => v !== name));
      } else {
        onChange([...value, name]);
      }
    },
    [value, onChange]
  );

  const removeTag = useCallback(
    (name) => {
      onChange(value.filter((v) => v !== name));
    },
    [value, onChange]
  );

  const handleKeyDown = useCallback(
    (e) => {
      const totalItems = filtered.length + (canCreate ? 1 : 0);

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlightIdx((prev) => (prev + 1) % totalItems);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlightIdx((prev) => (prev <= 0 ? totalItems - 1 : prev - 1));
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (highlightIdx >= 0 && highlightIdx < filtered.length) {
          toggleOption(filtered[highlightIdx]);
        } else if (canCreate && highlightIdx === filtered.length) {
          onCreateOption?.(search.trim());
          onChange([...value, search.trim()]);
          setSearch("");
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "Backspace" && !search && value.length > 0) {
        // Remove last tag on backspace in empty search
        onChange(value.slice(0, -1));
      }
    },
    [filtered, highlightIdx, canCreate, search, value, toggleOption, onChange, onClose, onCreateOption]
  );

  const posStyle = anchor
    ? {
        position: "fixed",
        top: anchor.top,
        left: anchor.left,
        width: Math.max(anchor.width, 260),
        zIndex: Z.lock,
      }
    : {
        position: "absolute",
        top: "100%",
        left: 0,
        width: "100%",
        minWidth: 260,
        zIndex: Z.lock,
      };

  return (
    <div ref={containerRef} style={posStyle}>
      <div
        style={{
          background: C.darkSurf,
          border: `1px solid ${C.darkBorder}`,
          borderRadius: RADIUS.lg,
          boxShadow: SHADOW.dropdown,
          overflow: "hidden",
          fontFamily: FONT,
        }}
      >
        {/* Selected tags + search input */}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 4,
            padding: "8px 8px 4px",
            alignItems: "center",
            minHeight: 36,
          }}
        >
          {value.map((tag) => {
            const { fill, text } = getSolidPillColor(tag, optionNames, options);
            return (
              <span
                key={tag}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  background: fill,
                  color: text,
                  borderRadius: RADIUS.pill,
                  padding: "2px 6px 2px 8px",
                  fontSize: 11,
                  fontWeight: 600,
                  fontFamily: FONT,
                  whiteSpace: "nowrap",
                }}
              >
                {tag}
                <span
                  onClick={(e) => {
                    e.stopPropagation();
                    removeTag(tag);
                  }}
                  style={{
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 14,
                    height: 14,
                    borderRadius: "50%",
                    fontSize: 10,
                    fontWeight: 700,
                    opacity: 0.7,
                    transition: "opacity 0.1s",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.opacity = "1";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.opacity = "0.7";
                  }}
                >
                  {"\u2715"}
                </span>
              </span>
            );
          })}
          <input
            ref={inputRef}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={value.length > 0 ? "" : "Search or filter..."}
            style={{
              flex: 1,
              minWidth: 80,
              border: "none",
              background: "transparent",
              color: C.darkText,
              fontFamily: FONT,
              fontSize: 13,
              padding: "4px 2px",
              outline: "none",
            }}
          />
        </div>

        {/* Divider */}
        <div style={{ borderTop: `1px solid ${C.edgeLine}` }} />

        {/* Options list */}
        <div
          ref={listRef}
          style={{
            maxHeight: 220,
            overflowY: "auto",
            padding: "4px 0",
          }}
        >
          {filtered.map((name, idx) => {
            const isChecked = value.includes(name);
            const isHighlighted = idx === highlightIdx;
            const { fill } = getSolidPillColor(name, optionNames, options);

            return (
              <div
                key={name}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 12px",
                  cursor: "pointer",
                  fontSize: 13,
                  fontFamily: FONT,
                  color: C.darkText,
                  background: isHighlighted ? C.darkSurf2 : "transparent",
                  transition: "background 0.08s",
                }}
                onClick={() => toggleOption(name)}
                onMouseEnter={() => setHighlightIdx(idx)}
              >
                {/* Checkbox */}
                <span
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: RADIUS.sm,
                    border: `2px solid ${isChecked ? C.accent : C.darkBorder}`,
                    background: isChecked ? C.accent : "transparent",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 9,
                    color: "#fff",
                    fontWeight: 700,
                    flexShrink: 0,
                    transition: "all 0.12s",
                  }}
                >
                  {isChecked ? "\u2713" : ""}
                </span>
                {/* Color dot */}
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    background: fill,
                    flexShrink: 0,
                  }}
                />
                <span style={{ flex: 1 }}>{name}</span>
              </div>
            );
          })}

          {/* Create option */}
          {canCreate && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "6px 12px",
                cursor: "pointer",
                fontSize: 13,
                fontFamily: FONT,
                color: C.accent,
                background:
                  highlightIdx === filtered.length
                    ? C.darkSurf2
                    : "transparent",
                borderTop: `1px solid ${C.edgeLine}`,
              }}
              onClick={() => {
                onCreateOption?.(search.trim());
                onChange([...value, search.trim()]);
                setSearch("");
              }}
              onMouseEnter={() => setHighlightIdx(filtered.length)}
            >
              <span style={{ fontSize: 14, fontWeight: 700 }}>+</span>
              <span>
                Create <strong>"{search.trim()}"</strong>
              </span>
            </div>
          )}

          {filtered.length === 0 && !canCreate && (
            <div
              style={{
                padding: "16px 12px",
                fontSize: 12,
                color: C.darkMuted,
                textAlign: "center",
              }}
            >
              No matching options
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
