// ─── TableSocket ───
// WebSocket client for real-time collaboration via TableRoom Durable Object.
// One connection per table. Handles join, presence, typing, and saves.

import { getWorkerUrl, getJwt, isTokenExpiringSoon, refreshAccessToken } from "./api.js";

const USER_COLORS = ["#FF6B6B", "#4ECDC4", "#45B7D1", "#96CEB4", "#FFEAA7", "#DDA0DD", "#98D8C8", "#F7DC6F"];

export function userColor(userId) {
  if (!userId) return USER_COLORS[0];
  let hash = 0;
  for (const ch of userId) hash = ((hash << 5) - hash + ch.charCodeAt(0)) | 0;
  return USER_COLORS[Math.abs(hash) % USER_COLORS.length];
}

export default class TableSocket {
  constructor(tableId, userId, userName, role) {
    this.tableId = tableId;
    this.userId = userId;
    this.userName = userName;
    this.role = role;
    this.color = userColor(userId);
    this.ws = null;
    this.handlers = new Set();
    this.reconnectTimer = null;
    this.reconnectDelay = 1000;
    this.maxReconnectDelay = 30000;
    this.connected = false;
    this.intentionalClose = false;
    this.statusHandlers = new Set();
    this.idleTimeout = 5 * 60 * 1000; // 5 minutes
    this.idleTimer = null;
    this.idleDisconnected = false;
    this._onActivity = null;
    this._lastFocusRecordId = null;
    this._lastTypingField = null;
  }

  connect() {
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) return;
    this.intentionalClose = false;

    const workerUrl = getWorkerUrl();
    if (!workerUrl) return;

    // Refresh JWT if expired or expiring soon before connecting
    const jwt = getJwt();
    if (jwt && isTokenExpiringSoon(jwt)) {
      refreshAccessToken().then(() => this.connect()).catch(() => {});
      return;
    }

    // Build WS URL — convert https:// to wss:// (or http to ws)
    const base = workerUrl.replace(/^http/, "ws");
    const params = new URLSearchParams();
    if (jwt) params.set("token", jwt);

    const wsUrl = `${base}/ws/table/${this.tableId}?${params.toString()}`;

    try {
      this.ws = new WebSocket(wsUrl);
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.connected = true;
      this.reconnectDelay = 1000;
      for (const h of this.statusHandlers) { try { h(true); } catch (_) {} }
      // Send join message
      this.send("join", {
        userId: this.userId,
        userName: this.userName,
        role: this.role,
        color: this.color,
      });
      // Restore presence state after reconnect (e.g. idle disconnect → resume)
      if (this._lastFocusRecordId) {
        this.send("focus", { recordId: this._lastFocusRecordId });
      }
      if (this._lastTypingField && this._lastFocusRecordId) {
        this.send("typing", { recordId: this._lastFocusRecordId, field: this._lastTypingField });
      }
      // Start or reset idle tracking
      if (!this._onActivity) {
        this._startIdleTracking();
      } else {
        this._resetIdleTimer();
      }
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        for (const handler of this.handlers) {
          handler(msg);
        }
      } catch (err) { console.warn("[WS] message handler error:", err); }
    };

    this.ws.onclose = () => {
      this.ws = null;
      this.connected = false;
      for (const h of this.statusHandlers) { try { h(false); } catch (_) {} }
      if (!this.intentionalClose) {
        this.scheduleReconnect();
      }
    };

    this.ws.onerror = () => {
      // onclose will fire after onerror
    };
  }

  disconnect() {
    if (!this.idleDisconnected) {
      this.intentionalClose = true;
      this._stopIdleTracking();
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
  }

  scheduleReconnect() {
    if (this.intentionalClose) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
  }

  // ── Idle disconnect (reduces DO duration when user is away) ──

  _startIdleTracking() {
    const events = ["mousemove", "mousedown", "keydown", "touchstart", "scroll"];
    this._onActivity = () => {
      this._resetIdleTimer();
      if (this.idleDisconnected) {
        this.idleDisconnected = false;
        this.connect();
      }
    };
    events.forEach(e => document.addEventListener(e, this._onActivity, { passive: true }));
    this._resetIdleTimer();
  }

  _stopIdleTracking() {
    if (this._onActivity) {
      const events = ["mousemove", "mousedown", "keydown", "touchstart", "scroll"];
      events.forEach(e => document.removeEventListener(e, this._onActivity));
      this._onActivity = null;
    }
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  _resetIdleTimer() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.idleDisconnected = true;
      this.disconnect();
    }, this.idleTimeout);
  }

  send(type, payload) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify({ type, ...payload }));
    return true;
  }

  onMessage(handler) {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  onStatusChange(handler) {
    this.statusHandlers.add(handler);
    return () => this.statusHandlers.delete(handler);
  }

  // ── Presence shortcuts ──

  focusRecord(recordId) {
    this._lastFocusRecordId = recordId;
    this.send("focus", { recordId });
  }

  blurRecord() {
    this._lastFocusRecordId = null;
    this._lastTypingField = null;
    this.send("blur", {});
  }

  startTyping(recordId, field) {
    this._lastTypingField = field;
    this.send("typing", { recordId, field });
  }

  stopTyping() {
    this._lastTypingField = null;
    this.send("stop_typing", {});
  }

  // ── Save with conflict detection (routed through DO) ──

  saveRecord(recordId, cells, baseVersions) {
    return this.send("save", { recordId, cells, base_versions: baseVersions });
  }
}
