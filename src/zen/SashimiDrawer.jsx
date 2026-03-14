// ─── Sashimi Drawer ───
// Right-side slide-out drawer for editing tasks and calendar events in Sashimi mode.
// Wraps the generic Drawer component with TaskEditor and EventEditor sub-components.

import React, { useState, useCallback, useEffect, useRef } from "react";
import { C, FONT, RADIUS } from "../design/tokens.js";
import Drawer from "../core/Drawer.jsx";
import { useSashimiDrawer } from "./SashimiDrawerContext.jsx";
import { updateRow, deleteRow, updateCalendarEvent, deleteCalendarEvent } from "../lib/api.js";
import { updatePage } from "../notion/client.js";
import { buildProp } from "../notion/properties.js";
import { usePlatform } from "../context/PlatformContext.jsx";

// ── Priority colors (matches TaskList.jsx) ──
const PRIORITY_COLORS = {
  High: { bg: "#E05252", text: "#fff" },
  Medium: { bg: "#E8A838", text: "#fff" },
  Low: { bg: "#4A90D9", text: "#fff" },
};

const PRIORITIES = ["High", "Medium", "Low"];

// ── Shared input styling ──
const inputStyle = {
  width: "100%", boxSizing: "border-box",
  background: C.darkSurf2, border: `1px solid ${C.darkBorder}`,
  borderRadius: RADIUS.md, padding: "8px 12px",
  color: C.darkText, fontFamily: FONT, fontSize: 13,
  outline: "none", transition: "border-color 0.15s",
};

const labelStyle = {
  fontSize: 10, fontWeight: 600, fontFamily: FONT,
  color: C.darkMuted, letterSpacing: "0.06em",
  textTransform: "uppercase", marginBottom: 6, display: "block",
};

const fieldGroup = { marginBottom: 16 };

// ── Helper: format ISO date for datetime-local input ──
function toLocalInput(isoStr) {
  if (!isoStr) return "";
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return "";
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch { return ""; }
}

function toDateInput(isoStr) {
  if (!isoStr) return "";
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return "";
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  } catch { return ""; }
}

