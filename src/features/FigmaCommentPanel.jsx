// ─── Figma Comment Panel ───
// Phase 2 of the in-app Figma viewer. Renders a slide-in side panel that
// lists, posts, replies to, and deletes Figma comments via the workspace
// PAT (worker-proxied). Comments posted from Wasabi are prefixed
// `[<user> via Wasabi]: ` worker-side so the actual author is preserved
// despite the shared PAT identity.
//
// Limitations:
//  - Figma's public REST API has no resolve endpoint — comments can only
//    be resolved inside Figma itself. We render the resolved indicator
//    when present but don't expose a resolve action.
//  - Pin positions (`client_meta`) are not visualized — we'd need to draw
//    on top of the embed iframe which is cross-origin.

import React, { useEffect, useState, useCallback, useRef } from "react";
import { C, FONT, RADIUS } from "../design/tokens.js";
import { listFigmaComments, postFigmaComment, deleteFigmaComment } from "../lib/api.js";
import { usePlatform } from "../context/PlatformContext.jsx";

const POLL_MS = 30_000;

function formatRelative(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const diff = now - d;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString();
}

// Group a flat array of Figma comments into top-level threads with replies.
// Figma comments use `parent_id` to link replies to their parent comment.
function groupThreads(comments) {
  const byId = new Map();
  const top = [];
  for (const c of comments) byId.set(c.id, { ...c, replies: [] });
  for (const c of byId.values()) {
    if (c.parent_id && byId.has(c.parent_id)) {
      byId.get(c.parent_id).replies.push(c);
    } else {
      top.push(c);
    }
  }
  // Sort threads newest-first; replies oldest-first inside a thread
  top.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  for (const t of top) t.replies.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  return top;
}

function Avatar({ user, size = 24 }) {
  const initial = (user?.handle || "?").charAt(0).toUpperCase();
  if (user?.img_url) {
    return (
      <img
        src={user.img_url}
        alt={user.handle || ""}
        style={{ width: size, height: size, borderRadius: "50%", flexShrink: 0, objectFit: "cover" }}
      />
    );
  }
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%",
      background: `linear-gradient(135deg, ${C.accent}, ${C.accent}aa)`,
      color: "#fff", fontSize: Math.round(size * 0.46), fontWeight: 700,
      display: "flex", alignItems: "center", justifyContent: "center",
      flexShrink: 0,
    }}>
      {initial}
    </div>
  );
}

function CommentBody({ message }) {
  // Strip the `[Name via Wasabi]: ` prefix so it renders as a small badge
  // instead of cluttering the message text.
  const match = /^\[(.+) via Wasabi\]:\s*([\s\S]*)$/.exec(message || "");
  if (!match) {
    return <div style={{ fontSize: 12, lineHeight: 1.45, whiteSpace: "pre-wrap" }}>{message}</div>;
  }
  return (
    <div>
      <span style={{
        display: "inline-block", fontSize: 9, fontWeight: 700,
        textTransform: "uppercase", letterSpacing: "0.06em",
        padding: "1px 6px", borderRadius: RADIUS.sm,
        background: C.accent + "22", color: C.accent,
        marginBottom: 4,
      }}>
        {match[1]} via Wasabi
      </span>
      <div style={{ fontSize: 12, lineHeight: 1.45, whiteSpace: "pre-wrap" }}>{match[2]}</div>
    </div>
  );
}

