// ─── Build Page ───
// Hub for Custom Views (Tier 2) and Micro-Plugins (Tier 3).
// Styled to match FunctionsPanel with theme-inherited accents.
// Each tab has a card-strip builder that hands off to Wasabi chat.

import React, { useState, useEffect, useCallback } from "react";
import { C, FONT, MONO, RADIUS } from "../design/tokens.js";
import { ANIM } from "../design/animations.js";
import { usePlatform } from "../context/PlatformContext.jsx";
import {
  IconPlus, IconTrash, IconPlay, IconGrid, IconBrain, IconSearch,
  IconChevronLeft,
} from "../design/icons.jsx";
import * as api from "../lib/api.js";
import { timeAgo } from "../utils/helpers.js";

// ── Accent follows the active theme ──
// C.accent is resolved at render-time (e.g. Obsidian → #5CC63A)

// ── Shared field styles ──
const fieldStyle = {
  width: "100%", background: C.darkSurf2,
  border: `1px solid ${C.darkBorder}`, borderRadius: RADIUS.sm,
  padding: "10px 12px", color: "#fff", fontFamily: FONT,
  fontSize: 12, outline: "none", boxSizing: "border-box",
};

// ─────────────────────────────────────
//  VIEW BUILDER (card-strip pattern)
// ─────────────────────────────────────

const WIDGET_TYPES = ["metric", "chart", "table", "text", "progress", "list"];
const CHART_TYPES = ["bar", "pie", "line"];
const DATA_SOURCES = ["query", "function_result", "static"];

let _wid = 0;
function widgetId() { return `w_${++_wid}_${Date.now()}`; }

function defaultWidget() {
  return {
    id: widgetId(), type: "metric", title: "", span: 1,
    chartType: "bar", dataSource: "query",
    databaseId: "", field: "", aggregation: "sum",
    functionId: "", staticValue: "",
    categoryField: "", valueField: "",
  };
}

