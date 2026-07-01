// ─── Inbox View ───
// Gmail inbox. Fetches threads, expand-to-read, reply, compose.

import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { C, FONT, RADIUS, Z } from "../design/tokens.js";
import { ANIM, TRANSITION } from "../design/animations.js";
import { formatEmailDate, truncate } from "../utils/helpers.js";
import PanelHeader, { HeaderIconButton } from "../core/PanelHeader.jsx";
import {
  getGoogleStatus,
  searchEmails,
  getThread,
  sendEmail,
  modifyEmail,
} from "../lib/api.js";

// ─── Compose / Reply Modal ───
function ComposeModal({ onClose, onSent, replyTo }) {
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
      await sendEmail({
        to: to.trim(),
        subject: subject.trim(),
        bodyText: body,
        threadId: replyTo?.threadId,
      });
      onSent?.();
      onClose();
    } catch (err) {
      console.error("[Inbox] Send failed:", err);
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
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}>
            <svg width="14" height="14" viewBox="0 0 12 12" fill="none">
              <path d="M2 2L10 10M10 2L2 10" stroke={C.darkMuted} strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div style={{ padding: "14px 18px", flex: 1, overflowY: "auto" }}>
          <div style={{ marginBottom: 10 }}>
            <label style={{ fontSize: 10, fontWeight: 600, color: C.darkMuted, fontFamily: FONT, textTransform: "uppercase", letterSpacing: "0.05em" }}>To</label>
            <input
              ref={inputRef}
              type="email" value={to} onChange={(e) => setTo(e.target.value)}
              placeholder="recipient@example.com"
              style={{
                width: "100%", boxSizing: "border-box", marginTop: 4,
                background: C.darkSurf2, border: `1px solid ${C.darkBorder}`,
                borderRadius: RADIUS.md, padding: "8px 12px",
                color: C.darkText, fontFamily: FONT, fontSize: 13, outline: "none",
              }}
            />
          </div>
          <div style={{ marginBottom: 10 }}>
            <label style={{ fontSize: 10, fontWeight: 600, color: C.darkMuted, fontFamily: FONT, textTransform: "uppercase", letterSpacing: "0.05em" }}>Subject</label>
            <input
              type="text" value={subject} onChange={(e) => setSubject(e.target.value)}
              style={{
                width: "100%", boxSizing: "border-box", marginTop: 4,
                background: C.darkSurf2, border: `1px solid ${C.darkBorder}`,
                borderRadius: RADIUS.md, padding: "8px 12px",
                color: C.darkText, fontFamily: FONT, fontSize: 13, outline: "none",
              }}
            />
          </div>
          <div>
            <label style={{ fontSize: 10, fontWeight: 600, color: C.darkMuted, fontFamily: FONT, textTransform: "uppercase", letterSpacing: "0.05em" }}>Message</label>
            <textarea
              value={body} onChange={(e) => setBody(e.target.value)}
              rows={10}
              style={{
                width: "100%", boxSizing: "border-box", marginTop: 4,
                background: C.darkSurf2, border: `1px solid ${C.darkBorder}`,
                borderRadius: RADIUS.md, padding: "10px 12px",
                color: C.darkText, fontFamily: FONT, fontSize: 13,
                outline: "none", resize: "vertical", minHeight: 200,
              }}
            />
          </div>
          {error && <div style={{ color: C.error, fontSize: 12, marginTop: 8 }}>{error}</div>}
        </div>
        <div style={{
          padding: "12px 18px", borderTop: `1px solid ${C.darkBorder}`,
          display: "flex", gap: 8, justifyContent: "flex-end",
        }}>
          <button onClick={onClose} disabled={sending} style={{
            background: "transparent", border: `1px solid ${C.darkBorder}`,
            color: C.darkMuted, padding: "7px 14px", borderRadius: RADIUS.pill,
            cursor: sending ? "not-allowed" : "pointer", fontFamily: FONT,
            fontSize: 12, fontWeight: 600, outline: "none",
          }}>Cancel</button>
          <button onClick={handleSend} disabled={sending || !to.trim() || !subject.trim()} style={{
            background: `linear-gradient(135deg, ${C.accent}, ${C.accent}cc)`,
            color: "#fff", border: "none", padding: "7px 14px",
            borderRadius: RADIUS.pill,
            cursor: (sending || !to.trim() || !subject.trim()) ? "not-allowed" : "pointer",
            fontFamily: FONT, fontSize: 12, fontWeight: 600, outline: "none",
            opacity: (sending || !to.trim() || !subject.trim()) ? 0.5 : 1,
          }}>{sending ? "Sending..." : "Send"}</button>
        </div>
      </div>
    </div>
  );
}

