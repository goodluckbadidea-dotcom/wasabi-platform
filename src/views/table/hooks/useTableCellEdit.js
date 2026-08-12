// ─── useTableCellEdit ───
// Manages inline cell editing state, validation, saving indicators, and error handling.

import { useState, useCallback } from "react";
import { getFieldType } from "../../_viewHelpers.js";
import { buildProp } from "../../../notion/properties.js";
import { getTableSchema, updateTableSchema } from "../../../lib/api.js";
import { assignOptionColor } from "../../../lib/dataSource.js";
import { globalToast } from "../../../context/ToastContext.jsx";
import { updateDatabase } from "../../../notion/client.js";

export default function useTableCellEdit({
  schema, onUpdate, focusedCell, setFocusedCell, displayListLength,
  canEditSchema, canManageOptions, isNotionTable, notionDbId, pageConfig, onRefresh,
}) {
  const [editCell, setEditCell] = useState(null); // { pageId, field }
  const [savingCells, setSavingCells] = useState({}); // { "pageId:field": true }
  const [failedCells, setFailedCells] = useState({}); // { "pageId:field": "error message" }
  const [initialChar, setInitialChar] = useState(""); // printable char that triggered cell edit

  // Inline edit commit — with saving indicator + error handling
  const handleEditCommit = useCallback(async (pageId, field, value) => {
    const type = getFieldType(schema, field);
    if (!type || !onUpdate) return;

    // Validate before committing
    if (type === "email" && value) {
      const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailPattern.test(value)) {
        setFailedCells((prev) => ({ ...prev, [`${pageId}:${field}`]: "Invalid email" }));
        setEditCell(null);
        setTimeout(() => setFailedCells((prev) => { const n = { ...prev }; delete n[`${pageId}:${field}`]; return n; }), 3000);
        return;
      }
    }
    if (type === "url" && value) {
      try { new URL(value.startsWith("http") ? value : `https://${value}`); } catch {
        setFailedCells((prev) => ({ ...prev, [`${pageId}:${field}`]: "Invalid URL" }));
        setEditCell(null);
        setTimeout(() => setFailedCells((prev) => { const n = { ...prev }; delete n[`${pageId}:${field}`]; return n; }), 3000);
        return;
      }
    }

    const propPayload = buildProp(type, value);
    if (propPayload !== undefined) {
      const cellKey = `${pageId}:${field}`;
      setSavingCells((prev) => ({ ...prev, [cellKey]: true }));
      setFailedCells((prev) => { const n = { ...prev }; delete n[cellKey]; return n; });
      try {
        await onUpdate(pageId, field, propPayload);
      } catch (err) {
        console.error("Inline edit failed:", err);
        setFailedCells((prev) => ({ ...prev, [cellKey]: err.message || "Save failed" }));
        setTimeout(() => setFailedCells((prev) => { const n = { ...prev }; delete n[cellKey]; return n; }), 4000);
      } finally {
        setSavingCells((prev) => { const n = { ...prev }; delete n[cellKey]; return n; });
      }
    }
    setEditCell(null);
    setInitialChar("");
    // Advance focus down after commit (Notion behavior)
    if (focusedCell) {
      setFocusedCell((prev) =>
        prev && prev.row < displayListLength - 1
          ? { row: prev.row + 1, col: prev.col }
          : prev
      );
    }
  }, [schema, onUpdate, focusedCell, displayListLength, setFocusedCell]);

  // Create option handler for SelectPicker/MultiSelectPicker (adds to D1 schema)
  // `canManageOptions` (permission) is checked alongside `canEditSchema`
  // (source type). Adding an option is a schema write, which the worker gates
  // behind `owner` — without the permission check this fires a request that
  // always 403s.
  const handleCreateOption = useCallback(async (fieldName, newOptionName) => {
    if (!canEditSchema || canManageOptions === false || !pageConfig?.id) return;
    try {
      if (isNotionTable && notionDbId) {
        // Notion handles option auto-creation via page update
      } else {
        const schemaRes = await getTableSchema(pageConfig.id);
        const cols = (schemaRes?.columns || []).map((c) => {
          if (c.name === fieldName) {
            const existing = c.options || [];
            if (!existing.some((o) => (typeof o === "string" ? o : o.name) === newOptionName)) {
              return { ...c, options: [...existing, { name: newOptionName, color: assignOptionColor(existing.length) }] };
            }
          }
          return c;
        });
        await updateTableSchema(pageConfig.id, cols);
      }
    } catch (err) {
      console.error("Create option failed:", err);
      globalToast(
        err?.status === 403
          ? "You don't have permission to add options to this column."
          : `Could not add option: ${err?.message || "unknown error"}`,
        "error"
      );
      throw err;  // don't let the caller commit a value with no backing option
    }
  }, [canEditSchema, canManageOptions, isNotionTable, notionDbId, pageConfig?.id]);

  // Checkbox direct toggle
  const handleCheckboxToggle = useCallback((pageId, field, currentValue) => {
    const newVal = !currentValue;
    const propPayload = buildProp("checkbox", newVal);
    if (propPayload !== undefined && onUpdate) {
      onUpdate(pageId, field, propPayload);
    }
  }, [onUpdate]);

  return {
    editCell, setEditCell,
    savingCells, failedCells,
    initialChar, setInitialChar,
    handleEditCommit, handleCreateOption, handleCheckboxToggle,
  };
}
