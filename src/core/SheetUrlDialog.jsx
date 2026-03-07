// ─── Sheet URL Dialog ───
// Modal for pasting a Google Sheet or CSV URL when adding a Linked Sheet view.
// Matches ConfirmDialog styling. Validates URL and detects type.

import React, { useState, useEffect, useCallback, useRef } from "react";
import { C, FONT, RADIUS, SHADOW } from "../design/tokens.js";
import { S } from "../design/styles.js";
import { ANIM } from "../design/animations.js";
import { validateSheetUrl } from "../sheets/sheetClient.js";

export default function SheetUrlDialog({ onConfirm, onCancel }) {
  const [url, setUrl] = useState("");
  const [validation, setValidation] = useState({ valid: false, type: null, error: null });
  const [focused, setFocused] = useState(false);
  const inputRef = useRef(null);
  const debounceRef = useRef(null);

  // Auto-focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Close on Escape
  useEffect(() => {
    const handler = (e) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onCancel]);

  // Debounced validation
  const handleChange = useCallback((e) => {
    const v = e.target.value;
    setUrl(v);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setValidation(validateSheetUrl(v));
    }, 300);
  }, []);

  // Submit
  const handleSubmit = useCallback(() => {
    if (!validation.valid) return;
    onConfirm({ sheetUrl: url.trim(), sheetType: validation.type });
  }, [url, validation, onConfirm]);

  // Enter key submits
  const handleKeyDown = useCallback((e) => {
    if (e.key === "Enter" && validation.valid) {
      handleSubmit();
    }
  }, [validation.valid, handleSubmit]);

  // Status indicator
  const renderStatus = () => {
    if (!url.trim()) return null;

    if (validation.valid && validation.type === "google_sheets") {
      return (
        <div style={{ fontSize: 12, color: C.accent, marginTop: 8, display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 14 }}>&#10003;</span>
          Google Sheet detected
        </div>
      );
    }
    if (validation.valid && validation.type === "csv") {
      return (
        <div style={{ fontSize: 12, color: C.accent, marginTop: 8, display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 14 }}>&#10003;</span>
          CSV file detected
        </div>
      );
    }
    if (validation.type === "unsupported") {
      return (
        <div style={{ fontSize: 12, color: C.orange, marginTop: 8, display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 14 }}>&#9888;</span>
          {validation.error}
        </div>
      );
    }
    if (validation.error) {
      return (
        <div style={{ fontSize: 12, color: "#E05252", marginTop: 8 }}>
          {validation.error}
        </div>
      );
    }
    return null;
  };

  return (
    <div
      onClick={onCancel}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        zIndex: 200,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        animation: ANIM.fadeIn(),
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: C.darkSurf,
          border: `1px solid ${C.darkBorder}`,
          borderRadius: RADIUS.xl,
          padding: "24px 28px",
          maxWidth: 480,
          width: "90vw",
          boxShadow: SHADOW.dropdown,
          animation: ANIM.scaleIn(),
          fontFamily: FONT,
        }}
      >
        {/* Title */}
        <div style={{ fontSize: 16, fontWeight: 600, color: C.darkText, marginBottom: 6 }}>
          Link External Sheet
        </div>
        <div style={{ fontSize: 13, color: C.darkMuted, lineHeight: 1.5, marginBottom: 16 }}>
          Paste a URL to a public Google Sheet or CSV file.
        </div>

        {/* URL Input */}
        <input
          ref={inputRef}
          type="url"
          value={url}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder="https://docs.google.com/spreadsheets/d/..."
          style={{
            ...S.input,
            ...(focused ? S.inputFocused : {}),
          }}
        />

        {/* Status indicator */}
        {renderStatus()}

        {/* Buttons */}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20 }}>
          <button
            onClick={onCancel}
            style={{
              background: C.darkSurf2,
              color: C.darkText,
              border: `1px solid ${C.darkBorder}`,
              borderRadius: RADIUS.pill,
              padding: "7px 18px",
              fontSize: 13,
              fontWeight: 600,
              fontFamily: FONT,
              cursor: "pointer",
              outline: "none",
              transition: "background 0.12s",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "#363636"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = C.darkSurf2; }}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!validation.valid}
            style={{
              background: validation.valid ? C.accent : C.darkSurf2,
              color: validation.valid ? "#fff" : C.darkMuted,
              border: "none",
              borderRadius: RADIUS.pill,
              padding: "8px 20px",
              fontSize: 13,
              fontWeight: 600,
              fontFamily: FONT,
              cursor: validation.valid ? "pointer" : "default",
              outline: "none",
              transition: "background 0.12s",
              opacity: validation.valid ? 1 : 0.5,
            }}
            onMouseEnter={(e) => {
              if (validation.valid) e.currentTarget.style.background = C.accentDim;
            }}
            onMouseLeave={(e) => {
              if (validation.valid) e.currentTarget.style.background = C.accent;
            }}
          >
            Connect
          </button>
        </div>
      </div>
    </div>
  );
}
