// ─── useColumnManagement ───
// Manages all column operations: resize, context menu, rename, delete, type change,
// add column, relation DB search, drag-to-reorder, sub-column management.

import { useState, useRef, useEffect, useCallback } from "react";
import { updateTableSchema, updateSubColumnSchema, getTableSchema } from "../../../lib/api.js";
import { updateDatabase, searchDatabases } from "../../../notion/client.js";
import { D1_TO_NOTION_TYPE } from "../tableHelpers.js";

export default function useColumnManagement({
  schema, columns, allColumnsRef, hiddenColumns, setHiddenColumns,
  canEditSchema, isD1Table, isNotionTable, notionDbId,
  pageConfig, onRefresh, onViewConfigChange, initialColWidths, initialSubColWidths,
}) {
  // ── Column Resize ──
  const [colWidths, setColWidths] = useState(() => initialColWidths || {});
  const resizeDrag = useRef(null);
  const colWidthsRef = useRef(colWidths);
  colWidthsRef.current = colWidths;

  // ── Sub-Column Resize ──
  const [subColWidths, setSubColWidths] = useState(() => initialSubColWidths || {});
  const subResizeDrag = useRef(null);
  const subColWidthsRef = useRef(subColWidths);
  subColWidthsRef.current = subColWidths;

  // ── Column Context Menu ──
  const [colCtxMenu, setColCtxMenu] = useState(null);
  const [renamingCol, setRenamingCol] = useState(null);
  const [renameValue, setRenameValue] = useState("");
  const colClickTimer = useRef(null);

  // ── Sub-item Column Management ──
  const [subColCtxMenu, setSubColCtxMenu] = useState(null);
  const [renamingSubCol, setRenamingSubCol] = useState(null);
  const [renameSubValue, setRenameSubValue] = useState("");

  // ── Add Column Dialog ──
  const [addColOpen, setAddColOpen] = useState(false);
  const [addColName, setAddColName] = useState("");
  const [addColType, setAddColType] = useState("text");
  const [addColRelationDb, setAddColRelationDb] = useState(null);
  const [addColSynced, setAddColSynced] = useState(true);
  const [addColSyncedName, setAddColSyncedName] = useState("");
  const [dbSearchResults, setDbSearchResults] = useState([]);
  const [dbSearchQuery, setDbSearchQuery] = useState("");
  const [dbSearching, setDbSearching] = useState(false);

  // ── Add Sub-Column Dialog ──
  const [addSubColOpen, setAddSubColOpen] = useState(false);
  const [addSubColName, setAddSubColName] = useState("");
  const [addSubColType, setAddSubColType] = useState("text");

  // ── Column Drag Reorder ──
  const [colDrag, setColDrag] = useState(null);

  // ── Resize Handlers ──
  const handleResizeStart = useCallback((col, e) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = colWidthsRef.current[col] || 150;
    resizeDrag.current = { col, startX, startW };

    const onMove = (me) => {
      if (!resizeDrag.current) return;
      const dx = me.clientX - resizeDrag.current.startX;
      const newW = Math.max(60, resizeDrag.current.startW + dx);
      setColWidths((prev) => ({ ...prev, [resizeDrag.current.col]: newW }));
    };
    const onUp = () => {
      if (resizeDrag.current && onViewConfigChange) {
        const finalWidths = { ...colWidthsRef.current };
        onViewConfigChange({ colWidths: finalWidths });
      }
      resizeDrag.current = null;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [onViewConfigChange]);

  // ── Sub-Column Resize Handler ──
  const handleSubResizeStart = useCallback((col, e) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = subColWidthsRef.current[col] || 150;
    subResizeDrag.current = { col, startX, startW };

    const onMove = (me) => {
      if (!subResizeDrag.current) return;
      const dx = me.clientX - subResizeDrag.current.startX;
      const newW = Math.max(60, subResizeDrag.current.startW + dx);
      setSubColWidths((prev) => ({ ...prev, [subResizeDrag.current.col]: newW }));
    };
    const onUp = () => {
      if (subResizeDrag.current && onViewConfigChange) {
        const finalWidths = { ...subColWidthsRef.current };
        onViewConfigChange({ subColWidths: finalWidths });
      }
      subResizeDrag.current = null;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [onViewConfigChange]);

  // ── Context Menu ──
  const handleColRightClick = useCallback((col, e) => {
    e.preventDefault();
    setColCtxMenu({ col, x: e.clientX, y: e.clientY });
  }, []);

  useEffect(() => {
    if (!colCtxMenu) return;
    const handler = () => setColCtxMenu(null);
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [colCtxMenu]);

  // ── Hide Column ──
  const handleHideCol = useCallback((col) => {
    setHiddenColumns((prev) => new Set([...prev, col]));
    setColCtxMenu(null);
    if (onViewConfigChange) {
      const visibleFields = allColumnsRef.current.filter((c) => c !== col && !hiddenColumns.has(c));
      onViewConfigChange({ visibleFields });
    }
  }, [hiddenColumns, setHiddenColumns, onViewConfigChange, allColumnsRef]);

  // ── Rename Column (D1 + Notion) ──
  const handleRenameCol = useCallback(async (oldName, newName) => {
    if (!newName.trim() || newName === oldName) { setRenamingCol(null); return; }
    if (!canEditSchema || !pageConfig?.id) { setRenamingCol(null); return; }
    try {
      if (isNotionTable && notionDbId) {
        await updateDatabase(notionDbId, { properties: { [oldName]: { name: newName.trim() } } });
      } else {
        const schemaRes = await getTableSchema(pageConfig.id);
        const cols = (schemaRes?.columns || []).map((c) =>
          c.name === oldName ? { ...c, name: newName.trim() } : c
        );
        await updateTableSchema(pageConfig.id, cols);
      }
      if (onRefresh) onRefresh();
    } catch (err) { console.error("Rename column failed:", err); }
    setRenamingCol(null);
  }, [canEditSchema, isNotionTable, notionDbId, pageConfig?.id, onRefresh]);

  // ── Rename Sub-Column (D1 only) ──
  const handleRenameSubCol = useCallback(async (oldName, newName) => {
    if (!newName.trim() || newName === oldName) { setRenamingSubCol(null); return; }
    if (!canEditSchema || !pageConfig?.id) { setRenamingSubCol(null); return; }
    try {
      const schemaRes = await getTableSchema(pageConfig.id);
      const subs = (schemaRes?.sub_columns || []).map((c) =>
        c.name === oldName ? { ...c, name: newName.trim() } : c
      );
      await updateSubColumnSchema(pageConfig.id, subs);
      if (onRefresh) onRefresh();
    } catch (err) { console.error("Rename sub-column failed:", err); }
    setRenamingSubCol(null);
  }, [canEditSchema, pageConfig?.id, onRefresh]);

  // ── Delete Sub-Column (D1 only) ──
  const handleDeleteSubCol = useCallback(async (colName) => {
    if (!canEditSchema || !pageConfig?.id) return;
    try {
      const schemaRes = await getTableSchema(pageConfig.id);
      const subs = (schemaRes?.sub_columns || []).filter((c) => c.name !== colName);
      await updateSubColumnSchema(pageConfig.id, subs);
      if (onRefresh) onRefresh();
    } catch (err) { console.error("Delete sub-column failed:", err); }
    setSubColCtxMenu(null);
  }, [canEditSchema, pageConfig?.id, onRefresh]);

  // ── Delete Column (D1 + Notion) ──
  const handleDeleteCol = useCallback(async (col) => {
    if (!canEditSchema || !pageConfig?.id) return;
    try {
      if (isNotionTable && notionDbId) {
        await updateDatabase(notionDbId, { properties: { [col]: null } });
      } else {
        const schemaRes = await getTableSchema(pageConfig.id);
        const cols = (schemaRes?.columns || []).filter((c) => c.name !== col);
        await updateTableSchema(pageConfig.id, cols);
      }
      if (onRefresh) onRefresh();
    } catch (err) { console.error("Delete column failed:", err); }
    setColCtxMenu(null);
  }, [canEditSchema, isNotionTable, notionDbId, pageConfig?.id, onRefresh]);

  // ── Change Column Type (D1 only) ──
  const SELECT_LIKE = new Set(["select", "multi_select", "status"]);
  const handleChangeColType = useCallback(async (col, newType) => {
    if (!isD1Table || !pageConfig?.id) return;
    try {
      const schemaRes = await getTableSchema(pageConfig.id);
      const existing = (schemaRes?.columns || []).find((c) => c.name === col);
      const oldType = existing?.type;

      // Warn when changing away from a select-like type that has options
      if (oldType && SELECT_LIKE.has(oldType) && !SELECT_LIKE.has(newType) && existing?.options?.length) {
        const ok = confirm(`Changing "${col}" from ${oldType} to ${newType} will clear its ${existing.options.length} option(s). Continue?`);
        if (!ok) { setColCtxMenu(null); return; }
      }

      const cols = (schemaRes?.columns || []).map((c) => {
        if (c.name !== col) return c;
        const updated = { ...c, type: newType };
        // Clear options when leaving select-like types
        if (SELECT_LIKE.has(oldType) && !SELECT_LIKE.has(newType)) {
          delete updated.options;
        }
        // Initialize empty options when entering select-like types
        if (!SELECT_LIKE.has(oldType) && SELECT_LIKE.has(newType)) {
          updated.options = updated.options || [];
        }
        return updated;
      });
      await updateTableSchema(pageConfig.id, cols);
      if (onRefresh) onRefresh();
    } catch (err) { console.error("Change type failed:", err); }
    setColCtxMenu(null);
  }, [isD1Table, pageConfig?.id, onRefresh]);

  // ── Search Notion Databases (for relation column) ──
  const searchRelationDbs = useCallback(async (q) => {
    if (!isNotionTable) return;
    setDbSearching(true);
    try {
      const results = await searchDatabases(q || "");
      setDbSearchResults(
        results
          .filter((r) => r.id !== notionDbId)
          .slice(0, 15)
          .map((r) => ({
            id: r.id,
            title: r.title?.map((t) => t.plain_text).join("") || "Untitled",
          }))
      );
    } catch (err) {
      console.error("DB search failed:", err);
    } finally {
      setDbSearching(false);
    }
  }, [isNotionTable, notionDbId]);

  // ── Add Column (D1 + Notion) ──
  const handleAddCol = useCallback(async () => {
    if (!addColName.trim() || !canEditSchema || !pageConfig?.id) return;
    if (addColType === "relation" && !addColRelationDb) return;
    if (addColType === "relation" && addColSynced && !addColSyncedName.trim()) return;
    try {
      if (isNotionTable && notionDbId) {
        if (addColType === "relation" && addColRelationDb) {
          const relPayload = {};
          if (addColSynced && addColSyncedName.trim()) {
            relPayload.relation = {
              database_id: addColRelationDb.id,
              type: "dual_property",
              dual_property: { synced_property_name: addColSyncedName.trim() },
            };
          } else {
            relPayload.relation = {
              database_id: addColRelationDb.id,
              type: "single_property",
              single_property: {},
            };
          }
          await updateDatabase(notionDbId, {
            properties: { [addColName.trim()]: relPayload },
          });
        } else {
          const notionType = D1_TO_NOTION_TYPE[addColType] || "rich_text";
          const propDef = { [notionType]: {} };
          if (["select", "multi_select"].includes(addColType)) {
            propDef[notionType] = { options: [] };
          }
          await updateDatabase(notionDbId, { properties: { [addColName.trim()]: propDef } });
        }
      } else {
        const schemaRes = await getTableSchema(pageConfig.id);
        const cols = [...(schemaRes?.columns || []), { id: `col_${Date.now()}`, name: addColName.trim(), type: addColType }];
        await updateTableSchema(pageConfig.id, cols);
      }
      setAddColOpen(false);
      setAddColName("");
      setAddColType("text");
      setAddColRelationDb(null);
      setAddColSynced(true);
      setAddColSyncedName("");
      setDbSearchResults([]);
      setDbSearchQuery("");
      if (onRefresh) onRefresh();
    } catch (err) { console.error("Add column failed:", err); }
  }, [addColName, addColType, addColRelationDb, addColSynced, addColSyncedName, canEditSchema, isNotionTable, isD1Table, notionDbId, pageConfig?.id, onRefresh]);

  // ── Add Sub-Column (D1 only) ──
  const handleAddSubCol = useCallback(async () => {
    if (!addSubColName.trim() || !pageConfig?.id) return;
    try {
      const schemaRes = await getTableSchema(pageConfig.id);
      const existingSub = schemaRes?.sub_columns || [];
      const hasTitleCol = existingSub.some(c => c.type === "title");
      let updatedExisting = existingSub;
      if (!hasTitleCol && existingSub.length > 0) {
        updatedExisting = existingSub.map((c, i) => i === 0 ? { ...c, type: "title" } : c);
      }
      const isFirstCol = existingSub.length === 0;
      const newCol = {
        id: `subcol_${Date.now()}`,
        name: addSubColName.trim(),
        type: isFirstCol ? "title" : addSubColType,
      };
      const newSub = [...updatedExisting, newCol];
      await updateSubColumnSchema(pageConfig.id, newSub);
      setAddSubColOpen(false);
      setAddSubColName("");
      setAddSubColType("text");
      if (onRefresh) onRefresh();
    } catch (err) {
      console.error("Add sub-column failed:", err);
    }
  }, [addSubColName, addSubColType, pageConfig, onRefresh]);

  // ── Column Drag Reorder ──
  const handleColDragStart = useCallback((col, e) => {
    setColDrag({ col, startX: e.clientX, overCol: null });
  }, []);

  useEffect(() => {
    if (!colDrag) return;
    document.body.style.userSelect = "none";
    document.body.style.webkitUserSelect = "none";

    const onMove = (e) => {
      const els = document.querySelectorAll("[data-col-header]");
      let over = null;
      for (const el of els) {
        const rect = el.getBoundingClientRect();
        if (e.clientX >= rect.left && e.clientX <= rect.right) {
          over = el.dataset.colHeader;
          break;
        }
      }
      if (over && over !== colDrag.col) {
        setColDrag((prev) => prev ? { ...prev, overCol: over } : null);
      }
    };
    const onUp = () => {
      if (colDrag.overCol && colDrag.overCol !== colDrag.col && onViewConfigChange) {
        const currentOrder = columns || allColumnsRef.current;
        const fromIdx = currentOrder.indexOf(colDrag.col);
        const toIdx = currentOrder.indexOf(colDrag.overCol);
        if (fromIdx >= 0 && toIdx >= 0) {
          const reordered = [...currentOrder];
          reordered.splice(fromIdx, 1);
          reordered.splice(toIdx, 0, colDrag.col);
          onViewConfigChange({ columns: reordered });
        }
      }
      document.body.style.userSelect = "";
      document.body.style.webkitUserSelect = "";
      setColDrag(null);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.body.style.userSelect = "";
      document.body.style.webkitUserSelect = "";
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, [colDrag, columns, onViewConfigChange, allColumnsRef]);

  // Initialize colWidths from config
  const initColWidths = useCallback((configColWidths) => {
    if (configColWidths && Object.keys(configColWidths).length > 0) {
      setColWidths(configColWidths);
    }
  }, []);

  // Initialize subColWidths from config
  const initSubColWidths = useCallback((configSubColWidths) => {
    if (configSubColWidths && Object.keys(configSubColWidths).length > 0) {
      setSubColWidths(configSubColWidths);
    }
  }, []);

  return {
    // Resize
    colWidths, setColWidths, handleResizeStart, initColWidths,
    subColWidths, setSubColWidths, handleSubResizeStart, initSubColWidths,
    // Context menu
    colCtxMenu, setColCtxMenu, handleColRightClick,
    // Rename
    renamingCol, setRenamingCol, renameValue, setRenameValue, handleRenameCol,
    // Sub-column context menu
    subColCtxMenu, setSubColCtxMenu,
    renamingSubCol, setRenamingSubCol, renameSubValue, setRenameSubValue,
    handleRenameSubCol, handleDeleteSubCol,
    // Delete & type change
    handleDeleteCol, handleChangeColType, handleHideCol,
    // Add column dialog
    addColOpen, setAddColOpen, addColName, setAddColName, addColType, setAddColType,
    addColRelationDb, setAddColRelationDb, addColSynced, setAddColSynced,
    addColSyncedName, setAddColSyncedName,
    dbSearchResults, setDbSearchResults, dbSearchQuery, setDbSearchQuery, dbSearching,
    searchRelationDbs, handleAddCol,
    // Add sub-column dialog
    addSubColOpen, setAddSubColOpen, addSubColName, setAddSubColName,
    addSubColType, setAddSubColType, handleAddSubCol,
    // Drag reorder
    colDrag, setColDrag, handleColDragStart,
    // Column click timer
    colClickTimer,
  };
}
