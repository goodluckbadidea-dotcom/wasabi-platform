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

import React, { useEffect, useState, useCallback, useMemo } from "react";
import { C, FONT, RADIUS } from "../design/tokens.js";
import {
  listFigmaComments, postFigmaComment, deleteFigmaComment,
  listFigmaLinksForComment, createFigmaCommentLink, deleteFigmaCommentLink,
} from "../lib/api.js";
import { usePlatform } from "../context/PlatformContext.jsx";
import MentionInput from "../components/MentionInput.jsx";
import RecordPickerModal from "../components/RecordPickerModal.jsx";
import { useNavigation } from "../context/NavigationContext.jsx";
import { IconClose } from "../design/icons.jsx";

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

export default function FigmaCommentPanel({ fileKey, fileName = "", onClose }) {
  const { identity } = usePlatform();
  const nav = useNavigation();
  const [comments, setComments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [replyTo, setReplyTo] = useState(null); // top-level comment id we're replying to

  // Link state: which comment is currently being linked (picker target) + cache
  // of links keyed by commentId. The cache is filled lazily as each comment
  // is rendered (one batched fetch per panel load).
  const [linkPickerCommentId, setLinkPickerCommentId] = useState(null);
  const [linksByComment, setLinksByComment] = useState({}); // { [commentId]: link[] }

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

  // Refresh the links map for the currently-loaded set of comments. Runs after
  // each comments load. Fetches in parallel; failures are swallowed per comment.
  const refreshLinks = useCallback(async (commentIds) => {
    if (!Array.isArray(commentIds) || commentIds.length === 0) {
      setLinksByComment({});
      return;
    }
    try {
      const results = await Promise.all(
        commentIds.map((cid) =>
          listFigmaLinksForComment(cid).catch(() => ({ links: [] }))
        )
      );
      const next = {};
      commentIds.forEach((cid, i) => {
        next[cid] = results[i]?.links || [];
      });
      setLinksByComment(next);
    } catch {
      // Non-fatal — links section just stays empty.
    }
  }, []);

  useEffect(() => {
    const ids = comments.map((c) => c.id).filter(Boolean);
    refreshLinks(ids);
  }, [comments, refreshLinks]);

  const handlePost = useCallback(async () => {
    const text = draft.trim();
    if (!text || posting) return;
    setPosting(true);
    try {
      await postFigmaComment(fileKey, text, replyTo || null, fileName);
      setDraft("");
      setReplyTo(null);
      await load(true);
    } catch (err) {
      setError(err.message || "Failed to post comment");
    } finally {
      setPosting(false);
    }
  }, [draft, posting, fileKey, fileName, replyTo, load]);

  const handleDelete = useCallback(async (commentId) => {
    try {
      await deleteFigmaComment(fileKey, commentId);
      await load(true);
    } catch (err) {
      setError(err.message || "Failed to delete comment");
    }
  }, [fileKey, load]);

  // Find a comment object by id (top-level or reply) so the link snapshot can
  // capture the author + message + timestamp accurately.
  const findCommentById = useCallback((id) => {
    for (const c of comments) if (c.id === id) return c;
    return null;
  }, [comments]);

  const handleLinkPick = useCallback(async (picked) => {
    const commentId = linkPickerCommentId;
    if (!commentId) return;
    const comment = findCommentById(commentId);
    setLinkPickerCommentId(null);
    if (!comment) return;
    try {
      await createFigmaCommentLink({
        figma_file_key: fileKey,
        figma_file_name: fileName,
        figma_comment_id: commentId,
        comment_message: comment.message || "",
        comment_author: comment.user?.handle || "",
        comment_created_at: comment.created_at || "",
        record_id: picked.record_id,
        record_name: picked.record_name || "",
        page_config_id: picked.page_config_id,
      });
      // Re-fetch links for just this comment to update the UI.
      const res = await listFigmaLinksForComment(commentId).catch(() => ({ links: [] }));
      setLinksByComment((prev) => ({ ...prev, [commentId]: res.links || [] }));
    } catch (err) {
      setError(err.message || "Failed to link comment to record");
    }
  }, [linkPickerCommentId, findCommentById, fileKey, fileName]);

  const handleUnlink = useCallback(async (linkId, commentId) => {
    try {
      await deleteFigmaCommentLink(linkId);
      setLinksByComment((prev) => ({
        ...prev,
        [commentId]: (prev[commentId] || []).filter((l) => l.id !== linkId),
      }));
    } catch (err) {
      setError(err.message || "Failed to remove link");
    }
  }, []);

  const handleOpenRecord = useCallback((link) => {
    if (nav?.navigateToRecord && link?.page_config_id && link?.record_id) {
      nav.navigateToRecord(link.page_config_id, link.record_id);
      onClose?.();
    }
  }, [nav, onClose]);

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
            width: 26, height: 26, display: "inline-flex", alignItems: "center", justifyContent: "center",
            padding: 0,
            background: "transparent", border: `1px solid ${C.darkBorder}`,
            borderRadius: RADIUS.pill, color: C.darkMuted,
            cursor: "pointer", outline: "none",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = C.darkSurf2; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
        >
          <IconClose size={11} color={C.darkMuted} />
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
                <RecordLinkTags
                  links={linksByComment[thread.id] || []}
                  onOpen={handleOpenRecord}
                  onRemove={(id) => handleUnlink(id, thread.id)}
                />
                <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
                  <button
                    onClick={() => setReplyTo(thread.id)}
                    style={textBtnStyle()}
                  >
                    Reply
                  </button>
                  <button
                    onClick={() => setLinkPickerCommentId(thread.id)}
                    style={textBtnStyle()}
                    title="Link this comment to a Wasabi record"
                  >
                    Link to record
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
                      <RecordLinkTags
                        links={linksByComment[r.id] || []}
                        onOpen={handleOpenRecord}
                        onRemove={(id) => handleUnlink(id, r.id)}
                      />
                      <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
                        <button
                          onClick={() => setLinkPickerCommentId(r.id)}
                          style={textBtnStyle()}
                          title="Link this reply to a Wasabi record"
                        >
                          Link to record
                        </button>
                        {isOwnedByMe(r) && (
                          <button
                            onClick={() => handleDelete(r.id)}
                            style={textBtnStyle("danger")}
                          >
                            Delete
                          </button>
                        )}
                      </div>
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
        <MentionInput
          value={draft}
          onChange={setDraft}
          placeholder={replyTo ? "Write a reply… (type @ to mention a teammate)" : "Leave a comment… (type @ to mention a teammate)"}
          multiline
          rows={3}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              handlePost();
            }
          }}
          style={{
            background: C.darkSurf2, color: C.darkText,
            border: `1px solid ${C.darkBorder}`, borderRadius: RADIUS.md,
            padding: "8px 10px", fontSize: 12, fontFamily: FONT, lineHeight: 1.45,
            outline: "none", resize: "vertical",
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

      {/* Record picker — opened by "Link to record" on any comment */}
      <RecordPickerModal
        open={!!linkPickerCommentId}
        title="Link this comment to a record"
        onPick={handleLinkPick}
        onCancel={() => setLinkPickerCommentId(null)}
      />
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

// Small inline list of "linked to:" record tags shown under each comment body.
function RecordLinkTags({ links, onOpen, onRemove }) {
  if (!links || links.length === 0) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
      {links.map((l) => (
        <span
          key={l.id}
          style={{
            display: "inline-flex", alignItems: "center", gap: 4,
            padding: "2px 4px 2px 8px", height: 20, lineHeight: 1,
            background: C.accent + "18", border: `1px solid ${C.accent}33`,
            borderRadius: RADIUS.pill, color: C.accent,
            fontSize: 10, fontFamily: FONT, fontWeight: 600,
            maxWidth: 220, overflow: "hidden",
          }}
        >
          <button
            onClick={(e) => { e.stopPropagation(); onOpen?.(l); }}
            title={`Open "${l.record_name || ""}"`}
            style={{
              background: "transparent", border: "none", padding: 0,
              color: "inherit", font: "inherit", cursor: "pointer", outline: "none",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              maxWidth: 180,
            }}
          >
            ↗ {l.record_name || "record"}
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onRemove?.(l.id); }}
            title="Remove link"
            aria-label="Remove link"
            style={{
              background: "transparent", border: "none", padding: "0 4px",
              color: C.accent, font: "inherit", cursor: "pointer", outline: "none",
              fontSize: 12, lineHeight: 1, opacity: 0.7,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; }}
            onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.7"; }}
          >
            &times;
          </button>
        </span>
      ))}
    </div>
  );
}