function ViewBuilder({ onSubmit, onBack }) {
  const { pages } = usePlatform();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [columns, setColumns] = useState(2);
  const [widgets, setWidgets] = useState([defaultWidget()]);

  const dbPages = (pages || []).filter(
    (p) => p.type !== "folder" && p.page_type !== "dashboard" && p.page_type !== "workspace"
  );

  const updateWidget = (id, updates) => {
    setWidgets((prev) => prev.map((w) => w.id === id ? { ...w, ...updates } : w));
  };
  const removeWidget = (id) => {
    setWidgets((prev) => prev.length > 1 ? prev.filter((w) => w.id !== id) : prev);
  };
  const addWidget = () => setWidgets((prev) => [...prev, defaultWidget()]);

  const handleSubmit = () => {
    if (!name.trim()) { alert("Please enter a view name."); return; }
    if (!widgets.some((w) => w.title.trim() || w.type)) { alert("Add at least one widget."); return; }

    const lines = [`Create a custom view called "${name.trim()}".`];
    if (description.trim()) lines.push(`Description: ${description.trim()}`);
    lines.push(`\nLAYOUT: grid, ${columns} columns`);
    lines.push("\nWIDGETS:");
    widgets.forEach((w, i) => {
      let line = `${i + 1}. ${w.type}`;
      if (w.title.trim()) line += ` — "${w.title.trim()}"`;
      line += ` (span ${w.span})`;
      if (w.dataSource === "query" && w.databaseId) {
        const db = dbPages.find((p) => p.id === w.databaseId);
        line += ` from "${db?.title || db?.name || w.databaseId}"`;
        if (w.field) line += `, field: ${w.field}`;
        if (w.aggregation) line += `, aggregation: ${w.aggregation}`;
        if (w.categoryField) line += `, category: ${w.categoryField}`;
        if (w.valueField) line += `, value: ${w.valueField}`;
      } else if (w.dataSource === "function_result" && w.functionId) {
        line += ` using function ID: ${w.functionId}`;
      } else if (w.dataSource === "static" && w.staticValue) {
        line += ` static value: ${w.staticValue}`;
      }
      lines.push(line);
    });
    lines.push("\nUse the save_custom_view tool to save this view spec.");
    onSubmit(lines.join("\n"));
  };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", background: C.darkBg, overflow: "auto" }}>
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "20px 32px 12px", borderBottom: `1px solid ${C.darkBorder}`,
      }}>
        <button onClick={onBack} style={{
          background: "transparent", border: "none", cursor: "pointer",
          padding: 4, display: "flex", outline: "none",
        }}>
          <IconChevronLeft size={18} color={C.darkMuted} />
        </button>
        <IconGrid size={18} color={C.accent} />
        <h2 style={{ fontFamily: FONT, fontSize: 16, fontWeight: 600, color: "#fff", margin: 0, flex: 1 }}>
          New Custom View
        </h2>
        <button onClick={handleSubmit} style={{
          background: `linear-gradient(135deg, ${C.accent}, ${C.accent}cc)`,
          border: "none", borderRadius: RADIUS.lg,
          color: "#fff", fontFamily: FONT, fontSize: 12, fontWeight: 600,
          padding: "8px 20px", cursor: "pointer", outline: "none",
        }}>
          Build with Wasabi
        </button>
      </div>

      {/* Name + description */}
      <div style={{ padding: "16px 32px 0", display: "flex", flexDirection: "column", gap: 10 }}>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)}
          placeholder="View name" style={fieldStyle} />
        <input type="text" value={description} onChange={(e) => setDescription(e.target.value)}
          placeholder="Brief description (optional)" style={{ ...fieldStyle, fontSize: 11 }} />
      </div>

      {/* Layout config */}
      <div style={{ padding: "12px 32px", display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 10, fontWeight: 600, color: C.accent, textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: FONT }}>
          Layout
        </span>
        <div style={{ display: "flex", gap: 4 }}>
          {[1, 2, 3].map((c) => (
            <button key={c} onClick={() => setColumns(c)} style={{
              padding: "5px 14px", background: columns === c ? C.accent + "20" : "transparent",
              border: `1px solid ${columns === c ? C.accent + "44" : C.darkBorder}`,
              borderRadius: RADIUS.sm, color: columns === c ? C.accent : C.darkMuted,
              fontFamily: FONT, fontSize: 11, fontWeight: 500, cursor: "pointer", outline: "none",
            }}>
              {c} col{c > 1 ? "s" : ""}
            </button>
          ))}
        </div>
      </div>

      {/* Widget cards */}
      <div style={{ flex: 1, padding: "8px 32px 24px", display: "flex", flexDirection: "column", gap: 0 }}>
        {widgets.map((w, idx) => (
          <React.Fragment key={w.id}>
            <WidgetCard widget={w} onUpdate={(u) => updateWidget(w.id, u)}
              onRemove={widgets.length > 1 ? () => removeWidget(w.id) : null}
              dbPages={dbPages} index={idx} />
            {idx < widgets.length - 1 && (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "4px 0" }}>
                <div style={{ width: 2, height: 12, background: C.darkBorder }} />
                <div style={{ width: 0, height: 0, borderLeft: "4px solid transparent", borderRight: "4px solid transparent", borderTop: `5px solid ${C.darkBorder}` }} />
              </div>
            )}
          </React.Fragment>
        ))}
        <button onClick={addWidget} style={{
          marginTop: 10, padding: "8px 16px", alignSelf: "center",
          background: C.darkSurf, border: `1px dashed ${C.darkBorder}`,
          borderRadius: RADIUS.sm, color: C.darkMuted,
          fontFamily: FONT, fontSize: 11, cursor: "pointer", outline: "none",
          display: "flex", alignItems: "center", gap: 5,
        }}>
          <IconPlus size={10} color={C.darkMuted} /> Add Widget
        </button>
      </div>
    </div>
  );
}

