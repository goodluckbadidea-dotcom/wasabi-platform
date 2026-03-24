// ─── Record Drawer ───
// Right-side slide-out drawer for editing tasks, calendar events, and email threads.
// Wraps the generic Drawer component with TaskEditor, EventEditor, and EmailThreadDrawer sub-components.

import React, { useState, useCallback, useEffect, useRef } from "react";
import { C, FONT, RADIUS } from "../design/tokens.js";
import Drawer from "../core/Drawer.jsx";
import { useViewport } from "../context/ViewportContext.jsx";
import { useRecordDrawer } from "./RecordDrawerContext.jsx";
import {
  updateRow, deleteRow, updateCalendarEvent, deleteCalendarEvent,
  getRecordNote, saveRecordNote,
  upsertTaskActivity, putRecordView,
  logTaskInteraction, getInteractionSummary,
} from "../lib/api.js";
import { updatePage } from "../notion/client.js";
import { globalToast } from "../context/ToastContext.jsx";
import { buildProp } from "../notion/properties.js";
import { usePlatform } from "../context/PlatformContext.jsx";
import { useCollaboration } from "../context/CollaborationContext.jsx";
import EmailThreadDrawer from "./EmailThreadDrawer.jsx";
import RecordComments from "../components/RecordComments.jsx";
import RecordFiles from "../components/RecordFiles.jsx";
import { IconLightbulb } from "../design/icons.jsx";

// ── Priority colors (aligned to INFO_PALETTE) ──
const PRIORITY_COLORS = {
  High: { bg: "#DA4060", text: "#fff" },      // palette[9] crimson
  Medium: { bg: "#E0845C", text: "#fff" },    // palette[3] coral
  Normal: { bg: "#DACA68", text: "#1a1a1a" }, // palette[4] gold
  Low: { bg: "#70AAF0", text: "#fff" },       // palette[6] cornflower
};

const PRIORITIES = ["High", "Medium", "Normal", "Low"];

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

const tabBarStyle = {
  display: "flex", gap: 2, marginBottom: 16,
  background: C.darkSurf2, borderRadius: RADIUS.pill, padding: 2,
};
const tabStyle = (active) => ({
  flex: 1, padding: "8px 0", border: "none",
  background: active ? C.dark : "transparent",
  color: active ? C.darkText : C.darkMuted,
  fontSize: 12, fontWeight: 600, fontFamily: FONT,
  borderRadius: RADIUS.sm, cursor: "pointer", outline: "none",
  transition: "all 0.15s", letterSpacing: "0.03em",
  minHeight: 32,
});

