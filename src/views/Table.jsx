// ─── Wasabi Table View ───
// Schema-agnostic, filterable, sortable, inline-editable data table.
// The primary view for any Notion database.

import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { C, FONT, RADIUS, SHADOW, getStatusColor } from "../design/tokens.js";
import { S } from "../design/styles.js";
import { ANIM, injectAnimations } from "../design/animations.js";
import { hoverBg } from "../design/interactions.js";
import { getPageTitle } from "../notion/properties.js";
// debounce now imported by table/hooks/useTableData.js
import {
  IconTrash, IconArchive, IconExpand, IconPlus, IconConnect,
  IconCalendar, IconCheck, IconCheckSquare, IconLink, IconMail, IconPhone,
  IconStatusDot, IconArrowDown, IconUser,
} from "../design/icons.jsx";
import FilterChips from "./FilterChips.jsx";
import RecordDetail from "./RecordDetail.jsx";
import NewRecordModal from "./NewRecordModal.jsx";
// isNeuronsMode, dispatchNeuronSelect, NeuronBadge now imported by table/TableRow.jsx
import { listUserDirectory, updateRowOwner, notionProxy, getRecordBadgeCounts, deleteRow, getTableSchema, updateTableSchema, updateSubColumnSchema, reparentRow, archiveRow } from "../lib/api.js";
import { isAdmin } from "../lib/roles.js";
import { globalToast } from "../context/ToastContext.jsx";
import { assignOptionColor } from "../lib/dataSource.js";
import { useTreeData } from "../lib/useTreeData.js";
import { getPinToken } from "../components/PinLockOverlay.jsx";
import { usePlatform } from "../context/PlatformContext.jsx";
// updateDatabase, searchDatabases now imported by table/hooks/useColumnManagement.js
// SelectPicker and MultiSelectPicker now imported by table/CellEditor.jsx
// SavedViewsDropdown now imported by table/TableToolbar.jsx
import { useCollaboration } from "../context/CollaborationContext.jsx";
// PresenceAvatars now imported by table/TableToolbar.jsx
import { getFieldType, getFieldOptions, getOptionNames, readField, displayValue } from "./_viewHelpers.js";
import {
  OWNER_COL_NAME, OWNER_COL_WIDTH, D1_TO_NOTION_TYPE, COLUMN_TYPES, TYPE_ICON_MAP,
  mapD1TypeForUI, getTypeIcon, ROW_HEIGHT, VIRT_BUFFER, GROUP_GAP, SUB_HEADER_HEIGHT,
  EDITABLE_TYPES, TEXT_SEARCH_TYPES,
  resolveColumns, buildGroupList, computeOffsets, findGroupAtOffset,
} from "./table/tableHelpers.js";

import { getStyles, getGhostInputStyle } from "./table/tableStyles.js";
import { OwnerPicker } from "./table/OwnerCell.jsx";
// OwnerCellDisplay now imported by table/TableRow.jsx
import { GhostCell } from "./table/GhostRow.jsx";
import CellEditor from "./table/CellEditor.jsx";
import CellDisplay, { CELL_RENDERERS } from "./table/CellDisplay.jsx";
import { ParentColumnContextMenu, SubColumnContextMenu } from "./table/ColumnContextMenu.jsx";
import { AddColumnDialog, AddSubColumnDialog } from "./table/AddColumnDialog.jsx";
import CascadeDeleteDialog from "./table/CascadeDeleteDialog.jsx";
import DependencyDeleteDialog from "./table/DependencyDeleteDialog.jsx";
import OptionsManagerModal from "./table/OptionsManagerModal.jsx";
import TableToolbar from "./table/TableToolbar.jsx";
import TableHeader from "./table/TableHeader.jsx";
import TableRow from "./table/TableRow.jsx";
import TableFooter from "./table/TableFooter.jsx";
import useGhostRow from "./table/hooks/useGhostRow.js";
import useSubItemGhost from "./table/hooks/useSubItemGhost.js";
import useTableCellEdit from "./table/hooks/useTableCellEdit.js";
import useColumnManagement from "./table/hooks/useColumnManagement.js";
import useTableData from "./table/hooks/useTableData.js";
import useRowDrag from "./table/hooks/useRowDrag.js";
import RowContextMenu from "./table/RowContextMenu.jsx";



// CellEditor imported from ./table/CellEditor.jsx
// CellDisplay and CELL_RENDERERS imported from ./table/CellDisplay.jsx


// ─── Owner Column Components ───

// OwnerCellDisplay and OwnerPicker imported from ./table/OwnerCell.jsx


// ─── Saved Views Dropdown ───

// ─── Main Table Component ───