function WidgetCard({ widget, onUpdate, onRemove, dbPages, index }) {
  const w = widget;
  return (
    <div style={{
      background: C.darkSurf, border: `1px solid ${C.darkBorder}`,
      borderLeft: `3px solid ${C.accent}`, borderRadius: RADIUS.lg, padding: "14px 16px",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: C.accent, textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: FONT }}>
          Widget {index + 1}
        </span>
        <div style={{ flex: 1 }} />
        {onRemove && (
          <button onClick={onRemove} style={{ background: "transparent", border: "none", cursor: "pointer", padding: 2, outline: "none", display: "flex" }}>
            <IconTrash size={12} color={C.darkMuted} />
          </button>
        )}
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        <input type="text" value={w.title} onChange={(e) => onUpdate({ title: e.target.value })}
          placeholder="Widget title" style={{ ...fieldStyle, flex: 1 }} />
        <select value={w.span} onChange={(e) => onUpdate({ span: Number(e.target.value) })}
          style={{ ...fieldStyle, width: 70, cursor: "pointer" }}>
          <option value={1}>1 col</option>
          <option value={2}>2 col</option>
          <option value={3}>3 col</option>
        </select>
      </div>

      {/* Widget type selector */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 8 }}>
        {WIDGET_TYPES.map((t) => (
          <button key={t} onClick={() => onUpdate({ type: t })} style={{
            padding: "4px 10px", background: w.type === t ? C.accent + "18" : "transparent",
            border: `1px solid ${w.type === t ? C.accent + "44" : C.darkBorder}`,
            borderRadius: RADIUS.sm, color: w.type === t ? "#fff" : C.darkMuted,
            fontFamily: FONT, fontSize: 10, fontWeight: w.type === t ? 600 : 400,
            cursor: "pointer", outline: "none", textTransform: "capitalize",
          }}>
            {t}
          </button>
        ))}
      </div>

      {/* Chart subtype */}
      {w.type === "chart" && (
        <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
          {CHART_TYPES.map((ct) => (
            <button key={ct} onClick={() => onUpdate({ chartType: ct })} style={{
              flex: 1, padding: "4px 0",
              background: w.chartType === ct ? C.accent + "20" : "transparent",
              border: `1px solid ${w.chartType === ct ? C.accent + "44" : C.darkBorder}`,
              borderRadius: RADIUS.sm, color: w.chartType === ct ? C.accent : C.darkMuted,
              fontFamily: FONT, fontSize: 10, cursor: "pointer", outline: "none", textTransform: "capitalize",
            }}>
              {ct}
            </button>
          ))}
        </div>
      )}

      {/* Data source selector */}
      <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
        {DATA_SOURCES.map((ds) => (
          <button key={ds} onClick={() => onUpdate({ dataSource: ds })} style={{
            flex: 1, padding: "5px 0",
            background: w.dataSource === ds ? C.accent + "18" : "transparent",
            border: `1px solid ${w.dataSource === ds ? C.accent + "44" : C.darkBorder}`,
            borderRadius: RADIUS.sm, color: w.dataSource === ds ? "#fff" : C.darkMuted,
            fontFamily: FONT, fontSize: 10, fontWeight: w.dataSource === ds ? 600 : 400,
            cursor: "pointer", outline: "none",
          }}>
            {ds === "function_result" ? "Function" : ds === "query" ? "Database" : "Static"}
          </button>
        ))}
      </div>

      {/* Data source config */}
      {w.dataSource === "query" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <select value={w.databaseId || ""} onChange={(e) => onUpdate({ databaseId: e.target.value })}
            style={{ ...fieldStyle, cursor: "pointer", color: w.databaseId ? "#fff" : C.darkMuted }}>
            <option value="" disabled>Select database...</option>
            {dbPages.map((p) => (
              <option key={p.id} value={p.id}>{p.title || p.name || p.id}</option>
            ))}
          </select>
          <div style={{ display: "flex", gap: 6 }}>
            <input type="text" value={w.field || ""} onChange={(e) => onUpdate({ field: e.target.value })}
              placeholder="Field name" style={{ ...fieldStyle, flex: 1 }} />
            <select value={w.aggregation || "sum"} onChange={(e) => onUpdate({ aggregation: e.target.value })}
              style={{ ...fieldStyle, width: 90, cursor: "pointer" }}>
              {["sum", "avg", "count", "min", "max"].map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
          </div>
          {(w.type === "chart" || w.type === "list") && (
            <div style={{ display: "flex", gap: 6 }}>
              <input type="text" value={w.categoryField || ""} onChange={(e) => onUpdate({ categoryField: e.target.value })}
                placeholder="Category field" style={{ ...fieldStyle, flex: 1 }} />
              <input type="text" value={w.valueField || ""} onChange={(e) => onUpdate({ valueField: e.target.value })}
                placeholder="Value field" style={{ ...fieldStyle, flex: 1 }} />
            </div>
          )}
        </div>
      )}
      {w.dataSource === "function_result" && (
        <input type="text" value={w.functionId || ""} onChange={(e) => onUpdate({ functionId: e.target.value })}
          placeholder="Function ID" style={fieldStyle} />
      )}
      {w.dataSource === "static" && (
        <input type="text" value={w.staticValue || ""} onChange={(e) => onUpdate({ staticValue: e.target.value })}
          placeholder="Static value (e.g. 73 or a label)" style={fieldStyle} />
      )}
    </div>
  );
}

