// ─── Quick Create Bar ───
// Inline event creation bar below the calendar header.
// Appears when [+] is clicked. Creates a Google Calendar event.

import React, { useState, useRef, useEffect } from "react";
import { C, FONT, RADIUS } from "../../design/tokens.js";
import { createCalendarEvent } from "../../lib/api.js";

const DURATIONS = [
  { label: "30m", minutes: 30 },
  { label: "1h", minutes: 60 },
  { label: "1.5h", minutes: 90 },
  { label: "2h", minutes: 120 },
];

function roundToNext15(date) {
  const d = new Date(date);
  const mins = d.getMinutes();
  const rounded = Math.ceil(mins / 15) * 15;
  d.setMinutes(rounded, 0, 0);
  return d;
}

function toTimeInputValue(date) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export default function QuickCreateBar({ selectedDate, onCreated, onClose }) {
  const [title, setTitle] = useState("");
  const [startTime, setStartTime] = useState(() => toTimeInputValue(roundToNext15(new Date())));
  const [durationIdx, setDurationIdx] = useState(1); // default: 1h
  const [creating, setCreating] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleCreate = async () => {
    if (!title.trim() || creating) return;
    setCreating(true);

    try {
      const [hours, mins] = startTime.split(":").map(Number);
      const start = new Date(selectedDate);
      start.setHours(hours, mins, 0, 0);

      const end = new Date(start);
      end.setMinutes(end.getMinutes() + DURATIONS[durationIdx].minutes);

      const result = await createCalendarEvent({
        summary: title.trim(),
        start: { dateTime: start.toISOString(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
        end: { dateTime: end.toISOString(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
      });

      // Build a minimal event object for instant UI update
      const newEvent = {
        id: result?.id || Date.now().toString(),
        summary: title.trim(),
        start: { dateTime: start.toISOString() },
        end: { dateTime: end.toISOString() },
      };

      onCreated(newEvent);
      setTitle("");
    } catch (err) {
      console.error("[QuickCreate] Failed:", err);
    } finally {
      setCreating(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter") handleCreate();
    if (e.key === "Escape") onClose();
  };

  return (
    <div style={{
      flexShrink: 0, padding: "8px 12px",
      borderBottom: `1px solid ${C.darkBorder}`,
      display: "flex", alignItems: "center", gap: 6,
      background: C.darkSurf + "80",
    }}>
      {/* Title input */}
      <input
        ref={inputRef}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Event title..."
        style={{
          flex: 1, background: C.darkSurf2, border: `1px solid ${C.darkBorder}`,
          borderRadius: RADIUS.pill, padding: "7px 10px",
          fontSize: 12, fontFamily: FONT, color: C.darkText,
          outline: "none", minWidth: 0,
        }}
      />

      {/* Start time */}
      <input
        type="time"
        value={startTime}
        onChange={(e) => setStartTime(e.target.value)}
        style={{
          background: C.darkSurf2, border: `1px solid ${C.darkBorder}`,
          borderRadius: RADIUS.pill, padding: "7px 8px",
          fontSize: 11, fontFamily: FONT, color: C.darkText,
          outline: "none", width: 85,
        }}
      />

      {/* Duration selector */}
      <div style={{
        display: "flex", borderRadius: RADIUS.pill,
        border: `1px solid ${C.darkBorder}`,
        overflow: "hidden",
      }}>
        {DURATIONS.map((dur, idx) => (
          <button
            key={dur.label}
            onClick={() => setDurationIdx(idx)}
            style={{
              background: durationIdx === idx ? C.darkSurf2 : "transparent",
              border: "none", cursor: "pointer",
              padding: "6px 8px",
              fontSize: 11, fontFamily: FONT,
              color: durationIdx === idx ? C.darkText : C.darkMuted,
              fontWeight: durationIdx === idx ? 600 : 400,
              outline: "none",
              borderRight: idx < DURATIONS.length - 1 ? `1px solid ${C.darkBorder}` : "none",
            }}
          >
            {dur.label}
          </button>
        ))}
      </div>

      {/* Create button */}
      <button
        onClick={handleCreate}
        disabled={!title.trim() || creating}
        style={{
          background: C.accent, color: "#fff",
          border: "none", borderRadius: RADIUS.pill,
          padding: "7px 14px", fontSize: 11, fontFamily: FONT,
          fontWeight: 600, cursor: title.trim() && !creating ? "pointer" : "default",
          opacity: title.trim() && !creating ? 1 : 0.4,
          outline: "none", whiteSpace: "nowrap",
        }}
      >
        {creating ? "..." : "Create"}
      </button>
    </div>
  );
}
