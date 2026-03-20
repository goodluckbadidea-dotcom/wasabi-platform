// ─── InlineChart ───
// Compact SVG charts for inline rendering in chat messages.
// Supports: bar, pie (donut), line, metric (big numbers).
// Rendered from wasabi-chart code blocks in markdown.

import React from "react";
import { C, FONT, FONT_DISPLAY, RADIUS, SELECT_PALETTE } from "../design/tokens.js";

const CHART_MAX_W = 400;

/** Get a color from the palette by index, or use a custom hex */
function getColor(i, custom) {
  if (custom && custom.startsWith("#")) return custom;
  return SELECT_PALETTE[i % SELECT_PALETTE.length];
}

/**
 * InlineChart — renders a compact SVG chart from a config object.
 * @param {{ config: { type: string, title?: string, data: Array } }} props
 */
export default function InlineChart({ config }) {
  if (!config || !config.data?.length) {
    return (
      <div style={{ padding: 12, color: C.darkMuted, fontSize: 12, fontFamily: FONT }}>
        No chart data provided.
      </div>
    );
  }

  const { type = "bar", title, data } = config;

  return (
    <div style={{
      background: C.darkSurf,
      borderRadius: RADIUS.lg,
      border: `1px solid ${C.darkBorder}`,
      padding: "14px 16px",
      margin: "8px 0",
      maxWidth: CHART_MAX_W,
      fontFamily: FONT,
    }}>
      {title && (
        <div style={{
          fontSize: 12,
          fontWeight: 600,
          color: C.darkText,
          marginBottom: 10,
          letterSpacing: "-0.01em",
        }}>
          {title}
        </div>
      )}
      {type === "bar" && <InlineBar data={data} />}
      {type === "pie" && <InlinePie data={data} />}
      {type === "line" && <InlineLine data={data} />}
      {type === "metric" && <InlineMetric data={data} />}
    </div>
  );
}


// ─── Bar Chart ───