/** Relative time helper */
function timeAgo(dateStr) {
  if (!dateStr) return "";
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

// ── Helper: format ISO date for datetime-local input ──
// Uses parseDate to correctly handle date-only strings (YYYY-MM-DD → local, not UTC)
import { parseDate } from "./taskHelpers.js";

function toLocalInput(isoStr) {
  if (!isoStr) return "";
  try {
    const d = parseDate(isoStr);
    if (isNaN(d.getTime())) return "";
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch { return ""; }
}

function toDateInput(isoStr) {
  if (!isoStr) return "";
  try {
    const d = parseDate(isoStr);
    if (isNaN(d.getTime())) return "";
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  } catch { return ""; }
}

// ════════════════════════════════════════════
// TaskEditor
// ════════════════════════════════════════════
function TaskEditor({ task, onSaved, onDeleted, onClose, onRecordInteraction }) {
  const { user, pages, setActivePage, identity } = usePlatform();
  const { notifySaved, notifyDeleted } = useRecordDrawer();
  const isNotion = task.source && task.source.startsWith("notion:");
  const isD1 = task.source === "manual" || (task.source && task.source.startsWith("d1:"));
  const isEditable = isD1 || isNotion;

  const [activeTab, setActiveTab] = useState("details");
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
  const [interactionSummary, setInteractionSummary] = useState([]);

  const statusOptions = task._statusOptions || [];
  const fieldMap = task._fieldMap || {};

  // Derive pageConfigId for notes/comments storage
  const pageConfigId = task.tableId
    || (task.source?.startsWith("d1:") ? task.source.split(":")[1] : null)
    || (task.source?.startsWith("notion:") ? task.source.split(":")[1] : null)
    || null;

  // Whether notes must be stored in wasabi-internal (no mapped Notion field)
  const notesAreLocal = isNotion && !fieldMap.notes;

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
    setActiveTab("details");
    // Load wasabi-internal notes for Notion tasks without mapped notes field
    if (isNotion && !fieldMap.notes && task.id && pageConfigId) {
      getRecordNote(task.id, pageConfigId)
        .then((res) => { if (res?.note?.content) setNotes(res.note.content); })
        .catch(err => console.warn("[RecordDrawer] getRecordNote:", err.message || err));
    }
    // Log view interaction
    if (task.id && task.source) {
      logTaskInteraction(task.id, task.source, identity?.id, "view", null).catch(err => console.warn("[RecordDrawer] logTaskInteraction:", err.message || err));
    }
    // Fetch interaction summary for smart display
    if (task.id) {
      getInteractionSummary(task.id)
        .then((res) => setInteractionSummary(res?.summary || []))
        .catch(err => console.warn("[RecordDrawer] getInteractionSummary:", err.message || err));
    }
  }, [task.id]); // eslint-disable-line react-hooks/exhaustive-deps

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
        if (!user?.workerUrl || !user?.notionKey) throw new Error("Notion not connected");
        const properties = {};
        if (fieldMap.title && title !== task.title) {
          properties[fieldMap.title] = buildProp("title", title);
        }
        if (fieldMap.status && status !== task.status) {
          const propType = task._statusFieldType || "status";
          properties[fieldMap.status] = buildProp(propType, status);
        }
        if (fieldMap.done && done !== task.done) {
          properties[fieldMap.done] = buildProp("checkbox", done);
        }
        if (fieldMap.priority && priority !== task.priority) {
          properties[fieldMap.priority] = buildProp("select", priority || null);
        }
        if (fieldMap.due && due !== toDateInput(task.due)) {
          properties[fieldMap.due] = buildProp("date", due || null);
        }
        if (fieldMap.notes && notes !== (task.notes || "")) {
          properties[fieldMap.notes] = buildProp("rich_text", notes);
        }
        if (Object.keys(properties).length > 0) {
          await updatePage(user.workerUrl, user.notionKey, task.id, properties);
        }
        // Save notes to wasabi-internal storage if no Notion field mapped
        if (!fieldMap.notes && notes) {
          await saveRecordNote(task.id, pageConfigId, notes).catch(err => console.warn("[RecordDrawer] saveRecordNote:", err.message || err));
        }
        // Log typed interaction for smart task list scoring
        const statusChanged = status !== task.status;
        if (statusChanged) {
          const detail = `${task.status || "none"} → ${status}`;
          logTaskInteraction(task.id, task.source, identity?.id, "status_change", detail).catch(err => console.warn("[RecordDrawer] logTaskInteraction:", err.message || err));
          onRecordInteraction?.(task.id, "status_change", detail);
        } else if (Object.keys(properties).length > 0) {
          const changedFields = [];
          if (title !== task.title) changedFields.push("title");
          if (priority !== task.priority) changedFields.push("priority");
          if (due !== toDateInput(task.due)) changedFields.push("due date");
          if (notes !== (task.notes || "")) changedFields.push("notes");
          logTaskInteraction(task.id, task.source, identity?.id, "field_edit", changedFields.join(", ")).catch(err => console.warn("[RecordDrawer] logTaskInteraction:", err.message || err));
          onRecordInteraction?.(task.id, "field_edit", changedFields.join(", "));
        }
        const updated = { ...task, title, done, status, priority, due, notes };
        onSaved?.(updated);
        notifySaved("task", updated);
        globalToast("Task saved", "success");
        onClose();
      } else {
        const tableId = task.tableId || (task.source?.startsWith("d1:") ? task.source.split(":")[1] : null);
        if (!tableId) throw new Error("No table ID");
        // Build cells using field map (actual column names) or fallback to generic names
        const cellsToSave = {};
        const fm = fieldMap;
        if (fm.title) cellsToSave[fm.title] = title;
        else cellsToSave.task = title;
        if (fm.done) cellsToSave[fm.done] = done;
        else cellsToSave.done = done;
        if (fm.status && status !== (task.status || "")) cellsToSave[fm.status] = status;
        if (fm.priority) cellsToSave[fm.priority] = priority || null;
        else cellsToSave.priority = priority || null;
        if (fm.due) cellsToSave[fm.due] = due || null;
        else cellsToSave.due = due || null;
        if (fm.notes) cellsToSave[fm.notes] = notes;
        else cellsToSave.notes = notes;
        await updateRow(tableId, task.id, { cells: cellsToSave });
        // Log typed interaction for D1 tasks
        if (task.source && task.source !== "manual") {
          const statusChanged = status !== (task.status || "");
          const doneChanged = done !== task.done;
          if (statusChanged || doneChanged) {
            const detail = statusChanged ? `${task.status || "none"} → ${status}` : (done ? "completed" : "reopened");
            logTaskInteraction(task.id, task.source, identity?.id, "status_change", detail).catch(err => console.warn("[RecordDrawer] logTaskInteraction:", err.message || err));
            onRecordInteraction?.(task.id, "status_change", detail);
          } else {
            logTaskInteraction(task.id, task.source, identity?.id, "field_edit", "updated").catch(err => console.warn("[RecordDrawer] logTaskInteraction:", err.message || err));
            onRecordInteraction?.(task.id, "field_edit", "updated");
          }
        }
        const updated = { ...task, title, done, status, priority, due, notes };
        onSaved?.(updated);
        notifySaved("task", updated);
        globalToast("Task saved", "success");
        onClose();
      }
    } catch (err) {
      console.error("[RecordDrawer] Save task failed:", err);
      globalToast("Failed to save task", "error");
      setError("Failed to save. Please try again.");
    } finally {
      setSaving(false);
    }
  }, [task, title, done, status, priority, due, notes, isEditable, isNotion, user, fieldMap, identity, onSaved, onClose, onRecordInteraction]);

  const handleDelete = useCallback(async () => {
    if (!confirmDelete) { setConfirmDelete(true); return; }
    setDeleting(true);
    try {
      const tableId = task.tableId || (task.source?.startsWith("d1:") ? task.source.split(":")[1] : null);
      if (!tableId) throw new Error("No table ID");
      await deleteRow(tableId, task.id);
      onDeleted?.(task.id);
      notifyDeleted("task", task.id);
      globalToast("Task deleted", "info");
      onClose();
    } catch (err) {
      console.error("[RecordDrawer] Delete task failed:", err);
      setError("Failed to delete.");
      globalToast("Failed to delete task", "error");
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  }, [task, confirmDelete, onDeleted, onClose]);

  // ── "Remove from To Do" — logs activity to reset staleness ──
  const [removing, setRemoving] = useState(false);
  const handleRemoveFromTodo = useCallback(async () => {
    setRemoving(true);
    try {
      await upsertTaskActivity(task.id, task.source, new Date().toISOString());
      const removedTask = { ...task, _removedFromTodo: true };
      onSaved?.(removedTask);
      notifySaved("task", removedTask); // broadcast via event bus so TasksView can dismiss + refresh
      onClose();
    } catch (err) {
      console.error("[RecordDrawer] Remove from to do failed:", err);
      setError("Failed to remove.");
    } finally {
      setRemoving(false);
    }
  }, [task, onSaved, notifySaved, onClose]);

  // ── "Go To Task" — navigate to source DB page ──
  const findSourcePage = useCallback(() => {
    const dbId = task.source?.split(":")[1];
    if (dbId) {
      const match = pages.find((p) => p.id === dbId || p.databaseIds?.includes(dbId));
      if (match) return match;
    }
    // Fallback: match by tableId
    if (task.tableId) {
      const match = pages.find((p) => p.id === task.tableId || p.databaseIds?.includes(task.tableId));
      if (match) return match;
    }
    // Fallback: match by sourceName against page name
    if (task.sourceName) {
      const match = pages.find((p) => p.name === task.sourceName);
      if (match) return match;
    }
    return null;
  }, [task, pages]);

  const handleGoToTask = useCallback(() => {
    const matchedPage = findSourcePage();
    if (matchedPage) {
      onClose();
      setActivePage(matchedPage.id);
    }
  }, [findSourcePage, setActivePage, onClose]);

  const canGoToTask = task.source !== "manual" && !!findSourcePage();

  // ── AI attention summary — forward-looking, action-oriented ──
  const attentionSummary = (() => {
    // If the AI curation provided a reason, use it as the primary summary
    const reason = task._aiReason;
    const aiText = reason ? reason.replace(/\[[^\]]+\]\s*/g, "").trim() : null;

    // Build forward-looking context from task metadata
    const parts = [];

    // 1. Deadlines — lead with what's coming, frame as action
    if (task.nearestDate || task.due) {
      const d = new Date(task.nearestDate || task.due);
      const now = new Date(); now.setHours(0, 0, 0, 0);
      const diff = Math.round((d - now) / 86400000);
      const fieldLabel = task.nearestDateField || "Deadline";
      if (diff < 0) {
        parts.push(`${fieldLabel} passed ${Math.abs(diff)} day${Math.abs(diff) !== 1 ? "s" : ""} ago — you need to update this or escalate.`);
      } else if (diff === 0) {
        parts.push(`${fieldLabel} is today — this needs your attention now.`);
      } else if (diff === 1) {
        parts.push(`${fieldLabel} is tomorrow.`);
      } else if (diff <= 7) {
        parts.push(`${fieldLabel} is coming up in ${diff} days.`);
      } else {
        parts.push(`${fieldLabel} is ${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}.`);
      }
    }

    // 2. Interaction context — frame as what YOU need to do
    if (interactionSummary.length > 0) {
      const myInteractions = interactionSummary.filter((s) => s.user_id === identity?.id);
      const otherInteractions = interactionSummary.filter((s) => s.user_id !== identity?.id && s.user_id !== "default");

      // Gap detection: commented but status unchanged → needs follow-through
      const lastComment = myInteractions.find((s) => s.interaction_type === "comment");
      const lastStatusChange = myInteractions.find((s) => s.interaction_type === "status_change");
      if (lastComment && (!lastStatusChange || lastComment.last_at > lastStatusChange.last_at)) {
        const daysSince = Math.round((Date.now() - new Date(lastComment.last_at)) / 86400000);
        if (daysSince > 0) {
          parts.push(`You commented ${daysSince} day${daysSince !== 1 ? "s" : ""} ago but status is still "${status || "unchanged"}" — update it or follow up.`);
        }
      }

      // Recency — only if no other interaction signal
      const myLatest = myInteractions[0];
      if (myLatest?.last_at && !lastComment) {
        const daysSince = Math.round((Date.now() - new Date(myLatest.last_at)) / 86400000);
        if (daysSince > 3) {
          parts.push(`It's been ${daysSince} days since you last touched this.`);
        }
      }

      // Other users' recent activity — keep brief
      const recentOther = otherInteractions[0];
      if (recentOther) {
        const name = recentOther.display_name || "A team member";
        if (recentOther.interaction_type === "comment") {
          parts.push(`${name} commented — check if it needs your response.`);
        } else if (recentOther.interaction_type === "status_change" && recentOther.detail) {
          parts.push(`${name} moved this to ${recentOther.detail.split("→").pop()?.trim() || recentOther.detail}.`);
        }
      }
    }

    // 3. If AI reason exists, prefer it but append deadline/interaction context
    if (aiText) {
      const context = parts.length > 0 ? " " + parts.join(" ") : "";
      return aiText + context;
    }

    // 4. Fallback — forward-looking from metadata
    if (parts.length === 0) {
      if (task.status && task.priority) {
        parts.push(`${task.priority} priority, currently "${task.status}".`);
      } else if (task.status) {
        parts.push(`Currently "${task.status}".`);
      }
    }
    return parts.length > 0 ? parts.join(" ") : null;
  })();

  return (
    <div>
      {/* AI attention summary */}
      {attentionSummary && (
        <div style={{
          background: `${C.accent}0C`, border: `1px solid ${C.accent}22`,
          borderRadius: RADIUS.md, padding: "10px 14px", marginBottom: 14,
          fontSize: 12, fontFamily: FONT, color: C.darkMuted, lineHeight: 1.6,
          display: "flex", alignItems: "flex-start", gap: 8,
        }}>
          <span style={{ flexShrink: 0, marginTop: 1 }}><IconLightbulb size={14} color={C.accent} /></span>
          <span style={{ color: C.darkText }}>{attentionSummary}</span>
        </div>
      )}

      {/* Sync badge for linked databases */}
      {task.sourceName && task.sourceName !== "User Tasks" && task.source !== "manual" && (
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
          Synced from {task.sourceName} — changes save to database
        </div>
      )}

      {/* Tab bar */}
      <div style={tabBarStyle}>
        {[
          { key: "details", label: "Details" },
          { key: "comments", label: "Comments" },
          { key: "files", label: "Files" },
        ].map((t) => (
          <button key={t.key} style={tabStyle(activeTab === t.key)} onClick={() => setActiveTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Details tab ── */}
      {activeTab === "details" && (
        <>
          {/* Status dropdown (tasks with status options — Notion or D1 with select columns) */}
          {statusOptions.length > 0 && (
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
                        padding: "7px 14px", borderRadius: RADIUS.pill,
                        border: `1.5px solid ${active ? (isDone ? C.success : C.accent) : C.darkBorder}`,
                        background: active ? (isDone ? C.success : C.accent) : "transparent",
                        color: active ? "#fff" : C.darkMuted,
                        fontSize: 12, fontWeight: 600, fontFamily: FONT,
                        cursor: "pointer", outline: "none", transition: "all 0.15s",
                        letterSpacing: "0.03em", minHeight: 32,
                      }}
                    >
                      {opt.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Done toggle (for tasks without a status dropdown) */}
          {statusOptions.length === 0 && (
            <div style={{ ...fieldGroup, display: "flex", alignItems: "center", gap: 10 }}>
              <button
                onClick={() => setDone(!done)}
                style={{
                  width: 24, height: 24, borderRadius: 6, flexShrink: 0,
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

          <div style={fieldGroup}>
            <label style={labelStyle}>Title</label>
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)}
              style={inputStyle}
              onFocus={(e) => { e.target.style.borderColor = C.accent; }}
              onBlur={(e) => { e.target.style.borderColor = C.darkBorder; }}
            />
          </div>

          <div style={fieldGroup}>
            <label style={labelStyle}>Priority</label>
            <div style={{ display: "flex", gap: 6 }}>
              {PRIORITIES.map((p) => {
                const active = priority === p;
                const colors = PRIORITY_COLORS[p];
                return (
                  <button key={p} onClick={() => setPriority(active ? "" : p)}
                    style={{
                      padding: "7px 14px", borderRadius: RADIUS.pill,
                      border: `1.5px solid ${active ? colors.bg : C.darkBorder}`,
                      background: active ? colors.bg : "transparent",
                      color: active ? colors.text : C.darkMuted,
                      fontSize: 12, fontWeight: 600, fontFamily: FONT,
                      cursor: "pointer", outline: "none", transition: "all 0.15s",
                      letterSpacing: "0.03em", minHeight: 32,
                    }}
                  >{p}</button>
                );
              })}
            </div>
          </div>

          <div style={fieldGroup}>
            <label style={labelStyle}>Due date</label>
            <input type="date" value={due} onChange={(e) => setDue(e.target.value)}
              style={{ ...inputStyle, colorScheme: "dark" }}
            />
          </div>

          {/* Inline notes */}
          <div style={fieldGroup}>
            <label style={labelStyle}>Notes</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={4}
              style={{ ...inputStyle, resize: "vertical", minHeight: 80 }}
              placeholder={notesAreLocal ? "Notes (saved in Wasabi — no Notion notes field detected)" : ""}
              onFocus={(e) => { e.target.style.borderColor = C.accent; }}
              onBlur={(e) => { e.target.style.borderColor = C.darkBorder; }}
            />
          </div>

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

          {error && (
            <div style={{
              fontSize: 11, fontFamily: FONT, color: C.error,
              marginBottom: 12, padding: "6px 10px",
              background: C.error + "15", borderRadius: RADIUS.md,
            }}>{error}</div>
          )}

          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button onClick={handleSave} disabled={saving}
              style={{
                flex: 1, padding: "10px 16px", borderRadius: RADIUS.pill,
                background: `linear-gradient(135deg, ${C.accent}, ${C.accent}cc)`,
                color: "#fff", border: "none", fontSize: 13,
                fontWeight: 600, fontFamily: FONT, cursor: saving ? "wait" : "pointer",
                outline: "none", opacity: saving ? 0.7 : 1, transition: "opacity 0.15s",
              }}
            >{saving ? "Saving..." : "Save"}</button>
            {isD1 && task.source === "manual" && (
              <button onClick={handleDelete} disabled={deleting}
                style={{
                  padding: "10px 16px", borderRadius: RADIUS.md,
                  background: confirmDelete ? C.error : "transparent",
                  color: confirmDelete ? "#fff" : C.error,
                  border: `1.5px solid ${confirmDelete ? C.error : C.darkBorder}`,
                  fontSize: 13, fontWeight: 600, fontFamily: FONT,
                  cursor: deleting ? "wait" : "pointer", outline: "none",
                  transition: "all 0.15s",
                }}
              >{deleting ? "Deleting..." : confirmDelete ? "Confirm Delete" : "Delete"}</button>
            )}
          </div>

          {/* ── Smart To-Do actions ── */}
          <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
            {task.source !== "manual" && (
              <button onClick={handleRemoveFromTodo} disabled={removing}
                style={{
                  flex: 1, padding: "8px 12px", borderRadius: RADIUS.md,
                  background: "transparent",
                  color: C.darkMuted, border: `1px solid ${C.darkBorder}`,
                  fontSize: 11, fontWeight: 500, fontFamily: FONT,
                  cursor: removing ? "wait" : "pointer", outline: "none",
                  transition: "all 0.15s", display: "flex", alignItems: "center",
                  justifyContent: "center", gap: 5,
                }}
              >
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                  <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                </svg>
                {removing ? "Removing..." : "Remove from To Do"}
              </button>
            )}
            {canGoToTask && (
              <button onClick={handleGoToTask}
                style={{
                  flex: 1, padding: "8px 12px", borderRadius: RADIUS.md,
                  background: "transparent",
                  color: C.accent, border: `1px solid ${C.accent}44`,
                  fontSize: 11, fontWeight: 500, fontFamily: FONT,
                  cursor: "pointer", outline: "none",
                  transition: "all 0.15s", display: "flex", alignItems: "center",
                  justifyContent: "center", gap: 5,
                }}
              >
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                  <path d="M6 3H3v10h10v-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                  <path d="M9 2h5v5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M14 2L7 9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                </svg>
                Go To Task
              </button>
            )}
          </div>
        </>
      )}

      {/* ── Comments tab ── */}
      {activeTab === "comments" && (
        <RecordComments
          recordId={task.id}
          pageConfigId={pageConfigId}
          onCommentAdded={(text) => {
            if (task.source) logTaskInteraction(task.id, task.source, identity?.id, "comment", text.slice(0, 50)).catch(err => console.warn("[RecordDrawer] logTaskInteraction:", err.message || err));
            upsertTaskActivity(task.id, task.source, new Date().toISOString()).catch(err => console.warn("[RecordDrawer] upsertTaskActivity:", err.message || err));
          }}
          userId={identity?.id}
          userName={identity?.display_name}
          userRole={identity?.role}
        />
      )}

      {/* ── Files tab ── */}
      {activeTab === "files" && (
        <RecordFiles recordId={task.id} pageConfigId={pageConfigId} />
      )}
    </div>
  );
}


// TaskCommentsTab extracted to: src/components/RecordComments.jsx

// ════════════════════════════════════════════
// EventEditor
// ════════════════════════════════════════════
function EventEditor({ event, onSaved, onDeleted, onClose }) {
  const { notifySaved, notifyDeleted } = useRecordDrawer();
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
      const updated = { ...event, ...updates };
      onSaved?.(updated);
      notifySaved("event", updated);
      globalToast("Event saved", "success");
      onClose();
    } catch (err) {
      console.error("[RecordDrawer] Save event failed:", err);
      setError("Failed to save event.");
      globalToast("Failed to save event", "error");
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
      notifyDeleted("event", event.id);
      globalToast("Event deleted", "info");
      onClose();
    } catch (err) {
      console.error("[RecordDrawer] Delete event failed:", err);
      setError("Failed to delete event.");
      globalToast("Failed to delete event", "error");
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
          fontSize: 11, fontFamily: FONT, color: C.error,
          marginBottom: 12, padding: "6px 10px",
          background: C.error + "15", borderRadius: RADIUS.md,
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
            flex: 1, padding: "10px 16px", borderRadius: RADIUS.pill,
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
            background: confirmDelete ? C.error : "transparent",
            color: confirmDelete ? "#fff" : C.error,
            border: `1.5px solid ${confirmDelete ? C.error : C.darkBorder}`,
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
// WorkspaceSettingsEditor
// ════════════════════════════════════════════
function WorkspaceSettingsEditor({ workspace, onClose }) {
  const { pages, updatePageConfig } = usePlatform();

  // Find the pageConfig for this workspace
  const pageConfig = pages.find((p) => p.id === workspace.id) || workspace;
  const settings = pageConfig.settings || pageConfig.config?.settings || {};

  const [instructions, setInstructions] = useState(settings.aiInstructions || "");
  const [model, setModel] = useState(settings.defaultModel || "auto");
  const [agentMode, setAgentMode] = useState(settings.agentMode || "auto");
  const [autoKb, setAutoKb] = useState(settings.autoSearchKb !== false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // Reset when workspace changes
  useEffect(() => {
    const s = pageConfig.settings || pageConfig.config?.settings || {};
    setInstructions(s.aiInstructions || "");
    setModel(s.defaultModel || "auto");
    setAgentMode(s.agentMode || "auto");
    setAutoKb(s.autoSearchKb !== false);
    setError(null);
  }, [workspace.id]);

  const handleSave = useCallback(() => {
    setSaving(true);
    setError(null);
    try {
      const newSettings = {
        aiInstructions: instructions,
        defaultModel: model,
        agentMode,
        autoSearchKb: autoKb,
        kbCategories: settings.kbCategories || [],
      };
      updatePageConfig(pageConfig.id, { settings: newSettings });
      onClose();
    } catch (err) {
      console.error("[RecordDrawer] Save workspace settings failed:", err);
      setError("Failed to save settings.");
    } finally {
      setSaving(false);
    }
  }, [pageConfig.id, instructions, model, agentMode, autoKb, settings.kbCategories, updatePageConfig, onClose]);

  const handleCancel = useCallback(() => {
    onClose();
  }, [onClose]);

  const radioBtn = (active) => ({
    flex: 1, padding: "10px 12px",
    background: active ? C.accent + "18" : C.darkSurf2,
    border: `1px solid ${active ? C.accent + "55" : C.darkBorder}`,
    borderRadius: RADIUS.md, cursor: "pointer", fontFamily: FONT,
    fontSize: 12, fontWeight: active ? 600 : 400,
    color: active ? C.accent : C.darkMuted,
    transition: "all 0.15s", outline: "none", textAlign: "center",
  });

  return (
    <div>
      {/* AI Instructions */}
      <div style={fieldGroup}>
        <label style={labelStyle}>AI Instructions</label>
        <div style={{ fontSize: 11, color: C.darkMuted, marginBottom: 8 }}>
          Custom instructions injected into the system prompt for this workspace.
        </div>
        <textarea
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          placeholder={"e.g. This workspace tracks inventory for our retail stores.\nAlways check the Products database before suggesting new items."}
          rows={5}
          style={{ ...inputStyle, resize: "vertical", minHeight: 100, lineHeight: 1.6 }}
          onFocus={(e) => { e.target.style.borderColor = C.accent; }}
          onBlur={(e) => { e.target.style.borderColor = C.darkBorder; }}
        />
      </div>

      {/* Default Model */}
      <div style={fieldGroup}>
        <label style={labelStyle}>Default Model</label>
        <div style={{ display: "flex", gap: 6 }}>
          <button style={radioBtn(model === "auto")} onClick={() => setModel("auto")}>Auto</button>
          <button style={radioBtn(model === "haiku")} onClick={() => setModel("haiku")}>Haiku (Fast)</button>
          <button style={radioBtn(model === "sonnet")} onClick={() => setModel("sonnet")}>Sonnet (Powerful)</button>
        </div>
        <div style={{ fontSize: 11, color: C.darkMuted, marginTop: 6 }}>
          Auto routes simple queries to Haiku and complex ones to Sonnet.
        </div>
      </div>

      {/* Agent Behavior */}
      <div style={fieldGroup}>
        <label style={labelStyle}>Agent Behavior</label>
        <div style={{ display: "flex", gap: 6 }}>
          <button style={radioBtn(agentMode === "auto")} onClick={() => setAgentMode("auto")}>Auto-Accept</button>
          <button style={radioBtn(agentMode === "confirm")} onClick={() => setAgentMode("confirm")}>Ask Permission</button>
          <button style={radioBtn(agentMode === "plan")} onClick={() => setAgentMode("plan")}>Plan Mode</button>
        </div>
        <div style={{ fontSize: 11, color: C.darkMuted, marginTop: 6 }}>
          {agentMode === "auto" && "Execute actions immediately without asking."}
          {agentMode === "confirm" && "Ask before creating, updating, or deleting records."}
          {agentMode === "plan" && "Present a plan before taking any actions."}
        </div>
      </div>

      {/* Knowledge Base */}
      <div style={fieldGroup}>
        <label style={labelStyle}>Knowledge Base</label>
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "8px 0",
        }}>
          <div>
            <div style={{ fontSize: 13, color: C.darkText, fontFamily: FONT }}>Auto-search Knowledge Base</div>
            <div style={{ fontSize: 11, color: C.darkMuted, marginTop: 2 }}>
              Search your KB for relevant context before every response.
            </div>
          </div>
          <div
            style={{
              width: 36, height: 20, borderRadius: 10,
              background: autoKb ? C.accent : C.darkSurf2,
              border: `1px solid ${autoKb ? C.accent : C.darkBorder}`,
              position: "relative", cursor: "pointer", transition: "all 0.2s", flexShrink: 0,
            }}
            onClick={() => setAutoKb(!autoKb)}
          >
            <div style={{
              width: 16, height: 16, borderRadius: "50%",
              background: autoKb ? "#fff" : C.darkMuted,
              position: "absolute", top: 1, left: autoKb ? 17 : 1,
              transition: "all 0.2s",
            }} />
          </div>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div style={{
          fontSize: 11, fontFamily: FONT, color: C.error,
          marginBottom: 12, padding: "6px 10px",
          background: C.error + "15", borderRadius: RADIUS.md,
        }}>{error}</div>
      )}

      {/* Save / Cancel */}
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button onClick={handleSave} disabled={saving}
          style={{
            flex: 1, padding: "10px 16px", borderRadius: RADIUS.pill,
            background: `linear-gradient(135deg, ${C.accent}, ${C.accent}cc)`,
            color: "#fff", border: "none", fontSize: 13,
            fontWeight: 600, fontFamily: FONT, cursor: saving ? "wait" : "pointer",
            outline: "none", opacity: saving ? 0.7 : 1, transition: "opacity 0.15s",
          }}
        >{saving ? "Saving..." : "Save"}</button>
        <button onClick={handleCancel}
          style={{
            padding: "10px 16px", borderRadius: RADIUS.md,
            background: "transparent",
            color: C.darkMuted, border: `1.5px solid ${C.darkBorder}`,
            fontSize: 13, fontWeight: 600, fontFamily: FONT,
            cursor: "pointer", outline: "none", transition: "all 0.15s",
          }}
        >Cancel</button>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════
// RecordDrawer (main export)
// ════════════════════════════════════════════
export default function RecordDrawer({ onTaskUpdated, onTaskDeleted, onEventUpdated, onEventDeleted, onRecordInteraction }) {
  const { drawerItem, closeDrawer } = useRecordDrawer();
  const { identity } = usePlatform();
  const { isTablet } = useViewport();
  const collab = useCollaboration();
  const collabRef = useRef(collab);
  collabRef.current = collab;

  // Track record view for read receipts + collaboration focus
  const lastTrackedRef = useRef(null);
  useEffect(() => {
    if (!drawerItem?.data?.id || !identity?.id) return;
    const recordId = drawerItem.data.id;
    if (lastTrackedRef.current === recordId) return;
    lastTrackedRef.current = recordId;
    putRecordView(recordId).catch(err => console.warn("[RecordDrawer] putRecordView:", err.message || err));
    if (collabRef.current) collabRef.current.focusRecord(recordId);
    return () => { if (collabRef.current) collabRef.current.blurRecord(); };
  }, [drawerItem, identity]);

  if (!drawerItem) return null;

  const title = drawerItem.type === "task"
    ? "Edit Task"
    : drawerItem.type === "email"
      ? (drawerItem.data?.compose ? "Compose" : "Email")
      : drawerItem.type === "workspace-settings"
        ? `${drawerItem.data?.name || "Workspace"} Settings`
        : "Edit Event";
  const desktopW = drawerItem.type === "email" ? 560 : 480;
  const width = isTablet ? 360 : desktopW;

  return (
    <Drawer open={!!drawerItem} onClose={closeDrawer} title={title} side="right" width={width}>
      {drawerItem.type === "task" ? (
        <TaskEditor
          task={drawerItem.data}
          onSaved={onTaskUpdated}
          onDeleted={onTaskDeleted}
          onClose={closeDrawer}
          onRecordInteraction={onRecordInteraction}
        />
      ) : drawerItem.type === "email" ? (
        <EmailThreadDrawer
          email={drawerItem.data}
          onClose={closeDrawer}
        />
      ) : drawerItem.type === "workspace-settings" ? (
        <WorkspaceSettingsEditor
          workspace={drawerItem.data}
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
