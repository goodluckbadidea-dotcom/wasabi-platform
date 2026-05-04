// ─── Unified Inbox View ───
// Merged Gmail + Outlook inbox in one surface. Phase 5A (2026-05-04).
// Fetches both providers in parallel, displays merged list with provider
// badges, supports expand-to-read, reply, compose with provider toggle.
// Coexists with single-provider GmailView and OutlookView — does not replace them.

import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { C, FONT, FONT_DISPLAY, RADIUS, Z } from "../design/tokens.js";
import { ANIM, TRANSITION } from "../design/animations.js";
import { formatEmailDate, truncate } from "../utils/helpers.js";
import {
  getGoogleStatus,
  getMicrosoftStatus,
  searchEmails,
  getEmail,
  sendEmail,
  modifyEmail,
  searchOutlookMessages,
  getOutlookMessage,
  sendOutlookEmail,
  modifyOutlookMessage,
} from "../lib/api.js";

// ─── Provider Badge ───
function ProviderBadge({ provider, size = "md" }) {
  const isGoogle = provider === "google";
  const padding = size === "sm" ? "2px 6px" : "3px 8px";
  const fontSize = size === "sm" ? 9 : 10;
  return (
    <span
      title={isGoogle ? "Gmail" : "Outlook"}
      style={{
        display: "inline-flex", alignItems: "center", gap: 4,
        padding, borderRadius: RADIUS.pill,
        background: isGoogle ? "#ea433522" : "#0078d422",
        color: isGoogle ? "#ea4335" : "#0078d4",
        fontSize, fontWeight: 700, fontFamily: FONT,
        letterSpacing: "0.04em", textTransform: "uppercase",
        flexShrink: 0,
      }}
    >
      {isGoogle ? (
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none">
          <path d="M22.05 5.55v12.9c0 .85-.7 1.55-1.55 1.55h-1.55V8.5L12 13.5 5.05 8.5V20H3.5c-.85 0-1.55-.7-1.55-1.55V5.55c0-.85.7-1.55 1.55-1.55h.78L12 9.5l7.72-5.5h.78c.85 0 1.55.7 1.55 1.55Z" fill="#ea4335" />
        </svg>
      ) : (
        <svg width="9" height="9" viewBox="0 0 21 21" fill="none">
          <rect x="1" y="1" width="9" height="9" fill="#F25022" />
          <rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
          <rect x="1" y="11" width="9" height="9" fill="#00A4EF" />
          <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
        </svg>
      )}
      {isGoogle ? "Gmail" : "Outlook"}
    </span>
  );
}

// ─── Compose / Reply Modal ───
function ComposeModal({ onClose, onSent, replyTo, defaultProvider, googleConnected, microsoftConnected }) {
  const lockedProvider = replyTo?.provider || null;
  const [provider, setProvider] = useState(lockedProvider || defaultProvider || (microsoftConnected ? "microsoft" : "google"));
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
      if (provider === "microsoft") {
        await sendOutlookEmail({
          to: to.trim(),
          subject: subject.trim(),
          bodyText: body,
          replyToId: replyTo?.provider === "microsoft" ? replyTo.id : undefined,
        });
      } else {
        await sendEmail({
          to: to.trim(),
          subject: subject.trim(),
          bodyText: body,
          threadId: replyTo?.provider === "google" ? replyTo.threadId : undefined,
        });
      }
      onSent?.();
      onClose();
    } catch (err) {
      console.error("[UnifiedInbox] Send failed:", err);
      setError("Failed to send. Please try again.");
    } finally {
      setSending(false);
    }
  }, [provider, to, subject, body, replyTo, onSent, onClose]);

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
          <span style={{ fontSize: 14, fontWeight: 600, fontFamily: FONT, color: C.darkText, display: "flex", alignItems: "center", gap: 8 }}>
            {replyTo ? "Reply" : "New Message"}
            <ProviderBadge provider={provider === "microsoft" ? "microsoft" : "google"} />
          </span>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}>
            <svg width="14" height="14" viewBox="0 0 12 12" fill="none">
              <path d="M2 2L10 10M10 2L2 10" stroke={C.darkMuted} strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div style={{ padding: "14px 18px", flex: 1, overflowY: "auto" }}>
          {/* Provider toggle (only if both connected and NOT a reply) */}
          {!lockedProvider && googleConnected && microsoftConnected && (
            <div style={{ marginBottom: 12, display: "flex", gap: 6 }}>
              {[
                { key: "microsoft", label: "Outlook" },
                { key: "google", label: "Gmail" },
              ].map((p) => (
                <button
                  key={p.key}
                  onClick={() => setProvider(p.key)}
                  style={{
                    background: provider === p.key ? C.accent + "22" : "transparent",
                    border: `1px solid ${provider === p.key ? C.accent + "44" : C.darkBorder}`,
                    color: provider === p.key ? C.accent : C.darkMuted,
                    padding: "4px 12px", borderRadius: RADIUS.pill,
                    cursor: "pointer", fontFamily: FONT, fontSize: 11, fontWeight: 600,
                    outline: "none",
                  }}
                >Send via {p.label}</button>
              ))}
            </div>
          )}
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

