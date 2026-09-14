// ─── Extension Viewer ───
// Renders a snapshot (generated extension report) inside Wasabi.
// Fetches the rendered HTML via the authed API client, drops it into a
// sandboxed iframe via srcDoc, and (if the extension's theme_preference
// is "inherit") posts the current Wasabi theme tokens to the iframe so
// the template can re-apply them via CSS variables.
//
// Loaded as a top-level "right pane" via App.jsx routing when the user
// drills into a Reports DB row's snapshot.
//
// Open-record bridge: the sandboxed report can ask the host to open a
// workspace record by posting { type: "wasabi:open-record", pageId, recordId }.
// The viewer loads that table and shows the standard RecordDetail drawer over
// the report; edits save through the same updateRecord path table views use,
// and each saved field is echoed back as { type: "wasabi:record-saved",
// recordId } so the report can mark its (frozen) tile as edited.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { C, FONT } from "../design/tokens.js";
import {
  getExtension, getSnapshot, fetchSnapshotHtml, publishSnapshot,
  getSnapshotHtmlUrl,
} from "../lib/api.js";
import { useTheme } from "../context/ThemeContext.jsx";
import { usePlatform } from "../context/PlatformContext.jsx";
import { fetchDataSource, updateRecord } from "../lib/dataSource.js";
import { getPinToken } from "../components/PinLockOverlay.jsx";
import { getPageTitle } from "../notion/properties.js";
import RecordDetail from "../views/RecordDetail.jsx";
import PanelHeader from "../core/PanelHeader.jsx";
import { IconChevronLeft, IconLink, IconCheck, IconRefresh, IconWarning } from "../design/icons.jsx";