// ─── Sender display helpers ───

// "Mark Brooks <mark@premier.com>" → "Mark Brooks"
// "mark@premier.com" → "mark@premier.com"
function senderName(raw) {
  if (!raw) return "Unknown";
  const lt = raw.indexOf("<");
  if (lt > 0) return raw.slice(0, lt).trim().replace(/^"|"$/g, "");
  return raw;
}

// Compact a list of senders into a display string with overflow indicator.
function compactSenders(senders) {
  const unique = [];
  const seen = new Set();
  for (const s of senders) {
    const name = senderName(s);
    const k = name.toLowerCase();
    if (!seen.has(k)) { seen.add(k); unique.push(name); }
  }
  if (unique.length === 0) return "Unknown";
  if (unique.length === 1) return unique[0];
  if (unique.length === 2) return `${unique[0]}, ${unique[1]}`;
  if (unique.length === 3) return `${unique[0]}, ${unique[1]}, ${unique[2]}`;
  return `${unique[0]}, ${unique[1]} +${unique.length - 2}`;
}

// ─── Thread grouping ───
// Group flat messages into threads by threadId. Falls back to message id.
function groupThreads(messages) {
  const groups = new Map();
  for (const m of messages) {
    const tid = m.threadId || m.id;
    if (!groups.has(tid)) {
      groups.set(tid, {
        threadKey: tid,
        threadId: tid,
        subject: m.subject,
        messages: [],
      });
    }
    groups.get(tid).messages.push(m);
  }
  // Compute aggregates for each thread.
  return Array.from(groups.values()).map((g) => {
    const sorted = [...g.messages].sort((a, b) => {
      const da = new Date(a.date).getTime() || 0;
      const db = new Date(b.date).getTime() || 0;
      return db - da; // newest first
    });
    const latest = sorted[0];
    return {
      ...g,
      messages: sorted,
      latest,
      latestDate: latest?.date || "",
      isAnyUnread: g.messages.some((m) => !m.isRead),
      sendersDisplay: compactSenders(sorted.map((m) => m.fromName || m.from)),
      messageCount: g.messages.length,
      displaySubject: (g.messages.find((m) => m.subject && !/^re:\s/i.test(m.subject))?.subject)
        || latest?.subject
        || "(no subject)",
    };
  }).sort((a, b) => {
    const da = new Date(a.latestDate).getTime() || 0;
    const db = new Date(b.latestDate).getTime() || 0;
    return db - da;
  });
}

