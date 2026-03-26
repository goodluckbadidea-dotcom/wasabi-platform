// ─── Wasabi Table View ───
// Schema-agnostic, filterable, sortable, inline-editable data table.
// The primary view for any Notion database.

import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { C, FONT, RADIUS, SHADOW, getStatusColor } from "../design/tokens.js";
import { S } from "../design/styles.js";
import { ANIM, injectAnimations } from "../design/animations.js";
import { hoverBg } from "../design/interactions.js";
import { getPageTitle } from "../notion/properties.js";
import { debounce } from "../utils/helpers.js";
import {
  IconTrash, IconExport, IconEyeOff, IconExpand, IconPlus, IconConnect,
  IconCalendar, IconCheck, IconCheckSquare, IconLink, IconMail, IconPhone,
  IconStatusDot, IconArrowDown, IconChevronDown, IconUser,
} from "../design/icons.jsx";
import FilterChips, { applyChipFilters } from "./FilterChips.jsx";
import RecordDetail from "./RecordDetail.jsx";
import NewRecordModal from "./NewRecordModal.jsx";
import { useLinks } from "../context/LinksContext.jsx";
import LinkPicker from "../core/LinkPicker.jsx";
import { isNeuronsMode, dispatchNeuronSelect } from "../neurons/NeuronsContext.jsx";
import NeuronBadge from "../neurons/NeuronBadge.jsx";
import { listUserDirectory, updateRowOwner, notionProxy, getRecordBadgeCounts, deleteRow } from "../lib/api.js";
import { useTreeData } from "../lib/useTreeData.js";
import { getPinToken } from "../components/PinLockOverlay.jsx";
import { usePlatform } from "../context/PlatformContext.jsx";
// updateDatabase, searchDatabases now imported by table/hooks/useColumnManagement.js
// SelectPicker and MultiSelectPicker now imported by table/CellEditor.jsx
import SavedViewsDropdown from "../components/SavedViewsDropdown.jsx";
import { useCollaboration } from "../context/CollaborationContext.jsx";
import PresenceAvatars from "../components/PresenceAvatars.jsx";
import { getFieldType, getFieldOptions, getOptionNames, readField, displayValue, searchableText } from "./_viewHelpers.js";
import {
  OWNER_COL_NAME, OWNER_COL_WIDTH, D1_TO_NOTION_TYPE, COLUMN_TYPES, TYPE_ICON_MAP,
  mapD1TypeForUI, getTypeIcon, ROW_HEIGHT, VIRT_BUFFER, EDITABLE_TYPES, TEXT_SEARCH_TYPES,
  resolveColumns,
} from "./table/tableHelpers.js";

import { styles, ghostInputStyle } from "./table/tableStyles.js";
import { OwnerCellDisplay, OwnerPicker } from "./table/OwnerCell.jsx";
import { GhostCell } from "./table/GhostRow.jsx";
import CellEditor from "./table/CellEditor.jsx";
import CellDisplay, { CELL_RENDERERS } from "./table/CellDisplay.jsx";
import { ParentColumnContextMenu, SubColumnContextMenu } from "./table/ColumnContextMenu.jsx";
import { AddColumnDialog, AddSubColumnDialog } from "./table/AddColumnDialog.jsx";
import CascadeDeleteDialog from "./table/CascadeDeleteDialog.jsx";
import useGhostRow from "./table/hooks/useGhostRow.js";
import useSubItemGhost from "./table/hooks/useSubItemGhost.js";
import useTableCellEdit from "./table/hooks/useTableCellEdit.js";
import useColumnManagement from "./table/hooks/useColumnManagement.js";



// CellEditor imported from ./table/CellEditor.jsx
// CellDisplay and CELL_RENDERERS imported from ./table/CellDisplay.jsx


// ─── Owner Column Components ───

// OwnerCellDisplay and OwnerPicker imported from ./table/OwnerCell.jsx


// ─── Saved Views Dropdown ───

// ─── Main Table Component ───

