// ═══════════════════════════════════════════════════════════════════════════════
// TableRoom — Durable Object for real-time collaboration
// One instance per table. Manages WebSocket connections, presence, and change broadcasting.
// ═══════════════════════════════════════════════════════════════════════════════

export class TableRoom {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.tableId = null; // Set from URL on first fetch
  }

  async fetch(request) {
    const url = new URL(request.url);

    // Extract tableId from URL path
    const pathMatch = url.pathname.match(/\/ws\/table\/(.+)$/);
    if (pathMatch && !this.tableId) this.tableId = pathMatch[1];

    const upgrade = request.headers.get("Upgrade");
    if (!upgrade || upgrade.toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // Hibernation API: runtime manages the socket, DO sleeps between messages
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({
      userId: null, userName: null, role: null, color: null,
      activeRecordId: null, isTyping: false, typingField: null,
    });

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
    const session = ws.deserializeAttachment();
    if (session?.userId) {
      this.broadcast({ type: "user_left", userId: session.userId }, ws);
      this.broadcastPresence();
    }
  }

  webSocketError(ws, error) {
    // close handler fires after error — cleanup happens there
  }

  handleMessage(ws, msg) {
    const session = ws.deserializeAttachment();
    if (!session) return;

    switch (msg.type) {
      case "join": {
        session.userId = msg.userId;
        session.userName = msg.userName;
        session.role = msg.role;
        session.color = msg.color;
        ws.serializeAttachment(session);
        this.broadcast({ type: "user_joined", userId: msg.userId, userName: msg.userName, color: msg.color }, ws);
        this.broadcastPresence();
        break;
      }

      case "focus": {
        session.activeRecordId = msg.recordId;
        ws.serializeAttachment(session);
        this.broadcast({ type: "user_focus", userId: session.userId, recordId: msg.recordId }, ws);
        break;
      }

      case "blur": {
        session.activeRecordId = null;
        session.isTyping = false;
        session.typingField = null;
        ws.serializeAttachment(session);
        this.broadcast({ type: "user_blur", userId: session.userId }, ws);
        break;
      }

      case "typing": {
        session.isTyping = true;
        session.typingField = msg.field;
        session.typingAt = Date.now();
        session.activeRecordId = msg.recordId || session.activeRecordId;
        ws.serializeAttachment(session);
        this.broadcast({ type: "user_typing", userId: session.userId, recordId: session.activeRecordId, field: msg.field }, ws);
        break;
      }

      case "stop_typing": {
        session.isTyping = false;
        session.typingField = null;
        ws.serializeAttachment(session);
        this.broadcast({ type: "user_stop_typing", userId: session.userId }, ws);
        break;
      }

      case "save": {
        // Route save through DO for conflict detection + broadcast
        this.handleSave(ws, session, msg);
        break;
      }
    }
  }

  async handleSave(ws, session, msg) {
    const { recordId, cells, base_versions } = msg;
    const tableId = this.tableId;

    try {
      // Read current row from D1
      const existing = await this.env.DB.prepare(
        "SELECT cells, cell_versions FROM table_rows WHERE id = ? AND table_id = ?"
      ).bind(recordId, tableId).first();

      if (!existing) {
        this.sendTo(ws, { type: "save_error", recordId, error: "Row not found" });
        return;
      }

      const currentCells = JSON.parse(existing.cells || "{}");
      const currentVersions = JSON.parse(existing.cell_versions || "{}");
      const baseVersions = base_versions || {};

      const accepted = {};
      const conflicts = {};
      const newVersions = { ...currentVersions };

      for (const [field, value] of Object.entries(cells || {})) {
        const currentV = currentVersions[field] || 0;
        const baseV = baseVersions[field];

        if (baseV === undefined || baseV >= currentV) {
          accepted[field] = value;
          newVersions[field] = currentV + 1;
        } else {
          conflicts[field] = {
            yourValue: value,
            currentValue: currentCells[field],
            currentVersion: currentV,
          };
        }
      }

      // Write accepted fields to D1
      if (Object.keys(accepted).length > 0) {
        const mergedCells = { ...currentCells, ...accepted };
        await this.env.DB.prepare(
          `UPDATE table_rows SET cells = ?, cell_versions = ?, updated_at = datetime('now'), updated_by = ?, sync_dirty = 1
           WHERE id = ? AND table_id = ?`
        ).bind(JSON.stringify(mergedCells), JSON.stringify(newVersions), session.userId, recordId, tableId).run();

        // Broadcast accepted changes to all OTHER clients
        this.broadcast({
          type: "record_updated",
          recordId,
          cells: accepted,
          cell_versions: newVersions,
          updatedBy: session.userId,
          updatedByName: session.userName,
        }, ws);
      }

      // Send result back to the saving client
      this.sendTo(ws, {
        type: "save_result",
        recordId,
        accepted,
        conflicts: Object.keys(conflicts).length ? conflicts : undefined,
        cell_versions: newVersions,
      });

      // Send conflict messages for conflicted fields
      if (Object.keys(conflicts).length > 0) {
        for (const [field, info] of Object.entries(conflicts)) {
          this.sendTo(ws, {
            type: "conflict",
            recordId,
            field,
            yourValue: info.yourValue,
            theirValue: info.currentValue,
            currentVersion: info.currentVersion,
          });
        }
      }
    } catch (err) {
      this.sendTo(ws, { type: "save_error", recordId, error: err.message });
    }
  }

  broadcast(msg, excludeWs) {
    const data = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === excludeWs) continue;
      const session = ws.deserializeAttachment();
      if (!session?.userId) continue; // Skip unjoined connections
      try { ws.send(data); } catch {}
    }
  }

  sendTo(ws, msg) {
    try { ws.send(JSON.stringify(msg)); } catch {}
  }

  broadcastPresence() {
    const allWs = this.ctx.getWebSockets();
    const userMap = new Map(); // userId → best session data (dedup multiple tabs)
    const joinedSockets = [];

    for (const ws of allWs) {
      const session = ws.deserializeAttachment();
      if (!session?.userId) continue;
      joinedSockets.push(ws);

      const existing = userMap.get(session.userId);
      if (!existing) {
        userMap.set(session.userId, { ...session });
      } else {
        // Merge: prefer typing > focused > idle
        if (session.isTyping && !existing.isTyping) {
          userMap.set(session.userId, { ...session });
        } else if (session.activeRecordId && !existing.activeRecordId) {
          userMap.set(session.userId, { ...session });
        }
      }
    }

    const TYPING_TTL = 30000; // 30s — auto-expire stale typing indicators
    const users = [...userMap.values()].map((s) => {
      const typingExpired = s.isTyping && s.typingAt && (Date.now() - s.typingAt > TYPING_TTL);
      return {
        userId: s.userId,
        userName: s.userName,
        color: s.color,
        activeRecordId: s.activeRecordId,
        isTyping: s.isTyping && !typingExpired,
        typingField: typingExpired ? null : s.typingField,
      };
    });

    const data = JSON.stringify({ type: "presence", users });
    for (const ws of joinedSockets) {
      try { ws.send(data); } catch {}
    }
  }
}
