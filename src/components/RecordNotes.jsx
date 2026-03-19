// ─── Record Notes ───
// Shared notes component for the record model.
// Auto-saves with 1s debounce, save-on-blur, status indicator.
// Used by RecordDetail (database drawer) and RecordDrawer (zen task drawer).

import React, { useState, useCallback, useEffect, useRef } from "react";
import { C, FONT, RADIUS } from "../design/tokens.js";
import { getRecordNote, saveRecordNote } from "../lib/api.js";

export default function RecordNotes({ recordId, pageConfigId, compact = false, placeholder }) {
  const [content, setContent] = useState("");
  const [status, setStatus] = useState(""); // "", "Saving...", "Saved", "Save failed"
  const [loading, setLoading] = useState(true);
  const debounceRef = useRef(null);
  const latestContentRef = useRef("");

  // Fetch note on mount
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getRecordNote(recordId, pageConfigId)
      .then((res) => {
        if (!cancelled) {
          const text = res?.note?.content || "";
          setContent(text);
          latestContentRef.current = text;
        }
      })
      .catch(() => { if (!cancelled) setContent(""); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [recordId, pageConfigId]);

  // Auto-save helper
  const doSave = useCallback(async (text) => {
    setStatus("Saving...");
    try {
      await saveRecordNote(recordId, pageConfigId, text);
      setStatus("Saved");
    } catch {
      setStatus("Save failed");
    }
  }, [recordId, pageConfigId]);

  // Debounced save on change
  const handleChange = useCallback((e) => {
    const val = e.target.value;
    setContent(val);
    latestContentRef.current = val;
    setStatus("");
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSave(val), 1000);
  }, [doSave]);

  // Save on blur
  const handleBlur = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    doSave(latestContentRef.current);
  }, [doSave]);

  // Cleanup timer
  useEffect(() => {
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, []);

  if (loading) {
    return <div style={s.empty}>Loading notes...</div>;
  }

  return (
    <div style={{ padding: compact ? "4px 0" : "12px 0", flex: 1, display: "flex", flexDirection: "column" }}>
      <textarea
        style={{
          ...s.textarea,
          minHeight: compact ? 60 : 160,
        }}
        value={content}
        onChange={handleChange}
        onBlur={handleBlur}
        placeholder={placeholder || "Write notes about this record..."}
        onFocus={(e) => { e.currentTarget.style.borderColor = C.accent; }}
        onBlurCapture={(e) => { e.currentTarget.style.borderColor = C.darkBorder; }}
      />
      <div style={s.status}>{status}</div>
    </div>
  );
}

const s = {
  textarea: {
    width: "100%",
    flex: 1,
    background: C.dark,
    border: `1px solid ${C.darkBorder}`,
    borderRadius: RADIUS.md,
    color: C.darkText,
    fontFamily: FONT,
    fontSize: 13,
    lineHeight: 1.6,
    padding: "10px 12px",
    resize: "vertical",
    outline: "none",
    transition: "border-color 0.15s",
    boxSizing: "border-box",
  },
  status: {
    fontSize: 10,
    fontFamily: FONT,
    color: C.darkMuted,
    textAlign: "right",
    padding: "4px 2px 0",
    minHeight: 16,
  },
  empty: {
    fontSize: 12,
    fontFamily: FONT,
    color: C.darkMuted,
    padding: "20px 0",
    textAlign: "center",
  },
};
