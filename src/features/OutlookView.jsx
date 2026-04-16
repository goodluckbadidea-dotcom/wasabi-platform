// ─── Outlook View ───
// Outlook inbox powered by Microsoft Graph API.
// Supports: inbox list, inline expand, reply, compose, mark read/unread.

import React, { useState, useEffect, useCallback, useRef } from "react";
import { C, FONT, FONT_DISPLAY, RADIUS, Z } from "../design/tokens.js";
import { ANIM, TRANSITION } from "../design/animations.js";
import { formatEmailDate, truncate } from "../utils/helpers.js";
import { searchOutlookMessages, getOutlookMessage, sendOutlookEmail, modifyOutlookMessage } from "../lib/api.js";

const FOLDERS = [
  { key: "inbox", label: "Inbox" },
  { key: "sentitems", label: "Sent" },
  { key: "drafts", label: "Drafts" },
];

// ── Compose / Reply Modal ──
function ComposeModal({ onClose, onSent, replyTo }) {
  const labelStyle = getLabelStyle();
  const fieldStyle = getFieldStyle();
  const cancelBtnStyle = getCancelBtnStyle();
  const sendBtnStyle = getSendBtnStyle();
  const [to, setTo] = useState(replyTo?.from || "");
  const [subject, setSubject] = useState(replyTo ? `Re: ${replyTo.subject?.replace(/^Re:\s*/i, "") || ""}` : "");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const inputRef = useRef(null);

  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 100); }, []);

  const handleSend = useCallback(async () => {
    if (!to.trim() || !subject.trim()) return;
    setSending(true);
    setError(null);
    try {
      await sendOutlookEmail({
        to: to.trim(),
        subject: subject.trim(),
        bodyText: body,
        replyToId: replyTo?.id || undefined,
      });
      onSent?.();
      onClose();
    } catch (err) {
      console.error("[Outlook] Send failed:", err);
      setError("Failed to send. Please try again.");
    } finally {
      setSending(false);
    }
  }, [to, subject, body, replyTo, onSent, onClose]);

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: Z.panel,
      display: "flex", alignItems: "center", justifyContent: "center",
      background: "rgba(0,0,0,0.6)", animation: ANIM.fadeIn(),
    }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: "90%", maxWidth: 520,
        background: C.darkSurf, border: `1px solid ${C.darkBorder}`,
        borderRadius: RADIUS.xl, padding: 0,
        display: "flex", flexDirection: "column", maxHeight: "80vh",
      }}>
        <div style={{
          padding: "14px 18px", borderBottom: `1px solid ${C.darkBorder}`,
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <span style={{ fontSize: 14, fontWeight: 600, fontFamily: FONT, color: C.darkText }}>
            {replyTo ? "Reply" : "New Message"}
          </span>
          <button onClick={onClose} style={iconBtnStyle}>
            <svg width="14" height="14" viewBox="0 0 12 12" fill="none">
              <path d="M2 2L10 10M10 2L2 10" stroke={C.darkMuted} strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div style={{ padding: "14px 18px", flex: 1, overflowY: "auto" }}>
          <div style={{ marginBottom: 10 }}>
            <label style={labelStyle}>To</label>
            <input ref={replyTo ? undefined : inputRef} type="email" value={to}
              onChange={(e) => setTo(e.target.value)} placeholder="recipient@email.com"
              readOnly={!!replyTo}
              style={{ ...fieldStyle, opacity: replyTo ? 0.7 : 1, cursor: replyTo ? "default" : "text" }}
              onFocus={(e) => { if (!replyTo) e.target.style.borderColor = C.accent; }}
              onBlur={(e) => { e.target.style.borderColor = C.darkBorder; }}
            />
          </div>
          <div style={{ marginBottom: 10 }}>
            <label style={labelStyle}>Subject</label>
            <input type="text" value={subject} onChange={(e) => setSubject(e.target.value)}
              placeholder="Subject" style={fieldStyle}
              onFocus={(e) => { e.target.style.borderColor = C.accent; }}
              onBlur={(e) => { e.target.style.borderColor = C.darkBorder; }}
            />
          </div>
          <div style={{ marginBottom: 10 }}>
            <label style={labelStyle}>Message</label>
            <textarea ref={replyTo ? inputRef : undefined} value={body}
              onChange={(e) => setBody(e.target.value)} placeholder="Write your message..."
              rows={8} style={{ ...fieldStyle, resize: "vertical", minHeight: 120 }}
              onFocus={(e) => { e.target.style.borderColor = C.accent; }}
              onBlur={(e) => { e.target.style.borderColor = C.darkBorder; }}
            />
          </div>
          {error && (
            <div style={{
              fontSize: 11, fontFamily: FONT, color: C.error, marginBottom: 10,
              padding: "6px 10px", background: C.error + "15", borderRadius: RADIUS.md,
            }}>{error}</div>
          )}
        </div>
        <div style={{
          padding: "12px 18px", borderTop: `1px solid ${C.darkBorder}`,
          display: "flex", gap: 8, justifyContent: "flex-end",
        }}>
          <button onClick={onClose} style={cancelBtnStyle}>Cancel</button>
          <button onClick={handleSend} disabled={sending || !to.trim() || !subject.trim()}
            style={{ ...sendBtnStyle, opacity: sending || !to.trim() || !subject.trim() ? 0.5 : 1, cursor: sending ? "wait" : "pointer" }}>
            {sending ? "Sending..." : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Component ──
export default function OutlookView() {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState(null);
  const [expandedBody, setExpandedBody] = useState(null);
  const [bodyLoading, setBodyLoading] = useState(false);
  const [error, setError] = useState(null);
  const [activeFolder, setActiveFolder] = useState("inbox");
  const [searchQuery, setSearchQuery] = useState("");
  const [compose, setCompose] = useState(null); // null | { replyTo? }
  const searchTimerRef = useRef(null);

  const fetchMessages = useCallback(async (query) => {
    setLoading(true);
    setError(null);
    try {
      const result = await searchOutlookMessages(query || "", 30, activeFolder);
      setMessages(Array.isArray(result?.messages) ? result.messages : []);
    } catch (err) {
      console.error("[Outlook] Fetch failed:", err);
      setError(err.message || "Failed to load messages. Make sure Microsoft is connected.");
      setMessages([]);
    } finally {
      setLoading(false);
    }
  }, [activeFolder]);

  useEffect(() => {
    setExpandedId(null);
    setExpandedBody(null);
    fetchMessages(searchQuery);
  }, [activeFolder]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSearchChange = useCallback((e) => {
    const val = e.target.value;
    setSearchQuery(val);
    clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => fetchMessages(val), 400);
  }, [fetchMessages]);

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
      const full = await getOutlookMessage(msg.id);
      setExpandedBody(full);
      // Mark as read
      if (!msg.isRead) {
        modifyOutlookMessage(msg.id, "read").catch(() => {});
        setMessages((prev) => prev.map((m) => m.id === msg.id ? { ...m, isRead: true } : m));
      }
    } catch (err) {
      console.error("[Outlook] Get message failed:", err);
      setExpandedBody({ error: true });
    } finally {
      setBodyLoading(false);
    }
  }, [expandedId]);

  const handleMarkRead = useCallback(async (msgId, currentIsRead, e) => {
    if (e) e.stopPropagation();
    const action = currentIsRead ? "unread" : "read";
    setMessages((prev) => prev.map((m) => m.id === msgId ? { ...m, isRead: !currentIsRead } : m));
    try {
      await modifyOutlookMessage(msgId, action);
    } catch (err) {
      console.error("[Outlook] Mark read failed:", err);
      fetchMessages(searchQuery);
    }
  }, [fetchMessages, searchQuery]);

  const handleReply = useCallback((msg) => {
    setCompose({ replyTo: msg });
  }, []);

  const handleSent = useCallback(() => {
    setTimeout(() => fetchMessages(searchQuery), 1500);
  }, [fetchMessages, searchQuery]);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: "transparent" }}>
      {/* Header */}
      <div style={{ flexShrink: 0, padding: "14px 20px 8px", borderBottom: `1px solid ${C.darkBorder}` }}>
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10,
        }}>
          <div style={{
            fontSize: 18, fontWeight: 600, fontFamily: FONT_DISPLAY, color: C.darkText,
            display: "flex", alignItems: "center", gap: 10,
          }}>
            <svg width="18" height="18" viewBox="0 0 21 21" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="1" y="1" width="9" height="9" fill="#F25022"/>
              <rect x="11" y="1" width="9" height="9" fill="#7FBA00"/>
              <rect x="1" y="11" width="9" height="9" fill="#00A4EF"/>
              <rect x="11" y="11" width="9" height="9" fill="#FFB900"/>
            </svg>
            Outlook
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              onClick={() => setCompose({})}
              style={{
                background: `linear-gradient(135deg, ${C.accent}, ${C.accent}cc)`,
                border: "none", cursor: "pointer",
                padding: "7px 14px", borderRadius: RADIUS.pill,
                fontSize: 12, fontWeight: 600, fontFamily: FONT,
                color: "#fff", outline: "none",
                display: "flex", alignItems: "center", gap: 6, minHeight: 32,
              }}
            >
              <svg width="12" height="12" viewBox="0 0 10 10" fill="none">
                <path d="M5 1V9M1 5H9" stroke="#fff" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
              Compose
            </button>
            <button onClick={() => fetchMessages(searchQuery)} title="Refresh"
              style={{ ...iconBtnStyle, opacity: 0.5 }}
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

        {/* Search */}
        <div style={{ position: "relative", marginBottom: 8 }}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"
            style={{ position: "absolute", left: 10, top: 9, pointerEvents: "none" }}>
            <circle cx="6" cy="6" r="4.5" stroke={C.darkMuted} strokeWidth="1.2" />
            <path d="M9.5 9.5L12.5 12.5" stroke={C.darkMuted} strokeWidth="1.2" strokeLinecap="round" />
          </svg>
          <input type="text" value={searchQuery} onChange={handleSearchChange}
            placeholder="Search messages..."
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

        {/* Folder tabs */}
        <div style={{ display: "flex", gap: 4 }}>
          {FOLDERS.map((f) => (
            <button key={f.key} onClick={() => setActiveFolder(f.key)}
              style={{
                background: activeFolder === f.key ? C.accent + "22" : "transparent",
                border: `1px solid ${activeFolder === f.key ? C.accent + "44" : C.darkBorder}`,
                color: activeFolder === f.key ? C.accent : C.darkMuted,
                padding: "4px 12px", borderRadius: RADIUS.pill,
                cursor: "pointer", fontFamily: FONT, fontSize: 11, fontWeight: 600,
                outline: "none", transition: "all 0.12s",
              }}
            >{f.label}</button>
          ))}
        </div>
      </div>

      {/* Message list */}
      <div style={{ flex: 1, overflowY: "auto", background: C.darkSurf }}>
        {loading ? (
          <div style={{ padding: "12px 16px" }}>
            {[1,2,3,4,5].map((i) => (
              <div key={i} style={{
                height: 52, borderRadius: RADIUS.md, marginBottom: 6,
                background: C.darkSurf2, opacity: 0.4,
              }} />
            ))}
          </div>
        ) : error ? (
          <div style={{ padding: "40px 20px", textAlign: "center", color: C.error, fontFamily: FONT, fontSize: 12 }}>
            {error}
            <button onClick={() => fetchMessages(searchQuery)} style={{
              display: "block", margin: "12px auto 0",
              background: "none", border: `1px solid ${C.darkBorder}`,
              color: C.darkMuted, padding: "6px 14px", borderRadius: RADIUS.md,
              cursor: "pointer", fontFamily: FONT, fontSize: 11, outline: "none",
            }}>Retry</button>
          </div>
        ) : messages.length === 0 ? (
          <div style={{ padding: "60px 20px", textAlign: "center", color: C.darkMuted, fontFamily: FONT, fontSize: 12 }}>
            <svg width="24" height="24" viewBox="0 0 16 16" fill="none" style={{ opacity: 0.3, marginBottom: 8, display: "block", margin: "0 auto 8px" }}>
              <rect x="1" y="3" width="14" height="10" rx="2" stroke={C.darkMuted} strokeWidth="1.3" fill="none" />
              <path d="M1 5L8 9L15 5" stroke={C.darkMuted} strokeWidth="1.3" strokeLinecap="round" />
            </svg>
            No messages
          </div>
        ) : (
          messages.map((msg, idx) => {
            const isUnread = !msg.isRead;
            const isExpanded = expandedId === msg.id;
            const senderDisplay = msg.fromName || msg.from || "Unknown";

            return (
              <div key={msg.id || idx} style={{ animation: ANIM.scrollReveal(idx) }}>
                <div
                  onClick={() => handleExpand(msg)}
                  style={{
                    display: "flex", alignItems: "center", gap: 10,
                    padding: "10px 18px",
                    borderBottom: isExpanded ? "none" : `1px solid ${C.darkBorder}22`,
                    cursor: "pointer", transition: TRANSITION.color,
                    background: isExpanded ? C.darkSurf2 : "transparent",
                  }}
                  onMouseEnter={(e) => { if (!isExpanded) e.currentTarget.style.background = C.darkSurf2 + "80"; }}
                  onMouseLeave={(e) => { if (!isExpanded) e.currentTarget.style.background = "transparent"; }}
                >
                  {/* Unread dot */}
                  <div style={{
                    width: 6, height: 6, borderRadius: "50%",
                    background: isUnread ? C.accent : "transparent", flexShrink: 0,
                  }} />

                  {/* Sender */}
                  <div style={{
                    width: 140, flexShrink: 0,
                    fontSize: 13, fontFamily: FONT,
                    fontWeight: isUnread ? 700 : 400,
                    color: isUnread ? C.darkText : C.darkMuted,
                    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                  }}>
                    {truncate(senderDisplay, 20)}
                  </div>

                  {/* Subject + snippet */}
                  <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "baseline", gap: 6 }}>
                    <span style={{
                      fontSize: 13, fontFamily: FONT,
                      fontWeight: isUnread ? 600 : 400, color: C.darkText,
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
                  <span style={{ fontSize: 11, fontFamily: FONT, color: C.darkMuted, flexShrink: 0 }}>
                    {formatEmailDate(msg.date)}
                  </span>

                  {/* Mark read/unread */}
                  <button
                    onClick={(e) => handleMarkRead(msg.id, msg.isRead, e)}
                    title={isUnread ? "Mark read" : "Mark unread"}
                    style={{ ...iconBtnStyle, opacity: 0.3 }}
                    onMouseEnter={(e) => { e.currentTarget.style.opacity = "0.8"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.3"; }}
                  >
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <rect x="1" y="3" width="12" height="8" rx="1.5" stroke={C.darkMuted} strokeWidth="1"
                        fill={isUnread ? "none" : C.darkMuted + "33"} />
                      <path d="M1 4.5L7 8L13 4.5" stroke={C.darkMuted} strokeWidth="1" strokeLinecap="round" />
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
                      <div style={{ fontSize: 12, fontFamily: FONT, color: C.darkMuted, padding: "8px 0" }}>
                        Loading...
                      </div>
                    ) : expandedBody?.error ? (
                      <div style={{ fontSize: 12, fontFamily: FONT, color: C.error, padding: "8px 0" }}>
                        Failed to load message content.
                      </div>
                    ) : (
                      <>
                        <div style={{ fontSize: 12, fontFamily: FONT, color: C.darkMuted, marginBottom: 8, lineHeight: 1.6 }}>
                          <div><strong style={{ color: C.darkText }}>From:</strong> {expandedBody?.fromName ? `${expandedBody.fromName} <${expandedBody.from}>` : expandedBody?.from || msg.from}</div>
                          <div><strong style={{ color: C.darkText }}>To:</strong> {expandedBody?.to || ""}</div>
                          <div><strong style={{ color: C.darkText }}>Date:</strong> {formatEmailDate(expandedBody?.date || msg.date)}</div>
                        </div>
                        <div style={{
                          fontSize: 13, fontFamily: FONT, color: C.darkText,
                          lineHeight: 1.6, whiteSpace: "pre-wrap",
                          padding: "8px 0", maxHeight: 400, overflowY: "auto",
                          wordBreak: "break-word",
                        }}>
                          {expandedBody?.body || expandedBody?.snippet || msg.snippet || ""}
                        </div>
                        <div style={{
                          display: "flex", gap: 8, marginTop: 12,
                          borderTop: `1px solid ${C.darkBorder}`, paddingTop: 10,
                        }}>
                          <button onClick={() => handleReply(expandedBody || msg)}
                            style={{
                              background: `linear-gradient(135deg, ${C.accent}, ${C.accent}cc)`,
                              border: "none", cursor: "pointer",
                              padding: "8px 16px", borderRadius: RADIUS.pill,
                              fontSize: 12, fontWeight: 600, fontFamily: FONT,
                              color: "#fff", outline: "none",
                              display: "flex", alignItems: "center", gap: 6, minHeight: 34,
                            }}>
                            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                              <path d="M4 2L1 5L4 8" stroke="#fff" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                              <path d="M1 5H7C8.1 5 9 5.9 9 7V8" stroke="#fff" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                            Reply
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

      {/* Compose / Reply modal */}
      {compose && (
        <ComposeModal
          replyTo={compose.replyTo || null}
          onClose={() => setCompose(null)}
          onSent={handleSent}
        />
      )}
    </div>
  );
}

// ── Shared styles ──
// Returned from functions so theme switches pick up fresh C values.
function getLabelStyle() { return {
  fontSize: 10, fontWeight: 600, fontFamily: FONT,
  color: C.darkMuted, letterSpacing: "0.06em",
  textTransform: "uppercase", marginBottom: 4, display: "block",
}; }
function getFieldStyle() { return {
  width: "100%", boxSizing: "border-box",
  background: C.darkSurf2, border: `1px solid ${C.darkBorder}`,
  borderRadius: RADIUS.md, padding: "8px 12px",
  color: C.darkText, fontFamily: FONT, fontSize: 13,
  outline: "none", transition: "border-color 0.15s",
}; }
// iconBtnStyle has no C refs — safe as a const.
const iconBtnStyle = {
  background: "none", border: "none", cursor: "pointer",
  padding: 8, display: "flex", outline: "none",
  borderRadius: RADIUS.sm, minWidth: 30, minHeight: 30,
  alignItems: "center", justifyContent: "center",
  transition: "opacity 0.12s",
};
function getCancelBtnStyle() { return {
  background: "none", border: `1px solid ${C.darkBorder}`,
  color: C.darkMuted, padding: "7px 16px", borderRadius: RADIUS.md,
  cursor: "pointer", fontFamily: FONT, fontSize: 12, fontWeight: 500, outline: "none",
}; }
function getSendBtnStyle() { return {
  background: `linear-gradient(135deg, ${C.accent}, ${C.accent}cc)`,
  border: "none", color: "#fff", padding: "7px 20px",
  borderRadius: RADIUS.pill, fontFamily: FONT, fontSize: 12, fontWeight: 600, outline: "none",
}; }
