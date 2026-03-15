// ─── Gmail Inbox View ───
// Two-panel email client: list on left, detail on right. Compose modal overlay.

import React, { useState, useEffect, useCallback, useRef } from "react";
import { C, FONT, RADIUS } from "../design/tokens.js";
import {
  searchEmails,
  getEmail,
  sendEmail,
  createDraft,
  modifyEmail,
} from "../lib/api.js";
import { IconSearch, IconRefresh, IconMail, IconClose } from "../design/icons.jsx";

// ── Label config ──
const LABELS = [
  { key: "INBOX", label: "Inbox", query: "in:inbox" },
  { key: "SENT", label: "Sent", query: "in:sent" },
  { key: "DRAFT", label: "Drafts", query: "in:drafts" },
  { key: "STARRED", label: "Starred", query: "is:starred" },
];

// ── Date formatting ──
function formatDate(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  const now = new Date();
  const isToday =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (isToday) {
    return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }
  const isThisYear = d.getFullYear() === now.getFullYear();
  if (isThisYear) {
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

// ── Truncate text helper ──
function truncate(str, max) {
  if (!str) return "";
  return str.length > max ? str.slice(0, max) + "..." : str;
}

// ── Component ──

export default function GmailView() {
  // ── State ──
  const [emails, setEmails] = useState([]);
  const [selectedEmail, setSelectedEmail] = useState(null);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeLabel, setActiveLabel] = useState("INBOX");
  const [composing, setComposing] = useState(false);
  const [composeData, setComposeData] = useState({ to: "", subject: "", body: "" });
  const [sendingAction, setSendingAction] = useState(null); // "send" | "draft"
  const searchTimer = useRef(null);

  // ── Fetch emails ──
  const fetchEmails = useCallback(
    async (query) => {
      setLoading(true);
      try {
        const labelConfig = LABELS.find((l) => l.key === activeLabel);
        const baseQuery = labelConfig ? labelConfig.query : "in:inbox";
        const fullQuery = query ? `${baseQuery} ${query}` : baseQuery;
        const result = await searchEmails(fullQuery, 30);
        setEmails(result.messages || result || []);
      } catch (err) {
        console.error("GmailView: failed to fetch emails", err);
        setEmails([]);
      } finally {
        setLoading(false);
      }
    },
    [activeLabel]
  );

  // ── On mount + label change ──
  useEffect(() => {
    setSelectedEmail(null);
    fetchEmails(searchQuery);
  }, [activeLabel]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Search with debounce ──
  const handleSearchChange = useCallback(
    (e) => {
      const val = e.target.value;
      setSearchQuery(val);
      clearTimeout(searchTimer.current);
      searchTimer.current = setTimeout(() => {
        fetchEmails(val);
      }, 400);
    },
    [fetchEmails]
  );

  // ── Select email ──
  const handleSelectEmail = useCallback(async (email) => {
    try {
      const full = await getEmail(email.id);
      setSelectedEmail(full);
    } catch (err) {
      console.error("GmailView: failed to load email", err);
    }
  }, []);

  // ── Refresh ──
  const handleRefresh = useCallback(() => {
    fetchEmails(searchQuery);
  }, [fetchEmails, searchQuery]);

  // ── Email actions ──
  const handleArchive = useCallback(async () => {
    if (!selectedEmail) return;
    try {
      await modifyEmail(selectedEmail.id, "archive");
      setEmails((prev) => prev.filter((e) => e.id !== selectedEmail.id));
      setSelectedEmail(null);
    } catch (err) {
      console.error("GmailView: archive failed", err);
    }
  }, [selectedEmail]);

  const handleToggleStar = useCallback(async () => {
    if (!selectedEmail) return;
    const isStarred = (selectedEmail.labelIds || []).includes("STARRED");
    const action = isStarred ? "unstar" : "star";
    try {
      await modifyEmail(selectedEmail.id, action);
      setSelectedEmail((prev) => {
        if (!prev) return prev;
        const labels = prev.labelIds || [];
        const updated = isStarred
          ? labels.filter((l) => l !== "STARRED")
          : [...labels, "STARRED"];
        return { ...prev, labelIds: updated };
      });
    } catch (err) {
      console.error("GmailView: toggle star failed", err);
    }
  }, [selectedEmail]);

  const handleTrash = useCallback(async () => {
    if (!selectedEmail) return;
    try {
      await modifyEmail(selectedEmail.id, "trash");
      setEmails((prev) => prev.filter((e) => e.id !== selectedEmail.id));
      setSelectedEmail(null);
    } catch (err) {
      console.error("GmailView: trash failed", err);
    }
  }, [selectedEmail]);

  const handleToggleRead = useCallback(async () => {
    if (!selectedEmail) return;
    const isUnread = (selectedEmail.labelIds || []).includes("UNREAD");
    const action = isUnread ? "mark_read" : "mark_unread";
    try {
      await modifyEmail(selectedEmail.id, action);
      setSelectedEmail((prev) => {
        if (!prev) return prev;
        const labels = prev.labelIds || [];
        const updated = isUnread
          ? labels.filter((l) => l !== "UNREAD")
          : [...labels, "UNREAD"];
        return { ...prev, labelIds: updated };
      });
      setEmails((prev) =>
        prev.map((e) => {
          if (e.id !== selectedEmail.id) return e;
          const labels = e.labelIds || [];
          const updated = isUnread
            ? labels.filter((l) => l !== "UNREAD")
            : [...labels, "UNREAD"];
          return { ...e, labelIds: updated };
        })
      );
    } catch (err) {
      console.error("GmailView: toggle read failed", err);
    }
  }, [selectedEmail]);

  // ── Compose actions ──
  const openCompose = useCallback((replyTo) => {
    if (replyTo) {
      setComposeData({
        to: replyTo.from || "",
        subject: replyTo.subject ? `Re: ${replyTo.subject.replace(/^Re:\s*/i, "")}` : "",
        body: "",
      });
    } else {
      setComposeData({ to: "", subject: "", body: "" });
    }
    setComposing(true);
  }, []);

  const closeCompose = useCallback(() => {
    setComposing(false);
    setSendingAction(null);
  }, []);

  const handleSend = useCallback(async () => {
    setSendingAction("send");
    try {
      await sendEmail({
        to: composeData.to,
        subject: composeData.subject,
        bodyText: composeData.body,
      });
      closeCompose();
      if (activeLabel === "SENT") fetchEmails(searchQuery);
    } catch (err) {
      console.error("GmailView: send failed", err);
    } finally {
      setSendingAction(null);
    }
  }, [composeData, closeCompose, activeLabel, fetchEmails, searchQuery]);

  const handleSaveDraft = useCallback(async () => {
    setSendingAction("draft");
    try {
      await createDraft({
        to: composeData.to,
        subject: composeData.subject,
        bodyText: composeData.body,
      });
      closeCompose();
      if (activeLabel === "DRAFT") fetchEmails(searchQuery);
    } catch (err) {
      console.error("GmailView: save draft failed", err);
    } finally {
      setSendingAction(null);
    }
  }, [composeData, closeCompose, activeLabel, fetchEmails, searchQuery]);

  // ── Derived ──
  const isStarred = selectedEmail && (selectedEmail.labelIds || []).includes("STARRED");
  const isUnread = selectedEmail && (selectedEmail.labelIds || []).includes("UNREAD");

  // ── Render ──
  return (
    <div style={S.root}>
      {/* ── Header ── */}
      <div style={S.header}>
        <div style={S.headerLeft}>
          <IconMail size={20} color={C.accent} />
          <span style={S.headerTitle}>Gmail</span>
        </div>
        <div style={S.headerRight}>
          <button style={S.headerBtn} onClick={handleRefresh} title="Refresh">
            <IconRefresh size={16} color={C.darkText} />
          </button>
          <button
            style={{ ...S.headerBtn, ...S.composeBtn }}
            onClick={() => openCompose(null)}
          >
            Compose
          </button>
        </div>
      </div>

      {/* ── Body: two columns ── */}
      <div style={S.body}>
        {/* ── Left panel: email list ── */}
        <div style={S.listPanel}>
          {/* Search */}
          <div style={S.searchWrap}>
            <IconSearch size={16} color={C.darkMuted} style={{ position: "absolute", left: 10, top: 9 }} />
            <input
              type="text"
              value={searchQuery}
              onChange={handleSearchChange}
              placeholder="Search emails..."
              style={S.searchInput}
            />
          </div>

          {/* Label tabs */}
          <div style={S.labelBar}>
            {LABELS.map((l) => (
              <button
                key={l.key}
                onClick={() => setActiveLabel(l.key)}
                style={{
                  ...S.labelPill,
                  ...(activeLabel === l.key ? S.labelPillActive : {}),
                }}
              >
                {l.label}
              </button>
            ))}
          </div>

          {/* Email rows */}
          <div style={S.emailList}>
            {loading && emails.length === 0 && (
              <div style={S.emptyMsg}>Loading...</div>
            )}
            {!loading && emails.length === 0 && (
              <div style={S.emptyMsg}>No emails found</div>
            )}
            {emails.map((email) => {
              const id = email.id;
              const emailUnread = (email.labelIds || []).includes("UNREAD");
              const isSelected = selectedEmail && selectedEmail.id === id;
              return (
                <div
                  key={id}
                  onClick={() => handleSelectEmail(email)}
                  style={{
                    ...S.emailRow,
                    background: emailUnread ? C.darkSurf2 : C.darkSurf,
                    borderLeft: isSelected
                      ? `3px solid ${C.accent}`
                      : "3px solid transparent",
                    paddingLeft: isSelected ? 9 : 12,
                  }}
                >
                  <div style={S.emailRowTop}>
                    <span
                      style={{
                        ...S.emailSender,
                        fontWeight: emailUnread ? 600 : 400,
                        color: emailUnread ? C.darkText : C.darkMuted,
                      }}
                    >
                      {truncate(email.from || email.sender || "(unknown)", 28)}
                    </span>
                    <span style={S.emailDate}>
                      {formatDate(email.date || email.internalDate)}
                    </span>
                  </div>
                  <div style={S.emailSubject}>
                    {truncate(email.subject || "(no subject)", 50)}
                  </div>
                  <div style={S.emailSnippet}>
                    {truncate(email.snippet || "", 80)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Right panel: email detail ── */}
        <div style={S.detailPanel}>
          {!selectedEmail ? (
            <div style={S.detailEmpty}>
              <IconMail size={40} color={C.darkMuted} />
              <span style={{ marginTop: 12, color: C.darkMuted, fontSize: 14 }}>
                Select an email to read
              </span>
            </div>
          ) : (
            <div style={S.detailContent}>
              {/* Subject */}
              <h2 style={S.detailSubject}>
                {selectedEmail.subject || "(no subject)"}
              </h2>

              {/* Meta */}
              <div style={S.detailMeta}>
                <div style={S.metaRow}>
                  <span style={S.metaLabel}>From</span>
                  <span style={S.metaValue}>{selectedEmail.from || "--"}</span>
                </div>
                <div style={S.metaRow}>
                  <span style={S.metaLabel}>To</span>
                  <span style={S.metaValue}>{selectedEmail.to || "--"}</span>
                </div>
                <div style={S.metaRow}>
                  <span style={S.metaLabel}>Date</span>
                  <span style={S.metaValue}>
                    {selectedEmail.date
                      ? new Date(selectedEmail.date).toLocaleString()
                      : "--"}
                  </span>
                </div>
              </div>

              {/* Action bar */}
              <div style={S.actionBar}>
                <button
                  style={S.actionBtn}
                  onClick={() => openCompose(selectedEmail)}
                >
                  Reply
                </button>
                <button style={S.actionBtn} onClick={handleArchive}>
                  Archive
                </button>
                <button style={S.actionBtn} onClick={handleToggleStar}>
                  {isStarred ? "Unstar" : "Star"}
                </button>
                <button style={S.actionBtn} onClick={handleToggleRead}>
                  {isUnread ? "Mark Read" : "Mark Unread"}
                </button>
                <button style={{ ...S.actionBtn, color: "#E05252" }} onClick={handleTrash}>
                  Delete
                </button>
              </div>

              {/* Body */}
              <div style={S.detailBody}>
                {selectedEmail.bodyText || selectedEmail.body || selectedEmail.snippet || ""}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Compose modal ── */}
      {composing && (
        <div style={S.overlay} onClick={closeCompose}>
          <div style={S.modal} onClick={(e) => e.stopPropagation()}>
            {/* Modal header */}
            <div style={S.modalHeader}>
              <span style={S.modalTitle}>New Message</span>
              <button style={S.modalClose} onClick={closeCompose}>
                <IconClose size={14} color={C.darkText} />
              </button>
            </div>

            {/* Fields */}
            <div style={S.modalBody}>
              <input
                type="text"
                placeholder="To"
                value={composeData.to}
                onChange={(e) =>
                  setComposeData((prev) => ({ ...prev, to: e.target.value }))
                }
                style={S.composeInput}
              />
              <input
                type="text"
                placeholder="Subject"
                value={composeData.subject}
                onChange={(e) =>
                  setComposeData((prev) => ({ ...prev, subject: e.target.value }))
                }
                style={S.composeInput}
              />
              <textarea
                placeholder="Write your message..."
                value={composeData.body}
                onChange={(e) =>
                  setComposeData((prev) => ({ ...prev, body: e.target.value }))
                }
                style={S.composeTextarea}
              />
            </div>

            {/* Modal actions */}
            <div style={S.modalActions}>
              <button
                style={{ ...S.modalBtn, ...S.modalBtnPrimary }}
                onClick={handleSend}
                disabled={sendingAction === "send"}
              >
                {sendingAction === "send" ? "Sending..." : "Send"}
              </button>
              <button
                style={S.modalBtn}
                onClick={handleSaveDraft}
                disabled={sendingAction === "draft"}
              >
                {sendingAction === "draft" ? "Saving..." : "Save Draft"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Styles ──

const S = {
  root: {
    height: "100%",
    display: "flex",
    flexDirection: "column",
    fontFamily: FONT,
    background: C.dark,
    color: C.darkText,
  },

  // Header
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "12px 16px",
    borderBottom: `1px solid ${C.darkBorder}`,
    background: C.darkSurf,
    flexShrink: 0,
  },
  headerLeft: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: 600,
    color: C.darkText,
  },
  headerRight: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  headerBtn: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: C.darkSurf2,
    border: `1px solid ${C.darkBorder}`,
    borderRadius: RADIUS.md,
    padding: "6px 8px",
    cursor: "pointer",
    color: C.darkText,
    fontFamily: FONT,
    fontSize: 13,
  },
  composeBtn: {
    background: C.accent,
    border: "none",
    color: "#fff",
    fontWeight: 600,
    padding: "6px 14px",
    borderRadius: RADIUS.md,
  },

  // Body layout
  body: {
    display: "flex",
    flex: 1,
    minHeight: 0,
    overflow: "hidden",
  },

  // List panel (left)
  listPanel: {
    width: "40%",
    minWidth: 280,
    maxWidth: 480,
    display: "flex",
    flexDirection: "column",
    borderRight: `1px solid ${C.darkBorder}`,
    background: C.darkSurf,
  },

  // Search
  searchWrap: {
    position: "relative",
    padding: "10px 12px",
    flexShrink: 0,
  },
  searchInput: {
    width: "100%",
    boxSizing: "border-box",
    background: C.darkSurf2,
    border: `1px solid ${C.darkBorder}`,
    borderRadius: RADIUS.md,
    padding: "7px 10px 7px 32px",
    color: C.darkText,
    fontFamily: FONT,
    fontSize: 13,
    outline: "none",
  },

  // Label pills
  labelBar: {
    display: "flex",
    gap: 6,
    padding: "0 12px 10px",
    flexShrink: 0,
  },
  labelPill: {
    padding: "4px 10px",
    borderRadius: RADIUS.pill,
    fontSize: 12,
    fontWeight: 500,
    fontFamily: FONT,
    background: C.darkSurf2,
    color: C.darkMuted,
    border: `1px solid ${C.darkBorder}`,
    cursor: "pointer",
    transition: "all 0.15s",
  },
  labelPillActive: {
    background: C.accent,
    color: "#fff",
    borderColor: C.accent,
  },

  // Email list
  emailList: {
    flex: 1,
    overflowY: "auto",
  },
  emailRow: {
    padding: "10px 12px",
    borderBottom: `1px solid ${C.darkBorder}`,
    cursor: "pointer",
    transition: "background 0.12s",
  },
  emailRowTop: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 2,
  },
  emailSender: {
    fontSize: 13,
    lineHeight: 1.3,
  },
  emailDate: {
    fontSize: 11,
    color: C.darkMuted,
    flexShrink: 0,
    marginLeft: 8,
  },
  emailSubject: {
    fontSize: 13,
    fontWeight: 500,
    color: C.darkText,
    lineHeight: 1.3,
    marginBottom: 2,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  emailSnippet: {
    fontSize: 12,
    color: C.darkMuted,
    lineHeight: 1.3,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  emptyMsg: {
    padding: 24,
    textAlign: "center",
    color: C.darkMuted,
    fontSize: 13,
  },

  // Detail panel (right)
  detailPanel: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    background: C.dark,
    minWidth: 0,
  },
  detailEmpty: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
  },

  detailContent: {
    flex: 1,
    overflowY: "auto",
    padding: 24,
  },
  detailSubject: {
    fontSize: 20,
    fontWeight: 600,
    color: C.darkText,
    margin: "0 0 16px 0",
    lineHeight: 1.3,
    fontFamily: FONT,
  },

  // Meta rows
  detailMeta: {
    marginBottom: 16,
    borderBottom: `1px solid ${C.darkBorder}`,
    paddingBottom: 14,
  },
  metaRow: {
    display: "flex",
    gap: 10,
    marginBottom: 4,
    fontSize: 13,
    lineHeight: 1.5,
  },
  metaLabel: {
    color: C.darkMuted,
    fontWeight: 500,
    minWidth: 40,
  },
  metaValue: {
    color: C.darkText,
    wordBreak: "break-all",
  },

  // Action bar
  actionBar: {
    display: "flex",
    gap: 8,
    marginBottom: 20,
    flexWrap: "wrap",
  },
  actionBtn: {
    padding: "5px 12px",
    borderRadius: RADIUS.md,
    fontSize: 12,
    fontWeight: 500,
    fontFamily: FONT,
    background: C.darkSurf2,
    color: C.darkText,
    border: `1px solid ${C.darkBorder}`,
    cursor: "pointer",
    transition: "background 0.12s",
  },

  // Email body
  detailBody: {
    fontSize: 14,
    lineHeight: 1.65,
    color: C.darkText,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    fontFamily: FONT,
  },

  // Compose overlay
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.55)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
  },
  modal: {
    width: "100%",
    maxWidth: 560,
    background: C.darkSurf,
    border: `1px solid ${C.darkBorder}`,
    borderRadius: RADIUS.xl,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    boxShadow: "0 16px 48px rgba(0,0,0,0.4)",
  },
  modalHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "14px 18px",
    borderBottom: `1px solid ${C.darkBorder}`,
  },
  modalTitle: {
    fontSize: 15,
    fontWeight: 600,
    color: C.darkText,
  },
  modalClose: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "none",
    border: "none",
    cursor: "pointer",
    padding: 4,
    borderRadius: RADIUS.sm,
  },
  modalBody: {
    padding: 18,
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },
  composeInput: {
    width: "100%",
    boxSizing: "border-box",
    background: C.darkSurf2,
    border: `1px solid ${C.darkBorder}`,
    borderRadius: RADIUS.md,
    padding: "8px 12px",
    color: C.darkText,
    fontFamily: FONT,
    fontSize: 13,
    outline: "none",
  },
  composeTextarea: {
    width: "100%",
    boxSizing: "border-box",
    background: C.darkSurf2,
    border: `1px solid ${C.darkBorder}`,
    borderRadius: RADIUS.md,
    padding: "8px 12px",
    color: C.darkText,
    fontFamily: FONT,
    fontSize: 13,
    outline: "none",
    resize: "vertical",
    minHeight: 160,
    lineHeight: 1.5,
  },
  modalActions: {
    display: "flex",
    gap: 8,
    padding: "12px 18px 16px",
    justifyContent: "flex-end",
  },
  modalBtn: {
    padding: "7px 16px",
    borderRadius: RADIUS.md,
    fontSize: 13,
    fontWeight: 500,
    fontFamily: FONT,
    background: C.darkSurf2,
    color: C.darkText,
    border: `1px solid ${C.darkBorder}`,
    cursor: "pointer",
  },
  modalBtnPrimary: {
    background: C.accent,
    color: "#fff",
    border: "none",
    fontWeight: 600,
  },
};
