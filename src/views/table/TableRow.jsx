// ─── Table Row Group ───
// Renders one row group (parent + expanded sub-items) as a single continuous
// card. The wrapping <div> owns the card border, shadow, and radius; sub-items
// inside strip those, becoming indented strips beneath the parent.

import React, { useRef } from "react";
import { C, FONT, RADIUS, SHADOW } from "../../design/tokens.js";

// Track which tables we've already warned about missing subSchema so the
// console doesn't fill with duplicate messages on every row render.
const _subSchemaWarned = new Set();
import { ANIM } from "../../design/animations.js";
import { IconPlus, IconChevronDown, IconSubItems } from "../../design/icons.jsx";
import { getPageTitle } from "../../notion/properties.js";
import { isNeuronsMode, dispatchNeuronSelect } from "../../neurons/NeuronsContext.jsx";
import NeuronBadge from "../../neurons/NeuronBadge.jsx";
import { getFieldType, readField } from "../_viewHelpers.js";
import { OWNER_COL_NAME, ROW_HEIGHT, EDITABLE_TYPES } from "./tableHelpers.js";
import { getStyles } from "./tableStyles.js";
import { OwnerCellDisplay } from "./OwnerCell.jsx";
import CellDisplay from "./CellDisplay.jsx";
import DependsOnCell from "./DependsOnCell.jsx";
import { GhostCell } from "./GhostRow.jsx";

