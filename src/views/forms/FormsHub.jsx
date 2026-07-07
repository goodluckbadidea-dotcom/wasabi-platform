// ─── Forms feature — Hub orchestrator ───
// The new "Form" view tab. Three modes:
//   "hub":      directory of all forms defined on this table
//   "designer": editing a form's structure
//   "filler":   filling a specific form (creates new record OR attaches to existing)

import React, { useState, useEffect, useMemo, useCallback } from "react";
import { C, FONT, RADIUS, SHADOW } from "../../design/tokens.js";
import { S } from "../../design/styles.js";
import { hoverBg } from "../../design/interactions.js";
import { IconPlus, IconForm, IconEdit, IconTrash } from "../../design/icons.jsx";
import { globalToast } from "../../context/ToastContext.jsx";
import {
  listForms, createForm, updateForm, deleteForm,
  createFormSubmission, updateFormSubmission, createFormConnection,
} from "../../lib/api.js";
import { buildProp, getPageTitle } from "../../notion/properties.js";
import FormDesigner from "./FormDesigner.jsx";
import FormFiller from "./FormFiller.jsx";
import { makeField } from "./formTypes.js";

export default function FormsHub({
  schema, config = {}, onCreate, pageConfig,
  // Fill context (set when entering via record drawer):
  fillContext,           // { formId, recordId, recordRow, recordTitle } | null
  onFillContextConsumed, // () => void  (called when filler closes)
}) {
  const tableId = pageConfig?.id;
  const [forms, setForms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState("hub"); // "hub" | "designer" | "filler"
  const [activeFormId, setActiveFormId] = useState(null);
  const [filling, setFilling] = useState(null); // { form, connectionId?, submissionId?, recordId?, recordRow?, recordTitle? }

  // Refresh form list
  const refresh = useCallback(async () => {
    if (!tableId) return;
    setLoading(true);
    try {
      const res = await listForms(tableId);
      setForms(res.forms || []);
    } catch (err) {
      console.error("[FormsHub] listForms failed:", err);
    } finally {
      setLoading(false);
    }
  }, [tableId]);

  useEffect(() => { refresh(); }, [refresh]);

  // Table columns — for the "link to column" feature
  const tableColumns = useMemo(() => {
    if (!schema) return [];
    return (schema.allFields || []).map((f) => ({
      id: f.id || f.name,
      name: f.name,
      type: f.type,
      options: f.options || [],
    }));
  }, [schema]);

  // Enter filler from fillContext (drawer click)
  useEffect(() => {
    if (!fillContext || forms.length === 0) return;
    const form = forms.find((f) => f.id === fillContext.formId);
    if (!form) return;
    setMode("filler");
    setActiveFormId(form.id);
    setFilling({
      form,
      connectionId: fillContext.connectionId || null,
      submissionId: fillContext.submissionId || null,
      recordId: fillContext.recordId,
      recordRow: fillContext.recordRow,
      recordTitle: fillContext.recordTitle,
      readOnly: fillContext.readOnly || false,
    });
    onFillContextConsumed?.();
  }, [fillContext, forms, onFillContextConsumed]);

  // ── Hub actions ──
  const handleNewForm = async () => {
    try {
      const res = await createForm(tableId, {
        name: "Untitled form",
        description: "",
        form_type: "single_instance",
        fields: [makeField("short_text", { label: "Project Title", required: true })],
        sort_order: forms.length,
      });
      await refresh();
      setActiveFormId(res.form.id);
      setMode("designer");
    } catch (err) {
      console.error("[FormsHub] create failed:", err);
    }
  };

  const handleOpenForm = (form) => {
    setActiveFormId(form.id);
    if (!form.fields || form.fields.length === 0) {
      // Empty form → go straight to designer
      setMode("designer");
    } else {
      // Start filling (no record context — creates new record on submit)
      setMode("filler");
      setFilling({
        form,
        connectionId: null,
        submissionId: null,
        recordId: null,
        recordRow: null,
        recordTitle: null,
        readOnly: false,
      });
    }
  };

  const handleEditForm = (form) => {
    setActiveFormId(form.id);
    setMode("designer");
  };

  const handleDeleteForm = async (form) => {
    if (!window.confirm(`Delete form "${form.name}"? This also removes all its submissions.`)) return;
    try {
      await deleteForm(form.id);
      await refresh();
      if (activeFormId === form.id) {
        setActiveFormId(null);
        setMode("hub");
      }
      globalToast("Form deleted", "success");
    } catch (err) {
      console.error("[FormsHub] delete failed:", err);
      globalToast(`Delete failed: ${err?.message || "unknown error"}`, "error");
    }
  };

  // ── Designer save ──
  const handleSaveDesign = async (draft) => {
    try {
      await updateForm(draft.id, {
        name: draft.name,
        description: draft.description,
        form_type: draft.form_type,
        fields: draft.fields,
      });
      await refresh();
      setMode("hub");
    } catch (err) {
      console.error("[FormsHub] save design failed:", err);
      alert("Save failed: " + (err.message || err));
    }
  };

  // ── Filler save ──
  const handleAutoSave = async (values) => {
    if (!filling) return;
    // Has a submission row yet?
    if (filling.submissionId) {
      await updateFormSubmission(filling.submissionId, { values });
    } else {
      // First keystroke — create the draft submission
      let connectionId = filling.connectionId;
      if (filling.recordId && !connectionId) {
        // Create a connection on-demand (record context fill, no prior connection)
        try {
          const cRes = await createFormConnection({
            form_id: filling.form.id,
            record_id: filling.recordId,
            table_id: tableId,
          });
          connectionId = cRes.connection?.id;
        } catch (err) {
          if (err?.data?.code === "ALREADY_CONNECTED") {
            connectionId = err.data.connection_id;
          } else { throw err; }
        }
      }
      if (!connectionId && !filling.recordId) {
        // No record context yet — defer creating a submission row until submit
        return;
      }
      const subRes = await createFormSubmission({
        connection_id: connectionId,
        form_id: filling.form.id,
        record_id: filling.recordId,
        status: "draft",
        values,
      });
      setFilling((prev) => prev ? { ...prev, connectionId, submissionId: subRes.submission.id } : prev);
    }
  };

  const handleSubmit = async (values) => {
    if (!filling) return { error: "No form context" };
    try {
      // No record context → create new record from linked-field values
      if (!filling.recordId) {
        return await submitCreateRecord(values);
      }
      // Has record context → flip submission status to "submitted"
      let { connectionId, submissionId } = filling;
      if (!connectionId) {
        try {
          const cRes = await createFormConnection({
            form_id: filling.form.id,
            record_id: filling.recordId,
            table_id: tableId,
          });
          connectionId = cRes.connection?.id;
        } catch (err) {
          if (err?.data?.code === "ALREADY_CONNECTED") {
            connectionId = err.data.connection_id;
          } else { throw err; }
        }
      }
      if (!submissionId) {
        const subRes = await createFormSubmission({
          connection_id: connectionId,
          form_id: filling.form.id,
          record_id: filling.recordId,
          status: "submitted",
          values,
        });
        submissionId = subRes.submission.id;
      } else {
        await updateFormSubmission(submissionId, { values, status: "submitted" });
      }
      // Also: write linked-field values to the record's columns
      await writeLinkedFieldsToRecord(filling.form, values, filling.recordRow);
      // Done — back to hub (or signal drawer to re-open)
      window.dispatchEvent(new CustomEvent("wasabi:form-submitted", {
        detail: { recordId: filling.recordId, submissionId, formId: filling.form.id },
      }));
      setMode("hub");
      setFilling(null);
      return { ok: true };
    } catch (err) {
      console.error("[FormsHub] submit failed:", err);
      return { error: err.message || "Save failed" };
    }
  };

  // Create-new-record submit path (no record context)
  const submitCreateRecord = async (values) => {
    if (!onCreate) return { error: "Record creation not available" };
    // Build a Notion-style properties payload from linked fields
    const props = {};
    const linkedFormOnlyValues = {};
    for (const field of (filling.form.fields || [])) {
      if (field.kind === "layout") continue;
      const v = values[field.id];
      if (field.linked_column_id) {
        const col = tableColumns.find((c) => c.id === field.linked_column_id);
        if (col) {
          const notionType = mapTypeToNotion(field.type);
          try {
            props[col.name] = buildProp(notionType, v);
          } catch {}
        }
      } else {
        linkedFormOnlyValues[field.id] = v;
      }
    }
    // Create the record
    const dbId = pageConfig?.databaseIds?.[0] || pageConfig?.id;
    const created = await onCreate(dbId, props);
    const newRecordId = created?.id || created?.row_id || null;
    // Save a submission attached to the new record (so form-only data is preserved)
    if (newRecordId && Object.keys(linkedFormOnlyValues).length > 0) {
      try {
        const cRes = await createFormConnection({
          form_id: filling.form.id,
          record_id: newRecordId,
          table_id: tableId,
        });
        await createFormSubmission({
          connection_id: cRes.connection?.id,
          form_id: filling.form.id,
          record_id: newRecordId,
          status: "submitted",
          values: linkedFormOnlyValues,
        });
      } catch (err) {
        console.warn("[FormsHub] attach-to-new-record submission failed:", err);
      }
    }
    setMode("hub");
    setFilling(null);
    return { ok: true };
  };

  const writeLinkedFieldsToRecord = async (form, values, recordRow) => {
    if (!recordRow) return;
    // We rely on the parent table's onUpdate flow — but FormsHub doesn't have
    // direct access to that. For v1, we emit an event the host can listen to.
    const cellUpdates = {};
    for (const field of (form.fields || [])) {
      if (!field.linked_column_id) continue;
      const col = tableColumns.find((c) => c.id === field.linked_column_id);
      if (!col) continue;
      const v = values[field.id];
      const notionType = mapTypeToNotion(field.type);
      try {
        cellUpdates[col.name] = buildProp(notionType, v);
      } catch {}
    }
    if (Object.keys(cellUpdates).length > 0) {
      window.dispatchEvent(new CustomEvent("wasabi:form-linked-write", {
        detail: { recordId: recordRow.id, properties: cellUpdates },
      }));
    }
  };

  // ─── Render ───

  if (loading) {
    return (
      <div style={{ padding: 32, color: C.darkMuted, fontFamily: FONT, fontSize: 13 }}>
        Loading forms…
      </div>
    );
  }

  if (mode === "designer") {
    const form = forms.find((f) => f.id === activeFormId);
    if (!form) {
      return <EmptyHub onNew={handleNewForm} />;
    }
    return (
      <div style={{ padding: "24px 0" }}>
        <FormDesigner
          form={form}
          tableColumns={tableColumns}
          onSave={handleSaveDesign}
          onCancel={() => setMode("hub")}
        />
      </div>
    );
  }

  if (mode === "filler" && filling) {
    return (
      <div style={{ display: "flex", height: "100%", fontFamily: FONT }}>
        {/* Forms navigator (visible by default) */}
        <div style={{
          width: 200, flexShrink: 0,
          borderRight: `1px solid ${C.edgeLine}`,
          padding: "16px 12px",
          background: C.darkSurf,
          overflowY: "auto",
        }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: C.darkMuted, textTransform: "uppercase", letterSpacing: "0.06em", padding: "0 4px 8px" }}>
            Forms
          </div>
          {forms.map((f) => {
            const active = f.id === filling.form.id;
            return (
              <button
                key={f.id}
                onClick={() => setFilling((prev) => prev ? { ...prev, form: f, submissionId: null, connectionId: null } : prev)}
                style={{
                  display: "block", width: "100%", textAlign: "left",
                  padding: "6px 10px", border: "none", cursor: "pointer",
                  background: active ? `${C.accent}14` : "transparent",
                  color: active ? C.accent : C.darkText,
                  borderRadius: RADIUS.sm, fontSize: 12, fontFamily: FONT,
                  marginBottom: 2,
                }}
              >{f.name}</button>
            );
          })}
        </div>
        {/* Form body */}
        <div style={{ flex: 1, overflowY: "auto" }}>
          <FormFiller
            form={filling.form}
            initialValues={{}}
            recordRow={filling.recordRow}
            recordTitle={filling.recordTitle}
            readOnly={filling.readOnly}
            onAutoSave={handleAutoSave}
            onSubmit={handleSubmit}
            onClearContext={() => setFilling((prev) => prev ? { ...prev, recordId: null, recordRow: null, recordTitle: null } : prev)}
            onBack={() => { setMode("hub"); setFilling(null); }}
          />
        </div>
      </div>
    );
  }

  // ── Hub view ──
  if (forms.length === 0) {
    return <EmptyHub onNew={handleNewForm} />;
  }
  return (
    <div style={{ padding: "24px 16px", fontFamily: FONT, maxWidth: 720, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: C.darkText }}>Forms</h2>
        <button onClick={handleNewForm} style={{
          ...S.btnPrimary, padding: "8px 14px", fontSize: 12,
          display: "inline-flex", alignItems: "center", gap: 6,
          borderRadius: RADIUS.pill,
        }}>
          <IconPlus size={12} /> New form
        </button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {forms.map((f) => (
          <FormCard
            key={f.id}
            form={f}
            onOpen={() => handleOpenForm(f)}
            onEdit={() => handleEditForm(f)}
            onDelete={() => handleDeleteForm(f)}
          />
        ))}
      </div>
    </div>
  );
}

