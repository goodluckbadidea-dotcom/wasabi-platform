// ─── DcInventoryHistory ───
// Row-card list of every saved submission (draft + submitted). Per-card
// actions: download CSV, edit (mockup — opens the workbook), delete
// (destructive confirm modal).

import React, { useMemo, useState } from "react";
import { C, FONT, MONO, RADIUS } from "../../design/tokens.js";
import { formatDay } from "./dcHelpers.js";
import { dcDownloadSubmissionCsv, dcDeleteSubmission } from "../../lib/api.js";

export default function DcInventoryHistory({ extension, submissions, submissionsLoaded, markets, onSubmissionsChanged }) {
  const [query, setQuery] = useState("");
  const [pendingDelete, setPendingDelete] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (submissions || []).filter((s) => {
      if (!q) return true;
      return (
        (s.market || "").toLowerCase().includes(q) ||
        (s.page || "").toLowerCase().includes(q) ||
        (s.counter_name || "").toLowerCase().includes(q) ||
        (s.status || "").toLowerCase().includes(q)
      );
    });
  }, [submissions, query]);

  const onDownload = async (sub) => {
    setBusyId(sub.id);
    try {
      await dcDownloadSubmissionCsv(sub.id);
    } catch (err) {
      alert("Download failed: " + (err.message || err));
    } finally {
      setBusyId(null);
    }
  };

  const onEdit = (sub) => {
    // For MVP, edit reopens the workbook via the tiles landing. A future
    // pass could deep-link to (market, page) and preload this submission.
    alert(`Mockup — reopen this submission (${sub.market} · ${sub.page}) in the workbook editor with counts pre-filled.`);
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setBusyId(pendingDelete.id);
    try {
      await dcDeleteSubmission(pendingDelete.id);
      setPendingDelete(null);
      onSubmissionsChanged();
    } catch (err) {
      alert("Delete failed: " + (err.message || err));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.head}>
        <h1 style={styles.h1}>Inventory History</h1>
        <div style={styles.sub}>Every saved count across every market. Each row is one page submission — tap to reopen it read-only or duplicate its structure into a new draft.</div>
      </div>

      <div style={styles.toolbar}>
        <div style={styles.search}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ color: C.muted }}>
            <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.3" />
            <path d="M9.5 9.5l3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
          <input
            type="search"
            placeholder="Search by counter, market, page, status…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={styles.searchInput}
          />
        </div>
      </div>

      <div style={styles.list}>
        {!submissionsLoaded && (
          <div style={styles.emptyMsg}>Loading submissions…</div>
        )}
        {submissionsLoaded && rows.length === 0 && (
          <div style={styles.emptyMsg}>
            {submissions.length === 0
              ? "No submissions yet — start counting from a market tile to create the first."
              : "No submissions match your search."}
          </div>
        )}
        {rows.map((s) => (
          <HistoryCard
            key={s.id}
            submission={s}
            busy={busyId === s.id}
            onDownload={() => onDownload(s)}
            onEdit={() => onEdit(s)}
            onDelete={() => setPendingDelete(s)}
            onOpen={() => alert(`Mockup — opens ${s.market} · ${s.page} (${s.counter_name || "no counter"}) as read-only.`)}
          />
        ))}
      </div>

      {pendingDelete && (
        <DeleteConfirmModal
          submission={pendingDelete}
          onCancel={() => setPendingDelete(null)}
          onConfirm={confirmDelete}
        />
      )}
    </div>
  );
}

