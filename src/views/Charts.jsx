// ─── Charts View ───
// Bar, Pie (donut), and Line charts. Pure SVG, no external libraries.

import React, { useState, useMemo } from "react";
import { C, FONT, RADIUS, getStatusColor } from "../design/tokens.js";
import { readField, getFieldType, getFieldOptions, getOptionNames, computeAggregation, resolveField } from "./_viewHelpers.js";

const CHART_TYPES = ["bar", "pie", "line"];

export default function Charts({ data = [], schema, config = {} }) {
  const [chartType, setChartType] = useState(config.chartType || "bar");
  const [hoverIdx, setHoverIdx] = useState(null);

  // Resolve fields
  const categoryField = resolveField(schema, config.categoryField, ["statuses", "selects"]);
  const valueField = resolveField(schema, config.valueField, ["numbers"]);
  const aggregation = config.aggregation || (valueField ? "sum" : "count");

  // Get category options for colors
  const categoryOptions = useMemo(() => {
    if (!categoryField || !schema) return [];
    return getFieldOptions(schema, categoryField);
  }, [categoryField, schema]);
  const optNames = categoryOptions.map((o) => o.name);

  // Compute chart data: group by category, aggregate values
  const chartData = useMemo(() => {
    if (!data.length || !categoryField) return [];

    // Group by category
    const groups = {};
    for (const page of data) {
      const cat = readField(page, categoryField) || "Unknown";
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(page);
    }

    // Aggregate each group
    const result = Object.entries(groups).map(([category, pages]) => {
      let value = 0;
      if (aggregation === "count") {
        value = pages.length;
      } else if (valueField) {
        const nums = pages
          .map((p) => readField(p, valueField))
          .filter((v) => typeof v === "number");
        if (aggregation === "sum") value = nums.reduce((a, b) => a + b, 0);
        else if (aggregation === "avg") value = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
        else if (aggregation === "min") value = nums.length ? Math.min(...nums) : 0;
        else if (aggregation === "max") value = nums.length ? Math.max(...nums) : 0;
        else value = nums.length;
      } else {
        value = pages.length;
      }

      const color = getStatusColor(category, optNames);
      return { category, value, color, count: pages.length };
    });

    // Sort by value descending for bar/pie
    if (chartType !== "line") {
      result.sort((a, b) => b.value - a.value);
    }

    return result;
  }, [data, categoryField, valueField, aggregation, optNames, chartType]);

  const total = chartData.reduce((s, d) => s + d.value, 0);
  const maxValue = Math.max(...chartData.map((d) => d.value), 1);

  if (!schema) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: C.darkMuted, fontSize: 14, fontFamily: FONT }}>
        Loading schema...
      </div>
    );
  }

  if (!categoryField) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: C.darkMuted, fontSize: 14, fontFamily: FONT }}>
        No select or status field found for chart categories.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", fontFamily: FONT }}>
      {/* Toolbar: chart type switcher */}
      <div style={{
        display: "flex",
        alignItems: "center",
        padding: "10px 20px",
        borderBottom: `1px solid ${C.edgeLine}`,
        gap: 6,
      }}>
        {CHART_TYPES.map((type) => (
          <button
            key={type}
            onClick={() => setChartType(type)}
            style={{
              padding: "6px 14px",
              borderRadius: RADIUS.pill,
              border: "none",
              cursor: "pointer",
              fontSize: 12,
              fontWeight: 600,
              fontFamily: FONT,
              textTransform: "capitalize",
              background: chartType === type ? C.accent : C.darkSurf2,
              color: chartType === type ? "#fff" : C.darkMuted,
              transition: "background 0.15s, color 0.15s",
            }}
          >
            {type}
          </button>
        ))}
        <span style={{ fontSize: 12, color: C.darkMuted, marginLeft: "auto" }}>
          {aggregation} {valueField ? `of ${valueField}` : ""} by {categoryField}
        </span>
      </div>

      {/* Chart area */}
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 24, overflow: "auto" }}>
        {chartData.length === 0 ? (
          <div style={{ color: C.darkMuted, fontSize: 14 }}>No data to display.</div>
        ) : chartType === "bar" ? (
          <BarChart data={chartData} maxValue={maxValue} hoverIdx={hoverIdx} setHoverIdx={setHoverIdx} />
        ) : chartType === "pie" ? (
          <PieChart data={chartData} total={total} hoverIdx={hoverIdx} setHoverIdx={setHoverIdx} />
        ) : (
          <LineChart data={chartData} maxValue={maxValue} hoverIdx={hoverIdx} setHoverIdx={setHoverIdx} />
        )}
      </div>
    </div>
  );
}


