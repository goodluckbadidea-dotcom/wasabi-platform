// ─── Dynamic View Renderer ───
// Reads a page config and mounts the appropriate view components.
// Supports per-view database scoping via viewConfig.config.databaseId.

import React, { Suspense, useState, useEffect, useCallback } from "react";
import { C, RADIUS } from "../design/tokens.js";
import { ErrorBoundary, ViewSkeleton } from "../core/ErrorBoundary.jsx";
import { useLinks } from "../context/LinksContext.jsx";
import { usePlatform } from "../context/PlatformContext.jsx";
import { globalToast } from "../context/ToastContext.jsx";
import { isAdmin } from "../lib/roles.js";
import { assignOptionColor } from "../lib/dataSource.js";
import { getTableSchema, updateTableSchema, updateSubColumnSchema } from "../lib/api.js";
import LinkPicker from "../core/LinkPicker.jsx";
import Table from "./Table.jsx";
import Gantt from "./Gantt.jsx";
import CardGrid from "./CardGrid.jsx";
import Kanban from "./Kanban.jsx";
import Charts from "./Charts.jsx";
import Form from "./Form.jsx";
import SummaryTiles from "./SummaryTiles.jsx";
import ActivityFeed from "./ActivityFeed.jsx";
import Document from "./Document.jsx";
import NotificationFeed from "./NotificationFeed.jsx";
import Calendar from "./Calendar.jsx";
import LinkedSheet from "./LinkedSheet.jsx";
import CustomView from "./CustomView.jsx";

const VIEW_REGISTRY = {
  table: Table,
  gantt: Gantt,
  calendar: Calendar,
  cardGrid: CardGrid,
  kanban: Kanban,
  charts: Charts,
  form: Form,
  summaryTiles: SummaryTiles,
  activityFeed: ActivityFeed,
  document: Document,
  notificationFeed: NotificationFeed,
  linked_sheet: LinkedSheet,
  customView: CustomView,
};

/**
 * Render a single view from a view config.
 * If viewConfig.config.databaseId is set, scopes data and schema to that database.
 */
function ViewBlock({ viewConfig, data, schema, schemas, onUpdate, onRefresh, onCreate, onDelete, pageConfig, onViewConfigChange, initialDetailRecordId, onInitialDetailConsumed, resolvedLinks, removeLink, onLinkField, onUnlinkField, onCreateOption }) {
  const Component = VIEW_REGISTRY[viewConfig.type];

  if (!Component) {
    return (
      <div style={{
        padding: 24,
        background: C.darkSurf,
        borderRadius: RADIUS.xl,
        border: `1px solid ${C.darkBorder}`,
        color: C.darkMuted,
        fontSize: 13,
        textAlign: "center",
      }}>
        View type "{viewConfig.type}" is not recognized.
      </div>
    );
  }

  // Per-view database scoping: filter data and select schema for the target DB
  const scopedDbId = viewConfig.config?.databaseId;
  const viewData = scopedDbId
    ? data.filter((row) => row._databaseId === scopedDbId)
    : data;
  const viewSchema = (scopedDbId && schemas?.[scopedDbId])
    ? schemas[scopedDbId]
    : schema;

  return (
    <Component
      data={viewData}
      schema={viewSchema}
      config={viewConfig.config || {}}
      editable={viewConfig.config?.editable || false}
      onUpdate={onUpdate}
      onRefresh={onRefresh}
      onCreate={onCreate}
      onDelete={onDelete}
      pageConfig={pageConfig}
      onViewConfigChange={onViewConfigChange}
      initialDetailRecordId={initialDetailRecordId}
      onInitialDetailConsumed={onInitialDetailConsumed}
      resolvedLinks={resolvedLinks}
      removeLink={removeLink}
      onLinkField={onLinkField}
      onUnlinkField={onUnlinkField}
      onCreateOption={onCreateOption}
    />
  );
}

/**
 * Render all views for a page in a layout.
 */
