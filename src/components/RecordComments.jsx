// ─── Record Comments ───
// Shared comments component for the record model.
// Merges features from RecordDetail CommentsTab and RecordDrawer TaskCommentsTab:
//   - User name display per comment
//   - Permission-based delete (own comments or admin)
//   - Enter-to-send with Shift+Enter for newlines
//   - Error states
//   - "Stored in Wasabi" notice
//   - Optional onCommentAdded callback (for interaction logging)

import React, { useState, useCallback, useEffect, useRef } from "react";
import { C, FONT, RADIUS } from "../design/tokens.js";
import { listRecordComments, createRecordComment, deleteRecordComment } from "../lib/api.js";
import { timeAgo } from "../utils/helpers.js";
import MentionInput from "./MentionInput.jsx";

function renderCommentContent(text) {
  if (!text) return null;
  const parts = text.split(/(@\w+)/g);
  return parts.map((part, i) =>
    part.startsWith("@") ? (
      <span key={i} style={{ color: C.accent, fontWeight: 600 }}>{part}</span>
    ) : part
  );
}

export default function RecordComments({
  recordId,
  pageConfigId,
  onCommentAdded,
  userId,
  userName,
  userRole,
}) {
  const [comments, setComments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newComment, setNewComment] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const inputRef = useRef(null);

  const fetchComments = useCallback(async () => {
    try {
      setError(null);
      const res = await listRecordComments(recordId, pageConfigId);
      setComments(res?.comments || []);
    } catch (err) {
      console.error("[RecordComments] Failed to load:", err);
      setError("Failed to load comments.");
      setComments([]);
    } finally {
      setLoading(false);
    }
  }, [recordId, pageConfigId]);

  useEffect(() => { fetchComments(); }, [fetchComments]);

  const handleSend = useCallback(async () => {
    const text = newComment.trim();
    if (!text || sending) return;
    setSending(true);
    setError(null);
    try {
      await createRecordComment(recordId, pageConfigId, text, userId, userName);
      onCommentAdded?.(text);
      setNewComment("");
      await fetchComments();
      inputRef.current?.focus();
    } catch (err) {
      console.error("[RecordComments] Failed to add:", err);
      setError("Failed to send comment. Please try again.");
    } finally {
      setSending(false);
    }
  }, [newComment, sending, recordId, pageConfigId, userId, userName, fetchComments, onCommentAdded]);

  const handleDelete = useCallback(async (commentId) => {
    try {
      setError(null);
      await deleteRecordComment(recordId, commentId);
      setComments((prev) => prev.filter((c) => c.id !== commentId));
    } catch (err) {
      console.error("[RecordComments] Failed to delete:", err);
      setError("Failed to delete comment.");
    }
  }, [recordId]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  }, [handleSend]);

  if (loading) {
    return <div style={s.empty}>Loading comments...</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      {/* Wasabi-internal notice */}
      <div style={s.notice}>
        Comments are stored in Wasabi — not synced to source database
      </div>

      {/* Comments list */}
      <div style={s.list}>
        {comments.length === 0 && (
          <div style={s.empty}>No comments yet</div>
        )}
        {comments.map((comment) => {
          const canDelete = !userId || comment.user_id === userId || userRole === "admin";
          return (
            <div key={comment.id} style={s.commentItem}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={s.commentHeader}>
                  {comment.user_name && (
                    <span style={s.commentAuthor}>{comment.user_name}</span>
                  )}
                  <span style={s.commentTime}>
                    {comment.created_at ? timeAgo(comment.created_at) : ""}
                  </span>
                </div>
                <div style={s.commentContent}>{renderCommentContent(comment.content)}</div>
              </div>
              {canDelete && (
                <button
                  onClick={() => handleDelete(comment.id)}
                  style={s.deleteBtn}
                  onMouseEnter={(e) => { e.currentTarget.style.color = "#E05252"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = C.darkMuted; }}
                  title="Delete comment"
                >&times;</button>
              )}
            </div>
          );
        })}
      </div>

      {/* Error */}
      {error && <div style={s.error}>{error}</div>}

      {/* New comment input */}
      <div style={s.inputRow}>
        <div style={{ flex: 1 }}>
          <MentionInput
            value={newComment}
            onChange={setNewComment}
            onKeyDown={handleKeyDown}
            placeholder="Add a comment... (type @ to mention)"
            style={s.input}
          />
        </div>
        <button
          onClick={handleSend}
          disabled={sending || !newComment.trim()}
          style={{
            ...s.sendBtn,
            opacity: sending || !newComment.trim() ? 0.5 : 1,
          }}
        >
          {sending ? "..." : "Send"}
        </button>
      </div>
    </div>
  );
}

const s = {
  notice: {
    fontSize: 10, fontFamily: FONT, color: C.darkMuted, opacity: 0.7,
    padding: "4px 0 8px", textAlign: "center",
  },
  list: {
    flex: 1, overflowY: "auto", marginBottom: 12, minHeight: 0,
  },
  empty: {
    fontSize: 12, fontFamily: FONT, color: C.darkMuted,
    padding: "20px 0", textAlign: "center",
  },
  commentItem: {
    display: "flex", alignItems: "flex-start", gap: 8,
    padding: "8px 0", borderBottom: `1px solid ${C.darkBorder}`,
  },
  commentHeader: {
    display: "flex", alignItems: "baseline", gap: 6, marginBottom: 2,
  },
  commentAuthor: {
    fontSize: 11, fontWeight: 600, fontFamily: FONT, color: C.accent,
  },
  commentTime: {
    fontSize: 10, fontFamily: FONT, color: C.darkMuted,
  },
  commentContent: {
    fontSize: 13, fontFamily: FONT, color: C.darkText, wordBreak: "break-word",
  },
  deleteBtn: {
    background: "transparent", border: "none", color: C.darkMuted,
    cursor: "pointer", fontSize: 16, padding: "6px 8px", borderRadius: RADIUS.sm,
    outline: "none", flexShrink: 0, transition: "color 0.15s",
    minWidth: 28, minHeight: 28, display: "flex", alignItems: "center", justifyContent: "center",
  },
  error: {
    fontSize: 11, fontFamily: FONT, color: "#E05252",
    marginBottom: 8, padding: "6px 10px",
    background: "#E0525215", borderRadius: RADIUS.md,
  },
  inputRow: {
    display: "flex", gap: 6, flexShrink: 0, padding: "4px 0",
  },
  input: {
    flex: 1, background: C.dark, border: `1px solid ${C.darkBorder}`,
    borderRadius: RADIUS.md, color: C.darkText, fontFamily: FONT,
    fontSize: 13, padding: "8px 12px", outline: "none",
    transition: "border-color 0.15s",
  },
  sendBtn: {
    background: C.accent, color: "#fff", border: "none",
    borderRadius: RADIUS.pill, padding: "8px 16px",
    fontFamily: FONT, fontSize: 12, fontWeight: 600,
    cursor: "pointer", outline: "none", transition: "opacity 0.15s",
    flexShrink: 0,
  },
};
