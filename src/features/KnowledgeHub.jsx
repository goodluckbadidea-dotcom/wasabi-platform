// ─── Knowledge Hub ───
// Tabbed container for Knowledge Base, Automations, Functions, and Build
// Reuses the exact same components with tabbed navigation.

import React, { useState } from "react";
import { C, FONT, RADIUS } from "../design/tokens.js";
import { ErrorBoundary } from "../core/ErrorBoundary.jsx";

function lazyRetry(fn) {
  return React.lazy(() => fn().catch(() =>
    new Promise(r => setTimeout(r, 200)).then(() => fn().catch(() => { window.location.reload(); return new Promise(() => {}); }))
  ));
}
const KnowledgeBase = lazyRetry(() => import("../core/KnowledgeBase.jsx"));
const AutomationPage = lazyRetry(() => import("../core/AutomationPage.jsx"));
const FunctionsPanel = lazyRetry(() => import("../core/FunctionsPanel.jsx"));
const BuildPage = lazyRetry(() => import("../core/BuildPage.jsx"));

const TABS = [
  { key: "kb", label: "Knowledge Base" },
  { key: "automations", label: "Automations" },
  { key: "functions", label: "Functions" },
  { key: "build", label: "Build" },
];

const FALLBACK = (
  <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: C.darkMuted, fontSize: 14 }}>
    Loading...
  </div>
);

export default function KnowledgeHub({ onOpenChat }) {
  const [activeTab, setActiveTab] = useState("kb");

  return (
    <div style={{
      display: "flex", flexDirection: "column", height: "100%",
      overflow: "hidden", background: C.dark, fontFamily: FONT,
    }}>
      {/* ── Tab bar ── */}
      <div style={{
        display: "flex", gap: 0, flexShrink: 0,
        borderBottom: `1px solid ${C.darkBorder}`,
        padding: "0 24px",
      }}>
        {TABS.map((tab) => {
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              style={{
                padding: "12px 18px", fontSize: 13, fontWeight: isActive ? 600 : 400,
                fontFamily: FONT, color: isActive ? C.darkText : C.darkMuted,
                background: "none", border: "none", cursor: "pointer",
                borderBottom: isActive ? `2px solid ${C.accent}` : "2px solid transparent",
                transition: "all 0.15s", outline: "none",
              }}
              onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.color = C.darkText; }}
              onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.color = C.darkMuted; }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* ── Tab content ── */}
      <div style={{ flex: 1, overflow: "auto" }}>
        <ErrorBoundary fallbackLabel={TABS.find((t) => t.key === activeTab)?.label}>
          <React.Suspense fallback={FALLBACK}>
            {activeTab === "kb" && <KnowledgeBase />}
            {activeTab === "automations" && <AutomationPage onOpenChat={onOpenChat} />}
            {activeTab === "functions" && <FunctionsPanel onOpenChat={onOpenChat} />}
            {activeTab === "build" && <BuildPage onOpenChat={onOpenChat} />}
          </React.Suspense>
        </ErrorBoundary>
      </div>
    </div>
  );
}
