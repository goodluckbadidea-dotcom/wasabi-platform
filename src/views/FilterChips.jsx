// ─── Dynamic Filter Chips ───
// Renders clickable pill chips for select, multi_select, status, and people fields.
// Multi-select OR logic within a field, AND across fields.
// Persists active filters per page.

import React, { useState, useEffect, useMemo, useCallback } from "react";
import { C, FONT, RADIUS, getSolidPillColor } from "../design/tokens.js";
import { IconClose } from "../design/icons.jsx";

// ── Styles ──
const cs = {
  container: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    padding: "8px 16px",
    borderBottom: `1px solid ${C.edgeLine}`,
    background: C.darkSurf,
    flexShrink: 0,
  },
  row: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    overflowX: "auto",
    paddingBottom: 2,
    scrollbarWidth: "none",
  },
  fieldLabel: {
    fontSize: 10,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    color: C.darkMuted,
    whiteSpace: "nowrap",
    flexShrink: 0,
    marginRight: 2,
  },
  chip: (active, fillColor, textColor) => ({
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    padding: active ? "3px 10px" : "3px 10px",
    borderRadius: RADIUS.pill,
    fontSize: 11,
    fontWeight: 600,
    fontFamily: FONT,
    cursor: "pointer",
    transition: "all 0.15s",
    whiteSpace: "nowrap",
    flexShrink: 0,
    letterSpacing: "0.02em",
    // Active: solid fill
    background: active ? fillColor : "transparent",
    color: active ? textColor : C.darkMuted,
    border: active ? "none" : `1px solid ${C.darkBorder}`,
    opacity: active ? 1 : 0.75,
  }),
  clearBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    padding: "3px 10px",
    borderRadius: RADIUS.pill,
    fontSize: 11,
    fontWeight: 500,
    fontFamily: FONT,
    cursor: "pointer",
    background: "transparent",
    color: C.darkMuted,
    border: `1px solid ${C.darkBorder}`,
    whiteSpace: "nowrap",
    flexShrink: 0,
    transition: "all 0.15s",
  },
};

// ── Extract chip-eligible fields from schema ──
function getChipFields(schema, data) {
  if (!schema) return [];
  const fields = [];

  // Statuses
  for (const f of schema.statuses) {
    if (f.options?.length > 0) {
      fields.push({
        name: f.name,
        type: "status",
        options: f.options,
      });
    }
  }

  // Selects
  for (const f of schema.selects) {
    if (f.options?.length > 0) {
      fields.push({
        name: f.name,
        type: "select",
        options: f.options,
      });
    }
  }

  // Multi-selects
  for (const f of schema.multiSelects) {
    if (f.options?.length > 0) {
      fields.push({
        name: f.name,
        type: "multi_select",
        options: f.options,
      });
    }
  }

  // People — collect unique names from data
  for (const f of schema.people) {
    const names = new Set();
    for (const page of data) {
      const val = page.properties?.[f.name];
      if (val?.people) {
        for (const p of val.people) {
          const name = p.name || p.person?.email || p.id;
          if (name) names.add(name);
        }
      }
    }
    if (names.size > 0) {
      fields.push({
        name: f.name,
        type: "people",
        options: [...names].map((n) => ({ name: n, color: "blue" })),
      });
    }
  }

  return fields;
}

// ── Main Component ──
export default function FilterChips({
  schema,
  data = [],
  activeFilters = {},     // { fieldName: ["value1", "value2"] }
  onFilterChange,         // (newFilters) => void
}) {
  const chipFields = useMemo(() => getChipFields(schema, data), [schema, data]);

  const hasActiveFilters = useMemo(
    () => Object.values(activeFilters).some((arr) => arr && arr.length > 0),
    [activeFilters]
  );

  // Toggle a chip value for a field
  const toggleChip = useCallback(
    (fieldName, value) => {
      const current = activeFilters[fieldName] || [];
      let updated;
      if (current.includes(value)) {
        updated = current.filter((v) => v !== value);
      } else {
        updated = [...current, value];
      }

      const newFilters = { ...activeFilters };
      if (updated.length === 0) {
        delete newFilters[fieldName];
      } else {
        newFilters[fieldName] = updated;
      }
      onFilterChange(newFilters);
    },
    [activeFilters, onFilterChange]
  );

  // Clear all filters
  const clearAll = useCallback(() => {
    onFilterChange({});
  }, [onFilterChange]);

  if (chipFields.length === 0) return null;

  return (
    <div style={cs.container}>
      {chipFields.map((field) => {
        const activeValues = activeFilters[field.name] || [];
        const optionNames = field.options.map((o) => o.name);

        return (
          <div key={field.name} style={cs.row}>
            <span style={cs.fieldLabel}>{field.name}</span>
            {field.options.map((opt) => {
              const isActive = activeValues.includes(opt.name);
              const { fill, text } = getSolidPillColor(
                opt.name,
                optionNames,
                field.options
              );

              return (
                <span
                  key={opt.name}
                  style={cs.chip(isActive, fill, text)}
                  onClick={() => toggleChip(field.name, opt.name)}
                  onMouseEnter={(e) => {
                    if (!isActive) e.currentTarget.style.opacity = "1";
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) e.currentTarget.style.opacity = "0.75";
                  }}
                >
                  {isActive && "✓ "}
                  {opt.name}
                </span>
              );
            })}
          </div>
        );
      })}

      {hasActiveFilters && (
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <span
            style={cs.clearBtn}
            onClick={clearAll}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = C.darkText;
              e.currentTarget.style.borderColor = C.darkMuted;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = C.darkMuted;
              e.currentTarget.style.borderColor = C.darkBorder;
            }}
          >
            <IconClose size={8} color={C.darkMuted} /> Clear filters
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * Apply chip filters to a data array.
 * OR within a field, AND across fields.
 */
export function applyChipFilters(data, activeFilters, schema) {
  if (!activeFilters || Object.keys(activeFilters).length === 0) return data;

  return data.filter((page) => {
    for (const [fieldName, values] of Object.entries(activeFilters)) {
      if (!values || values.length === 0) continue;

      const prop = page.properties?.[fieldName];
      if (!prop) return false;

      let pageValue = null;

      switch (prop.type) {
        case "select":
          pageValue = prop.select?.name;
          if (!values.includes(pageValue)) return false;
          break;

        case "status":
          pageValue = prop.status?.name;
          if (!values.includes(pageValue)) return false;
          break;

        case "multi_select":
          pageValue = (prop.multi_select || []).map((o) => o.name);
          // At least one selected value must appear in the record
          if (!values.some((v) => pageValue.includes(v))) return false;
          break;

        case "people":
          pageValue = (prop.people || []).map(
            (p) => p.name || p.person?.email || p.id
          );
          if (!values.some((v) => pageValue.includes(v))) return false;
          break;

        default:
          break;
      }
    }
    return true;
  });
}