// ─────────────────────────────────────
//  PLUGIN BUILDER (card-strip pattern)
// ─────────────────────────────────────

const ALL_CAPABILITIES = [
  { key: "read_data", label: "Read Data", desc: "Query and process database rows" },
  { key: "compute", label: "Compute", desc: "Run calculations and aggregations" },
  { key: "generate_view", label: "Generate View", desc: "Return a viewSpec for rendering" },
  { key: "text_processing", label: "Text", desc: "trim, upper, lower, replace, slug, template..." },
  { key: "date_processing", label: "Dates", desc: "now, parseDate, monthsBetween, formatDate..." },
  { key: "write_back", label: "Write Back", desc: "Write results to a database" },
  { key: "external_api", label: "External API", desc: "Call external APIs" },
];

function PluginBuilder({ onSubmit, onBack }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [capabilities, setCapabilities] = useState(["read_data", "compute"]);
  const [outputType, setOutputType] = useState("data");
  const [configFields, setConfigFields] = useState([]);
  const [transformDesc, setTransformDesc] = useState("");

  const toggleCap = (key) => {
    setCapabilities((prev) => prev.includes(key) ? prev.filter((c) => c !== key) : [...prev, key]);
  };

  const addConfigField = () => {
    setConfigFields((prev) => [...prev, { key: "", type: "string", label: "", default: "" }]);
  };
  const updateConfigField = (idx, updates) => {
    setConfigFields((prev) => prev.map((f, i) => i === idx ? { ...f, ...updates } : f));
  };
  const removeConfigField = (idx) => {
    setConfigFields((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSubmit = () => {
    if (!name.trim()) { alert("Please enter a plugin name."); return; }
    if (!transformDesc.trim()) { alert("Describe what this plugin should do."); return; }

    const lines = [`Create a micro-plugin called "${name.trim()}".`];
    if (description.trim()) lines.push(`Description: ${description.trim()}`);
    lines.push(`\nCAPABILITIES: ${capabilities.join(", ")}`);
    lines.push(`OUTPUT TYPE: ${outputType}`);

    if (configFields.length > 0) {
      lines.push("\nCONFIG SCHEMA:");
      configFields.forEach((f) => {
        if (!f.key.trim()) return;
        let line = `- ${f.key}: ${f.type}`;
        if (f.label) line += ` (label: "${f.label}")`;
        if (f.default) line += ` default: ${f.default}`;
        lines.push(line);
      });
    }

    lines.push(`\nTRANSFORM:\n${transformDesc.trim()}`);
    lines.push("\nUse the save_plugin tool to save this plugin with the manifest and code.");
    onSubmit(lines.join("\n"));
  };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", background: C.darkBg, overflow: "auto" }}>
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "20px 32px 12px", borderBottom: `1px solid ${C.darkBorder}`,
      }}>
        <button onClick={onBack} style={{
          background: "transparent", border: "none", cursor: "pointer",
          padding: 4, display: "flex", outline: "none",
        }}>
          <IconChevronLeft size={18} color={C.darkMuted} />
        </button>
        <IconBrain size={18} color={C.accent} />
        <h2 style={{ fontFamily: FONT, fontSize: 16, fontWeight: 600, color: "#fff", margin: 0, flex: 1 }}>
          New Plugin
        </h2>
        <button onClick={handleSubmit} style={{
          background: `linear-gradient(135deg, ${C.accent}, ${C.accent}cc)`,
          border: "none", borderRadius: RADIUS.lg,
          color: "#fff", fontFamily: FONT, fontSize: 12, fontWeight: 600,
          padding: "8px 20px", cursor: "pointer", outline: "none",
        }}>
          Build with Wasabi
        </button>
      </div>

      <div style={{ flex: 1, padding: "16px 32px 24px", display: "flex", flexDirection: "column", gap: 0 }}>
        {/* Name + desc */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 12 }}>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)}
            placeholder="Plugin name" style={fieldStyle} />
          <input type="text" value={description} onChange={(e) => setDescription(e.target.value)}
            placeholder="Brief description (optional)" style={{ ...fieldStyle, fontSize: 11 }} />
        </div>

        {/* Capabilities card */}
        <div style={{
          background: C.darkSurf, border: `1px solid ${C.darkBorder}`,
          borderLeft: `3px solid ${C.accent}`, borderRadius: RADIUS.lg,
          padding: "14px 16px", marginBottom: 10,
        }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: C.accent, textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: FONT }}>
            Capabilities
          </span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
            {ALL_CAPABILITIES.map((cap) => {
              const selected = capabilities.includes(cap.key);
              return (
                <button key={cap.key} onClick={() => toggleCap(cap.key)} title={cap.desc} style={{
                  padding: "5px 12px", background: selected ? C.accent + "18" : "transparent",
                  border: `1px solid ${selected ? C.accent + "44" : C.darkBorder}`,
                  borderRadius: RADIUS.sm, color: selected ? "#fff" : C.darkMuted,
                  fontFamily: FONT, fontSize: 10, fontWeight: selected ? 600 : 400,
                  cursor: "pointer", outline: "none",
                }}>
                  {cap.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Connector */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "2px 0" }}>
          <div style={{ width: 2, height: 10, background: C.darkBorder }} />
          <div style={{ width: 0, height: 0, borderLeft: "4px solid transparent", borderRight: "4px solid transparent", borderTop: `5px solid ${C.darkBorder}` }} />
        </div>

        {/* Output type card */}
        <div style={{
          background: C.darkSurf, border: `1px solid ${C.darkBorder}`,
          borderLeft: `3px solid ${C.accent}`, borderRadius: RADIUS.lg,
          padding: "14px 16px", marginBottom: 10,
        }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: C.accent, textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: FONT }}>
            Output
          </span>
          <div style={{ display: "flex", gap: 4, marginTop: 10 }}>
            {["data", "view", "data+view"].map((ot) => (
              <button key={ot} onClick={() => setOutputType(ot)} style={{
                flex: 1, padding: "6px 0",
                background: outputType === ot ? C.accent + "20" : "transparent",
                border: `1px solid ${outputType === ot ? C.accent + "44" : C.darkBorder}`,
                borderRadius: RADIUS.sm, color: outputType === ot ? C.accent : C.darkMuted,
                fontFamily: FONT, fontSize: 11, fontWeight: 500, cursor: "pointer", outline: "none",
              }}>
                {ot}
              </button>
            ))}
          </div>
        </div>

        {/* Connector */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "2px 0" }}>
          <div style={{ width: 2, height: 10, background: C.darkBorder }} />
          <div style={{ width: 0, height: 0, borderLeft: "4px solid transparent", borderRight: "4px solid transparent", borderTop: `5px solid ${C.darkBorder}` }} />
        </div>

        {/* Config schema card */}
        <div style={{
          background: C.darkSurf, border: `1px solid ${C.darkBorder}`,
          borderLeft: `3px solid ${C.accent}`, borderRadius: RADIUS.lg,
          padding: "14px 16px", marginBottom: 10,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: C.accent, textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: FONT }}>
              Config Schema
            </span>
            <span style={{ fontSize: 9, color: C.darkMuted, fontFamily: FONT, flex: 1 }}>
              (optional — runtime settings)
            </span>
            <button onClick={addConfigField} style={{
              background: C.darkSurf2, border: `1px dashed ${C.darkBorder}`,
              borderRadius: RADIUS.sm, color: C.darkMuted,
              fontFamily: FONT, fontSize: 9, padding: "2px 10px", cursor: "pointer", outline: "none",
            }}>
              + Field
            </button>
          </div>
          {configFields.map((f, idx) => (
            <div key={idx} style={{ display: "flex", gap: 6, marginBottom: 6 }}>
              <input type="text" value={f.key} onChange={(e) => updateConfigField(idx, { key: e.target.value })}
                placeholder="key" style={{ ...fieldStyle, flex: 1, fontFamily: MONO, fontSize: 11 }} />
              <select value={f.type} onChange={(e) => updateConfigField(idx, { type: e.target.value })}
                style={{ ...fieldStyle, width: 80, cursor: "pointer", fontSize: 11 }}>
                {["string", "number", "boolean"].map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <input type="text" value={f.label} onChange={(e) => updateConfigField(idx, { label: e.target.value })}
                placeholder="Label" style={{ ...fieldStyle, flex: 1, fontSize: 11 }} />
              <input type="text" value={f.default} onChange={(e) => updateConfigField(idx, { default: e.target.value })}
                placeholder="Default" style={{ ...fieldStyle, width: 70, fontSize: 11 }} />
              <button onClick={() => removeConfigField(idx)} style={{
                background: "transparent", border: "none", cursor: "pointer", padding: 2, outline: "none", display: "flex",
              }}>
                <IconTrash size={10} color={C.darkMuted} />
              </button>
            </div>
          ))}
          {configFields.length === 0 && (
            <span style={{ fontSize: 10, color: C.darkMuted, fontFamily: FONT }}>
              No config fields. Click + Field to add runtime settings.
            </span>
          )}
        </div>

        {/* Connector */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "2px 0" }}>
          <div style={{ width: 2, height: 10, background: C.darkBorder }} />
          <div style={{ width: 0, height: 0, borderLeft: "4px solid transparent", borderRight: "4px solid transparent", borderTop: `5px solid ${C.darkBorder}` }} />
        </div>

        {/* Transform description card */}
        <div style={{
          background: C.darkSurf, border: `1px solid ${C.darkBorder}`,
          borderLeft: `3px solid ${C.accent}`, borderRadius: RADIUS.lg,
          padding: "14px 16px",
        }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: C.accent, textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: FONT }}>
            Transform
          </span>
          <textarea value={transformDesc} onChange={(e) => setTransformDesc(e.target.value)}
            placeholder={'Describe what this plugin should do...\ne.g. "Calculate inventory health score per SKU, flag items below threshold, return a summary view"'}
            rows={4} style={{ ...fieldStyle, marginTop: 10, resize: "vertical", lineHeight: 1.5 }} />
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────
//  LIST VIEW (function-card style)
// ─────────────────────────────────────

