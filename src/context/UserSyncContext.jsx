// ─── UserSyncContext ───
// React context wrapping UserSocket for multi-device sync.
// Provides dashboard sync, navigation sync, session management, and device awareness.
// Must be mounted inside PlatformProvider (uses usePlatform for identity).

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import { usePlatform } from "./PlatformContext.jsx";
import UserSocket from "../lib/userSocket.js";

const UserSyncContext = createContext(null);

export function UserSyncProvider({ children }) {
  const { identity } = usePlatform();
  const [connectedDevices, setConnectedDevices] = useState([]);
  const [isConnected, setIsConnected] = useState(false);
  const socketRef = useRef(null);
  const dashboardHandlers = useRef(new Set());
  const navHandlers = useRef(new Set());
  const sessionRevokedHandlers = useRef(new Set());
  const taskCacheHandlers = useRef(new Set());
  const notificationHandlers = useRef(new Set());

  useEffect(() => {
    if (!identity?.id) return;

    const socket = new UserSocket(identity.id);
    socketRef.current = socket;

    const unsub = socket.onMessage((msg) => {
      switch (msg.type) {
        case "devices":
          setConnectedDevices(msg.devices || []);
          break;

        case "dashboard_update":
          for (const handler of dashboardHandlers.current) {
            handler(msg.widgets);
          }
          break;

        case "nav_update":
          for (const handler of navHandlers.current) {
            handler(msg.pageId, msg.folderId);
          }
          break;

        case "session_revoked":
          for (const handler of sessionRevokedHandlers.current) {
            handler(msg.sessionIds);
          }
          break;

        case "task_cache_invalidate":
          for (const handler of taskCacheHandlers.current) {
            handler(msg.tableId);
          }
          break;

        case "notification_new":
          for (const handler of notificationHandlers.current) {
            handler(msg.notificationId);
          }
          break;
      }
    });

    socket.connect();
    setIsConnected(true);

    return () => {
      unsub();
      socket.disconnect();
      socketRef.current = null;
      setIsConnected(false);
      setConnectedDevices([]);
    };
  }, [identity?.id]);

  // ── Outbound actions ──

  const sendDashboardUpdate = useCallback((widgets) => {
    socketRef.current?.sendDashboardUpdate(widgets);
  }, []);

  const sendNavUpdate = useCallback((pageId, folderId) => {
    socketRef.current?.sendNavUpdate(pageId, folderId);
  }, []);

  // ── Subscribe to inbound events ──

  const onDashboardUpdate = useCallback((handler) => {
    dashboardHandlers.current.add(handler);
    return () => dashboardHandlers.current.delete(handler);
  }, []);

  const onNavUpdate = useCallback((handler) => {
    navHandlers.current.add(handler);
    return () => navHandlers.current.delete(handler);
  }, []);

  const onSessionRevoked = useCallback((handler) => {
    sessionRevokedHandlers.current.add(handler);
    return () => sessionRevokedHandlers.current.delete(handler);
  }, []);

  const onTaskCacheInvalidate = useCallback((handler) => {
    taskCacheHandlers.current.add(handler);
    return () => taskCacheHandlers.current.delete(handler);
  }, []);

  const onNotificationNew = useCallback((handler) => {
    notificationHandlers.current.add(handler);
    return () => notificationHandlers.current.delete(handler);
  }, []);

  const value = {
    isConnected,
    connectedDevices,
    sendDashboardUpdate,
    sendNavUpdate,
    onDashboardUpdate,
    onNavUpdate,
    onSessionRevoked,
    onTaskCacheInvalidate,
    onNotificationNew,
  };

  return (
    <UserSyncContext.Provider value={value}>
      {children}
    </UserSyncContext.Provider>
  );
}

export function useUserSync() {
  return useContext(UserSyncContext);
}
