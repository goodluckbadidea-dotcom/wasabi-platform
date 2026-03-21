// ─── Zen Gmail ───
// Simplified single-column Gmail inbox for Sashimi mode.
// Supports: inbox list, inline expand, reply, compose, archive.
// No search, no label tabs, no star/unstar — keeps it simple.

import React, { useState, useEffect, useCallback, useRef } from "react";
import { C, FONT, FONT_DISPLAY, RADIUS } from "../design/tokens.js";
import { ANIM, TRANSITION } from "../design/animations.js";
import { searchEmails, getEmail, sendEmail, modifyEmail } from "../lib/api.js";
import { useRecordDrawer } from "./RecordDrawerContext.jsx";
import RecordDrawer from "./RecordDrawer.jsx";

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

function truncate(str, max) {
  if (!str) return "";
  return str.length > max ? str.slice(0, max) + "..." : str;
}

// ── Compose / Reply Modal ──
function ComposeModal({ onClose, onSent, replyTo }) {
  const [to, setTo] = useState(replyTo?.from || "");
  const [subject, setSubject] = useState(replyTo ? `Re: ${replyTo.subject?.replace(/^Re:\s*/i, "") || ""}` : "");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const inputRef = useRef(null);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 100);
  }, []);

  const handleSend = useCallback(async () => {
    if (!to.trim() || !subject.trim()) return;
    setSending(true);
    setError(null);
    try {
      await sendEmail({
        to: to.trim(),
        subject: subject.trim(),
        bodyText: body,
        threadId: replyTo?.threadId || undefined,
        inReplyTo: replyTo?.messageId || undefined,
        references: replyTo?.messageId || undefined,
      });
      onSent?.();
      onClose();
    } catch (err) {
      console.error("[ZenGmail] Send failed:", err);
      setError("Failed to send. Please try again.");
    } finally {
      setSending(false);
    }
  }, [to, subject, body, replyTo, onSent, onClose]);

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 999,
      display: "flex", alignItems: "center", justifyContent: "center",
      background: C.overlayBg, animation: ANIM.fadeIn(),
    }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "90%", maxWidth: 520,
          background: C.darkSurf, border: `1px solid ${C.darkBorder}`,
          borderRadius: RADIUS.xl, padding: 0,
          animation: ANIM.scaleIn?.() || ANIM.fadeIn(),
          display: "flex", flexDirection: "column",
          maxHeight: "80vh",
        }}
      >
        {/* Header */}
        <div style={{
          padding: "14px 18px", borderBottom: `1px solid ${C.darkBorder}`,
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <span style={{ fontSize: 14, fontWeight: 600, fontFamily: FONT, color: C.darkText }}>
            {replyTo ? "Reply" : "Compose"}
          </span>
          <button
            onClick={onClose}
            style={{
              background: "none", border: "none", cursor: "pointer",
              padding: 8, display: "flex", outline: "none",
              borderRadius: RADIUS.sm, minWidth: 28, minHeight: 28,
              alignItems: "center", justifyContent: "center",
            }}
          >
            <svg width="14" height="14" viewBox="0 0 12 12" fill="none">
              <path d="M2 2L10 10M10 2L2 10" stroke={C.darkMuted} strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Form */}
        <div style={{ padding: "14px 18px", flex: 1, overflowY: "auto" }}>
          <div style={{ marginBottom: 10 }}>
            <label style={labelStyle}>To</label>
            <input
              ref={replyTo ? undefined : inputRef}
              type="email"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="recipient@email.com"
              readOnly={!!replyTo}
              style={{
                ...fieldStyle,
                opacity: replyTo ? 0.7 : 1,
                cursor: replyTo ? "default" : "text",
              }}
              onFocus={(e) => { if (!replyTo) e.target.style.borderColor = C.accent; }}
              onBlur={(e) => { e.target.style.borderColor = C.darkBorder; }}
            />
          </div>
          <div style={{ marginBottom: 10 }}>
            <label style={labelStyle}>Subject</label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Subject"
              style={fieldStyle}
              onFocus={(e) => { e.target.style.borderColor = C.accent; }}
              onBlur={(e) => { e.target.style.borderColor = C.darkBorder; }}
            />
          </div>
          <div style={{ marginBottom: 10 }}>
            <label style={labelStyle}>Message</label>
            <textarea
              ref={replyTo ? inputRef : undefined}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Write your message..."
              rows={8}
              style={{ ...fieldStyle, resize: "vertical", minHeight: 120 }}
              onFocus={(e) => { e.target.style.borderColor = C.accent; }}
              onBlur={(e) => { e.target.style.borderColor = C.darkBorder; }}
            />
          </div>

          {error && (
            <div style={{
              fontSize: 11, fontFamily: FONT, color: "#E05252",
              marginBottom: 10, padding: "6px 10px",
              background: "#E0525215", borderRadius: RADIUS.md,
            }}>
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: "12px 18px", borderTop: `1px solid ${C.darkBorder}`,
          display: "flex", gap: 8, justifyContent: "flex-end",
        }}>
          <button onClick={onClose} style={cancelBtnStyle}>Cancel</button>
          <button
            onClick={handleSend}
            disabled={sending || !to.trim() || !subject.trim()}
            style={{
              ...sendBtnStyle,
              opacity: sending || !to.trim() || !subject.trim() ? 0.5 : 1,
              cursor: sending ? "wait" : "pointer",
            }}
          >
            {sending ? "Sending..." : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Component ──
export default function GmailView() {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState(null);
  const [expandedBody, setExpandedBody] = useState(null);
  const [bodyLoading, setBodyLoading] = useState(false);
  const [error, setError] = useState(null);
  const [activeLabel, setActiveLabel] = useState("INBOX");
  const [searchQuery, setSearchQuery] = useState("");
  const { openDrawer } = useRecordDrawer();
  const lastClickRef = useRef({ id: null, time: 0 });
  const singleClickTimerRef = useRef(null);
  const searchTimerRef = useRef(null);

  // ── Fetch emails (supports label + search) ──
  const fetchEmails = useCallback(async (query) => {
    setLoading(true);
    setError(null);
    try {
      const labelConfig = LABELS.find((l) => l.key === activeLabel);
      const baseQuery = labelConfig ? labelConfig.query : "in:inbox";
      const fullQuery = query ? `${baseQuery} ${query}` : baseQuery;
      const result = await searchEmails(fullQuery, 30);
      setMessages(Array.isArray(result?.messages) ? result.messages : []);
    } catch (err) {
      console.error("[ZenGmail] Fetch failed:", err);
      setError("Failed to load emails.");
      setMessages([]);
    } finally {
      setLoading(false);
    }
  }, [activeLabel]);

  // Fetch on mount + label change
  useEffect(() => {
    setExpandedId(null);
    setExpandedBody(null);
    fetchEmails(searchQuery);
  }, [activeLabel]); // eslint-disable-line react-hooks/exhaustive-deps

  // Alias for backward compat
  const fetchInbox = useCallback(() => fetchEmails(searchQuery), [fetchEmails, searchQuery]);

  // ── Search with debounce ──
  const handleSearchChange = useCallback((e) => {
    const val = e.target.value;
    setSearchQuery(val);
    clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      fetchEmails(val);
    }, 400);
  }, [fetchEmails]);

  // ── Expand a message ──
  const handleExpand = useCallback(async (msg) => {
    if (expandedId === msg.id) {
      setExpandedId(null);
      setExpandedBody(null);
      return;
    }
    setExpandedId(msg.id);
    setBodyLoading(true);
    setExpandedBody(null);
    try {
      const full = await getEmail(msg.id);
      setExpandedBody(full);
      // Mark as read
      if (msg.labelIds?.includes("UNREAD")) {
        modifyEmail(msg.id, "mark_read").catch(() => {});
        // Optimistically update label
        setMessages((prev) =>
          prev.map((m) =>
            m.id === msg.id
              ? { ...m, labelIds: (m.labelIds || []).filter((l) => l !== "UNREAD") }
              : m
          )
        );
      }
    } catch (err) {
      console.error("[ZenGmail] Get email failed:", err);
      setExpandedBody({ error: true });
    } finally {
      setBodyLoading(false);
    }
  }, [expandedId]);

  // ── Archive ──
  const handleArchive = useCallback(async (msgId, e) => {
    if (e) { e.stopPropagation(); }
    // Optimistic remove
    setMessages((prev) => prev.filter((m) => m.id !== msgId));
    if (expandedId === msgId) {
      setExpandedId(null);
      setExpandedBody(null);
    }
    try {
      await modifyEmail(msgId, "archive");
    } catch (err) {
      console.error("[ZenGmail] Archive failed:", err);
      // Refresh to restore
      fetchInbox();
    }
  }, [expandedId, fetchInbox]);

  // ── Trash / Delete ──
  const handleTrash = useCallback(async (msgId, e) => {
    if (e) { e.stopPropagation(); }
    setMessages((prev) => prev.filter((m) => m.id !== msgId));
    if (expandedId === msgId) {
      setExpandedId(null);
      setExpandedBody(null);
    }
    try {
      await modifyEmail(msgId, "trash");
    } catch (err) {
      console.error("[ZenGmail] Trash failed:", err);
      fetchInbox();
    }
  }, [expandedId, fetchInbox]);

  // ── Star / Unstar ──
  const handleToggleStar = useCallback(async (msgId, e) => {
    if (e) { e.stopPropagation(); }
    const msg = messages.find((m) => m.id === msgId);
    const isStarred = msg?.labelIds?.includes("STARRED");
    const action = isStarred ? "unstar" : "star";
    // Optimistic update
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== msgId) return m;
        const labels = m.labelIds || [];
        return { ...m, labelIds: isStarred ? labels.filter((l) => l !== "STARRED") : [...labels, "STARRED"] };
      })
    );
    try {
      await modifyEmail(msgId, action);
    } catch (err) {
      console.error("[ZenGmail] Star toggle failed:", err);
      fetchInbox();
    }
  }, [messages, fetchInbox]);

  // ── Mark Read / Unread ──
  const handleToggleRead = useCallback(async (msgId, e) => {
    if (e) { e.stopPropagation(); }
    const msg = messages.find((m) => m.id === msgId);
    const isUnread = msg?.labelIds?.includes("UNREAD");
    const action = isUnread ? "mark_read" : "mark_unread";
    // Optimistic update
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== msgId) return m;
        const labels = m.labelIds || [];
        return { ...m, labelIds: isUnread ? labels.filter((l) => l !== "UNREAD") : [...labels, "UNREAD"] };
      })
    );
    try {
      await modifyEmail(msgId, action);
    } catch (err) {
      console.error("[ZenGmail] Read toggle failed:", err);
      fetchInbox();
    }
  }, [messages, fetchInbox]);

  // ── Reply (opens drawer with reply mode) ──
  const handleReply = useCallback((msg, fullMsg) => {
    openDrawer("email", {
      ...msg,
      ...(fullMsg || {}),
      replyMode: "reply",
      onSent: () => setTimeout(fetchInbox, 1500),
      onArchived: (msgId) => {
        setMessages((prev) => prev.filter((m) => m.id !== msgId));
      },
      onTrashed: (msgId) => {
        setMessages((prev) => prev.filter((m) => m.id !== msgId));
      },
    });
  }, [openDrawer, fetchInbox]);

  // ── After send ──
  const handleSent = useCallback(() => {
    setTimeout(fetchInbox, 1500);
  }, [fetchInbox]);

  // ── Double-click detection (500ms timeout) ──
  const DOUBLE_CLICK_MS = 500;

  const handleRowClick = useCallback((msg) => {
    const now = Date.now();
    const last = lastClickRef.current;

    if (last.id === msg.id && (now - last.time) < DOUBLE_CLICK_MS) {
      // Double-click — open thread drawer
      clearTimeout(singleClickTimerRef.current);
      lastClickRef.current = { id: null, time: 0 };
      openDrawer("email", {
        ...msg,
        onSent: () => setTimeout(fetchInbox, 1500),
        onArchived: (msgId) => {
          setMessages((prev) => prev.filter((m) => m.id !== msgId));
        },
        onTrashed: (msgId) => {
          setMessages((prev) => prev.filter((m) => m.id !== msgId));
        },
      });
    } else {
      // First click — schedule inline expand after timeout
      lastClickRef.current = { id: msg.id, time: now };
      clearTimeout(singleClickTimerRef.current);
      singleClickTimerRef.current = setTimeout(() => {
        if (lastClickRef.current.id === msg.id) {
          handleExpand(msg);
        }
      }, DOUBLE_CLICK_MS + 50);
    }
  }, [openDrawer, handleExpand, fetchInbox]);

  return (
    <div style={{
      flex: 1, display: "flex", flexDirection: "column",
      overflow: "hidden", background: C.dark,
    }}>
      {/* Header */}
      <div style={{
        flexShrink: 0, padding: "14px 20px 8px",
        borderBottom: `1px solid ${C.darkBorder}`,
      }}>
        {/* Top row: title + compose + refresh */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          marginBottom: 10,
        }}>
          <div style={{
            fontSize: 18, fontWeight: 600, fontFamily: FONT_DISPLAY, color: C.darkText,
            display: "flex", alignItems: "center", gap: 10,
          }}>
            <svg width="20" height="20" viewBox="0 0 16 16" fill="none">
              <rect x="1" y="3" width="14" height="10" rx="2" stroke={C.accent} strokeWidth="1.3" fill="none" />
              <path d="M1 5L8 9L15 5" stroke={C.accent} strokeWidth="1.3" strokeLinecap="round" />
            </svg>
            Gmail
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              onClick={() => openDrawer("email", { compose: true, onSent: handleSent })}
              style={{
                background: `linear-gradient(135deg, ${C.accent}, ${C.accent}cc)`,
                border: "none", cursor: "pointer",
                padding: "7px 14px", borderRadius: RADIUS.pill,
                fontSize: 12, fontWeight: 600, fontFamily: FONT,
                color: "#fff", outline: "none",
                display: "flex", alignItems: "center", gap: 6,
                minHeight: 32,
              }}
            >
              <svg width="12" height="12" viewBox="0 0 10 10" fill="none">
                <path d="M5 1V9M1 5H9" stroke="#fff" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
              Compose
            </button>
            <button
              onClick={fetchInbox}
              title="Refresh"
              style={{
                background: "none", border: "none", cursor: "pointer",
                padding: 8, display: "flex", opacity: 0.5,
                outline: "none", borderRadius: RADIUS.pill,
                transition: "opacity 0.15s",
                minWidth: 32, minHeight: 32,
                alignItems: "center", justifyContent: "center",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; }}
              onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.5"; }}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path d="M14 2v5h-5" stroke={C.darkMuted} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M12.5 10A5.5 5.5 0 1 1 13 6" stroke={C.darkMuted} strokeWidth="1.3" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>

        {/* Search bar */}
        <div style={{ position: "relative", marginBottom: 8 }}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"
            style={{ position: "absolute", left: 10, top: 9, pointerEvents: "none" }}>
            <circle cx="6" cy="6" r="4.5" stroke={C.darkMuted} strokeWidth="1.2" />
            <path d="M9.5 9.5L12.5 12.5" stroke={C.darkMuted} strokeWidth="1.2" strokeLinecap="round" />
          </svg>
          <input
            type="text"
            value={searchQuery}
            onChange={handleSearchChange}
            placeholder="Search emails..."
            style={{
              width: "100%", boxSizing: "border-box",
              background: C.darkSurf2, border: `1px solid ${C.darkBorder}`,
              borderRadius: RADIUS.pill, padding: "8px 12px 8px 32px",
              color: C.darkText, fontFamily: FONT, fontSize: 13,
              outline: "none", transition: "border-color 0.15s",
            }}
            onFocus={(e) => { e.target.style.borderColor = C.accent; }}
            onBlur={(e) => { e.target.style.borderColor = C.darkBorder; }}
          />
        </div>

        {/* Label tabs */}
        <div style={{ display: "flex", gap: 4 }}>
          {LABELS.map((l) => (
            <button
              key={l.key}
              onClick={() => setActiveLabel(l.key)}
              style={{
                background: activeLabel === l.key ? C.accent + "22" : "transparent",
                border: `1px solid ${activeLabel === l.key ? C.accent + "44" : C.darkBorder}`,
                color: activeLabel === l.key ? C.accent : C.darkMuted,
                padding: "4px 12px", borderRadius: RADIUS.pill,
                cursor: "pointer", fontFamily: FONT, fontSize: 11, fontWeight: 600,
                outline: "none", transition: "all 0.12s",
              }}
            >
              {l.label}
            </button>
          ))}
        </div>
      </div>

      {/* Message list */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {loading ? (
          <div style={{ padding: "12px 16px" }}>
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} style={{
                height: 52, borderRadius: RADIUS.md, marginBottom: 6,
                background: C.darkSurf2, opacity: 0.4,
                animation: "pulse 1.5s ease infinite",
              }} />
            ))}
          </div>
        ) : error ? (
          <div style={{
            padding: "40px 20px", textAlign: "center",
            color: "#E05252", fontFamily: FONT, fontSize: 12,
          }}>
            {error}
            <button
              onClick={fetchInbox}
              style={{
                display: "block", margin: "12px auto 0",
                background: "none", border: `1px solid ${C.darkBorder}`,
                color: C.darkMuted, padding: "6px 14px", borderRadius: RADIUS.md,
                cursor: "pointer", fontFamily: FONT, fontSize: 11, outline: "none",
              }}
            >
              Retry
            </button>
          </div>
        ) : messages.length === 0 ? (
          <div style={{
            padding: "60px 20px", textAlign: "center",
            color: C.darkMuted, fontFamily: FONT, fontSize: 12,
          }}>
            <svg width="24" height="24" viewBox="0 0 16 16" fill="none" style={{ opacity: 0.3, marginBottom: 8 }}>
              <rect x="1" y="3" width="14" height="10" rx="2" stroke={C.darkMuted} strokeWidth="1.3" fill="none" />
              <path d="M1 5L8 9L15 5" stroke={C.darkMuted} strokeWidth="1.3" strokeLinecap="round" />
            </svg>
            <div>Inbox empty</div>
          </div>
        ) : (
          messages.map((msg, idx) => {
            const isUnread = msg.labelIds?.includes("UNREAD");
            const isExpanded = expandedId === msg.id;

            return (
              <div
                key={msg.id || idx}
                style={{ animation: ANIM.scrollReveal(idx) }}
              >
                {/* Message row */}
                <div
                  onClick={() => handleRowClick(msg)}
                  style={{
                    display: "flex", alignItems: "center", gap: 10,
                    padding: "10px 18px",
                    borderBottom: isExpanded ? "none" : `1px solid ${C.darkBorder}22`,
                    cursor: "pointer",
                    transition: TRANSITION.color,
                    background: isExpanded ? C.darkSurf2 : "transparent",
                  }}
                  onMouseEnter={(e) => { if (!isExpanded) e.currentTarget.style.background = C.darkSurf2 + "80"; }}
                  onMouseLeave={(e) => { if (!isExpanded) e.currentTarget.style.background = "transparent"; }}
                >
                  {/* Unread dot */}
                  <div style={{
                    width: 6, height: 6, borderRadius: "50%",
                    background: isUnread ? C.accent : "transparent",
                    flexShrink: 0,
                  }} />

                  {/* Sender */}
                  <div style={{
                    width: 140, flexShrink: 0,
                    fontSize: 13, fontFamily: FONT,
                    fontWeight: isUnread ? 700 : 400,
                    color: isUnread ? C.darkText : C.darkMuted,
                    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                  }}>
                    {truncate(msg.from?.replace(/<.*>/, "").trim() || msg.from || "Unknown", 20)}
                  </div>

                  {/* Subject + snippet */}
                  <div style={{
                    flex: 1, minWidth: 0,
                    display: "flex", alignItems: "baseline", gap: 6,
                  }}>
                    <span style={{
                      fontSize: 13, fontFamily: FONT,
                      fontWeight: isUnread ? 600 : 400,
                      color: C.darkText,
                      whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                      flexShrink: 0, maxWidth: "50%",
                    }}>
                      {truncate(msg.subject || "(no subject)", 40)}
                    </span>
                    <span style={{
                      fontSize: 12, fontFamily: FONT, color: C.darkMuted,
                      whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                      flex: 1, minWidth: 0,
                    }}>
                      {truncate(msg.snippet || "", 60)}
                    </span>
                  </div>

                  {/* Date */}
                  <span style={{
                    fontSize: 11, fontFamily: FONT, color: C.darkMuted,
                    flexShrink: 0,
                  }}>
                    {formatDate(msg.date)}
                  </span>

                  {/* Star button */}
                  {(() => {
                    const starred = msg.labelIds?.includes("STARRED");
                    return (
                      <button
                        onClick={(e) => handleToggleStar(msg.id, e)}
                        title={starred ? "Unstar" : "Star"}
                        style={{
                          background: "none", border: "none",
                          cursor: "pointer", padding: 6, display: "flex",
                          opacity: starred ? 1 : 0.3,
                          outline: "none", flexShrink: 0,
                          transition: "opacity 0.12s",
                          borderRadius: RADIUS.sm, minWidth: 26, minHeight: 26,
                          alignItems: "center", justifyContent: "center",
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.opacity = starred ? "1" : "0.3"; }}
                      >
                        <svg width="14" height="14" viewBox="0 0 14 14" fill={starred ? C.accent : "none"}>
                          <path d="M7 1.5L8.8 5.2L13 5.8L10 8.6L10.7 12.8L7 10.8L3.3 12.8L4 8.6L1 5.8L5.2 5.2L7 1.5Z"
                            stroke={starred ? C.accent : C.darkMuted} strokeWidth="1.2" strokeLinejoin="round" />
                        </svg>
                      </button>
                    );
                  })()}

                  {/* Mark read/unread button */}
                  <button
                    onClick={(e) => handleToggleRead(msg.id, e)}
                    title={isUnread ? "Mark read" : "Mark unread"}
                    style={{
                      background: "none", border: "none",
                      cursor: "pointer", padding: 6, display: "flex",
                      opacity: 0.3, outline: "none", flexShrink: 0,
                      transition: "opacity 0.12s",
                      borderRadius: RADIUS.sm, minWidth: 26, minHeight: 26,
                      alignItems: "center", justifyContent: "center",
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.opacity = "0.8"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.3"; }}
                  >
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <rect x="1" y="3" width="12" height="8" rx="1.5" stroke={C.darkMuted} strokeWidth="1" fill={isUnread ? "none" : C.darkMuted + "33"} />
                      <path d="M1 4.5L7 8L13 4.5" stroke={C.darkMuted} strokeWidth="1" strokeLinecap="round" />
                    </svg>
                  </button>

                  {/* Archive button */}
                  <button
                    onClick={(e) => handleArchive(msg.id, e)}
                    title="Archive"
                    style={{
                      background: "none", border: "none",
                      cursor: "pointer", padding: 8, display: "flex",
                      opacity: 0.3, outline: "none", flexShrink: 0,
                      transition: "opacity 0.12s",
                      borderRadius: RADIUS.sm, minWidth: 30, minHeight: 30,
                      alignItems: "center", justifyContent: "center",
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.opacity = "0.8"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.3"; }}
                  >
                    <svg width="14" height="14" viewBox="0 0 12 12" fill="none">
                      <rect x="1" y="2" width="10" height="3" rx="1" stroke={C.darkMuted} strokeWidth="1" fill="none" />
                      <rect x="2" y="5" width="8" height="5" rx="1" stroke={C.darkMuted} strokeWidth="1" fill="none" />
                      <path d="M5 7.5H7" stroke={C.darkMuted} strokeWidth="1" strokeLinecap="round" />
                    </svg>
                  </button>

                  {/* Trash button */}
                  <button
                    onClick={(e) => handleTrash(msg.id, e)}
                    title="Delete"
                    style={{
                      background: "none", border: "none",
                      cursor: "pointer", padding: 8, display: "flex",
                      opacity: 0.3, outline: "none", flexShrink: 0,
                      transition: "opacity 0.12s",
                      borderRadius: RADIUS.sm, minWidth: 30, minHeight: 30,
                      alignItems: "center", justifyContent: "center",
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.opacity = "0.8"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.3"; }}
                  >
                    <svg width="14" height="14" viewBox="0 0 12 12" fill="none">
                      <path d="M2 3H10M4 3V2H8V3M4.5 5V9M7.5 5V9M3 3L3.5 10H8.5L9 3" stroke={C.darkMuted} strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                </div>

                {/* Expanded body */}
                {isExpanded && (
                  <div style={{
                    padding: "12px 18px 16px 36px",
                    background: C.darkSurf2,
                    borderBottom: `1px solid ${C.darkBorder}`,
                  }}>
                    {bodyLoading ? (
                      <div style={{
                        fontSize: 12, fontFamily: FONT, color: C.darkMuted,
                        padding: "8px 0",
                      }}>
                        Loading...
                      </div>
                    ) : expandedBody?.error ? (
                      <div style={{
                        fontSize: 12, fontFamily: FONT, color: "#E05252",
                        padding: "8px 0",
                      }}>
                        Failed to load email content.
                      </div>
                    ) : (
                      <>
                        {/* From / To */}
                        <div style={{
                          fontSize: 12, fontFamily: FONT, color: C.darkMuted,
                          marginBottom: 8, lineHeight: 1.6,
                        }}>
                          <div><strong style={{ color: C.darkText }}>From:</strong> {expandedBody?.from || msg.from || ""}</div>
                          <div><strong style={{ color: C.darkText }}>To:</strong> {expandedBody?.to || "me"}</div>
                          <div><strong style={{ color: C.darkText }}>Date:</strong> {formatDate(expandedBody?.date || msg.date)}</div>
                        </div>

                        {/* Body */}
                        <div style={{
                          fontSize: 13, fontFamily: FONT, color: C.darkText,
                          lineHeight: 1.6, whiteSpace: "pre-wrap",
                          padding: "8px 0",
                          maxHeight: 400, overflowY: "auto",
                          wordBreak: "break-word",
                        }}>
                          {expandedBody?.bodyText || expandedBody?.snippet || msg.snippet || ""}
                        </div>

                        {/* Actions */}
                        <div style={{
                          display: "flex", gap: 8, marginTop: 12,
                          borderTop: `1px solid ${C.darkBorder}`,
                          paddingTop: 10,
                        }}>
                          <button
                            onClick={() => handleReply(msg, expandedBody)}
                            style={{
                              background: `linear-gradient(135deg, ${C.accent}, ${C.accent}cc)`,
                              border: "none", cursor: "pointer",
                              padding: "8px 16px", borderRadius: RADIUS.pill,
                              fontSize: 12, fontWeight: 600, fontFamily: FONT,
                              color: "#fff", outline: "none",
                              display: "flex", alignItems: "center", gap: 6,
                              minHeight: 34,
                            }}
                          >
                            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                              <path d="M4 2L1 5L4 8" stroke="#fff" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                              <path d="M1 5H7C8.1 5 9 5.9 9 7V8" stroke="#fff" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                            Reply
                          </button>
                          <button
                            onClick={(e) => handleArchive(msg.id, e)}
                            style={{
                              background: "none",
                              border: `1px solid ${C.darkBorder}`,
                              cursor: "pointer",
                              padding: "8px 16px", borderRadius: RADIUS.md,
                              fontSize: 12, fontWeight: 500, fontFamily: FONT,
                              color: C.darkMuted, outline: "none",
                              display: "flex", alignItems: "center", gap: 6,
                              minHeight: 34,
                              transition: "background 0.12s",
                            }}
                            onMouseEnter={(e) => { e.currentTarget.style.background = C.darkSurf; }}
                            onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}
                          >
                            <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                              <rect x="1" y="2" width="10" height="3" rx="1" stroke={C.darkMuted} strokeWidth="1" fill="none" />
                              <rect x="2" y="5" width="8" height="5" rx="1" stroke={C.darkMuted} strokeWidth="1" fill="none" />
                              <path d="M5 7.5H7" stroke={C.darkMuted} strokeWidth="1" strokeLinecap="round" />
                            </svg>
                            Archive
                          </button>
                          <button
                            onClick={(e) => handleTrash(msg.id, e)}
                            style={{
                              background: "none",
                              border: `1px solid ${C.darkBorder}`,
                              cursor: "pointer",
                              padding: "8px 16px", borderRadius: RADIUS.md,
                              fontSize: 12, fontWeight: 500, fontFamily: FONT,
                              color: C.darkMuted, outline: "none",
                              display: "flex", alignItems: "center", gap: 6,
                              minHeight: 34,
                              transition: "background 0.12s",
                            }}
                            onMouseEnter={(e) => { e.currentTarget.style.background = "#E0525215"; e.currentTarget.style.borderColor = "#E0525244"; }}
                            onMouseLeave={(e) => { e.currentTarget.style.background = "none"; e.currentTarget.style.borderColor = C.darkBorder; }}
                          >
                            <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                              <path d="M2 3H10M4 3V2H8V3M4.5 5V9M7.5 5V9M3 3L3.5 10H8.5L9 3" stroke={C.darkMuted} strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                            Delete
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Drawer for email threads, compose, and reply */}
      <RecordDrawer />
    </div>
  );
}

// ── Shared styles ──
const labelStyle = {
  fontSize: 10, fontWeight: 600, fontFamily: FONT,
  color: C.darkMuted, letterSpacing: "0.06em",
  textTransform: "uppercase", marginBottom: 4, display: "block",
};

const fieldStyle = {
  width: "100%", boxSizing: "border-box",
  background: C.darkSurf2, border: `1px solid ${C.darkBorder}`,
  borderRadius: RADIUS.md, padding: "8px 12px",
  color: C.darkText, fontFamily: FONT, fontSize: 13,
  outline: "none", transition: "border-color 0.15s",
};

const cancelBtnStyle = {
  background: "none", border: `1px solid ${C.darkBorder}`,
  color: C.darkMuted, padding: "7px 16px", borderRadius: RADIUS.md,
  cursor: "pointer", fontFamily: FONT, fontSize: 12, fontWeight: 500,
  outline: "none",
};

const sendBtnStyle = {
  background: `linear-gradient(135deg, ${C.accent}, ${C.accent}cc)`,
  border: "none", color: "#fff",
  padding: "7px 20px", borderRadius: RADIUS.pill,
  fontFamily: FONT, fontSize: 12, fontWeight: 600,
  outline: "none",
};
