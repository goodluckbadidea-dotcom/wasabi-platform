// ─── Function Builder ───
// Linear card strip: Input → Transform → Output.
// User picks databases/columns and describes transforms in natural language.
// Submit generates a scaffold prompt and hands off to Wasabi chat.

import React, { useState, useEffect, useCallback, useRef } from "react";
import { C, FONT, MONO, RADIUS } from "../design/tokens.js";
import { IconPlus, IconTrash, IconChevronLeft } from "../design/icons.jsx";
import { usePlatform } from "../context/PlatformContext.jsx";
import * as api from "../lib/api.js";

// ── Card type accent colors ──
const CARD_COLORS = {
  input: "#2196F3",
  transform: "#FF9800",
  output: "#4CAF50",
  writeback: "#9C27B0",
};

// ── Unique ID generator ──
let _uid = 0;
function uid() { return `step_${++_uid}_${Date.now()}`; }

// ── Default steps ──
function defaultSteps() {
  return [
    { id: uid(), type: "input", config: { database_id: "", database_name: "", columns: [] } },
    { id: uid(), type: "transform", config: { description: "" } },
    { id: uid(), type: "output", config: { outputType: "table", columns: "" } },
  ];
}

export default function FunctionBuilder({ onSubmit, onBack }) {
  const [steps, setSteps] = useState(defaultSteps);
  const [functionName, setFunctionName] = useState("");
  const [functionDesc, setFunctionDesc] = useState("");
  const [writeBack, setWriteBack] = useState({ enabled: false, database_id: "", database_name: "", mode: "create", match_key: "", column_mapping: "" });

  // ── Step management ──
  const updateStep = useCallback((id, config) => {
    setSteps((prev) => prev.map((s) => s.id === id ? { ...s, config: { ...s.config, ...config } } : s));
  }, []);

  const addInput = useCallback(() => {
    setSteps((prev) => {
      const lastInputIdx = prev.reduce((acc, s, i) => s.type === "input" ? i : acc, -1);
      const newStep = { id: uid(), type: "input", config: { database_id: "", database_name: "", columns: [] } };
      const copy = [...prev];
      copy.splice(lastInputIdx + 1, 0, newStep);
      return copy;
    });
  }, []);

  const addTransform = useCallback(() => {
    setSteps((prev) => {
      const lastTransformIdx = prev.reduce((acc, s, i) => s.type === "transform" ? i : acc, -1);
      const newStep = { id: uid(), type: "transform", config: { description: "" } };
      const copy = [...prev];
      copy.splice(lastTransformIdx + 1, 0, newStep);
      return copy;
    });
  }, []);

  const removeStep = useCallback((id) => {
    setSteps((prev) => {
      // Don't allow removing the last input, transform, or output
      const step = prev.find((s) => s.id === id);
      if (!step) return prev;
      const sameType = prev.filter((s) => s.type === step.type);
      if (sameType.length <= 1) return prev;
      return prev.filter((s) => s.id !== id);
    });
  }, []);

  // ── Generate scaffold prompt ──
  const handleSubmit = useCallback(() => {
    const inputs = steps.filter((s) => s.type === "input");
    const transforms = steps.filter((s) => s.type === "transform");
    const output = steps.find((s) => s.type === "output");

    // Validate
    const hasDbInputs = inputs.some((s) => s.config.database_id);
    const hasApiInputs = inputs.some((s) => s.config.source_type === "external_api" && s.config.api_url);
    const hasInputs = hasDbInputs || hasApiInputs;
    const hasTransforms = transforms.some((s) => s.config.description.trim());
    if (!hasInputs || !hasTransforms) {
      alert("Please add at least one input (database or API) and describe at least one transform step.");
      return;
    }

    // Build scaffold
    const lines = [];
    if (functionName.trim()) {
      lines.push(`Create a custom function called "${functionName.trim()}".`);
    } else {
      lines.push("Create a custom function with these specifications:");
    }
    if (functionDesc.trim()) {
      lines.push(`\nDescription: ${functionDesc.trim()}`);
    }

    lines.push("\nINPUTS:");
    inputs.forEach((s, i) => {
      if (s.config.source_type === "external_api" && s.config.api_url) {
        let apiLine = `- "api_${i + 1}" from external API: ${s.config.api_method || "GET"} ${s.config.api_url}`;
        if (s.config.transform_path) apiLine += ` (extract: ${s.config.transform_path})`;
        if (s.config.api_headers?.trim()) apiLine += ` with headers`;
        lines.push(apiLine);
        return;
      }
      if (!s.config.database_id) return;
      const cols = s.config.columns?.length > 0
        ? ` columns: ${s.config.columns.join(", ")}`
        : "";
      lines.push(`- "${s.config.database_name || `input_${i + 1}`}" from database "${s.config.database_name}" (ID: ${s.config.database_id})${cols}`);
    });

    lines.push("\nTRANSFORMS:");
    transforms.forEach((s, i) => {
      if (!s.config.description.trim()) return;
      lines.push(`${i + 1}. ${s.config.description.trim()}`);
    });

    if (output) {
      const outType = output.config.outputType || "table";
      lines.push(`\nOUTPUT: ${outType}`);
      if (outType === "table" && output.config.columns?.trim()) {
        lines.push(`Output columns: ${output.config.columns.trim()}`);
      }
    }

    // Write-back config
    if (writeBack.enabled && writeBack.database_id) {
      lines.push(`\nWRITE-BACK: enabled`);
      lines.push(`Target database: "${writeBack.database_name}" (ID: ${writeBack.database_id})`);
      lines.push(`Mode: ${writeBack.mode}`);
      if (writeBack.match_key.trim()) lines.push(`Match key: ${writeBack.match_key.trim()}`);
      if (writeBack.column_mapping.trim()) lines.push(`Column mapping: ${writeBack.column_mapping.trim()}`);
    }

    onSubmit(lines.join("\n"));
  }, [steps, functionName, functionDesc, writeBack, onSubmit]);

  // ── Render ──
  return (
    <div style={{
      flex: 1, display: "flex", flexDirection: "column",
      background: C.darkBg, overflow: "auto",
    }}>
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "20px 32px 12px",
        borderBottom: `1px solid ${C.darkBorder}`,
      }}>
        <button
          onClick={onBack}
          style={{
            background: "transparent", border: "none", cursor: "pointer",
            padding: 4, display: "flex", outline: "none",
          }}
        >
          <IconChevronLeft size={18} color={C.darkMuted} />
        </button>
        <h2 style={{
          fontFamily: FONT, fontSize: 16, fontWeight: 600,
          color: "#fff", margin: 0, flex: 1,
        }}>
          New Function
        </h2>
        <button
          onClick={handleSubmit}
          style={{
            background: `linear-gradient(135deg, #7DC143, ${C.accent})`,
            border: "none", borderRadius: RADIUS.lg,
            color: "#fff", fontFamily: FONT, fontSize: 12, fontWeight: 600,
            padding: "8px 20px", cursor: "pointer", outline: "none",
          }}
        >
          Build with Wasabi
        </button>
      </div>

      {/* Function name + description */}
      <div style={{ padding: "16px 32px 0", display: "flex", flexDirection: "column", gap: 10 }}>
        <input
          type="text"
          value={functionName}
          onChange={(e) => setFunctionName(e.target.value)}
          placeholder="Function name (optional)"
          style={{
            background: C.darkSurf, border: `1px solid ${C.darkBorder}`,
            borderRadius: RADIUS.lg, padding: "10px 14px",
            color: "#fff", fontFamily: FONT, fontSize: 14, fontWeight: 500,
            outline: "none",
          }}
        />
        <input
          type="text"
          value={functionDesc}
          onChange={(e) => setFunctionDesc(e.target.value)}
          placeholder="Brief description (optional)"
          style={{
            background: C.darkSurf, border: `1px solid ${C.darkBorder}`,
            borderRadius: RADIUS.lg, padding: "8px 14px",
            color: "#fff", fontFamily: FONT, fontSize: 12,
            outline: "none",
          }}
        />
      </div>

      {/* Steps strip */}
      <div style={{
        flex: 1, padding: "20px 32px",
        display: "flex", flexDirection: "column", gap: 0,
      }}>
        {steps.map((step, idx) => {
          const isLast = idx === steps.length - 1;
          const sameTypeCount = steps.filter((s) => s.type === step.type).length;

          return (
            <React.Fragment key={step.id}>
              {/* Card */}
              <StepCard
                step={step}
                onUpdate={(cfg) => updateStep(step.id, cfg)}
                onRemove={sameTypeCount > 1 ? () => removeStep(step.id) : null}
              />

              {/* Connector line + add button */}
              {!isLast && (
                <div style={{
                  display: "flex", flexDirection: "column", alignItems: "center",
                  padding: "4px 0",
                }}>
                  <div style={{
                    width: 2, height: 16,
                    background: C.darkBorder,
                  }} />
                  {/* Show add button between sections */}
                  {step.type === "input" && steps[idx + 1]?.type !== "input" && (
                    <AddButton label="+ Input" onClick={addInput} />
                  )}
                  {step.type === "transform" && steps[idx + 1]?.type !== "transform" && (
                    <AddButton label="+ Step" onClick={addTransform} />
                  )}
                  <div style={{
                    width: 0, height: 0,
                    borderLeft: "5px solid transparent",
                    borderRight: "5px solid transparent",
                    borderTop: `6px solid ${C.darkBorder}`,
                  }} />
                </div>
              )}
            </React.Fragment>
          );
        })}

        {/* Write-Back Card */}
        <div style={{ marginTop: 12 }}>
          <WriteBackCard config={writeBack} onUpdate={(upd) => setWriteBack((prev) => ({ ...prev, ...upd }))} />
        </div>
      </div>
    </div>
  );
}