export default function FigmaCommentPanel({ fileKey, onClose }) {
  const { identity } = usePlatform();
  const [comments, setComments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [replyTo, setReplyTo] = useState(null); // top-level comment id we're replying to
  const composerRef = useRef(null);

  const load = useCallback(async (silent = false) => {
    if (!fileKey) return;
    if (!silent) setLoading(true);
    setError(null);
    try {
      const res = await listFigmaComments(fileKey);
      setComments(res.comments || []);
    } catch (err) {
      setError(err.message || "Failed to load comments");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [fileKey]);

  useEffect(() => { load(); }, [load]);

  // Poll every 30s while panel is open
  useEffect(() => {
    if (!fileKey) return;
    const t = setInterval(() => load(true), POLL_MS);
    return () => clearInterval(t);
  }, [fileKey, load]);

  const handlePost = useCallback(async () => {
    const text = draft.trim();
    if (!text || posting) return;
    setPosting(true);
    try {
      await postFigmaComment(fileKey, text, replyTo || null);
      setDraft("");
      setReplyTo(null);
      await load(true);
    } catch (err) {
      setError(err.message || "Failed to post comment");
    } finally {
      setPosting(false);
    }
  }, [draft, posting, fileKey, replyTo, load]);

  const handleDelete = useCallback(async (commentId) => {
    try {
      await deleteFigmaComment(fileKey, commentId);
      await load(true);
    } catch (err) {
      setError(err.message || "Failed to delete comment");
    }
  }, [fileKey, load]);

  // Best-effort detection of comments authored by the current Wasabi user:
  // we tagged the message with their display name, so look for the prefix.
  const isOwnedByMe = useCallback((c) => {
    if (!identity?.display_name) return false;
    return new RegExp(`^\\[${identity.display_name.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")} via Wasabi\\]:`).test(c.message || "");
  }, [identity]);

  const threads = groupThreads(comments);

  return (
    <div style={{
      width: 360, flexShrink: 0, display: "flex", flexDirection: "column",
      background: C.darkSurf, borderLeft: `1px solid ${C.darkBorder}`,
      overflow: "hidden", fontFamily: FONT, color: C.darkText,
    }}>
      {/* Header */}
      <div style={{
        height: 44, flexShrink: 0, display: "flex", alignItems: "center",
        gap: 8, padding: "0 14px",
        borderBottom: `1px solid ${C.darkBorder}`,
      }}>
        <div style={{ flex: 1, fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: C.darkMuted }}>
          Comments {comments.length > 0 && <span style={{ color: C.darkText }}>({comments.length})</span>}
        </div>
        <button
          onClick={() => load()}
          title="Refresh"
          style={{
            width: 26, height: 26, display: "flex", alignItems: "center", justifyContent: "center",
            background: "transparent", border: `1px solid ${C.darkBorder}`,
            borderRadius: RADIUS.pill, color: C.darkMuted, fontSize: 13,
            cursor: "pointer", outline: "none",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = C.darkSurf2; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
        >
          ↻
        </button>
        <button
          onClick={onClose}
          title="Close panel"
          aria-label="Close comments"
          style={{
            width: 26, height: 26, display: "flex", alignItems: "center", justifyContent: "center",
            background: "transparent", border: `1px solid ${C.darkBorder}`,
            borderRadius: RADIUS.pill, color: C.darkMuted, fontSize: 14, lineHeight: 1,
            cursor: "pointer", outline: "none",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = C.darkSurf2; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
        >
          &times;
        </button>
      </div>

      {/* List */}
      <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
        {loading && (
          <div style={{ padding: 16, fontSize: 12, color: C.darkMuted }}>Loading comments…</div>
        )}
        {error && !loading && (
          <div style={{
            margin: "8px 12px", padding: "8px 10px", fontSize: 11,
            color: C.error, background: C.error + "12", borderRadius: RADIUS.md,
          }}>
            {error}
          </div>
        )}
        {!loading && !error && threads.length === 0 && (
          <div style={{ padding: 16, fontSize: 12, color: C.darkMuted, lineHeight: 1.5 }}>
            No comments yet. Be the first to leave one — it will appear in Figma as well.
          </div>
        )}
        {threads.map((thread) => (
          <div
            key={thread.id}
            style={{
              padding: "10px 14px",
              borderBottom: `1px solid ${C.darkBorder}55`,
              opacity: thread.resolved_at ? 0.55 : 1,
            }}
          >
            <div style={{ display: "flex", gap: 8 }}>
              <Avatar user={thread.user} size={24} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                  <span style={{ fontSize: 12, fontWeight: 600 }}>{thread.user?.handle || "Unknown"}</span>
                  <span style={{ fontSize: 10, color: C.darkMuted }}>{formatRelative(thread.created_at)}</span>
                  {thread.resolved_at && (
                    <span style={{
                      fontSize: 9, padding: "1px 6px", borderRadius: RADIUS.sm,
                      background: C.darkSurf2, color: C.darkMuted,
                      textTransform: "uppercase", letterSpacing: "0.05em",
                    }}>
                      Resolved
                    </span>
                  )}
                </div>
                <CommentBody message={thread.message} />
                <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
                  <button
                    onClick={() => {
                      setReplyTo(thread.id);
                      setTimeout(() => composerRef.current?.focus(), 0);
                    }}
                    style={textBtnStyle()}
                  >
                    Reply
                  </button>
                  {isOwnedByMe(thread) && (
                    <button onClick={() => handleDelete(thread.id)} style={textBtnStyle("danger")}>
                      Delete
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Replies */}
            {thread.replies.length > 0 && (
              <div style={{ marginTop: 8, marginLeft: 32, display: "flex", flexDirection: "column", gap: 8 }}>
                {thread.replies.map((r) => (
                  <div key={r.id} style={{ display: "flex", gap: 8 }}>
                    <Avatar user={r.user} size={20} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                        <span style={{ fontSize: 11, fontWeight: 600 }}>{r.user?.handle || "Unknown"}</span>
                        <span style={{ fontSize: 10, color: C.darkMuted }}>{formatRelative(r.created_at)}</span>
                      </div>
                      <CommentBody message={r.message} />
                      {isOwnedByMe(r) && (
                        <button
                          onClick={() => handleDelete(r.id)}
                          style={{ ...textBtnStyle("danger"), marginTop: 4 }}
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Composer */}
      <div style={{
        flexShrink: 0, padding: 12, borderTop: `1px solid ${C.darkBorder}`,
        background: C.dark,
      }}>
        {replyTo && (
          <div style={{
            fontSize: 10, color: C.darkMuted, marginBottom: 6,
            display: "flex", alignItems: "center", gap: 6,
          }}>
            Replying to thread
            <button
              onClick={() => setReplyTo(null)}
              style={{
                background: "transparent", border: "none", color: C.darkMuted,
                fontSize: 12, cursor: "pointer", padding: 0, lineHeight: 1,
              }}
              title="Cancel reply"
            >
              &times;
            </button>
          </div>
        )}
        <textarea
          ref={composerRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              handlePost();
            }
          }}
          placeholder={replyTo ? "Write a reply…" : "Leave a comment on this file…"}
          rows={3}
          style={{
            width: "100%", boxSizing: "border-box", resize: "vertical",
            background: C.darkSurf2, color: C.darkText,
            border: `1px solid ${C.darkBorder}`, borderRadius: RADIUS.md,
            padding: "8px 10px", fontSize: 12, fontFamily: FONT, lineHeight: 1.45,
            outline: "none",
          }}
        />
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          marginTop: 6,
        }}>
          <span style={{ fontSize: 10, color: C.darkMuted }}>⌘↵ to send</span>
          <button
            onClick={handlePost}
            disabled={posting || !draft.trim()}
            style={{
              padding: "6px 14px", fontSize: 11, fontWeight: 600, fontFamily: FONT,
              background: posting || !draft.trim() ? C.darkSurf2 : C.accent,
              color: posting || !draft.trim() ? C.darkMuted : "#fff",
              border: "none", borderRadius: RADIUS.pill,
              cursor: posting || !draft.trim() ? "default" : "pointer",
              outline: "none", opacity: posting ? 0.6 : 1,
            }}
          >
            {posting ? "Posting…" : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}

function textBtnStyle(kind) {
  return {
    background: "transparent", border: "none",
    color: kind === "danger" ? C.error : C.darkMuted,
    fontSize: 11, fontFamily: FONT, padding: 0, cursor: "pointer", outline: "none",
  };
}
