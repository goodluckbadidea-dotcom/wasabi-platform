// ─── Wasabi Platform App Shell ───
// Root component: auth gate → layout → routing.
// Layout: TopHeader + [WasabiPanel | Sidebar | Content]
// Matches original app: top header with page dropdown, left sidebar with sub-nav,
// collapsible Wasabi panel (Log/Chat/Notifications), flame at sidebar bottom.

import React, { useState, useCallback } from "react";
import { PlatformProvider, usePlatform } from "./context/PlatformContext.jsx";
import { injectAnimations } from "./design/animations.js";
import { S } from "./design/styles.js";
import { C } from "./design/tokens.js";

import SetupWizard from "./core/SetupWizard.jsx";
import TopHeader from "./core/TopHeader.jsx";
import Navigation from "./core/Navigation.jsx";
import WasabiPanel from "./core/WasabiPanel.jsx";
import Onboarding from "./core/Onboarding.jsx";
import PageBuilder from "./core/PageBuilder.jsx";
import PageShell from "./core/PageShell.jsx";
import WasabiFlame from "./core/WasabiFlame.jsx";
import { IconGear } from "./design/icons.jsx";

// Inject CSS animations on app load
injectAnimations();

function AppContent() {
  const {
    isAuthenticated,
    isSetup,
    pages,
    activePage,
    setActivePage,
  } = usePlatform();

  // ── UI State ──
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [wasabiPanelOpen, setWasabiPanelOpen] = useState(false);
  const [viewStates, setViewStates] = useState({}); // { [pageId]: activeViewIndex }
  const [builderTemplate, setBuilderTemplate] = useState(null);

  // Template selection handler — hooks MUST be called before any early returns
  const handleStartTemplate = useCallback(
    (template) => {
      setBuilderTemplate(template);
      setActivePage("wasabi");
    },
    [setActivePage]
  );

  const handleStartBlank = useCallback(() => {
    setBuilderTemplate(null);
    setActivePage("wasabi");
  }, [setActivePage]);

  const handleAddPage = useCallback(() => {
    setBuilderTemplate(null);
    setActivePage("wasabi");
  }, [setActivePage]);

  // Auth gate: show setup wizard if not connected
  if (!isAuthenticated || !isSetup) {
    return <SetupWizard />;
  }

  // Find active page config
  const activePageConfig = pages.find((p) => p.id === activePage);

  // Get/set active view for current page
  const activeViewIndex = activePageConfig
    ? viewStates[activePageConfig.id] ?? 0
    : 0;

  const setActiveView = (idx) => {
    if (activePageConfig) {
      setViewStates((prev) => ({ ...prev, [activePageConfig.id]: idx }));
    }
  };

  // Sidebar width for gradient bridge line positioning
  const sidebarW = sidebarCollapsed ? 48 : 220;
  const panelW = wasabiPanelOpen ? 320 : 0;

  // Small flame icon for chat avatars
  const WasabiFlameIcon = (
    <div
      style={{
        width: 18,
        height: 18,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <WasabiFlame size={18} />
    </div>
  );

  // Determine main content
  const renderContent = () => {
    // Onboarding: no pages yet and not in builder mode
    if (
      pages.length === 0 &&
      activePage !== "wasabi" &&
      activePage !== "system"
    ) {
      return (
        <Onboarding
          WasabiFlame={WasabiFlame}
          onStartBlank={handleStartBlank}
          onStartTemplate={handleStartTemplate}
        />
      );
    }

    // Wasabi page builder
    if (activePage === "wasabi") {
      return (
        <PageBuilder
          initialTemplate={builderTemplate}
          WasabiFlameIcon={WasabiFlameIcon}
        />
      );
    }

    // Default to first page or onboarding
    if (activePage === null) {
      if (pages.length > 0) {
        return (
          <Onboarding
            WasabiFlame={WasabiFlame}
            onStartBlank={handleStartBlank}
            onStartTemplate={handleStartTemplate}
          />
        );
      }
      return (
        <Onboarding
          WasabiFlame={WasabiFlame}
          onStartBlank={handleStartBlank}
          onStartTemplate={handleStartTemplate}
        />
      );
    }

    // System manager (stub for Phase 4)
    if (activePage === "system") {
      return (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            height: "100%",
            flexDirection: "column",
            gap: 12,
            color: C.darkMuted,
            fontSize: 14,
          }}
        >
          <IconGear size={32} color={C.darkMuted} />
          System Manager
          <span style={{ fontSize: 12, opacity: 0.6 }}>
            Coming in Phase 4
          </span>
        </div>
      );
    }

    // User page
    if (activePageConfig) {
      return (
        <PageShell
          pageConfig={activePageConfig}
          activeViewIndex={activeViewIndex}
        />
      );
    }

    // Fallback
    return (
      <Onboarding
        WasabiFlame={WasabiFlame}
        onStartBlank={handleStartBlank}
        onStartTemplate={handleStartTemplate}
      />
    );
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        width: "100vw",
        fontFamily: "'Outfit','DM Sans',sans-serif",
        color: C.darkText,
        background: C.dark,
        overflow: "hidden",
      }}
    >
      {/* ── Top Header Bar ── */}
      <TopHeader onAddPage={handleAddPage} />

      {/* ── Main Row: [Wasabi Panel] [Sidebar] [Content] ── */}
      <div
        style={{
          flex: 1,
          display: "flex",
          overflow: "hidden",
          position: "relative",
        }}
      >
        {/* Wasabi Panel (collapsible, left of sidebar) */}
        {wasabiPanelOpen && (
          <WasabiPanel
            onClose={() => setWasabiPanelOpen(false)}
            isThinking={false}
          />
        )}

        {/* Gradient bridge line between sidebar and content */}
        {!wasabiPanelOpen && (
          <div
            style={{
              position: "absolute",
              left: sidebarW,
              top: 0,
              bottom: 0,
              width: 1,
              zIndex: 1,
              pointerEvents: "none",
              background: `linear-gradient(180deg, ${C.edgeLine}00 0%, ${C.edgeLine} 30%, ${C.accent}44 60%, ${C.edgeLine} 85%, ${C.edgeLine}00 100%)`,
              transition: "left 0.25s cubic-bezier(0.4,0,0.2,1)",
            }}
          />
        )}

        {/* Left Sidebar */}
        <Navigation
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed((c) => !c)}
          wasabiPanelOpen={wasabiPanelOpen}
          onToggleWasabiPanel={() => setWasabiPanelOpen((o) => !o)}
          activeView={activeViewIndex}
          onSetActiveView={setActiveView}
          isThinking={false}
        />

        {/* Main Content */}
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            minWidth: 0,
          }}
        >
          {renderContent()}
        </div>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <PlatformProvider>
      <AppContent />
    </PlatformProvider>
  );
}