function InlineBar({ data }) {
  const maxVal = Math.max(...data.map((d) => Number(d.value) || 0), 1);
  const barH = 22;
  const gap = 6;
  const labelW = 90;
  const chartW = 240;
  const svgH = data.length * (barH + gap) + gap;

  return (
    <svg width="100%" viewBox={`0 0 ${labelW + chartW + 50} ${svgH}`} style={{ overflow: "visible" }}>
      {data.map((d, i) => {
        const y = i * (barH + gap) + gap;
        const val = Number(d.value) || 0;
        const barW = Math.max(3, (val / maxVal) * chartW);
        const color = getColor(i, d.color);

        return (
          <g key={i}>
            <text
              x={labelW - 6}
              y={y + barH / 2 + 1}
              textAnchor="end"
              fontSize={11}
              fill={C.darkMuted}
              fontFamily={FONT}
              dominantBaseline="middle"
            >
              {(d.label || "").length > 12 ? d.label.slice(0, 12) + "…" : d.label}
            </text>
            <rect
              x={labelW}
              y={y}
              width={barW}
              height={barH}
              rx={barH / 2}
              fill={color}
              opacity={0.85}
            />
            <text
              x={labelW + barW + 6}
              y={y + barH / 2 + 1}
              fontSize={11}
              fill={C.darkText}
              fontFamily={FONT}
              fontWeight={600}
              dominantBaseline="middle"
            >
              {Number.isInteger(val) ? val.toLocaleString() : val.toFixed(1)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}


// ─── Pie Chart (Donut) ───

function InlinePie({ data }) {
  const cx = 80, cy = 80;
  const outerR = 65, innerR = 40;
  const total = data.reduce((s, d) => s + (Number(d.value) || 0), 0);

  let startAngle = -Math.PI / 2;
  const arcs = data.map((d, i) => {
    const val = Number(d.value) || 0;
    const fraction = total > 0 ? val / total : 0;
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
    return { ...d, path, fraction, value: val, color: getColor(i, d.color) };
  });

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
      <svg width={160} height={160} viewBox="0 0 160 160">
        {arcs.map((arc, i) => (
          <path key={i} d={arc.path} fill={arc.color} opacity={0.85} />
        ))}
        <text x={cx} y={cy - 4} textAnchor="middle" fontSize={16} fontWeight={700} fill={C.darkText} fontFamily={FONT}>
          {Number.isInteger(total) ? total.toLocaleString() : total.toFixed(1)}
        </text>
        <text x={cx} y={cy + 12} textAnchor="middle" fontSize={9} fill={C.darkMuted} fontFamily={FONT}>
          Total
        </text>
      </svg>
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        {arcs.map((arc, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: arc.color, flexShrink: 0 }} />
            <span style={{ color: C.darkText, minWidth: 60 }}>{arc.label}</span>
            <span style={{ color: C.darkMuted, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
              {Number.isInteger(arc.value) ? arc.value.toLocaleString() : arc.value.toFixed(1)}
            </span>
            <span style={{ color: C.darkMuted, fontSize: 9 }}>
              ({(arc.fraction * 100).toFixed(0)}%)
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}


// ─── Line Chart ───

function InlineLine({ data }) {
  const W = 380, H = 180;
  const padL = 40, padR = 10, padT = 10, padB = 30;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;

  if (data.length < 2) {
    return <div style={{ color: C.darkMuted, fontSize: 11 }}>Need at least 2 data points.</div>;
  }

  const maxVal = Math.max(...data.map((d) => Number(d.value) || 0), 1);
  const points = data.map((d, i) => {
    const val = Number(d.value) || 0;
    const x = padL + (i / (data.length - 1)) * chartW;
    const y = padT + chartH - (val / maxVal) * chartH;
    return { x, y, val, label: d.label };
  });

  const polyline = points.map((p) => `${p.x},${p.y}`).join(" ");

  // Grid lines (4 horizontal)
  const gridLines = [];
  for (let i = 0; i <= 3; i++) {
    const y = padT + (i / 3) * chartH;
    const val = maxVal * (1 - i / 3);
    gridLines.push({ y, val });
  }

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ overflow: "visible" }}>
      {gridLines.map((g, i) => (
        <g key={i}>
          <line x1={padL} y1={g.y} x2={W - padR} y2={g.y} stroke={C.darkBorder} strokeWidth={0.5} />
          <text x={padL - 4} y={g.y + 3} textAnchor="end" fontSize={8} fill={C.darkMuted} fontFamily={FONT}>
            {Number.isInteger(g.val) ? g.val.toLocaleString() : g.val.toFixed(0)}
          </text>
        </g>
      ))}
      <polygon
        points={`${points[0].x},${padT + chartH} ${polyline} ${points[points.length - 1].x},${padT + chartH}`}
        fill={C.accent}
        opacity={0.08}
      />
      <polyline
        points={polyline}
        fill="none"
        stroke={C.accent}
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {points.map((p, i) => (
        <g key={i}>
          <circle cx={p.x} cy={p.y} r={3} fill={C.accent} stroke={C.darkSurf} strokeWidth={1.5} />
          <text
            x={p.x}
            y={H - 6}
            textAnchor="middle"
            fontSize={8}
            fill={C.darkMuted}
            fontFamily={FONT}
            transform={data.length > 6 ? `rotate(-45, ${p.x}, ${H - 6})` : ""}
          >
            {(p.label || "").length > 8 ? p.label.slice(0, 8) + "…" : p.label}
          </text>
        </g>
      ))}
    </svg>
  );
}


// ─── Metric (Big Numbers) ───

function InlineMetric({ data }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
      {data.map((d, i) => {
        const val = d.value;
        const trend = d.trend; // "up" | "down" | null
        const trendColor = trend === "up" ? "#2A6B38" : trend === "down" ? "#C13929" : C.darkMuted;
        const trendArrow = trend === "up" ? "↑" : trend === "down" ? "↓" : "";

        return (
          <div key={i} style={{
            background: C.darkSurf2,
            borderRadius: RADIUS.md,
            padding: "10px 16px",
            minWidth: 100,
            flex: "1 1 0",
          }}>
            <div style={{ fontSize: 10, color: C.darkMuted, marginBottom: 4, fontWeight: 500 }}>
              {d.label}
            </div>
            <div style={{ fontFamily: FONT_DISPLAY, fontSize: 22, fontWeight: 700, color: C.darkText, fontVariantNumeric: "tabular-nums" }}>
              {typeof val === "number"
                ? (Number.isInteger(val) ? val.toLocaleString() : val.toFixed(1))
                : val}
              {d.suffix && <span style={{ fontSize: 12, fontWeight: 500, color: C.darkMuted, marginLeft: 2 }}>{d.suffix}</span>}
              {trendArrow && <span style={{ fontSize: 14, color: trendColor, marginLeft: 4 }}>{trendArrow}</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
