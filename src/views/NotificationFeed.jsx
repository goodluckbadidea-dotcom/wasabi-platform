// ─── Notification Feed View ───
// Sprint A: Enriched notifications with click-through, mark-all-read.
// Sprint B: Expandable cards, inline reply, quick actions, dismiss.

import React, { useState, useEffect, useCallback, useRef } from "react";
import { C, FONT, RADIUS } from "../design/tokens.js";
import { ANIM } from "../design/animations.js";
import { usePlatform } from "../context/PlatformContext.jsx";
import { useRecordDrawer } from "../zen/RecordDrawerContext.jsx";
import * as api from "../lib/api.js";
import { timeAgo } from "../utils/helpers.js";
import { IconBell, IconWarning, IconCheck } from "../design/icons.jsx";

const TABS = ["Unread", "All"];

// ── Type-specific config ──
const TYPE_CONFIG = {
  comment:       { icon: "💬", label: "Comment",      color: "#5B8DEF" },
  mention:       { icon: "@",  label: "Mention",      color: "#9B7BEA" },
  status_change: { icon: "🔄", label: "Status",       color: "#E0A052" },
  assignment:    { icon: "👤", label: "Assigned",     color: "#5BAF7C" },
  alert:         { icon: "⚠️", label: "Alert",        color: "#E05252" },
  summary:       { icon: "📋", label: "Summary",      color: "#7BA0C4" },
  notification:  { icon: "🔔", label: "Notification", color: C.darkMuted },
};

// ── Small button style helper ──
const actionBtnStyle = (color) => ({
  padding: "5px 12px", borderRadius: RADIUS.md,
  border: `1px solid ${color}44`, background: `${color}0A`,
  fontSize: 11, fontWeight: 500, fontFamily: FONT,
  color, cursor: "pointer", outline: "none",
  transition: "all 0.15s", display: "flex", alignItems: "center", gap: 4,
});

