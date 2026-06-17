// ─── Forms feature — Form Filler ───
// Renders one form in fill mode (or read-only mode).
// Auto-saves typing into the active submission row (debounced).

import React, { useState, useEffect, useRef, useMemo } from "react";
import { C, FONT, RADIUS } from "../../design/tokens.js";
import { S } from "../../design/styles.js";
import FieldRenderer from "./FieldRenderer.jsx";
import { findBlockDef } from "./formTypes.js";

const DEBOUNCE_MS = 900;

export default function FormFiller({
  form,
  initialValues = {},
  recordRow = null,       // the record being filled for (when attached)
  recordTitle = null,
  readOnly = false,
  onAutoSave,             // (values) => Promise  (called debounced)
  onSubmit,               // (values) => Promise<{ ok, error? }>
  onClearContext,         // [x] click on context bar
  onBack,                 // "Back to record" link (read-only)
  submittedAt,            // for read-only mode header
  submittedByName,
  editedAt,
  editedByName,
  draftByName,
  isDraft = false,
  onEdit,                 // optional — flip read-only back to edit (for editable submitted)
}) {
  const [values, setValues] = useState(initialValues);
  const [invalidIds, setInvalidIds] = useState(new Set());
  const [savingState, setSavingState] = useState("idle"); // "idle" | "saving" | "saved"
  const [submitError, setSubmitError] = useState(null);
  const debounceTimer = useRef(null);
  const lastSavedAt = useRef(0);
  const valuesRef = useRef(initialValues);

  useEffect(() => {
    setValues(initialValues);
    valuesRef.current = initialValues;
  }, [form?.id]);

  // Linked-field overlay: when a record is attached, prefill linked fields
  // from the record's column values. We do this on initial render and on
  // record change.
  const linkedFieldValues = useMemo(() => {
    if (!recordRow || !form?.fields) return {};
    const out = {};
    const props = recordRow.properties || {};
    for (const field of form.fields) {
      if (!field.linked_column_id) continue;
      // Try to find the column by id, then read the property by its name.
      // Wasabi stores cells keyed by column name in page.properties; columns
      // come in as { id, name }. We look up the name via the form's
      // tableColumns context, but FormFiller only knows the field — so we
      // fall back to a simple "look for a property whose key matches
      // any plausible mapping." For now, store id-linked reads under a
      // synthetic key the parent should fill in.
      // The caller is responsible for resolving linked column values into
      // `initialValues[fieldId]` before passing them in.
      void field;
    }
    return out;
  }, [form, recordRow]);

  // Debounced auto-save
  const scheduleAutoSave = (next) => {
    if (readOnly || !onAutoSave) return;
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(async () => {
      setSavingState("saving");
      try {
        await onAutoSave(next);
        lastSavedAt.current = Date.now();
        setSavingState("saved");
        setTimeout(() => setSavingState((s) => s === "saved" ? "idle" : s), 1400);
      } catch (err) {
        console.error("[FormFiller] auto-save failed:", err);
        setSavingState("idle");
      }
    }, DEBOUNCE_MS);
  };

  // Final save when navigating away
  useEffect(() => {
    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
        if (onAutoSave && !readOnly) {
          onAutoSave(valuesRef.current).catch(() => {});
        }
      }
    };
  }, []);

  const setFieldValue = (fieldId, v) => {
    const next = { ...valuesRef.current, [fieldId]: v };
    valuesRef.current = next;
    setValues(next);
    if (invalidIds.has(fieldId)) {
      const nextInvalid = new Set(invalidIds);
      nextInvalid.delete(fieldId);
      setInvalidIds(nextInvalid);
    }
    scheduleAutoSave(next);
  };

  const handleSubmit = async () => {
    // Validate required fields
    const missing = new Set();
    for (const field of form.fields || []) {
      if (field.kind === "layout") continue;
      if (!field.required) continue;
      const v = values[field.id];
      const empty = v === null || v === undefined || v === "" ||
        (Array.isArray(v) && v.length === 0);
      if (empty) missing.add(field.id);
    }
    if (missing.size > 0) {
      setInvalidIds(missing);
      setSubmitError(`Please fill in ${missing.size} required ${missing.size === 1 ? "field" : "fields"}.`);
      // Scroll to first invalid
      const firstId = [...missing][0];
      const el = document.querySelector(`[data-field-id="${firstId}"]`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    // Also: type validation (URL/email/phone) — simple regex pass
    const typeInvalid = new Set();
    for (const field of form.fields || []) {
      if (field.kind === "layout") continue;
      const v = values[field.id];
      if (!v) continue;
      if (field.type === "email" && !/^\S+@\S+\.\S+$/.test(String(v))) typeInvalid.add(field.id);
      if (field.type === "url" && !/^https?:\/\//.test(String(v))) typeInvalid.add(field.id);
    }
    if (typeInvalid.size > 0) {
      setInvalidIds(typeInvalid);
      setSubmitError("Some fields are not formatted correctly.");
      return;
    }
    setSubmitError(null);
    if (onSubmit) {
      const res = await onSubmit(values);
      if (res && res.error) setSubmitError(res.error);
    }
  };

  if (!form) {
    return (
      <div style={{ padding: 24, color: C.darkMuted, fontFamily: FONT, fontSize: 14 }}>
        Form not found.
      </div>
    );
  }

  return (
    <div style={{ fontFamily: FONT }}>
      {/* ── Sticky context bar ── */}
      {recordRow && (
        <div style={{
          position: "sticky", top: 0, zIndex: 5,
          padding: "10px 16px",
          background: C.darkSurf2,
          borderBottom: `1px solid ${C.darkBorder}`,
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <span style={{ fontSize: 12, color: C.darkText, display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ color: C.accent }}>▶</span>
            {readOnly ? (
              <>
                {submittedAt
                  ? `Submitted ${formatDate(submittedAt)}${submittedByName ? ` by ${submittedByName}` : ""}`
                  : draftByName
                  ? `Draft started by ${draftByName}`
                  : "Read-only"}
                {editedAt && (
                  <span style={{ color: C.darkMuted, marginLeft: 8 }}>
                    · edited {formatDate(editedAt)}{editedByName ? ` by ${editedByName}` : ""}
                  </span>
                )}
              </>
            ) : (
              <>Filling for: <strong style={{ color: C.darkText }}>{recordTitle || "Record"}</strong></>
            )}
          </span>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            {savingState === "saving" && (
              <span style={{ fontSize: 11, color: C.darkMuted }}>Saving…</span>
            )}
            {savingState === "saved" && (
              <span style={{ fontSize: 11, color: C.darkMuted }}>Draft saved</span>
            )}
            {readOnly && onEdit && (
              <button onClick={onEdit} style={{ ...S.btnGhost, fontSize: 11, padding: "4px 10px" }}>Edit</button>
            )}
            {!readOnly && onClearContext && (
              <button
                onClick={onClearContext}
                title="Remove record context"
                style={{
                  background: "transparent", border: "none",
                  color: C.darkMuted, cursor: "pointer", fontSize: 14, lineHeight: 1, padding: 4,
                }}
              >×</button>
            )}
            {readOnly && onBack && (
              <button onClick={onBack} style={{ ...S.btnGhost, fontSize: 11, padding: "4px 10px" }}>
                Back to record
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Form column ── */}
      <div style={{ maxWidth: 640, margin: "0 auto", padding: "28px 16px 60px" }}>
        <h2 style={{
          fontFamily: FONT, fontSize: 24, fontWeight: 700,
          color: C.darkText, margin: "0 0 4px",
        }}>{form.name}</h2>
        {form.description && (
          <div style={{ fontSize: 13, color: C.darkMuted, marginBottom: 18 }}>
            {form.description}
          </div>
        )}
        <div style={{ borderTop: `1px solid ${C.edgeLine}`, margin: "16px 0 24px" }} />

        {/* ── Fields ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {(form.fields || []).map((field) => (
            <FieldRow
              key={field.id}
              field={field}
              value={values[field.id]}
              onChange={(v) => setFieldValue(field.id, v)}
              readOnly={readOnly}
              invalid={invalidIds.has(field.id)}
            />
          ))}
        </div>

        {/* ── Save bar ── */}
        {!readOnly && (
          <div style={{ marginTop: 32 }}>
            {submitError && (
              <div style={{
                padding: "10px 14px", marginBottom: 10,
                background: `${C.error}10`, color: C.error,
                borderRadius: RADIUS.md, fontSize: 12,
              }}>
                {submitError}
              </div>
            )}
            <button
              onClick={handleSubmit}
              style={{
                ...S.btnPrimary,
                width: "100%", padding: "12px 0",
                fontSize: 14, fontWeight: 700,
                borderRadius: RADIUS.pill,
              }}
            >
              Save submission
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function FieldRow({ field, value, onChange, readOnly, invalid }) {
  if (field.kind === "layout") {
    if (field.type === "section_header") {
      return (
        <div style={{
          fontSize: 14, fontWeight: 700, color: C.darkText,
          paddingTop: 8, paddingBottom: 4,
        }}>{field.label}</div>
      );
    }
    if (field.type === "description_text") {
      return (
        <div style={{ fontSize: 13, color: C.darkMuted, lineHeight: 1.5 }}>
          {field.label}
        </div>
      );
    }
    if (field.type === "divider") {
      return <div style={{ borderTop: `1px solid ${C.edgeLine}`, margin: "8px 0" }} />;
    }
    return null;
  }
  return (
    <div data-field-id={field.id} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label style={{
        fontSize: 10, fontWeight: 700, textTransform: "uppercase",
        letterSpacing: "0.06em", color: C.darkMuted,
        display: "flex", alignItems: "center", gap: 4,
      }}>
        {field.label}
        {field.required && <span style={{ color: C.error }}>*</span>}
      </label>
      <FieldRenderer
        field={field}
        value={value}
        onChange={onChange}
        readOnly={readOnly}
        invalid={invalid}
      />
      {field.helper_text && (
        <div style={{ fontSize: 11, color: C.darkMuted, fontStyle: "italic" }}>
          {field.helper_text}
        </div>
      )}
      {invalid && (
        <div style={{ fontSize: 11, color: C.error }}>
          Please fill this in.
        </div>
      )}
    </div>
  );
}

function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
