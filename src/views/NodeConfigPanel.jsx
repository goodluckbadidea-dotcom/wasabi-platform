// ─── Node Config Panel ───
// Right-side panel (280px) for editing the selected node's configuration.
// Shows type-specific config fields.

import React, { useCallback, useState, useEffect } from "react";
import { C, FONT, MONO, RADIUS } from "../design/tokens.js";
import { NODE_TYPE_COLORS } from "./NodeRenderer.jsx";
import { IconTrash, IconClose, IconWasabiNode } from "../design/icons.jsx";
import * as api from "../lib/api.js";

// ── Field Renderer ──

function ConfigField({ label, children }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{
        display: "block",
        fontSize: 10,
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: "0.08em",
        color: C.darkMuted,
        marginBottom: 4,
        fontFamily: FONT,
      }}>
        {label}
      </label>
      {children}
    </div>
  );
}

function TextInput({ value, onChange, placeholder, multiline }) {
  const style = {
    width: "100%",
    background: C.dark,
    border: `1px solid ${C.darkBorder}`,
    borderRadius: RADIUS.md,
    color: C.darkText,
    fontSize: 12,
    fontFamily: FONT,
    padding: "8px 10px",
    outline: "none",
    resize: multiline ? "vertical" : "none",
    minHeight: multiline ? 60 : undefined,
    boxSizing: "border-box",
  };

  if (multiline) {
    return (
      <textarea
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={style}
        rows={3}
      />
    );
  }

  return (
    <input
      type="text"
      value={value || ""}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      style={style}
    />
  );
}

function NumberInput({ value, onChange, placeholder }) {
  return (
    <input
      type="number"
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
      placeholder={placeholder}
      style={{
        width: "100%",
        background: C.dark,
        border: `1px solid ${C.darkBorder}`,
        borderRadius: RADIUS.md,
        color: C.darkText,
        fontSize: 12,
        fontFamily: FONT,
        padding: "8px 10px",
        outline: "none",
        boxSizing: "border-box",
      }}
    />
  );
}

function SelectInput({ value, onChange, options }) {
  return (
    <select
      value={value || ""}
      onChange={(e) => onChange(e.target.value)}
      style={{
        width: "100%",
        background: C.dark,
        border: `1px solid ${C.darkBorder}`,
        borderRadius: RADIUS.md,
        color: C.darkText,
        fontSize: 12,
        fontFamily: FONT,
        padding: "8px 10px",
        outline: "none",
        boxSizing: "border-box",
        cursor: "pointer",
      }}
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>{opt.label}</option>
      ))}
    </select>
  );
}

// ── Type-Specific Config Forms ──

function TriggerDbChangeConfig({ config, onChange }) {
  return (
    <>
      <ConfigField label="Database ID">
        <TextInput value={config.databaseId} onChange={(v) => onChange({ ...config, databaseId: v })} placeholder="Paste database ID..." />
      </ConfigField>
      <ConfigField label="Field">
        <TextInput value={config.field} onChange={(v) => onChange({ ...config, field: v })} placeholder="e.g. Status" />
      </ConfigField>
      <ConfigField label="From (optional)">
        <TextInput value={config.from} onChange={(v) => onChange({ ...config, from: v })} placeholder="Previous value" />
      </ConfigField>
      <ConfigField label="To">
        <TextInput value={config.to} onChange={(v) => onChange({ ...config, to: v })} placeholder="Target value" />
      </ConfigField>
    </>
  );
}

function TriggerScheduleConfig({ config, onChange }) {
  return (
    <ConfigField label="Interval (minutes)">
      <NumberInput value={config.interval_minutes} onChange={(v) => onChange({ ...config, interval_minutes: v })} placeholder="60" />
    </ConfigField>
  );
}

function ConditionConfig({ config, onChange }) {
  return (
    <>
      <ConfigField label="Field">
        <TextInput value={config.field} onChange={(v) => onChange({ ...config, field: v })} placeholder="e.g. Priority" />
      </ConfigField>
      <ConfigField label="Operator">
        <SelectInput
          value={config.operator}
          onChange={(v) => onChange({ ...config, operator: v })}
          options={[
            { value: "equals", label: "Equals" },
            { value: "not_equals", label: "Not Equals" },
            { value: "contains", label: "Contains" },
            { value: "gt", label: "Greater Than" },
            { value: "lt", label: "Less Than" },
          ]}
        />
      </ConfigField>
      <ConfigField label="Value">
        <TextInput value={config.value} onChange={(v) => onChange({ ...config, value: v })} placeholder="Target value" />
      </ConfigField>
    </>
  );
}

