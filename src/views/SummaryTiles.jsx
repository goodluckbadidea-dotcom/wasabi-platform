// ─── Summary Tiles View ───
// Dashboard metric widgets: large numbers with labels.
// Aggregations: count, sum, avg, min, max, countWhere.

import React, { useMemo } from "react";
import { C, FONT, RADIUS, getStatusColor } from "../design/tokens.js";
import { readField, getFieldType, getFieldOptions, computeAggregation, resolveField } from "./_viewHelpers.js";

/**
 * Auto-detect tiles from schema when none are configured.
 */
function autoDetectTiles(schema, data) {
  if (!schema) return [];
  const tiles = [{ label: "Total Records", aggregation: "count" }];

  // Sum tile for each number field
  for (const f of schema.numbers || []) {
    tiles.push({ label: `Total ${f.name}`, field: f.name, aggregation: "sum" });
  }

  // CountWhere tiles for the first status/select field
  const statusField = (schema.statuses?.[0]) || (schema.selects?.[0]);
  if (statusField && statusField.options) {
    for (const opt of statusField.options.slice(0, 4)) {
      tiles.push({
        label: opt.name,
        field: statusField.name,
        aggregation: "countWhere",
        filterValue: opt.name,
      });
    }
  }

  return tiles;
}

/**
 * Format a number for display (add commas, limit decimals).
 */
function formatNumber(n) {
  if (n === null || n === undefined) return "0";
  if (Number.isInteger(n)) return n.toLocaleString();
  return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

export default function SummaryTiles({ data = [], schema, config = {} }) {
  const tiles = useMemo(() => {
    const configured = config.tiles && config.tiles.length > 0 ? config.tiles : autoDetectTiles(schema, data);
    return configured.map((tile) => {
      const value = computeAggregation(data, schema, tile.field, tile.aggregation, tile.filterValue);
      return { ...tile, value };
    });
  }, [data, schema, config.tiles]);

  if (!schema) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: C.darkMuted, fontSize: 14 }}>
        Loading schema...
      </div>
    );
  }

  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
      gap: 16,
      padding: 20,
      fontFamily: FONT,
    }}>
      {tiles.map((tile, i) => {
        // Choose color based on aggregation type
        let numColor = C.darkText;
        if (tile.aggregation === "count") numColor = C.accent;
        if (tile.aggregation === "countWhere" && tile.field && schema) {
          const opts = getFieldOptions(schema, tile.field);
          const optNames = opts.map((o) => o.name);
          numColor = getStatusColor(tile.filterValue, optNames);
        }

        return (
          <div
            key={i}
            style={{
              background: C.darkSurf,
              border: `1px solid ${C.darkBorder}`,
              borderRadius: RADIUS.xl,
              padding: "24px 20px",
              display: "flex",
              flexDirection: "column",
              gap: 8,
              animation: `fadeUp 0.3s ease ${i * 0.05}s both`,
            }}
          >
            <span style={{
              fontSize: 28,
              fontWeight: 700,
              color: numColor,
              fontVariantNumeric: "tabular-nums",
              letterSpacing: "-0.02em",
              lineHeight: 1,
            }}>
              {formatNumber(tile.value)}
            </span>
            <span style={{
              fontSize: 11,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: C.darkMuted,
              lineHeight: 1.3,
            }}>
              {tile.label}
            </span>
            {tile.aggregation !== "count" && tile.aggregation !== "countWhere" && tile.field && (
              <span style={{ fontSize: 10, color: C.darkMuted, opacity: 0.6 }}>
                {tile.aggregation} of {tile.field}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