// ════════════════════════════════════════════
// TaskEditor
// ════════════════════════════════════════════
function TaskEditor({ task, onSaved, onDeleted, onClose }) {
  const { user } = usePlatform();
  const isNotion = task.source && task.source.startsWith("notion:");
  const isD1 = task.source === "manual" || (task.source && task.source.startsWith("d1:"));
  const isEditable = isD1 || isNotion; // Both are now editable

  const [title, setTitle] = useState(task.title || "");
  const [done, setDone] = useState(!!task.done);
  const [status, setStatus] = useState(task.status || "");
  const [priority, setPriority] = useState(task.priority || "");
  const [due, setDue] = useState(toDateInput(task.due));
  const [notes, setNotes] = useState(task.notes || "");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState(null);

  const statusOptions = task._statusOptions || [];
  const fieldMap = task._fieldMap || {};

  // Reset state when task changes
  useEffect(() => {
    setTitle(task.title || "");
    setDone(!!task.done);
    setStatus(task.status || "");
    setPriority(task.priority || "");
    setDue(toDateInput(task.due));
    setNotes(task.notes || "");
    setError(null);
    setConfirmDelete(false);
  }, [task.id]);

  // Sync done state when status changes (for Notion tasks)
  useEffect(() => {
    if (isNotion && status) {
      const lower = status.toLowerCase();
      setDone(lower === "done" || lower === "complete" || lower === "completed");
    }
  }, [status, isNotion]);

  const handleSave = useCallback(async () => {
    if (!isEditable) return;
    setSaving(true);
    setError(null);
    try {
      if (isNotion) {
        // ── Notion save path ──
        if (!user?.workerUrl || !user?.notionKey) throw new Error("Notion not connected");
        const properties = {};
        // Title
        if (fieldMap.title && title !== task.title) {
          properties[fieldMap.title] = buildProp("title", title);
        }
        // Status
        if (fieldMap.status && status !== task.status) {
          const propType = task._statusFieldType || "status";
          properties[fieldMap.status] = buildProp(propType, status);
        }
        // Done checkbox (if separate from status)
        if (fieldMap.done && done !== task.done) {
          properties[fieldMap.done] = buildProp("checkbox", done);
        }
        // Priority
        if (fieldMap.priority && priority !== task.priority) {
          properties[fieldMap.priority] = buildProp("select", priority || null);
        }
        // Due date
        if (fieldMap.due && due !== toDateInput(task.due)) {
          properties[fieldMap.due] = buildProp("date", due || null);
        }
        if (Object.keys(properties).length > 0) {
          await updatePage(user.workerUrl, user.notionKey, task.id, properties);
        }
        onSaved?.({ ...task, title, done, status, priority, due, notes });
        onClose();
      } else {
        // ── D1 save path ──
        const tableId = task.tableId || (task.source?.startsWith("d1:") ? task.source.split(":")[1] : null);
        if (!tableId) throw new Error("No table ID");
        await updateRow(tableId, task.id, {
          cells: {
            task: title,
            done: done,
            priority: priority || null,
            due: due || null,
            notes: notes,
          },
        });
        onSaved?.({ ...task, title, done, priority, due, notes });
        onClose();
      }
    } catch (err) {
      console.error("[SashimiDrawer] Save task failed:", err);
      setError("Failed to save. Please try again.");
    } finally {
      setSaving(false);
    }
  }, [task, title, done, status, priority, due, notes, isEditable, isNotion, user, fieldMap, onSaved, onClose]);

  const handleDelete = useCallback(async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setDeleting(true);
    try {
      const tableId = task.tableId || (task.source?.startsWith("d1:") ? task.source.split(":")[1] : null);
      if (!tableId) throw new Error("No table ID");
      await deleteRow(tableId, task.id);
      onDeleted?.(task.id);
      onClose();
    } catch (err) {
      console.error("[SashimiDrawer] Delete task failed:", err);
      setError("Failed to delete.");
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  }, [task, confirmDelete, onDeleted, onClose]);

  return (
    <div>
      {/* Notion sync badge */}
      {isNotion && (
        <div style={{
          background: C.accent + "15", border: `1px solid ${C.accent}33`,
          borderRadius: RADIUS.md, padding: "8px 12px", marginBottom: 16,
          fontSize: 11, fontFamily: FONT, color: C.accent,
          display: "flex", alignItems: "center", gap: 6,
        }}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M6 1v4l2.5 1.5" stroke={C.accent} strokeWidth="1" strokeLinecap="round" />
            <circle cx="6" cy="6" r="5" stroke={C.accent} strokeWidth="1" fill="none" />
          </svg>
          Synced from {task.sourceName || "Notion"} — edits save to source
        </div>
      )}

      {/* Status dropdown (Notion tasks with status options) */}
      {isNotion && statusOptions.length > 0 && (
        <div style={fieldGroup}>
          <label style={labelStyle}>Status</label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {statusOptions.map((opt) => {
              const active = status === opt.name;
              const isDone = ["done", "complete", "completed"].includes(opt.name.toLowerCase());
              return (
                <button
                  key={opt.name}
                  onClick={() => setStatus(opt.name)}
                  style={{
                    padding: "5px 12px", borderRadius: RADIUS.pill,
                    border: `1.5px solid ${active ? (isDone ? "#4CAF50" : C.accent) : C.darkBorder}`,
                    background: active ? (isDone ? "#4CAF50" : C.accent) : "transparent",
                    color: active ? "#fff" : C.darkMuted,
                    fontSize: 11, fontWeight: 600, fontFamily: FONT,
                    cursor: "pointer", outline: "none", transition: "all 0.15s",
                    letterSpacing: "0.03em",
                  }}
                >
                  {opt.name}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Done toggle (for D1 tasks or Notion tasks without status field) */}
      {(!isNotion || statusOptions.length === 0) && (
        <div style={{ ...fieldGroup, display: "flex", alignItems: "center", gap: 10 }}>
          <button
            onClick={() => setDone(!done)}
            style={{
              width: 20, height: 20, borderRadius: 5, flexShrink: 0,
              border: `2px solid ${done ? C.accent : C.darkBorder}`,
              background: done ? C.accent : "transparent",
              cursor: "pointer", outline: "none", padding: 0,
              display: "flex", alignItems: "center", justifyContent: "center",
              transition: "background 0.12s, border-color 0.12s",
            }}
          >
            {done && (
              <svg width="12" height="12" viewBox="0 0 10 10" fill="none">
                <path d="M2 5L4 7L8 3" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </button>
          <span style={{
            fontSize: 14, fontFamily: FONT, fontWeight: 600,
            color: done ? C.darkMuted : C.darkText,
            textDecoration: done ? "line-through" : "none",
          }}>
            {done ? "Completed" : "Active"}
          </span>
        </div>
      )}

      {/* Title */}
      <div style={fieldGroup}>
        <label style={labelStyle}>Title</label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          style={inputStyle}
          onFocus={(e) => { e.target.style.borderColor = C.accent; }}
          onBlur={(e) => { e.target.style.borderColor = C.darkBorder; }}
        />
      </div>

      {/* Priority */}
      <div style={fieldGroup}>
        <label style={labelStyle}>Priority</label>
        <div style={{ display: "flex", gap: 6 }}>
          {PRIORITIES.map((p) => {
            const active = priority === p;
            const colors = PRIORITY_COLORS[p];
            return (
              <button
                key={p}
                onClick={() => setPriority(active ? "" : p)}
                style={{
                  padding: "5px 12px", borderRadius: RADIUS.pill,
                  border: `1.5px solid ${active ? colors.bg : C.darkBorder}`,
                  background: active ? colors.bg : "transparent",
                  color: active ? colors.text : C.darkMuted,
                  fontSize: 11, fontWeight: 600, fontFamily: FONT,
                  cursor: "pointer", outline: "none", transition: "all 0.15s",
                  letterSpacing: "0.03em",
                }}
              >
                {p}
              </button>
            );
          })}
        </div>
      </div>

      {/* Due date */}
      <div style={fieldGroup}>
        <label style={labelStyle}>Due date</label>
        <input
          type="date"
          value={due}
          onChange={(e) => setDue(e.target.value)}
          style={{ ...inputStyle, colorScheme: "dark" }}
        />
      </div>

      {/* Notes (only for D1 tasks — Notion tasks don't have a simple notes field) */}
      {!isNotion && (
        <div style={fieldGroup}>
          <label style={labelStyle}>Notes</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={4}
            style={{ ...inputStyle, resize: "vertical", minHeight: 80 }}
            onFocus={(e) => { e.target.style.borderColor = C.accent; }}
            onBlur={(e) => { e.target.style.borderColor = C.darkBorder; }}
          />
        </div>
      )}

      {/* Source badge */}
      {task.sourceName && (
        <div style={{ ...fieldGroup, display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{
            fontSize: 9, fontFamily: FONT, padding: "2px 8px",
            borderRadius: RADIUS.pill, background: C.darkSurf2, color: C.darkMuted,
          }}>
            {task.sourceName}
          </span>
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{
          fontSize: 11, fontFamily: FONT, color: "#E05252",
          marginBottom: 12, padding: "6px 10px",
          background: "#E0525215", borderRadius: RADIUS.md,
        }}>
          {error}
        </div>
      )}

      {/* Actions */}
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button
          onClick={handleSave}
          disabled={saving}
          style={{
            flex: 1, padding: "10px 16px", borderRadius: RADIUS.md,
            background: `linear-gradient(135deg, ${C.accent}, ${C.accent}cc)`,
            color: "#fff", border: "none", fontSize: 13,
            fontWeight: 600, fontFamily: FONT, cursor: saving ? "wait" : "pointer",
            outline: "none", opacity: saving ? 0.7 : 1,
            transition: "opacity 0.15s",
          }}
        >
          {saving ? "Saving..." : "Save"}
        </button>
        {isD1 && task.source === "manual" && (
          <button
            onClick={handleDelete}
            disabled={deleting}
            style={{
              padding: "10px 16px", borderRadius: RADIUS.md,
              background: confirmDelete ? "#E05252" : "transparent",
              color: confirmDelete ? "#fff" : "#E05252",
              border: `1.5px solid ${confirmDelete ? "#E05252" : C.darkBorder}`,
              fontSize: 13, fontWeight: 600, fontFamily: FONT,
              cursor: deleting ? "wait" : "pointer", outline: "none",
              transition: "all 0.15s",
            }}
          >
            {deleting ? "Deleting..." : confirmDelete ? "Confirm Delete" : "Delete"}
          </button>
        )}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════
// EventEditor
// ════════════════════════════════════════════
function EventEditor({ event, onSaved, onDeleted, onClose }) {
  const [summary, setSummary] = useState(event.summary || "");
  const [startDT, setStartDT] = useState(toLocalInput(event.start?.dateTime || event.start?.date));
  const [endDT, setEndDT] = useState(toLocalInput(event.end?.dateTime || event.end?.date));
  const [description, setDescription] = useState(event.description || "");
  const [location, setLocation] = useState(event.location || "");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState(null);

  const isAllDay = !event.start?.dateTime;

  // Reset on event change
  useEffect(() => {
    setSummary(event.summary || "");
    setStartDT(toLocalInput(event.start?.dateTime || event.start?.date));
    setEndDT(toLocalInput(event.end?.dateTime || event.end?.date));
    setDescription(event.description || "");
    setLocation(event.location || "");
    setError(null);
    setConfirmDelete(false);
  }, [event.id]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const updates = { summary };

      if (startDT) {
        updates.start = isAllDay
          ? { date: startDT.split("T")[0] }
          : { dateTime: new Date(startDT).toISOString(), timeZone: tz };
      }
      if (endDT) {
        updates.end = isAllDay
          ? { date: endDT.split("T")[0] }
          : { dateTime: new Date(endDT).toISOString(), timeZone: tz };
      }
      if (description !== undefined) updates.description = description;
      if (location !== undefined) updates.location = location;

      await updateCalendarEvent(event.id, updates);
      onSaved?.({ ...event, ...updates });
      onClose();
    } catch (err) {
      console.error("[SashimiDrawer] Save event failed:", err);
      setError("Failed to save event.");
    } finally {
      setSaving(false);
    }
  }, [event, summary, startDT, endDT, description, location, isAllDay, onSaved, onClose]);

  const handleDelete = useCallback(async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setDeleting(true);
    try {
      await deleteCalendarEvent(event.id);
      onDeleted?.(event.id);
      onClose();
    } catch (err) {
      console.error("[SashimiDrawer] Delete event failed:", err);
      setError("Failed to delete event.");
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  }, [event, confirmDelete, onDeleted, onClose]);

  const calColor = event.calendarColor || C.accent;

  return (
    <div>
      {/* Calendar indicator */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8, marginBottom: 16,
      }}>
        <div style={{
          width: 10, height: 10, borderRadius: "50%",
          background: calColor, flexShrink: 0,
        }} />
        <span style={{ fontSize: 11, fontFamily: FONT, color: C.darkMuted }}>
          {event.calendarName || "Calendar"}
        </span>
      </div>

      {/* Summary / Title */}
      <div style={fieldGroup}>
        <label style={labelStyle}>Event title</label>
        <input
          type="text"
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          style={inputStyle}
          onFocus={(e) => { e.target.style.borderColor = C.accent; }}
          onBlur={(e) => { e.target.style.borderColor = C.darkBorder; }}
        />
      </div>

      {/* Start / End */}
      <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>Start</label>
          <input
            type={isAllDay ? "date" : "datetime-local"}
            value={isAllDay ? (startDT?.split("T")[0] || "") : startDT}
            onChange={(e) => setStartDT(e.target.value)}
            style={{ ...inputStyle, colorScheme: "dark" }}
          />
        </div>
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>End</label>
          <input
            type={isAllDay ? "date" : "datetime-local"}
            value={isAllDay ? (endDT?.split("T")[0] || "") : endDT}
            onChange={(e) => setEndDT(e.target.value)}
            style={{ ...inputStyle, colorScheme: "dark" }}
          />
        </div>
      </div>

      {/* Location */}
      <div style={fieldGroup}>
        <label style={labelStyle}>Location</label>
        <input
          type="text"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="Add location..."
          style={inputStyle}
          onFocus={(e) => { e.target.style.borderColor = C.accent; }}
          onBlur={(e) => { e.target.style.borderColor = C.darkBorder; }}
        />
      </div>

      {/* Description */}
      <div style={fieldGroup}>
        <label style={labelStyle}>Description</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Add description..."
          rows={4}
          style={{ ...inputStyle, resize: "vertical", minHeight: 80 }}
          onFocus={(e) => { e.target.style.borderColor = C.accent; }}
          onBlur={(e) => { e.target.style.borderColor = C.darkBorder; }}
        />
      </div>

      {/* Error */}
      {error && (
        <div style={{
          fontSize: 11, fontFamily: FONT, color: "#E05252",
          marginBottom: 12, padding: "6px 10px",
          background: "#E0525215", borderRadius: RADIUS.md,
        }}>
          {error}
        </div>
      )}

      {/* Actions */}
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button
          onClick={handleSave}
          disabled={saving}
          style={{
            flex: 1, padding: "10px 16px", borderRadius: RADIUS.md,
            background: `linear-gradient(135deg, ${C.accent}, ${C.accent}cc)`,
            color: "#fff", border: "none", fontSize: 13,
            fontWeight: 600, fontFamily: FONT, cursor: saving ? "wait" : "pointer",
            outline: "none", opacity: saving ? 0.7 : 1,
            transition: "opacity 0.15s",
          }}
        >
          {saving ? "Saving..." : "Save"}
        </button>
        <button
          onClick={handleDelete}
          disabled={deleting}
          style={{
            padding: "10px 16px", borderRadius: RADIUS.md,
            background: confirmDelete ? "#E05252" : "transparent",
            color: confirmDelete ? "#fff" : "#E05252",
            border: `1.5px solid ${confirmDelete ? "#E05252" : C.darkBorder}`,
            fontSize: 13, fontWeight: 600, fontFamily: FONT,
            cursor: deleting ? "wait" : "pointer", outline: "none",
            transition: "all 0.15s",
          }}
        >
          {deleting ? "Deleting..." : confirmDelete ? "Confirm Delete" : "Delete"}
        </button>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════
// SashimiDrawer (main export)
// ════════════════════════════════════════════
export default function SashimiDrawer({ onTaskUpdated, onTaskDeleted, onEventUpdated, onEventDeleted }) {
  const { drawerItem, closeDrawer } = useSashimiDrawer();

  if (!drawerItem) return null;

  const title = drawerItem.type === "task" ? "Edit Task" : "Edit Event";

  return (
    <Drawer open={!!drawerItem} onClose={closeDrawer} title={title} side="right" width={420}>
      {drawerItem.type === "task" ? (
        <TaskEditor
          task={drawerItem.data}
          onSaved={onTaskUpdated}
          onDeleted={onTaskDeleted}
          onClose={closeDrawer}
        />
      ) : (
        <EventEditor
          event={drawerItem.data}
          onSaved={onEventUpdated}
          onDeleted={onEventDeleted}
          onClose={closeDrawer}
        />
      )}
    </Drawer>
  );
}