// ─── Main View ───
export default function UnifiedInboxView() {
  const [googleConnected, setGoogleConnected] = useState(false);
  const [microsoftConnected, setMicrosoftConnected] = useState(false);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [filter, setFilter] = useState("all"); // "all" | "unread"
  const [providerFilter, setProviderFilter] = useState("all"); // "all" | "google" | "microsoft"
  const [expandedKey, setExpandedKey] = useState(null);
  const [expandedBody, setExpandedBody] = useState(null);
  const [compose, setCompose] = useState(null);
  const searchTimerRef = useRef(null);

  // ── Normalize messages from each provider into a common shape ──
  const normalizeGmail = (m) => ({
    key: `g:${m.id}`,
    provider: "google",
    id: m.id,
    threadId: m.threadId,
    from: m.from || "",
    fromName: m.fromName || (m.from || "").split("<")[0].trim() || m.from,
    subject: m.subject || "(no subject)",
    snippet: m.snippet || "",
    date: m.date || "",
    isRead: m.isRead !== false && !((m.labelIds || []).includes("UNREAD")),
  });

  const normalizeOutlook = (m) => ({
    key: `o:${m.id}`,
    provider: "microsoft",
    id: m.id,
    conversationId: m.conversationId,
    from: m.from || "",
    fromName: m.fromName || m.from,
    subject: m.subject || "(no subject)",
    snippet: m.snippet || "",
    date: m.date || "",
    isRead: m.isRead !== false,
  });

  // ── Fetch messages from both providers in parallel ──
  const fetchMessages = useCallback(async (q = "") => {
    setLoading(true);
    setError(null);
    try {
      const [gStatus, mStatus] = await Promise.all([
        getGoogleStatus().catch(() => null),
        getMicrosoftStatus().catch(() => null),
      ]);
      const isGoogle = !!gStatus?.connected;
      const isMicrosoft = !!mStatus?.connected;
      setGoogleConnected(isGoogle);
      setMicrosoftConnected(isMicrosoft);

      const fetches = [];
      if (isGoogle) {
        const gQuery = q ? q : "in:inbox";
        fetches.push(searchEmails(gQuery, 40).catch(() => null));
      } else fetches.push(Promise.resolve(null));
      if (isMicrosoft) {
        fetches.push(searchOutlookMessages(q, 40, "inbox").catch(() => null));
      } else fetches.push(Promise.resolve(null));

      const [gRes, mRes] = await Promise.all(fetches);
      const gMessages = (gRes?.messages || gRes?.emails || []).map(normalizeGmail);
      const mMessages = (mRes?.messages || []).map(normalizeOutlook);
      const merged = [...gMessages, ...mMessages].sort((a, b) => {
        const da = new Date(a.date).getTime() || 0;
        const db = new Date(b.date).getTime() || 0;
        return db - da;
      });
      setMessages(merged);
    } catch (err) {
      console.error("[UnifiedInbox] Fetch failed:", err);
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

  // ── Visible (filtered) messages ──
  const visible = useMemo(() => {
    return messages.filter((m) => {
      if (filter === "unread" && m.isRead) return false;
      if (providerFilter !== "all" && m.provider !== providerFilter) return false;
      return true;
    });
  }, [messages, filter, providerFilter]);

  // ── Expand a message ──
  const handleExpand = useCallback(async (msg) => {
    if (expandedKey === msg.key) {
      setExpandedKey(null);
      setExpandedBody(null);
      return;
    }
    setExpandedKey(msg.key);
    setExpandedBody({ loading: true });
    try {
      const full = msg.provider === "google"
        ? await getEmail(msg.id)
        : await getOutlookMessage(msg.id);
      setExpandedBody(full);

      // Mark read on expand
      if (!msg.isRead) {
        try {
          if (msg.provider === "google") {
            await modifyEmail(msg.id, "mark_read");
          } else {
            await modifyOutlookMessage(msg.id, "read");
          }
          setMessages((prev) => prev.map((m) => m.key === msg.key ? { ...m, isRead: true } : m));
        } catch (markErr) {
          console.warn("[UnifiedInbox] Mark read failed:", markErr);
        }
      }
    } catch (err) {
      console.error("[UnifiedInbox] Get message failed:", err);
      setExpandedBody({ error: "Failed to load message" });
    }
  }, [expandedKey]);

  const handleReply = useCallback((msg) => {
    setCompose({ replyTo: msg });
  }, []);

  const handleSent = useCallback(() => {
    setTimeout(() => fetchMessages(searchQuery), 1500);
  }, [fetchMessages, searchQuery]);

  // ── Render ──
  if (!googleConnected && !microsoftConnected && !loading) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", padding: 24, gap: 8 }}>
        <div style={{ fontSize: 14, fontFamily: FONT, color: C.darkMuted }}>
          No email account connected.
        </div>
        <div style={{ fontSize: 12, fontFamily: FONT, color: C.darkMuted, opacity: 0.7 }}>
          Connect Google or Microsoft in Settings.
        </div>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: "transparent" }}>
      {/* Header */}
      <div style={{ flexShrink: 0, padding: "14px 20px 8px", borderBottom: `1px solid ${C.darkBorder}` }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <div style={{ fontSize: 18, fontWeight: 600, fontFamily: FONT_DISPLAY, color: C.darkText, display: "flex", alignItems: "center", gap: 10 }}>
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <rect x="1.5" y="3.5" width="15" height="11" rx="1.5" stroke={C.accent} strokeWidth="1.4" fill="none" />
              <path d="M2 5L9 10L16 5" stroke={C.accent} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Inbox
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              onClick={() => setCompose({})}
              style={{
                background: `linear-gradient(135deg, ${C.accent}, ${C.accent}cc)`,
                border: "none", cursor: "pointer", color: "#fff",
                padding: "7px 14px", borderRadius: RADIUS.pill,
                fontSize: 12, fontWeight: 600, fontFamily: FONT, outline: "none",
                display: "flex", alignItems: "center", gap: 6, minHeight: 32,
              }}
            >
              <svg width="12" height="12" viewBox="0 0 10 10" fill="none">
                <path d="M5 1V9M1 5H9" stroke="#fff" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
              Compose
            </button>
            <button
              onClick={() => fetchMessages(searchQuery)}
              title="Refresh"
              style={{ background: "transparent", border: "none", cursor: "pointer", padding: 6, opacity: 0.5 }}
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
            placeholder="Search both inboxes..."
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
          <div style={{ width: 1, background: C.darkBorder, margin: "2px 4px" }} />
          {[
            { key: "all", label: "Both" },
            ...(googleConnected ? [{ key: "google", label: "Gmail" }] : []),
            ...(microsoftConnected ? [{ key: "microsoft", label: "Outlook" }] : []),
          ].map((p) => (
            <button key={p.key} onClick={() => setProviderFilter(p.key)}
              style={{
                background: providerFilter === p.key ? C.accent + "22" : "transparent",
                border: `1px solid ${providerFilter === p.key ? C.accent + "44" : C.darkBorder}`,
                color: providerFilter === p.key ? C.accent : C.darkMuted,
                padding: "4px 12px", borderRadius: RADIUS.pill,
                cursor: "pointer", fontFamily: FONT, fontSize: 11, fontWeight: 600, outline: "none",
              }}
            >{p.label}</button>
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
        ) : visible.length === 0 ? (
          <div style={{ padding: "60px 20px", textAlign: "center", color: C.darkMuted, fontFamily: FONT, fontSize: 12 }}>
            No messages
          </div>
        ) : (
          visible.map((msg, idx) => {
            const isUnread = !msg.isRead;
            const isExpanded = expandedKey === msg.key;
            const senderDisplay = msg.fromName || msg.from || "Unknown";

            return (
              <div key={msg.key} style={{ animation: ANIM.scrollReveal(idx) }}>
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
                  <div style={{
                    width: 6, height: 6, borderRadius: "50%",
                    background: isUnread ? C.accent : "transparent", flexShrink: 0,
                  }} />
                  <ProviderBadge provider={msg.provider} size="sm" />
                  <div style={{
                    width: 130, flexShrink: 0,
                    fontSize: 13, fontFamily: FONT,
                    fontWeight: isUnread ? 700 : 400,
                    color: isUnread ? C.darkText : C.darkMuted,
                    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                  }}>{truncate(senderDisplay, 18)}</div>
                  <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "baseline", gap: 6 }}>
                    <span style={{
                      fontSize: 13, fontFamily: FONT,
                      fontWeight: isUnread ? 600 : 400, color: C.darkText,
                      whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                      flexShrink: 0, maxWidth: "50%",
                    }}>{truncate(msg.subject, 40)}</span>
                    <span style={{
                      fontSize: 12, fontFamily: FONT, color: C.darkMuted,
                      whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flex: 1,
                    }}>{msg.snippet}</span>
                  </div>
                  <div style={{ fontSize: 11, color: C.darkMuted, fontFamily: FONT, flexShrink: 0 }}>
                    {formatEmailDate(msg.date)}
                  </div>
                </div>

                {/* Expanded body */}
                {isExpanded && (
                  <div style={{
                    padding: "12px 18px 16px", background: C.darkSurf2,
                    borderBottom: `1px solid ${C.darkBorder}`,
                  }}>
                    {expandedBody?.loading ? (
                      <div style={{ fontSize: 12, color: C.darkMuted, fontFamily: FONT }}>Loading…</div>
                    ) : expandedBody?.error ? (
                      <div style={{ fontSize: 12, color: C.error, fontFamily: FONT }}>{expandedBody.error}</div>
                    ) : (
                      <>
                        <div style={{ marginBottom: 10, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                          <button onClick={() => handleReply(msg)} style={{
                            background: C.accent + "22", border: `1px solid ${C.accent}44`,
                            color: C.accent, padding: "5px 12px", borderRadius: RADIUS.pill,
                            cursor: "pointer", fontFamily: FONT, fontSize: 11, fontWeight: 600, outline: "none",
                          }}>↩ Reply</button>
                        </div>
                        <div style={{
                          fontSize: 13, fontFamily: FONT, color: C.darkText,
                          whiteSpace: "pre-wrap", lineHeight: 1.5,
                        }}>
                          {expandedBody?.body || expandedBody?.snippet || ""}
                        </div>
                        {expandedBody?.htmlBody && !expandedBody?.body && (
                          <div
                            style={{ fontSize: 13, fontFamily: FONT, color: C.darkText, lineHeight: 1.5 }}
                            dangerouslySetInnerHTML={{ __html: expandedBody.htmlBody }}
                          />
                        )}
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
          defaultProvider={compose.replyTo?.provider}
          googleConnected={googleConnected}
          microsoftConnected={microsoftConnected}
        />
      )}
    </div>
  );
}

export { ProviderBadge };