// ── Plain English hint bar ──

function PlainEnglishHint() {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 5,
      padding: "6px 8px", marginBottom: 10,
      background: "#F5B72410", borderRadius: RADIUS.sm,
      border: `1px solid #F5B72420`,
    }}>
      <IconWasabiNode size={11} color="#F5B724" />
      <span style={{ fontSize: 9, color: "#F5B724", fontFamily: FONT, fontWeight: 500 }}>
        Describe in plain English — Wasabi interprets when you build
      </span>
    </div>
  );
}

// ── When Config (combined trigger+condition, plain English) ──

function WhenConfig({ config, onChange, defaultDatabaseId, defaultDatabaseName, pages }) {
  const dbPages = (pages || []).filter(
    (p) => p.type !== "folder" && p.page_type !== "dashboard" && p.page_type !== "workspace"
  );

  const effectiveDbId = config.databaseId || defaultDatabaseId || "";
  const effectiveDbName = config.databaseName || defaultDatabaseName || "";

  return (
    <>
      <PlainEnglishHint />

      <ConfigField label="Description">
        <TextInput
          value={config.description}
          onChange={(v) => onChange({ ...config, description: v })}
          placeholder='e.g. "When Status changes to Done"&#10;"Every Monday at 9am"&#10;"When a new row is added"&#10;"When Quantity drops below 10"'
          multiline
        />
      </ConfigField>

      <ConfigField label="Database (optional override)">
        <select
          value={config.databaseId || ""}
          onChange={(e) => {
            const page = dbPages.find((p) => p.id === e.target.value);
            onChange({ ...config, databaseId: e.target.value, databaseName: page?.title || page?.name || "" });
          }}
          style={{
            width: "100%", background: C.dark,
            border: `1px solid ${C.darkBorder}`, borderRadius: RADIUS.md,
            color: config.databaseId ? C.darkText : C.darkMuted,
            fontSize: 12, fontFamily: FONT, padding: "8px 10px",
            outline: "none", cursor: "pointer", boxSizing: "border-box",
          }}
        >
          <option value="">{defaultDatabaseId ? `Flow default: ${defaultDatabaseName || defaultDatabaseId.slice(0, 8)}` : "Select database..."}</option>
          {dbPages.map((p) => (
            <option key={p.id} value={p.id}>{p.title || p.name || p.id}</option>
          ))}
        </select>
      </ConfigField>

      {/* Show resolved config if interpreted */}
      {config.resolved && config.resolvedConfig && (
        <div style={{
          marginTop: 4, padding: "8px 10px",
          background: C.accent + "10", border: `1px solid ${C.accent}30`,
          borderRadius: RADIUS.sm,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 4 }}>
            <span style={{ fontSize: 9, fontWeight: 600, color: C.accent, textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: FONT }}>
              Interpreted
            </span>
          </div>
          <div style={{ fontSize: 10, color: C.darkText, fontFamily: MONO, lineHeight: 1.5, wordBreak: "break-all" }}>
            {config.resolvedConfig.trigger_type}: {JSON.stringify(config.resolvedConfig.trigger_config || {})}
          </div>
        </div>
      )}
    </>
  );
}

// ── Send Email Config ──

function SendEmailConfig({ config, onChange }) {
  return (
    <>
      <PlainEnglishHint />

      <ConfigField label="Describe the email">
        <TextInput
          value={config.description}
          onChange={(v) => onChange({ ...config, description: v })}
          placeholder='e.g. "Send a summary of overdue tasks to the team lead"'
          multiline
        />
      </ConfigField>

      <ConfigField label="To">
        <TextInput
          value={config.to}
          onChange={(v) => onChange({ ...config, to: v })}
          placeholder="team@example.com or {{assignee_email}}"
        />
      </ConfigField>

      <ConfigField label="Subject">
        <TextInput
          value={config.subject}
          onChange={(v) => onChange({ ...config, subject: v })}
          placeholder="e.g. Weekly Report: {{date}}"
        />
      </ConfigField>
    </>
  );
}

// ── Do Config (plain English action, AI-interpreted) ──