export default function TableRow({
  group, localIdx,
  // Grid layout
  gtc, subGtc, columns, subColsList, subColumns,
  schema, subSchema,
  // Flags
  subItemsEnabled, isHovered, selectedRows, showOwnerColumn, showSubItemOwnerColumn, canEditSchema,
  // Callbacks
  setHoveredRow, setDetailPage, toggleRow, toggleExpand,
  handleCreateSubItem, onCreate,
  // Data
  teamUsers, resolvedLinks, config, relationTitles, recordTitlesById, badgeCounts,
  // Links
  removeLink,
  // Collaboration
  collab,
  // Sub-item column management
  renamingSubCol, setRenamingSubCol, renameSubValue, setRenameSubValue,
  handleRenameSubCol, setSubColCtxMenu, setAddSubColOpen, handleSubResizeStart,
  // Sub-item ghost
  subItemGhostParent, setSubItemGhostParent,
  subItemGhostValues, setSubItemGhostValues,
  subItemGhostSaving, subItemGhostActive, subGhostRef,
  handleSubItemGhostCommit,
  // Tree
  getChildren,
}) {
  const styles = getStyles();
  const subHeaderClickTimer = useRef(null);
  const parentEntry = group.parent;
  const children = group.children || [];
  const parentRow = parentEntry.row;
  const parentId = parentRow.id;
  const { hasChildren, isExpanded } = parentEntry;
  const isParentSelected = selectedRows.has(parentId);
  const ghostActiveHere = subItemGhostParent === parentId;
  // The group card opens its sub-item area when expanded AND there's
  // something to show (real children OR an active ghost row).
  const isGroupOpen = isExpanded && (children.length > 0 || ghostActiveHere);

  // Sub-schema fallback warning (preserved from prior implementation).
  // Sub-item rows authoritatively read from subSchema. If subSchema is
  // missing (Phase 2a safety net — should only happen on legacy tables
  // whose sub_columns were never seeded), fall back to parent schema so
  // nothing crashes, but log once per table so the mismatch is visible.
  const subSchemaMissing = children.length > 0 && !subSchema;
  if (subSchemaMissing) {
    const tableKey = schema?.tableId || schema?.title || "unknown";
    if (!_subSchemaWarned.has(tableKey)) {
      _subSchemaWarned.add(tableKey);
      console.warn(`[TableRow] Sub-items rendering with parent schema for table "${tableKey}" — no sub_columns defined. Add a sub-column via the column header menu to fix.`);
    }
  }
  const subItemSchema = subSchema || schema;

  // Group-card hover/selected colors. The "selected" state here tracks the
  // PARENT row's selection — sub-items can be individually selected too, but
  // their selection paints inline (cell tint) rather than changing the
  // group-card border.
  const cardBg = isParentSelected
    ? C.accent + "08"
    : isHovered
    ? C.darkSurf2
    : C.darkSurf;

  // Real-time collaboration presence (parent row only).
  const othersOnRow = collab?.getUsersOnRecord?.(parentId) || [];
  const presenceColor = othersOnRow.length > 0 ? othersOnRow[0].color : null;
  const presenceBorder = othersOnRow.length > 1
    ? { borderLeft: "3px solid", borderImage: `linear-gradient(to bottom, ${othersOnRow.map((u) => u.color).join(", ")}) 1` }
    : presenceColor ? { borderLeft: `3px solid ${presenceColor}` } : {};

  // ── Cell renderer (used for both parent strip and sub-item strips) ──
  function renderDataCells({ page, cols, activeSchema, isSubRow }) {
    const cellTypingMap = {};
    for (const u of othersOnRow) {
      if (u.isTyping && u.typingField) cellTypingMap[u.typingField] = u;
    }
    return cols.map((col, colIdx) => {
      if (col === OWNER_COL_NAME && (showOwnerColumn || (isSubRow && showSubItemOwnerColumn))) {
        const ownerIds = page._ownerUserIds || [];
        return (
          <div key={col} style={{ ...styles.gridCell, padding: "4px 8px" }}>
            <OwnerCellDisplay ownerIds={ownerIds} users={teamUsers} />
          </div>
        );
      }
      const type = getFieldType(activeSchema, col);
      const value = readField(page, col);
      const cellKey = `${page.id}:${col}`;
      const linkData = resolvedLinks.get(cellKey);
      const cellTyping = isSubRow ? null : cellTypingMap[col];
      const isFirstCol = colIdx === 0;
      return (
        <div
          key={col}
          style={{
            ...styles.gridCell,
            padding: "4px 8px",
            ...(cellTyping ? { boxShadow: `inset 0 -2px 0 ${cellTyping.color}` } : {}),
          }}
        >
          {isFirstCol && subItemsEnabled && isSubRow ? (
            <div style={{ display: "flex", alignItems: "center", minWidth: 0, width: "100%" }}>
              <div style={{ width: 24, flexShrink: 0 }} />
              <div style={{ minWidth: 0, flex: 1, overflow: "hidden" }}>
                <CellDisplay
                  value={value}
                  type={type}
                  fieldName={col}
                  schema={activeSchema}
                  relationTitles={relationTitles}
                  linkInfo={linkData ? { sourceName: linkData.link?.name, stale: linkData.stale } : undefined}
                  linkedValue={linkData?.value}
                  onLinkClick={linkData ? () => removeLink(linkData.link.id) : undefined}
                />
              </div>
            </div>
          ) : type === "depends_on" ? (
            <DependsOnCell recordId={page.id} recordTitlesById={recordTitlesById} />
          ) : (
            <CellDisplay
              value={value}
              type={type}
              fieldName={col}
              schema={activeSchema}
              relationTitles={relationTitles}
              linkInfo={linkData ? { sourceName: linkData.link?.name, stale: linkData.stale } : undefined}
              linkedValue={linkData?.value}
              onLinkClick={linkData ? () => removeLink(linkData.link.id) : undefined}
            />
          )}
        </div>
      );
    });
  }

  // ── Sub-item mini-header (column labels for sub-item area) ──
  function renderSubMiniHeader() {
    return (
      <div
        style={{
          display: "grid",
          gridTemplateColumns: subGtc,
          height: 28,
          alignItems: "center",
          borderBottom: `1px solid ${C.darkBorder}33`,
        }}
      >
        {/* Checkbox-aligned spacer */}
        <div style={{ padding: "0 8px", fontSize: 10, color: C.darkMuted }} />
        {subColsList.map((col) => (
          <div
            key={col}
            style={{ padding: "0 8px", fontSize: 11, fontWeight: 700, color: C.darkMuted, textTransform: "uppercase", letterSpacing: "0.06em", cursor: canEditSchema ? "pointer" : "default", userSelect: "none", position: "relative", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 4 }}
            onClick={(e) => {
              if (!canEditSchema) return;
              e.preventDefault(); e.stopPropagation();
              if (subHeaderClickTimer.current) {
                clearTimeout(subHeaderClickTimer.current);
                subHeaderClickTimer.current = null;
                return;
              }
              const rect = e.currentTarget.getBoundingClientRect();
              const menuW = 180;
              const x = Math.min(rect.left, window.innerWidth - menuW);
              const y = rect.bottom + 2;
              subHeaderClickTimer.current = setTimeout(() => {
                subHeaderClickTimer.current = null;
                setSubColCtxMenu({ col, x, y });
              }, 250);
            }}
            onDoubleClick={(e) => {
              e.preventDefault(); e.stopPropagation();
              if (subHeaderClickTimer.current) { clearTimeout(subHeaderClickTimer.current); subHeaderClickTimer.current = null; }
              if (canEditSchema) { setRenamingSubCol(col); setRenameSubValue(col); setSubColCtxMenu(null); }
            }}
            onContextMenu={(e) => {
              if (!canEditSchema) return;
              e.preventDefault(); e.stopPropagation();
              setSubColCtxMenu({ col, x: e.clientX, y: e.clientY });
            }}
          >
            {canEditSchema && renamingSubCol !== col && (
              <IconChevronDown size={9} color={C.darkMuted} />
            )}
            {renamingSubCol === col ? (
              <input
                autoFocus
                value={renameSubValue}
                onChange={(e) => setRenameSubValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleRenameSubCol(col, renameSubValue);
                  if (e.key === "Escape") setRenamingSubCol(null);
                  e.stopPropagation();
                }}
                onBlur={() => handleRenameSubCol(col, renameSubValue)}
                onClick={(e) => e.stopPropagation()}
                style={{
                  width: "100%", border: `1px solid ${C.accent}`, borderRadius: RADIUS.sm,
                  background: C.darkSurf2, color: C.darkText, fontFamily: FONT, fontSize: 11,
                  padding: "2px 6px", outline: "none", fontWeight: 600, textTransform: "uppercase",
                  letterSpacing: "0.06em",
                }}
              />
            ) : col}
            {handleSubResizeStart && (
              <span
                style={{
                  position: "absolute", right: 0, top: 0, bottom: 0, width: 5,
                  cursor: "col-resize", background: "transparent", zIndex: 3,
                }}
                onMouseDown={(e) => { e.stopPropagation(); handleSubResizeStart(col, e); }}
                onMouseEnter={(e) => { e.currentTarget.style.background = C.accent + "44"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
              />
            )}
          </div>
        ))}
        <div />
        <div />
        {canEditSchema && (
          <div
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: "pointer", fontSize: 11, color: C.darkMuted,
              gap: 4, padding: "0 4px",
            }}
            onClick={(e) => { e.stopPropagation(); setAddSubColOpen(true); }}
            title="Add sub-item column"
            onMouseEnter={(e) => { e.currentTarget.style.color = C.accent; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = C.darkMuted; }}
          >
            <IconPlus size={13} />
            {subColumns.length === 0 && (
              <span style={{ fontSize: 11, whiteSpace: "nowrap" }}>Add column</span>
            )}
          </div>
        )}
      </div>
    );
  }

  // ── Sub-item ghost row (inline new sub-item creation) ──
  function renderSubGhostRow() {
    return (
      <div
        ref={subGhostRef}
        key={`ghost-sub-${parentId}`}
        style={{
          ...styles.gridSubRow,
          gridTemplateColumns: subGtc,
          minHeight: ROW_HEIGHT,
          opacity: subItemGhostSaving ? 0.5 : 0.9,
          transition: "opacity 0.15s",
          cursor: "default",
          background: C.accent + "08",
        }}
      >
        {/* Checkbox spacer + dismiss button */}
        <div style={{ ...styles.gridCell, justifyContent: "center", padding: 0, gap: 2 }}>
          <IconPlus size={12} color={C.accent} style={{ opacity: 0.5 }} />
          <button
            title="Cancel"
            onClick={(e) => { e.stopPropagation(); setSubItemGhostParent(null); setSubItemGhostValues({}); subItemGhostActive.current = false; }}
            style={{
              background: "none", border: "none", cursor: "pointer",
              padding: 4, display: "flex", alignItems: "center",
              opacity: 0.4, transition: "opacity 0.15s",
              fontSize: 11, color: C.darkMuted, lineHeight: 1,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.opacity = "0.8"; }}
            onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.4"; }}
          >
            ✕
          </button>
        </div>
        {/* Editable cells — uses sub-item columns */}
        {subColsList.map((col, ci) => {
          const ghostSchema = subSchema || schema;
          const type = getFieldType(ghostSchema, col);
          const isEditable = EDITABLE_TYPES.has(type) || type === "title" || ci === 0;
          const isTitle = ci === 0;
          return (
            <div key={col} style={{ ...styles.gridCell, padding: "2px 6px" }}>
              {!isEditable ? (
                <span style={{ color: C.darkMuted, fontSize: 11, fontStyle: "italic" }}>--</span>
              ) : (
                <GhostCell
                  col={col}
                  type={type}
                  value={subItemGhostValues[col]}
                  schema={ghostSchema}
                  onSetValue={(c, v) => { subItemGhostActive.current = true; setSubItemGhostValues((p) => ({ ...p, [c]: v })); }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSubItemGhostCommit(); }
                    if (e.key === "Escape") { setSubItemGhostParent(null); setSubItemGhostValues({}); subItemGhostActive.current = false; }
                  }}
                  placeholder={isTitle ? "New sub-item..." : ""}
                  autoFocus={isTitle}
                />
              )}
            </div>
          );
        })}
        <div style={{ ...styles.gridCell, padding: "4px 2px" }} />
        <div style={{ ...styles.gridCell, padding: "4px 2px" }} />
      </div>
    );
  }

  // ── Render the full group card ──
  return (
    <div
      data-neuron-node={`row:${parentId}`}
      style={{
        ...styles.gridRow,
        background: cardBg,
        ...(isHovered ? {
          border: `1px solid ${C.border2}`,
          boxShadow: SHADOW.cardMaterialHover,
        } : {}),
        ...(isParentSelected ? {
          border: `1px solid ${C.accent}`,
        } : {}),
        ...presenceBorder,
        animation: ANIM.scrollReveal(localIdx),
        // Outer wrapper is a flex column; each strip inside is its own grid.
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
      onMouseEnter={() => setHoveredRow(parentId)}
      onMouseLeave={() => setHoveredRow(null)}
    >
      {/* 4px accent left bar when sub-item area is open */}
      {isGroupOpen && (
        <div
          aria-hidden
          style={{
            position: "absolute",
            left: 0, top: 0, bottom: 0,
            width: 4,
            background: C.accent,
            borderTopLeftRadius: RADIUS.lg,
            borderBottomLeftRadius: RADIUS.lg,
            pointerEvents: "none",
          }}
        />
      )}

      {/* ── Parent strip ── */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: gtc,
          minHeight: ROW_HEIGHT,
          cursor: "pointer",
        }}
        onClick={(e) => {
          if ((e.metaKey || e.ctrlKey) && isNeuronsMode()) {
            e.preventDefault();
            e.stopPropagation();
            dispatchNeuronSelect({ node_type: "row", node_id: parentId, node_label: getPageTitle(parentRow) || "Untitled" });
            return;
          }
          setDetailPage(parentRow);
        }}
      >
        {/* Checkbox + sub-items button cell */}
        <div style={{ ...styles.gridCell, justifyContent: "center", padding: 0, gap: 2 }}>
          <span
            style={styles.toggle(isParentSelected)}
            onClick={(e) => { e.stopPropagation(); toggleRow(parentId); }}
          >
            {isParentSelected ? "✓" : ""}
          </span>
          {/* Sub-items button: unified expand-or-add control. */}
          {subItemsEnabled && onCreate && (
            <button
              data-sub-item-trigger
              title={hasChildren ? (isExpanded ? "Collapse sub-items" : `Show ${getChildren(parentId).length} sub-item${getChildren(parentId).length === 1 ? "" : "s"}`) : "Add sub-item"}
              onClick={(e) => {
                e.stopPropagation();
                if (hasChildren) {
                  toggleExpand(parentId);
                } else {
                  handleCreateSubItem(parentId);
                }
              }}
              aria-expanded={hasChildren ? isExpanded : undefined}
              style={{
                background: hasChildren && isExpanded ? C.darkSurf2 : "none",
                border: "none", cursor: "pointer",
                padding: "0 6px", display: "flex", alignItems: "center",
                gap: 5,
                minWidth: 40, height: 32, justifyContent: "center",
                borderRadius: RADIUS.sm,
                transition: "background 0.12s",
              }}
              onMouseEnter={(e) => { if (!(hasChildren && isExpanded)) e.currentTarget.style.background = C.darkSurf2; }}
              onMouseLeave={(e) => { if (!(hasChildren && isExpanded)) e.currentTarget.style.background = "none"; }}
            >
              <IconSubItems size={18} color={C.darkMuted} />
              {hasChildren && (
                <span style={{
                  fontSize: 12, fontWeight: 600, color: C.darkMuted,
                  lineHeight: 1, minWidth: 10, textAlign: "left",
                }}>
                  {getChildren(parentId).length}
                </span>
              )}
            </button>
          )}
        </div>
        {/* Data cells */}
        {renderDataCells({ page: parentRow, cols: columns, activeSchema: schema, isSubRow: false })}
        {/* Record badge cell (comments, files, notes) */}
        <div style={{ ...styles.gridCell, justifyContent: "center", padding: "4px 2px", gap: 3, display: "flex", alignItems: "center" }}>
          {badgeCounts[parentId]?.comments > 0 && (
            <span title={`${badgeCounts[parentId].comments} comment${badgeCounts[parentId].comments !== 1 ? "s" : ""}`} style={{ fontSize: 10, color: C.darkMuted, display: "flex", alignItems: "center", gap: 2 }}>
              <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M2 3h12v8H5l-3 3V3z" stroke="currentColor" strokeWidth="1.3" fill="none"/></svg>
              {badgeCounts[parentId].comments}
            </span>
          )}
          {badgeCounts[parentId]?.files > 0 && (
            <span title={`${badgeCounts[parentId].files} file${badgeCounts[parentId].files !== 1 ? "s" : ""}`} style={{ fontSize: 10, color: C.darkMuted, display: "flex", alignItems: "center", gap: 2 }}>
              <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M8.5 1.5l4 4v8a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1h4z" stroke="currentColor" strokeWidth="1.3" fill="none"/></svg>
              {badgeCounts[parentId].files}
            </span>
          )}
          {badgeCounts[parentId]?.notes && (
            <span title="Has notes" style={{ width: 5, height: 5, borderRadius: "50%", background: C.accent, flexShrink: 0 }} />
          )}
        </div>
        {/* Neuron badge cell */}
        <div style={{ ...styles.gridCell, justifyContent: "center", padding: "4px 2px", borderRight: "none" }}>
          <NeuronBadge nodeId={parentId} />
        </div>
      </div>

      {/* ── Sub-item area (visible when group is open) ── */}
      {isGroupOpen && (
        <>
          <div style={{ height: 0, borderTop: `1px solid ${C.border}33` }} />
          {renderSubMiniHeader()}
          {children.map((childEntry) => {
            const childRow = childEntry.row;
            const childId = childRow.id;
            const isChildSelected = selectedRows.has(childId);
            const isChildHovered = false; // group-level hover only; per-sub hover not tracked
            return (
              <div
                key={childId}
                data-neuron-node={`row:${childId}`}
                style={{
                  ...styles.gridSubRow,
                  gridTemplateColumns: subGtc,
                  minHeight: ROW_HEIGHT,
                  background: isChildSelected ? C.accent + "12" : "transparent",
                }}
                onClick={(e) => {
                  if ((e.metaKey || e.ctrlKey) && isNeuronsMode()) {
                    e.preventDefault();
                    e.stopPropagation();
                    dispatchNeuronSelect({ node_type: "row", node_id: childId, node_label: getPageTitle(childRow) || "Untitled" });
                    return;
                  }
                  setDetailPage(childRow);
                }}
                onMouseEnter={(e) => { if (!isChildSelected) e.currentTarget.style.background = `rgba(255,255,255,0.025)`; }}
                onMouseLeave={(e) => { if (!isChildSelected) e.currentTarget.style.background = "transparent"; }}
              >
                {/* Checkbox cell */}
                <div style={{ ...styles.gridCell, justifyContent: "center", padding: 0, gap: 2 }}>
                  <span
                    style={styles.toggle(isChildSelected)}
                    onClick={(e) => { e.stopPropagation(); toggleRow(childId); }}
                  >
                    {isChildSelected ? "✓" : ""}
                  </span>
                </div>
                {/* Data cells (uses subItemSchema) */}
                {renderDataCells({ page: childRow, cols: subColsList, activeSchema: subItemSchema, isSubRow: true })}
                {/* Badge cell */}
                <div style={{ ...styles.gridCell, justifyContent: "center", padding: "4px 2px", gap: 3, display: "flex", alignItems: "center" }}>
                  {badgeCounts[childId]?.comments > 0 && (
                    <span title={`${badgeCounts[childId].comments} comment${badgeCounts[childId].comments !== 1 ? "s" : ""}`} style={{ fontSize: 10, color: C.darkMuted, display: "flex", alignItems: "center", gap: 2 }}>
                      <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M2 3h12v8H5l-3 3V3z" stroke="currentColor" strokeWidth="1.3" fill="none"/></svg>
                      {badgeCounts[childId].comments}
                    </span>
                  )}
                  {badgeCounts[childId]?.files > 0 && (
                    <span title={`${badgeCounts[childId].files} file${badgeCounts[childId].files !== 1 ? "s" : ""}`} style={{ fontSize: 10, color: C.darkMuted, display: "flex", alignItems: "center", gap: 2 }}>
                      <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M8.5 1.5l4 4v8a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1h4z" stroke="currentColor" strokeWidth="1.3" fill="none"/></svg>
                      {badgeCounts[childId].files}
                    </span>
                  )}
                  {badgeCounts[childId]?.notes && (
                    <span title="Has notes" style={{ width: 5, height: 5, borderRadius: "50%", background: C.accent, flexShrink: 0 }} />
                  )}
                </div>
                {/* Neuron cell */}
                <div style={{ ...styles.gridCell, justifyContent: "center", padding: "4px 2px", borderRight: "none" }}>
                  <NeuronBadge nodeId={childId} />
                </div>
              </div>
            );
          })}
          {ghostActiveHere && onCreate && renderSubGhostRow()}
        </>
      )}
    </div>
  );
}
