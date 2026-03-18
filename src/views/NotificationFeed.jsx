// ─── Notification Feed View ───
// Notification list with read/unread states, click-through navigation,
// mark-all-read, and type-specific formatting.

import React, { useState, useEffect, useCallback } from "react";
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

export default function NotificationFeed() {
  const { user, pages, setActivePage } = usePlatform();
  const { openDrawer } = useRecordDrawer();
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("Unread");

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

      // Sort newest first
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

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  // Mark single as read
  const markAsRead = useCallback(async (notifId) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === notifId ? { ...n, status: "read" } : n))
    );
    try {
      await api.updateNotification(notifId, { status: "read" });
    } catch (err) {
      console.error("Failed to mark as read:", err);
    }
  }, []);

  // Mark all as read
  const markAllRead = useCallback(async () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, status: "read" })));
    try {
      await api.markAllNotificationsRead();
    } catch (err) {
      console.error("Failed to mark all as read:", err);
    }
  }, []);

  // Click-through: navigate to the source page/record
  const handleClickThrough = useCallback((notif) => {
    // Mark as read on click
    if (notif.status === "unread") markAsRead(notif.id);

    // If we have a page_config_id, navigate to that page
    if (notif.page_config_id) {
      const matchedPage = pages.find((p) =>
        p.id === notif.page_config_id || p.databaseIds?.includes(notif.page_config_id)
      );
      if (matchedPage) {
        setActivePage(matchedPage.id);
        // If we also have a record_id, open the drawer after a short delay
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

    // Fallback: try to find page by record_id in source
    const recordId = notif.record_id || notif.source;
    if (recordId) {
      const matchedPage = pages.find((p) =>
        p.databaseIds?.some((dbId) => dbId === recordId)
      );
      if (matchedPage) {
        setActivePage(matchedPage.id);
        return;
      }
    }
  }, [pages, setActivePage, openDrawer, markAsRead]);

  // Filter by tab
  const filtered = activeTab === "Unread"
    ? notifications.filter((n) => n.status === "unread")
    : notifications;

  const unreadCount = notifications.filter((n) => n.status === "unread").length;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", fontFamily: FONT }}>
      {/* Page header + Tab bar */}
      <div style={{
        flexShrink: 0,
        padding: "16px 32px 0",
        borderBottom: `1px solid ${C.edgeLine}`,
      }}>
        {/* Title row */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, animation: ANIM.snapUp(0.03) }}>
          <IconBell size={22} color={C.accent} />
          <span style={{ fontSize: 18, fontWeight: 600, color: C.darkText, fontFamily: FONT }}>
            Inbox
          </span>
          <div style={{ flex: 1 }} />
          {/* Mark all read */}
          {unreadCount > 0 && (
            <button
              onClick={markAllRead}
              style={{
                background: "transparent",
                border: `1px solid ${C.darkBorder}`,
                borderRadius: RADIUS.md,
                padding: "4px 10px",
                fontSize: 10,
                fontFamily: FONT,
                color: C.darkMuted,
                cursor: "pointer",
                transition: "border-color 0.15s",
                marginRight: 4,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = C.accent; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = C.darkBorder; }}
            >
              Mark all read
            </button>
          )}
          {/* Refresh */}
          <button
            onClick={() => { setLoading(true); fetchNotifications(); }}
            style={{
              background: "transparent",
              border: `1px solid ${C.darkBorder}`,
              borderRadius: RADIUS.md,
              padding: "4px 10px",
              fontSize: 10,
              fontFamily: FONT,
              color: C.darkMuted,
              cursor: "pointer",
              transition: "border-color 0.15s",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = C.accent; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = C.darkBorder; }}
          >
            Refresh
          </button>
        </div>
        {/* Tab pills */}
        <div style={{
          display: "flex",
          gap: 3,
          marginBottom: 12,
          background: C.darkSurf,
          borderRadius: RADIUS.lg,
          padding: 3,
          width: "fit-content",
        }}>
          {TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                padding: "6px 18px",
                borderRadius: RADIUS.lg,
                border: "none",
                cursor: "pointer",
                fontSize: 12,
                fontWeight: activeTab === tab ? 600 : 400,
                fontFamily: FONT,
                background: activeTab === tab ? `linear-gradient(135deg, ${C.accent}, ${C.accent}cc)` : "transparent",
                color: activeTab === tab ? "#fff" : C.darkMuted,
                transition: "background 0.15s, color 0.15s",
                outline: "none",
              }}
            >
              {tab}
              {tab === "Unread" && unreadCount > 0 && (
                <span style={{
                  marginLeft: 6,
                  background: activeTab === tab ? "rgba(255,255,255,0.25)" : C.accent,
                  color: "#fff",
                  borderRadius: RADIUS.pill,
                  padding: "1px 6px",
                  fontSize: 10,
                  fontWeight: 700,
                }}>
                  {unreadCount}
                </span>
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
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: 64,
            gap: 12,
            color: C.darkMuted,
          }}>
            <IconBell size={24} color={C.darkMuted} />
            <span style={{ fontSize: 14 }}>
              {activeTab === "Unread" ? "No unread notifications." : "No notifications yet."}
            </span>
          </div>
        ) : (
          filtered.map((notif, idx) => {
            const isUnread = notif.status === "unread";
            const cfg = TYPE_CONFIG[notif.type] || TYPE_CONFIG.notification;
            const hasClickTarget = notif.page_config_id || notif.record_id || notif.source;

            return (
              <div
                key={notif.id}
                onClick={() => hasClickTarget && handleClickThrough(notif)}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 12,
                  padding: "14px 20px",
                  borderBottom: `1px solid ${C.edgeLine}`,
                  background: isUnread ? `${cfg.color}08` : "transparent",
                  transition: "background 0.15s",
                  cursor: hasClickTarget ? "pointer" : "default",
                  animation: `fadeUp 0.2s ease ${idx * 0.03}s both`,
                }}
                onMouseEnter={(e) => { if (hasClickTarget) e.currentTarget.style.background = isUnread ? `${cfg.color}12` : C.darkSurf2; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = isUnread ? `${cfg.color}08` : "transparent"; }}
              >
                {/* Unread dot */}
                <div style={{ width: 8, flexShrink: 0, paddingTop: 5 }}>
                  {isUnread && (
                    <div style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: cfg.color,
                    }} />
                  )}
                </div>

                {/* Type icon */}
                <div style={{
                  flexShrink: 0, paddingTop: 1,
                  width: 28, height: 28,
                  borderRadius: RADIUS.md,
                  background: `${cfg.color}15`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 14,
                }}>
                  {cfg.icon}
                </div>

                {/* Content */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  {/* Actor + type label */}
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

                  {/* Message */}
                  <div style={{
                    fontSize: 13,
                    color: isUnread ? C.darkText : C.darkMuted,
                    fontWeight: isUnread ? 500 : 400,
                    lineHeight: 1.45,
                  }}>
                    {notif.message}
                  </div>

                  {/* Meta: time + page name */}
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                    <span style={{ fontSize: 11, color: C.darkMuted }}>
                      {notif.createdTime ? timeAgo(notif.createdTime) : ""}
                    </span>
                    {notif.page_name && (
                      <span style={{
                        fontSize: 9, fontWeight: 600,
                        textTransform: "uppercase",
                        letterSpacing: "0.06em",
                        color: C.darkMuted,
                        background: C.darkSurf2,
                        borderRadius: RADIUS.pill,
                        padding: "2px 7px",
                      }}>
                        {notif.page_name}
                      </span>
                    )}
                  </div>
                </div>

                {/* Mark as read */}
                {isUnread && (
                  <button
                    onClick={(e) => { e.stopPropagation(); markAsRead(notif.id); }}
                    style={{
                      flexShrink: 0,
                      border: `1px solid ${C.darkBorder}`,
                      background: C.darkSurf,
                      borderRadius: RADIUS.md,
                      padding: "4px 10px",
                      fontSize: 10,
                      fontFamily: FONT,
                      color: C.darkMuted,
                      cursor: "pointer",
                      transition: "border-color 0.15s",
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.borderColor = C.accent; }}
                    onMouseLeave={(e) => { e.currentTarget.style.borderColor = C.darkBorder; }}
                  >
                    Mark read
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
