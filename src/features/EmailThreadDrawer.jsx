// ─── Email Thread Drawer ───
// Full-thread email viewer with reply/reply-all/forward and auto-save drafts.
// Rendered inside SashimiDrawer when drawerItem.type === "email".
// Two modes: thread view (double-click message) or compose (new email).

import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { C, FONT, RADIUS } from "../design/tokens.js";
import { ANIM } from "../design/animations.js";
import { getThread, sendEmail, createDraft, updateDraft, modifyEmail } from "../lib/api.js";
import { formatEmailDate } from "../utils/helpers.js";

// ── Helpers ──

function extractName(fromStr) {
  if (!fromStr) return "?";
  const match = fromStr.match(/^"?([^"<]+)"?\s*</);
  if (match) return match[1].trim();
  return fromStr.split("@")[0];
}

function extractEmail(fromStr) {
  if (!fromStr) return "";
  const match = fromStr.match(/<([^>]+)>/);
  return match ? match[1] : fromStr;
}

// ── Shared Styles ──

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

const actionBtnStyle = {
  background: "none", border: `1px solid ${C.darkBorder}`,
  color: C.darkText, padding: "6px 14px", borderRadius: RADIUS.md,
  cursor: "pointer", fontFamily: FONT, fontSize: 11, fontWeight: 500,
  outline: "none", transition: "all 0.12s",
};

// ── Message Card ──

