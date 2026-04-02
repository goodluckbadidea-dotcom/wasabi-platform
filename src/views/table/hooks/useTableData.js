// ─── useTableData Hook ───
// Data pipeline: filterable fields, debounced search, filter+search+sort processing, tree sort fn.

import { useState, useEffect, useMemo } from "react";
import { debounce } from "../../../utils/helpers.js";
import { applyChipFilters } from "../../FilterChips.jsx";
import { getFieldType, readField, searchableText } from "../../_viewHelpers.js";

export default function useTableData({
  data, schema, columns, chipFilters, filters, search, sortField, sortDir,
}) {
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

  // Filter + search + sort pipeline
  const processedData = useMemo(() => {
    // Separate sub-items before filtering — they don't have parent column values
    // and would be incorrectly excluded by chip filters, dropdown filters, and search
    const subItems = data.filter(r => r._parentRowId);
    let rows = data.filter(r => !r._parentRowId);

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

    // Re-attach sub-items whose parent survived filtering
    const survivingIds = new Set(rows.map(r => r.id));
    const keptSubs = subItems.filter(r => survivingIds.has(r._parentRowId));

    return [...rows, ...keptSubs];
  }, [data, filters, chipFilters, debouncedSearch, sortField, sortDir, columns, schema]);

  // Tree sort function (used by useTreeData)
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

  return { filterableFields, processedData, treeSortFn };
}
