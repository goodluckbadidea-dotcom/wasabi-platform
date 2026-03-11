// ─── Select Picker ───
// Searchable dropdown for select/status fields.
// Replaces native <select> with a Notion-style picker.

import React, { useState, useRef, useEffect, useCallback } from "react";
import { C, FONT, RADIUS, SHADOW, getSolidPillColor } from "../design/tokens.js";

/**
 * @param {Object} props
 * @param {string|null} props.value - Current selected value
 * @param {Array<{name:string, color?:string}>} props.options - Available options with optional Notion color
 * @param {Function} props.onSelect - Called with selected option name (or null to clear)
 * @param {Function} props.onClose - Called when picker should close
 * @param {boolean} [props.allowCreate] - Show "Create option" button (D1 tables)
 * @param {Function} [props.onCreateOption] - Called with new option name
 * @param {{top:number, left:number, width:number}} [props.anchor] - Position anchor rect
 * @param {string} [props.initialChar] - Character that triggered opening (type-to-search)
 */
export default function SelectPicker({
  value,
  options = [],
  onSelect,
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

  // Option names for color matching
  const optionNames = options.map((o) => (typeof o === "string" ? o : o.name));

  // Filter options by search
  const filtered = optionNames.filter((name) =>
    name.toLowerCase().includes(search.toLowerCase())
  );

  // Can create new option if search doesn't match any existing
  const canCreate =
    allowCreate &&
    search.trim() &&
    !optionNames.some((n) => n.toLowerCase() === search.trim().toLowerCase());

  // Focus input on mount
  useEffect(() => {
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  // Reset highlight when filtered list changes
  useEffect(() => {
    setHighlightIdx(search ? 0 : -1);
  }, [search]);

  // Click outside to close
  useEffect(() => {
    const handler = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  // Scroll highlighted option into view
  useEffect(() => {
    if (highlightIdx >= 0 && listRef.current) {
      const el = listRef.current.children[highlightIdx];
      if (el) el.scrollIntoView({ block: "nearest" });
    }
  }, [highlightIdx]);

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
          onSelect(filtered[highlightIdx]);
        } else if (canCreate && highlightIdx === filtered.length) {
          onCreateOption?.(search.trim());
          onSelect(search.trim());
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    },
    [filtered, highlightIdx, canCreate, search, onSelect, onClose, onCreateOption]
  );

  // Positioning
  const posStyle = anchor
    ? {
        position: "fixed",
        top: anchor.top,
        left: anchor.left,
        width: Math.max(anchor.width, 220),
        zIndex: 1000,
      }
    : {
        position: "absolute",
        top: "100%",
        left: 0,
        width: "100%",
        minWidth: 220,
        zIndex: 1000,
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
        {/* Search input */}
        <div style={{ padding: "8px 8px 4px" }}>
          <input
            ref={inputRef}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search or filter..."
            style={{
              width: "100%",
              border: `1px solid ${C.darkBorder}`,
              borderRadius: RADIUS.sm,
              background: C.darkSurf2,
              color: C.darkText,
              fontFamily: FONT,
              fontSize: 13,
              padding: "6px 10px",
              outline: "none",
              boxSizing: "border-box",
            }}
          />
        </div>

        {/* Clear option */}
        {value && (
          <div
            style={{
              padding: "5px 12px",
              fontSize: 12,
              color: C.darkMuted,
              cursor: "pointer",
              borderBottom: `1px solid ${C.edgeLine}`,
            }}
            onClick={() => onSelect(null)}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = C.darkSurf2;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
            }}
          >
            Clear selection
          </div>
        )}

        {/* Options list */}
        <div
          ref={listRef}
          style={{
            maxHeight: 240,
            overflowY: "auto",
            padding: "4px 0",
          }}
        >
          {filtered.map((name, idx) => {
            const isSelected = name === value;
            const isHighlighted = idx === highlightIdx;
            const { fill, text } = getSolidPillColor(name, optionNames, options);

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
                  background: isHighlighted
                    ? C.darkSurf2
                    : "transparent",
                  transition: "background 0.08s",
                }}
                onClick={() => onSelect(name)}
                onMouseEnter={() => setHighlightIdx(idx)}
              >
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
                {isSelected && (
                  <span
                    style={{
                      fontSize: 13,
                      color: C.accent,
                      fontWeight: 700,
                    }}
                  >
                    {"\u2713"}
                  </span>
                )}
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
                onSelect(search.trim());
              }}
              onMouseEnter={() => setHighlightIdx(filtered.length)}
            >
              <span style={{ fontSize: 14, fontWeight: 700 }}>+</span>
              <span>
                Create{" "}
                <strong>"{search.trim()}"</strong>
              </span>
            </div>
          )}

          {/* Empty state */}
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
