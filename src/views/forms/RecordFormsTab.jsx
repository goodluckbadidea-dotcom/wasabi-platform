// ─── Forms feature — Record drawer's Forms tab ───
// Lists forms connected to the current record, grouped into three buckets:
// Drafts / Empty / Submitted. Connecting opens fill flow on the main panel
// (closes drawer).

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { C, FONT, RADIUS, SHADOW } from "../../design/tokens.js";
import { S } from "../../design/styles.js";
import { hoverBg } from "../../design/interactions.js";
import { IconPlus } from "../../design/icons.jsx";
import {
  listForms, listFormConnectionsForRecord,
  createFormConnection, deleteFormConnection, deleteFormSubmission,
} from "../../lib/api.js";

export default function RecordFormsTab({ record, tableId, currentUserId, isAdmin = false, recordTitle, onClose }) {
  const [forms, setForms] = useState([]);
  const [connections, setConnections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);

  const refresh = useCallback(async () => {
    if (!record?.id) return;
    setLoading(true);
    try {
      const [formsRes, connRes] = await Promise.all([
        tableId ? listForms(tableId) : Promise.resolve({ forms: [] }),
        listFormConnectionsForRecord(record.id),
      ]);
      setForms(formsRes.forms || []);
      setConnections(connRes.connections || []);
    } catch (err) {
      console.error("[RecordFormsTab] load failed:", err);
    } finally {
      setLoading(false);
    }
  }, [record?.id, tableId]);

  useEffect(() => { refresh(); }, [refresh]);

  // Listen for form-submitted broadcasts so we re-fetch
  useEffect(() => {
    const handler = (e) => {
      if (e.detail?.recordId === record?.id) refresh();
    };
    window.addEventListener("wasabi:form-submitted", handler);
    return () => window.removeEventListener("wasabi:form-submitted", handler);
  }, [record?.id, refresh]);

  // Group connections into Drafts / Empty / Submitted
  const buckets = useMemo(() => groupConnections(connections, forms, currentUserId), [connections, forms, currentUserId]);

  const handleConnect = async (form) => {
    setPickerOpen(false);
    try {
      const res = await createFormConnection({
        form_id: form.id,
        record_id: record.id,
        table_id: tableId,
      });
      await refresh();
      // Immediately open the new connection for filling
      const newConn = res.connection;
      openFill({ form, connectionId: newConn.id });
    } catch (err) {
      if (err?.data?.code === "ALREADY_CONNECTED") {
        await refresh();
      } else {
        alert("Connect failed: " + (err.message || err));
      }
    }
  };

  const openFill = ({ form, connectionId, submissionId, readOnly = false }) => {
    // Close the drawer and dispatch fill intent for the main-panel Form view
    if (onClose) onClose();
    window.dispatchEvent(new CustomEvent("wasabi:fill-form", {
      detail: {
        formId: form.id,
        tableId,
        recordId: record.id,
        recordRow: record,
        recordTitle: recordTitle,
        connectionId,
        submissionId,
        readOnly,
      },
    }));
    // Also: switch to the Form view tab — we emit a hint the host can pick up
    window.dispatchEvent(new CustomEvent("wasabi:switch-to-form-view", {
      detail: { tableId },
    }));
  };

  const handleDisconnect = async (connId) => {
    if (!window.confirm("Disconnect this form?")) return;
    try {
      await deleteFormConnection(connId);
      await refresh();
    } catch (err) {
      console.error("[RecordFormsTab] disconnect failed:", err);
    }
  };

  const handleDeleteSubmission = async (subId) => {
    if (!window.confirm("Delete this submission? This can't be undone.")) return;
    try {
      await deleteFormSubmission(subId);
      await refresh();
    } catch (err) {
      console.error("[RecordFormsTab] delete submission failed:", err);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: 20, color: C.darkMuted, fontFamily: FONT, fontSize: 12 }}>
        Loading forms…
      </div>
    );
  }

  return (
    <div style={{ fontFamily: FONT, padding: "12px 0" }}>
      {/* Connect a form picker */}
      <div style={{ position: "relative", marginBottom: 16 }}>
        <button
          onClick={() => setPickerOpen((v) => !v)}
          disabled={forms.length === 0}
          style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            width: "100%", padding: "10px 14px",
            background: C.darkSurf2,
            border: `1px solid ${C.darkBorder}`,
            borderRadius: RADIUS.pill,
            color: C.darkText, fontFamily: FONT, fontSize: 12, fontWeight: 600,
            cursor: forms.length === 0 ? "not-allowed" : "pointer",
            opacity: forms.length === 0 ? 0.6 : 1,
          }}
        >
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <IconPlus size={12} /> Connect a form
          </span>
          <span style={{ color: C.darkMuted, fontSize: 10 }}>{pickerOpen ? "▲" : "▼"}</span>
        </button>
        {forms.length === 0 && (
          <div style={{ fontSize: 11, color: C.darkMuted, marginTop: 6, fontStyle: "italic", textAlign: "center" }}>
            No forms defined on this table yet.
          </div>
        )}
        {pickerOpen && forms.length > 0 && (
          <div style={{
            position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0,
            background: C.darkSurf, border: `1px solid ${C.darkBorder}`,
            borderRadius: RADIUS.lg, boxShadow: SHADOW.dropdown, zIndex: 10,
            padding: 4, maxHeight: 240, overflowY: "auto",
          }}>
            {forms.map((f) => (
              <button
                key={f.id}
                onClick={() => handleConnect(f)}
                style={{
                  display: "block", width: "100%", textAlign: "left",
                  padding: "8px 12px", border: "none", cursor: "pointer",
                  background: "transparent", color: C.darkText,
                  fontSize: 12, fontFamily: FONT, borderRadius: RADIUS.sm,
                }}
                {...hoverBg()}
              >
                {f.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Buckets */}
      <Bucket title="Drafts" hidden={buckets.drafts.length === 0}>
        {buckets.drafts.map((row) => (
          <DraftCard
            key={row.submission.id}
            row={row}
            currentUserId={currentUserId}
            isAdmin={isAdmin}
            onOpen={() => openFill({
              form: row.form,
              connectionId: row.connection.id,
              submissionId: row.submission.id,
              readOnly: row.submission.draft_owner_id && row.submission.draft_owner_id !== currentUserId,
            })}
            onDiscard={() => handleDeleteSubmission(row.submission.id)}
          />
        ))}
      </Bucket>

      <Bucket title="Empty" hidden={buckets.empty.length === 0}>
        {buckets.empty.map((row) => (
          <EmptyCard
            key={row.connection.id}
            row={row}
            onOpen={() => openFill({
              form: row.form,
              connectionId: row.connection.id,
              submissionId: null,
            })}
            onDisconnect={() => handleDisconnect(row.connection.id)}
          />
        ))}
      </Bucket>

      <Bucket title="Submitted" hidden={buckets.submitted.length === 0}>
        {buckets.submitted.map((row) => (
          <SubmittedCard
            key={row.connection.id}
            row={row}
            onOpenSubmission={(sub) => openFill({
              form: row.form,
              connectionId: row.connection.id,
              submissionId: sub.id,
              readOnly: !(sub.submitted_by === currentUserId || isAdmin),
            })}
            onSubmitAgain={() => openFill({
              form: row.form,
              connectionId: row.connection.id,
              submissionId: null,
            })}
            onDeleteSubmission={(sub) => handleDeleteSubmission(sub.id)}
          />
        ))}
      </Bucket>

      {buckets.drafts.length === 0 && buckets.empty.length === 0 && buckets.submitted.length === 0 && (
        <div style={{
          padding: 24, textAlign: "center",
          color: C.darkMuted, fontSize: 12, fontFamily: FONT, fontStyle: "italic",
        }}>
          No forms connected to this record yet.
        </div>
      )}
    </div>
  );
}

// ─── Bucket grouping logic ───
function groupConnections(connections, forms, currentUserId) {
  const formsById = {};
  for (const f of forms) formsById[f.id] = f;

  const drafts = [];
  const empty = [];
  const submitted = [];

  for (const conn of connections) {
    const form = formsById[conn.form_id];
    if (!form) continue;
    const subs = conn.submissions || [];
    const draftSubs = subs.filter((s) => s.status === "draft");
    const submittedSubs = subs.filter((s) => s.status === "submitted");

    // Drafts: surface each draft as its own row (per-user model)
    for (const d of draftSubs) drafts.push({ form, connection: conn, submission: d });

    // Empty: only if no submissions at all (drafts or submitted)
    if (subs.length === 0) {
      empty.push({ form, connection: conn });
    }

    // Submitted: card per connection with N submissions
    if (submittedSubs.length > 0) {
      submitted.push({
        form,
        connection: conn,
        submissions: submittedSubs.sort((a, b) => (b.submitted_at || "").localeCompare(a.submitted_at || "")),
      });
    }
  }

  // Sort: drafts by created_at desc, empty by connected_at, submitted by latest submission desc
  drafts.sort((a, b) => (b.submission.created_at || "").localeCompare(a.submission.created_at || ""));
  empty.sort((a, b) => (a.connection.connected_at || "").localeCompare(b.connection.connected_at || ""));
  submitted.sort((a, b) => {
    const al = a.submissions[0]?.submitted_at || "";
    const bl = b.submissions[0]?.submitted_at || "";
    return bl.localeCompare(al);
  });

  return { drafts, empty, submitted };
}

// ─── Bucket section ───
function Bucket({ title, hidden, children }) {
  if (hidden) return null;
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{
        fontSize: 10, fontWeight: 700, textTransform: "uppercase",
        letterSpacing: "0.08em", color: C.darkMuted, marginBottom: 6,
        padding: "0 4px",
      }}>{title}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {children}
      </div>
    </div>
  );
}

// ─── Card components ───
function CardWrap({ children, onClick }) {
  return (
    <div
      onClick={onClick}
      style={{
        padding: "10px 12px",
        background: C.darkSurf,
        border: `1px solid ${C.darkBorder}`,
        borderRadius: RADIUS.lg,
        cursor: onClick ? "pointer" : "default",
        transition: "border-color 0.12s, background 0.12s",
      }}
      onMouseEnter={(e) => { if (onClick) e.currentTarget.style.borderColor = C.accent + "55"; }}
      onMouseLeave={(e) => { if (onClick) e.currentTarget.style.borderColor = C.darkBorder; }}
    >
      {children}
    </div>
  );
}

function DraftCard({ row, currentUserId, isAdmin, onOpen, onDiscard }) {
  const isOwner = row.submission.draft_owner_id === currentUserId;
  const canDiscard = isOwner || isAdmin;
  return (
    <CardWrap onClick={onOpen}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.darkText, display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ color: C.accent }}>✎</span>
            {row.form.name}
          </div>
          <div style={{ fontSize: 11, color: C.darkMuted, marginTop: 2 }}>
            Draft {isOwner ? "by you" : ""} · {relativeTime(row.submission.created_at)}
          </div>
        </div>
        {canDiscard && (
          <button
            onClick={(e) => { e.stopPropagation(); onDiscard(); }}
            style={iconBtnStyle}
            title="Discard draft"
          >✕</button>
        )}
      </div>
    </CardWrap>
  );
}

