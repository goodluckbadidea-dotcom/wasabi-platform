// ─── Table Row ───
// Renders a single data row (parent or sub-item), including sub-item mini-header
// and inline sub-item ghost row when applicable.

import React, { useRef } from "react";
import { C, FONT, RADIUS, getStatusColor } from "../../design/tokens.js";

// Track which tables we've already warned about missing subSchema so the
// console doesn't fill with duplicate messages on every row render.
const _subSchemaWarned = new Set();
import { ANIM } from "../../design/animations.js";
import { IconPlus, IconChevronDown, IconSubItems } from "../../design/icons.jsx";
import { getPageTitle } from "../../notion/properties.js";
import { isNeuronsMode, dispatchNeuronSelect } from "../../neurons/NeuronsContext.jsx";
import NeuronBadge from "../../neurons/NeuronBadge.jsx";
import { getFieldType, readField, getFieldOptions, getOptionNames } from "../_viewHelpers.js";
import { OWNER_COL_NAME, ROW_HEIGHT, EDITABLE_TYPES } from "./tableHelpers.js";
import { getStyles } from "./tableStyles.js";
import { OwnerCellDisplay } from "./OwnerCell.jsx";
import CellDisplay from "./CellDisplay.jsx";
import DependsOnCell from "./DependsOnCell.jsx";
import { GhostCell } from "./GhostRow.jsx";

