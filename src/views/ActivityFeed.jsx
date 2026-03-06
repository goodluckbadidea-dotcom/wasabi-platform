// ─── Activity Feed View ───
// Recent changes list. Groups by date (Today, Yesterday, This Week, Older).

import React, { useMemo } from "react";
import { C, FONT, RADIUS, getStatusColor } from "../design/tokens.js";
import { readField, getFieldType, getOptionNames, displayValue, resolveField } from "./_viewHelpers.js";
import { formatDate, timeAgo } from "../utils/helpers.js";
import { cellStyles } from "./_CellComponents.jsx";

/**
 * Group items by date bucket.
 */
function dateBucket(dateStr) {
  if (!dateStr) return "Unknown";
  const d = new Date(dateStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - 7);

  if (d >= today) return "Today";
  if (d >= yesterday) return "Yesterday";
  if (d >= weekAgo) return "This Week";
  return "Older";
}

export default function ActivityFeed({ data = [], schema, config = {} }) {
  const titleField = resolveField(schema, config.titleField, ["title"]);
  const showFields = config.showFields || [];

  // Find last_edited_time field name
  const editTimeField = schema?.lastEditedTime?.name || null;
  const editByField = schema?.lastEditedBy?.name || null;

  // Sort by last edited time descending
  const sortedData = useMemo(() => {
    if (!editTimeField) return data;
    return [...data].sort((a, b) => {
      const ta = readField(a, editTimeField) || "";
      const tb = readField(b, editTimeField) || "";
      return tb.localeCompare(ta);
    });
  }, [data, editTimeField]);

  // Group by date bucket
  const groups = useMemo(() => {
    const buckets = { "Today": [], "Yesterday": [], "This Week": [], "Older": [], "Unknown": [] };
    for (const page of sortedData) {
      const editTime = editTimeField ? readField(page, editTimeField) : null;
      const bucket = dateBucket(editTime);
      buckets[bucket].push(page);
    }
    // Return only non-empty buckets in order
    return ["Today", "Yesterday", "This Week", "Older", "Unknown"]
      .filter((b) => buckets[b].length > 0)
      .map((b) => ({ label: b, items: buckets[b] }));
  }, [sortedData, editTimeField]);

  if (!schema) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: C.darkMuted, fontSize: 14, fontFamily: FONT }}>
        Loading schema...
      </div>
    );
  }

  if (!editTimeField) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: C.darkMuted, fontSize: 14, fontFamily: FONT }}>
        No last_edited_time field detected. Activity feed requires a timestamp field.
      </div>
    );
  }

  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      height: "100%",
      fontFamily: FONT,
      overflowY: "auto",
      padding: "16px 24px",
    }}>
      {groups.length === 0 && (
        <div style={{ padding: 40, textAlign: "center", color: C.darkMuted, fontSize: 14 }}>
          No activity found.
        </div>
      )}

      {groups.map((group) => (
        <div key={group.label} style={{ marginBottom: 24 }}>
          {/* Section header */}
          <div style={{
            fontSize: 11,
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            color: C.darkMuted,
            paddingBottom: 8,
            borderBottom: `1px solid ${C.edgeLine}`,
            marginBottom: 8,
          }}>
            {group.label}
          </div>

          {/* Items */}
          {group.items.map((page, idx) => {
            const title = titleField ? readField(page, titleField) : "Untitled";
            const editTime = readField(page, editTimeField);
            const editBy = editByField ? readField(page, editByField) : null;

            return (
              <div
                key={page.id}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 12,
                  padding: "10px 0",
                  borderBottom: `1px solid ${C.edgeLine}`,
                  animation: `fadeUp 0.2s ease ${idx * 0.03}s both`,
                }}
              >
                {/* Green dot */}
                <div style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: C.accent,
                  flexShrink: 0,
                  marginTop: 5,
                }} />

                {/* Content */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: C.darkText,
                    lineHeight: 1.35,
                    marginBottom: 2,
                  }}>
                    {title || "Untitled"}
                  </div>

                  {/* Show fields as pills */}
                  {showFields.length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
                      {showFields.map((fieldName) => {
                        const val = readField(page, fieldName);
                        const type = getFieldType(schema, fieldName);
                        if (val === null || val === undefined) return null;
                        if (type === "select" || type === "status") {
                          const optNames = getOptionNames(schema, fieldName);
                          const color = getStatusColor(val, optNames);
                          return <span key={fieldName} style={cellStyles.pill(color)}>{val}</span>;
                        }
                        return (
                          <span key={fieldName} style={{ fontSize: 11, color: C.darkMuted }}>
                            {displayValue(val, type)}
                          </span>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Timestamp + editor */}
                <div style={{ flexShrink: 0, textAlign: "right" }}>
                  <div style={{ fontSize: 11, color: C.darkMuted }}>
                    {editTime ? timeAgo(editTime) : ""}
                  </div>
                  {editBy && (
                    <div style={{ fontSize: 10, color: C.darkMuted, opacity: 0.7, marginTop: 2 }}>
                      {typeof editBy === "string" ? editBy : editBy.name || ""}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
