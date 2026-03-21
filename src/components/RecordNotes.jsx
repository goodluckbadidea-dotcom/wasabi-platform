// ─── Record Notes ───
// Shared notes component for the record model.
// Two modes:
//   1. Free-form: single textarea with auto-save (1s debounce)
//   2. Timestamped log: append-only entries with author + timestamp
// Mode toggle persists with the note data.
// Used by RecordDetail (database drawer) and RecordDrawer (zen task drawer).

import React, { useState, useCallback, useEffect, useRef } from "react";
import { C, FONT, RADIUS } from "../design/tokens.js";
import { getRecordNote, saveRecordNote } from "../lib/api.js";
import { usePlatform } from "../context/PlatformContext.jsx";

// ─── Data helpers ───

function parseNoteData(raw) {
  if (!raw) return { mode: "free", text: "", entries: [] };
  try {
    const parsed = JSON.parse(raw);
    if (parsed._mode === "log") {
      return { mode: "log", text: "", entries: parsed.entries || [] };
    }
  } catch (err) { console.warn("[RecordNotes] JSON parse:", err.message); }
  return { mode: "free", text: raw, entries: [] };
}

function serializeFree(text) {
  return text;
}

function serializeLog(entries) {
  return JSON.stringify({ _mode: "log", entries });
}

function formatTimestamp(iso) {
  try {
    const d = new Date(iso);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const isYesterday = d.toDateString() === yesterday.toDateString();
    const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    if (isToday) return `Today at ${time}`;
    if (isYesterday) return `Yesterday at ${time}`;
    return `${d.toLocaleDateString([], { month: "short", day: "numeric" })} at ${time}`;
  } catch {
    return iso;
  }
}

// ─── Main component ───