function DoConfig({ config, onChange }) {
  return (
    <>
      <PlainEnglishHint />

      <ConfigField label="What should happen?">
        <TextInput
          value={config.description}
          onChange={(v) => onChange({ ...config, description: v, resolved: false, resolvedConfig: null })}
          placeholder={'e.g. "Create a summary of all campaigns and send as email to team@company.com"\n"Post a notification with today\'s overdue count"\n"Update all In Progress tasks to Review"\n"Query the Projects database for items due this week"'}
          multiline
        />
      </ConfigField>

      {/* Show resolved config if interpreted */}
      {config.resolved && config.resolvedConfig && (
        <div style={{
          marginTop: 4, padding: "8px 10px",
          background: C.accent + "10", border: `1px solid ${C.accent}30`,
          borderRadius: RADIUS.sm,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 4 }}>
            <span style={{ fontSize: 9, fontWeight: 600, color: C.accent, textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: FONT }}>
              Interpreted
            </span>
          </div>
          <div style={{ fontSize: 10, color: C.darkText, fontFamily: MONO, lineHeight: 1.5, wordBreak: "break-all" }}>
            {config.resolvedConfig.action_type}: {JSON.stringify(config.resolvedConfig.action_config || {})}
          </div>
        </div>
      )}
    </>
  );
}

function ActionUpdateConfig({ config, onChange }) {
  return (
    <>
      <ConfigField label="Describe in plain English">
        <TextInput value={config.description} onChange={(v) => onChange({ ...config, description: v })} placeholder='e.g. "Set Status to Done and Completed Date to today"' multiline />
      </ConfigField>

      <ConfigField label="Properties (JSON, optional)">
        <TextInput
          value={config.properties}
          onChange={(v) => onChange({ ...config, properties: v })}
          placeholder='{"Status": "Done"}'
          multiline
        />
      </ConfigField>
    </>
  );
}

function ActionCreateConfig({ config, onChange }) {
  return (
    <>
      <ConfigField label="Describe in plain English">
        <TextInput value={config.description} onChange={(v) => onChange({ ...config, description: v })} placeholder='e.g. "Create a follow-up task with the same assignee"' multiline />
      </ConfigField>

      <ConfigField label="Target Database ID">
        <TextInput value={config.databaseId} onChange={(v) => onChange({ ...config, databaseId: v })} placeholder="Database ID..." />
      </ConfigField>
      <ConfigField label="Properties (JSON, optional)">
        <TextInput
          value={config.properties}
          onChange={(v) => onChange({ ...config, properties: v })}
          placeholder='{"Name": "New Item"}'
          multiline
        />
      </ConfigField>
    </>
  );
}

function ActionNotifyConfig({ config, onChange }) {
  return (
    <>
      <ConfigField label="Describe in plain English">
        <TextInput
          value={config.description}
          onChange={(v) => onChange({ ...config, description: v })}
          placeholder='e.g. "Notify the team when a high-priority task is overdue"'
          multiline
        />
      </ConfigField>

      <ConfigField label="Message (optional)">
        <TextInput
          value={config.message}
          onChange={(v) => onChange({ ...config, message: v })}
          placeholder="Use {{variables}} from upstream nodes..."
          multiline
        />
      </ConfigField>
      <ConfigField label="Type">
        <SelectInput
          value={config.type}
          onChange={(v) => onChange({ ...config, type: v })}
          options={[
            { value: "notification", label: "Notification" },
            { value: "alert", label: "Alert" },
            { value: "summary", label: "Summary" },
          ]}
        />
      </ConfigField>
    </>
  );
}

function TransformConfig({ config, onChange }) {
  return (
    <ConfigField label="Template">
      <TextInput
        value={config.template}
        onChange={(v) => onChange({ ...config, template: v })}
        placeholder="Use {{variables}} to transform data..."
        multiline
      />
    </ConfigField>
  );
}

// ── Function Transform Config ──