// ── Single card ──
function HistoryCard({ submission, busy, onDownload, onEdit, onDelete, onOpen }) {
  const { day, rel } = formatDay(submission.submitted_at || submission.created_at);
  const isSubmitted = submission.status === "submitted";
  return (
    <div style={styles.card} onClick={onOpen} role="button" tabIndex={0}>
      <div style={styles.dateCol}>
        <div style={styles.dateDay}>{day}</div>
        <div style={styles.dateRel}>{rel}</div>
      </div>
      <div style={styles.bodyCol}>
        <div style={styles.title}>
          <span style={styles.marketPill}>{submission.market}</span>
          <span style={{ fontFamily: FONT, fontSize: 15, fontWeight: 600, color: C.text }}>
            {submission.page ? submission.page[0].toUpperCase() + submission.page.slice(1) : "Weekly count"}
            {submission.category ? ` · ${submission.category[0].toUpperCase() + submission.category.slice(1)}` : ""}
          </span>
        </div>
        <div style={styles.counter}>Counted by {submission.counter_name || "—"}</div>
      </div>
      <div style={styles.statusCol}>
        <div style={{
          ...styles.statusPill,
          background: isSubmitted
            ? `color-mix(in srgb, ${C.success} 15%, transparent)`
            : `color-mix(in srgb, ${C.warning} 15%, transparent)`,
          color: isSubmitted ? C.success : C.warning,
        }}>
          <span style={{
            ...styles.statusDot,
            background: isSubmitted ? C.success : C.warning,
          }} />
          {isSubmitted ? "Submitted" : "Draft"}
        </div>
      </div>
      <div style={styles.actions} onClick={(e) => e.stopPropagation()}>
        <ActionBtn title="Download CSV" onClick={onDownload} disabled={busy}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M8 2v8m0 0l-3-3m3 3l3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M2.5 12.5h11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
          </svg>
        </ActionBtn>
        <ActionBtn title="Edit submission" onClick={onEdit} disabled={busy}>
          <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
            <path d="M10 2.5l2.5 2.5-7 7-3 .5.5-3 7-7z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
          </svg>
        </ActionBtn>
        <ActionBtn title="Delete submission" onClick={onDelete} disabled={busy} danger>
          <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
            <path d="M3 4h9m-7 0v-1a1 1 0 011-1h3a1 1 0 011 1v1M5 4v8a1 1 0 001 1h3a1 1 0 001-1V4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
          </svg>
        </ActionBtn>
      </div>
    </div>
  );
}

function ActionBtn({ title, onClick, disabled, danger, children }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      title={title}
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        ...styles.actionBtn,
        background: hover ? (danger ? `color-mix(in srgb, ${C.error} 14%, transparent)` : C.surfaceAlt) : "transparent",
        color: hover ? (danger ? C.error : C.text) : C.muted,
      }}
    >
      {children}
    </button>
  );
}

// ── Delete confirmation modal ──
function DeleteConfirmModal({ submission, onCancel, onConfirm }) {
  return (
    <div style={styles.overlay} onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div style={styles.confirmCard}>
        <div style={styles.confirmHead}>
          <div style={styles.confirmIcon}>
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M10 3v8m0 3v.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
              <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="1.5"/>
            </svg>
          </div>
          <div>
            <h3 style={styles.confirmTitle}>Delete this submission?</h3>
            <div style={styles.confirmSub}>
              {submission.market} · {submission.page} · {(submission.submitted_at || submission.created_at || "").slice(0, 10)}
              {submission.counter_name ? ` · ${submission.counter_name}` : ""}
            </div>
          </div>
        </div>
        <div style={styles.confirmBody}>
          <p style={{ margin: 0 }}>This <strong style={{ color: C.text }}>can't be undone.</strong> Deleting a submission removes it from Inventory History and detaches it from any downstream reports that referenced it.</p>
          <ul style={styles.confirmList}>
            <li>The counted rows and their timestamps are lost.</li>
            <li>Reports built off this snapshot revert to their prior state.</li>
            <li>The audit log will retain a record that the submission was deleted, and by whom.</li>
          </ul>
        </div>
        <div style={styles.confirmFoot}>
          <button style={styles.secondaryBtn} onClick={onCancel}>Cancel</button>
          <button style={styles.dangerBtn} onClick={onConfirm}>Delete permanently</button>
        </div>
      </div>
    </div>
  );
}

