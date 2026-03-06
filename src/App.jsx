// ─── Wasabi Platform App Shell ───
// Root component: auth gate → layout → routing.

import React, { useState, useCallback } from "react";
import { PlatformProvider, usePlatform } from "./context/PlatformContext.jsx";
import { injectAnimations } from "./design/animations.js";
import { S } from "./design/styles.js";

import SetupWizard from "./core/SetupWizard.jsx";
import Navigation from "./core/Navigation.jsx";
import Onboarding from "./core/Onboarding.jsx";
import PageBuilder from "./core/PageBuilder.jsx";
import PageShell from "./core/PageShell.jsx";
import Drawer from "./core/Drawer.jsx";
import WasabiFlame from "./core/WasabiFlame.jsx";

// Inject CSS animations on app load
injectAnimations();

function AppContent() {
  const {
    isAuthenticated,
    isSetup,
    pages,
    activePage,
    setActivePage,
    batchQueue,
  } = usePlatform();

  const [queueOpen, setQueueOpen] = useState(false);
  const [builderTemplate, setBuilderTemplate] = useState(null);

  // Auth gate: show setup wizard if not connected
  if (!isAuthenticated || !isSetup) {
    return <SetupWizard />;
  }

  // Find active page config
  const activePageConfig = pages.find((p) => p.id === activePage);

  // Template selection handler
  const handleStartTemplate = useCallback((template) => {
    setBuilderTemplate(template);
    setActivePage("wasabi");
  }, [setActivePage]);

  const handleStartBlank = useCallback(() => {
    setBuilderTemplate(null);
    setActivePage("wasabi");
  }, [setActivePage]);

  // Small flame icon for chat avatars
  const WasabiFlameIcon = (
    <div style={{ width: 18, height: 18, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <WasabiFlame size={18} />
    </div>
  );

  // Determine main content
  const renderContent = () => {
    // Onboarding: no pages yet and not in builder mode
    if (pages.length === 0 && activePage !== "wasabi" && activePage !== "system") {
      return (
        <Onboarding
          WasabiFlame={WasabiFlame}
          onStartBlank={handleStartBlank}
          onStartTemplate={handleStartTemplate}
        />
      );
    }

    // Wasabi page builder
    if (activePage === "wasabi" || activePage === null) {
      // If we have pages but navigated to wasabi, show builder
      if (pages.length > 0 && activePage === null) {
        // Default to first page if any exist
        return (
          <Onboarding
            WasabiFlame={WasabiFlame}
            onStartBlank={handleStartBlank}
            onStartTemplate={handleStartTemplate}
          />
        );
      }
      return (
        <PageBuilder
          initialTemplate={builderTemplate}
          WasabiFlameIcon={WasabiFlameIcon}
        />
      );
    }

    // System manager (stub for Phase 4)
    if (activePage === "system") {
      return (
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          flexDirection: "column",
          gap: 12,
          color: "#9A8E82",
          fontSize: 14,
        }}>
          <span style={{ fontSize: 32 }}>⚙️</span>
          System Manager
          <span style={{ fontSize: 12, opacity: 0.6 }}>Coming in Phase 4</span>
        </div>
      );
    }

    // User page
    if (activePageConfig) {
      return <PageShell pageConfig={activePageConfig} />;
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
    <div style={S.app}>
      <Navigation onOpenQueue={() => setQueueOpen(true)} />

      <div style={S.main}>
        {renderContent()}
      </div>

      {/* Batch Queue Drawer */}
      <Drawer
        open={queueOpen}
        onClose={() => setQueueOpen(false)}
        title="Batch Queue"
        side="right"
        width={420}
      >
        {batchQueue.length === 0 ? (
          <div style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: 48,
            color: "#9A8E82",
            fontSize: 14,
            textAlign: "center",
            gap: 8,
          }}>
            <span style={{ fontSize: 24 }}>📋</span>
            Queue is empty
            <span style={{ fontSize: 12, opacity: 0.6 }}>
              Add actions and notes here to batch process later.
            </span>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {batchQueue.map((item, i) => (
              <div key={item.id} style={{
                background: "#ECE6DC",
                borderRadius: 8,
                padding: "10px 14px",
                fontSize: 13,
                color: "#1A1812",
                border: "1px solid #D6CCBC",
              }}>
                {item.text || item.action || "Queue item"}
              </div>
            ))}
            <button style={{
              background: "#7DC143",
              color: "#fff",
              border: "none",
              borderRadius: 999,
              padding: "10px 20px",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              marginTop: 8,
            }}>
              Process Queue
            </button>
          </div>
        )}
      </Drawer>
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
