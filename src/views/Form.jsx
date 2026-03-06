// ─── Form View ───
// Auto-generates a form from database schema. Creates new records.

import React, { useState, useMemo, useCallback } from "react";
import { C, FONT, RADIUS } from "../design/tokens.js";
import { S } from "../design/styles.js";
import { getFieldType, getFieldOptions, resolveField } from "./_viewHelpers.js";
import { buildProp } from "../notion/properties.js";
import { cellStyles } from "./_CellComponents.jsx";

const EDITABLE_TYPES = new Set([
  "title", "rich_text", "number", "select", "status",
  "date", "checkbox", "url", "email", "phone_number", "multi_select",
]);

const NON_FORM_TYPES = new Set([
  "formula", "rollup", "created_time", "last_edited_time",
  "created_by", "last_edited_by", "unique_id",
]);

export default function Form({ data = [], schema, config = {}, onCreate, pageConfig }) {
  const [values, setValues] = useState({});
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  // Resolve which fields to show
  const formFields = useMemo(() => {
    if (!schema) return [];

    // If config specifies fields, use those
    if (config.fields && config.fields.length > 0) {
      return config.fields
        .map((name) => schema.allFields.find((f) => f.name === name))
        .filter(Boolean)
        .filter((f) => !NON_FORM_TYPES.has(f.type));
    }

    // Auto-detect: all editable fields, title first
    const fields = [];
    if (schema.title) fields.push(schema.title);

    const ordered = [
      ...(schema.statuses || []),
      ...(schema.selects || []),
      ...(schema.numbers || []),
      ...(schema.dates || []),
      ...(schema.richTexts || []),
      ...(schema.checkboxes || []),
      ...(schema.urls || []),
      ...(schema.emails || []),
      ...(schema.phones || []),
      ...(schema.multiSelects || []),
    ];

    for (const f of ordered) {
      if (!fields.find((x) => x.name === f.name)) {
        fields.push(f);
      }
    }

    return fields;
  }, [schema, config.fields]);

  const databaseId = config.databaseId || pageConfig?.databaseIds?.[0];

  const handleChange = useCallback((fieldName, value) => {
    setValues((prev) => ({ ...prev, [fieldName]: value }));
    setErrors((prev) => ({ ...prev, [fieldName]: null }));
    setSuccess(false);
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!onCreate || !databaseId) return;

    // Validate: title is required
    const titleField = schema?.title;
    if (titleField && !values[titleField.name]?.trim()) {
      setErrors({ [titleField.name]: "Required" });
      return;
    }

    setSubmitting(true);
    setErrors({});

    try {
      // Build Notion properties object
      const properties = {};
      for (const field of formFields) {
        const val = values[field.name];
        if (val === undefined || val === null || val === "") continue;

        const prop = buildProp(field.type, val);
        if (prop !== undefined) {
          properties[field.name] = prop;
        }
      }

      await onCreate(databaseId, properties);
      setValues({});
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      setErrors({ _form: err.message || "Failed to create record" });
    } finally {
      setSubmitting(false);
    }
  }, [onCreate, databaseId, schema, values, formFields]);

  if (!schema) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: C.darkMuted, fontSize: 14, fontFamily: FONT }}>
        Loading schema...
      </div>
    );
  }

  if (!databaseId) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: C.darkMuted, fontSize: 14, fontFamily: FONT }}>
        No database configured for this form.
      </div>
    );
  }

  return (
    <div style={{
      display: "flex",
      justifyContent: "center",
      padding: "32px 20px",
      overflowY: "auto",
      flex: 1,
      fontFamily: FONT,
    }}>
      <div style={{ width: "100%", maxWidth: 480 }}>
        {/* Header */}
        <h2 style={{
          fontSize: 18,
          fontWeight: 700,
          color: C.darkText,
          marginBottom: 24,
          letterSpacing: "-0.01em",
        }}>
          New Record
        </h2>

        {/* Form fields */}
        {formFields.map((field) => (
          <FormField
            key={field.name}
            field={field}
            value={values[field.name]}
            error={errors[field.name]}
            schema={schema}
            onChange={(val) => handleChange(field.name, val)}
          />
        ))}

        {/* Error */}
        {errors._form && (
          <div style={{
            padding: "10px 14px",
            background: "#E0525218",
            border: "1px solid #E0525240",
            borderRadius: RADIUS.md,
            color: "#E05252",
            fontSize: 13,
            marginBottom: 16,
          }}>
            {errors._form}
          </div>
        )}

        {/* Success */}
        {success && (
          <div style={{
            padding: "10px 14px",
            background: C.accent + "18",
            border: `1px solid ${C.accent}40`,
            borderRadius: RADIUS.md,
            color: C.accent,
            fontSize: 13,
            marginBottom: 16,
            animation: "fadeUp 0.3s ease",
          }}>
            Record created successfully!
          </div>
        )}

        {/* Submit button */}
        <button
          onClick={handleSubmit}
          disabled={submitting}
          style={{
            ...S.btnPrimary,
            width: "100%",
            padding: "12px 24px",
            fontSize: 14,
            fontWeight: 600,
            opacity: submitting ? 0.6 : 1,
            cursor: submitting ? "not-allowed" : "pointer",
          }}
        >
          {submitting ? "Creating..." : "Create Record"}
        </button>
      </div>
    </div>
  );
}


