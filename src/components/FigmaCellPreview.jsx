// ─── Figma Cell Preview ───
// Expanded card opened when a user clicks a figma_files pill in a cell.
// Shows a larger thumbnail + filename and exposes the two Open actions
// (in-app viewer or figma.com). The in-app action routes through
// NavigationContext's navigateToFigmaFile so it lands in the takeover
// viewer that Phase 1 built.

import React from "react";
import { createPortal } from "react-dom";
import { C, FONT, RADIUS, SHADOW, Z } from "../design/tokens.js";
import { IconFigma, IconClose } from "../design/icons.jsx";
import { useNavigation } from "../context/NavigationContext.jsx";

export default function FigmaCellPreview({ file, onClose }) {
  const nav = useNavigation();

  if (!file?.file_key) return null;

  const handleOpenInApp = () => {
    if (nav?.navigateToFigmaFile) {
      nav.navigateToFigmaFile(file.file_key, file.file_name || "");
    }
    onClose?.();
  };

  return createPortal((
    <div
      style={{
        position: "fixed", inset: 0, background: C.overlayBg,
        zIndex: Z.modal + 1,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontFamily: FONT,
      }}
      // React events bubble through the React tree even when the element is
      // portaled to document.body. Without stopPropagation the click ends up
      // back in the field row's onClick (RecordDetail.startEdit) and reopens
      // the picker on every close. Contain all clicks at the overlay.
      onClick={(e) => {
        e.stopPropagation();
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="figma-cell-preview-title"
        style={{
          width: "min(540px, 90vw)",
          background: C.darkSurf, border: `1px solid ${C.darkBorder}`,
          borderRadius: RADIUS.xl, boxShadow: SHADOW.dropdown,
          overflow: "hidden", display: "flex", flexDirection: "column",
        }}
      >
        {/* Header */}
        <div style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "12px 16px", borderBottom: `1px solid ${C.darkBorder}`,
        }}>
          <IconFigma size={16} />
          <div id="figma-cell-preview-title" style={{ flex: 1, fontSize: 13, fontWeight: 600, color: C.darkText, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {file.file_name || "Figma file"}
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); onClose?.(); }}
            aria-label="Close preview"
            style={{
              width: 28, height: 28, display: "inline-flex", alignItems: "center",
              justifyContent: "center", padding: 0,
              borderRadius: RADIUS.pill,
              background: "transparent", border: `1px solid ${C.darkBorder}`,
              color: C.darkMuted, cursor: "pointer", outline: "none",
            }}
          >
            <IconClose size={12} color={C.darkMuted} />
          </button>
        </div>

        {/* Thumbnail */}
        <div style={{
          width: "100%", aspectRatio: "4 / 3",
          background: C.darkSurf2, overflow: "hidden",
        }}>
          {file.thumbnail_url ? (
            <img
              src={file.thumbnail_url}
              alt={file.file_name || ""}
              style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
            />
          ) : (
            <div style={{
              width: "100%", height: "100%",
              display: "flex", alignItems: "center", justifyContent: "center",
              color: C.darkMuted, fontSize: 12,
            }}>
              No preview available
            </div>
          )}
        </div>

        {/* Actions */}
        <div style={{
          display: "flex", gap: 10, padding: "14px 16px",
          background: C.dark, borderTop: `1px solid ${C.darkBorder}`,
        }}>
          <button
            onClick={handleOpenInApp}
            style={{
              flex: 1, padding: "9px 14px", fontSize: 12, fontWeight: 600, fontFamily: FONT,
              background: C.accent, color: "#fff",
              border: "none", borderRadius: RADIUS.pill,
              cursor: "pointer", outline: "none",
              display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
            }}
          >
            <IconFigma size={13} />
            Open in App
          </button>
          <a
            href={`https://www.figma.com/design/${file.file_key}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              flex: 1, padding: "9px 14px", fontSize: 12, fontWeight: 500, fontFamily: FONT,
              background: "transparent", color: C.darkText,
              border: `1px solid ${C.darkBorder}`, borderRadius: RADIUS.pill,
              cursor: "pointer", outline: "none", textDecoration: "none",
              display: "inline-flex", alignItems: "center", justifyContent: "center",
            }}
          >
            Open in Figma
          </a>
        </div>
      </div>
    </div>
  ), document.body);
}