const styles = {
  container: { maxWidth: 1360, margin: "0 auto", padding: "24px 24px 60px" },
  head: { paddingBottom: 20 },
  h1: {
    fontFamily: FONT,
    fontSize: 26,
    fontWeight: 700,
    letterSpacing: "-0.02em",
    color: C.text,
  },
  sub: { fontSize: 13, color: C.textMid, marginTop: 6, maxWidth: 640, lineHeight: 1.5 },
  toolbar: { display: "flex", gap: 10, marginBottom: 18, flexWrap: "wrap" },
  search: {
    flex: 1,
    minWidth: 220,
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 14px",
    background: C.surface,
    border: `1px solid ${C.border}`,
    borderRadius: RADIUS.md,
    minHeight: 40,
  },
  searchInput: {
    flex: 1,
    border: "none",
    outline: "none",
    background: "transparent",
    color: C.text,
    fontFamily: FONT,
    fontSize: 14,
  },
  list: { display: "flex", flexDirection: "column", gap: 10, paddingBottom: 40 },
  emptyMsg: {
    padding: 60,
    textAlign: "center",
    color: C.muted,
    fontSize: 13,
    fontFamily: FONT,
  },
  card: {
    display: "grid",
    gridTemplateColumns: "128px 1fr auto auto",
    gap: 24,
    alignItems: "center",
    padding: "18px 22px",
    background: C.surface,
    border: `1px solid ${C.border}`,
    borderRadius: RADIUS.lg,
    cursor: "pointer",
    fontFamily: FONT,
  },
  dateCol: { display: "flex", flexDirection: "column", gap: 2 },
  dateDay: {
    fontFamily: MONO,
    fontSize: 18,
    fontWeight: 500,
    color: C.text,
    letterSpacing: "0.01em",
    fontVariantNumeric: "tabular-nums",
  },
  dateRel: {
    fontSize: 11,
    color: C.muted,
  },
  bodyCol: { display: "flex", flexDirection: "column", gap: 6, minWidth: 0 },
  title: { display: "flex", alignItems: "center", gap: 10 },
  marketPill: {
    display: "inline-flex",
    alignItems: "center",
    padding: "3px 9px",
    background: `color-mix(in srgb, ${C.accent} 15%, transparent)`,
    color: C.accent,
    fontFamily: MONO,
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: "0.08em",
    borderRadius: RADIUS.pill,
    border: `1px solid color-mix(in srgb, ${C.accent} 20%, transparent)`,
  },
  counter: {
    fontFamily: MONO,
    fontSize: 11,
    color: C.muted,
    letterSpacing: "0.03em",
  },
  statusCol: {},
  statusPill: {
    display: "inline-flex",
    alignItems: "center",
    gap: 7,
    padding: "6px 12px",
    borderRadius: RADIUS.pill,
    fontFamily: FONT,
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
  },
  statusDot: { width: 7, height: 7, borderRadius: "50%" },
  actions: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    paddingLeft: 8,
    borderLeft: `1px solid ${C.edgeLine}`,
    marginLeft: 4,
  },
  actionBtn: {
    width: 36,
    height: 36,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: RADIUS.md,
    background: "transparent",
    border: "none",
    cursor: "pointer",
    color: C.muted,
    transition: "background 0.12s, color 0.12s",
  },
  // Delete confirm modal
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.6)",
    backdropFilter: "blur(6px)",
    WebkitBackdropFilter: "blur(6px)",
    zIndex: 700,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  confirmCard: {
    background: C.surface,
    border: `1px solid ${C.border}`,
    borderRadius: RADIUS.lg,
    boxShadow: "0 8px 32px rgba(0,0,0,0.32)",
    width: "100%",
    maxWidth: 480,
    overflow: "hidden",
    fontFamily: FONT,
  },
  confirmHead: {
    padding: "22px 24px 12px",
    display: "flex",
    gap: 16,
    alignItems: "flex-start",
  },
  confirmIcon: {
    width: 42,
    height: 42,
    borderRadius: "50%",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    background: `color-mix(in srgb, ${C.error} 16%, transparent)`,
    color: C.error,
    flexShrink: 0,
  },
  confirmTitle: {
    fontFamily: FONT,
    fontSize: 17,
    fontWeight: 700,
    letterSpacing: "-0.01em",
    color: C.text,
    marginBottom: 4,
  },
  confirmSub: {
    fontSize: 12,
    color: C.textMid,
    fontFamily: MONO,
    letterSpacing: "0.02em",
  },
  confirmBody: {
    padding: "4px 24px 18px",
    color: C.textMid,
    fontSize: 13.5,
    lineHeight: 1.55,
  },
  confirmList: {
    marginTop: 10,
    paddingLeft: 20,
    color: C.textMid,
  },
  confirmFoot: {
    padding: "14px 24px",
    borderTop: `1px solid ${C.edgeLine}`,
    display: "flex",
    justifyContent: "flex-end",
    gap: 10,
    background: `color-mix(in srgb, ${C.surface} 60%, ${C.bg})`,
  },
  secondaryBtn: {
    background: C.surfaceAlt,
    color: C.text,
    border: `1px solid ${C.border}`,
    padding: "9px 18px",
    borderRadius: RADIUS.md,
    fontFamily: FONT,
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    minHeight: 40,
  },
  dangerBtn: {
    background: C.error,
    color: "#fff",
    border: "none",
    padding: "10px 20px",
    borderRadius: RADIUS.pill,
    fontFamily: FONT,
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    minHeight: 40,
  },
};