function ItemCard({ item, color, onRun, onDelete }) {
  const [hovered, setHovered] = useState(false);
  const meta = typeof item.meta === "string" ? JSON.parse(item.meta || "{}") : (item.meta || {});
  const manifest = meta.manifest;
  const capabilities = manifest?.capabilities || [];

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: C.darkSurf,
        border: `1px solid ${hovered ? color + "44" : C.darkBorder}`,
        borderRadius: RADIUS.lg, overflow: "hidden",
        transition: "border-color 0.12s",
      }}
    >
      {/* Body */}
      <div style={{ padding: "14px 18px 10px", cursor: "pointer" }} onClick={() => onRun(item)}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <span style={{
            fontSize: 9, fontWeight: 600, color, background: color + "18",
            padding: "2px 8px", borderRadius: 3, textTransform: "uppercase",
            letterSpacing: "0.04em", fontFamily: FONT,
          }}>
            {item.type}
          </span>
          <span style={{
            fontSize: 14, fontWeight: 600, color: "#fff", fontFamily: FONT,
            flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          }}>
            {item.name || "Untitled"}
          </span>
          <span style={{
            fontSize: 8, fontWeight: 600, fontFamily: FONT,
            color: item.status === "active" ? C.accent : C.darkMuted,
            background: (item.status === "active" ? C.accent : C.darkMuted) + "18",
            padding: "2px 8px", borderRadius: 3, textTransform: "uppercase",
          }}>
            {item.status || "draft"}
          </span>
        </div>

        {item.description && (
          <p style={{
            fontSize: 12, color: C.darkMuted, fontFamily: FONT,
            margin: "0 0 6px", lineHeight: 1.4,
            display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
          }}>
            {item.description}
          </p>
        )}

        {capabilities.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
            {capabilities.slice(0, 5).map((cap) => (
              <span key={cap} style={{
                fontSize: 8, color: C.accent, background: C.accent + "15",
                padding: "1px 6px", borderRadius: 2, fontWeight: 500, fontFamily: FONT,
              }}>
                {cap}
              </span>
            ))}
          </div>
        )}

        {/* Meta row */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 6, fontSize: 10, color: C.darkMuted, fontFamily: MONO }}>
          {item.version > 1 && <span>v{item.version}</span>}
          {item.last_run_at && <span>Last run {timeAgo(item.last_run_at)}</span>}
        </div>
      </div>

      {/* Action bar */}
      <div style={{
        display: "flex", alignItems: "center", gap: 6,
        padding: "8px 18px 10px", borderTop: `1px solid ${C.darkBorder}`,
      }}>
        <button onClick={(e) => { e.stopPropagation(); onRun(item); }} style={{
          display: "flex", alignItems: "center", gap: 5,
          background: `linear-gradient(135deg, ${color}, ${color}cc)`,
          border: "none", borderRadius: RADIUS.sm,
          color: "#fff", fontFamily: FONT, fontSize: 11, fontWeight: 600,
          padding: "5px 14px", cursor: "pointer", outline: "none",
        }}>
          <IconPlay size={10} color="#fff" /> Run
        </button>
        <div style={{ flex: 1 }} />
        <button onClick={(e) => { e.stopPropagation(); onDelete(item.id); }} style={{
          display: "flex", alignItems: "center", gap: 4,
          background: "transparent",
          border: `1px solid ${hovered ? "#E0525244" : C.darkBorder}`,
          borderRadius: RADIUS.sm, color: hovered ? "#E05252" : C.darkMuted,
          fontFamily: FONT, fontSize: 10, padding: "4px 10px",
          cursor: "pointer", outline: "none", transition: "color 0.12s, border-color 0.12s",
        }}>
          <IconTrash size={10} color={hovered ? "#E05252" : C.darkMuted} /> Delete
        </button>
      </div>
    </div>
  );
}

