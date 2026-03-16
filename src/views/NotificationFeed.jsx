// ─── Notification Feed View ───
// Notification list with read/unread states. Reads from D1 notification store.

import React, { useState, useEffect, useCallback } from "react";
import { C, FONT, RADIUS } from "../design/tokens.js";
import { ANIM } from "../design/animations.js";
import { usePlatform } from "../context/PlatformContext.jsx";
import * as api from "../lib/api.js";
import { timeAgo } from "../utils/helpers.js";
import { IconBell, IconWarning, IconCheck } from "../design/icons.jsx";

const TABS = ["Unread", "All"];

export default function NotificationFeed() {
  const { user } = usePlatform();
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

  // Mark as read via D1
  const markAsRead = useCallback(async (notifId) => {
    // Optimistic update
    setNotifications((prev) =>
      prev.map((n) => (n.id === notifId ? { ...n, status: "read" } : n))
    );

    try {
      await api.updateNotification(notifId, { status: "read" });
    } catch (err) {
      console.error("Failed to mark as read:", err);
    }
  }, []);

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
          {/* Refresh button */}
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
            const NotifIcon = notif.type === "alert" ? IconWarning : notif.type === "summary" ? IconCheck : IconBell;

            return (
              <div
                key={notif.id}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 12,
                  padding: "14px 20px",
                  borderBottom: `1px solid ${C.edgeLine}`,
                  background: isUnread ? C.darkSurf2 : "transparent",
                  transition: "background 0.15s",
                  animation: `fadeUp 0.2s ease ${idx * 0.03}s both`,
                }}
              >
                {/* Unread dot */}
                <div style={{ width: 8, flexShrink: 0, paddingTop: 5 }}>
                  {isUnread && (
                    <div style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: C.accent,
                    }} />
                  )}
                </div>

                {/* Icon */}
                <div style={{ flexShrink: 0, paddingTop: 2 }}>
                  <NotifIcon size={16} color={isUnread ? C.darkText : C.darkMuted} />
                </div>

                {/* Content */}
                <div style={{ flex: 1, minWidth: 0 }}>
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
                    {notif.source && (
                      <span style={{
                        fontSize: 9,
                        fontWeight: 600,
                        textTransform: "uppercase",
                        letterSpacing: "0.06em",
                        color: C.darkMuted,
                        background: C.darkSurf2,
                        borderRadius: RADIUS.pill,
                        padding: "2px 7px",
                      }}>
                        {notif.source}
                      </span>
                    )}
                  </div>
                </div>

                {/* Mark as read */}
                {isUnread && (
                  <button
                    onClick={() => markAsRead(notif.id)}
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
