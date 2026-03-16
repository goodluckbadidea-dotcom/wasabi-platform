// ─── Calendar Event Block ───
// Renders a Google Calendar event on the day column hour grid.
// Surface bg + left color bar for timed events. Color mapped to theme palette.

import React from "react";
import { C, FONT, RADIUS, mapCalendarColor } from "../../design/tokens.js";
import { formatTime } from "../zenTaskHelpers.js";

export default function CalendarEventBlock({ event, hourHeight, hourStart, onClick, calendarColorMap }) {
  const calName = event.calendarName || event.calendarId;
  const color = (calendarColorMap && calName && calendarColorMap[calName]) || mapCalendarColor(event.calendarColor) || C.accent;
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
      onClick={(e) => { e.stopPropagation(); onClick?.(event); }}
      style={{
        position: "absolute",
        left: 48,
        right: 4,
        top,
        height,
        background: C.darkSurf,
        borderLeft: `3px solid ${color}`,
        borderRadius: RADIUS.lg,
        padding: "5px 10px",
        fontSize: 12,
        fontFamily: FONT,
        color: C.darkText,
        overflow: "hidden",
        zIndex: 2,
        cursor: onClick ? "pointer" : "default",
      }}
    >
      <div style={{
        fontWeight: 600, whiteSpace: "nowrap",
        overflow: "hidden", textOverflow: "ellipsis",
      }}>
        {event.summary || "Untitled"}
      </div>
      <div style={{ fontSize: 11, color: C.darkMuted, marginTop: 1 }}>
        {formatTime(event.start.dateTime)}
        {end ? ` – ${formatTime(event.end.dateTime)}` : ""}
      </div>
    </div>
  );
}
