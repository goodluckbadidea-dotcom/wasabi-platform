// ── Workspace Settings ──
// Settings view for workspace pages. Appears when user clicks a workspace.
// Allows configuring AI instructions, model selection, KB settings.

import React, { useState, useCallback, useRef, useEffect } from "react";
import { C, FONT, RADIUS } from "../design/tokens.js";
import { usePlatform } from "../context/PlatformContext.jsx";
import { IconGear } from "../design/icons.jsx";
import WasabiOrb from "../core/WasabiOrb.jsx";

// ── Styles ──
// Returned from function so theme switches pick up fresh C values.
function getWs() { return {
  container: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    overflow: "auto",
    background: C.dark,
    padding: "40px 32px",
  },
  inner: {
    maxWidth: 640,
    width: "100%",
    margin: "0 auto",
    display: "flex",
    flexDirection: "column",
    gap: 32,
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: 14,
    marginBottom: 8,
  },
  title: {
    fontSize: 22,
    fontWeight: 700,
    color: C.darkText,
    fontFamily: FONT,
  },
  subtitle: {
    fontSize: 13,
    color: C.darkMuted,
    fontFamily: FONT,
    marginTop: 4,
  },
  section: {
    background: C.darkSurf,
    border: `1px solid ${C.darkBorder}`,
    borderRadius: RADIUS.lg,
    padding: "20px 24px",
    display: "flex",
    flexDirection: "column",
    gap: 14,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: 600,
    color: C.darkMuted,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
  },
  label: {
    fontSize: 12,
    color: C.darkMuted,
    fontFamily: FONT,
    marginBottom: 6,
  },
  textarea: {
    width: "100%",
    minHeight: 120,
    background: C.darkSurf2,
    border: `1px solid ${C.darkBorder}`,
    borderRadius: RADIUS.md,
    padding: "12px 14px",
    fontSize: 13,
    fontFamily: FONT,
    color: C.darkText,
    outline: "none",
    resize: "vertical",
    lineHeight: 1.6,
    transition: "border-color 0.15s",
    boxSizing: "border-box",
  },
  radioGroup: {
    display: "flex",
    gap: 8,
  },
  radioBtn: (active) => ({
    flex: 1,
    padding: "10px 14px",
    background: active ? C.accent + "18" : C.darkSurf2,
    border: `1px solid ${active ? C.accent + "55" : C.darkBorder}`,
    borderRadius: RADIUS.pill,
    cursor: "pointer",
    fontFamily: FONT,
    fontSize: 12,
    fontWeight: active ? 600 : 400,
    color: active ? C.accent : C.darkMuted,
    transition: "all 0.15s",
    outline: "none",
    textAlign: "center",
  }),
  toggle: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "8px 0",
  },
  toggleLabel: {
    fontSize: 13,
    color: C.darkText,
    fontFamily: FONT,
  },
  toggleDesc: {
    fontSize: 11,
    color: C.darkMuted,
    marginTop: 2,
  },
  switchTrack: (on) => ({
    width: 36,
    height: 20,
    borderRadius: 10,
    background: on ? C.accent : C.darkSurf2,
    border: `1px solid ${on ? C.accent : C.darkBorder}`,
    position: "relative",
    cursor: "pointer",
    transition: "all 0.2s",
    flexShrink: 0,
  }),
  switchThumb: (on) => ({
    width: 16,
    height: 16,
    borderRadius: "50%",
    background: on ? "#fff" : C.darkMuted,
    position: "absolute",
    top: 1,
    left: on ? 17 : 1,
    transition: "all 0.2s",
  }),
  savedBadge: {
    fontSize: 10,
    color: C.accent,
    fontWeight: 600,
    opacity: 1,
    transition: "opacity 0.3s",
    marginLeft: 8,
  },
  dbList: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  dbItem: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 12px",
    background: C.darkSurf2,
    borderRadius: RADIUS.md,
    fontSize: 12,
    color: C.darkText,
  },
  dbType: {
    fontSize: 10,
    color: C.darkMuted,
    background: C.dark,
    padding: "2px 6px",
    borderRadius: 999,
  },
}; }