export default function Table({ data = [], schema, config = {}, onUpdate, onRefresh, onCreate, onDelete, pageConfig, onSaveFilters, onViewConfigChange, initialDetailRecordId, onInitialDetailConsumed, resolvedLinks = new Map(), removeLink, onLinkField, onUnlinkField }) {
  const styles = getStyles();
  const ghostInputStyle = getGhostInputStyle();
  const { user, identity } = usePlatform();
  const canArchive = isAdmin(identity);
  const collab = useCollaboration();
  const [search, setSearch] = useState("");
  const [sortField, setSortField] = useState(config.sort?.field || config.sortField || null);
  const [sortDir, setSortDir] = useState(config.sort?.direction || config.sortDir || (config.sortField ? "asc" : null)); // "asc" | "desc" | null
  const [filters, setFilters] = useState(config.filters || {}); // { fieldName: value }

  // Sync sort state from external config changes (e.g. ViewSettingsPanel)
  useEffect(() => {
    const extSort = config.sortField ?? null;
    const extDir = config.sortDir ?? "asc";
    if (extSort !== undefined) setSortField(extSort);
    if (config.sortDir !== undefined) setSortDir(extDir);
  }, [config.sortField, config.sortDir]);

  // ── Chip Filters (multi-select, persisted) ──
  const [chipFilters, setChipFilters] = useState(
    () => config.activeFilters || pageConfig?.activeFilters || {}
  ); // { fieldName: ["val1", "val2"] }
  // editCell, savingCells, failedCells, initialChar — from useTableCellEdit hook (called below)
  const [hoveredRow, setHoveredRow] = useState(null);
  const [searchFocused, setSearchFocused] = useState(false);

  // ── Row Selection ──
  const [selectedRows, setSelectedRows] = useState(new Set());

  // ── Saved Views ──
  const [activeSavedViewId, setActiveSavedViewId] = useState(config.activeSavedViewId || null);

  // ── Column Visibility ──
  const [hiddenColumns, setHiddenColumns] = useState(new Set());
  const [colMenuOpen, setColMenuOpen] = useState(false);
  const colMenuRef = useRef(null);

  // ── Record Detail Panel ──
  const [detailPage, setDetailPage] = useState(null);
  const [showNewModal, setShowNewModal] = useState(false);
  const lastRowClickRef = useRef({ id: null, time: 0 });

  // Open record from notification click-through
  useEffect(() => {
    if (!initialDetailRecordId || !data.length) return;
    const row = data.find((r) => r.id === initialDetailRecordId);
    if (row) {
      setDetailPage(row);
      if (onInitialDetailConsumed) onInitialDetailConsumed();
    }
  }, [initialDetailRecordId, data]);

  // Sub-item ghost state — from useSubItemGhost hook (called below)
  const [cascadeDialog, setCascadeDialog] = useState(null); // { rowIds, childCount }
  const [dependencyDialog, setDependencyDialog] = useState(null); // { rowIds, dependentCount, dependentSample }
  const [optionsModalCol, setOptionsModalCol] = useState(null); // column object for OptionsManagerModal

  // Column management state — from useColumnManagement hook (called below)
  // ── Source type detection (D1 / Notion / external) ──
  const sourceType = useMemo(() => {
    const pt = pageConfig?.page_type || pageConfig?.pageType;
    if (pt === "database") return "d1";
    if (pt === "linked_notion") return "notion";
    if (pt === "linked_sheet" || pt === "linked_monday") return "external_readonly";
    // Fallback: if we have a schema and page ID but no linked_ prefix, treat as D1
    if (schema?.allFields?.length > 0 && pageConfig?.id && !String(pt || "").startsWith("linked_")) return "d1";
    return "unknown";
  }, [pageConfig?.page_type, pageConfig?.pageType, pageConfig?.id, schema?.allFields?.length]);
  const canEditSchema = sourceType === "d1" || sourceType === "notion";
  // Whether this user may change a column's options — a schema edit, which the
  // worker gates behind `owner` on PATCH /pages/:id/schema (worker.js). In
  // practice only an admin clears that check. `canEditSchema` above is about
  // the data source being editable at all, not about who is asking, so it is
  // not sufficient on its own: without this, editors were shown a "create
  // option" affordance whose request always came back 403.
  const canManageOptions = canEditSchema && isAdmin(identity);
  const isD1Table = sourceType === "d1";
  const isNotionTable = sourceType === "notion";

  // ── Owner Column ──
  const showOwnerColumn = !!(config.showOwnerColumn || pageConfig?.config?.showOwnerColumn);
  const showSubItemOwnerColumn = !!(config.showSubItemOwnerColumn || pageConfig?.config?.showSubItemOwnerColumn);
  const [teamUsers, setTeamUsers] = useState([]);
  const [ownerPickerRow, setOwnerPickerRow] = useState(null); // pageId of row being edited
  useEffect(() => {
    if (!showOwnerColumn && !showSubItemOwnerColumn) return;
    listUserDirectory().then((res) => {
      setTeamUsers(res.users || []);
    }).catch(err => console.warn("[Table] listUserDirectory:", err.message || err));
  }, [showOwnerColumn, showSubItemOwnerColumn]);

  // ── Ghost Row (via useGhostRow hook) ──
  // Hook is called after targetDatabaseId is defined (below)

  // ── Keyboard Navigation ──
  const [focusedCell, setFocusedCell] = useState(null); // { row: number, col: number } | null
  // initialChar is in useTableCellEdit hook
  const scrollAreaRef = useRef(null);

  // ── Virtualization ──
  const scrollTopRef = useRef(0);
  const scrollRAF = useRef(null);
  const [containerHeight, setContainerHeight] = useState(600);
  const [visibleRange, setVisibleRange] = useState({ start: 0, end: 40 });

  // Stable containerHeight via ResizeObserver
  useEffect(() => {
    const el = scrollAreaRef.current;
    if (!el) return;
    setContainerHeight(el.clientHeight);
    const ro = new ResizeObserver(([entry]) => {
      setContainerHeight(entry.contentRect.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);


  // ── Cell Linking ──
  // Owned by ViewRenderer now and passed in, so Gantt/Calendar/CardGrid/Kanban
  // get identical behaviour — previously this lived here, which is why opening
  // a record from any view other than the table lost the link affordance.
  const targetDatabaseId = config.databaseId || pageConfig?.databaseIds?.[0] || pageConfig?.id;

  // ── In-table title map (for depends_on column display) ──
  // Maps each row's id → its title for fast cell lookup. Built from the
  // already-loaded data; no extra fetch. The depends_on cell uses this to
  // show upstream task names without per-cell network calls.
  const recordTitlesById = useMemo(() => {
    const map = {};
    if (!data || !schema?.title) return map;
    const titleName = schema.title.name;
    for (const page of data) {
      const prop = page?.properties?.[titleName];
      if (!prop) continue;
      let title = "";
      if (Array.isArray(prop.title) && prop.title.length) {
        title = prop.title.map((t) => t.plain_text || "").join("");
      } else if (typeof prop === "string") {
        title = prop;
      }
      if (title) map[page.id] = title;
    }
    return map;
  }, [data, schema]);

  // ── Relation title resolution ──
  // Query each related database to get page titles for relation fields
  const [relationTitles, setRelationTitles] = useState({});
  const resolvedDbsRef = useRef(new Set());
  useEffect(() => {
    if (!data || data.length === 0 || !schema) return;
    const relationFields = (schema.allFields || []).filter(f => f.type === "relation" && f.relatedDbId);
    if (relationFields.length === 0) return;
    // Only query databases we haven't resolved yet
    const dbsToQuery = relationFields.filter(f => !resolvedDbsRef.current.has(f.relatedDbId));
    if (dbsToQuery.length === 0) return;
    // Query each related database for its page titles
    Promise.allSettled(
      dbsToQuery.map(async (field) => {
        resolvedDbsRef.current.add(field.relatedDbId);
        const resp = await notionProxy("/query", "POST", {
          database_id: field.relatedDbId,
          page_size: 100,
        });
        const titles = {};
        for (const page of resp?.results || []) {
          let title = null;
          for (const [, prop] of Object.entries(page.properties || {})) {
            if (prop.type === "title" && prop.title?.length > 0) {
              title = prop.title.map(t => t.plain_text || "").join("");
              break;
            }
          }
          if (title) titles[page.id] = title;
        }
        return titles;
      })
    ).then((results) => {
      const merged = {};
      for (const r of results) {
        if (r.status === "fulfilled" && r.value) Object.assign(merged, r.value);
      }
      if (Object.keys(merged).length > 0) {
        setRelationTitles(prev => ({ ...prev, ...merged }));
      }
    });
  }, [data, schema]);

  // Inject animations on mount
  useEffect(() => {
    injectAnimations();
  }, []);

  // Outside-click to close column visibility menu
  useEffect(() => {
    if (!colMenuOpen) return;
    const handler = (e) => {
      if (colMenuRef.current && !colMenuRef.current.contains(e.target)) {
        setColMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [colMenuOpen]);

  // ── Notion DB helper ──
  const notionDbId = isNotionTable ? (pageConfig?.databaseIds?.[0] || null) : null;

  // Ref for allColumns (needed by handlers that can't close over latest allColumns)
  const allColumnsRef = useRef([]);

  // Resolve all columns from schema
  const allColumns = useMemo(
    () => resolveColumns(schema, config.columns, config.fieldMappings),
    [schema, config.columns, config.fieldMappings]
  );

  // Sync hidden columns from config.visibleFields (updates when ViewSettingsPanel changes).
  // New columns discovered from schema that aren't in the saved visibleFields list
  // default to VISIBLE so that columns added in Notion appear automatically.
  const prevVisibleFields = useRef(config.visibleFields);
  useEffect(() => {
    const vf = config.visibleFields;
    if (!Array.isArray(vf) || vf.length === 0 || allColumns.length === 0) return;

    if (prevVisibleFields.current !== vf || !prevVisibleFields.current) {
      const visibleSet = new Set(vf);
      // Only hide columns that were KNOWN at save time and explicitly excluded.
      // New columns (not in visibleFields at all) stay visible by default.
      // To detect "known at save time", we check if the column was in the config.columns
      // snapshot. If config.columns doesn't exist, treat visibleFields as the full list.
      const knownColumns = new Set(config.columns || vf);
      const hidden = new Set(
        allColumns.filter((c) => knownColumns.has(c) && !visibleSet.has(c))
      );
      setHiddenColumns(hidden);
      prevVisibleFields.current = vf;
    }
  }, [allColumns, config.visibleFields, config.columns]);

  // Visible columns (filtered by hiddenColumns)
  allColumnsRef.current = allColumns;

  const columns = useMemo(() => {
    const visible = allColumns.filter((c) => !hiddenColumns.has(c));
    if (showOwnerColumn && !visible.includes(OWNER_COL_NAME)) {
      // Insert after first column (title)
      const idx = Math.min(1, visible.length);
      visible.splice(idx, 0, OWNER_COL_NAME);
    }
    return visible;
  }, [allColumns, hiddenColumns, showOwnerColumn]);

  // ── Column Management Hook ──
  const colMgmt = useColumnManagement({
    schema, columns, allColumnsRef, hiddenColumns, setHiddenColumns,
    canEditSchema, isD1Table, isNotionTable, notionDbId,
    pageConfig, onRefresh, onViewConfigChange, initialColWidths: config.colWidths, initialSubColWidths: config.subColWidths,
  });
  const { colWidths, subColWidths } = colMgmt;
  // Destructure commonly used values
  const {
    colCtxMenu, setColCtxMenu, handleColRightClick, handleHideCol,
    renamingCol, setRenamingCol, renameValue, setRenameValue, handleRenameCol,
    subColCtxMenu, setSubColCtxMenu,
    renamingSubCol, setRenamingSubCol, renameSubValue, setRenameSubValue,
    handleRenameSubCol, handleDeleteSubCol, handleDeleteCol, handleChangeColType, handleChangeSubColType,
    addColOpen, setAddColOpen, addColName, setAddColName, addColType, setAddColType,
    addColRelationDb, setAddColRelationDb, addColSynced, setAddColSynced,
    addColSyncedName, setAddColSyncedName,
    dbSearchResults, dbSearchQuery, setDbSearchQuery, dbSearching,
    searchRelationDbs, handleAddCol,
    addSubColOpen, setAddSubColOpen, addSubColName, setAddSubColName,
    addSubColType, setAddSubColType, handleAddSubCol,
    colDrag, handleColDragStart, handleResizeStart, handleSubResizeStart, colClickTimer,
  } = colMgmt;

  // ── Options Manager ──
  const handleManageOptions = useCallback((colName) => {
    // Find column definition in schema to get current options
    const field = schema?.allFields?.find((f) => f.name === colName);
    if (field) setOptionsModalCol({ name: colName, options: field.options || [], type: field.type });
  }, [schema]);

  const handleSaveOptions = useCallback(async (newOptions) => {
    if (!optionsModalCol || !pageConfig?.id) return;
    try {
      const schemaRes = await getTableSchema(pageConfig.id);
      const cols = (schemaRes?.columns || []).map((c) =>
        c.name === optionsModalCol.name ? { ...c, options: newOptions } : c
      );
      await updateTableSchema(pageConfig.id, cols);
      onRefresh?.();
    } catch (err) {
      // A 403 here means the user lacks schema-edit rights. This used to be
      // console-only, so the modal closed looking exactly like a success and
      // the options silently never changed.
      console.error("Save options failed:", err);
      globalToast(
        err?.status === 403
          ? "You don't have permission to change this column's options."
          : `Could not save options: ${err?.message || "unknown error"}`,
        "error"
      );
    }
    setOptionsModalCol(null);
  }, [optionsModalCol, pageConfig, onRefresh]);

  // ── Sub-Column Options Manager (handlers defined after subSchema, below) ──
  const [subOptionsModalCol, setSubOptionsModalCol] = useState(null);

  // ── Data Pipeline Hook ──
  const { filterableFields, processedData, treeSortFn } = useTableData({
    data, schema, columns, chipFilters, filters, search, sortField, sortDir, teamUsers,
  });

  // Chip filter change handler (persists via onViewConfigChange)
  const handleChipFilterChange = useCallback((newFilters) => {
    setChipFilters(newFilters);
    setActiveSavedViewId(null);
    if (onSaveFilters) onSaveFilters(newFilters);
    if (onViewConfigChange) onViewConfigChange({ activeFilters: newFilters, activeSavedViewId: null });
  }, [onSaveFilters, onViewConfigChange]);

  // Build synthetic owner filter field when owner column is enabled
  const ownerExtraFields = useMemo(() => {
    if (!showOwnerColumn || teamUsers.length === 0) return undefined;
    const names = new Set();
    for (const page of data) {
      for (const uid of (page._ownerUserIds || [])) {
        const u = teamUsers.find((tu) => tu.id === uid);
        if (u) names.add(u.display_name);
      }
    }
    if (names.size === 0) return undefined;
    return [{ name: "__owner__", label: "Owner", type: "people", options: [...names].map((n) => ({ name: n, color: "blue" })) }];
  }, [showOwnerColumn, teamUsers, data]);

  // ── Sub-Items Tree ──
  const subItemsEnabled = isD1Table;

  const {
    displayList, toggleExpand, expandAll, collapseAll,
    expandedRows, getChildren, childMap,
  } = useTreeData(processedData, { enabled: subItemsEnabled, sortFn: treeSortFn });

  // ── Row Drag (drag-to-nest, drag-to-empty-space to un-nest) ──
  // Disabled when a column sort is active (would conflict with stored
  // sort_order) or on linked / read-only tables.
  const rowDrag = useRowDrag({
    tableId: pageConfig?.id,
    isD1Table,
    sortActive: !!(sortField && sortDir),
    childMap,
    data,
    onMoveComplete: onRefresh,
  });

  // ── Row Context Menu (Phase 3 — un-nest via right-click) ──
  const [rowCtxMenu, setRowCtxMenu] = useState(null); // { row, x, y }
  const handleRowContextMenu = useCallback((row, e) => {
    if (!isD1Table) return;
    e.preventDefault();
    e.stopPropagation();
    setRowCtxMenu({ row, x: e.clientX, y: e.clientY });
  }, [isD1Table]);

  const handleMoveToTop = useCallback(async (row) => {
    if (!row || !row._parentRowId || !pageConfig?.id) return;
    try {
      // Land at bottom of existing top-level rows
      const topRows = data.filter((r) => !r._parentRowId);
      const newSortOrder = topRows.length > 0
        ? Math.max(...topRows.map((r) => r._sortOrder || 0)) + 1
        : 0;
      await reparentRow(pageConfig.id, row.id, null, newSortOrder);
      if (onRefresh) onRefresh();
    } catch (err) {
      console.error("[Table] Move to top failed:", err);
    }
  }, [pageConfig?.id, data, onRefresh]);

  // Archive a row (admin-only). Cascades to sub-items server-side.
  const handleArchiveRow = useCallback(async (row) => {
    if (!row || !pageConfig?.id) return;
    try {
      await archiveRow(pageConfig.id, row.id);
      if (onRefresh) onRefresh();
    } catch (err) {
      console.error("[Table] Archive row failed:", err);
      alert(`Archive failed: ${err?.message || "Unknown error"}`);
    }
  }, [pageConfig?.id, onRefresh]);

  // ── Sub-Item Independent Schema ──
  const subColumns = useMemo(() => schema?._subColumns || [], [schema]);
  const subSchema = useMemo(() => schema?._subSchema || null, [schema]);

  // ── Sub-Column Options Manager (must be after subSchema) ──
  const handleManageSubOptions = useCallback((colName) => {
    const field = subSchema?.allFields?.find((f) => f.name === colName);
    if (field) setSubOptionsModalCol({ name: colName, options: field.options || [], type: field.type });
  }, [subSchema]);

  const handleSaveSubOptions = useCallback(async (newOptions) => {
    if (!subOptionsModalCol || !pageConfig?.id) return;
    try {
      const schemaRes = await getTableSchema(pageConfig.id);
      const subs = (schemaRes?.sub_columns || []).map((c) =>
        c.name === subOptionsModalCol.name ? { ...c, options: newOptions } : c
      );
      await updateSubColumnSchema(pageConfig.id, subs);
      onRefresh?.();
    } catch (err) {
      console.error("Save sub-column options failed:", err);
    }
    setSubOptionsModalCol(null);
  }, [subOptionsModalCol, pageConfig, onRefresh]);

  // ── Inline Create Option (for SelectEditor in RecordDetail) ──
  // Appends a new option to a select/status/multi_select column's options array.
  // Handles both parent columns and sub-item columns based on page._parentRowId.
  const handleCreateSchemaOption = useCallback(async (page, colName, optionName) => {
    if (!pageConfig?.id || !optionName?.trim()) return;
    const trimmed = optionName.trim();
    const isSubItem = !!page?._parentRowId;
    try {
      const schemaRes = await getTableSchema(pageConfig.id);
      const bucket = isSubItem ? "sub_columns" : "columns";
      const cols = schemaRes?.[bucket] || [];
      const updated = cols.map((c) => {
        if (c.name !== colName) return c;
        const existing = Array.isArray(c.options) ? c.options : [];
        if (existing.some((o) => o.name === trimmed)) return c;
        const newOpt = { name: trimmed, color: assignOptionColor(existing.length) };
        if (c.type === "status") newOpt.category = "not_started";
        return { ...c, options: [...existing, newOpt] };
      });
      if (isSubItem) {
        await updateSubColumnSchema(pageConfig.id, updated);
      } else {
        await updateTableSchema(pageConfig.id, updated);
      }
      onRefresh?.();
    } catch (err) {
      // Surface the failure AND re-throw. Swallowing it here made the caller
      // (SelectEditor.handleCreate) believe the option had been created, so it
      // went on to commit the cell value — writing a status onto the record
      // that no option in the schema backed, which then rendered as a colourless
      // orphan pill. Re-throwing keeps the value unwritten.
      console.error("Create option failed:", err);
      globalToast(
        err?.status === 403
          ? "You don't have permission to add options to this column."
          : `Could not add option: ${err?.message || "unknown error"}`,
        "error"
      );
      throw err;
    }
  }, [pageConfig, onRefresh]);

  const subTitleField = useMemo(() => {
    // When sub_columns is empty, return null — do NOT fall back to the
    // parent title column name. The ghost row would otherwise key
    // subItemGhostValues by the parent title name, and createRecord
    // (which looks only at sub_columns when parentRowId is set) would
    // fail to find that key, silently creating an empty sub-item.
    if (subColumns.length === 0) return null;
    const titleCol = subColumns.find(c => c.type === "title");
    return titleCol?.name || subColumns[0]?.name || null;
  }, [subColumns]);
  const subVisibleColumns = useMemo(() => {
    if (subColumns.length === 0) return [];
    return subColumns.map(c => c.name);
  }, [subColumns]);

  // ── Cell Edit Hook ──
  const cellEdit = useTableCellEdit({
    schema, onUpdate, focusedCell, setFocusedCell, displayListLength: displayList.length,
    canEditSchema, canManageOptions, isNotionTable, notionDbId, pageConfig, onRefresh,
  });
  const { editCell, setEditCell, savingCells, failedCells, initialChar, setInitialChar, handleEditCommit, handleCreateOption, handleCheckboxToggle } = cellEdit;

  // ── Sub-Item Ghost Hook ──
  const subGhost = useSubItemGhost({ onCreate, pageConfig, schema, subSchema, subTitleField, expandedRows, toggleExpand });
  const {
    subItemGhostParent, setSubItemGhostParent, subItemGhostValues, setSubItemGhostValues,
    subItemGhostSaving, subItemGhostActive, subGhostRef,
    handleCreateSubItem, handleSubItemGhostCommit,
  } = subGhost;

  // ── Grouped layout (parent + expanded sub-items render as one card) ──
  // Sub-items are nested visually inside the parent's card. The flat
  // `displayList` (used by keyboard nav and selection) stays the source of
  // truth; `groupList` is a render-only derivation.
  const groupList = useMemo(() => buildGroupList(displayList), [displayList]);

  // Pixel offsets for variable-height virtualization. Each group's height
  // depends on parent (ROW_HEIGHT) + (when expanded) sub-header + N children
  // + optional sub-item ghost row + GROUP_GAP between groups.
  const offsetData = useMemo(
    () => computeOffsets(displayList, subItemGhostParent),
    [displayList, subItemGhostParent]
  );
  const { groupOffsets, rowOffsets, totalHeight: totalContentHeight } = offsetData;

  // ── Record badge counts (comments, notes, files) ──
  const [badgeCounts, setBadgeCounts] = useState({});
  const badgeFetchRef = useRef(null);
  useEffect(() => {
    if (!processedData || processedData.length === 0 || !pageConfig?.id) return;
    if (badgeFetchRef.current) clearTimeout(badgeFetchRef.current);
    badgeFetchRef.current = setTimeout(async () => {
      try {
        const ids = processedData.map((p) => p.id).filter(Boolean);
        if (ids.length === 0) return;
        const res = await getRecordBadgeCounts(ids, pageConfig.id);
        setBadgeCounts(res?.counts || {});
      } catch (err) { console.warn("[Table] getRecordBadgeCounts:", err.message || err); }
    }, 500);
    return () => { if (badgeFetchRef.current) clearTimeout(badgeFetchRef.current); };
  }, [processedData, pageConfig?.id]);

  // Re-sync visible range (group indices) when data or container size changes.
  // start/end are GROUP indices into groupList, not row indices.
  useEffect(() => {
    const st = scrollTopRef.current;
    const totalGroups = groupList.length;
    const startG = Math.max(0, findGroupAtOffset(st, groupOffsets) - VIRT_BUFFER);
    const endG = Math.min(totalGroups, findGroupAtOffset(st + containerHeight, groupOffsets) + VIRT_BUFFER + 1);
    setVisibleRange({ start: startG, end: endG });
  }, [groupList.length, groupOffsets, containerHeight]);

  // Column sort handler — cycles asc -> desc -> none
  const handleSort = useCallback((field) => {
    let newField, newDir;
    if (sortField !== field) {
      newField = field; newDir = "asc";
    } else if (sortDir === "asc") {
      newField = field; newDir = "desc";
    } else {
      newField = null; newDir = null;
    }
    setSortField(newField);
    setSortDir(newDir);
    setActiveSavedViewId(null);
    if (onViewConfigChange) onViewConfigChange({ sort: { field: newField, direction: newDir }, activeSavedViewId: null });
  }, [sortField, sortDir, onViewConfigChange]);

  // handleEditCommit, handleCreateOption, handleCheckboxToggle — from useTableCellEdit hook
  // handleOwnerCommit stays in orchestrator (small, uses setOwnerPickerRow)
  const handleOwnerCommit = useCallback(async (pageId, ownerIds) => {
    const tableId = pageConfig?.id;
    if (!tableId) return;
    try {
      await updateRowOwner(tableId, pageId, ownerIds);
      if (onRefresh) setTimeout(onRefresh, 300);
    } catch (err) {
      console.error("Owner update failed:", err);
    }
    setOwnerPickerRow(null);
  }, [pageConfig?.id, onRefresh]);

  // ── Keyboard Navigation Handler ──
  useEffect(() => {
    const handler = (e) => {
      // Don't intercept if user is in a text input, search, or modal
      const tag = e.target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (!focusedCell && !e.key.startsWith("Arrow")) return;

      const rowCount = displayList.length;
      const colCount = columns.length;
      if (rowCount === 0 || colCount === 0) return;

      const { row, col } = focusedCell || { row: 0, col: 0 };

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setFocusedCell({ row: Math.min(row + 1, rowCount - 1), col });
          break;
        case "ArrowUp":
          e.preventDefault();
          setFocusedCell({ row: Math.max(row - 1, 0), col });
          break;
        case "ArrowRight":
          e.preventDefault();
          if (col < colCount - 1) setFocusedCell({ row, col: col + 1 });
          else if (row < rowCount - 1) setFocusedCell({ row: row + 1, col: 0 });
          break;
        case "ArrowLeft":
          e.preventDefault();
          if (col > 0) setFocusedCell({ row, col: col - 1 });
          else if (row > 0) setFocusedCell({ row: row - 1, col: colCount - 1 });
          break;
        case "Tab":
          e.preventDefault();
          if (e.shiftKey) {
            if (col > 0) setFocusedCell({ row, col: col - 1 });
            else if (row > 0) setFocusedCell({ row: row - 1, col: colCount - 1 });
          } else {
            if (col < colCount - 1) setFocusedCell({ row, col: col + 1 });
            else if (row < rowCount - 1) setFocusedCell({ row: row + 1, col: 0 });
          }
          break;
        case "Enter":
          // Enter on focused cell → open record detail panel
          if (focusedCell) {
            e.preventDefault();
            const entry = displayList[row];
            if (entry) setDetailPage(entry.row);
          }
          break;
        case "Escape":
          setFocusedCell(null);
          break;
        default:
          break;
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [focusedCell, displayList, columns]);

  // Scroll focused cell into view (variable-height aware).
  // rowOffsets[i] gives pixel-top of displayList[i] regardless of grouping.
  useEffect(() => {
    if (focusedCell && scrollAreaRef.current) {
      const targetTop = rowOffsets[focusedCell.row] ?? focusedCell.row * ROW_HEIGHT;
      const container = scrollAreaRef.current;
      const viewTop = container.scrollTop;
      const viewBottom = viewTop + container.clientHeight - 80; // account for header
      if (targetTop < viewTop) {
        container.scrollTop = targetTop;
      } else if (targetTop + ROW_HEIGHT > viewBottom) {
        container.scrollTop = targetTop + ROW_HEIGHT - container.clientHeight + 80;
      }
    }
  }, [focusedCell, rowOffsets]);

  // Filter change handler
  const handleFilterChange = useCallback((field, value) => {
    setFilters((prev) => {
      const next = { ...prev, [field]: value || undefined };
      if (onViewConfigChange) onViewConfigChange({ filters: next, activeSavedViewId: null });
      return next;
    });
    setActiveSavedViewId(null);
  }, [onViewConfigChange]);

  // ── Row Selection ──
  const toggleRow = useCallback((pageId) => {
    setSelectedRows((prev) => {
      const next = new Set(prev);
      if (next.has(pageId)) next.delete(pageId);
      else next.add(pageId);
      return next;
    });
  }, []);

  const toggleAllRows = useCallback(() => {
    setSelectedRows((prev) => {
      if (prev.size === displayList.length && prev.size > 0) return new Set();
      return new Set(displayList.map((e) => e.row.id));
    });
  }, [displayList]);

  // ── Bulk Delete (permanent) ──
  const handleBulkDelete = useCallback(async () => {
    if (!onDelete || selectedRows.size === 0) return;
    const confirmed = window.confirm(
      `Permanently delete ${selectedRows.size} selected record${selectedRows.size !== 1 ? "s" : ""}? This cannot be undone.`
    );
    if (!confirmed) return;
    await onDelete([...selectedRows]);
    setSelectedRows(new Set());
  }, [onDelete, selectedRows]);

  // ── Bulk Archive (soft, reversible; admin only) ──
  const handleBulkArchive = useCallback(async () => {
    if (!canArchive || selectedRows.size === 0 || !pageConfig?.id) return;
    const n = selectedRows.size;
    const confirmed = window.confirm(
      `Archive ${n} selected record${n !== 1 ? "s" : ""}? They can be restored later from the Archive view.`
    );
    if (!confirmed) return;
    const ids = [...selectedRows];
    for (const rowId of ids) {
      try { await archiveRow(pageConfig.id, rowId); }
      catch (err) { console.error("Archive failed for row", rowId, err); }
    }
    setSelectedRows(new Set());
    onRefresh?.();
  }, [canArchive, selectedRows, pageConfig, onRefresh]);

  // ── Sub-Item: Delete with cascade + dependency awareness ──
  const handleDeleteWithCascade = useCallback(async (rowIds) => {
    if (!onDelete || !rowIds?.length) return;
    try {
      await onDelete(rowIds);
    } catch (err) {
      if (err?.status === 409 && err?.data?.hasChildren) {
        setCascadeDialog({ rowIds, childCount: err.data.childCount });
        return;
      }
      if (err?.status === 409 && err?.data?.hasDependents) {
        setDependencyDialog({
          rowIds,
          dependentCount: err.data.dependentCount,
          dependentSample: err.data.dependentSample || [],
        });
        return;
      }
      throw err;
    }
  }, [onDelete]);

  const handleCascadeDelete = useCallback(async (cascade) => {
    if (!cascadeDialog) return;
    const { rowIds } = cascadeDialog;
    const tableId = pageConfig?.id;
    if (!tableId) return;
    try {
      const pinToken = getPinToken(pageConfig?.id);
      for (const id of rowIds) {
        try {
          await deleteRow(tableId, id, { pinToken, cascade });
        } catch (err) {
          // Cascade resolved children; if dependents now block, surface that prompt
          if (err?.status === 409 && err?.data?.hasDependents) {
            setCascadeDialog(null);
            setDependencyDialog({
              rowIds: [id],
              dependentCount: err.data.dependentCount,
              dependentSample: err.data.dependentSample || [],
            });
            return;
          }
          throw err;
        }
      }
      setCascadeDialog(null);
      setSelectedRows(new Set());
      if (onRefresh) await onRefresh();
    } catch (err) {
      console.error("Cascade delete failed:", err);
      setCascadeDialog(null);
    }
  }, [cascadeDialog, pageConfig, onRefresh]);

  const handleConfirmDependents = useCallback(async () => {
    if (!dependencyDialog) return;
    const { rowIds } = dependencyDialog;
    const tableId = pageConfig?.id;
    if (!tableId) return;
    try {
      const pinToken = getPinToken(pageConfig?.id);
      for (const id of rowIds) {
        // confirmDependents=true tells the worker to skip the dependent prompt
        // and proceed. Children cascade should already be resolved at this
        // point if the user came through the cascade dialog first.
        await deleteRow(tableId, id, { pinToken, cascade: "orphan", confirmDependents: true });
      }
      setDependencyDialog(null);
      setSelectedRows(new Set());
      if (onRefresh) await onRefresh();
    } catch (err) {
      console.error("Dependency-confirmed delete failed:", err);
      setDependencyDialog(null);
    }
  }, [dependencyDialog, pageConfig, onRefresh]);

  // handleCreateSubItem, handleSubItemGhostCommit, subGhostRef — from useSubItemGhost hook

  // ── CSV Export ──
  const handleExport = useCallback(() => {
    if (!processedData.length || !columns.length) return;

    const escape = (val) => {
      const s = val === null || val === undefined ? "" : String(val);
      if (s.includes(",") || s.includes('"') || s.includes("\n")) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    };

    const header = columns.map(escape).join(",");
    const rows = processedData.map((page) =>
      columns.map((col) => {
        const type = getFieldType(schema, col);
        const value = readField(page, col);
        return escape(displayValue(value, type));
      }).join(",")
    );

    const csv = [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const date = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `${config.exportName || "table-export"}-${date}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [processedData, columns, schema, config.exportName]);

  // ── Column Visibility Toggle ──
  const toggleColumn = useCallback((col) => {
    setHiddenColumns((prev) => {
      const next = new Set(prev);
      if (next.has(col)) next.delete(col);
      else next.add(col);
      // Persist visible fields
      if (onViewConfigChange && allColumns.length > 0) {
        const visibleFields = allColumns.filter((c) => !next.has(c));
        onViewConfigChange({ visibleFields, activeSavedViewId: null });
      }
      return next;
    });
    setActiveSavedViewId(null);
  }, [allColumns, onViewConfigChange]);

  // ── Saved View Handlers ──
  const handleSelectSavedView = useCallback((viewId) => {
    if (!viewId) {
      // "Default" — clear all filters, show all columns, clear sort
      setChipFilters({});
      setFilters({});
      setHiddenColumns(new Set());
      setSortField(null);
      setSortDir(null);
      setActiveSavedViewId(null);
      if (onViewConfigChange) {
        onViewConfigChange({ activeFilters: {}, filters: {}, visibleFields: allColumns, sort: { field: null, direction: null }, activeSavedViewId: null });
      }
      return;
    }
    const sv = (config.savedViews || []).find((v) => v.id === viewId);
    if (!sv) return;
    setChipFilters(sv.activeFilters || {});
    setFilters(sv.filters || {});
    setSortField(sv.sort?.field || null);
    setSortDir(sv.sort?.direction || null);
    if (sv.visibleFields) {
      const hidden = new Set(allColumns.filter((c) => !sv.visibleFields.includes(c)));
      setHiddenColumns(hidden);
    } else {
      setHiddenColumns(new Set());
    }
    setActiveSavedViewId(viewId);
    if (onViewConfigChange) {
      onViewConfigChange({
        activeFilters: sv.activeFilters || {},
        filters: sv.filters || {},
        visibleFields: sv.visibleFields || allColumns,
        sort: sv.sort || { field: null, direction: null },
        activeSavedViewId: viewId,
      });
    }
  }, [config.savedViews, allColumns, onViewConfigChange]);

  const handleSaveNewView = useCallback((name) => {
    const newView = {
      id: crypto.randomUUID(),
      name,
      activeFilters: { ...chipFilters },
      visibleFields: allColumns.filter((c) => !hiddenColumns.has(c)),
      sort: { field: sortField, direction: sortDir },
      filters: { ...filters },
    };
    const updated = [...(config.savedViews || []), newView];
    setActiveSavedViewId(newView.id);
    if (onViewConfigChange) onViewConfigChange({ savedViews: updated, activeSavedViewId: newView.id });
  }, [chipFilters, hiddenColumns, sortField, sortDir, filters, allColumns, config.savedViews, onViewConfigChange]);

  const handleUpdateView = useCallback((viewId) => {
    const updated = (config.savedViews || []).map((v) =>
      v.id === viewId ? { ...v, activeFilters: { ...chipFilters }, visibleFields: allColumns.filter((c) => !hiddenColumns.has(c)), sort: { field: sortField, direction: sortDir }, filters: { ...filters } } : v
    );
    setActiveSavedViewId(viewId);
    if (onViewConfigChange) onViewConfigChange({ savedViews: updated, activeSavedViewId: viewId });
  }, [chipFilters, hiddenColumns, sortField, sortDir, filters, allColumns, config.savedViews, onViewConfigChange]);

  const handleRenameView = useCallback((viewId, newName) => {
    const updated = (config.savedViews || []).map((v) => v.id === viewId ? { ...v, name: newName } : v);
    if (onViewConfigChange) onViewConfigChange({ savedViews: updated });
  }, [config.savedViews, onViewConfigChange]);

  const handleDeleteView = useCallback((viewId) => {
    const updated = (config.savedViews || []).filter((v) => v.id !== viewId);
    const newActiveId = activeSavedViewId === viewId ? null : activeSavedViewId;
    if (activeSavedViewId === viewId) setActiveSavedViewId(null);
    if (onViewConfigChange) onViewConfigChange({ savedViews: updated, activeSavedViewId: newActiveId });
  }, [config.savedViews, activeSavedViewId, onViewConfigChange]);

  // Ghost row state + handlers from useGhostRow hook
  const ghost = useGhostRow({ onCreate, targetDatabaseId, schema, columns });
  const { ghostValues, ghostSaving, ghostError, ghostActive, ghostSetVal, ghostKeyDown, handleGhostCommit } = ghost;

  // renderGhostCell helper (uses hook values)
  function renderGhostCell(col, type, opts = {}) {
    const titleField = schema?.title?.name;
    return (
      <GhostCell
        col={col}
        type={type}
        value={ghostValues[col]}
        schema={schema}
        onSetValue={ghostSetVal}
        onKeyDown={ghostKeyDown}
        placeholder={col === titleField ? "New row..." : (opts.placeholder || "")}
        autoFocus={opts.autoFocus}
      />
    );
  }

  // ─── Render ───

  // Empty state
  if (!data || data.length === 0) {
    return (
      <div style={styles.wrapper}>
        <div style={styles.toolbar}>
          {onRefresh && (
            <button
              style={styles.refreshBtn}
              onClick={onRefresh}
              title="Refresh data"
              onMouseEnter={(e) => { e.currentTarget.style.background = C.darkSurf2; e.currentTarget.style.color = C.darkText; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = C.darkSurf2; e.currentTarget.style.color = C.darkMuted; }}
            >
              &#x21bb;
            </button>
          )}
        </div>
        <div style={styles.empty}>
          <div style={styles.emptyIcon}>&#x1f4cb;</div>
          <div style={styles.emptyTitle}>No data to display</div>
          <div style={styles.emptySub}>
            This table is empty. Start typing in the row below to create your first record.
          </div>
          {/* Inline ghost row for empty state */}
          {onCreate && targetDatabaseId && schema && (() => {
            const cols = (schema.allFields || [])
              .filter((f) => EDITABLE_TYPES.has(f.type))
              .map((f) => f.name);
            const titleField = schema?.title?.name;
            return (
              <div style={{ marginTop: 16, width: "100%", overflowX: "auto" }}>
                <table style={{ ...styles.table, width: "100%", minWidth: 400 }}>
                  <thead>
                    <tr>{cols.map((c) => <th key={c} style={styles.th}>{c}</th>)}</tr>
                  </thead>
                  <tbody>
                    <tr style={{ height: ROW_HEIGHT, opacity: 0.8 }}>
                      {cols.map((col) => (
                        <td key={col} style={{ ...styles.td, padding: "4px 6px" }}>
                          {renderGhostCell(col, getFieldType(schema, col), { placeholder: col, autoFocus: col === titleField })}
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
                {ghostError && (
                  <div style={{ fontSize: 11, color: C.error, padding: "4px 12px" }}>{ghostError}</div>
                )}
              </div>
            );
          })()}
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            {onRefresh && (
              <button style={S.btnSecondary} onClick={onRefresh} {...hoverBg()}>Refresh</button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // No results after filtering
  const showNoResults = processedData.length === 0 && data.length > 0;

  return (
    <div style={styles.wrapper}>
      {/* Dynamic filter chips */}
      <FilterChips
        schema={schema}
        data={data}
        activeFilters={chipFilters}
        onFilterChange={handleChipFilterChange}
        extraFields={ownerExtraFields}
      />

      {/* Bulk actions bar */}
      {selectedRows.size > 0 && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "8px 16px",
            background: C.accent + "18",
            borderBottom: `1px solid ${C.accent}44`,
            flexShrink: 0,
            animation: "fadeUp 0.2s ease",
          }}
        >
          <span style={{ fontSize: 12, color: C.accent, fontFamily: FONT, fontWeight: 600 }}>
            {selectedRows.size} selected
          </span>
          <button
            onClick={() => setSelectedRows(new Set())}
            style={{
              ...S.btnGhost,
              fontSize: 11,
              padding: "3px 10px",
              color: C.darkMuted,
            }}
          >
            Clear
          </button>
          {canArchive && pageConfig?.id && (
            <button
              onClick={handleBulkArchive}
              style={{
                ...S.btnGhost,
                fontSize: 11,
                padding: "3px 10px",
                color: C.darkText,
                display: "flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              <IconArchive size={12} color={C.darkText} />
              Archive
            </button>
          )}
          {onDelete && (
            <button
              onClick={handleBulkDelete}
              style={{
                ...S.btnGhost,
                fontSize: 11,
                padding: "3px 10px",
                color: C.error,
                display: "flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              <IconTrash size={12} color={C.error} />
              Delete
            </button>
          )}
        </div>
      )}

      {/* Toolbar: views, search, filters, refresh, count */}
      <TableToolbar
        search={search}
        setSearch={setSearch}
        searchFocused={searchFocused}
        setSearchFocused={setSearchFocused}
        filterableFields={filterableFields}
        filters={filters}
        onFilterChange={handleFilterChange}
        allColumns={allColumns}
        hiddenColumns={hiddenColumns}
        toggleColumn={toggleColumn}
        colMenuOpen={colMenuOpen}
        setColMenuOpen={setColMenuOpen}
        colMenuRef={colMenuRef}
        subItemsEnabled={subItemsEnabled}
        childMap={childMap}
        expandedRows={expandedRows}
        expandAll={expandAll}
        collapseAll={collapseAll}
        savedViews={config.savedViews || []}
        activeSavedViewId={activeSavedViewId}
        onSelectView={handleSelectSavedView}
        onSaveView={handleSaveNewView}
        onUpdateView={handleUpdateView}
        onRenameView={handleRenameView}
        onDeleteView={handleDeleteView}
        onCreate={onCreate}
        targetDatabaseId={targetDatabaseId}
        onSetShowNewModal={setShowNewModal}
        onExport={handleExport}
        onRefresh={onRefresh}
        processedDataLength={processedData.length}
        dataLength={data.length}
        collab={collab}
      />

      {/* Table area */}
      <div
        ref={scrollAreaRef}
        style={styles.scrollArea}
        onScroll={(e) => {
          if (scrollRAF.current) cancelAnimationFrame(scrollRAF.current);
          const target = e.target;
          scrollRAF.current = requestAnimationFrame(() => {
            const st = target.scrollTop;
            scrollTopRef.current = st;
            const totalGroups = groupList.length;
            const startG = Math.max(0, findGroupAtOffset(st, groupOffsets) - VIRT_BUFFER);
            const endG = Math.min(totalGroups, findGroupAtOffset(st + containerHeight, groupOffsets) + VIRT_BUFFER + 1);
            setVisibleRange(prev =>
              prev.start === startG && prev.end === endG ? prev : { start: startG, end: endG }
            );
          });
        }}
      >
        {showNoResults ? (
          <div style={styles.empty}>
            <div style={styles.emptyTitle}>No matching records</div>
            <div style={styles.emptySub}>
              Try adjusting your search or filters to find what you are looking for.
            </div>
            <button
              style={{ ...S.btnGhost, marginTop: 8 }}
              onClick={() => { setSearch(""); setFilters({}); }}
            >
              Clear filters
            </button>
          </div>
        ) : (
          (() => {
            const gtc = `80px ${columns.map(col => `${colWidths[col] || (col === OWNER_COL_NAME ? OWNER_COL_WIDTH : 120)}px`).join(" ")} 56px 40px${canEditSchema ? " 44px" : ""}`;
            const totalTableWidth = 80 + columns.reduce((sum, col) => sum + (colWidths[col] || (col === OWNER_COL_NAME ? OWNER_COL_WIDTH : 120)), 0) + 40 + (canEditSchema ? 44 : 0);
            // Sub-item grid: checkbox + indent + sub-columns + badge + neuron + optional add-col
            const subColsList = subVisibleColumns.length > 0 ? subVisibleColumns : (subTitleField ? [subTitleField] : []);
            if (showSubItemOwnerColumn && subColsList.length > 0 && !subColsList.includes(OWNER_COL_NAME)) {
              const idx = Math.min(1, subColsList.length);
              subColsList.splice(idx, 0, OWNER_COL_NAME);
            }
            const subGtc = subColsList.length > 0
              ? `80px ${subColsList.map((col) => `${subColWidths[col] || (col === OWNER_COL_NAME ? OWNER_COL_WIDTH : 150)}px`).join(" ")} 56px 40px${canEditSchema ? " 44px" : ""}`
              : gtc;

            return (
              <div style={{ minWidth: totalTableWidth }}>
                {/* ── Sticky Header ── */}
                <TableHeader
                  gtc={gtc}
                  columns={columns}
                  schema={schema}
                  showOwnerColumn={showOwnerColumn}
                  sortField={sortField}
                  sortDir={sortDir}
                  selectedRows={selectedRows}
                  displayListLength={displayList.length}
                  toggleAllRows={toggleAllRows}
                  colDrag={colDrag}
                  colClickTimer={colClickTimer}
                  setColCtxMenu={setColCtxMenu}
                  renamingCol={renamingCol}
                  setRenamingCol={setRenamingCol}
                  renameValue={renameValue}
                  setRenameValue={setRenameValue}
                  handleRenameCol={handleRenameCol}
                  handleColRightClick={handleColRightClick}
                  handleColDragStart={handleColDragStart}
                  handleResizeStart={handleResizeStart}
                  canEditSchema={canEditSchema}
                  addColOpen={addColOpen}
                  setAddColOpen={setAddColOpen}
                />

                {/* ── Virtualized Card Rows (group-based) ── */}
                <div style={{ padding: "4px 8px" }}>
                  {(() => {
                    const totalGroups = groupList.length;
                    const visibleStart = visibleRange.start;
                    const visibleEnd = Math.min(totalGroups, visibleRange.end);
                    const visibleGroups = groupList.slice(visibleStart, visibleEnd);
                    const topSpacer = groupOffsets[visibleStart] || 0;
                    const lastVisibleBottom = visibleEnd < totalGroups
                      ? groupOffsets[visibleEnd]
                      : totalContentHeight;
                    const bottomSpacer = Math.max(0, totalContentHeight - lastVisibleBottom);

                    return (
                      <>
                        {/* Top spacer */}
                        <div style={{ height: topSpacer }} />
                        {visibleGroups.map((group, localIdx) => (
                          <TableRow
                            key={group.parent.row.id}
                            group={group}
                            localIdx={localIdx}
                            gtc={gtc}
                            subGtc={subGtc}
                            columns={columns}
                            subColsList={subColsList}
                            subColumns={subColumns}
                            schema={schema}
                            subSchema={subSchema}
                            subItemsEnabled={subItemsEnabled}
                            isHovered={hoveredRow === group.parent.row.id}
                            selectedRows={selectedRows}
                            showOwnerColumn={showOwnerColumn}
                            showSubItemOwnerColumn={showSubItemOwnerColumn}
                            canEditSchema={canEditSchema}
                            setHoveredRow={setHoveredRow}
                            setDetailPage={setDetailPage}
                            toggleRow={toggleRow}
                            toggleExpand={toggleExpand}
                            handleCreateSubItem={handleCreateSubItem}
                            onCreate={onCreate}
                            teamUsers={teamUsers}
                            resolvedLinks={resolvedLinks}
                            config={config}
                            relationTitles={relationTitles}
                            recordTitlesById={recordTitlesById}
                            badgeCounts={badgeCounts}
                            removeLink={removeLink}
                            collab={collab}
                            renamingSubCol={renamingSubCol}
                            setRenamingSubCol={setRenamingSubCol}
                            renameSubValue={renameSubValue}
                            setRenameSubValue={setRenameSubValue}
                            handleRenameSubCol={handleRenameSubCol}
                            setSubColCtxMenu={setSubColCtxMenu}
                            setAddSubColOpen={setAddSubColOpen}
                            handleSubResizeStart={handleSubResizeStart}
                            subItemGhostParent={subItemGhostParent}
                            setSubItemGhostParent={setSubItemGhostParent}
                            subItemGhostValues={subItemGhostValues}
                            setSubItemGhostValues={setSubItemGhostValues}
                            subItemGhostSaving={subItemGhostSaving}
                            subItemGhostActive={subItemGhostActive}
                            subGhostRef={subGhostRef}
                            handleSubItemGhostCommit={handleSubItemGhostCommit}
                            getChildren={getChildren}
                            // Drag-to-nest (Phase 2)
                            onRowDragStart={rowDrag.handleDragStart}
                            onRowDragEnd={rowDrag.handleDragEnd}
                            onRowDragOver={rowDrag.handleRowDragOver}
                            onRowDragEnter={rowDrag.handleRowDragEnter}
                            onRowDragLeave={rowDrag.handleRowDragLeave}
                            onRowDrop={rowDrag.handleRowDrop}
                            dropTarget={rowDrag.dropTarget}
                            isDragging={rowDrag.isDragging}
                            isDragDisabled={rowDrag.isDragDisabled}
                            disabledReason={rowDrag.disabledReason}
                            // Row context menu (Phase 3)
                            onRowContextMenu={handleRowContextMenu}
                          />
                        ))}
                        {/* Bottom spacer */}
                        <div style={{ height: bottomSpacer }} />
                      </>
                    );
                  })()}

                  {/* Ghost row — new record creation. Dashed border + reduced
                      opacity flags it as "ghost" vs a real row card. */}
                  {onCreate && targetDatabaseId && (
                    <div
                      style={{
                        ...styles.gridRow,
                        display: "grid",
                        gridTemplateColumns: gtc,
                        minHeight: ROW_HEIGHT,
                        border: `1px dashed ${C.darkBorder}`,
                        boxShadow: "none",
                        opacity: ghostSaving ? 0.5 : 0.7,
                        transition: "opacity 0.15s, border-color 0.15s",
                        cursor: "default",
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; }}
                      onMouseLeave={(e) => { if (!ghostActive.current) e.currentTarget.style.opacity = "0.7"; }}
                    >
                      <div style={{ ...styles.gridCell, justifyContent: "center", padding: "4px 4px" }}>
                        <IconPlus size={10} color={C.darkMuted} />
                      </div>
                      {columns.map((col) => {
                        const type = getFieldType(schema, col);
                        const isEditable = EDITABLE_TYPES.has(type);
                        return (
                          <div key={col} style={{ ...styles.gridCell, padding: "2px 6px" }}>
                            {!isEditable ? (
                              <span style={{ color: C.darkMuted, fontSize: 11, fontStyle: "italic" }}>--</span>
                            ) : renderGhostCell(col, type)}
                          </div>
                        );
                      })}
                      <div style={{ ...styles.gridCell, padding: "4px 2px" }} /> {/* badge column spacer */}
                      <div style={{ ...styles.gridCell, padding: "4px 2px" }} /> {/* neuron column spacer */}
                    </div>
                  )}
                  {ghostError && (
                    <div style={{ padding: "4px 12px", fontSize: 11, color: C.error }}>
                      {ghostError}
                    </div>
                  )}

                  {/* ── Empty-space drop zone (Phase 3, un-nest gesture) ──
                      Visible only while a sub-item row is being dragged.
                      Drop here = row's parent_row_id becomes null. */}
                  {rowDrag.isDragging && (() => {
                    const draggedRow = data.find((r) => r.id === rowDrag.dragState?.rowId);
                    if (!draggedRow || !draggedRow._parentRowId) return null;
                    const active = rowDrag.dropTarget?.type === "empty";
                    return (
                      <div
                        onDragOver={rowDrag.handleEmptyDragOver}
                        onDragLeave={rowDrag.handleEmptyDragLeave}
                        onDrop={rowDrag.handleEmptyDrop}
                        style={{
                          marginTop: 8,
                          padding: "12px 16px",
                          border: `1px dashed ${active ? C.accent : C.darkBorder}`,
                          borderRadius: RADIUS.lg,
                          background: active ? `${C.accent}14` : "transparent",
                          color: active ? C.accent : C.darkMuted,
                          fontSize: 12,
                          fontFamily: FONT,
                          textAlign: "center",
                          transition: "background 0.12s, border-color 0.12s, color 0.12s",
                        }}
                      >
                        ⤴ Drop here to move to top level
                      </div>
                    );
                  })()}
                </div>

                {/* ── Sticky Footer (Totals) ── */}
                <TableFooter gtc={gtc} columns={columns} schema={schema} processedData={processedData} />
              </div>
            );
          })()
        )}
      </div>

      {/* Record Detail Panel */}
      {detailPage && (
        <RecordDetail
          page={detailPage}
          schema={detailPage?._parentRowId && subSchema ? subSchema : schema}
          onClose={() => setDetailPage(null)}
          onUpdate={onUpdate}
          onDelete={onDelete ? (ids) => { onDelete(ids); setDetailPage(null); } : undefined}
          pageConfigId={pageConfig?.id}
          resolvedLinks={resolvedLinks}
          // RecordDetail calls back with (fieldName, fieldType); the record id
          // is supplied here since only the view knows which record is open.
          onLinkField={onLinkField ? (fieldName, fieldType) => onLinkField(detailPage.id, fieldName, fieldType) : null}
          onUnlinkField={onUnlinkField}
          onRefresh={onRefresh}
          // Null when the user can't edit the schema — RecordDetail hides the
          // "create option" affordance rather than offering an action whose
          // request is guaranteed to 403.
          onCreateOption={canManageOptions ? (colName, optionName) => handleCreateSchemaOption(detailPage, colName, optionName) : null}
          parentTitle={detailPage?._parentRowId ? getPageTitle(processedData.find(r => r.id === detailPage._parentRowId)) : undefined}
        />
      )}

      {/* Cell Link Picker */}
      {/* Column Context Menu */}
      <ParentColumnContextMenu
        menu={colCtxMenu}
        schema={schema}
        isD1Table={isD1Table}
        canEditSchema={canEditSchema}
        onSort={(col, dir) => { setSortField(col); setSortDir(dir); }}
        onHide={handleHideCol}
        onRename={(col) => { setRenamingCol(col); setRenameValue(col); }}
        onChangeType={handleChangeColType}
        onManageOptions={handleManageOptions}
        onDelete={handleDeleteCol}
        onClose={() => setColCtxMenu(null)}
      />

      {/* Options Manager Modal */}
      {optionsModalCol && (
        <OptionsManagerModal
          column={optionsModalCol}
          onSave={handleSaveOptions}
          onClose={() => setOptionsModalCol(null)}
        />
      )}

      {/* Sub-item column context menu */}
      <SubColumnContextMenu
        menu={subColCtxMenu}
        subSchema={subSchema}
        onRename={(col) => { setRenamingSubCol(col); setRenameSubValue(col); }}
        onManageOptions={handleManageSubOptions}
        onChangeType={handleChangeSubColType}
        onDelete={handleDeleteSubCol}
        onClose={() => setSubColCtxMenu(null)}
      />

      {subOptionsModalCol && (
        <OptionsManagerModal
          column={subOptionsModalCol}
          onSave={handleSaveSubOptions}
          onClose={() => setSubOptionsModalCol(null)}
        />
      )}

      {/* ── Sub-Items: Cascade Delete Dialog ── */}
      <CascadeDeleteDialog
        dialog={cascadeDialog}
        onCancel={() => setCascadeDialog(null)}
        onCascade={handleCascadeDelete}
      />

      {/* ── Dependencies: Confirm-and-delete Dialog ── */}
      <DependencyDeleteDialog
        dialog={dependencyDialog}
        onCancel={() => setDependencyDialog(null)}
        onConfirm={handleConfirmDependents}
      />

      {/* ── Add Column Dialog ── */}
      <AddColumnDialog
        open={addColOpen}
        name={addColName}
        type={addColType}
        onNameChange={setAddColName}
        onTypeChange={setAddColType}
        onSubmit={handleAddCol}
        onClose={() => { setAddColOpen(false); setAddColName(""); setAddColType("text"); }}
        isNotionTable={isNotionTable}
        relationDb={addColRelationDb}
        synced={addColSynced}
        syncedName={addColSyncedName}
        dbSearchQuery={dbSearchQuery}
        dbSearchResults={dbSearchResults}
        dbSearching={dbSearching}
        onRelationDbSelect={setAddColRelationDb}
        onSyncedChange={setAddColSynced}
        onSyncedNameChange={setAddColSyncedName}
        onDbSearchQueryChange={setDbSearchQuery}
        onSearchDbs={searchRelationDbs}
      />

      {/* ── Add Sub-Item Column Dialog ── */}
      <AddSubColumnDialog
        open={addSubColOpen}
        name={addSubColName}
        type={addSubColType}
        onNameChange={setAddSubColName}
        onTypeChange={setAddSubColType}
        onSubmit={handleAddSubCol}
        onClose={() => { setAddSubColOpen(false); setAddSubColName(""); setAddSubColType("text"); }}
      />

      {/* ── Row Context Menu (Phase 3 — un-nest via right-click) ── */}
      <RowContextMenu
        menu={rowCtxMenu}
        onMoveToTop={handleMoveToTop}
        onArchive={handleArchiveRow}
        canArchive={canArchive}
        onClose={() => setRowCtxMenu(null)}
      />

      {/* ── New Record Modal ── */}
      {showNewModal && onCreate && (
        <NewRecordModal
          schema={schema}
          onClose={() => setShowNewModal(false)}
          onCreate={async (dbId, properties) => {
            await onCreate(dbId, properties);
            setShowNewModal(false);
          }}
          databaseId={targetDatabaseId}
        />
      )}
    </div>
  );
}