function MessageCard({ msg, isExpanded, onToggle, isHighlighted, innerRef }) {
  const name = extractName(msg.from);
  const initial = name.charAt(0).toUpperCase();

  return (
    <div
      ref={innerRef}
      style={{
        borderBottom: `1px solid ${C.darkBorder}`,
        background: isHighlighted ? `${C.accent}08` : "transparent",
      }}
    >
      {/* Header — always visible */}
      <div
        onClick={onToggle}
        style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "12px 0", cursor: "pointer",
        }}
      >
        {/* Avatar */}
        <div style={{
          width: 32, height: 32, borderRadius: "50%",
          background: isHighlighted ? C.accent : C.darkSurf2,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 13, fontWeight: 600, fontFamily: FONT,
          color: isHighlighted ? "#fff" : C.darkMuted,
          flexShrink: 0,
        }}>
          {initial}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            display: "flex", alignItems: "baseline", gap: 6,
          }}>
            <span style={{
              fontSize: 13, fontWeight: 600, fontFamily: FONT, color: C.darkText,
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            }}>
              {name}
            </span>
            <span style={{ fontSize: 11, color: C.darkMuted, fontFamily: FONT, flexShrink: 0 }}>
              {formatEmailDate(msg.date)}
            </span>
          </div>
          {!isExpanded && (
            <div style={{
              fontSize: 12, color: C.darkMuted, fontFamily: FONT,
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
              marginTop: 2,
            }}>
              {msg.snippet}
            </div>
          )}
        </div>

        {/* Expand chevron */}
        <svg width="10" height="10" viewBox="0 0 8 8" fill="none"
          style={{
            transform: isExpanded ? "rotate(180deg)" : "none",
            transition: "transform 0.15s", flexShrink: 0, opacity: 0.4,
          }}>
          <path d="M1 3L4 6L7 3" stroke={C.darkMuted} strokeWidth="1.2" />
        </svg>
      </div>

      {/* Body — expanded */}
      {isExpanded && (
        <div style={{ paddingBottom: 14 }}>
          {/* Metadata */}
          <div style={{ fontSize: 11, fontFamily: FONT, color: C.darkMuted, marginBottom: 10 }}>
            <div>From: {msg.from}</div>
            <div>To: {msg.to}</div>
            {msg.cc && <div>Cc: {msg.cc}</div>}
          </div>

          {/* Body text */}
          <div style={{
            fontSize: 13, fontFamily: FONT, color: C.darkText,
            lineHeight: 1.6, whiteSpace: "pre-wrap", wordBreak: "break-word",
          }}>
            {msg.body || msg.snippet || "(No content)"}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Composer ──

function Composer({ mode, replyMsg, threadId, onSent, onDiscard, onDraftStatusChange }) {
  const isForward = mode === "forward";
  const isReplyAll = mode === "reply-all";

  const [to, setTo] = useState(() => {
    if (isForward) return "";
    return extractEmail(replyMsg?.from) || "";
  });
  const [cc, setCc] = useState(() => {
    if (isReplyAll && replyMsg?.cc) return replyMsg.cc;
    return "";
  });
  const [subject, setSubject] = useState(() => {
    const base = replyMsg?.subject?.replace(/^(Re|Fwd):\s*/i, "") || "";
    if (isForward) return `Fwd: ${base}`;
    return `Re: ${base}`;
  });
  const [body, setBody] = useState(() => {
    if (isForward && replyMsg) {
      return `\n\n---------- Forwarded message ----------\nFrom: ${replyMsg.from}\nDate: ${replyMsg.date}\nSubject: ${replyMsg.subject}\n\n${replyMsg.body || replyMsg.snippet || ""}`;
    }
    return "";
  });
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const [draftId, setDraftId] = useState(null);
  const [draftStatus, setDraftStatus] = useState(null); // null | "saving" | "saved"
  const draftTimerRef = useRef(null);
  const bodyRef = useRef(null);

  useEffect(() => {
    setTimeout(() => bodyRef.current?.focus(), 100);
  }, []);

  // Auto-save draft (debounce 2s)
  const saveDraft = useCallback(async (currentTo, currentSubject, currentBody, currentDraftId) => {
    if (!currentBody.trim() && !currentTo.trim()) return currentDraftId;
    try {
      setDraftStatus("saving");
      onDraftStatusChange?.("saving");
      if (currentDraftId) {
        await updateDraft(currentDraftId, { to: currentTo, subject: currentSubject, bodyText: currentBody, threadId });
        setDraftStatus("saved");
        onDraftStatusChange?.("saved");
        return currentDraftId;
      } else {
        const res = await createDraft({ to: currentTo, subject: currentSubject, bodyText: currentBody });
        const newId = res.id;
        setDraftId(newId);
        setDraftStatus("saved");
        onDraftStatusChange?.("saved");
        return newId;
      }
    } catch (err) {
      console.error("[EmailDrawer] Draft save failed:", err);
      setDraftStatus(null);
      onDraftStatusChange?.(null);
      return currentDraftId;
    }
  }, [threadId, onDraftStatusChange]);

  const scheduleDraftSave = useCallback(() => {
    clearTimeout(draftTimerRef.current);
    draftTimerRef.current = setTimeout(() => {
      saveDraft(to, subject, body, draftId);
    }, 2000);
  }, [to, subject, body, draftId, saveDraft]);

  // Flush draft on unmount
  useEffect(() => {
    return () => {
      clearTimeout(draftTimerRef.current);
    };
  }, []);

  const handleBodyChange = useCallback((val) => {
    setBody(val);
    setDraftStatus(null);
    scheduleDraftSave();
  }, [scheduleDraftSave]);

  // Flush save before discard
  const handleDiscard = useCallback(async () => {
    clearTimeout(draftTimerRef.current);
    if (body.trim() || to.trim()) {
      await saveDraft(to, subject, body, draftId);
    }
    onDiscard();
  }, [body, to, subject, draftId, saveDraft, onDiscard]);

  const handleSend = useCallback(async () => {
    if (!to.trim() || !subject.trim()) return;
    setSending(true);
    setError(null);
    try {
      await sendEmail({
        to: to.trim(),
        subject: subject.trim(),
        bodyText: body,
        threadId: isForward ? undefined : threadId,
        inReplyTo: isForward ? undefined : replyMsg?.messageId,
        references: isForward ? undefined : replyMsg?.messageId,
      });
      onSent?.();
    } catch (err) {
      console.error("[EmailDrawer] Send failed:", err);
      setError("Failed to send. Please try again.");
    } finally {
      setSending(false);
    }
  }, [to, subject, body, threadId, replyMsg, isForward, onSent]);

  return (
    <div style={{
      borderTop: `1px solid ${C.darkBorder}`,
      padding: "14px 0 0",
    }}>
      {/* Mode label */}
      <div style={{
        fontSize: 12, fontWeight: 600, fontFamily: FONT, color: C.accent,
        marginBottom: 10, textTransform: "capitalize",
      }}>
        {mode === "reply-all" ? "Reply All" : mode}
      </div>

      {/* To */}
      <div style={{ marginBottom: 8 }}>
        <label style={labelStyle}>To</label>
        <input
          type="email"
          value={to}
          onChange={(e) => { setTo(e.target.value); scheduleDraftSave(); }}
          placeholder="recipient@email.com"
          readOnly={!isForward}
          style={{ ...fieldStyle, opacity: isForward ? 1 : 0.7, cursor: isForward ? "text" : "default" }}
          onFocus={(e) => { if (isForward) e.target.style.borderColor = C.accent; }}
          onBlur={(e) => { e.target.style.borderColor = C.darkBorder; }}
        />
      </div>

      {/* Cc (reply-all) */}
      {isReplyAll && (
        <div style={{ marginBottom: 8 }}>
          <label style={labelStyle}>Cc</label>
          <input
            type="text"
            value={cc}
            onChange={(e) => { setCc(e.target.value); scheduleDraftSave(); }}
            placeholder="cc@email.com"
            style={fieldStyle}
            onFocus={(e) => { e.target.style.borderColor = C.accent; }}
            onBlur={(e) => { e.target.style.borderColor = C.darkBorder; }}
          />
        </div>
      )}

      {/* Subject */}
      <div style={{ marginBottom: 8 }}>
        <label style={labelStyle}>Subject</label>
        <input
          type="text"
          value={subject}
          onChange={(e) => { setSubject(e.target.value); scheduleDraftSave(); }}
          placeholder="Subject"
          style={fieldStyle}
          onFocus={(e) => { e.target.style.borderColor = C.accent; }}
          onBlur={(e) => { e.target.style.borderColor = C.darkBorder; }}
        />
      </div>

      {/* Body */}
      <div style={{ marginBottom: 8 }}>
        <label style={labelStyle}>Message</label>
        <textarea
          ref={bodyRef}
          value={body}
          onChange={(e) => handleBodyChange(e.target.value)}
          placeholder="Write your message..."
          rows={6}
          style={{ ...fieldStyle, resize: "vertical", minHeight: 100 }}
          onFocus={(e) => { e.target.style.borderColor = C.accent; }}
          onBlur={(e) => { e.target.style.borderColor = C.darkBorder; }}
        />
      </div>

      {/* Draft status */}
      {draftStatus && (
        <div style={{
          fontSize: 10, fontFamily: FONT, color: C.darkMuted,
          marginBottom: 6, opacity: 0.7,
        }}>
          {draftStatus === "saving" ? "Saving draft..." : "Draft saved"}
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{
          fontSize: 11, fontFamily: FONT, color: C.error,
          marginBottom: 8, padding: "6px 10px",
          background: C.error + "15", borderRadius: RADIUS.md,
        }}>
          {error}
        </div>
      )}

      {/* Actions */}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button onClick={handleDiscard} style={actionBtnStyle}>
          Close
        </button>
        <button
          onClick={handleSend}
          disabled={sending || !to.trim() || !subject.trim()}
          style={{
            background: `linear-gradient(135deg, ${C.accent}, ${C.accent}cc)`,
            border: "none", color: "#fff",
            padding: "6px 18px", borderRadius: RADIUS.pill,
            fontFamily: FONT, fontSize: 12, fontWeight: 600,
            outline: "none", cursor: sending ? "wait" : "pointer",
            opacity: sending || !to.trim() || !subject.trim() ? 0.5 : 1,
          }}
        >
          {sending ? "Sending..." : "Send"}
        </button>
      </div>
    </div>
  );
}

// ── Main Export ──

export default function EmailThreadDrawer({ email, onClose }) {
  const isCompose = !!email?.compose;

  // Thread state
  const [thread, setThread] = useState(null);
  const [threadLoading, setThreadLoading] = useState(!isCompose);
  const [threadError, setThreadError] = useState(null);
  const [expandedIds, setExpandedIds] = useState(new Set());
  const [replyMode, setReplyMode] = useState(email?.replyMode || null);

  // Compose-only state
  const [composeTo, setComposeTo] = useState("");
  const [composeSubject, setComposeSubject] = useState("");
  const [composeBody, setComposeBody] = useState("");
  const [composeSending, setComposeSending] = useState(false);
  const [composeError, setComposeError] = useState(null);
  const [composeDraftId, setComposeDraftId] = useState(null);
  const [composeDraftStatus, setComposeDraftStatus] = useState(null);
  const composeDraftTimerRef = useRef(null);
  const composeBodyRef = useRef(null);

  const highlightRef = useRef(null);

  // Fetch thread on mount
  useEffect(() => {
    if (isCompose) return;
    if (!email?.threadId) {
      setThreadError("No thread ID available");
      setThreadLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await getThread(email.threadId);
        if (cancelled) return;
        setThread(res);
        // Auto-expand the clicked message + last message
        const ids = new Set();
        if (email.id) ids.add(email.id);
        if (res.messages?.length > 0) ids.add(res.messages[res.messages.length - 1].id);
        setExpandedIds(ids);
      } catch (err) {
        if (!cancelled) setThreadError("Failed to load thread");
        console.error("[EmailDrawer] Thread fetch failed:", err);
      } finally {
        if (!cancelled) setThreadLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [email?.threadId, email?.id, isCompose]);

  // Auto-scroll to highlighted message
  useEffect(() => {
    if (highlightRef.current && thread) {
      setTimeout(() => highlightRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 200);
    }
  }, [thread]);

  // If opened with replyMode, auto-activate it
  useEffect(() => {
    if (email?.replyMode) setReplyMode(email.replyMode);
  }, [email?.replyMode]);

  const toggleExpand = useCallback((msgId) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(msgId)) next.delete(msgId);
      else next.add(msgId);
      return next;
    });
  }, []);

  const handleArchive = useCallback(async () => {
    try {
      await modifyEmail(email.id, "archive");
      email.onArchived?.(email.id);
      onClose();
    } catch (err) {
      console.error("[EmailDrawer] Archive failed:", err);
    }
  }, [email, onClose]);

  const handleTrash = useCallback(async () => {
    try {
      await modifyEmail(email.id, "trash");
      email.onTrashed?.(email.id);
      onClose();
    } catch (err) {
      console.error("[EmailDrawer] Trash failed:", err);
    }
  }, [email, onClose]);

  const handleSent = useCallback(() => {
    email.onSent?.();
    setReplyMode(null);
  }, [email]);

  const lastMessage = thread?.messages?.[thread.messages.length - 1] || null;
  const threadSubject = thread?.messages?.[0]?.subject || email?.subject || "Email";

  // ── Compose mode auto-save ──
  const saveComposeDraft = useCallback(async () => {
    if (!composeBody.trim() && !composeTo.trim()) return;
    try {
      setComposeDraftStatus("saving");
      if (composeDraftId) {
        await updateDraft(composeDraftId, { to: composeTo, subject: composeSubject, bodyText: composeBody });
      } else {
        const res = await createDraft({ to: composeTo, subject: composeSubject, bodyText: composeBody });
        setComposeDraftId(res.id);
      }
      setComposeDraftStatus("saved");
    } catch (err) {
      console.error("[EmailDrawer] Compose draft save failed:", err);
      setComposeDraftStatus(null);
    }
  }, [composeTo, composeSubject, composeBody, composeDraftId]);

  const scheduleComposeDraftSave = useCallback(() => {
    clearTimeout(composeDraftTimerRef.current);
    composeDraftTimerRef.current = setTimeout(saveComposeDraft, 2000);
  }, [saveComposeDraft]);

  useEffect(() => {
    if (isCompose) setTimeout(() => composeBodyRef.current?.focus(), 100);
    return () => clearTimeout(composeDraftTimerRef.current);
  }, [isCompose]);

  const handleComposeSend = useCallback(async () => {
    if (!composeTo.trim() || !composeSubject.trim()) return;
    setComposeSending(true);
    setComposeError(null);
    try {
      await sendEmail({ to: composeTo.trim(), subject: composeSubject.trim(), bodyText: composeBody });
      email.onSent?.();
      onClose();
    } catch (err) {
      console.error("[EmailDrawer] Compose send failed:", err);
      setComposeError("Failed to send. Please try again.");
    } finally {
      setComposeSending(false);
    }
  }, [composeTo, composeSubject, composeBody, email, onClose]);

  const handleComposeClose = useCallback(async () => {
    clearTimeout(composeDraftTimerRef.current);
    if (composeBody.trim() || composeTo.trim()) {
      await saveComposeDraft();
    }
    onClose();
  }, [composeBody, composeTo, saveComposeDraft, onClose]);

  // ═══ Compose Mode ═══
  if (isCompose) {
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
        <div style={{ flex: 1, overflowY: "auto", padding: "4px 0" }}>
          {/* To */}
          <div style={{ marginBottom: 10 }}>
            <label style={labelStyle}>To</label>
            <input
              type="email"
              value={composeTo}
              onChange={(e) => { setComposeTo(e.target.value); setComposeDraftStatus(null); scheduleComposeDraftSave(); }}
              placeholder="recipient@email.com"
              style={fieldStyle}
              onFocus={(e) => { e.target.style.borderColor = C.accent; }}
              onBlur={(e) => { e.target.style.borderColor = C.darkBorder; }}
            />
          </div>

          {/* Subject */}
          <div style={{ marginBottom: 10 }}>
            <label style={labelStyle}>Subject</label>
            <input
              type="text"
              value={composeSubject}
              onChange={(e) => { setComposeSubject(e.target.value); setComposeDraftStatus(null); scheduleComposeDraftSave(); }}
              placeholder="Subject"
              style={fieldStyle}
              onFocus={(e) => { e.target.style.borderColor = C.accent; }}
              onBlur={(e) => { e.target.style.borderColor = C.darkBorder; }}
            />
          </div>

          {/* Body */}
          <div style={{ marginBottom: 10 }}>
            <label style={labelStyle}>Message</label>
            <textarea
              ref={composeBodyRef}
              value={composeBody}
              onChange={(e) => { setComposeBody(e.target.value); setComposeDraftStatus(null); scheduleComposeDraftSave(); }}
              placeholder="Write your message..."
              rows={10}
              style={{ ...fieldStyle, resize: "vertical", minHeight: 160 }}
              onFocus={(e) => { e.target.style.borderColor = C.accent; }}
              onBlur={(e) => { e.target.style.borderColor = C.darkBorder; }}
            />
          </div>

          {/* Draft status */}
          {composeDraftStatus && (
            <div style={{ fontSize: 10, fontFamily: FONT, color: C.darkMuted, marginBottom: 6, opacity: 0.7 }}>
              {composeDraftStatus === "saving" ? "Saving draft..." : "Draft saved"}
            </div>
          )}

          {/* Error */}
          {composeError && (
            <div style={{
              fontSize: 11, fontFamily: FONT, color: C.error,
              marginBottom: 8, padding: "6px 10px",
              background: C.error + "15", borderRadius: RADIUS.md,
            }}>
              {composeError}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: "12px 0 0", borderTop: `1px solid ${C.darkBorder}`,
          display: "flex", gap: 8, justifyContent: "flex-end", flexShrink: 0,
        }}>
          <button onClick={handleComposeClose} style={actionBtnStyle}>Close</button>
          <button
            onClick={handleComposeSend}
            disabled={composeSending || !composeTo.trim() || !composeSubject.trim()}
            style={{
              background: `linear-gradient(135deg, ${C.accent}, ${C.accent}cc)`,
              border: "none", color: "#fff",
              padding: "6px 18px", borderRadius: RADIUS.pill,
              fontFamily: FONT, fontSize: 12, fontWeight: 600,
              outline: "none", cursor: composeSending ? "wait" : "pointer",
              opacity: composeSending || !composeTo.trim() || !composeSubject.trim() ? 0.5 : 1,
            }}
          >
            {composeSending ? "Sending..." : "Send"}
          </button>
        </div>
      </div>
    );
  }

  // ═══ Thread Mode ═══

  // Loading state
  if (threadLoading) {
    return (
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        height: "100%", color: C.darkMuted, fontFamily: FONT, fontSize: 12,
      }}>
        Loading thread...
      </div>
    );
  }

  // Error state
  if (threadError) {
    return (
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        height: "100%", color: C.error, fontFamily: FONT, fontSize: 12,
      }}>
        {threadError}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Thread subject */}
      <div style={{
        fontSize: 15, fontWeight: 600, fontFamily: FONT, color: C.darkText,
        paddingBottom: 12, borderBottom: `1px solid ${C.darkBorder}`,
        lineHeight: 1.3,
      }}>
        {threadSubject}
        <div style={{ fontSize: 11, fontWeight: 400, color: C.darkMuted, marginTop: 4 }}>
          {thread?.messages?.length || 0} message{(thread?.messages?.length || 0) !== 1 ? "s" : ""}
        </div>
      </div>

      {/* Message list */}
      <div style={{ flex: 1, overflowY: "auto", padding: "4px 0" }}>
        {thread?.messages?.map((msg) => (
          <MessageCard
            key={msg.id}
            msg={msg}
            isExpanded={expandedIds.has(msg.id)}
            onToggle={() => toggleExpand(msg.id)}
            isHighlighted={msg.id === email.id}
            innerRef={msg.id === email.id ? highlightRef : undefined}
          />
        ))}

        {/* Action buttons */}
        {!replyMode && (
          <div style={{
            display: "flex", flexWrap: "wrap", gap: 8, padding: "16px 0 8px",
          }}>
            <button onClick={() => setReplyMode("reply")} style={actionBtnStyle}>
              <span style={{ marginRight: 4 }}>↩</span> Reply
            </button>
            <button onClick={() => setReplyMode("reply-all")} style={actionBtnStyle}>
              <span style={{ marginRight: 4 }}>↩↩</span> Reply All
            </button>
            <button onClick={() => setReplyMode("forward")} style={actionBtnStyle}>
              <span style={{ marginRight: 4 }}>→</span> Forward
            </button>
            <div style={{ flex: 1 }} />
            <button onClick={handleArchive} style={{ ...actionBtnStyle, color: C.darkMuted }}>
              Archive
            </button>
            <button onClick={handleTrash} style={{ ...actionBtnStyle, color: C.error, borderColor: C.error + "40" }}>
              Delete
            </button>
          </div>
        )}

        {/* Composer */}
        {replyMode && lastMessage && (
          <Composer
            mode={replyMode}
            replyMsg={lastMessage}
            threadId={email.threadId}
            onSent={handleSent}
            onDiscard={() => setReplyMode(null)}
            onDraftStatusChange={() => {}}
          />
        )}
      </div>
    </div>
  );
}
