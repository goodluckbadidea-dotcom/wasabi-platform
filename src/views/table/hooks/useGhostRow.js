// ─── useGhostRow ───
// Manages parent ghost row state for inline new-record creation.

import { useState, useRef, useCallback } from "react";
import { getFieldType } from "../../_viewHelpers.js";
import { buildProp } from "../../../notion/properties.js";

export default function useGhostRow({ onCreate, targetDatabaseId, schema, columns }) {
  const [ghostValues, setGhostValues] = useState({});
  const [ghostSaving, setGhostSaving] = useState(false);
  const [ghostError, setGhostError] = useState(null);
  const ghostActive = useRef(false);

  const ghostSetVal = useCallback((col, val) => {
    ghostActive.current = true;
    setGhostValues((p) => ({ ...p, [col]: val }));
  }, []);

  const ghostKeyDown = useCallback((e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleGhostCommit(); }
    if (e.key === "Escape") { setGhostValues({}); ghostActive.current = false; e.target.blur(); }
  }, []); // handleGhostCommit is stable via ref pattern below

  const handleGhostCommit = useCallback(async () => {
    if (!onCreate || !targetDatabaseId) return;
    const titleField = schema?.title?.name;
    // Must have at least a title or some value
    if (titleField && !ghostValues[titleField]?.toString().trim()) {
      setGhostValues({});
      ghostActive.current = false;
      return;
    }
    const hasAnyValue = Object.values(ghostValues).some((v) => v !== "" && v !== null && v !== undefined);
    if (!hasAnyValue) {
      ghostActive.current = false;
      return;
    }

    setGhostSaving(true);
    setGhostError(null);
    try {
      const properties = {};
      for (const [fieldName, val] of Object.entries(ghostValues)) {
        if (val === "" || val === null || val === undefined) continue;
        const type = getFieldType(schema, fieldName);
        if (!type) continue;
        const prop = buildProp(type, val);
        if (prop !== undefined) properties[fieldName] = prop;
      }
      await onCreate(targetDatabaseId, properties);
      setGhostValues({});
      ghostActive.current = false;
    } catch (err) {
      console.error("Ghost row create failed:", err);
      setGhostError(err.message || "Create failed");
      setTimeout(() => setGhostError(null), 4000);
    } finally {
      setGhostSaving(false);
    }
  }, [onCreate, targetDatabaseId, schema, ghostValues]);

  // Patch ghostKeyDown to use latest handleGhostCommit
  const ghostKeyDownPatched = useCallback((e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleGhostCommit(); }
    if (e.key === "Escape") { setGhostValues({}); ghostActive.current = false; e.target.blur(); }
  }, [handleGhostCommit]);

  return {
    ghostValues, setGhostValues,
    ghostSaving, ghostError, ghostActive,
    ghostSetVal, ghostKeyDown: ghostKeyDownPatched,
    handleGhostCommit,
  };
}