function EmptyHub({ onNew }) {
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      gap: 14, padding: 60, color: C.darkMuted, fontFamily: FONT, textAlign: "center",
    }}>
      <IconForm size={36} color={C.darkMuted} />
      <div style={{ fontSize: 16, fontWeight: 600, color: C.darkText }}>No forms yet</div>
      <div style={{ fontSize: 13, maxWidth: 320, lineHeight: 1.5 }}>
        Forms let you collect structured data — create records quickly, or
        attach forms to existing records as a way to capture extra context.
      </div>
      <button onClick={onNew} style={{
        ...S.btnPrimary, padding: "10px 18px", fontSize: 13,
        display: "inline-flex", alignItems: "center", gap: 6,
        borderRadius: RADIUS.pill,
      }}>
        <IconPlus size={12} /> Build your first form
      </button>
    </div>
  );
}

function FormCard({ form, onOpen, onEdit, onDelete }) {
  const fieldCount = (form.fields || []).filter((f) => f.kind !== "layout").length;
  return (
    <div
      style={{
        display: "flex", alignItems: "center", gap: 12,
        padding: "14px 16px",
        background: C.darkSurf,
        border: `1px solid ${C.darkBorder}`,
        borderRadius: RADIUS.lg,
        cursor: "pointer",
        transition: "border-color 0.12s, background 0.12s",
      }}
      onClick={onOpen}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = C.accent + "55"; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = C.darkBorder; }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: C.darkText }}>{form.name}</span>
          <span style={{
            fontSize: 10, padding: "1px 8px", borderRadius: RADIUS.pill,
            background: C.darkSurf2, color: C.darkMuted,
            textTransform: "uppercase", letterSpacing: "0.06em",
          }}>
            {form.form_type === "repeating" ? "Repeating" : "Fill once"}
          </span>
        </div>
        {form.description && (
          <div style={{ fontSize: 11, color: C.darkMuted, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {form.description}
          </div>
        )}
        <div style={{ fontSize: 10, color: C.darkMuted, marginTop: 4 }}>
          {fieldCount} field{fieldCount === 1 ? "" : "s"}
        </div>
      </div>
      <div style={{ display: "flex", gap: 4 }}>
        <button
          onClick={(e) => { e.stopPropagation(); onEdit(); }}
          style={iconBtn}
          title="Edit form"
          aria-label="Edit form"
        >
          <IconEdit size={14} color={C.darkMuted} />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          style={{ ...iconBtn, color: C.error }}
          title="Delete form"
          aria-label="Delete form"
        >
          <IconTrash size={14} color={C.error} />
        </button>
      </div>
    </div>
  );
}

const iconBtn = {
  background: "transparent", border: "none", color: C.darkMuted,
  cursor: "pointer", padding: 8, borderRadius: RADIUS.sm,
  display: "inline-flex", alignItems: "center", justifyContent: "center",
  minWidth: 30, minHeight: 30,
};

function mapTypeToNotion(blockType) {
  const map = {
    short_text: "rich_text", long_text: "rich_text",
    number: "number", date: "date", date_range: "date",
    single_select: "select", multi_select: "multi_select", status: "status",
    checkbox: "checkbox", url: "url", email: "email", phone: "phone_number",
    person: "people", linked_record: "relation", figma_file: "figma_files",
  };
  return map[blockType] || "rich_text";
}