function EmptyState({ type, onCreate }) {
  const isView = type === "views";
  const color = isView ? C.accent : C.accent;
  return (
    <div style={{
      flex: 1, display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", gap: 12, padding: 40,
    }}>
      {isView ? <IconGrid size={40} color={C.darkBorder} /> : <IconBrain size={40} color={C.darkBorder} />}
      <p style={{ fontFamily: FONT, fontSize: 14, color: C.darkMuted, textAlign: "center", margin: 0, lineHeight: 1.5 }}>
        {isView
          ? "No custom views yet. Create dashboard views with metrics, charts, and data tables."
          : "No plugins yet. Build extended data transforms with text, date, and view capabilities."}
      </p>
      <button onClick={onCreate} style={{
        marginTop: 8, display: "flex", alignItems: "center", gap: 6,
        background: C.darkSurf, border: `1px solid ${C.darkBorder}`,
        borderRadius: RADIUS.lg, color: "#fff", fontFamily: FONT,
        fontSize: 13, fontWeight: 500, padding: "8px 20px",
        cursor: "pointer", outline: "none",
      }}>
        <IconPlus size={14} color={color} />
        Create your first {isView ? "view" : "plugin"}
      </button>
    </div>
  );
}

// ─────────────────────────────────────
//  MAIN BUILD PAGE
// ─────────────────────────────────────