// ── Add Button ──
function AddButton({ label, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: C.darkSurf2, border: `1px dashed ${C.darkBorder}`,
        borderRadius: RADIUS.sm, color: C.darkMuted,
        fontFamily: FONT, fontSize: 10, fontWeight: 500,
        padding: "3px 12px", cursor: "pointer", outline: "none",
        margin: "4px 0",
      }}
    >
      {label}
    </button>
  );
}

// ── Step Card ──
function StepCard({ step, onUpdate, onRemove }) {
  const color = CARD_COLORS[step.type] || C.darkMuted;
  const label = step.type.charAt(0).toUpperCase() + step.type.slice(1);

  return (
    <div style={{
      background: C.darkSurf,
      border: `1px solid ${C.darkBorder}`,
      borderLeft: `3px solid ${color}`,
      borderRadius: RADIUS.lg,
      padding: "14px 16px",
    }}>
      {/* Card header */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8, marginBottom: 10,
      }}>
        <span style={{
          fontSize: 10, fontWeight: 700, color,
          textTransform: "uppercase", letterSpacing: "0.06em",
          fontFamily: FONT,
        }}>
          {label}
        </span>
        <div style={{ flex: 1 }} />
        {onRemove && (
          <button
            onClick={onRemove}
            style={{
              background: "transparent", border: "none", cursor: "pointer",
              padding: 2, outline: "none", display: "flex",
            }}
          >
            <IconTrash size={12} color={C.darkMuted} />
          </button>
        )}
      </div>

      {/* Card body */}
      {step.type === "input" && (
        <InputCardBody config={step.config} onUpdate={onUpdate} />
      )}
      {step.type === "transform" && (
        <TransformCardBody config={step.config} onUpdate={onUpdate} />
      )}
      {step.type === "output" && (
        <OutputCardBody config={step.config} onUpdate={onUpdate} />
      )}
    </div>
  );
}