export default function ExtensionViewer({ snapshotId, onBack }) {
  const themeCtx = useTheme();
  const [snapshot, setSnapshot] = useState(null);
  const [extension, setExtension] = useState(null);
  const [html, setHtml] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [publishing, setPublishing] = useState(false);
  const iframeRef = useRef(null);
  const { user, pages } = usePlatform();
  // Record opened from the report: { pageConfig, schema, data, recordId }
  const [drawer, setDrawer] = useState(null);
  const [drawerNotice, setDrawerNotice] = useState(null);

  // Load snapshot metadata + rendered HTML in parallel
  useEffect(() => {
    if (!snapshotId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setHtml(null);
    (async () => {
      try {
        const snap = await getSnapshot(snapshotId);
        if (cancelled) return;
        setSnapshot(snap);

        // Fetch the extension (for slug + theme_preference + name)
        const ext = await getExtension(snap.extension_id).catch(() => null);
        if (cancelled) return;
        setExtension(ext);

        // Fetch the rendered HTML body using the extension slug (URL key) +
        // the snapshot slug. We use the auth-aware text fetcher.
        if (ext?.slug && snap?.slug) {
          const text = await fetchSnapshotHtml(ext.slug, snap.slug);
          if (cancelled) return;
          setHtml(text);
        } else {
          throw new Error("Snapshot or extension slug missing");
        }
      } catch (err) {
        if (!cancelled) setError(err.message || String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [snapshotId]);

  // After the iframe loads, post the current Wasabi theme tokens so the
  // template can listen and re-apply them. Only fired when the extension
  // opted in via theme_preference === "inherit".
  useEffect(() => {
    if (!html || !iframeRef.current || extension?.theme_preference !== "inherit") return;
    const iframe = iframeRef.current;
    const post = () => {
      try {
        iframe.contentWindow?.postMessage({
          type: "wasabi:theme",
          tokens: {
            bg: C.bg, surface: C.surface, raised: C.surfaceAlt,
            border: C.border, text: C.text, textMid: C.textMid,
            muted: C.muted, accent: C.accent,
          },
          mode: themeCtx?.themeMode || "dark",
        }, "*");
      } catch { /* iframe gone */ }
    };
    // First post on load
    iframe.addEventListener("load", post);
    // And immediately in case the iframe is already loaded by the time
    // this effect runs (srcDoc loads can fire synchronously in some browsers).
    post();
    return () => iframe.removeEventListener("load", post);
  }, [html, extension, themeCtx]);

  const loadRecordSource = useCallback(async (pageId) => {
    const pageConfig = (pages || []).find((p) => p.id === pageId);
    if (!pageConfig) throw new Error("That table isn't available in this workspace.");
    const { data, schema } = await fetchDataSource(pageConfig, user);
    return { pageConfig, schema, data: data || [] };
  }, [pages, user]);

  const openRecord = useCallback(async (pageId, recordId) => {
    setDrawerNotice("Opening record…");
    try {
      const src = await loadRecordSource(pageId);
      if (!src.data.some((r) => r.id === recordId)) throw new Error("That record no longer exists in the table.");
      setDrawer({ ...src, recordId });
      setDrawerNotice(null);
    } catch (err) {
      setDrawerNotice(`Couldn't open record: ${err.message || err}`);
    }
  }, [loadRecordSource]);

  // Only messages from this viewer's own iframe are honoured. The sandboxed
  // iframe has an opaque ("null") origin, so match on source, not origin.
  useEffect(() => {
    const onMessage = (e) => {
      const frame = iframeRef.current;
      if (!frame || e.source !== frame.contentWindow) return;
      const msg = e.data;
      if (!msg || msg.type !== "wasabi:open-record") return;
      if (typeof msg.pageId !== "string" || typeof msg.recordId !== "string") return;
      openRecord(msg.pageId, msg.recordId);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [openRecord]);

  // Errors are left to throw so RecordDetail's own save alert reports them.
  const handleDrawerUpdate = useCallback(async (id, fieldName, payload) => {
    if (!drawer || !payload) return;
    const rec = drawer.data.find((r) => r.id === id);
    const isSubItem = rec ? !!rec._parentRowId : id !== drawer.recordId;
    await updateRecord(drawer.pageConfig, id, fieldName, payload, user, null, {
      pinToken: getPinToken(drawer.pageConfig.id), isSubItem,
    });
    setDrawer((d) => d && {
      ...d,
      data: d.data.map((p) => p.id !== id ? p : {
        ...p,
        properties: { ...p.properties, [fieldName]: { ...p.properties[fieldName], ...payload } },
      }),
    });
    try {
      iframeRef.current?.contentWindow?.postMessage({ type: "wasabi:record-saved", recordId: id }, "*");
    } catch { /* iframe gone */ }
  }, [drawer, user]);

  const refreshDrawer = useCallback(async () => {
    if (!drawer) return;
    try {
      const src = await loadRecordSource(drawer.pageConfig.id);
      setDrawer((d) => d && { ...d, ...src });
    } catch { /* keep showing what we have */ }
  }, [drawer, loadRecordSource]);

  const drawerRecord = drawer ? drawer.data.find((r) => r.id === drawer.recordId) : null;
  const drawerParent = drawerRecord?._parentRowId ? drawer.data.find((r) => r.id === drawerRecord._parentRowId) : null;

  // Publish action — promotes Draft → Published (Reports row updates too)
  const handlePublish = async () => {
    if (!snapshot || publishing) return;
    setPublishing(true);
    try {
      await publishSnapshot(snapshot.id);
      // Re-fetch metadata to reflect status
      const fresh = await getSnapshot(snapshot.id);
      setSnapshot(fresh);
    } catch (err) {
      setError(`Publish failed: ${err.message || err}`);
    } finally {
      setPublishing(false);
    }
  };

  const externalUrl = useMemo(() => {
    if (!extension?.slug || !snapshot?.slug) return null;
    return getSnapshotHtmlUrl(extension.slug, snapshot.slug);
  }, [extension, snapshot]);

  const status = snapshot?.status || "";
  const visibility = snapshot?.visibility || "workspace";

  return (
    <div style={{
      display: "flex", flexDirection: "column", height: "100%",
      overflow: "hidden", background: "transparent", fontFamily: FONT,
    }}>
      <PanelHeader
        side="right"
        icon={
          <button
            onClick={onBack}
            title="Back to Reports"
            aria-label="Back to Reports"
            style={{
              background: "transparent", border: "none", padding: 4,
              cursor: "pointer", display: "flex", alignItems: "center", color: C.text,
            }}
          >
            <IconChevronLeft size={18} color={C.text} />
          </button>
        }
        customTitle={
          <div style={{ display: "flex", flexDirection: "column", minWidth: 0, lineHeight: 1.15 }}>
            <span style={{
              fontWeight: 600, fontSize: 16, color: C.text,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {snapshot?.title || (loading ? "Loading report…" : "Report")}
            </span>
            {extension?.name && (
              <span style={{
                fontWeight: 400, fontSize: 11, color: C.muted,
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>
                {extension.name}{visibility === "public" ? "  •  Public" : ""}
              </span>
            )}
          </div>
        }
      >
        {status === "draft" && (
          <button
            onClick={handlePublish}
            disabled={publishing || loading}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              background: C.accent, color: C.bg, fontFamily: FONT,
              fontSize: 12, fontWeight: 600,
              padding: "6px 12px", borderRadius: 6, border: "none",
              cursor: publishing ? "wait" : "pointer", opacity: publishing ? 0.6 : 1,
              marginRight: 4,
            }}
          >
            <IconCheck size={12} color={C.bg} />
            {publishing ? "Publishing…" : "Publish"}
          </button>
        )}
        {status === "published" && (
          <span style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            fontSize: 11, fontWeight: 600, color: C.success,
            padding: "4px 10px", borderRadius: 999,
            background: C.successDim, border: `1px solid ${C.success}`,
            marginRight: 4,
          }}>
            <IconCheck size={10} color={C.success} /> Published
          </span>
        )}
        {externalUrl && (
          <a
            href={externalUrl}
            target="_blank"
            rel="noopener noreferrer"
            title="Open in new tab"
            aria-label="Open in new tab"
            style={{
              display: "inline-flex", alignItems: "center", padding: 6,
              borderRadius: 6, color: C.textMid, textDecoration: "none",
            }}
          >
            <IconLink size={14} color={C.textMid} />
          </a>
        )}
      </PanelHeader>

      <div style={{ flex: 1, overflow: "hidden", position: "relative", background: C.bg }}>
        {loading && (
          <div style={{
            position: "absolute", inset: 0, display: "flex",
            alignItems: "center", justifyContent: "center",
            color: C.muted, fontSize: 13, fontFamily: FONT,
          }}>
            <IconRefresh size={14} color={C.muted} />
            <span style={{ marginLeft: 8 }}>Loading report…</span>
          </div>
        )}

        {error && !loading && (
          <div style={{
            position: "absolute", inset: 0, display: "flex",
            flexDirection: "column", alignItems: "center", justifyContent: "center",
            color: C.error, fontSize: 13, fontFamily: FONT, gap: 8, padding: 24,
          }}>
            <IconWarning size={20} color={C.error} />
            <div style={{ fontWeight: 600 }}>Couldn't load this report</div>
            <div style={{ color: C.muted, fontSize: 12, textAlign: "center", maxWidth: 480 }}>
              {error}
            </div>
          </div>
        )}

        {html && !loading && !error && (
          <iframe
            ref={iframeRef}
            title={snapshot?.title || "Report"}
            srcDoc={html}
            // allow-scripts so the template's JS runs; no allow-same-origin so
            // it can't read the parent's storage/cookies. Theme handshake is
            // via postMessage which works across origins. allow-modals +
            // allow-downloads let report templates open the print dialog
            // (save-as-PDF) and download generated files (order CSVs) —
            // added 2026-09-01 for the Inventory and Production Planner's
            // order builder.
            sandbox="allow-scripts allow-popups allow-modals allow-downloads"
            style={{
              width: "100%", height: "100%", border: "none",
              background: "transparent", display: "block",
            }}
          />
        )}

        {drawerNotice && (
          <div
            role="status"
            onClick={() => setDrawerNotice(null)}
            style={{
              position: "absolute", left: "50%", bottom: 16, transform: "translateX(-50%)",
              background: C.surface, color: C.text, border: `1px solid ${C.border}`,
              borderRadius: 8, padding: "8px 14px", fontSize: 12, fontFamily: FONT,
              boxShadow: "0 6px 20px rgba(0,0,0,0.2)", cursor: "pointer", maxWidth: "80%",
            }}
          >
            {drawerNotice}
          </div>
        )}
      </div>

      {drawerRecord && (
        <RecordDetail
          page={drawerRecord}
          schema={drawerRecord._parentRowId && drawer.schema?._subSchema ? drawer.schema._subSchema : drawer.schema}
          pageConfigId={drawer.pageConfig.id}
          parentTitle={drawerParent ? getPageTitle(drawerParent) : undefined}
          onUpdate={handleDrawerUpdate}
          onRefresh={refreshDrawer}
          onClose={() => setDrawer(null)}
        />
      )}
    </div>
  );
}
