// ─── Calendar Event Block ───
// Renders a Google Calendar event on the day column hour grid.
// Uses per-calendar color for visual distinction between calendars.

import React from "react";
import { C, FONT, RADIUS } from "../../design/tokens.js";
import { formatTime } from "../zenTaskHelpers.js";

export default function CalendarEventBlock({ event, hourHeight, hourStart }) {
  const color = event.calendarColor || C.accent;
  const start = event.start?.dateTime ? new Date(event.start.dateTime) : null;
  const end = event.end?.dateTime ? new Date(event.end.dateTime) : null;
  if (!start) return null;

  const startHour = start.getHours() + start.getMinutes() / 60;
  const endHour = end ? end.getHours() + end.getMinutes() / 60 : startHour + 1;
  const top = (startHour - hourStart) * hourHeight;
  const height = Math.max((endHour - startHour) * hourHeight, 20);

  if (startHour < hourStart) return null;

  return (
    <div
      style={{
        position: "absolute",
        left: 48,
        right: 4,
        top,
        height,
        background: color + "22",
        border: `1px solid ${color}44`,
        borderLeft: `3px solid ${color}`,
        borderRadius: RADIUS.md,
        padding: "3px 6px",
        fontSize: 10,
        fontFamily: FONT,
        color: C.darkText,
        overflow: "hidden",
        zIndex: 2,
      }}
    >
      <div style={{
        fontWeight: 600, whiteSpace: "nowrap",
        overflow: "hidden", textOverflow: "ellipsis",
      }}>
        {event.summary || "Untitled"}
      </div>
      <div style={{ fontSize: 9, color: C.darkMuted, marginTop: 1 }}>
        {formatTime(event.start.dateTime)}
        {end ? ` – ${formatTime(event.end.dateTime)}` : ""}
      </div>
    </div>
  );
}
