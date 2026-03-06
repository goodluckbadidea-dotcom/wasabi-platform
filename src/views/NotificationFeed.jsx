// ─── Notification Feed View ───
// Notification list with read/unread states. Reads from the platform's notification database.

import React, { useState, useEffect, useCallback } from "react";
import { C, FONT, RADIUS } from "../design/tokens.js";
import { usePlatform } from "../context/PlatformContext.jsx";
import { queryAll } from "../notion/pagination.js";
import { updatePage } from "../notion/client.js";
import { readProp } from "../notion/properties.js";
import { formatDate, timeAgo } from "../utils/helpers.js";
import { IconBell, IconWarning, IconCheck } from "../design/icons.jsx";

const TABS = ["Unread", "All"];

export default function NotificationFeed({ config = {} }) {
  const { user, platformIds } = usePlatform();
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("Unread");

  const notifDbId = config.notifDbId || platformIds?.notifDbId;

  // Fetch notifications
  const fetchNotifications = useCallback(async () => {
    if (!user?.workerUrl || !user?.notionKey || !notifDbId) {
      setLoading(false);
      return;
    }

    try {
      const results = await queryAll(user.workerUrl, user.notionKey, notifDbId, null, [
        { property: "Created", direction: "descending" },
      ]);

      const parsed = results.map((page) => {
        const props = page.properties || {};
        // Extract notification fields
        let message = "", type = "notification", status = "unread", source = "";
        let createdTime = page.created_time || "";

        for (const [key, prop] of Object.entries(props)) {
          const val = readProp(prop);
          const lk = key.toLowerCase();
          if (prop.type === "title") message = val || "";
          else if (lk === "type" || lk === "category") type = val || "notification";
          else if (lk === "status" || lk === "read") {
            if (prop.type === "checkbox") status = val ? "read" : "unread";
            else status = (val || "unread").toLowerCase();
          }
          else if (lk === "source" || lk === "from") source = val || "";
          else if (prop.type === "created_time") createdTime = val || createdTime;
        }

        return { id: page.id, message, type, status, source, createdTime };
      });

      setNotifications(parsed);
    } catch (err) {
      console.error("Failed to fetch notifications:", err);
    } finally {
      setLoading(false);
    }
  }, [user, notifDbId]);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  // Mark as read
  const markAsRead = useCallback(async (notifId) => {
    if (!user?.workerUrl || !user?.notionKey) return;

    // Optimistic update
    setNotifications((prev) =>
      prev.map((n) => (n.id === notifId ? { ...n, status: "read" } : n))
    );

    try {
      // Try updating the Status property as select, fallback to checkbox
      await updatePage(user.workerUrl, user.notionKey, notifId, {
        Status: { select: { name: "read" } },
      });
    } catch {
      try {
        await updatePage(user.workerUrl, user.notionKey, notifId, {
          Read: { checkbox: true },
        });
      } catch (err) {
        console.error("Failed to mark as read:", err);
      }
    }
  }, [user]);

  // Filter by tab
  const filtered = activeTab === "Unread"
    ? notifications.filter((n) => n.status === "unread")
    : notifications;

  const unreadCount = notifications.filter((n) => n.status === "unread").length;

  if (!notifDbId) {
    return (
      <div style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        gap: 12,
        color: C.darkMuted,
        fontSize: 14,
        fontFamily: FONT,
      }}>
        <IconBell size={32} color={C.darkMuted} />
        <span>No notification database configured.</span>
        <span style={{ fontSize: 12, opacity: 0.6 }}>
          Wasabi will set this up during page creation.
        </span>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", fontFamily: FONT }}>
      {/* Tab bar */}
      <div style={{
        display: "flex",
        alignItems: "center",
        padding: "10px 20px",
        borderBottom: `1px solid ${C.edgeLine}`,
        gap: 6,
      }}>
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              padding: "6px 14px",
              borderRadius: RADIUS.pill,
              border: "none",
              cursor: "pointer",
              fontSize: 12,
              fontWeight: 600,
              fontFamily: FONT,
              background: activeTab === tab ? C.accent : C.darkSurf2,
              color: activeTab === tab ? "#fff" : C.darkMuted,
              transition: "background 0.15s, color 0.15s",
            }}
          >
            {tab}
            {tab === "Unread" && unreadCount > 0 && (
              <span style={{
                marginLeft: 6,
                background: activeTab === tab ? "rgba(255,255,255,0.25)" : C.accent,
                color: activeTab === tab ? "#fff" : "#fff",
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