// ── Inline Notification Card ──
function NotificationCard({ notif, expanded, onToggle, onMarkRead, onDismiss, onClickThrough, onReply, identity }) {
  const isUnread = notif.status === "unread";
  const cfg = TYPE_CONFIG[notif.type] || TYPE_CONFIG.notification;
  const hasClickTarget = notif.page_config_id || notif.record_id || notif.source;
  const canReply = (notif.type === "comment" || notif.type === "mention") && notif.record_id && notif.page_config_id;

  const [replyText, setReplyText] = useState("");
  const [replying, setReplying] = useState(false);
  const [replySuccess, setReplySuccess] = useState(false);
  const inputRef = useRef(null);

  // Focus input when expanded
  useEffect(() => {
    if (expanded && canReply && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [expanded, canReply]);

  const handleReply = async () => {
    if (!replyText.trim() || replying) return;
    setReplying(true);
    try {
      await onReply(notif, replyText.trim());
      setReplyText("");
      setReplySuccess(true);
      setTimeout(() => setReplySuccess(false), 2000);
    } catch (_) {}
    setReplying(false);
  };

  return (
    <div
      style={{
        borderBottom: `1px solid ${C.edgeLine}`,
        background: expanded ? `${cfg.color}06` : isUnread ? `${cfg.color}08` : "transparent",
        transition: "background 0.15s",
      }}
    >
      {/* Main row — click to expand */}
      <div
        onClick={(e) => {
          // Don't toggle if clicking a button
          if (e.target.closest("button") || e.target.closest("input")) return;
          onToggle(notif.id);
          if (isUnread) onMarkRead(notif.id);
        }}
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 12,
          padding: "14px 20px",
          cursor: "pointer",
        }}
        onMouseEnter={(e) => { if (!expanded) e.currentTarget.style.background = isUnread ? `${cfg.color}12` : C.darkSurf2; }}
        onMouseLeave={(e) => { if (!expanded) e.currentTarget.style.background = "transparent"; }}
      >
        {/* Unread dot */}
        <div style={{ width: 8, flexShrink: 0, paddingTop: 5 }}>
          {isUnread && (
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: cfg.color }} />
          )}
        </div>

        {/* Type icon */}
        <div style={{
          flexShrink: 0, paddingTop: 1,
          width: 28, height: 28, borderRadius: RADIUS.md,
          background: `${cfg.color}15`,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 14,
        }}>
          {cfg.icon}
        </div>

        {/* Content */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
            {notif.actor_name && (
              <span style={{ fontSize: 12, fontWeight: 600, color: isUnread ? C.darkText : C.darkMuted }}>
                {notif.actor_name}
              </span>
            )}
            <span style={{
              fontSize: 9, fontWeight: 600, textTransform: "uppercase",
              letterSpacing: "0.06em", color: cfg.color, opacity: 0.8,
            }}>
              {cfg.label}
            </span>
          </div>

          <div style={{
            fontSize: 13,
            color: isUnread ? C.darkText : C.darkMuted,
            fontWeight: isUnread ? 500 : 400,
            lineHeight: 1.45,
          }}>
            {notif.message}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
            <span style={{ fontSize: 11, color: C.darkMuted }}>
              {notif.createdTime ? timeAgo(notif.createdTime) : ""}
            </span>
            {notif.page_name && (
              <span style={{
                fontSize: 9, fontWeight: 600, textTransform: "uppercase",
                letterSpacing: "0.06em", color: C.darkMuted,
                background: C.darkSurf2, borderRadius: RADIUS.pill, padding: "2px 7px",
              }}>
                {notif.page_name}
              </span>
            )}
          </div>
        </div>

        {/* Mark as read (only when collapsed) */}
        {isUnread && !expanded && (
          <button
            onClick={(e) => { e.stopPropagation(); onMarkRead(notif.id); }}
            style={{
              flexShrink: 0, border: `1px solid ${C.darkBorder}`,
              background: C.darkSurf, borderRadius: RADIUS.md,
              padding: "4px 10px", fontSize: 10, fontFamily: FONT,
              color: C.darkMuted, cursor: "pointer", transition: "border-color 0.15s",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = C.accent; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = C.darkBorder; }}
          >
            Mark read
          </button>
        )}

        {/* Expand indicator */}
        <span style={{
          flexShrink: 0, fontSize: 10, color: C.darkMuted, paddingTop: 4,
          transition: "transform 0.15s",
          transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
        }}>
          ▾
        </span>
      </div>

      {/* Expanded action panel */}
      {expanded && (
        <div style={{
          padding: "0 20px 14px 68px", // 8 (dot) + 12 (gap) + 28 (icon) + 12 (gap) + 8 = 68
          display: "flex", flexDirection: "column", gap: 10,
        }}>
          {/* Quick action buttons */}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {/* View Task — all types with a click target */}
            {hasClickTarget && (
              <button
                onClick={() => onClickThrough(notif)}
                style={actionBtnStyle(C.accent)}
                onMouseEnter={(e) => { e.currentTarget.style.background = `${C.accent}18`; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = `${C.accent}0A`; }}
              >
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                  <path d="M6 3H3v10h10v-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                  <path d="M9 2h5v5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M14 2L7 9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                </svg>
                Go to Task
              </button>
            )}

            {/* Dismiss */}
            <button
              onClick={() => onDismiss(notif.id)}
              style={actionBtnStyle(C.darkMuted)}
              onMouseEnter={(e) => { e.currentTarget.style.background = `${C.darkMuted}18`; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = `${C.darkMuted}0A`; }}
            >
              ✕ Dismiss
            </button>
          </div>

          {/* Inline reply — comment/mention types only */}
          {canReply && (
            <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
              <input
                ref={inputRef}
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleReply(); } }}
                placeholder={`Reply to ${notif.actor_name || "this comment"}...`}
                style={{
                  flex: 1, padding: "8px 12px",
                  background: C.darkSurf2, border: `1px solid ${C.darkBorder}`,
                  borderRadius: RADIUS.md, color: C.darkText,
                  fontFamily: FONT, fontSize: 12, outline: "none",
                  transition: "border-color 0.15s",
                }}
                onFocus={(e) => { e.target.style.borderColor = cfg.color; }}
                onBlur={(e) => { e.target.style.borderColor = C.darkBorder; }}
              />
              <button
                onClick={handleReply}
                disabled={!replyText.trim() || replying}
                style={{
                  padding: "8px 16px", borderRadius: RADIUS.md,
                  background: replySuccess ? "#4CAF50" : `linear-gradient(135deg, ${cfg.color}, ${cfg.color}cc)`,
                  color: "#fff", border: "none", fontSize: 12,
                  fontWeight: 600, fontFamily: FONT,
                  cursor: replying ? "wait" : "pointer",
                  opacity: (!replyText.trim() || replying) ? 0.5 : 1,
                  outline: "none", transition: "all 0.15s",
                  flexShrink: 0,
                }}
              >
                {replySuccess ? "✓ Sent" : replying ? "..." : "Reply"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function NotificationFeed() {
  const { user, pages, setActivePage, identity } = usePlatform();
  const { openDrawer } = useRecordDrawer();
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("Unread");
  const [expandedId, setExpandedId] = useState(null);

  // Fetch notifications from D1
  const fetchNotifications = useCallback(async () => {
    if (!user?.workerUrl) {
      setLoading(false);
      return;
    }
    try {
      const result = await api.listNotifications({ limit: 200 });
      const items = (result.notifications || result.rows || []).map((row) => ({
        id: row.id,
        message: row.message || "",
        type: row.type || "notification",
        status: row.status || "unread",
        source: row.source || "",
        record_id: row.record_id || "",
        record_name: row.record_name || "",
        page_config_id: row.page_config_id || "",
        page_name: row.page_name || "",
        actor_name: row.actor_name || "",
        createdTime: row.created_at || row.createdAt || "",
      }));
      items.sort((a, b) => {
        const ta = new Date(a.createdTime).getTime() || 0;
        const tb = new Date(b.createdTime).getTime() || 0;
        return tb - ta;
      });
      setNotifications(items);
    } catch (err) {
      console.error("Failed to fetch notifications:", err);
    } finally {
      setLoading(false);
    }
  }, [user?.workerUrl]);

  useEffect(() => { fetchNotifications(); }, [fetchNotifications]);

  const markAsRead = useCallback(async (notifId) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === notifId ? { ...n, status: "read" } : n))
    );
    try { await api.updateNotification(notifId, { status: "read" }); } catch (_) {}
  }, []);

  const markAllRead = useCallback(async () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, status: "read" })));
    try { await api.markAllNotificationsRead(); } catch (_) {}
  }, []);

  // Dismiss = mark read + remove from view
  const dismissNotification = useCallback(async (notifId) => {
    setNotifications((prev) => prev.filter((n) => n.id !== notifId));
    setExpandedId(null);
    try { await api.deleteNotification(notifId); } catch (_) {}
  }, []);

  // Toggle expand
  const toggleExpand = useCallback((notifId) => {
    setExpandedId((prev) => (prev === notifId ? null : notifId));
  }, []);

  // Click-through navigation
  const handleClickThrough = useCallback((notif) => {
    if (notif.status === "unread") markAsRead(notif.id);
    if (notif.page_config_id) {
      const matchedPage = pages.find((p) =>
        p.id === notif.page_config_id || p.databaseIds?.includes(notif.page_config_id)
      );
      if (matchedPage) {
        setActivePage(matchedPage.id);
        if (notif.record_id) {
          setTimeout(() => {
            openDrawer({
              type: "task",
              id: notif.record_id,
              title: notif.record_name || "Record",
              source: `d1:${notif.page_config_id}`,
              sourceName: notif.page_name || "",
              tableId: notif.page_config_id,
            });
          }, 300);
        }
        return;
      }
    }
    const recordId = notif.record_id || notif.source;
    if (recordId) {
      const matchedPage = pages.find((p) => p.databaseIds?.some((dbId) => dbId === recordId));
      if (matchedPage) setActivePage(matchedPage.id);
    }
  }, [pages, setActivePage, openDrawer, markAsRead]);

  // Inline reply — post comment to the record thread
  const handleReply = useCallback(async (notif, text) => {
    const userId = identity?.id || "default";
    const userName = identity?.displayName || user?.name || "User";
    await api.createRecordComment(
      notif.record_id,
      notif.page_config_id,
      text,
      userId,
      userName,
    );
  }, [identity, user]);

  // Filter
  const filtered = activeTab === "Unread"
    ? notifications.filter((n) => n.status === "unread")
    : notifications;
  const unreadCount = notifications.filter((n) => n.status === "unread").length;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", fontFamily: FONT }}>
      {/* Header */}
      <div style={{
        flexShrink: 0, padding: "16px 32px 0",
        borderBottom: `1px solid ${C.edgeLine}`,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, animation: ANIM.snapUp(0.03) }}>
          <IconBell size={22} color={C.accent} />
          <span style={{ fontSize: 18, fontWeight: 600, color: C.darkText, fontFamily: FONT }}>Inbox</span>
          <div style={{ flex: 1 }} />
          {unreadCount > 0 && (
            <button onClick={markAllRead}
              style={{
                background: "transparent", border: `1px solid ${C.darkBorder}`,
                borderRadius: RADIUS.md, padding: "4px 10px", fontSize: 10,
                fontFamily: FONT, color: C.darkMuted, cursor: "pointer",
                transition: "border-color 0.15s", marginRight: 4,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = C.accent; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = C.darkBorder; }}
            >Mark all read</button>
          )}
          <button onClick={() => { setLoading(true); fetchNotifications(); }}
            style={{
              background: "transparent", border: `1px solid ${C.darkBorder}`,
              borderRadius: RADIUS.md, padding: "4px 10px", fontSize: 10,
              fontFamily: FONT, color: C.darkMuted, cursor: "pointer",
              transition: "border-color 0.15s",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = C.accent; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = C.darkBorder; }}
          >Refresh</button>
        </div>
        <div style={{
          display: "flex", gap: 3, marginBottom: 12,
          background: C.darkSurf, borderRadius: RADIUS.lg, padding: 3, width: "fit-content",
        }}>
          {TABS.map((tab) => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              style={{
                padding: "6px 18px", borderRadius: RADIUS.lg, border: "none",
                cursor: "pointer", fontSize: 12, fontWeight: activeTab === tab ? 600 : 400,
                fontFamily: FONT,
                background: activeTab === tab ? `linear-gradient(135deg, ${C.accent}, ${C.accent}cc)` : "transparent",
                color: activeTab === tab ? "#fff" : C.darkMuted,
                transition: "background 0.15s, color 0.15s", outline: "none",
              }}
            >
              {tab}
              {tab === "Unread" && unreadCount > 0 && (
                <span style={{
                  marginLeft: 6, background: activeTab === tab ? "rgba(255,255,255,0.25)" : C.accent,
                  color: "#fff", borderRadius: RADIUS.pill, padding: "1px 6px",
                  fontSize: 10, fontWeight: 700,
                }}>{unreadCount}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Notification list */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: "center", color: C.darkMuted, fontSize: 14 }}>
            Loading notifications...
          </div>
        ) : filtered.length === 0 ? (
          <div style={{
            display: "flex", flexDirection: "column", alignItems: "center",
            justifyContent: "center", padding: 64, gap: 12, color: C.darkMuted,
          }}>
            <IconBell size={24} color={C.darkMuted} />
            <span style={{ fontSize: 14 }}>
              {activeTab === "Unread" ? "No unread notifications." : "No notifications yet."}
            </span>
          </div>
        ) : (
          filtered.map((notif, idx) => (
            <NotificationCard
              key={notif.id}
              notif={notif}
              expanded={expandedId === notif.id}
              onToggle={toggleExpand}
              onMarkRead={markAsRead}
              onDismiss={dismissNotification}
              onClickThrough={handleClickThrough}
              onReply={handleReply}
              identity={identity}
            />
          ))
        )}
      </div>
    </div>
  );
}