// ─── Main View ───
export default function InboxView() {
  const [googleConnected, setGoogleConnected] = useState(false);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [filter, setFilter] = useState("all"); // "all" | "unread"
  const [expandedThreadKey, setExpandedThreadKey] = useState(null);
  const [expandedThread, setExpandedThread] = useState(null); // { loading, messages?, error? }
  const [compose, setCompose] = useState(null);
  const searchTimerRef = useRef(null);

  // ── Normalize Gmail messages into a common shape ──
  const normalizeGmail = (m) => ({
    key: m.id,
    id: m.id,
    threadId: m.threadId,
    from: m.from || "",
    fromName: m.fromName || (m.from || "").split("<")[0].trim() || m.from,
    subject: m.subject || "(no subject)",
    snippet: m.snippet || "",
    date: m.date || "",
    isRead: m.isRead !== false && !((m.labelIds || []).includes("UNREAD")),
  });

  // ── Fetch messages from Gmail ──
  const fetchMessages = useCallback(async (q = "") => {
    setLoading(true);
    setError(null);
    try {
      const gStatus = await getGoogleStatus().catch(() => null);
      // googleConnected here means "user has Gmail grant" — Sheets-only Google
      // connections don't surface in the inbox.
      const isGoogle = !!gStatus?.connected && (gStatus?.grants || []).includes("gmail");
      setGoogleConnected(isGoogle);

      if (!isGoogle) {
        setMessages([]);
        return;
      }

      const gQuery = q ? q : "in:inbox";
      const gRes = await searchEmails(gQuery, 40).catch(() => null);
      const gMessages = (gRes?.messages || gRes?.emails || []).map(normalizeGmail);
      const sorted = gMessages.sort((a, b) => {
        const da = new Date(a.date).getTime() || 0;
        const db = new Date(b.date).getTime() || 0;
        return db - da;
      });
      setMessages(sorted);
    } catch (err) {
      console.error("[Inbox] Fetch failed:", err);
      setError("Failed to load messages.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchMessages(""); }, [fetchMessages]);

  // ── Debounced search ──
  const handleSearchChange = (e) => {
    const v = e.target.value;
    setSearchQuery(v);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => { fetchMessages(v); }, 400);
  };

  // ── Group messages into threads, then filter ──
  const visibleThreads = useMemo(() => {
    const threads = groupThreads(messages);
    return threads.filter((t) => {
      if (filter === "unread" && !t.isAnyUnread) return false;
      return true;
    });
  }, [messages, filter]);

  // ── Expand a thread (fetch full conversation) ──
  const handleExpandThread = useCallback(async (thread) => {
    if (expandedThreadKey === thread.threadKey) {
      setExpandedThreadKey(null);
      setExpandedThread(null);
      return;
    }
    setExpandedThreadKey(thread.threadKey);
    setExpandedThread({ loading: true });
    try {
      const fullThread = await getThread(thread.threadId);
      const fullMessages = (fullThread?.messages || []).slice().sort((a, b) => {
        const da = new Date(a.date).getTime() || 0;
        const db = new Date(b.date).getTime() || 0;
        return da - db; // chronological (oldest first) for natural reading order
      });
      setExpandedThread({ messages: fullMessages });

      // Mark all unread messages in this thread as read.
      const unreadInThread = thread.messages.filter((m) => !m.isRead);
      if (unreadInThread.length) {
        const markPromises = unreadInThread.map((m) =>
          modifyEmail(m.id, "mark_read").catch(() => null)
        );
        Promise.all(markPromises).then(() => {
          // Reflect read state locally so the thread list updates without refetch.
          setMessages((prev) => prev.map((m) => {
            const inThread = (m.threadId || m.id) === thread.threadKey;
            return inThread && !m.isRead ? { ...m, isRead: true } : m;
          }));
        });
      }
    } catch (err) {
      console.error("[Inbox] Get thread failed:", err);
      setExpandedThread({ error: "Failed to load thread" });
    }
  }, [expandedThreadKey]);

  // Reply to a specific message within a thread (caller picks which one — usually the latest).
  const handleReply = useCallback((msg) => {
    setCompose({
      replyTo: {
        id: msg.id,
        threadId: msg.threadId,
        from: msg.from,
        subject: msg.subject,
      },
    });
  }, []);

  const handleSent = useCallback(() => {
    setTimeout(() => fetchMessages(searchQuery), 1500);
  }, [fetchMessages, searchQuery]);

  // ── Render ──
  if (!googleConnected && !loading) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", padding: 24, gap: 8 }}>
        <div style={{ fontSize: 14, fontFamily: FONT, color: C.darkMuted }}>
          Gmail not connected.
        </div>
        <div style={{ fontSize: 12, fontFamily: FONT, color: C.darkMuted, opacity: 0.7 }}>
          Connect Google in Settings.
        </div>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: "transparent" }}>
      {/* Shared panel header */}
      <PanelHeader
        side="right"
        title="Inbox"
        icon={
          <svg width="20" height="20" viewBox="0 0 18 18" fill="none">
            <rect x="1.5" y="3.5" width="15" height="11" rx="1.5" stroke={C.accent} strokeWidth="1.4" fill="none" />
            <path d="M2 5L9 10L16 5" stroke={C.accent} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        }
      >
        <button
          onClick={() => setCompose({})}
          style={{
            background: `linear-gradient(135deg, ${C.accent}, ${C.accent}cc)`,
            border: "none", cursor: "pointer", color: "#fff",
            padding: "5px 12px", borderRadius: RADIUS.pill,
            fontSize: 11, fontWeight: 600, fontFamily: FONT, outline: "none",
            display: "flex", alignItems: "center", gap: 5, minHeight: 28,
            marginRight: 4,
          }}
        >
          <svg width="11" height="11" viewBox="0 0 10 10" fill="none">
            <path d="M5 1V9M1 5H9" stroke="#fff" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
          Compose
        </button>
        <HeaderIconButton onClick={() => fetchMessages(searchQuery)} title="Refresh">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path d="M14 2v5h-5" stroke={C.darkMuted} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M12.5 10A5.5 5.5 0 1 1 13 6" stroke={C.darkMuted} strokeWidth="1.3" strokeLinecap="round" />
          </svg>
        </HeaderIconButton>
      </PanelHeader>

      {/* Search + filters row */}
      <div style={{ flexShrink: 0, padding: "12px 20px 12px", borderBottom: `1px solid ${C.darkBorder}` }}>
        {/* Search */}
        <div style={{ position: "relative", marginBottom: 8 }}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"
            style={{ position: "absolute", left: 10, top: 9, pointerEvents: "none" }}>
            <circle cx="6" cy="6" r="4.5" stroke={C.darkMuted} strokeWidth="1.2" />
            <path d="M9.5 9.5L12.5 12.5" stroke={C.darkMuted} strokeWidth="1.2" strokeLinecap="round" />
          </svg>
          <input type="text" value={searchQuery} onChange={handleSearchChange}
            placeholder="Search inbox..."
            style={{
              width: "100%", boxSizing: "border-box",
              background: C.darkSurf2, border: `1px solid ${C.darkBorder}`,
              borderRadius: RADIUS.pill, padding: "8px 12px 8px 32px",
              color: C.darkText, fontFamily: FONT, fontSize: 13, outline: "none",
            }}
          />
        </div>

        {/* Filter pills */}
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {[
            { key: "all", label: "All" },
            { key: "unread", label: "Unread" },
          ].map((f) => (
            <button key={f.key} onClick={() => setFilter(f.key)}
              style={{
                background: filter === f.key ? C.accent + "22" : "transparent",
                border: `1px solid ${filter === f.key ? C.accent + "44" : C.darkBorder}`,
                color: filter === f.key ? C.accent : C.darkMuted,
                padding: "4px 12px", borderRadius: RADIUS.pill,
                cursor: "pointer", fontFamily: FONT, fontSize: 11, fontWeight: 600, outline: "none",
              }}
            >{f.label}</button>
          ))}
        </div>
      </div>

      {/* Message list */}
      <div style={{ flex: 1, overflowY: "auto", background: C.darkSurf }}>
        {loading ? (
          <div style={{ padding: "12px 16px" }}>
            {[1, 2, 3, 4, 5].map((i) => (
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
        ) : visibleThreads.length === 0 ? (
          <div style={{ padding: "60px 20px", textAlign: "center", color: C.darkMuted, fontFamily: FONT, fontSize: 12 }}>
            No messages
          </div>
        ) : (
          visibleThreads.map((thread, idx) => {
            const isUnread = thread.isAnyUnread;
            const isExpanded = expandedThreadKey === thread.threadKey;

            return (
              <div key={thread.threadKey} style={{ animation: ANIM.scrollReveal(idx) }}>
                <div
                  onClick={() => handleExpandThread(thread)}
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
                  <div style={{
                    width: 6, height: 6, borderRadius: "50%",
                    background: isUnread ? C.accent : "transparent", flexShrink: 0,
                  }} />
                  {/* Sender list (with count badge if multi-message thread) */}
                  <div style={{
                    width: 160, flexShrink: 0,
                    fontSize: 13, fontFamily: FONT,
                    fontWeight: isUnread ? 700 : 400,
                    color: isUnread ? C.darkText : C.darkMuted,
                    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                    display: "flex", alignItems: "center", gap: 6,
                  }}>
                    <span style={{
                      whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                      minWidth: 0,
                    }}>{thread.sendersDisplay}</span>
                    {thread.messageCount > 1 && (
                      <span style={{
                        flexShrink: 0,
                        fontSize: 10, fontWeight: 600,
                        color: C.darkMuted,
                        background: C.darkBorder + "66",
                        padding: "1px 6px", borderRadius: RADIUS.pill,
                        minWidth: 18, textAlign: "center",
                      }}>{thread.messageCount}</span>
                    )}
                  </div>
                  <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "baseline", gap: 6 }}>
                    <span style={{
                      fontSize: 13, fontFamily: FONT,
                      fontWeight: isUnread ? 600 : 400, color: C.darkText,
                      whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                      flexShrink: 0, maxWidth: "50%",
                    }}>{truncate(thread.displaySubject, 40)}</span>
                    <span style={{
                      fontSize: 12, fontFamily: FONT, color: C.darkMuted,
                      whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flex: 1,
                    }}>{thread.latest?.snippet || ""}</span>
                  </div>
                  <div style={{ fontSize: 11, color: C.darkMuted, fontFamily: FONT, flexShrink: 0 }}>
                    {formatEmailDate(thread.latestDate)}
                  </div>
                </div>

                {/* Expanded thread — all messages chronologically */}
                {isExpanded && (
                  <div style={{
                    padding: "12px 18px 16px", background: C.darkSurf2,
                    borderBottom: `1px solid ${C.darkBorder}`,
                  }}>
                    {expandedThread?.loading ? (
                      <div style={{ fontSize: 12, color: C.darkMuted, fontFamily: FONT }}>Loading thread…</div>
                    ) : expandedThread?.error ? (
                      <div style={{ fontSize: 12, color: C.error, fontFamily: FONT }}>{expandedThread.error}</div>
                    ) : (
                      <>
                        <div style={{ marginBottom: 10, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                          <span style={{ fontSize: 11, color: C.darkMuted, fontFamily: FONT }}>
                            {(expandedThread?.messages || []).length} message{(expandedThread?.messages || []).length === 1 ? "" : "s"} in thread
                          </span>
                          <button onClick={() => {
                            // Reply to the latest message in the thread.
                            const msgs = expandedThread?.messages || [];
                            const latest = msgs[msgs.length - 1];
                            if (latest) {
                              handleReply({
                                id: latest.id,
                                threadId: thread.threadId,
                                from: latest.from,
                                subject: latest.subject,
                              });
                            }
                          }} style={{
                            background: C.accent + "22", border: `1px solid ${C.accent}44`,
                            color: C.accent, padding: "5px 12px", borderRadius: RADIUS.pill,
                            cursor: "pointer", fontFamily: FONT, fontSize: 11, fontWeight: 600, outline: "none",
                          }}>↩ Reply</button>
                        </div>

                        {(expandedThread?.messages || []).map((m, mIdx) => (
                          <div key={m.id || mIdx} style={{
                            padding: "12px 0",
                            borderTop: mIdx > 0 ? `1px solid ${C.darkBorder}66` : "none",
                          }}>
                            <div style={{
                              display: "flex", alignItems: "baseline", gap: 8,
                              marginBottom: 6, flexWrap: "wrap",
                            }}>
                              <span style={{
                                fontSize: 12, fontWeight: 600, color: C.darkText, fontFamily: FONT,
                              }}>{senderName(m.from) || "Unknown"}</span>
                              <span style={{
                                fontSize: 11, color: C.darkMuted, fontFamily: FONT,
                              }}>{formatEmailDate(m.date)}</span>
                            </div>
                            {m.body ? (
                              <div style={{
                                fontSize: 13, fontFamily: FONT, color: C.darkText,
                                whiteSpace: "pre-wrap", lineHeight: 1.5,
                              }}>{m.body}</div>
                            ) : m.htmlBody ? (
                              <div
                                style={{ fontSize: 13, fontFamily: FONT, color: C.darkText, lineHeight: 1.5 }}
                                dangerouslySetInnerHTML={{ __html: m.htmlBody }}
                              />
                            ) : (
                              <div style={{ fontSize: 13, color: C.darkMuted, fontFamily: FONT, fontStyle: "italic" }}>
                                {m.snippet || "(no body)"}
                              </div>
                            )}
                          </div>
                        ))}
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {compose && (
        <ComposeModal
          onClose={() => setCompose(null)}
          onSent={handleSent}
          replyTo={compose.replyTo}
        />
      )}
    </div>
  );
}