// ── Input Card Body ──
function InputCardBody({ config, onUpdate }) {
  const sourceType = config.source_type || "database";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {/* Source type toggle */}
      <div style={{ display: "flex", gap: 4 }}>
        {["database", "external_api"].map((st) => (
          <button
            key={st}
            onClick={() => onUpdate({ source_type: st })}
            style={{
              flex: 1, padding: "6px 10px",
              background: sourceType === st ? "#2196F318" : "transparent",
              border: `1px solid ${sourceType === st ? "#2196F344" : C.darkBorder}`,
              borderRadius: RADIUS.sm, color: sourceType === st ? "#fff" : C.darkMuted,
              fontFamily: FONT, fontSize: 11, fontWeight: sourceType === st ? 600 : 400,
              cursor: "pointer", outline: "none",
            }}
          >
            {st === "database" ? "Database" : "External API"}
          </button>
        ))}
      </div>

      {sourceType === "database" ? (
        <DatabaseInputFields config={config} onUpdate={onUpdate} />
      ) : (
        <ExternalApiInputFields config={config} onUpdate={onUpdate} />
      )}
    </div>
  );
}

function DatabaseInputFields({ config, onUpdate }) {
  const { pages } = usePlatform();
  const [schemaLoading, setSchemaLoading] = useState(false);
  const [availableColumns, setAvailableColumns] = useState([]);

  const dbPages = (pages || []).filter(
    (p) => p.type !== "folder" && p.page_type !== "dashboard" && p.page_type !== "workspace"
  );

  useEffect(() => {
    if (!config.database_id) { setAvailableColumns([]); return; }
    let cancelled = false;
    setSchemaLoading(true);
    api.getTableSchema(config.database_id).then((res) => {
      if (cancelled) return;
      const cols = res?.columns || res?.schema || [];
      setAvailableColumns(Array.isArray(cols) ? cols : Object.keys(cols).map((k) => ({ name: k, type: cols[k] })));
    }).catch(() => { if (!cancelled) setAvailableColumns([]); })
    .finally(() => { if (!cancelled) setSchemaLoading(false); });
    return () => { cancelled = true; };
  }, [config.database_id]);

  const handleDbChange = (e) => {
    const pageId = e.target.value;
    const page = dbPages.find((p) => p.id === pageId);
    onUpdate({ database_id: pageId, database_name: page?.title || page?.name || pageId, columns: [] });
  };

  const handleColumnToggle = (colName) => {
    const current = config.columns || [];
    const next = current.includes(colName) ? current.filter((c) => c !== colName) : [...current, colName];
    onUpdate({ columns: next });
  };

  return (
    <>
      <select
        value={config.database_id || ""}
        onChange={handleDbChange}
        style={{
          background: C.darkSurf2, border: `1px solid ${C.darkBorder}`,
          borderRadius: RADIUS.sm, padding: "8px 10px",
          color: config.database_id ? "#fff" : C.darkMuted,
          fontFamily: FONT, fontSize: 12, outline: "none",
          cursor: "pointer", width: "100%",
        }}
      >
        <option value="" disabled>Select a database...</option>
        {dbPages.map((p) => (
          <option key={p.id} value={p.id}>{p.title || p.name || p.id}</option>
        ))}
      </select>

      {config.database_id && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, maxHeight: 120, overflow: "auto" }}>
          {schemaLoading ? (
            <span style={{ fontSize: 11, color: C.darkMuted, fontFamily: FONT }}>Loading columns...</span>
          ) : availableColumns.length === 0 ? (
            <span style={{ fontSize: 11, color: C.darkMuted, fontFamily: FONT }}>No columns found. Wasabi will auto-detect.</span>
          ) : (
            availableColumns.map((col) => {
              const name = typeof col === "string" ? col : col.name;
              const type = typeof col === "string" ? "" : col.type;
              const selected = (config.columns || []).includes(name);
              return (
                <label key={name} style={{
                  display: "flex", alignItems: "center", gap: 5,
                  padding: "3px 8px", borderRadius: RADIUS.sm,
                  background: selected ? "#2196F318" : "transparent",
                  border: `1px solid ${selected ? "#2196F344" : C.darkBorder}`,
                  cursor: "pointer", fontSize: 11, fontFamily: FONT,
                  color: selected ? "#fff" : C.darkMuted,
                }}>
                  <input type="checkbox" checked={selected} onChange={() => handleColumnToggle(name)}
                    style={{ width: 12, height: 12, accentColor: "#2196F3" }} />
                  {name}
                  {type && (
                    <span style={{ fontSize: 8, color: C.darkMuted, fontFamily: MONO,
                      background: C.darkSurf2, padding: "1px 4px", borderRadius: 2, textTransform: "uppercase" }}>
                      {type}
                    </span>
                  )}
                </label>
              );
            })
          )}
        </div>
      )}
    </>
  );
}

