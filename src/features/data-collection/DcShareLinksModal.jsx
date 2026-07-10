// ─── DcShareLinksModal ───
// Admin surface for creating, listing, and revoking share links for the
// current Data Collection extension. Reads/writes via the DC share-link
// endpoints; the resulting URL is what a lead types into an iPad.

import React, { useEffect, useState } from "react";
import { C, FONT, MONO, RADIUS } from "../../design/tokens.js";
import { useTheme } from "../../context/ThemeContext.jsx";
import { dcListShareLinks, dcCreateShareLink, dcUpdateShareLink, dcShareLinkUrl } from "../../lib/api.js";

export default function DcShareLinksModal({ extension, onClose }) {
  useTheme();
  const [links, setLinks] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [label, setLabel] = useState("");
  const [scopeMarket, setScopeMarket] = useState("");
  const [scopePage, setScopePage] = useState("");
  const [creating, setCreating] = useState(false);
  const [copiedId, setCopiedId] = useState(null);

  const config = extension?.ext_config || {};
  const markets = config.markets || [];
  const pages = config.pages || [];

  const load = async () => {
    try {
      const res = await dcListShareLinks(extension.slug);
      setLinks(res.share_links || []);
      setLoaded(true);
    } catch (err) {
      console.error("[DC] failed to load share links", err);
      setLoaded(true);
    }
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const create = async () => {
    if (creating) return;
    setCreating(true);
    try {
      await dcCreateShareLink(extension.slug, {
        label: label.trim(),
        scope_market: scopeMarket,
        scope_page: scopePage,
      });
      setLabel("");
      setScopeMarket("");
      setScopePage("");
      await load();
    } catch (err) {
      alert("Create failed: " + (err.message || err));
    } finally {
      setCreating(false);
    }
  };

  const revoke = async (id) => {
    if (!window.confirm("Revoke this share link? iPads using it will be unable to submit.")) return;
    try {
      await dcUpdateShareLink(id, { revoke: true });
      await load();
    } catch (err) {
      alert("Revoke failed: " + (err.message || err));
    }
  };

  const copyLink = async (link) => {
    const url = dcShareLinkUrl(extension.slug, link.token);
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(link.id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch {
      window.prompt("Copy this link:", url);
    }
  };

  return (
    <div style={styles.overlay} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={styles.card} role="dialog" aria-modal="true">
        <div style={styles.header}>
          <div>
            <div style={styles.kicker}>Share links</div>
            <h3 style={styles.title}>Anonymous submission URLs</h3>
            <div style={styles.sub}>Give each iPad or lead their own token. Revoke any time.</div>
          </div>
          <button onClick={onClose} style={styles.closeBtn} aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M3.5 3.5l9 9m0-9l-9 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        <div style={styles.body}>
          {/* Create form */}
          <div style={styles.createRow}>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Label · e.g. NY iPad 1"
              style={{ ...styles.input, flex: 2 }}
              autoComplete="off"
            />
            <select value={scopeMarket} onChange={(e) => setScopeMarket(e.target.value)} style={{ ...styles.select, flex: 1 }}>
              <option value="">Any market</option>
              {markets.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
            </select>
            <select value={scopePage} onChange={(e) => setScopePage(e.target.value)} style={{ ...styles.select, flex: 1 }}>
              <option value="">Any page</option>
              {pages.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
            </select>
            <button onClick={create} disabled={creating || !label.trim()} style={{ ...styles.newBtn, opacity: creating || !label.trim() ? 0.5 : 1 }}>
              {creating ? "…" : "+ Create"}
            </button>
          </div>

          <div style={styles.list}>
            {!loaded && <div style={styles.empty}>Loading…</div>}
            {loaded && links.length === 0 && <div style={styles.empty}>No share links yet. Create one above.</div>}
            {links.map((link) => {
              const url = dcShareLinkUrl(extension.slug, link.token);
              const revoked = !!link.revoked_at;
              return (
                <div key={link.id} style={{ ...styles.linkRow, ...(revoked ? styles.linkRowRevoked : {}) }}>
                  <div style={styles.linkMeta}>
                    <div style={styles.linkLabel}>
                      {link.label || "(unlabeled)"}
                      {revoked && <span style={styles.badgeRevoked}>Revoked</span>}
                    </div>
                    <div style={styles.linkScope}>
                      {link.scope_market ? `${link.scope_market} · ` : "Any market · "}
                      {link.scope_page || "any page"}
                      {" · "}
                      <span style={{ fontFamily: MONO }}>{link.submission_count} submitted</span>
                    </div>
                    <div style={styles.linkUrl}>{url}</div>
                  </div>
                  <div style={styles.linkActions}>
                    <button onClick={() => copyLink(link)} style={styles.action}>
                      {copiedId === link.id ? "Copied!" : "Copy"}
                    </button>
                    {!revoked && (
                      <button onClick={() => revoke(link.id)} style={{ ...styles.action, color: C.error }}>
                        Revoke
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function buildStyles() { return {
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.55)",
    backdropFilter: "blur(6px)",
    WebkitBackdropFilter: "blur(6px)",
    zIndex: 650,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  card: {
    background: C.surface,
    border: `1px solid ${C.border}`,
    borderRadius: RADIUS.lg,
    width: "100%",
    maxWidth: 720,
    maxHeight: "90vh",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    fontFamily: FONT,
    boxShadow: "0 8px 32px rgba(0,0,0,0.32)",
  },
  header: {
    padding: "20px 22px 14px",
    borderBottom: `1px solid ${C.edgeLine}`,
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  kicker: {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: "0.14em",
    textTransform: "uppercase",
    color: C.accent,
    marginBottom: 6,
  },
  title: { fontSize: 18, fontWeight: 700, letterSpacing: "-0.01em", color: C.text },
  sub: { fontSize: 12, color: C.textMid, marginTop: 4 },
  closeBtn: {
    width: 32, height: 32,
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    borderRadius: RADIUS.md,
    color: C.textMid,
    background: "transparent",
    border: "none",
    cursor: "pointer",
  },
  body: { padding: 22, overflowY: "auto", flex: 1, display: "flex", flexDirection: "column", gap: 14 },
  createRow: { display: "flex", gap: 8, alignItems: "center" },
  input: {
    background: C.dark,
    border: `1px solid ${C.border}`,
    borderRadius: RADIUS.md,
    color: C.text,
    fontFamily: FONT,
    fontSize: 13,
    padding: "9px 12px",
    outline: "none",
    minHeight: 38,
  },
  select: {
    background: C.dark,
    border: `1px solid ${C.border}`,
    borderRadius: RADIUS.md,
    color: C.text,
    fontFamily: FONT,
    fontSize: 13,
    padding: "9px 12px",
    outline: "none",
    minHeight: 38,
    cursor: "pointer",
  },
  newBtn: {
    padding: "9px 16px",
    background: C.accent,
    color: "#0A1114",
    border: "none",
    borderRadius: RADIUS.pill,
    fontFamily: FONT,
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    minHeight: 38,
    whiteSpace: "nowrap",
  },
  list: { display: "flex", flexDirection: "column", gap: 8 },
  empty: { padding: 40, textAlign: "center", color: C.muted, fontSize: 12, fontStyle: "italic" },
  linkRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 14,
    padding: "12px 14px",
    background: C.dark,
    border: `1px solid ${C.border}`,
    borderRadius: RADIUS.md,
  },
  linkRowRevoked: { opacity: 0.55 },
  linkMeta: { flex: 1, minWidth: 0 },
  linkLabel: {
    fontFamily: FONT,
    fontSize: 14,
    fontWeight: 600,
    color: C.text,
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  badgeRevoked: {
    fontFamily: FONT,
    fontSize: 9,
    fontWeight: 700,
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    color: C.error,
    background: `color-mix(in srgb, ${C.error} 12%, transparent)`,
    padding: "2px 7px",
    borderRadius: RADIUS.pill,
  },
  linkScope: { fontSize: 11, color: C.textMid, marginTop: 3 },
  linkUrl: {
    fontFamily: MONO,
    fontSize: 11,
    color: C.muted,
    marginTop: 4,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  linkActions: { display: "flex", gap: 4 },
  action: {
    padding: "6px 12px",
    background: "transparent",
    color: C.textMid,
    border: `1px solid ${C.border}`,
    borderRadius: RADIUS.md,
    fontFamily: FONT,
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
};
}

const styles = new Proxy({}, { get: (_, k) => buildStyles()[k] });