export default function RecordNotes({ recordId, pageConfigId, compact = false, placeholder }) {
  const { identity } = usePlatform();
  const [mode, setMode] = useState("free"); // "free" | "log"
  const [freeText, setFreeText] = useState("");
  const [logEntries, setLogEntries] = useState([]);
  const [logInput, setLogInput] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const debounceRef = useRef(null);
  const latestFreeRef = useRef("");
  const logInputRef = useRef(null);

  // Fetch note on mount
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getRecordNote(recordId, pageConfigId)
      .then((res) => {
        if (cancelled) return;
        const { mode: m, text, entries } = parseNoteData(res?.note?.content);
        setMode(m);
        setFreeText(text);
        latestFreeRef.current = text;
        setLogEntries(entries);
      })
      .catch(() => { if (!cancelled) { setFreeText(""); setLogEntries([]); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [recordId, pageConfigId]);

  // ─── Save helpers ───

  const doSave = useCallback(async (raw) => {
    setStatus("Saving...");
    try {
      await saveRecordNote(recordId, pageConfigId, raw);
      setStatus("Saved");
    } catch {
      setStatus("Save failed");
    }
  }, [recordId, pageConfigId]);

  // ─── Free-form handlers ───

  const handleFreeChange = useCallback((e) => {
    const val = e.target.value;
    setFreeText(val);
    latestFreeRef.current = val;
    setStatus("");
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSave(serializeFree(val)), 1000);
  }, [doSave]);

  const handleFreeBlur = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    doSave(serializeFree(latestFreeRef.current));
  }, [doSave]);

  // ─── Log mode handlers ───

  const handleAddEntry = useCallback(() => {
    const text = logInput.trim();
    if (!text) return;
    const entry = {
      text,
      author: identity?.display_name || "User",
      timestamp: new Date().toISOString(),
    };
    const updated = [entry, ...logEntries];
    setLogEntries(updated);
    setLogInput("");
    doSave(serializeLog(updated));
    logInputRef.current?.focus();
  }, [logInput, logEntries, identity, doSave]);

  const handleDeleteEntry = useCallback((idx) => {
    const updated = logEntries.filter((_, i) => i !== idx);
    setLogEntries(updated);
    doSave(serializeLog(updated));
  }, [logEntries, doSave]);

  // ─── Mode toggle ───

  const handleToggleMode = useCallback(() => {
    const next = mode === "free" ? "log" : "free";
    if (next === "log") {
      // Convert free text to a single log entry if there's content
      if (freeText.trim()) {
        const entries = [{
          text: freeText.trim(),
          author: identity?.display_name || "User",
          timestamp: new Date().toISOString(),
        }];
        setLogEntries(entries);
        doSave(serializeLog(entries));
      } else {
        setLogEntries([]);
        doSave(serializeLog([]));
      }
      setFreeText("");
    } else {
      // Convert log entries back to free text
      const text = logEntries.map((e) => e.text).join("\n\n");
      setFreeText(text);
      latestFreeRef.current = text;
      setLogEntries([]);
      doSave(serializeFree(text));
    }
    setMode(next);
  }, [mode, freeText, logEntries, identity, doSave]);

  // Cleanup
  useEffect(() => {
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, []);

  if (loading) {
    return <div style={s.empty}>Loading notes...</div>;
  }

  return (
    <div style={{ padding: compact ? "4px 0" : "12px 0", flex: 1, display: "flex", flexDirection: "column" }}>
      {/* Mode toggle */}
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
        <button
          onClick={handleToggleMode}
          style={{
            background: "transparent",
            border: `1px solid ${C.darkBorder}`,
            borderRadius: RADIUS.md,
            color: C.darkMuted,
            fontSize: 10,
            fontFamily: FONT,
            padding: "3px 10px",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 4,
            transition: "all 0.15s",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = C.accent; e.currentTarget.style.color = C.darkText; }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = C.darkBorder; e.currentTarget.style.color = C.darkMuted; }}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2">
            {mode === "free" ? (
              // Clock icon → switch to log
              <>
                <circle cx="5" cy="5" r="4" />
                <path d="M5 3v2.5l1.5 1" strokeLinecap="round" />
              </>
            ) : (
              // Text icon → switch to free
              <>
                <line x1="2" y1="3" x2="8" y2="3" strokeLinecap="round" />
                <line x1="2" y1="5" x2="8" y2="5" strokeLinecap="round" />
                <line x1="2" y1="7" x2="6" y2="7" strokeLinecap="round" />
              </>
            )}
          </svg>
          {mode === "free" ? "Log mode" : "Free text"}
        </button>
      </div>

      {/* ─── Free-form mode ─── */}
      {mode === "free" && (
        <>
          <textarea
            style={{ ...s.textarea, minHeight: compact ? 60 : 160 }}
            value={freeText}
            onChange={handleFreeChange}
            onBlur={handleFreeBlur}
            placeholder={placeholder || "Write notes about this record..."}
            onFocus={(e) => { e.currentTarget.style.borderColor = C.accent; }}
            onBlurCapture={(e) => { e.currentTarget.style.borderColor = C.darkBorder; }}
          />
          <div style={s.status}>{status}</div>
        </>
      )}

      {/* ─── Log mode ─── */}
      {mode === "log" && (
        <>
          {/* Input */}
          <div style={{
            display: "flex", gap: 8, marginBottom: 12,
          }}>
            <input
              ref={logInputRef}
              type="text"
              value={logInput}
              onChange={(e) => setLogInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleAddEntry(); } }}
              placeholder="Add a log entry..."
              style={{
                flex: 1,
                background: C.dark,
                border: `1px solid ${C.darkBorder}`,
                borderRadius: RADIUS.md,
                color: C.darkText,
                fontFamily: FONT,
                fontSize: 13,
                padding: "8px 12px",
                outline: "none",
                transition: "border-color 0.15s",
              }}
              onFocus={(e) => { e.currentTarget.style.borderColor = C.accent; }}
              onBlur={(e) => { e.currentTarget.style.borderColor = C.darkBorder; }}
            />
            <button
              onClick={handleAddEntry}
              disabled={!logInput.trim()}
              style={{
                background: logInput.trim() ? C.accent : C.darkBorder,
                border: "none",
                borderRadius: RADIUS.pill,
                color: "#fff",
                fontFamily: FONT,
                fontSize: 12,
                fontWeight: 600,
                padding: "8px 14px",
                cursor: logInput.trim() ? "pointer" : "default",
                opacity: logInput.trim() ? 1 : 0.5,
                transition: "all 0.15s",
                flexShrink: 0,
              }}
            >
              Add
            </button>
          </div>

          {/* Entries */}
          <div style={{
            flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 2,
            minHeight: compact ? 60 : 120,
          }}>
            {logEntries.length === 0 && (
              <div style={{ ...s.empty, padding: "16px 0" }}>No log entries yet</div>
            )}
            {logEntries.map((entry, idx) => (
              <div
                key={`${entry.timestamp}-${idx}`}
                style={{
                  display: "flex", alignItems: "flex-start", gap: 8,
                  padding: "8px 10px",
                  background: idx % 2 === 0 ? C.darkSurf : "transparent",
                  borderRadius: RADIUS.sm,
                  position: "relative",
                  group: true,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 13, fontFamily: FONT, color: C.darkText,
                    lineHeight: 1.5, wordBreak: "break-word",
                  }}>
                    {entry.text}
                  </div>
                  <div style={{
                    fontSize: 10, fontFamily: FONT, color: C.darkMuted,
                    marginTop: 2,
                  }}>
                    {entry.author} · {formatTimestamp(entry.timestamp)}
                  </div>
                </div>
                <button
                  onClick={() => handleDeleteEntry(idx)}
                  title="Delete entry"
                  style={{
                    background: "none", border: "none", cursor: "pointer",
                    color: C.darkMuted, padding: 2, marginTop: 2,
                    opacity: 0.4, transition: "opacity 0.15s",
                    flexShrink: 0,
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.4"; }}
                >
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2">
                    <line x1="2" y1="2" x2="8" y2="8" strokeLinecap="round" />
                    <line x1="8" y1="2" x2="2" y2="8" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
          <div style={s.status}>{status}</div>
        </>
      )}
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
