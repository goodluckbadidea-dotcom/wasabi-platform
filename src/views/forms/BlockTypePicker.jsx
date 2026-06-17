// ─── Forms feature — "+ Add" block picker ───
// Opens when the user clicks the pill-styled "+" button in the designer.
// Sections: "Insert from column" (shortcut), "Form fields", "Layout".

import React, { useState } from "react";
import { createPortal } from "react-dom";
import { C, FONT, RADIUS, SHADOW } from "../../design/tokens.js";
import { hoverBg } from "../../design/interactions.js";
import { BLOCK_LIBRARY, BLOCK_TYPE_TO_COLUMN_TYPE, groupBlocks, makeField } from "./formTypes.js";

export default function BlockTypePicker({ open, onClose, onPick, anchorRect, tableColumns = [] }) {
  const [showColumnSubmenu, setShowColumnSubmenu] = useState(false);

  if (!open || !anchorRect) return null;

  const groups = groupBlocks();
  const left = Math.min(anchorRect.left, window.innerWidth - 280);
  const top = anchorRect.bottom + 6;

  const handlePickType = (type) => {
    onPick(makeField(type));
    onClose();
  };

  const handlePickFromColumn = (column) => {
    // Map column type → block type (inverse of BLOCK_TYPE_TO_COLUMN_TYPE)
    const blockType = inferBlockTypeFromColumn(column);
    onPick(makeField(blockType, {
      label: column.name,
      linked_column_id: column.id,
      options: column.options || [],
    }));
    onClose();
  };

  return createPortal(
    <>
      <div style={{ position: "fixed", inset: 0, zIndex: 299 }} onMouseDown={onClose} />
      <div
        style={{
          position: "fixed", left, top, zIndex: 300,
          width: 260, background: C.darkSurf, border: `1px solid ${C.darkBorder}`,
          borderRadius: RADIUS.lg, padding: 6,
          maxHeight: "calc(100vh - 32px)", overflowY: "auto",
          boxShadow: SHADOW.dropdown, fontFamily: FONT,
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Insert from column */}
        <SectionLabel>Insert from column</SectionLabel>
        <button
          style={pickerItem}
          onClick={() => setShowColumnSubmenu((v) => !v)}
          {...hoverBg()}
        >
          <BlockIcon>↳</BlockIcon>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, color: C.darkText, fontWeight: 600 }}>Pick a column</div>
            <div style={{ fontSize: 10, color: C.darkMuted }}>Pre-linked field from this table</div>
          </div>
          <span style={{ color: C.darkMuted, fontSize: 11 }}>{showColumnSubmenu ? "▼" : "▶"}</span>
        </button>
        {showColumnSubmenu && (
          <div style={{ paddingLeft: 24, marginBottom: 4 }}>
            {tableColumns.length === 0 && (
              <div style={{ fontSize: 11, color: C.darkMuted, padding: 6, fontStyle: "italic" }}>
                No columns on this table
              </div>
            )}
            {tableColumns.map((col) => (
              <button
                key={col.id}
                style={{ ...pickerItem, padding: "5px 8px" }}
                onClick={() => handlePickFromColumn(col)}
                {...hoverBg()}
              >
                <span style={{ fontSize: 11, color: C.darkText }}>{col.name}</span>
              </button>
            ))}
          </div>
        )}

        <Divider />

        {/* Form fields */}
        <SectionLabel>{Object.keys(groups)[1]}</SectionLabel>
        {groups["Form fields"]?.map((b) => (
          <button
            key={b.type}
            style={pickerItem}
            onClick={() => handlePickType(b.type)}
            {...hoverBg()}
          >
            <BlockIcon>{b.icon}</BlockIcon>
            <div style={{ flex: 1, textAlign: "left" }}>
              <div style={{ fontSize: 12, color: C.darkText, fontWeight: 600 }}>{b.label}</div>
              <div style={{ fontSize: 10, color: C.darkMuted }}>{b.description}</div>
            </div>
          </button>
        ))}

        <Divider />

        {/* Layout */}
        <SectionLabel>Layout</SectionLabel>
        {groups["Layout"]?.map((b) => (
          <button
            key={b.type}
            style={pickerItem}
            onClick={() => handlePickType(b.type)}
            {...hoverBg()}
          >
            <BlockIcon>{b.icon}</BlockIcon>
            <div style={{ flex: 1, textAlign: "left" }}>
              <div style={{ fontSize: 12, color: C.darkText, fontWeight: 600 }}>{b.label}</div>
              <div style={{ fontSize: 10, color: C.darkMuted }}>{b.description}</div>
            </div>
          </button>
        ))}
      </div>
    </>,
    document.body
  );
}

function inferBlockTypeFromColumn(col) {
  const t = col.type;
  if (t === "text" || t === "rich_text" || t === "title") return "short_text";
  if (t === "number") return "number";
  if (t === "date") return "date";
  if (t === "select") return "single_select";
  if (t === "multi_select") return "multi_select";
  if (t === "status") return "status";
  if (t === "checkbox") return "checkbox";
  if (t === "url") return "url";
  if (t === "email") return "email";
  if (t === "phone" || t === "phone_number") return "phone";
  if (t === "people") return "person";
  if (t === "relation") return "linked_record";
  if (t === "figma_files") return "figma_file";
  return "short_text";
}

function SectionLabel({ children }) {
  return (
    <div style={{
      fontSize: 10, fontWeight: 700, textTransform: "uppercase",
      letterSpacing: "0.06em", color: C.darkMuted,
      padding: "6px 10px 4px",
    }}>{children}</div>
  );
}

function Divider() {
  return <div style={{ borderTop: `1px solid ${C.edgeLine}`, margin: "4px 0" }} />;
}

const BlockIcon = ({ children }) => (
  <span style={{
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    width: 22, height: 22, fontSize: 13, color: C.darkMuted, flexShrink: 0,
  }}>{children}</span>
);

const pickerItem = {
  display: "flex", alignItems: "center", gap: 8,
  padding: "6px 8px", borderRadius: RADIUS.sm,
  background: "transparent", border: "none", cursor: "pointer",
  width: "100%", textAlign: "left", fontFamily: "inherit",
};
