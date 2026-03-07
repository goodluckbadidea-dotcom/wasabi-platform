// ─── Automation Page ───
// Container for automation sub-views: Node Editor, Simple Rules, Upload.
// Renders the active tab based on the activeTab prop from App.jsx viewStates.

import React from "react";
import { C, FONT } from "../design/tokens.js";
import AutomationBuilder from "./AutomationBuilder.jsx";

// Lazy-load NodeEditor (created in Step 7)
const NodeEditor = React.lazy(() => import("./NodeEditor.jsx"));

export default function AutomationPage({ automationEngine, activeTab = 0 }) {
  // Tab 1: Simple Rules (existing AutomationBuilder)
  if (activeTab === 1) {
    return <AutomationBuilder automationEngine={automationEngine} />;
  }

  // Tab 2: Upload (placeholder for now — will wire existing upload UI)
  if (activeTab === 2) {
    return (
      <div style={{
        flex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: FONT,
        color: C.darkMuted,
        fontSize: 14,
        flexDirection: "column",
        gap: 8,
      }}>
        <span style={{ fontSize: 32 }}>📦</span>
        <span>Upload Automations</span>
        <span style={{ fontSize: 12, color: C.darkBorder }}>
          CSV/TSV file upload automation coming soon
        </span>
      </div>
    );
  }

  // Tab 0 (default): Node Editor
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
