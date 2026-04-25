// ─── Depends-On Cell ───
// Table cell renderer for the "Depends on" column type. The cell stores
// nothing — its content is a view of the relationships table. We read
// outgoing depends_on edges for this record and display the upstream task
// names as compact pills. The cell is read-only; clicking the row opens
// RecordDetail with the Dependencies tab pre-selected, where the picker
// for adding/removing edges lives (built in Phase 3 Step A).

import React, { useEffect, useState } from "react";
import { C, RADIUS } from "../../design/tokens.js";
import { useRelationships } from "../../context/RelationshipsContext.jsx";

const MAX_PILLS = 3;

export default function DependsOnCell({ recordId, recordTitlesById }) {
  const { loadForEntity, cacheVersion } = useRelationships();
  const [edges, setEdges] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!recordId) return undefined;
    setLoading(true);
    loadForEntity("record", recordId, {
      types: ["depends_on"],
      direction: "outgoing",
    })
      .then((items) => { if (!cancelled) setEdges(items); })
      .catch((err) => { if (!cancelled) console.warn("[DependsOnCell] load:", err.message || err); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // cacheVersion bumps after any create/delete edge so cells re-pull.
  }, [recordId, loadForEntity, cacheVersion]);

  if (loading && edges.length === 0) {
    return <span style={{ fontSize: 12, color: C.darkMuted, fontStyle: "italic" }}>--</span>;
  }
  if (edges.length === 0) {
    return <span style={{ fontSize: 12, color: C.darkMuted, fontStyle: "italic" }}>--</span>;
  }

  const visible = edges.slice(0, MAX_PILLS);
  const overflow = Math.max(0, edges.length - visible.length);

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
      {visible.map((edge) => {
        const targetId = edge.target_id;
        const title = (recordTitlesById && recordTitlesById[targetId])
          || (typeof targetId === "string" ? targetId.slice(0, 8) : "Untitled");
        return (
          <span
            key={edge.id}
            title={title}
            style={{
              display: "inline-block",
              padding: "2px 8px",
              borderRadius: RADIUS.pill,
              background: C.accent + "15",
              color: C.accent,
              fontSize: 11,
              fontWeight: 500,
              whiteSpace: "nowrap",
              maxWidth: 180,
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {title}
          </span>
        );
      })}
      {overflow > 0 && (
        <span
          title={`${overflow} more`}
          style={{
            fontSize: 11,
            color: C.darkMuted,
            fontWeight: 500,
            whiteSpace: "nowrap",
          }}
        >
          +{overflow}
        </span>
      )}
    </div>
  );
}