export default function BuildPage({ onOpenChat }) {
  const { user } = usePlatform();
  const [activeTab, setActiveTab] = useState("views");
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [view, setView] = useState("list"); // "list" | "viewBuilder" | "pluginBuilder"

  // Fetch items
  useEffect(() => {
    if (!user?.workerUrl) return;
    setLoading(true);
    const type = activeTab === "views" ? "view" : "plugin";
    api.listCustomFunctions({ type, status: "active" })
      .then((res) => setItems(res?.entries || []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [user?.workerUrl, activeTab]);

  const handleDelete = useCallback(async (id) => {
    try {
      await api.deleteCustomFunction(id);
      setItems((prev) => prev.filter((f) => f.id !== id));
    } catch (err) {
      console.error("[BuildPage] Delete failed:", err);
    }
  }, []);

  const handleRun = useCallback((item) => {
    onOpenChat?.(`Run my custom ${item.type} "${item.name}" (ID: ${item.id})`);
  }, [onOpenChat]);

  const handleBuilderSubmit = useCallback((scaffoldPrompt) => {
    onOpenChat?.(scaffoldPrompt);
    setView("list");
    setTimeout(() => {
      const type = activeTab === "views" ? "view" : "plugin";
      api.listCustomFunctions({ type, status: "active" })
        .then((res) => setItems(res?.entries || []))
        .catch(() => {});
    }, 3000);
  }, [onOpenChat, activeTab]);

  const color = C.accent;

  // Builder views
  if (view === "viewBuilder") {
    return <ViewBuilder onSubmit={handleBuilderSubmit} onBack={() => setView("list")} />;
  }
  if (view === "pluginBuilder") {
    return <PluginBuilder onSubmit={handleBuilderSubmit} onBack={() => setView("list")} />;
  }

  const filtered = items.filter((fn) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (fn.name || "").toLowerCase().includes(q) || (fn.description || "").toLowerCase().includes(q);
  });

  // List view
  return (
    <div style={{
      flex: 1, display: "flex", flexDirection: "column",
      background: C.darkBg, padding: "24px 32px", overflow: "auto",
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
        {activeTab === "views"
          ? <IconGrid size={22} color={C.accent} />
          : <IconBrain size={22} color={C.accent} />}
        <h2 style={{ fontFamily: FONT, fontSize: 18, fontWeight: 600, color: "#fff", margin: 0 }}>
          Build
        </h2>

        {/* Pill tabs */}
        <div style={{
          display: "flex", gap: 0, background: C.darkSurf,
          borderRadius: RADIUS.lg, border: `1px solid ${C.darkBorder}`, overflow: "hidden",
        }}>
          {["views", "plugins"].map((key) => {
            const isActive = activeTab === key;
            return (
              <button key={key}
                onClick={() => { setActiveTab(key); setSearch(""); }}
                style={{
                  padding: "6px 18px", border: "none", outline: "none",
                  cursor: "pointer", fontFamily: FONT,
                  fontSize: 12, fontWeight: isActive ? 600 : 400,
                  color: isActive ? "#fff" : C.darkMuted,
                  background: isActive ? C.accent + "30" : "transparent",
                  transition: "all 0.15s",
                }}
              >
                {key === "views" ? "Views" : "Plugins"}
              </button>
            );
          })}
        </div>

        <div style={{ flex: 1 }} />

        <button
          onClick={() => setView(activeTab === "views" ? "viewBuilder" : "pluginBuilder")}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            background: `linear-gradient(135deg, ${color}, ${color}cc)`,
            border: "none", borderRadius: RADIUS.lg,
            color: "#fff", fontFamily: FONT, fontSize: 12, fontWeight: 600,
            padding: "8px 16px", cursor: "pointer", outline: "none",
          }}
        >
          <IconPlus size={14} color="#fff" />
          New {activeTab === "views" ? "View" : "Plugin"}
        </button>
      </div>

      {/* Search */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        background: C.darkSurf, border: `1px solid ${C.darkBorder}`,
        borderRadius: RADIUS.lg, padding: "8px 12px", marginBottom: 16,
      }}>
        <IconSearch size={14} color={C.darkMuted} />
        <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder={`Search ${activeTab}...`}
          style={{
            flex: 1, background: "transparent", border: "none",
            color: "#fff", fontFamily: FONT, fontSize: 13, outline: "none",
          }}
        />
      </div>

      {/* Content */}
      {loading ? (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: C.darkMuted, fontFamily: FONT, fontSize: 13 }}>
          Loading...
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState type={activeTab} onCreate={() => setView(activeTab === "views" ? "viewBuilder" : "pluginBuilder")} />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {filtered.map((item) => (
            <ItemCard key={item.id} item={item} color={color} onRun={handleRun} onDelete={handleDelete} />
          ))}
        </div>
      )}
    </div>
  );
}