function EmptyCard({ row, onOpen, onDisconnect }) {
  const sub = row.form.form_type === "repeating" ? "No submissions yet" : "Not yet filled";
  return (
    <CardWrap onClick={onOpen}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.darkText, display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ color: C.darkMuted }}>□</span>
            {row.form.name}
          </div>
          <div style={{ fontSize: 11, color: C.darkMuted, marginTop: 2 }}>{sub}</div>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onDisconnect(); }}
          style={iconBtnStyle}
          title="Disconnect"
        >✕</button>
      </div>
    </CardWrap>
  );
}

function SubmittedCard({ row, onOpenSubmission, onSubmitAgain, onDeleteSubmission }) {
  const [expanded, setExpanded] = useState(false);
  const isRepeating = row.form.form_type === "repeating";
  const latest = row.submissions[0];
  return (
    <CardWrap>
      <div onClick={() => onOpenSubmission(latest)} style={{ cursor: "pointer" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.darkText, display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ color: C.success || C.accent }}>✓</span>
              {row.form.name}
              {isRepeating && row.submissions.length > 1 && (
                <span style={{
                  fontSize: 10, padding: "1px 6px", borderRadius: RADIUS.pill,
                  background: C.accent + "14", color: C.accent,
                }}>{row.submissions.length}</span>
              )}
            </div>
            <div style={{ fontSize: 11, color: C.darkMuted, marginTop: 2 }}>
              {isRepeating && row.submissions.length > 1
                ? `${row.submissions.length} submissions · latest ${relativeTime(latest.submitted_at)}`
                : `Submitted ${relativeTime(latest.submitted_at)}`}
            </div>
          </div>
        </div>
      </div>
      {isRepeating && (
        <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
          <button
            onClick={(e) => { e.stopPropagation(); onSubmitAgain(); }}
            style={{
              padding: "4px 10px", fontSize: 11, fontWeight: 600,
              background: C.accent + "14", color: C.accent,
              border: `1px solid ${C.accent}55`, borderRadius: RADIUS.pill,
              cursor: "pointer", fontFamily: FONT,
            }}
          >+ Submit again</button>
          {row.submissions.length > 1 && (
            <button
              onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}
              style={{
                padding: "4px 10px", fontSize: 11, fontWeight: 600,
                background: "transparent", color: C.darkMuted,
                border: `1px solid ${C.darkBorder}`, borderRadius: RADIUS.pill,
                cursor: "pointer", fontFamily: FONT,
              }}
            >{expanded ? "Hide" : `View all (${row.submissions.length})`}</button>
          )}
        </div>
      )}
      {expanded && (
        <div style={{ marginTop: 8, borderTop: `1px solid ${C.edgeLine}`, paddingTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
          {row.submissions.map((s) => (
            <div
              key={s.id}
              onClick={() => onOpenSubmission(s)}
              style={{
                padding: "6px 8px", display: "flex", justifyContent: "space-between",
                alignItems: "center", cursor: "pointer", borderRadius: RADIUS.sm,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = C.darkSurf2; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
            >
              <span style={{ fontSize: 11, color: C.darkText }}>
                {formatDate(s.submitted_at)}
                {s.edited_at && (
                  <span style={{ color: C.darkMuted, marginLeft: 4 }}>· edited</span>
                )}
              </span>
              <button
                onClick={(e) => { e.stopPropagation(); onDeleteSubmission(s); }}
                style={iconBtnStyle}
                title="Delete submission"
              >🗑</button>
            </div>
          ))}
        </div>
      )}
    </CardWrap>
  );
}

const iconBtnStyle = {
  background: "transparent", border: "none", color: C.darkMuted,
  cursor: "pointer", fontSize: 13, padding: 4, lineHeight: 1,
};

function relativeTime(iso) {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (isNaN(t)) return iso;
  const diff = Math.floor((Date.now() - t) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`;
  return formatDate(iso);
}

function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

