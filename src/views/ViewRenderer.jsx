// ─── Dynamic View Renderer ───
// Reads a page config and mounts the appropriate view components.

import React, { Suspense } from "react";
import { C, RADIUS } from "../design/tokens.js";
import { ErrorBoundary, ViewSkeleton } from "../core/ErrorBoundary.jsx";
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
};

/**
 * Render a single view from a view config.
 */
function ViewBlock({ viewConfig, data, schema, onUpdate, onRefresh, onCreate, onDelete, pageConfig }) {
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

  return (
    <Component
      data={data}
      schema={schema}
      config={viewConfig.config || {}}
      onUpdate={onUpdate}
      onRefresh={onRefresh}
      onCreate={onCreate}
      onDelete={onDelete}
      pageConfig={pageConfig}
    />
  );
}

/**
 * Render all views for a page in a layout.
 */
export default function ViewRenderer({ views = [], data, schema, onUpdate, onRefresh, onCreate, onDelete, pageConfig }) {
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
                onUpdate={onUpdate}
                onRefresh={onRefresh}
                onCreate={onCreate}
                onDelete={onDelete}
                pageConfig={pageConfig}
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
                  onUpdate={onUpdate}
                  onRefresh={onRefresh}
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
                  onUpdate={onUpdate}
                  onRefresh={onRefresh}
                />
              </ErrorBoundary>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
