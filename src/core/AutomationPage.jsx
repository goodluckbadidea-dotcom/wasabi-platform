// ─── Automation Page ───
// Node Editor for visual automation building.

import React from "react";
import { C, FONT } from "../design/tokens.js";

const NodeEditor = React.lazy(() => import("./NodeEditor.jsx"));

export default function AutomationPage({ automationEngine }) {
  return (
    <React.Suspense
      fallback={
        <div style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: FONT,
          color: C.darkMuted,
          fontSize: 14,
        }}>
          Loading Node Editor...
        </div>
      }
    >
      <NodeEditor automationEngine={automationEngine} />
    </React.Suspense>
  );
}