// ── Cell links ──
// Links are resolved and stored against view index -1, and that is deliberate.
// Table.jsx derived the index with
//   pageConfig.views.findIndex((v) => v === config)
// which compares view objects against the *inner* `config` object and so never
// matches, yielding -1 every time. Every link in the database carries
// target_view_idx = -1 as a result: cell links are page-wide in practice, not
// per-view. Computing a real index here would resolve nothing and orphan all of
// them, so the historical value is kept until that is migrated deliberately.
const LINK_VIEW_IDX = -1;

export default function ViewRenderer({ views = [], data, schema, schemas, onUpdate, onRefresh, onCreate, onDelete, pageConfig, onViewConfigChange, initialDetailRecordId, onInitialDetailConsumed }) {
  // Owned here rather than in Table so that every view which can open a record
  // — Gantt, Calendar, CardGrid, Kanban — gets the same linking behaviour.
  // Previously only Table passed these to RecordDetail, so opening the same
  // record from a Timelines or Calendar view silently lost the link affordance.
  const { resolveLinksForView, createLink, removeLink } = useLinks();
  const [resolvedLinks, setResolvedLinks] = useState(new Map());
  const [linkPickerCell, setLinkPickerCell] = useState(null); // { pageId, field, fieldType }

  const refreshLinks = useCallback(() => {
    if (!pageConfig?.id) return Promise.resolve();
    return resolveLinksForView(pageConfig.id, LINK_VIEW_IDX)
      .then(setResolvedLinks)
      .catch((err) => console.warn("[ViewRenderer] resolveLinksForView:", err.message || err));
  }, [pageConfig?.id, resolveLinksForView]);

  useEffect(() => { refreshLinks(); }, [refreshLinks]);

  const handleLinkField = useCallback((pageId, fieldName, fieldType) => {
    setLinkPickerCell({ pageId, field: fieldName, fieldType });
  }, []);

  const handleUnlinkField = useCallback((linkId) => {
    removeLink(linkId);
    refreshLinks();
  }, [removeLink, refreshLinks]);

  // ── Creating select/status options from a record ──
  // Also owned here for the same reason as links: this used to live in Table,
  // so opening a record from a gantt, calendar, card or kanban view offered no
  // way to add an option. Adding one is a schema write, which the worker gates
  // behind `owner` — in practice only an admin clears it — so non-admins get a
  // null handler and RecordDetail hides the affordance rather than offering an
  // action guaranteed to 403.
  const { identity } = usePlatform();
  const canManageOptions = isAdmin(identity);

  const handleCreateOption = useCallback(async (page, colName, optionName) => {
    if (!pageConfig?.id || !optionName?.trim()) return;
    const trimmed = optionName.trim();
    const isSubItem = !!page?._parentRowId;
    try {
      const schemaRes = await getTableSchema(pageConfig.id);
      const bucket = isSubItem ? "sub_columns" : "columns";
      const cols = schemaRes?.[bucket] || [];
      const updated = cols.map((c) => {
        if (c.name !== colName) return c;
        const existing = Array.isArray(c.options) ? c.options : [];
        if (existing.some((o) => o.name === trimmed)) return c;
        const newOpt = { name: trimmed, color: assignOptionColor(existing.length) };
        if (c.type === "status") newOpt.category = "not_started";
        return { ...c, options: [...existing, newOpt] };
      });
      if (isSubItem) {
        await updateSubColumnSchema(pageConfig.id, updated);
      } else {
        await updateTableSchema(pageConfig.id, updated);
      }
      onRefresh?.();
    } catch (err) {
      // Surface the failure AND re-throw, so the caller does not commit a cell
      // value whose option was never created (that produced orphan statuses
      // with no matching option, rendering as colourless pills).
      console.error("Create option failed:", err);
      globalToast(
        err?.status === 403
          ? "You don't have permission to add options to this column."
          : `Could not add option: ${err?.message || "unknown error"}`,
        "error"
      );
      throw err;
    }
  }, [pageConfig?.id, onRefresh]);

  const linkProps = {
    resolvedLinks,
    removeLink,
    onLinkField: handleLinkField,
    onUnlinkField: handleUnlinkField,
    onCreateOption: canManageOptions ? handleCreateOption : null,
  };

  const mainViews = views.filter((v) => v.position !== "sidebar" && v.position !== "bottom");
  const sideViews = views.filter((v) => v.position === "sidebar");
  const bottomViews = views.filter((v) => v.position === "bottom");

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: 0 }}>
      {/* Main + Sidebar row */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* Main content */}
        <div style={{
          flex: 1,
          overflowY: "auto",
          padding: 20,
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}>
          {mainViews.map((v, i) => (
            <ErrorBoundary key={`main-${i}`} fallbackLabel={v.label || v.type}>
              <ViewBlock
                viewConfig={v}
                data={data}
                schema={schema}
                schemas={schemas}
                onUpdate={onUpdate}
                onRefresh={onRefresh}
                onCreate={onCreate}
                onDelete={onDelete}
                pageConfig={pageConfig}
                onViewConfigChange={onViewConfigChange}
                {...linkProps}
                {...(i === 0 ? { initialDetailRecordId, onInitialDetailConsumed } : {})}
              />
            </ErrorBoundary>
          ))}

          {mainViews.length === 0 && (
            <div style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flex: 1,
              color: C.darkMuted,
              fontSize: 14,
            }}>
              No views configured for this page.
            </div>
          )}
        </div>

        {/* Sidebar (if any sidebar views) */}
        {sideViews.length > 0 && (
          <div style={{
            width: 360,
            minWidth: 360,
            borderLeft: `1px solid ${C.edgeLine}`,
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
          }}>
            {sideViews.map((v, i) => (
              <ErrorBoundary key={`side-${i}`} fallbackLabel={v.label || v.type}>
                <ViewBlock
                  viewConfig={v}
                  data={data}
                  schema={schema}
                  schemas={schemas}
                  onUpdate={onUpdate}
                  onRefresh={onRefresh}
                  onCreate={onCreate}
                  onDelete={onDelete}
                  pageConfig={pageConfig}
                  {...linkProps}
                />
              </ErrorBoundary>
            ))}
          </div>
        )}
      </div>

      {/* Bottom views */}
      {bottomViews.length > 0 && (
        <div style={{
          borderTop: `1px solid ${C.edgeLine}`,
          padding: 16,
          display: "flex",
          gap: 16,
        }}>
          {bottomViews.map((v, i) => (
            <div key={`bottom-${i}`} style={{ flex: 1 }}>
              <ErrorBoundary fallbackLabel={v.label || v.type}>
                <ViewBlock
                  viewConfig={v}
                  data={data}
                  schema={schema}
                  schemas={schemas}
                  onUpdate={onUpdate}
                  onRefresh={onRefresh}
                  onCreate={onCreate}
                  onDelete={onDelete}
                  pageConfig={pageConfig}
                  {...linkProps}
                />
              </ErrorBoundary>
            </div>
          ))}
        </div>
      )}

      {/* Shared by every view, so linking works the same from a table row, a
          gantt bar, a calendar entry or a card. */}
      {linkPickerCell && (
        <LinkPicker
          targetFieldType={linkPickerCell.fieldType}
          onCancel={() => setLinkPickerCell(null)}
          onSelect={async (selection) => {
            const { sourceRef, sourcePageId, sourceViewIdx, sourceName, sourceFieldType } = selection;
            await createLink({
              name: sourceName,
              sourcePage: sourcePageId,
              sourceView: sourceViewIdx,
              sourceRef,
              targetPage: pageConfig?.id || "",
              targetView: LINK_VIEW_IDX,
              targetRef: { type: "notion", pageId: linkPickerCell.pageId, field: linkPickerCell.field },
              direction: "one_way",
              sourceFieldType: sourceFieldType || "",
              targetFieldType: linkPickerCell.fieldType || "",
            });
            await refreshLinks();
            setLinkPickerCell(null);
          }}
        />
      )}
    </div>
  );
}
