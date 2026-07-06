// ═══════════════════════════════════════════════════════════════════════════════
// UserRoom — Durable Object for multi-device sync
// One instance per user. Manages WebSocket connections across all devices.
// Syncs dashboard layout, navigation state, and session revocation.
// ═══════════════════════════════════════════════════════════════════════════════

export class UserRoom {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);

    // HTTP broadcast endpoint (server-initiated messages, e.g., session revocation)
    if (request.method === "POST" && url.pathname === "/broadcast") {
      return this.handleBroadcast(request);
    }

    // WebSocket upgrade
    const upgrade = request.headers.get("Upgrade");
    if (!upgrade || upgrade.toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    const sessionId = url.searchParams.get("sid") || "";
    const deviceInfo = url.searchParams.get("device") || "unknown";

    // Hibernation API: runtime manages the socket, DO sleeps between messages
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ sessionId, deviceInfo, connectedAt: Date.now() });

    // Send device list to all (including new connection)
    this.broadcastDeviceList();

    return new Response(null, { status: 101, webSocket: client });
  }

  // ── Hibernation handlers (replace addEventListener) ──

  webSocketMessage(ws, message) {
    try {
      const msg = JSON.parse(message);
      this.handleMessage(ws, msg);
    } catch {}
  }

  webSocketClose(ws, code, reason) {
    this.broadcastDeviceList();
  }

  webSocketError(ws, error) {
    // close handler fires after error — cleanup happens there
  }

  handleMessage(sender, msg) {
    switch (msg.type) {
      case "nav_update":
      case "task_cache_invalidate":
        // Relay to all OTHER connections (not sender)
        this.broadcast(msg, sender);
        break;
      case "ping":
        this.sendTo(sender, { type: "pong" });
        break;
    }
  }

  async handleBroadcast(request) {
    try {
      const msg = await request.json();
      if (msg.type === "session_revoked") {
        const revokeAll = msg.sessionIds?.includes("*");
        for (const ws of this.ctx.getWebSockets()) {
          const session = ws.deserializeAttachment();
          if (revokeAll || msg.sessionIds?.includes(session?.sessionId)) {
            this.sendTo(ws, msg);
            try { ws.close(4001, "Session revoked"); } catch {}
          }
        }
      } else {
        for (const ws of this.ctx.getWebSockets()) {
          try { ws.send(JSON.stringify(msg)); } catch {}
        }
      }
    } catch {}
    return new Response("ok");
  }

  broadcast(msg, excludeWs) {
    const data = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === excludeWs) continue;
      try { ws.send(data); } catch {}
    }
  }

  sendTo(ws, msg) {
    try { ws.send(JSON.stringify(msg)); } catch {}
  }

  broadcastDeviceList() {
    const allWs = this.ctx.getWebSockets();
    const devices = [];
    for (const ws of allWs) {
      const session = ws.deserializeAttachment();
      if (session) {
        devices.push({
          sessionId: session.sessionId,
          deviceInfo: session.deviceInfo,
          connectedAt: session.connectedAt,
        });
      }
    }
    const data = JSON.stringify({ type: "devices", devices });
    for (const ws of allWs) {
      try { ws.send(data); } catch {}
    }
  }
}