export default function TableRow({
  entry, localIdx, prevEntry,
  // Grid layout
  gtc, subGtc, columns, subColsList, subColumns,
  schema, subSchema,
  // Flags
  subItemsEnabled, isHovered, isSelected, showOwnerColumn, showSubItemOwnerColumn, canEditSchema,
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
  const page = entry.row;
  const { depth: rowDepth, hasChildren, isExpanded } = entry;
  const pageId = page.id;
  const isSubItem = rowDepth > 0;
  const isFirstChild = isSubItem && (!prevEntry || prevEntry.depth === 0);
  const activeGtc = isSubItem ? subGtc : gtc;
  const activeCols = isSubItem ? subColsList : columns;
  // Sub-item rows authoritatively read from subSchema. If subSchema is
  // missing (Phase 2a safety net — should only happen on legacy tables
  // whose sub_columns were never seeded), fall back to parent schema so
  // nothing crashes, but log once per table so the mismatch is visible.
  // Phase 2b will seed sub_columns on new tables so this branch stays cold.
  const subSchemaMissing = isSubItem && !subSchema;
  if (subSchemaMissing) {
    const tableKey = schema?.tableId || schema?.title || "unknown";
    if (!_subSchemaWarned.has(tableKey)) {
      _subSchemaWarned.add(tableKey);
      console.warn(`[TableRow] Sub-items rendering with parent schema for table "${tableKey}" — no sub_columns defined. Add a sub-column via the column header menu to fix.`);
    }
  }
  const activeSchema = isSubItem && subSchema ? subSchema : schema;

  const childBgTint = rowDepth > 0 ? "rgba(255,255,255,0.015)" : "transparent";

  // Derive status color for gradient hover wash
  const _statusField = activeCols.find((col) => {
    const t = getFieldType(activeSchema, col);
    return t === "status" || t === "select";
  });
  const _statusValue = _statusField ? readField(page, _statusField) : null;
  const _statusColor = _statusValue
    ? getStatusColor(_statusValue, getOptionNames(activeSchema, _statusField))
    : null;
  const hoverBg = _statusColor
    ? `linear-gradient(to right, ${_statusColor}18 0%, ${_statusColor}08 36px, ${C.darkSurf2} 120px)`
    : C.darkSurf2;

  const cardBg = isSelected ? C.accent + "10" : isHovered ? hoverBg : childBgTint;
  const othersOnRow = collab?.getUsersOnRecord?.(pageId) || [];
  const presenceColor = othersOnRow.length > 0 ? othersOnRow[0].color : null;
  const presenceBorder = othersOnRow.length > 1
    ? { borderLeft: "3px solid", borderImage: `linear-gradient(to bottom, ${othersOnRow.map((u) => u.color).join(", ")}) 1` }
    : presenceColor ? { borderLeft: `3px solid ${presenceColor}` } : {};

  return (
    <React.Fragment>
      {/* Sub-item mini-header (before first child row) */}
      {isFirstChild && subItemsEnabled && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: subGtc,
            height: 28,
            alignItems: "center",
            marginBottom: 2,
            marginLeft: 24,
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
                // 250ms delay so double-click (rename) beats single-click (menu)
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
              {/* Resize handle */}
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
      )}
      <div
        data-neuron-node={`row:${pageId}`}
        style={{
          ...styles.gridRow,
          gridTemplateColumns: activeGtc,
          minHeight: ROW_HEIGHT,
          background: cardBg,
          ...(isSubItem ? {
            borderLeft: `2px solid ${C.accent}22`,
            marginLeft: 22,
            borderRadius: `0 ${RADIUS.lg} ${RADIUS.lg} 0`,
          } : {}),
          ...(isHovered ? { boxShadow: `0 1px 4px rgba(0,0,0,0.08)` } : {}),
          ...presenceBorder,
          animation: ANIM.scrollReveal(localIdx),
        }}
        onMouseEnter={() => setHoveredRow(pageId)}
        onMouseLeave={() => setHoveredRow(null)}
        onClick={(e) => {
          if ((e.metaKey || e.ctrlKey) && isNeuronsMode()) {
            e.preventDefault();
            e.stopPropagation();
            dispatchNeuronSelect({ node_type: "row", node_id: pageId, node_label: getPageTitle(page) || "Untitled" });
            return;
          }
          setDetailPage(page);
        }}
      >
        {/* Checkbox + branch icon cell */}
        <div style={{ ...styles.gridCell, justifyContent: "center", padding: 0, gap: 2 }}>
          <span
            style={styles.toggle(isSelected)}
            onClick={(e) => { e.stopPropagation(); toggleRow(pageId); }}
          >
            {isSelected ? "\u2713" : ""}
          </span>
          {/* Sub-items button: unified expand-or-add control with stacked-L glyph.
              Has children → toggles expand/collapse. No children → opens ghost row
              (which auto-expands as a side effect). Always full opacity for iPad-friendly
              tap target. */}
          {subItemsEnabled && !isSubItem && rowDepth < 5 && onCreate && (
            <button
              data-sub-item-trigger
              title={hasChildren ? (isExpanded ? "Collapse sub-items" : `Show ${getChildren(pageId).length} sub-item${getChildren(pageId).length === 1 ? "" : "s"}`) : "Add sub-item"}
              onClick={(e) => {
                e.stopPropagation();
                if (hasChildren) {
                  toggleExpand(pageId);
                } else {
                  handleCreateSubItem(pageId);
                }
              }}
              aria-expanded={hasChildren ? isExpanded : undefined}
              style={{
                background: hasChildren && isExpanded ? C.darkSurf2 : "none",
                border: "none", cursor: "pointer",
                padding: 0, display: "flex", alignItems: "center",
                gap: 3,
                minWidth: 32, height: 28, justifyContent: "center",
                borderRadius: RADIUS.sm,
                transition: "background 0.12s",
              }}
              onMouseEnter={(e) => { if (!(hasChildren && isExpanded)) e.currentTarget.style.background = C.darkSurf2; }}
              onMouseLeave={(e) => { if (!(hasChildren && isExpanded)) e.currentTarget.style.background = "none"; }}
            >
              <IconSubItems size={14} color={C.darkMuted} />
              {hasChildren && (
                <span style={{
                  fontSize: 9, fontWeight: 600, color: C.darkMuted,
                  lineHeight: 1, minWidth: 8, textAlign: "left",
                }}>
                  {getChildren(pageId).length}
                </span>
              )}
            </button>
          )}
        </div>
        {/* Data cells */}
        {activeCols.map((col, colIdx) => {
          if (col === OWNER_COL_NAME && (showOwnerColumn || (isSubItem && showSubItemOwnerColumn))) {
            const ownerIds = page._ownerUserIds || [];
            return (
              <div
                key={col}
                style={{ ...styles.gridCell, padding: "4px 8px" }}
              >
                <OwnerCellDisplay
                  ownerIds={ownerIds}
                  users={teamUsers}
                />
              </div>
            );
          }
          const type = getFieldType(activeSchema, col);
          const value = readField(page, col);
          const cellKey = `${pageId}:${col}`;
          const linkData = resolvedLinks.get(cellKey);

          const cellTyping = othersOnRow.find((u) => u.isTyping && u.typingField === col);
          const isFirstCol = colIdx === 0;
          return (
            <div key={col} style={{
              ...styles.gridCell, padding: "4px 8px",
              ...(cellTyping ? { boxShadow: `inset 0 -2px 0 ${cellTyping.color}` } : {}),
            }}>
              {isFirstCol && subItemsEnabled ? (
                <div style={{ display: "flex", alignItems: "center", minWidth: 0, width: "100%" }}>
                  {rowDepth > 0 && <div style={{ width: rowDepth * 24, flexShrink: 0 }} />}
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
                <DependsOnCell
                  recordId={pageId}
                  recordTitlesById={recordTitlesById}
                />
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
        })}
        {/* Record badge cell (comments, files, notes) */}
        <div style={{ ...styles.gridCell, justifyContent: "center", padding: "4px 2px", gap: 3, display: "flex", alignItems: "center" }}>
          {badgeCounts[pageId]?.comments > 0 && (
            <span title={`${badgeCounts[pageId].comments} comment${badgeCounts[pageId].comments !== 1 ? "s" : ""}`} style={{ fontSize: 10, color: C.darkMuted, display: "flex", alignItems: "center", gap: 2 }}>
              <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M2 3h12v8H5l-3 3V3z" stroke="currentColor" strokeWidth="1.3" fill="none"/></svg>
              {badgeCounts[pageId].comments}
            </span>
          )}
          {badgeCounts[pageId]?.files > 0 && (
            <span title={`${badgeCounts[pageId].files} file${badgeCounts[pageId].files !== 1 ? "s" : ""}`} style={{ fontSize: 10, color: C.darkMuted, display: "flex", alignItems: "center", gap: 2 }}>
              <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M8.5 1.5l4 4v8a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1h4z" stroke="currentColor" strokeWidth="1.3" fill="none"/></svg>
              {badgeCounts[pageId].files}
            </span>
          )}
          {badgeCounts[pageId]?.notes && (
            <span title="Has notes" style={{ width: 5, height: 5, borderRadius: "50%", background: C.accent, flexShrink: 0 }} />
          )}
        </div>
        {/* Neuron badge cell — inline */}
        <div style={{ ...styles.gridCell, justifyContent: "center", padding: "4px 2px" }}>
          <NeuronBadge nodeId={pageId} />
        </div>
      </div>
      {/* Inline sub-item ghost row */}
      {subItemGhostParent === pageId && onCreate && (
        <div
          ref={subGhostRef}
          key={`ghost-sub-${pageId}`}
          style={{
            ...styles.gridRow,
            gridTemplateColumns: subGtc,
            minHeight: ROW_HEIGHT,
            opacity: subItemGhostSaving ? 0.5 : 0.9,
            transition: "opacity 0.15s",
            cursor: "default",
            background: C.accent + "08",
            borderLeft: `2px solid ${C.accent}44`,
            marginLeft: 22,
            borderRadius: `0 ${RADIUS.lg} ${RADIUS.lg} 0`,
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
      )}
    </React.Fragment>
  );
}
