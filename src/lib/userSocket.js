// ─── UserSocket ───
// WebSocket client for multi-device sync via UserRoom Durable Object.
// One connection per user session. Handles dashboard sync, nav sync, and session revocation.

import { getConnection, getJwt } from "./api.js";

export default class UserSocket {
  constructor(userId) {
    this.userId = userId;
    this.ws = null;
    this.handlers = new Set();
    this.reconnectTimer = null;
    this.reconnectDelay = 1000;
    this.maxReconnectDelay = 30000;
    this.connected = false;
    this.intentionalClose = false;
    this.idleTimeout = 10 * 60 * 1000; // 10 minutes
    this.idleTimer = null;
    this.idleDisconnected = false;
    this._onActivity = null;
  }

  connect() {
    if (this.ws) return;
    this.intentionalClose = false;

    const conn = getConnection();
    if (!conn?.workerUrl) return;

    const base = conn.workerUrl.replace(/^http/, "ws");
    const jwt = getJwt();
    const params = new URLSearchParams();
    if (jwt) params.set("token", jwt);
    if (conn.secret) params.set("key", conn.secret);

    const wsUrl = `${base}/ws/user/${this.userId}?${params.toString()}`;

    try {
      this.ws = new WebSocket(wsUrl);
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.connected = true;
      this.reconnectDelay = 1000;
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
      } catch (err) { console.warn("[userSocket] JSON parse:", err.message); }
    };

    this.ws.onclose = (event) => {
      this.ws = null;
      this.connected = false;
      // Don't reconnect if session was revoked
      if (event.code === 4001) {
        for (const handler of this.handlers) {
          handler({ type: "session_revoked", sessionIds: ["*"] });
        }
        return;
      }
      if (!this.intentionalClose) {
        this.scheduleReconnect();
      }
    };

    this.ws.onerror = () => {};
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
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ type, ...payload }));
  }

  onMessage(handler) {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  // ── Sync shortcuts ──

  sendDashboardUpdate(widgets) {
    this.send("dashboard_update", { widgets });
  }

  sendNavUpdate(pageId, folderId) {
    this.send("nav_update", { pageId, folderId });
  }
}
