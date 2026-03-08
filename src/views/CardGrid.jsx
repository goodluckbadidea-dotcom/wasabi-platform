// ─── Card Grid View ───
// Schema-agnostic card layout with search, filtering, and badge pills.

import React, { useState, useMemo, useCallback } from "react";
import { C, FONT, RADIUS, getStatusColor } from "../design/tokens.js";
import { readField, getFieldType, getFieldOptions, getOptionNames, displayValue, searchableText, resolveField } from "./_viewHelpers.js";
import { cellStyles, CellDisplay } from "./_CellComponents.jsx";

export default function CardGrid({ data = [], schema, config = {}, onUpdate, onRefresh }) {
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState({});

  // Resolve fields from config or auto-detect
  const titleField = resolveField(schema, config.titleField, ["title"]);
  const badgeField = resolveField(schema, config.badgeField, ["statuses", "selects"]);
  // When visibleFields is set, split by type: numbers → metricFields, rest → bodyFields
  const visibleFields = config.visibleFields;
  const bodyFields = (visibleFields && visibleFields.length > 0)
    ? visibleFields.filter((f) => getFieldType(schema, f) !== "number")
    : config.bodyFields || (() => {
        if (!schema) return [];
        const fields = [];
        for (const f of schema.richTexts || []) { if (fields.length < 2) fields.push(f.name); }
        for (const f of schema.dates || []) { if (fields.length < 3) fields.push(f.name); }
        return fields;
      })();
  const metricFields = (visibleFields && visibleFields.length > 0)
    ? visibleFields.filter((f) => getFieldType(schema, f) === "number")
    : config.metricFields || (() => {
        if (!schema) return [];
        return (schema.numbers || []).slice(0, 2).map((f) => f.name);
      })();

  // Filter-able select/status fields
  const filterFields = useMemo(() => {
    if (!schema) return [];
    return [...(schema.statuses || []), ...(schema.selects || [])].filter(
      (f) => f.options && f.options.length > 0 && f.options.length <= 20
    );
  }, [schema]);

  // Process data: filter + search
  const processedData = useMemo(() => {
    let result = data;

    // Apply filters
    for (const [field, value] of Object.entries(filters)) {
      if (value) {
        result = result.filter((page) => readField(page, field) === value);
      }
    }

    // Apply search
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((page) => {
        const allFields = [titleField, badgeField, ...bodyFields, ...metricFields].filter(Boolean);
        return allFields.some((f) => {
          const val = readField(page, f);
          const type = getFieldType(schema, f);
          return searchableText(val, type).includes(q);
        });
      });
    }

    // Apply sort
    if (config.sortField) {
      const dir = config.sortDir || "asc";
      result = [...result].sort((a, b) => {
        const va = readField(a, config.sortField);
        const vb = readField(b, config.sortField);
        if (va == null && vb == null) return 0;
        if (va == null) return 1;
        if (vb == null) return -1;
        const cmp = typeof va === "number" && typeof vb === "number"
          ? va - vb
          : String(va).localeCompare(String(vb));
        return dir === "desc" ? -cmp : cmp;
      });
    }

    return result;
  }, [data, search, filters, titleField, badgeField, bodyFields, metricFields, schema, config.sortField, config.sortDir]);

  if (!schema) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: C.darkMuted, fontSize: 14, fontFamily: FONT }}>
        Loading schema...
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", fontFamily: FONT }}>
      {/* Toolbar */}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "12px 20px",
        borderBottom: `1px solid ${C.edgeLine}`,
        flexWrap: "wrap",
      }}>
        {/* Search */}
        <div style={{
          display: "flex",
          alignItems: "center",
          background: C.darkSurf2,
          border: `1px solid ${C.darkBorder}`,
          borderRadius: RADIUS.md,
          padding: "0 10px",
          height: 34,
          minWidth: 180,
          flex: "0 1 240px",
        }}>
          <span style={{ fontSize: 13, color: C.darkMuted, flexShrink: 0 }}>&#x1F50D;</span>
          <input
            style={{
              flex: 1, border: "none", outline: "none", background: "transparent",
              fontFamily: FONT, fontSize: 13, color: C.darkText, padding: "0 6px", height: "100%",
            }}
            placeholder="Search cards..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <span
              style={{ fontSize: 14, color: C.darkMuted, cursor: "pointer", padding: "0 2px" }}
              onClick={() => setSearch("")}
            >&times;</span>
          )}
        </div>

        {/* Filter dropdowns */}
        {filterFields.map((f) => (
          <select
            key={f.name}
            value={filters[f.name] || ""}
            onChange={(e) => setFilters((prev) => ({ ...prev, [f.name]: e.target.value || undefined }))}
            style={{
              background: C.darkSurf2,
              border: `1px solid ${C.darkBorder}`,
              borderRadius: RADIUS.md,
              padding: "6px 10px",
              fontSize: 12,
              fontFamily: FONT,
              color: C.darkMuted,
              cursor: "pointer",
              appearance: "none",
              outline: "none",
              minWidth: 110,
              height: 34,
            }}
          >
            <option value="">{f.name}</option>
            {f.options.map((opt) => (
              <option key={opt.name} value={opt.name}>{opt.name}</option>
            ))}
          </select>
        ))}

        {/* Record count */}
        <span style={{ fontSize: 12, color: C.darkMuted, marginLeft: "auto" }}>
          {processedData.length === data.length
            ? `${data.length} records`
            : `${processedData.length} of ${data.length}`}
        </span>
      </div>

      {/* Card Grid */}
      <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
        {processedData.length === 0 ? (
          <div style={{ textAlign: "center", padding: 64, color: C.darkMuted, fontSize: 14 }}>
            No records found.
          </div>
        ) : (
          <div style={{
            display: "grid",
            gridTemplateColumns: config.cardSize === "compact"
              ? "repeat(auto-fill, minmax(220px, 1fr))"
              : "repeat(auto-fill, minmax(300px, 1fr))",
            gap: 16,
          }}>
            {processedData.map((page, idx) => {
              const title = titleField ? readField(page, titleField) : "Untitled";
              const badge = badgeField ? readField(page, badgeField) : null;
              const badgeType = badgeField ? getFieldType(schema, badgeField) : null;

              // Badge color
              let badgeColor = C.darkMuted;
              if (badge && badgeField) {
                const optNames = getOptionNames(schema, badgeField);
                badgeColor = getStatusColor(badge, optNames);
              }

              return (
                <div
                  key={page.id}
                  style={{
                    background: C.darkSurf,
                    border: `1px solid ${C.darkBorder}`,
                    borderRadius: RADIUS.xl,
                    padding: 0,
                    overflow: "hidden",
                    transition: "border-color 0.15s",
                    animation: `fadeUp 0.3s ease ${idx * 0.03}s both`,
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = C.accent + "66"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = C.darkBorder; }}
                >
                  {/* Badge strip */}
                  {badge && (
                    <div style={{
                      background: badgeColor + "18",
                      borderBottom: `1px solid ${badgeColor}30`,
                      padding: "6px 16px",
                      display: "flex",
                      alignItems: "center",
                    }}>
                      <span style={cellStyles.pill(badgeColor)}>{badge}</span>
                    </div>
                  )}

                  {/* Card body */}
                  <div style={{ padding: config.cardSize === "compact" ? "10px 12px 12px" : "14px 16px 16px" }}>
                    {/* Title */}
                    <div style={{
                      fontSize: 15,
                      fontWeight: 600,
                      color: C.darkText,
                      marginBottom: 10,
                      lineHeight: 1.35,
                    }}>
                      {title || "Untitled"}
                    </div>

                    {/* Body fields */}
                    {bodyFields.map((fieldName) => {
                      const val = readField(page, fieldName);
                      const type = getFieldType(schema, fieldName);
                      if (val === null || val === undefined) return null;
                      return (
                        <div key={fieldName} style={{ marginBottom: 6 }}>
                          <div style={{
                            fontSize: 10,
                            fontWeight: 600,
                            textTransform: "uppercase",
                            letterSpacing: "0.06em",
                            color: C.darkMuted,
                            marginBottom: 2,
                          }}>
                            {fieldName}
                          </div>
                          <div style={{ fontSize: 13, color: C.darkText, lineHeight: 1.45 }}>
                            <CellDisplay value={val} type={type} fieldName={fieldName} schema={schema} />
                          </div>
                        </div>
                      );
                    })}

                    {/* Metric fields */}
                    {metricFields.length > 0 && (
                      <div style={{
                        display: "flex",
                        gap: 16,
                        marginTop: 10,
                        paddingTop: 10,
                        borderTop: `1px solid ${C.edgeLine}`,
                      }}>
                        {metricFields.map((fieldName) => {
                          const val = readField(page, fieldName);
                          return (
                            <div key={fieldName} style={{ flex: 1 }}>
                              <div style={{
                                fontSize: 10,
                                fontWeight: 600,
                                textTransform: "uppercase",
                                letterSpacing: "0.06em",
                                color: C.darkMuted,
                                marginBottom: 2,
                              }}>
                                {fieldName}
                              </div>
                              <div style={{
                                fontSize: 16,
                                fontWeight: 600,
                                color: C.accent,
                                fontVariantNumeric: "tabular-nums",
                              }}>
                                {val !== null && val !== undefined ? val : "--"}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