// ─── Form Field Component ───

function FormField({ field, value, error, schema, onChange }) {
  const { name, type } = field;
  const options = getFieldOptions(schema, name);
  const optNames = options.map((o) => o.name);

  const labelStyle = {
    display: "block",
    fontSize: 11,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    color: C.darkMuted,
    marginBottom: 6,
  };

  const inputStyle = {
    width: "100%",
    background: C.darkSurf,
    border: `1px solid ${error ? "#E05252" : C.darkBorder}`,
    borderRadius: RADIUS.md,
    padding: "10px 14px",
    fontSize: 14,
    fontFamily: FONT,
    color: C.darkText,
    outline: "none",
    boxSizing: "border-box",
    transition: "border-color 0.15s",
  };

  const wrapStyle = { marginBottom: 18 };

  // Checkbox
  if (type === "checkbox") {
    return (
      <div style={wrapStyle}>
        <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
          <span
            style={cellStyles.toggle(!!value)}
            onClick={() => onChange(!value)}
          >
            {value ? "\u2713" : ""}
          </span>
          <span style={{ fontSize: 13, color: C.darkText }}>{name}</span>
        </label>
      </div>
    );
  }

  // Select / Status
  if (type === "select" || type === "status") {
    return (
      <div style={wrapStyle}>
        <label style={labelStyle}>{name}</label>
        <select
          value={value || ""}
          onChange={(e) => onChange(e.target.value || null)}
          style={{ ...inputStyle, cursor: "pointer", appearance: "none" }}
        >
          <option value="">-- Select --</option>
          {optNames.map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
        {error && <span style={{ fontSize: 11, color: "#E05252", marginTop: 4, display: "block" }}>{error}</span>}
      </div>
    );
  }

  // Multi-select (comma-separated input)
  if (type === "multi_select") {
    const selectedTags = Array.isArray(value) ? value : (value ? value.split(",").map((s) => s.trim()).filter(Boolean) : []);
    return (
      <div style={wrapStyle}>
        <label style={labelStyle}>{name}</label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 6 }}>
          {selectedTags.map((tag, i) => (
            <span key={i} style={{
              ...cellStyles.pill(C.accent),
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              cursor: "pointer",
            }} onClick={() => {
              const updated = selectedTags.filter((_, j) => j !== i);
              onChange(updated.length > 0 ? updated : null);
            }}>
              {tag} <span style={{ fontSize: 10, opacity: 0.7 }}>&times;</span>
            </span>
          ))}
        </div>
        <select
          value=""
          onChange={(e) => {
            if (e.target.value && !selectedTags.includes(e.target.value)) {
              onChange([...selectedTags, e.target.value]);
            }
            e.target.value = "";
          }}
          style={{ ...inputStyle, cursor: "pointer", appearance: "none" }}
        >
          <option value="">Add {name}...</option>
          {optNames.filter((o) => !selectedTags.includes(o)).map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      </div>
    );
  }

  // Date
  if (type === "date") {
    return (
      <div style={wrapStyle}>
        <label style={labelStyle}>{name}</label>
        <input
          type="date"
          value={value || ""}
          onChange={(e) => onChange(e.target.value || null)}
          style={inputStyle}
        />
        {error && <span style={{ fontSize: 11, color: "#E05252", marginTop: 4, display: "block" }}>{error}</span>}
      </div>
    );
  }

  // Number
  if (type === "number") {
    return (
      <div style={wrapStyle}>
        <label style={labelStyle}>{name}</label>
        <input
          type="number"
          step="any"
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value === "" ? null : parseFloat(e.target.value))}
          style={inputStyle}
        />
        {error && <span style={{ fontSize: 11, color: "#E05252", marginTop: 4, display: "block" }}>{error}</span>}
      </div>
    );
  }

  // Default: text input (title, rich_text, url, email, phone_number)
  return (
    <div style={wrapStyle}>
      <label style={labelStyle}>
        {name}
        {type === "title" && <span style={{ color: "#E05252", marginLeft: 3 }}>*</span>}
      </label>
      <input
        type={type === "email" ? "email" : type === "url" ? "url" : "text"}
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder={type === "title" ? "Required" : ""}
        style={inputStyle}
      />
      {error && <span style={{ fontSize: 11, color: "#E05252", marginTop: 4, display: "block" }}>{error}</span>}
    </div>
  );
}
