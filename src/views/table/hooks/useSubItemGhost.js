// ─── useSubItemGhost ───
// Manages sub-item ghost row state for inline sub-item creation.

import { useState, useRef, useEffect, useCallback } from "react";
import { getFieldType } from "../../_viewHelpers.js";
import { buildProp } from "../../../notion/properties.js";

export default function useSubItemGhost({ onCreate, pageConfig, schema, subSchema, subTitleField, expandedRows, toggleExpand }) {
  const [subItemGhostParent, setSubItemGhostParent] = useState(null);
  const [subItemGhostValues, setSubItemGhostValues] = useState({});
  const [subItemGhostSaving, setSubItemGhostSaving] = useState(false);
  const subItemGhostActive = useRef(false);
  const subGhostRef = useRef(null);

  const handleCreateSubItem = useCallback((parentId) => {
    if (!onCreate || !pageConfig?.id) return;
    setSubItemGhostParent(parentId);
    setSubItemGhostValues({});
    subItemGhostActive.current = false;
    if (!expandedRows.has(parentId)) toggleExpand(parentId);
  }, [onCreate, pageConfig, expandedRows, toggleExpand]);

  const handleSubItemGhostCommit = useCallback(async () => {
    if (!onCreate || !pageConfig?.id || !subItemGhostParent) return;
    const titleField = subTitleField || schema?.title?.name;
    if (titleField && !subItemGhostValues[titleField]?.toString().trim()) {
      setSubItemGhostParent(null);
      setSubItemGhostValues({});
      subItemGhostActive.current = false;
      return;
    }
    const hasAnyValue = Object.values(subItemGhostValues).some((v) => v !== "" && v !== null && v !== undefined);
    if (!hasAnyValue) {
      setSubItemGhostParent(null);
      subItemGhostActive.current = false;
      return;
    }
    setSubItemGhostSaving(true);
    try {
      const effectiveSchema = subSchema || schema;
      const properties = {};
      for (const [fieldName, val] of Object.entries(subItemGhostValues)) {
        if (val === "" || val === null || val === undefined) continue;
        const type = getFieldType(effectiveSchema, fieldName);
        if (!type) continue;
        const prop = buildProp(type, val);
        if (prop !== undefined) properties[fieldName] = prop;
      }
      await onCreate(pageConfig.id, properties, { parentRowId: subItemGhostParent });
      setSubItemGhostValues({});
      subItemGhostActive.current = false;
    } catch (err) {
      console.error("Create sub-item failed:", err);
    } finally {
      setSubItemGhostSaving(false);
    }
  }, [onCreate, pageConfig, subItemGhostParent, subItemGhostValues, schema, subSchema, subTitleField]);

  // Dismiss on click-outside
  useEffect(() => {
    if (!subItemGhostParent) return;
    const handleClickOutside = (e) => {
      if (subGhostRef.current && !subGhostRef.current.contains(e.target)) {
        if (e.target.closest('[data-sub-item-trigger]')) return;
        setSubItemGhostParent(null);
        setSubItemGhostValues({});
        subItemGhostActive.current = false;
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [subItemGhostParent]);

  return {
    subItemGhostParent, setSubItemGhostParent,
    subItemGhostValues, setSubItemGhostValues,
    subItemGhostSaving, subItemGhostActive,
    subGhostRef,
    handleCreateSubItem, handleSubItemGhostCommit,
  };
}