function ExternalApiInputFields({ config, onUpdate }) {
  const inputStyle = {
    width: "100%", background: C.darkSurf2,
    border: `1px solid ${C.darkBorder}`, borderRadius: RADIUS.sm,
    padding: "8px 10px", color: "#fff", fontFamily: FONT,
    fontSize: 12, outline: "none", boxSizing: "border-box",
  };

  return (
    <>
      <input
        type="text"
        value={config.api_url || ""}
        onChange={(e) => onUpdate({ api_url: e.target.value })}
        placeholder="https://api.example.com/data"
        style={inputStyle}
      />
      <div style={{ display: "flex", gap: 6 }}>
        <select
          value={config.api_method || "GET"}
          onChange={(e) => onUpdate({ api_method: e.target.value })}
          style={{ ...inputStyle, width: 90, cursor: "pointer" }}
        >
          <option value="GET">GET</option>
          <option value="POST">POST</option>
        </select>
        <input
          type="text"
          value={config.transform_path || ""}
          onChange={(e) => onUpdate({ transform_path: e.target.value })}
          placeholder="Response path (e.g. data.results)"
          style={{ ...inputStyle, flex: 1 }}
        />
      </div>
      <textarea
        value={config.api_headers || ""}
        onChange={(e) => onUpdate({ api_headers: e.target.value })}
        placeholder='Headers JSON (optional):&#10;{"Authorization": "Bearer ..."}'
        rows={2}
        style={{ ...inputStyle, resize: "vertical", minHeight: 40, fontFamily: MONO, fontSize: 11 }}
      />
    </>
  );
}