// ─── Bar Chart ───

function BarChart({ data, maxValue, hoverIdx, setHoverIdx }) {
  const barH = 28;
  const gap = 10;
  const labelW = 120;
  const chartW = 500;
  const svgH = data.length * (barH + gap) + gap;

  return (
    <div style={{ display: "flex", flexDirection: "column", width: "100%", maxWidth: 700 }}>
      <svg width="100%" viewBox={`0 0 ${labelW + chartW + 60} ${svgH}`} style={{ overflow: "visible" }}>
        {data.map((d, i) => {
          const y = i * (barH + gap) + gap;
          const barW = Math.max(4, (d.value / maxValue) * chartW);
          const isHover = hoverIdx === i;

          return (
            <g key={i}
              onMouseEnter={() => setHoverIdx(i)}
              onMouseLeave={() => setHoverIdx(null)}
              style={{ cursor: "pointer" }}
            >
              {/* Label */}
              <text
                x={labelW - 8}
                y={y + barH / 2 + 1}
                textAnchor="end"
                fontSize={12}
                fill={isHover ? C.darkText : C.darkMuted}
                fontFamily={FONT}
                dominantBaseline="middle"
              >
                {d.category.length > 15 ? d.category.slice(0, 15) + "…" : d.category}
              </text>

              {/* Bar */}
              <rect
                x={labelW}
                y={y}
                width={barW}
                height={barH}
                rx={barH / 2}
                fill={d.color}
                opacity={isHover ? 1 : 0.8}
                style={{ transition: "opacity 0.15s" }}
              />

              {/* Value */}
              <text
                x={labelW + barW + 8}
                y={y + barH / 2 + 1}
                fontSize={12}
                fill={C.darkText}
                fontFamily={FONT}
                dominantBaseline="middle"
                fontWeight={600}
              >
                {Number.isInteger(d.value) ? d.value.toLocaleString() : d.value.toFixed(1)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}


// ─── Pie Chart (Donut) ───

function PieChart({ data, total, hoverIdx, setHoverIdx }) {
  const cx = 120, cy = 120;
  const outerR = 100, innerR = 60;

  // Calculate arcs
  let startAngle = -Math.PI / 2;
  const arcs = data.map((d, i) => {
    const fraction = total > 0 ? d.value / total : 0;
    const sweep = fraction * Math.PI * 2;
    const endAngle = startAngle + sweep;

    const x1 = cx + outerR * Math.cos(startAngle);
    const y1 = cy + outerR * Math.sin(startAngle);
    const x2 = cx + outerR * Math.cos(endAngle);
    const y2 = cy + outerR * Math.sin(endAngle);
    const ix1 = cx + innerR * Math.cos(endAngle);
    const iy1 = cy + innerR * Math.sin(endAngle);
    const ix2 = cx + innerR * Math.cos(startAngle);
    const iy2 = cy + innerR * Math.sin(startAngle);

    const largeArc = sweep > Math.PI ? 1 : 0;

    const path = [
      `M ${x1} ${y1}`,
      `A ${outerR} ${outerR} 0 ${largeArc} 1 ${x2} ${y2}`,
      `L ${ix1} ${iy1}`,
      `A ${innerR} ${innerR} 0 ${largeArc} 0 ${ix2} ${iy2}`,
      `Z`,
    ].join(" ");

    startAngle = endAngle;
    return { ...d, path, fraction };
  });

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 40, flexWrap: "wrap", justifyContent: "center" }}>
      {/* Donut */}
      <svg width={240} height={240} viewBox={`0 0 240 240`}>
        {arcs.map((arc, i) => (
          <path
            key={i}
            d={arc.path}
            fill={arc.color}
            opacity={hoverIdx === i ? 1 : 0.85}
            style={{ transition: "opacity 0.15s, transform 0.15s", transformOrigin: `${cx}px ${cy}px` }}
            transform={hoverIdx === i ? "scale(1.03)" : "scale(1)"}
            onMouseEnter={() => setHoverIdx(i)}
            onMouseLeave={() => setHoverIdx(null)}
            cursor="pointer"
          />
        ))}
        {/* Center label */}
        <text x={cx} y={cy - 6} textAnchor="middle" fontSize={20} fontWeight={700} fill={C.darkText} fontFamily={FONT}>
          {Number.isInteger(total) ? total.toLocaleString() : total.toFixed(1)}
        </text>
        <text x={cx} y={cy + 14} textAnchor="middle" fontSize={10} fill={C.darkMuted} fontFamily={FONT}>
          Total
        </text>
      </svg>

      {/* Legend */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {arcs.map((arc, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              cursor: "pointer",
              opacity: hoverIdx === i ? 1 : 0.8,
              transition: "opacity 0.15s",
            }}
            onMouseEnter={() => setHoverIdx(i)}
            onMouseLeave={() => setHoverIdx(null)}
          >
            <div style={{ width: 10, height: 10, borderRadius: "50%", background: arc.color, flexShrink: 0 }} />
            <span style={{ fontSize: 12, color: C.darkText, minWidth: 80 }}>{arc.category}</span>
            <span style={{ fontSize: 12, color: C.darkMuted, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
              {Number.isInteger(arc.value) ? arc.value.toLocaleString() : arc.value.toFixed(1)}
            </span>
            <span style={{ fontSize: 10, color: C.darkMuted }}>
              ({(arc.fraction * 100).toFixed(0)}%)
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}


// ─── Line Chart ───

function LineChart({ data, maxValue, hoverIdx, setHoverIdx }) {
  const W = 600, H = 300;
  const padL = 50, padR = 20, padT = 20, padB = 40;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;

  if (data.length < 2) {
    return <div style={{ color: C.darkMuted, fontSize: 14 }}>Need at least 2 data points for a line chart.</div>;
  }

  const points = data.map((d, i) => {
    const x = padL + (i / (data.length - 1)) * chartW;
    const y = padT + chartH - (d.value / maxValue) * chartH;
    return { x, y, ...d };
  });

  const polyline = points.map((p) => `${p.x},${p.y}`).join(" ");

  // Grid lines (5 horizontal)
  const gridLines = [];
  for (let i = 0; i <= 4; i++) {
    const y = padT + (i / 4) * chartH;
    const val = maxValue * (1 - i / 4);
    gridLines.push({ y, val });
  }

  return (
    <div style={{ width: "100%", maxWidth: 700 }}>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ overflow: "visible" }}>
        {/* Grid lines */}
        {gridLines.map((g, i) => (
          <g key={i}>
            <line x1={padL} y1={g.y} x2={W - padR} y2={g.y} stroke={C.darkBorder} strokeWidth={1} />
            <text x={padL - 8} y={g.y + 4} textAnchor="end" fontSize={10} fill={C.darkMuted} fontFamily={FONT}>
              {Number.isInteger(g.val) ? g.val.toLocaleString() : g.val.toFixed(1)}
            </text>
          </g>
        ))}

        {/* Area fill */}
        <polygon
          points={`${points[0].x},${padT + chartH} ${polyline} ${points[points.length - 1].x},${padT + chartH}`}
          fill={C.accent}
          opacity={0.08}
        />

        {/* Line */}
        <polyline
          points={polyline}
          fill="none"
          stroke={C.accent}
          strokeWidth={2.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* Dots + labels */}
        {points.map((p, i) => (
          <g key={i}
            onMouseEnter={() => setHoverIdx(i)}
            onMouseLeave={() => setHoverIdx(null)}
            cursor="pointer"
          >
            <circle
              cx={p.x} cy={p.y} r={hoverIdx === i ? 6 : 4}
              fill={C.accent}
              stroke={C.dark}
              strokeWidth={2}
              style={{ transition: "r 0.15s" }}
            />
            {/* X-axis label */}
            <text
              x={p.x}
              y={H - 8}
              textAnchor="middle"
              fontSize={9}
              fill={C.darkMuted}
              fontFamily={FONT}
              transform={data.length > 6 ? `rotate(-45, ${p.x}, ${H - 8})` : ""}
            >
              {p.category.length > 10 ? p.category.slice(0, 10) + "…" : p.category}
            </text>
            {/* Hover value */}
            {hoverIdx === i && (
              <text
                x={p.x}
                y={p.y - 12}
                textAnchor="middle"
                fontSize={12}
                fontWeight={700}
                fill={C.darkText}
                fontFamily={FONT}
              >
                {Number.isInteger(p.value) ? p.value.toLocaleString() : p.value.toFixed(1)}
              </text>
            )}
          </g>
        ))}
      </svg>
    </div>
  );
}
