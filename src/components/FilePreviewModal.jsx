// ─── File Preview Modal ───
// Opened when a user clicks an attached file. Renders images and PDFs inline
// and always offers Download / Open in new tab.
//
// Both signed URLs are minted once when the modal opens, not on button click.
// That is deliberate: a link fetched inside a click handler would have to be
// awaited first, and Safari treats the resulting window.open() as a popup and
// blocks it. Because the hrefs are already in state, both actions are plain
// synchronous anchors.

import React, { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { C, FONT, RADIUS, SHADOW, Z } from "../design/tokens.js";
import { IconClose, IconArrowDown, IconExport, IconWarning } from "../design/icons.jsx";
import { getFileLink } from "../lib/api.js";

function isPreviewableImage(mime) {
  return typeof mime === "string" && mime.startsWith("image/");
}

// Browsers render PDFs natively in an iframe. Everything else is offered as a
// download rather than pretending to preview it.
function isPreviewablePdf(mime) {
  return mime === "application/pdf";
}

export default function FilePreviewModal({ file, onClose }) {
  const [previewUrl, setPreviewUrl] = useState("");
  const [downloadUrl, setDownloadUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fileId = file?.id;
  const name = file?.name || "File";
  const mime = file?.mime_type || "";

  useEffect(() => {
    if (!fileId) return;
    let cancelled = false;
    setLoading(true);
    setError("");

    Promise.all([
      getFileLink(fileId),
      getFileLink(fileId, { download: true }),
    ])
      .then(([preview, download]) => {
        if (cancelled) return;
        if (preview?._error || download?._error) {
          setError(preview?._error || download?._error);
        } else {
          setPreviewUrl(preview?.url || "");
          setDownloadUrl(download?.url || "");
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || "Could not load this file");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [fileId]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); onClose?.(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!file) return null;

  const canPreview = isPreviewableImage(mime) || isPreviewablePdf(mime);

  const actionBtn = (primary) => ({
    padding: "9px 16px", fontSize: 12, fontWeight: primary ? 600 : 500, fontFamily: FONT,
    background: primary ? C.accent : "transparent",
    color: primary ? "#fff" : C.darkText,
    border: primary ? "none" : `1px solid ${C.darkBorder}`,
    borderRadius: RADIUS.pill,
    cursor: "pointer", outline: "none", textDecoration: "none",
    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
    opacity: loading || error ? 0.5 : 1,
    pointerEvents: loading || error ? "none" : "auto",
  });

  return createPortal((
    <div
      style={{
        position: "fixed", inset: 0, background: C.overlayBg,
        zIndex: Z.modal + 1,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontFamily: FONT,
      }}
      // Contain clicks at the overlay. React bubbles events through the
      // component tree even from a portal, so without this the click continues
      // into the field row behind and re-triggers whatever opened this.
      onClick={(e) => {
        e.stopPropagation();
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Preview of ${name}`}
        style={{
          width: "min(1100px, 94vw)",
          height: "min(860px, 90vh)",
          background: C.darkSurf, border: `1px solid ${C.darkBorder}`,
          borderRadius: RADIUS.xl, boxShadow: SHADOW.dropdown,
          overflow: "hidden", display: "flex", flexDirection: "column",
        }}
      >
        {/* Header */}
        <div style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "12px 16px", borderBottom: `1px solid ${C.darkBorder}`, flexShrink: 0,
        }}>
          <div style={{
            flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, color: C.darkText,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {name}
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); onClose?.(); }}
            aria-label="Close preview"
            style={{
              width: 28, height: 28, display: "inline-flex", alignItems: "center",
              justifyContent: "center", padding: 0, flexShrink: 0,
              borderRadius: RADIUS.pill,
              background: "transparent", border: `1px solid ${C.darkBorder}`,
              color: C.darkMuted, cursor: "pointer", outline: "none",
            }}
          >
            <IconClose size={12} color={C.darkMuted} />
          </button>
        </div>

        {/* Body */}
        <div style={{
          flex: 1, minHeight: 0, background: C.darkSurf2,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          {loading ? (
            <div style={{ color: C.darkMuted, fontSize: 12 }}>Loading preview...</div>
          ) : error ? (
            <div style={{
              display: "flex", flexDirection: "column", alignItems: "center", gap: 10,
              color: C.warning, fontSize: 12, textAlign: "center", padding: 24,
            }}>
              <IconWarning size={20} color={C.warning} />
              <div>{error}</div>
            </div>
          ) : !canPreview ? (
            <div style={{
              display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
              color: C.darkMuted, fontSize: 12, textAlign: "center", padding: 24,
            }}>
              <div style={{ fontSize: 28 }}>📄</div>
              <div>No inline preview for this file type.</div>
              <div style={{ fontSize: 11 }}>Use Download or Open in new tab.</div>
            </div>
          ) : isPreviewableImage(mime) ? (
            <img
              src={previewUrl}
              alt={name}
              style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", display: "block" }}
            />
          ) : (
            <iframe
              src={previewUrl}
              title={name}
              style={{ width: "100%", height: "100%", border: "none", display: "block" }}
            />
          )}
        </div>

        {/* Actions */}
        <div style={{
          display: "flex", gap: 10, padding: "14px 16px", flexShrink: 0,
          background: C.dark, borderTop: `1px solid ${C.darkBorder}`,
        }}>
          <a href={downloadUrl} style={actionBtn(true)}>
            <IconArrowDown size={13} color="#fff" />
            Download
          </a>
          <a href={previewUrl} target="_blank" rel="noopener noreferrer" style={actionBtn(false)}>
            <IconExport size={13} color={C.darkText} />
            Open in new tab
          </a>
        </div>
      </div>
    </div>
  ), document.body);
}