// ── Transform Card Body ──
function TransformCardBody({ config, onUpdate }) {
  return (
    <textarea
      value={config.description || ""}
      onChange={(e) => onUpdate({ description: e.target.value })}
      placeholder="Describe what this step should do...&#10;e.g. &quot;Calculate average sell-through rate per SKU&quot;&#10;e.g. &quot;Group by category and sum quantities&quot;"
      rows={3}
      style={{
        width: "100%", background: C.darkSurf2,
        border: `1px solid ${C.darkBorder}`, borderRadius: RADIUS.sm,
        padding: "10px 12px", color: "#fff", fontFamily: FONT,
        fontSize: 12, lineHeight: 1.5, outline: "none",
        resize: "vertical",
      }}
    />
  );
}

// ── Output Card Body ──
function OutputCardBody({ config, onUpdate }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {/* Output type */}
      <div style={{ display: "flex", gap: 6 }}>
        {["table", "number", "summary"].map((t) => (
          <button
            key={t}
            onClick={() => onUpdate({ outputType: t })}
            style={{
              flex: 1, padding: "6px 0",
              background: config.outputType === t ? "#4CAF5020" : "transparent",
              border: `1px solid ${config.outputType === t ? "#4CAF5044" : C.darkBorder}`,
              borderRadius: RADIUS.sm, cursor: "pointer", outline: "none",
              color: config.outputType === t ? "#4CAF50" : C.darkMuted,
              fontFamily: FONT, fontSize: 11, fontWeight: 500,
              textTransform: "capitalize",
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Column hints for table output */}
      {config.outputType === "table" && (
        <input
          type="text"
          value={config.columns || ""}
          onChange={(e) => onUpdate({ columns: e.target.value })}
          placeholder="Expected output columns (e.g. sku, qty, rate)"
          style={{
            background: C.darkSurf2, border: `1px solid ${C.darkBorder}`,
            borderRadius: RADIUS.sm, padding: "8px 10px",
            color: "#fff", fontFamily: FONT, fontSize: 12, outline: "none",
          }}
        />
      )}
    </div>
  );
}

// ── Write-Back Card ──
function WriteBackCard({ config, onUpdate }) {
  const { pages } = usePlatform();
  const color = CARD_COLORS.writeback;

  const dbPages = (pages || []).filter(
    (p) => p.type !== "folder" && p.page_type !== "dashboard" && p.page_type !== "workspace"
  );

  return (
    <div style={{
      background: C.darkSurf,
      border: `1px solid ${config.enabled ? color + "44" : C.darkBorder}`,
      borderLeft: `3px solid ${config.enabled ? color : C.darkBorder}`,
      borderRadius: RADIUS.lg,
      padding: "14px 16px",
      opacity: config.enabled ? 1 : 0.7,
    }}>
      {/* Header with toggle */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: config.enabled ? 10 : 0 }}>
        <span style={{
          fontSize: 10, fontWeight: 700, color: config.enabled ? color : C.darkMuted,
          textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: FONT,
        }}>
          Write-Back
        </span>
        <span style={{ fontSize: 10, color: C.darkMuted, fontFamily: FONT, flex: 1 }}>
          (optional — write results to a database)
        </span>
        <label style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={config.enabled}
            onChange={(e) => onUpdate({ enabled: e.target.checked })}
            style={{ width: 14, height: 14, accentColor: color }}
          />
        </label>
      </div>

      {config.enabled && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {/* Target database */}
          <select
            value={config.database_id || ""}
            onChange={(e) => {
              const page = dbPages.find((p) => p.id === e.target.value);
              onUpdate({ database_id: e.target.value, database_name: page?.title || page?.name || "" });
            }}
            style={{
              background: C.darkSurf2, border: `1px solid ${C.darkBorder}`,
              borderRadius: RADIUS.sm, padding: "8px 10px",
              color: config.database_id ? "#fff" : C.darkMuted,
              fontFamily: FONT, fontSize: 12, outline: "none", cursor: "pointer",
            }}
          >
            <option value="" disabled>Target database...</option>
            {dbPages.map((p) => (
              <option key={p.id} value={p.id}>{p.title || p.name || p.id}</option>
            ))}
          </select>

          {/* Mode selector */}
          <div style={{ display: "flex", gap: 6 }}>
            {["create", "update", "upsert"].map((m) => (
              <button
                key={m}
                onClick={() => onUpdate({ mode: m })}
                style={{
                  flex: 1, padding: "5px 0",
                  background: config.mode === m ? color + "20" : "transparent",
                  border: `1px solid ${config.mode === m ? color + "44" : C.darkBorder}`,
                  borderRadius: RADIUS.sm, cursor: "pointer", outline: "none",
                  color: config.mode === m ? color : C.darkMuted,
                  fontFamily: FONT, fontSize: 11, fontWeight: 500, textTransform: "capitalize",
                }}
              >
                {m}
              </button>
            ))}
          </div>

          {/* Match key (for update/upsert) */}
          {(config.mode === "update" || config.mode === "upsert") && (
            <input
              type="text"
              value={config.match_key || ""}
              onChange={(e) => onUpdate({ match_key: e.target.value })}
              placeholder="Match key field (e.g. SKU, email)"
              style={{
                background: C.darkSurf2, border: `1px solid ${C.darkBorder}`,
                borderRadius: RADIUS.sm, padding: "8px 10px",
                color: "#fff", fontFamily: FONT, fontSize: 12, outline: "none",
              }}
            />
          )}

          {/* Column mapping hint */}
          <input
            type="text"
            value={config.column_mapping || ""}
            onChange={(e) => onUpdate({ column_mapping: e.target.value })}
            placeholder="Column mapping (e.g. sku→SKU, total→Total Sold)"
            style={{
              background: C.darkSurf2, border: `1px solid ${C.darkBorder}`,
              borderRadius: RADIUS.sm, padding: "8px 10px",
              color: "#fff", fontFamily: FONT, fontSize: 12, outline: "none",
            }}
          />
        </div>
      )}
    </div>
  );
}