export default function Table({ data = [], schema, config = {}, onUpdate, onRefresh, onCreate, onDelete, pageConfig, onSaveFilters, onViewConfigChange, initialDetailRecordId, onInitialDetailConsumed }) {
  const { user } = usePlatform();
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
  const isD1Table = sourceType === "d1";
  const isNotionTable = sourceType === "notion";

  // ── Owner Column ──
  const showOwnerColumn = !!(config.showOwnerColumn || pageConfig?.config?.showOwnerColumn);
  const [teamUsers, setTeamUsers] = useState([]);
  const [ownerPickerRow, setOwnerPickerRow] = useState(null); // pageId of row being edited
  useEffect(() => {
    if (!showOwnerColumn) return;
    listUserDirectory().then((res) => {
      setTeamUsers(res.users || []);
    }).catch(err => console.warn("[Table] listUserDirectory:", err.message || err));
  }, [showOwnerColumn]);

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
  const { resolveLinksForView, createLink, removeLink, getLinksForTarget } = useLinks();
  const [resolvedLinks, setResolvedLinks] = useState(new Map());
  const [linkPickerCell, setLinkPickerCell] = useState(null); // { pageId, field, fieldType }

  // Resolve linked values for this view
  const viewIdx = pageConfig?.views?.findIndex((v) => v === config) ?? 0;
  useEffect(() => {
    if (!pageConfig?.id) return;
    resolveLinksForView(pageConfig.id, viewIdx)
      .then(setResolvedLinks)
      .catch(err => console.warn("[Table] resolveLinksForView:", err.message || err));
  }, [pageConfig?.id, viewIdx, resolveLinksForView]);
  const targetDatabaseId = config.databaseId || pageConfig?.databaseIds?.[0] || pageConfig?.id;

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
  const workerUrl = user?.workerUrl;
  const notionKey = user?.notionKey;

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
    canEditSchema, isD1Table, isNotionTable, notionDbId, workerUrl, notionKey,
    pageConfig, onRefresh, onViewConfigChange, initialColWidths: config.colWidths,
  });
  const { colWidths } = colMgmt;
  // Destructure commonly used values
  const {
    colCtxMenu, setColCtxMenu, handleColRightClick, handleHideCol,
    renamingCol, setRenamingCol, renameValue, setRenameValue, handleRenameCol,
    subColCtxMenu, setSubColCtxMenu,
    renamingSubCol, setRenamingSubCol, renameSubValue, setRenameSubValue,
    handleRenameSubCol, handleDeleteSubCol, handleDeleteCol, handleChangeColType,
    addColOpen, setAddColOpen, addColName, setAddColName, addColType, setAddColType,
    addColRelationDb, setAddColRelationDb, addColSynced, setAddColSynced,
    addColSyncedName, setAddColSyncedName,
    dbSearchResults, dbSearchQuery, setDbSearchQuery, dbSearching,
    searchRelationDbs, handleAddCol,
    addSubColOpen, setAddSubColOpen, addSubColName, setAddSubColName,
    addSubColType, setAddSubColType, handleAddSubCol,
    colDrag, handleColDragStart, handleResizeStart, colClickTimer,
  } = colMgmt;

  // Identify filterable fields (select / status)
  const filterableFields = useMemo(() => {
    if (!schema) return [];
    return [...schema.statuses, ...schema.selects].filter(
      (f) => columns.includes(f.name) && f.options?.length > 0
    );
  }, [schema, columns]);

  // Debounced search
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const debouncedSetSearch = useMemo(
    () => debounce((val) => setDebouncedSearch(val), 200),
    []
  );
  useEffect(() => {
    debouncedSetSearch(search);
  }, [search, debouncedSetSearch]);

  // Chip filter change handler (persists via onViewConfigChange)
  const handleChipFilterChange = useCallback((newFilters) => {
    setChipFilters(newFilters);
    setActiveSavedViewId(null);
    if (onSaveFilters) onSaveFilters(newFilters);
    if (onViewConfigChange) onViewConfigChange({ activeFilters: newFilters, activeSavedViewId: null });
  }, [onSaveFilters, onViewConfigChange]);

  // Filter + search + sort pipeline
  const processedData = useMemo(() => {
    let rows = [...data];

    // Apply chip filters (multi-select OR within field, AND across fields)
    rows = applyChipFilters(rows, chipFilters, schema);

    // Apply dropdown filters (legacy, still used for column-header selects)
    for (const [field, filterVal] of Object.entries(filters)) {
      if (!filterVal) continue;
      rows = rows.filter((page) => {
        const val = readField(page, field);
        if (val === null) return false;
        return String(val) === filterVal;
      });
    }

    // Apply search
    if (debouncedSearch) {
      const q = debouncedSearch.toLowerCase();
      rows = rows.filter((page) => {
        for (const col of columns) {
          const val = readField(page, col);
          const text = searchableText(val, getFieldType(schema, col));
          if (text.toLowerCase().includes(q)) return true;
        }
        return false;
      });
    }

    // Apply sort
    if (sortField && sortDir) {
      const type = getFieldType(schema, sortField);
      rows.sort((a, b) => {
        let va = readField(a, sortField);
        let vb = readField(b, sortField);

        // Normalize for comparison
        if (type === "date") {
          va = typeof va === "object" ? va?.start : va;
          vb = typeof vb === "object" ? vb?.start : vb;
        }

        // Nulls last
        if (va === null && vb === null) return 0;
        if (va === null) return 1;
        if (vb === null) return -1;

        // Number compare
        if (type === "number") {
          return sortDir === "asc" ? va - vb : vb - va;
        }

        // String compare
        const sa = String(va).toLowerCase();
        const sb = String(vb).toLowerCase();
        if (sa < sb) return sortDir === "asc" ? -1 : 1;
        if (sa > sb) return sortDir === "asc" ? 1 : -1;
        return 0;
      });
    }

    return rows;
  }, [data, filters, chipFilters, debouncedSearch, sortField, sortDir, columns, schema]);

  // ── Sub-Items Tree ──
  const subItemsEnabled = isD1Table;

  const treeSortFn = useMemo(() => {
    if (!sortField || !sortDir) return null;
    const type = getFieldType(schema, sortField);
    return (a, b) => {
      let va = readField(a, sortField);
      let vb = readField(b, sortField);
      if (type === "date") {
        va = typeof va === "object" ? va?.start : va;
        vb = typeof vb === "object" ? vb?.start : vb;
      }
      if (va === null && vb === null) return 0;
      if (va === null) return 1;
      if (vb === null) return -1;
      if (type === "number") return sortDir === "asc" ? va - vb : vb - va;
      const sa = String(va).toLowerCase();
      const sb = String(vb).toLowerCase();
      if (sa < sb) return sortDir === "asc" ? -1 : 1;
      if (sa > sb) return sortDir === "asc" ? 1 : -1;
      return 0;
    };
  }, [sortField, sortDir, schema]);

  const {
    displayList, toggleExpand, expandAll, collapseAll,
    expandedRows, getChildren, childMap,
  } = useTreeData(processedData, { enabled: subItemsEnabled, sortFn: treeSortFn });

  // ── Sub-Item Independent Schema ──
  const subColumns = useMemo(() => schema?._subColumns || [], [schema]);
  const subSchema = useMemo(() => schema?._subSchema || null, [schema]);
  const subTitleField = useMemo(() => {
    if (subColumns.length === 0) return schema?.title?.name || null;
    const titleCol = subColumns.find(c => c.type === "title");
    return titleCol?.name || subColumns[0]?.name || null;
  }, [subColumns, schema]);
  const subVisibleColumns = useMemo(() => {
    if (subColumns.length === 0) return [];
    return subColumns.map(c => c.name);
  }, [subColumns]);

  // ── Cell Edit Hook ──
  const cellEdit = useTableCellEdit({
    schema, onUpdate, focusedCell, setFocusedCell, displayListLength: displayList.length,
    canEditSchema, isNotionTable, notionDbId, workerUrl, notionKey, pageConfig, onRefresh,
  });
  const { editCell, setEditCell, savingCells, failedCells, initialChar, setInitialChar, handleEditCommit, handleCreateOption, handleCheckboxToggle } = cellEdit;

  // ── Sub-Item Ghost Hook ──
  const subGhost = useSubItemGhost({ onCreate, pageConfig, schema, subSchema, subTitleField, expandedRows, toggleExpand });
  const {
    subItemGhostParent, setSubItemGhostParent, subItemGhostValues, setSubItemGhostValues,
    subItemGhostSaving, subItemGhostActive, subGhostRef,
    handleCreateSubItem, handleSubItemGhostCommit,
  } = subGhost;

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

  // Re-sync visible range when data or container size changes
  useEffect(() => {
    const st = scrollTopRef.current;
    const totalRows = displayList.length;
    const newStart = Math.min(totalRows, Math.max(0, Math.floor(st / ROW_HEIGHT) - VIRT_BUFFER));
    const newEnd = Math.min(totalRows, Math.ceil((st + containerHeight) / ROW_HEIGHT) + VIRT_BUFFER);
    setVisibleRange({ start: newStart, end: newEnd });
  }, [displayList.length, containerHeight]);

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

  // Scroll focused cell into view (for virtualization compatibility)
  useEffect(() => {
    if (focusedCell && scrollAreaRef.current) {
      const targetTop = focusedCell.row * ROW_HEIGHT;
      const container = scrollAreaRef.current;
      const viewTop = container.scrollTop;
      const viewBottom = viewTop + container.clientHeight - 80; // account for header
      if (targetTop < viewTop) {
        container.scrollTop = targetTop;
      } else if (targetTop + ROW_HEIGHT > viewBottom) {
        container.scrollTop = targetTop + ROW_HEIGHT - container.clientHeight + 80;
      }
    }
  }, [focusedCell]);

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

  // ── Bulk Delete ──
  const handleBulkDelete = useCallback(() => {
    if (!onDelete || selectedRows.size === 0) return;
    const confirmed = window.confirm(`Archive ${selectedRows.size} selected record${selectedRows.size !== 1 ? "s" : ""}?`);
    if (!confirmed) return;
    onDelete([...selectedRows]);
    setSelectedRows(new Set());
  }, [onDelete, selectedRows]);

  // ── Sub-Item: Delete with cascade awareness ──
  const handleDeleteWithCascade = useCallback(async (rowIds) => {
    if (!onDelete || !rowIds?.length) return;
    try {
      await onDelete(rowIds);
    } catch (err) {
      if (err?.status === 409 && err?.data?.hasChildren) {
        setCascadeDialog({ rowIds, childCount: err.data.childCount });
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
        await deleteRow(tableId, id, { pinToken, cascade });
      }
      setCascadeDialog(null);
      setSelectedRows(new Set());
      if (onRefresh) await onRefresh();
    } catch (err) {
      console.error("Cascade delete failed:", err);
      setCascadeDialog(null);
    }
  }, [cascadeDialog, pageConfig, onRefresh]);

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
      <div style={styles.toolbar}>
        <SavedViewsDropdown
          savedViews={config.savedViews || []}
          activeSavedViewId={activeSavedViewId}
          onSelectView={handleSelectSavedView}
          onSaveView={handleSaveNewView}
          onUpdateView={handleUpdateView}
          onRenameView={handleRenameView}
          onDeleteView={handleDeleteView}
        />
        <div
          style={{
            ...styles.searchWrap,
            ...(searchFocused ? { borderColor: C.accent, boxShadow: `0 0 0 2px ${C.accent}33` } : {}),
          }}
        >
          <span style={styles.searchIcon}>&#x1f50d;</span>
          <input
            type="text"
            placeholder="Search..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            style={styles.searchInput}
          />
          {search && (
            <span
              style={{ fontSize: 14, color: C.darkMuted, cursor: "pointer", padding: "0 2px" }}
              onClick={() => setSearch("")}
            >
              &#x2715;
            </span>
          )}
        </div>

        {subItemsEnabled && Object.keys(childMap).length > 0 && (
          <div style={{ display: "flex", gap: 2 }}>
            <button
              onClick={expandAll}
              title="Expand all"
              style={styles.refreshBtn}
            >
              <IconChevronDown size={10} color={C.darkMuted} style={{ transform: "rotate(-90deg)" }} />
              <span style={{ fontSize: 11, color: C.darkMuted, marginLeft: 2 }}>All</span>
            </button>
            <button
              onClick={collapseAll}
              title="Collapse all"
              style={styles.refreshBtn}
            >
              <IconChevronDown size={10} color={C.darkMuted} />
              <span style={{ fontSize: 11, color: C.darkMuted, marginLeft: 2 }}>All</span>
            </button>
          </div>
        )}

        {filterableFields.map((field) => (
          <select
            key={field.name}
            style={styles.filterSelect}
            value={filters[field.name] || ""}
            onChange={(e) => handleFilterChange(field.name, e.target.value)}
          >
            <option value="">{field.name}: All</option>
            {field.options.map((opt) => (
              <option key={opt.name} value={opt.name}>{opt.name}</option>
            ))}
          </select>
        ))}

        {/* Column visibility toggle */}
        <div ref={colMenuRef} style={{ position: "relative" }}>
          <button
            style={{
              ...styles.refreshBtn,
              ...(hiddenColumns.size > 0 ? { borderColor: C.accent, color: C.accent } : {}),
            }}
            onClick={() => setColMenuOpen((o) => !o)}
            title="Toggle columns"
          >
            <IconEyeOff size={14} color={hiddenColumns.size > 0 ? C.accent : C.darkMuted} />
          </button>
          {colMenuOpen && (
            <div
              style={{
                position: "absolute",
                top: "100%",
                right: 0,
                marginTop: 4,
                background: C.darkSurf,
                border: `1px solid ${C.darkBorder}`,
                borderRadius: RADIUS.lg,
                boxShadow: SHADOW.dropdown,
                padding: "6px 0",
                zIndex: 20,
                minWidth: 180,
                maxHeight: 280,
                overflowY: "auto",
              }}
            >
              {allColumns.map((col) => {
                const visible = !hiddenColumns.has(col);
                return (
                  <div
                    key={col}
                    onClick={() => toggleColumn(col)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "6px 12px",
                      cursor: "pointer",
                      fontSize: 12,
                      fontFamily: FONT,
                      color: visible ? C.darkText : C.darkMuted,
                      transition: "background 0.12s",
                    }}
                    {...hoverBg()}
                  >
                    <span style={{
                      width: 14,
                      height: 14,
                      borderRadius: RADIUS.sm,
                      border: `2px solid ${visible ? C.accent : C.darkBorder}`,
                      background: visible ? C.accent : "transparent",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 9,
                      color: "#fff",
                      fontWeight: 700,
                      flexShrink: 0,
                    }}>
                      {visible ? "\u2713" : ""}
                    </span>
                    {col}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Add Row — opens NewRecordModal */}
        {onCreate && targetDatabaseId && (
          <button
            style={styles.refreshBtn}
            onClick={() => setShowNewModal(true)}
            title="Add new row"
          >
            <IconPlus size={14} color={C.darkMuted} />
          </button>
        )}

        {/* CSV Export */}
        <button
          style={styles.refreshBtn}
          onClick={handleExport}
          title="Export CSV"
        >
          <IconExport size={14} color={C.darkMuted} />
        </button>

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

        <div style={{ flex: 1 }} />
        {collab?.activeUsers?.size > 0 && (
          <PresenceAvatars users={[...collab.activeUsers.values()]} size={24} />
        )}
        <span style={styles.countLabel}>
          {processedData.length === data.length
            ? `${data.length} record${data.length !== 1 ? "s" : ""}`
            : `${processedData.length} of ${data.length}`}
        </span>
      </div>

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
            const totalRows = displayList.length;
            const newStart = Math.min(totalRows, Math.max(0, Math.floor(st / ROW_HEIGHT) - VIRT_BUFFER));
            const newEnd = Math.min(totalRows, Math.ceil((st + containerHeight) / ROW_HEIGHT) + VIRT_BUFFER);
            setVisibleRange(prev =>
              prev.start === newStart && prev.end === newEnd ? prev : { start: newStart, end: newEnd }
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
            const gtc = `52px ${columns.map(col => `${colWidths[col] || (col === OWNER_COL_NAME ? OWNER_COL_WIDTH : 120)}px`).join(" ")} 56px 40px${canEditSchema ? " 44px" : ""}`;
            const totalTableWidth = 52 + columns.reduce((sum, col) => sum + (colWidths[col] || (col === OWNER_COL_NAME ? OWNER_COL_WIDTH : 120)), 0) + 40 + (canEditSchema ? 44 : 0);
            // Sub-item grid: checkbox + indent + sub-columns + badge + neuron + optional add-col
            const subColsList = subVisibleColumns.length > 0 ? subVisibleColumns : (subTitleField ? [subTitleField] : []);
            const subGtc = subColsList.length > 0
              ? `52px ${subColsList.map(() => "120px").join(" ")} 56px 40px${canEditSchema ? " 44px" : ""}`
              : gtc;

            return (
              <div style={{ minWidth: totalTableWidth }}>
                {/* ── Sticky Header ── */}
                <div style={{ ...styles.gridHeader, gridTemplateColumns: gtc }}>
                  {/* Select-all checkbox */}
                  <div
                    style={{ ...styles.gridHeaderCell, padding: "10px 8px", textAlign: "center", display: "flex", alignItems: "center", justifyContent: "center" }}
                    onClick={toggleAllRows}
                  >
                    <span style={styles.toggle(selectedRows.size === displayList.length && displayList.length > 0)}>
                      {selectedRows.size === displayList.length && displayList.length > 0 ? "\u2713" : ""}
                    </span>
                  </div>
                  {columns.map((col) => {
                    if (col === OWNER_COL_NAME && showOwnerColumn) {
                      return (
                        <div key={col} style={{ ...styles.gridHeaderCell, position: "relative" }}>
                          <svg width="11" height="11" viewBox="0 0 16 16" fill="none" style={{ marginRight: 5, opacity: 0.55, verticalAlign: "middle" }}>
                            <circle cx="8" cy="5" r="3.5" stroke="currentColor" strokeWidth="1.5" fill="none"/>
                            <path d="M2 14.5c0-3 2.7-5 6-5s6 2 6 5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
                          </svg>
                          Owner
                        </div>
                      );
                    }
                    const isActive = sortField === col;
                    const isDragOver = colDrag?.overCol === col;
                    return (
                      <div
                        key={col}
                        data-col-header={col}
                        style={{
                          ...styles.gridHeaderCell,
                          ...(isActive ? styles.gridHeaderCellActive : {}),
                          ...(isDragOver ? { borderLeft: `2px solid ${C.accent}` } : {}),
                          cursor: colDrag ? "grabbing" : "pointer",
                        }}
                        onClick={(e) => {
                          e.preventDefault();
                          if (colClickTimer.current) { clearTimeout(colClickTimer.current); colClickTimer.current = null; return; }
                          const rect = e.currentTarget.getBoundingClientRect();
                          const menuW = 180;
                          const x = Math.min(rect.left, window.innerWidth - menuW);
                          colClickTimer.current = setTimeout(() => { colClickTimer.current = null; setColCtxMenu({ col, x, y: rect.bottom + 2 }); }, 250);
                        }}
                        onDoubleClick={(e) => {
                          e.preventDefault(); e.stopPropagation();
                          if (colClickTimer.current) { clearTimeout(colClickTimer.current); colClickTimer.current = null; }
                          if (canEditSchema) { setRenamingCol(col); setRenameValue(col); setColCtxMenu(null); }
                        }}
                        onContextMenu={(e) => handleColRightClick(col, e)}
                        onMouseDown={(e) => { if (e.button === 0 && !e.target.closest("[data-resize]")) handleColDragStart(col, e); }}
                      >
                        {renamingCol === col ? (
                          <input
                            autoFocus
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleRenameCol(col, renameValue);
                              if (e.key === "Escape") setRenamingCol(null);
                              e.stopPropagation();
                            }}
                            onBlur={() => handleRenameCol(col, renameValue)}
                            onClick={(e) => e.stopPropagation()}
                            style={{
                              width: "100%", border: `1px solid ${C.accent}`, borderRadius: RADIUS.sm,
                              background: C.darkSurf2, color: C.darkText, fontFamily: FONT, fontSize: 11,
                              padding: "2px 6px", outline: "none", fontWeight: 600, textTransform: "uppercase",
                              letterSpacing: "0.06em",
                            }}
                          />
                        ) : (
                          <>
                            {(() => {
                              const ti = getTypeIcon(schema, col);
                              if (!ti) return null;
                              return ti.Icon ? (
                                <span style={{ marginRight: 5, opacity: 0.55, verticalAlign: "middle", display: "inline-flex" }} title={getFieldType(schema, col)}><ti.Icon size={11} color="currentColor" /></span>
                              ) : ti.text ? (
                                <span style={{ marginRight: 5, fontSize: 10, opacity: 0.55, verticalAlign: "middle", fontWeight: 600 }} title={getFieldType(schema, col)}>{ti.text}</span>
                              ) : null;
                            })()}
                            {col}
                            {isActive && sortDir && (
                              <span style={styles.sortArrow}>
                                {sortDir === "asc" ? "\u25B2" : "\u25BC"}
                              </span>
                            )}
                          </>
                        )}
                        {/* Resize handle */}
                        <span
                          data-resize="true"
                          style={{
                            position: "absolute", right: 0, top: 0, bottom: 0, width: 5,
                            cursor: "col-resize", background: "transparent", zIndex: 3,
                          }}
                          onMouseDown={(e) => handleResizeStart(col, e)}
                          onMouseEnter={(e) => { e.currentTarget.style.background = C.accent + "44"; }}
                          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                        />
                      </div>
                    );
                  })}
                  {/* Badge column header */}
                  <div style={{ ...styles.gridHeaderCell, padding: "10px 2px" }} />
                  {/* Neuron column header */}
                  <div style={{ ...styles.gridHeaderCell, padding: "10px 4px" }} />
                  {/* Add column button */}
                  {canEditSchema && (
                    <div style={{ ...styles.gridHeaderCell, textAlign: "center", padding: "10px 8px", display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }}>
                      <div
                        style={{
                          display: "flex", alignItems: "center", justifyContent: "center",
                          width: 26, height: 26, borderRadius: RADIUS.pill,
                          border: `1px dashed ${addColOpen ? C.accent : C.darkBorder}`,
                          cursor: "pointer", transition: "all 0.15s",
                          color: addColOpen ? C.accent : C.darkMuted,
                          opacity: addColOpen ? 1 : 0.65,
                          background: addColOpen ? `${C.accent}10` : "transparent",
                        }}
                        onClick={(e) => { e.stopPropagation(); setAddColOpen(!addColOpen); }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.opacity = "1";
                          e.currentTarget.style.borderColor = C.accent;
                          e.currentTarget.style.color = C.accent;
                          e.currentTarget.style.background = `${C.accent}10`;
                        }}
                        onMouseLeave={(e) => {
                          if (!addColOpen) {
                            e.currentTarget.style.opacity = "0.65";
                            e.currentTarget.style.borderColor = C.darkBorder;
                            e.currentTarget.style.color = C.darkMuted;
                            e.currentTarget.style.background = "transparent";
                          }
                        }}
                        title="Add column"
                      >
                        <IconPlus size={13} />
                      </div>
                    </div>
                  )}
                </div>

                {/* ── Virtualized Card Rows ── */}
                <div style={{ padding: "4px 8px" }}>
                  {(() => {
                    const totalRows = displayList.length;
                    const visibleStart = visibleRange.start;
                    const visibleEnd = Math.min(totalRows, visibleRange.end);
                    const visibleEntries = displayList.slice(visibleStart, visibleEnd);
                    const cardHeight = ROW_HEIGHT + 4; // row + marginBottom

                    return (
                      <>
                        {/* Top spacer */}
                        <div style={{ height: visibleStart * cardHeight }} />
                        {visibleEntries.map((entry, localIdx) => {
                          const page = entry.row;
                          const { depth: rowDepth, hasChildren, isExpanded } = entry;
                          const pageId = page.id;
                          const isHovered = hoveredRow === pageId;
                          const isSelected = selectedRows.has(pageId);
                          const isSubItem = rowDepth > 0;
                          const prevEntry = localIdx > 0 ? visibleEntries[localIdx - 1] : (visibleStart > 0 ? displayList[visibleStart + localIdx - 1] : null);
                          const isFirstChild = isSubItem && (!prevEntry || prevEntry.depth === 0);
                          const activeGtc = isSubItem ? subGtc : gtc;
                          const activeCols = isSubItem ? subColsList : columns;
                          const activeSchema = isSubItem && subSchema ? subSchema : schema;

                          const childBgTint = rowDepth > 0 ? "rgba(255,255,255,0.015)" : "transparent";
                          const cardBg = isSelected ? C.accent + "10" : isHovered ? C.darkSurf2 : childBgTint;
                          const othersOnRow = collab?.getUsersOnRecord?.(pageId) || [];
                          const presenceColor = othersOnRow.length > 0 ? othersOnRow[0].color : null;
                          const presenceBorder = othersOnRow.length > 1
                            ? { borderLeft: "3px solid", borderImage: `linear-gradient(to bottom, ${othersOnRow.map((u) => u.color).join(", ")}) 1` }
                            : presenceColor ? { borderLeft: `3px solid ${presenceColor}` } : {};

                          return (
                            <React.Fragment key={pageId}>
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
                                    style={{ padding: "0 8px", fontSize: 11, fontWeight: 700, color: C.darkMuted, textTransform: "uppercase", letterSpacing: "0.06em", cursor: canEditSchema ? "pointer" : "default", userSelect: "none" }}
                                    onDoubleClick={(e) => {
                                      e.preventDefault(); e.stopPropagation();
                                      if (canEditSchema) { setRenamingSubCol(col); setRenameSubValue(col); setSubColCtxMenu(null); }
                                    }}
                                    onContextMenu={(e) => {
                                      if (!canEditSchema) return;
                                      e.preventDefault(); e.stopPropagation();
                                      setSubColCtxMenu({ col, x: e.clientX, y: e.clientY });
                                    }}
                                  >
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
                                height: ROW_HEIGHT,
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
                                {/* Branch icon: always visible on parent rows (not hover-only) for iPad support */}
                                {subItemsEnabled && !isSubItem && rowDepth < 5 && onCreate && (
                                  <button
                                    data-sub-item-trigger
                                    title="Add sub-item"
                                    onClick={(e) => { e.stopPropagation(); handleCreateSubItem(pageId); }}
                                    style={{
                                      background: "none", border: "none", cursor: "pointer",
                                      padding: 6, display: "flex", alignItems: "center",
                                      opacity: isHovered ? 0.8 : 0.3, transition: "opacity 0.15s",
                                      minWidth: 28, minHeight: 28, justifyContent: "center",
                                    }}
                                    onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; }}
                                    onMouseLeave={(e) => { e.currentTarget.style.opacity = isHovered ? "0.8" : "0.3"; }}
                                  >
                                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke={C.darkMuted} strokeWidth="1.5" strokeLinecap="round">
                                      <path d="M4 4v8M4 8h4c2 0 3 0 3-2V4" />
                                      <path d="M4 12h4c2 0 3 0 3-2V8" />
                                    </svg>
                                  </button>
                                )}
                              </div>
                              {/* Data cells */}
                              {activeCols.map((col, colIdx) => {
                                if (col === OWNER_COL_NAME && showOwnerColumn) {
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
                                        {hasChildren ? (
                                          <button
                                            onClick={(e) => { e.stopPropagation(); toggleExpand(pageId); }}
                                            aria-expanded={isExpanded}
                                            style={{
                                              background: "none", border: "none", cursor: "pointer",
                                              outline: "none", padding: "0 4px", display: "flex",
                                              alignItems: "center", flexShrink: 0,
                                            }}
                                          >
                                            <IconChevronDown
                                              size={10}
                                              color={C.darkMuted}
                                              style={{
                                                transition: "transform 0.15s",
                                                transform: isExpanded ? "rotate(0deg)" : "rotate(-90deg)",
                                              }}
                                            />
                                          </button>
                                        ) : rowDepth > 0 ? (
                                          <div style={{ width: 16, flexShrink: 0 }} />
                                        ) : null}
                                        <div style={{ minWidth: 0, flex: 1, overflow: "hidden" }}>
                                          <CellDisplay
                                            value={value}
                                            type={type}
                                            fieldName={col}
                                            schema={activeSchema}
                                            colorMapping={config.colorMapping}
                                            relationTitles={relationTitles}
                                            linkInfo={linkData ? { sourceName: linkData.link?.name, stale: linkData.stale } : undefined}
                                            linkedValue={linkData?.value}
                                            onLinkClick={linkData ? () => removeLink(linkData.link.id) : undefined}
                                          />
                                        </div>
                                        {hasChildren && !isExpanded && (
                                          <span style={{
                                            fontSize: 10, color: C.darkMuted, marginLeft: 4,
                                            background: C.darkSurf2, borderRadius: 8, padding: "1px 5px",
                                            flexShrink: 0,
                                          }}>
                                            {getChildren(pageId).length}
                                          </span>
                                        )}
                                      </div>
                                    ) : (
                                      <CellDisplay
                                        value={value}
                                        type={type}
                                        fieldName={col}
                                        schema={activeSchema}
                                        colorMapping={config.colorMapping}
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
                                  height: ROW_HEIGHT,
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
                        })}
                        {/* Bottom spacer */}
                        <div style={{ height: Math.max(0, (totalRows - visibleEnd) * cardHeight) }} />
                      </>
                    );
                  })()}

                  {/* Ghost row — new record creation */}
                  {onCreate && targetDatabaseId && (
                    <div
                      style={{
                        ...styles.gridRow,
                        gridTemplateColumns: gtc,
                        height: ROW_HEIGHT,
                        opacity: ghostSaving ? 0.5 : 0.6,
                        transition: "opacity 0.15s",
                        cursor: "default",
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; }}
                      onMouseLeave={(e) => { if (!ghostActive.current) e.currentTarget.style.opacity = "0.6"; }}
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
                </div>

                {/* ── Sticky Footer (Totals) ── */}
                <div style={{ ...styles.gridFooter, gridTemplateColumns: gtc }}>
                  <div style={{ padding: "4px 8px" }} />
                  {columns.map((col) => {
                    const type = getFieldType(schema, col);
                    let total = null;
                    if (type === "number") {
                      total = 0;
                      for (const page of processedData) {
                        const v = readField(page, col);
                        if (typeof v === "number") total += v;
                      }
                    }
                    return (
                      <div
                        key={col}
                        style={{
                          padding: "4px 12px",
                          fontWeight: 600,
                          fontSize: 12,
                          fontVariantNumeric: "tabular-nums",
                          color: total !== null ? C.darkText : "transparent",
                        }}
                      >
                        {total !== null ? total.toLocaleString() : ""}
                      </div>
                    );
                  })}
                  <div style={{ padding: "4px 2px" }} />
                </div>
              </div>
            );
          })()
        )}
      </div>

      {/* Record Detail Panel */}
      {detailPage && (
        <RecordDetail
          page={detailPage}
          schema={schema}
          onClose={() => setDetailPage(null)}
          onUpdate={async (pageId, properties) => {
            if (!onUpdate) throw new Error("Updates not available");
            for (const [fieldName, payload] of Object.entries(properties)) {
              await onUpdate(pageId, fieldName, payload);
            }
          }}
          onDelete={onDelete ? (ids) => { onDelete(ids); setDetailPage(null); } : undefined}
          pageConfigId={pageConfig?.id}
          resolvedLinks={resolvedLinks}
          onLinkField={(fieldName, fieldType) => setLinkPickerCell({ pageId: detailPage.id, field: fieldName, fieldType })}
          onUnlinkField={(linkId) => {
            removeLink(linkId);
            resolveLinksForView(pageConfig?.id, viewIdx).then(setResolvedLinks).catch(err => console.warn("[Table] resolveLinksForView:", err.message || err));
          }}
          onRefresh={onRefresh}
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
        onDelete={handleDeleteCol}
        onClose={() => setColCtxMenu(null)}
      />

      {/* Sub-item column context menu */}
      <SubColumnContextMenu
        menu={subColCtxMenu}
        onRename={(col) => { setRenamingSubCol(col); setRenameSubValue(col); }}
        onDelete={handleDeleteSubCol}
        onClose={() => setSubColCtxMenu(null)}
      />

      {linkPickerCell && (
        <LinkPicker
          targetFieldType={linkPickerCell.fieldType}
          onCancel={() => setLinkPickerCell(null)}
          onSelect={async (selection) => {
            const { sourceRef, sourcePageId, sourceViewIdx, sourceName, sourceIsReadOnly, previewValue, sourceFieldType } = selection;
            const targetRef = { type: "notion", pageId: linkPickerCell.pageId, field: linkPickerCell.field };
            await createLink({
              name: sourceName,
              sourcePage: sourcePageId,
              sourceView: sourceViewIdx,
              sourceRef,
              targetPage: pageConfig?.id || "",
              targetView: viewIdx,
              targetRef,
              direction: "one_way",
              sourceFieldType: sourceFieldType || "",
              targetFieldType: linkPickerCell.fieldType || "",
            });
            // Refresh resolved links
            resolveLinksForView(pageConfig?.id, viewIdx)
              .then(setResolvedLinks)
              .catch(err => console.warn("[Table] resolveLinksForView:", err.message || err));
            setLinkPickerCell(null);
          }}
        />
      )}

      {/* ── Sub-Items: Cascade Delete Dialog ── */}
      <CascadeDeleteDialog
        dialog={cascadeDialog}
        onCancel={() => setCascadeDialog(null)}
        onCascade={handleCascadeDelete}
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
