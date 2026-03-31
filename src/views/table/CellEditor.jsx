// ─── Table Cell Editor ───
// Full-featured inline editor for Table view cells.
// Diverges from _CellComponents.jsx: uses SelectPicker/MultiSelectPicker,
// advanced date editor with end date/time/quick buttons, initialChar support.

import React, { useState, useEffect, useCallback, useRef } from "react";
import { C, FONT, RADIUS } from "../../design/tokens.js";
import { S } from "../../design/styles.js";
import SelectPicker from "../../components/SelectPicker.jsx";
import MultiSelectPicker from "../../components/MultiSelectPicker.jsx";
import { styles } from "./tableStyles.js";

export default function CellEditor({ value, type, options, schemaOptions, onCommit, onCancel, initialChar, isD1Table, onCreateOption, cellRef, canEditSchema }) {
  const inputRef = useRef(null);
  const [draft, setDraft] = useState(() => {
    if (initialChar && (type === "title" || type === "rich_text" || type === "url" || type === "email" || type === "phone_number")) {
      return initialChar;
    }
    if (type === "date" && value && typeof value === "object") return value.start || "";
    if (type === "date" && typeof value === "string") return value;
    if (type === "checkbox") return !!value;
    if (value === null || value === undefined) return "";
    return String(value);
  });

  // Date range state
  const [dateEnd, setDateEnd] = useState(() => {
    if (type === "date" && value && typeof value === "object") return value.end || "";
    return "";
  });
  const [includeTime, setIncludeTime] = useState(() => {
    if (type === "date" && typeof draft === "string" && draft.includes("T")) return true;
    return false;
  });

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
      if (inputRef.current.select && !initialChar) inputRef.current.select();
      // Move cursor to end if initialChar was set
      if (initialChar && inputRef.current.setSelectionRange) {
        const len = inputRef.current.value.length;
        inputRef.current.setSelectionRange(len, len);
      }
    }
  }, [initialChar]);

  const commit = useCallback((val) => {
    let out = val;
    if (type === "number") {
      out = val === "" ? null : parseFloat(val);
      if (out !== null && isNaN(out)) out = null;
    }
    if (type === "date") {
      if (!val) { out = null; }
      else if (dateEnd) { out = { start: val, end: dateEnd }; }
      else { out = val; }
    }
    onCommit(out);
  }, [type, onCommit, dateEnd]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commit(draft);
    }
    if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
    if (e.key === "Tab") {
      e.preventDefault();
      commit(draft);
    }
  }, [draft, commit, onCancel]);

  // Checkbox is always a direct toggle, no editor needed (handled in-cell)
  if (type === "checkbox") return null;

  // Select / Status — custom SelectPicker
  if (type === "select" || type === "status") {
    const anchor = cellRef?.current?.getBoundingClientRect?.();
    return (
      <SelectPicker
        value={value}
        options={schemaOptions || options.map((o) => ({ name: o }))}
        onSelect={(selected) => onCommit(selected)}
        onClose={onCancel}
        allowCreate={!!canEditSchema}
        onCreateOption={onCreateOption}
        anchor={anchor ? { top: anchor.bottom, left: anchor.left, width: anchor.width } : undefined}
        initialChar={initialChar}
      />
    );
  }

  // Multi-select — custom MultiSelectPicker
  if (type === "multi_select") {
    const currentValues = Array.isArray(value) ? value : (value ? String(value).split(",").map((s) => s.trim()).filter(Boolean) : []);
    const anchor = cellRef?.current?.getBoundingClientRect?.();
    return (
      <MultiSelectPicker
        value={currentValues}
        options={schemaOptions || options.map((o) => ({ name: o }))}
        onChange={(newVals) => onCommit(newVals)}
        onClose={onCancel}
        allowCreate={!!canEditSchema}
        onCreateOption={onCreateOption}
        anchor={anchor ? { top: anchor.bottom, left: anchor.left, width: anchor.width } : undefined}
        initialChar={initialChar}
      />
    );
  }

  // Date — enhanced with end date, time toggle, quick buttons
  if (type === "date") {
    return (
      <div
        style={{
          background: C.darkSurf,
          border: `1px solid ${C.accent}`,
          borderRadius: RADIUS.pill,
          padding: 8,
          boxShadow: `0 0 0 2px ${C.accent}33`,
          display: "flex",
          flexDirection: "column",
          gap: 6,
          minWidth: 200,
        }}
      >
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input
            ref={inputRef}
            type={includeTime ? "datetime-local" : "date"}
            style={{ ...styles.cellInput, flex: 1, boxShadow: "none" }}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <button
            onClick={() => { commit(null); }}
            style={{ ...S.btnGhost, fontSize: 10, padding: "2px 6px", color: C.darkMuted }}
            title="Clear"
          >{"\u2715"}</button>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input
            type={includeTime ? "datetime-local" : "date"}
            style={{ ...styles.cellInput, flex: 1, boxShadow: "none", opacity: dateEnd ? 1 : 0.5 }}
            value={dateEnd}
            onChange={(e) => setDateEnd(e.target.value)}
            placeholder="End date"
            onKeyDown={handleKeyDown}
          />
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 11, color: C.darkMuted }}>
          <label style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
            <input type="checkbox" checked={includeTime} onChange={(e) => setIncludeTime(e.target.checked)} />
            Time
          </label>
          <span style={{ flex: 1 }} />
          {/* Quick buttons */}
          <button
            onClick={() => { setDraft(new Date().toISOString().slice(0, 10)); }}
            style={{ background: "none", border: "none", color: C.accent, cursor: "pointer", fontSize: 10, fontFamily: FONT, padding: 0 }}
          >Today</button>
          <button
            onClick={() => {
              const d = new Date(); d.setDate(d.getDate() + 1);
              setDraft(d.toISOString().slice(0, 10));
            }}
            style={{ background: "none", border: "none", color: C.accent, cursor: "pointer", fontSize: 10, fontFamily: FONT, padding: 0 }}
          >Tomorrow</button>
          <button
            onClick={() => {
              const d = new Date(); d.setDate(d.getDate() + 7);
              setDraft(d.toISOString().slice(0, 10));
            }}
            style={{ background: "none", border: "none", color: C.accent, cursor: "pointer", fontSize: 10, fontFamily: FONT, padding: 0 }}
          >+1w</button>
        </div>
        <button
          onClick={() => commit(draft)}
          style={{ ...S.btnPrimary, fontSize: 11, padding: "4px 10px", alignSelf: "flex-end" }}
        >Done</button>
      </div>
    );
  }

  if (type === "number") {
    return (
      <input
        ref={inputRef}
        type="number"
        style={styles.cellInput}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => commit(draft)}
        onKeyDown={handleKeyDown}
        step="any"
      />
    );
  }

  // title, rich_text, url, email, phone_number
  return (
    <input
      ref={inputRef}
      type="text"
      style={styles.cellInput}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => commit(draft)}
      onKeyDown={handleKeyDown}
    />
  );
}
