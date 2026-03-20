// ─── CollaborationContext ───
// React context wrapping TableSocket for real-time presence + conflict detection.
// Provides activeUsers, typing indicators, and live record updates to all views.

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import TableSocket, { userColor } from "../lib/tableSocket.js";

const CollaborationContext = createContext(null);

export function CollaborationProvider({ tableId, userId, userName, role, children }) {
  const [activeUsers, setActiveUsers] = useState(new Map());
  const [pendingConflicts, setPendingConflicts] = useState([]);
  const socketRef = useRef(null);
  const recordUpdateHandlers = useRef(new Set());

  // Connect/disconnect WebSocket when tableId changes
  useEffect(() => {
    if (!tableId || !userId) return;

    const socket = new TableSocket(tableId, userId, userName, role);
    socketRef.current = socket;

    const unsub = socket.onMessage((msg) => {
      switch (msg.type) {
        case "presence": {
          const map = new Map();
          for (const u of msg.users) {
            if (u.userId !== userId) {
              map.set(u.userId, u);
            }
          }
          setActiveUsers(map);
          break;
        }

        case "user_joined": {
          if (msg.userId === userId) break;
          setActiveUsers((prev) => {
            const next = new Map(prev);
            next.set(msg.userId, { ...next.get(msg.userId), userId: msg.userId, userName: msg.userName, color: msg.color });
            return next;
          });
          break;
        }

        case "user_left": {
          setActiveUsers((prev) => {
            const next = new Map(prev);
            next.delete(msg.userId);
            return next;
          });
          break;
        }

        case "user_focus": {
          setActiveUsers((prev) => {
            const next = new Map(prev);
            const existing = next.get(msg.userId) || {};
            next.set(msg.userId, { ...existing, activeRecordId: msg.recordId });
            return next;
          });
          break;
        }

        case "user_blur": {
          setActiveUsers((prev) => {
            const next = new Map(prev);
            const existing = next.get(msg.userId) || {};
            next.set(msg.userId, { ...existing, activeRecordId: null, isTyping: false, typingField: null });
            return next;
          });
          break;
        }

        case "user_typing": {
          setActiveUsers((prev) => {
            const next = new Map(prev);
            const existing = next.get(msg.userId) || {};
            next.set(msg.userId, { ...existing, isTyping: true, typingField: msg.field, activeRecordId: msg.recordId });
            return next;
          });
          break;
        }

        case "user_stop_typing": {
          setActiveUsers((prev) => {
            const next = new Map(prev);
            const existing = next.get(msg.userId) || {};
            next.set(msg.userId, { ...existing, isTyping: false, typingField: null });
            return next;
          });
          break;
        }

        case "record_updated": {
          // Notify all registered handlers of live updates
          for (const handler of recordUpdateHandlers.current) {
            handler(msg);
          }
          break;
        }

        case "conflict": {
          setPendingConflicts((prev) => [
            ...prev.filter((c) => !(c.recordId === msg.recordId && c.field === msg.field)),
            { recordId: msg.recordId, field: msg.field, yourValue: msg.yourValue, theirValue: msg.theirValue, detectedAt: Date.now() },
          ]);
          break;
        }

        case "save_result": {
          // Notify handlers of save confirmation
          for (const handler of recordUpdateHandlers.current) {
            handler(msg);
          }
          break;
        }
      }
    });

    socket.connect();

    return () => {
      unsub();
      socket.disconnect();
      socketRef.current = null;
      setActiveUsers(new Map());
      setPendingConflicts([]);
    };
  }, [tableId, userId, userName, role]);

  // ── Actions ──

  const focusRecord = useCallback((recordId) => {
    socketRef.current?.focusRecord(recordId);
  }, []);

  const blurRecord = useCallback(() => {
    socketRef.current?.blurRecord();
  }, []);

  const startTyping = useCallback((recordId, field) => {
    socketRef.current?.startTyping(recordId, field);
  }, []);

  const stopTyping = useCallback(() => {
    socketRef.current?.stopTyping();
  }, []);

  const saveRecord = useCallback((recordId, cells, baseVersions) => {
    socketRef.current?.saveRecord(recordId, cells, baseVersions);
  }, []);

  const resolveConflict = useCallback((recordId, field) => {
    setPendingConflicts((prev) => prev.filter((c) => !(c.recordId === recordId && c.field === field)));
  }, []);

  // ── Queries ──

  const getUsersOnRecord = useCallback((recordId) => {
    const result = [];
    for (const [, user] of activeUsers) {
      if (user.activeRecordId === recordId) {
        result.push(user);
      }
    }
    return result;
  }, [activeUsers]);

  const onRecordUpdated = useCallback((handler) => {
    recordUpdateHandlers.current.add(handler);
    return () => recordUpdateHandlers.current.delete(handler);
  }, []);

  const value = {
    activeUsers,
    getUsersOnRecord,
    focusRecord,
    blurRecord,
    startTyping,
    stopTyping,
    saveRecord,
    pendingConflicts,
    resolveConflict,
    onRecordUpdated,
    isConnected: socketRef.current?.connected || false,
  };

  return (
    <CollaborationContext.Provider value={value}>
      {children}
    </CollaborationContext.Provider>
  );
}

export function useCollaboration() {
  return useContext(CollaborationContext);
}

export { userColor };