function FunctionTransformConfig({ config, onChange }) {
  const [functions, setFunctions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.listCustomFunctions({ status: "active" })
      .then((res) => setFunctions(res?.entries || []))
      .catch(() => setFunctions([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <>
      <ConfigField label="Function">
        {loading ? (
          <div style={{ fontSize: 11, color: C.darkMuted, fontFamily: FONT, padding: "6px 0" }}>
            Loading functions...
          </div>
        ) : functions.length === 0 ? (
          <div style={{ fontSize: 11, color: C.darkMuted, fontFamily: FONT, padding: "6px 0" }}>
            No active functions. Create one from the Functions panel.
          </div>
        ) : (
          <SelectInput
            value={config.functionId || ""}
            onChange={(v) => {
              const fn = functions.find((f) => f.id === v);
              onChange({ ...config, functionId: v, functionName: fn?.name || "" });
            }}
            options={[
              { value: "", label: "Select a function..." },
              ...functions.map((fn) => ({ value: fn.id, label: `${fn.name} (${fn.type})` })),
            ]}
          />
        )}
      </ConfigField>
      {config.functionId && config.functionName && (
        <div style={{
          fontSize: 10, color: C.darkMuted, fontFamily: FONT,
          padding: "4px 8px", background: C.darkBg,
          borderRadius: RADIUS.sm, marginBottom: 12,
        }}>
          Selected: <span style={{ color: "#fff", fontWeight: 500 }}>{config.functionName}</span>
        </div>
      )}
      <ConfigField label="Output Key (optional)">
        <TextInput
          value={config.outputKey || ""}
          onChange={(v) => onChange({ ...config, outputKey: v })}
          placeholder="e.g. enriched — wraps result as { enriched: result }"
        />
      </ConfigField>
      <ConfigField label="Retry on Failure">
        <NumberInput
          value={config.retryCount}
          onChange={(v) => onChange({ ...config, retryCount: v })}
          placeholder="0 (no retry)"
        />
      </ConfigField>
    </>
  );
}

// ── Plugin Transform Config ──

function PluginTransformConfig({ config, onChange }) {
  const [plugins, setPlugins] = useState([]);
  const [manifest, setManifest] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.listCustomFunctions({ status: "active", type: "plugin" })
      .then((res) => setPlugins(res?.entries || []))
      .catch(() => setPlugins([]))
      .finally(() => setLoading(false));
  }, []);

  // Load manifest when plugin selected
  useEffect(() => {
    if (!config.pluginId) { setManifest(null); return; }
    api.getCustomFunction(config.pluginId)
      .then((fn) => {
        const meta = typeof fn.meta === "string" ? JSON.parse(fn.meta) : fn.meta;
        setManifest(meta?.manifest || null);
      })
      .catch(() => setManifest(null));
  }, [config.pluginId]);

  return (
    <>
      <ConfigField label="Plugin">
        {loading ? (
          <div style={{ fontSize: 11, color: C.darkMuted, fontFamily: FONT, padding: "6px 0" }}>Loading plugins...</div>
        ) : plugins.length === 0 ? (
          <div style={{ fontSize: 11, color: C.darkMuted, fontFamily: FONT, padding: "6px 0" }}>
            No active plugins. Create one via chat with save_plugin.
          </div>
        ) : (
          <SelectInput
            value={config.pluginId || ""}
            onChange={(v) => {
              const p = plugins.find((f) => f.id === v);
              onChange({ ...config, pluginId: v, pluginName: p?.name || "", config: {} });
            }}
            options={[
              { value: "", label: "Select a plugin..." },
              ...plugins.map((p) => ({ value: p.id, label: p.name })),
            ]}
          />
        )}
      </ConfigField>

      {/* Dynamic config from manifest */}
      {manifest?.ui?.configSchema && Object.entries(manifest.ui.configSchema).map(([key, schema]) => (
        <ConfigField key={key} label={schema.label || key}>
          {schema.type === "number" ? (
            <NumberInput
              value={config.config?.[key] ?? schema.default ?? ""}
              onChange={(v) => onChange({ ...config, config: { ...config.config, [key]: Number(v) } })}
              placeholder={String(schema.default ?? "")}
            />
          ) : schema.enum ? (
            <SelectInput
              value={config.config?.[key] ?? schema.default ?? ""}
              onChange={(v) => onChange({ ...config, config: { ...config.config, [key]: v } })}
              options={schema.enum.map((e) => ({ value: e, label: e }))}
            />
          ) : (
            <TextInput
              value={config.config?.[key] ?? schema.default ?? ""}
              onChange={(v) => onChange({ ...config, config: { ...config.config, [key]: v } })}
              placeholder={String(schema.default ?? "")}
            />
          )}
        </ConfigField>
      ))}

      {manifest?.capabilities?.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, padding: "4px 0", marginBottom: 8 }}>
          {manifest.capabilities.map((cap) => (
            <span key={cap} style={{
              fontSize: 9, color: C.accent, background: C.accent + "18",
              padding: "2px 6px", borderRadius: 3, fontWeight: 500, fontFamily: FONT,
            }}>
              {cap}
            </span>
          ))}
        </div>
      )}

      <ConfigField label="Output Key (optional)">
        <TextInput
          value={config.outputKey || ""}
          onChange={(v) => onChange({ ...config, outputKey: v })}
          placeholder="e.g. enriched — wraps result as { enriched: result }"
        />
      </ConfigField>
    </>
  );
}

// ── Config form dispatcher ──

