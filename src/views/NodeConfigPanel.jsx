// ─── Node Config Panel ───
// Right-side panel (280px) for editing the selected node's configuration.
// Shows type-specific config fields.

import React, { useCallback } from "react";
import { C, FONT, RADIUS } from "../design/tokens.js";
import { NODE_TYPE_COLORS } from "./NodeRenderer.jsx";
import { IconTrash, IconClose } from "../design/icons.jsx";

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

function ActionUpdateConfig({ config, onChange }) {
  return (
    <>
      <ConfigField label="Description">
        <TextInput value={config.description} onChange={(v) => onChange({ ...config, description: v })} placeholder="What to update..." />
      </ConfigField>
      <ConfigField label="Properties (JSON)">
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
      <ConfigField label="Target Database ID">
        <TextInput value={config.databaseId} onChange={(v) => onChange({ ...config, databaseId: v })} placeholder="Database ID..." />
      </ConfigField>
      <ConfigField label="Properties (JSON)">
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
      <ConfigField label="Message">
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

// ── Config form dispatcher ──

function ConfigForm({ node, onConfigChange }) {
  const config = node.config || {};
  const onChange = onConfigChange;

  switch (node.subtype) {
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
    case "update_page":
      return <ActionUpdateConfig config={config} onChange={onChange} />;
    case "create_page":
      return <ActionCreateConfig config={config} onChange={onChange} />;
    case "post_notification":
      return <ActionNotifyConfig config={config} onChange={onChange} />;
    case "template":
      return <TransformConfig config={config} onChange={onChange} />;
    default:
      return (
        <div style={{ fontSize: 12, color: C.darkMuted, padding: "8px 0", fontFamily: FONT }}>
          No configuration available for this node type.
        </div>
      );
  }
}

// ── Main Component ──

export default function NodeConfigPanel({ node, onChange, onDelete, onClose }) {
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
        <ConfigForm node={node} onConfigChange={handleConfigChange} />
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
            borderRadius: RADIUS.md,
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