// ── Toggle Switch ──
function Toggle({ value, onChange, label, description }) {
  const ws = getWs();
  return (
    <div style={ws.toggle}>
      <div>
        <div style={ws.toggleLabel}>{label}</div>
        {description && <div style={ws.toggleDesc}>{description}</div>}
      </div>
      <div
        style={ws.switchTrack(value)}
        onClick={() => onChange(!value)}
      >
        <div style={ws.switchThumb(value)} />
      </div>
    </div>
  );
}

export default function WorkspaceSettings({ pageConfig, onUpdate }) {
  const ws = getWs();
  const { pages } = usePlatform();

  // Get current settings (from pageConfig or config sub-object)
  const settings = pageConfig.settings || pageConfig.config?.settings || {
    aiInstructions: "",
    defaultModel: "auto",
    autoSearchKb: true,
    kbCategories: [],
  };

  const [instructions, setInstructions] = useState(settings.aiInstructions || "");
  const [model, setModel] = useState(settings.defaultModel || "auto");
  const [agentMode, setAgentMode] = useState(settings.agentMode || "auto");
  const [autoKb, setAutoKb] = useState(settings.autoSearchKb !== false);
  const [saved, setSaved] = useState(false);
  const saveTimer = useRef(null);

  // Auto-save on change with debounce
  const persistSettings = useCallback((updates) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const newSettings = {
        aiInstructions: instructions,
        defaultModel: model,
        agentMode,
        autoSearchKb: autoKb,
        kbCategories: settings.kbCategories || [],
        ...updates,
      };
      onUpdate({ settings: newSettings });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }, 600);
  }, [instructions, model, agentMode, autoKb, settings.kbCategories, onUpdate]);

  // Handle instruction changes
  const handleInstructionsChange = useCallback((e) => {
    const val = e.target.value;
    setInstructions(val);
    persistSettings({ aiInstructions: val });
  }, [persistSettings]);

  // Handle model change
  const handleModelChange = useCallback((val) => {
    setModel(val);
    persistSettings({ defaultModel: val });
  }, [persistSettings]);

  // Handle agent mode change
  const handleAgentModeChange = useCallback((val) => {
    setAgentMode(val);
    persistSettings({ agentMode: val });
  }, [persistSettings]);

  // Handle auto-KB toggle
  const handleAutoKbChange = useCallback((val) => {
    setAutoKb(val);
    persistSettings({ autoSearchKb: val });
  }, [persistSettings]);

  // Cleanup timer
  useEffect(() => {
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, []);

  // Find child pages (databases, sheets, etc.) in this workspace
  const childPages = (pages || []).filter((p) => {
    if (!p.parentId) return false;
    // Direct children or descendants
    let current = p;
    const visited = new Set();
    while (current?.parentId) {
      if (visited.has(current.id)) break;
      visited.add(current.id);
      if (current.parentId === pageConfig.id) return true;
      current = pages.find((pp) => pp.id === current.parentId);
    }
    return false;
  });

  const dataSources = childPages.filter((p) => {
    const pt = p.page_type || p.pageType;
    return ["database", "sheet", "linked_sheet", "linked_monday", "linked_notion"].includes(pt);
  });

  return (
    <div style={ws.container}>
      <div style={ws.inner}>
        {/* Header */}
        <div>
          <div style={ws.header}>
            <WasabiOrb size={32} />
            <div>
              <div style={ws.title}>{pageConfig.name || "Workspace"} Settings</div>
              <div style={ws.subtitle}>
                Configure how Wasabi behaves in this workspace
                {saved && <span style={ws.savedBadge}>Saved</span>}
              </div>
            </div>
          </div>
        </div>

        {/* AI Instructions */}
        <div style={ws.section}>
          <div style={ws.sectionTitle}>AI Instructions</div>
          <div style={ws.label}>
            Custom instructions for Wasabi when working in this workspace. These are injected into the system prompt for every conversation.
          </div>
          <textarea
            style={ws.textarea}
            value={instructions}
            onChange={handleInstructionsChange}
            placeholder={"e.g. This workspace tracks inventory for our retail stores.\nAlways check the Products database before suggesting new items.\nUse metric units for all measurements."}
            onFocus={(e) => { e.target.style.borderColor = C.accent; }}
            onBlur={(e) => { e.target.style.borderColor = C.darkBorder; }}
            autoComplete="off"
          />
        </div>

        {/* Model Selection */}
        <div style={ws.section}>
          <div style={ws.sectionTitle}>Default Model</div>
          <div style={ws.label}>
            Choose which AI model Wasabi uses for this workspace.
          </div>
          <div style={ws.radioGroup}>
            <button
              style={ws.radioBtn(model === "auto")}
              onClick={() => handleModelChange("auto")}
            >
              Auto (Recommended)
            </button>
            <button
              style={ws.radioBtn(model === "haiku")}
              onClick={() => handleModelChange("haiku")}
            >
              Haiku (Fast)
            </button>
            <button
              style={ws.radioBtn(model === "sonnet")}
              onClick={() => handleModelChange("sonnet")}
            >
              Sonnet (Powerful)
            </button>
          </div>
          <div style={{ fontSize: 11, color: C.darkMuted }}>
            Auto routes simple queries to Haiku and complex ones to Sonnet for the best cost/quality balance.
          </div>
        </div>

        {/* Agent Behavior */}
        <div style={ws.section}>
          <div style={ws.sectionTitle}>Agent Behavior</div>
          <div style={ws.label}>
            Control how Wasabi handles actions that create, update, or delete data.
          </div>
          <div style={ws.radioGroup}>
            <button
              style={ws.radioBtn(agentMode === "auto")}
              onClick={() => handleAgentModeChange("auto")}
            >
              Auto-Accept
            </button>
            <button
              style={ws.radioBtn(agentMode === "confirm")}
              onClick={() => handleAgentModeChange("confirm")}
            >
              Ask Permission
            </button>
            <button
              style={ws.radioBtn(agentMode === "plan")}
              onClick={() => handleAgentModeChange("plan")}
            >
              Plan Mode
            </button>
          </div>
          <div style={{ fontSize: 11, color: C.darkMuted }}>
            {agentMode === "auto" && "Execute actions immediately without asking."}
            {agentMode === "confirm" && "Ask before creating, updating, or deleting records. Read-only queries run freely."}
            {agentMode === "plan" && "Present a plan before taking any actions. You approve before execution begins."}
          </div>
        </div>

        {/* Knowledge Base */}
        <div style={ws.section}>
          <div style={ws.sectionTitle}>Knowledge Base</div>
          <Toggle
            value={autoKb}
            onChange={handleAutoKbChange}
            label="Auto-search Knowledge Base"
            description="Automatically search your KB for relevant context before every response."
          />
        </div>

        {/* Connected Data Sources */}
        {dataSources.length > 0 && (
          <div style={ws.section}>
            <div style={ws.sectionTitle}>Data Sources in This Workspace ({dataSources.length})</div>
            <div style={ws.dbList}>
              {dataSources.map((ds) => {
                const pt = ds.page_type || ds.pageType;
                const typeLabel = {
                  database: "D1 Table",
                  sheet: "D1 Sheet",
                  linked_sheet: "Google Sheet",
                  linked_monday: "Monday.com",
                  linked_notion: "Notion DB",
                }[pt] || pt;
                return (
                  <div key={ds.id} style={ws.dbItem}>
                    <span style={{ flex: 1 }}>{ds.name || "Untitled"}</span>
                    <span style={ws.dbType}>{typeLabel}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