function ConfigForm({ node, onConfigChange, defaultDatabaseId, defaultDatabaseName, pages }) {
  const config = node.config || {};
  const onChange = onConfigChange;

  switch (node.subtype) {
    case "when":
      return <WhenConfig config={config} onChange={onChange} defaultDatabaseId={defaultDatabaseId} defaultDatabaseName={defaultDatabaseName} pages={pages} />;
    case "database_change":
    case "status_change":
    case "field_change":
    case "page_created":
      return <TriggerDbChangeConfig config={config} onChange={onChange} />;
    case "schedule":
      return <TriggerScheduleConfig config={config} onChange={onChange} />;
    case "manual":
      return (
        <div style={{ fontSize: 12, color: C.darkMuted, padding: "8px 0", fontFamily: FONT }}>
          Manual triggers have no configuration. Click the ▶ Run button to execute.
        </div>
      );
    case "field_check":
      return <ConditionConfig config={config} onChange={onChange} />;
    case "do":
      return <DoConfig config={config} onChange={onChange} />;
    case "update_page":
      return <ActionUpdateConfig config={config} onChange={onChange} />;
    case "create_page":
      return <ActionCreateConfig config={config} onChange={onChange} />;
    case "post_notification":
      return <ActionNotifyConfig config={config} onChange={onChange} />;
    case "send_email":
      return <SendEmailConfig config={config} onChange={onChange} />;
    case "template":
      return <TransformConfig config={config} onChange={onChange} />;
    case "execute_function":
      return <FunctionTransformConfig config={config} onChange={onChange} />;
    case "execute_plugin":
      return <PluginTransformConfig config={config} onChange={onChange} />;
    default:
      return (
        <div style={{ fontSize: 12, color: C.darkMuted, padding: "8px 0", fontFamily: FONT }}>
          No configuration available for this node type.
        </div>
      );
  }
}

// ── Main Component ──

export default function NodeConfigPanel({ node, onChange, onDelete, onClose, defaultDatabaseId, defaultDatabaseName, pages }) {
  if (!node) return null;

  const typeColor = NODE_TYPE_COLORS[node.type] || C.darkMuted;

  const handleLabelChange = useCallback((e) => {
    onChange(node.id, { label: e.target.value });
  }, [node.id, onChange]);

  const handleConfigChange = useCallback((newConfig) => {
    onChange(node.id, { config: newConfig });
  }, [node.id, onChange]);

  return (
    <div
      style={{
        width: 280,
        flexShrink: 0,
        background: C.darkSurf,
        borderLeft: `1px solid ${C.darkBorder}`,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "14px 16px 12px",
          borderBottom: `1px solid ${C.darkBorder}`,
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        {/* Type color dot */}
        <div style={{
          width: 10,
          height: 10,
          borderRadius: "50%",
          background: typeColor,
          flexShrink: 0,
        }} />
        <span style={{
          fontSize: 10,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.1em",
          color: C.darkMuted,
          fontFamily: FONT,
        }}>
          {node.type}
        </span>
        <button
          onClick={onClose}
          style={{
            marginLeft: "auto",
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: 4,
            display: "flex",
            outline: "none",
          }}
        >
          <IconClose size={10} color={C.darkMuted} />
        </button>
      </div>

      {/* Scrollable content */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "16px",
        }}
      >
        {/* Node label (editable) */}
        <ConfigField label="Label">
          <input
            type="text"
            value={node.label}
            onChange={handleLabelChange}
            style={{
              width: "100%",
              background: C.dark,
              border: `1px solid ${C.darkBorder}`,
              borderRadius: RADIUS.md,
              color: C.darkText,
              fontSize: 13,
              fontWeight: 600,
              fontFamily: FONT,
              padding: "8px 10px",
              outline: "none",
              boxSizing: "border-box",
            }}
          />
        </ConfigField>

        {/* Divider */}
        <div style={{ height: 1, background: C.darkBorder, margin: "8px 0 16px" }} />

        {/* Type-specific config */}
        <ConfigForm node={node} onConfigChange={handleConfigChange} defaultDatabaseId={defaultDatabaseId} defaultDatabaseName={defaultDatabaseName} pages={pages} />
      </div>

      {/* Delete button */}
      <div style={{
        padding: "12px 16px",
        borderTop: `1px solid ${C.darkBorder}`,
      }}>
        <button
          onClick={() => onDelete(node.id)}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            padding: "8px 12px",
            background: "transparent",
            border: `1px solid #E0525244`,
            borderRadius: RADIUS.pill,
            color: "#E05252",
            fontSize: 12,
            fontFamily: FONT,
            cursor: "pointer",
            outline: "none",
            transition: "background 0.12s",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "#E0525218"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
        >
          <IconTrash size={13} color="#E05252" />
          Delete Node
        </button>
      </div>
    </div>
  );
}
