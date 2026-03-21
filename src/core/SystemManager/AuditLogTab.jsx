import React, { useState, useCallback, useEffect } from "react";
import { C, FONT, MONO, RADIUS } from "../../design/tokens.js";
import { ANIM } from "../../design/animations.js";
import { S } from "../../design/styles.js";
import * as api from "../../lib/api.js";

export default function AuditLogTab() {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionFilter, setActionFilter] = useState("");
  const [resourceFilter, setResourceFilter] = useState("");
  const [offset, setOffset] = useState(0);
  const LIMIT = 50;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { limit: LIMIT, offset };
      if (actionFilter) params.action = actionFilter;
      if (resourceFilter) params.resource_type = resourceFilter;
      const res = await api.getAuditLog(params);
      setEntries(res.entries || []);
    } catch (err) {
      console.warn("[SystemManager] Audit log fetch:", err.message || err);
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [actionFilter, resourceFilter, offset]);

  useEffect(() => { load(); }, [load]);

  const ACTION_COLORS = {
    create: C.success,
    update: "#FF9800",
    delete: "#F44336",
    login: "#2196F3",
    set_pin: "#9C27B0",
    verify_pin: "#00BCD4",
    grant_permission: "#8BC34A",
    revoke_permission: "#FF5722",
    factory_reset: "#F44336",
  };

  const selectStyle = {
    background: C.dark,
    border: `1px solid ${C.darkBorder}`,
    color: C.darkText,
    padding: "5px 8px",
    fontSize: 11,
    borderRadius: RADIUS.sm,
    cursor: "pointer",
    fontFamily: FONT,
  };

  return (
    <div style={{ padding: "16px 0" }}>
      {/* Filters */}
      <div style={{ display: "flex", gap: 10, marginBottom: 14, alignItems: "center" }}>
        <select value={actionFilter} onChange={(e) => { setActionFilter(e.target.value); setOffset(0); }} style={selectStyle}>
          <option value="">All actions</option>
          {["create", "update", "delete", "login", "set_pin", "verify_pin", "grant_permission", "revoke_permission", "factory_reset"].map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
        <select value={resourceFilter} onChange={(e) => { setResourceFilter(e.target.value); setOffset(0); }} style={selectStyle}>
          <option value="">All resources</option>
          {["user", "page", "row", "permission", "pin", "system"].map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
        <button onClick={load} style={{ ...S.btnGhost, fontSize: 11, padding: "5px 10px" }}>
          Refresh
        </button>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: C.darkMuted }}>
          {entries.length} entries
        </span>
      </div>

      {loading ? (
        <div style={{ textAlign: "center", color: C.darkMuted, padding: 40, fontSize: 13 }}>Loading...</div>
      ) : entries.length === 0 ? (
        <div style={{ textAlign: "center", color: C.darkMuted, padding: 40, fontSize: 13 }}>No audit entries found.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {entries.map((e) => {
            const color = ACTION_COLORS[e.action] || C.darkMuted;
            let details = {};
            try { details = JSON.parse(e.details || "{}"); } catch (err) { console.warn("[SystemManager] JSON parse:", err.message); }
            const ts = e.created_at ? new Date(e.created_at + "Z").toLocaleString() : "";
            return (
              <div key={e.id} style={{
                display: "grid",
                gridTemplateColumns: "140px 90px 80px 1fr",
                gap: 10,
                padding: "8px 10px",
                fontSize: 11,
                fontFamily: MONO,
                background: C.dark,
                borderRadius: RADIUS.sm,
                border: `1px solid ${C.darkBorder}`,
                alignItems: "center",
              }}>
                <span style={{ color: C.darkMuted }}>{ts}</span>
                <span style={{
                  color,
                  fontWeight: 600,
                  padding: "2px 6px",
                  borderRadius: RADIUS.sm,
                  background: `${color}18`,
                  textAlign: "center",
                  fontSize: 10,
                }}>
                  {e.action}
                </span>
                <span style={{ color: C.darkText }}>
                  {e.resource_type}{e.resource_id ? `:${e.resource_id.slice(0, 8)}` : ""}
                </span>
                <span style={{ color: C.darkMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {e.user_name || e.user_id?.slice(0, 8) || "system"}
                  {Object.keys(details).length > 0 && ` — ${JSON.stringify(details).slice(0, 80)}`}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 14 }}>
        <button
          disabled={offset === 0}
          onClick={() => setOffset(Math.max(0, offset - LIMIT))}
          style={{ ...S.btnGhost, fontSize: 11, padding: "5px 12px", opacity: offset === 0 ? 0.4 : 1 }}
        >
          Prev
        </button>
        <button
          disabled={entries.length < LIMIT}
          onClick={() => setOffset(offset + LIMIT)}
          style={{ ...S.btnGhost, fontSize: 11, padding: "5px 12px", opacity: entries.length < LIMIT ? 0.4 : 1 }}
        >
          Next
        </button>
      </div>
    </div>
  );
}
