// ─── Automation Builder ───
// Chat-based UI for creating and managing automation rules.
// Uses ChatUI with Wasabi agent, plus a side panel for existing rules.

import React, { useState, useCallback, useRef, useEffect } from "react";
import { C, FONT, RADIUS } from "../design/tokens.js";
import { usePlatform } from "../context/PlatformContext.jsx";
import ChatUI from "./ChatUI.jsx";
import { runAgent, extractChoices } from "../agent/runAgent.js";
import { WASABI_TOOLS } from "../agent/tools.js";
import { buildWasabiPrompt } from "../agent/wasabiPrompt.js";
import { createToolExecutor, createDelegateFunction } from "../agent/toolExecutor.js";
import { queryAll } from "../notion/pagination.js";
import { readProp } from "../notion/properties.js";
import { updatePage } from "../notion/client.js";
import WasabiOrb from "./WasabiOrb.jsx";

// ─── Trigger type pill colors ───

const TRIGGER_COLORS = {
  schedule:       { bg: "#1C5C8A33", text: "#5BA8E0" },
  status_change:  { bg: "#FF480033", text: "#FF8C42" },
  field_change:   { bg: "#8B6FBE33", text: "#B09ADB" },
  page_created:   { bg: "#2A6B3833", text: "#7DC143" },
  manual:         { bg: "#88888833", text: "#AAAAAA" },
};

function getTriggerStyle(trigger) {
  return TRIGGER_COLORS[trigger] || TRIGGER_COLORS.manual;
}

// ─── Styles ───

const styles = {
  container: {
    display: "flex",
    height: "100%",
    background: C.dark,
    fontFamily: FONT,
  },
  panel: {
    width: 260,
    minWidth: 260,
    borderRight: `1px solid ${C.edgeLine}`,
    background: C.darkSurf,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },
  panelHeader: {
    padding: "16px 16px 12px",
    fontSize: 13,
    fontWeight: 600,
    color: C.darkText,
    letterSpacing: "0.02em",
    borderBottom: `1px solid ${C.darkBorder}`,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  },
  refreshBtn: {
    background: "transparent",
    border: "none",
    color: C.darkMuted,
    cursor: "pointer",
    fontSize: 14,
    padding: "2px 6px",
    borderRadius: RADIUS.md,
    lineHeight: 1,
  },
  rulesList: {
    flex: 1,
    overflowY: "auto",
    padding: "8px 0",
  },
  ruleItem: {
    padding: "10px 16px",
    borderBottom: `1px solid ${C.darkBorder}`,
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  ruleTop: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  ruleName: {
    fontSize: 13,
    color: C.darkText,
    fontWeight: 500,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    flex: 1,
  },
  ruleBottom: {
    display: "flex",
    alignItems: "center",
    gap: 6,
  },
  triggerPill: (trigger) => {
    const c = getTriggerStyle(trigger);
    return {
      fontSize: 10,
      fontWeight: 600,
      padding: "2px 7px",
      borderRadius: RADIUS.pill,
      background: c.bg,
      color: c.text,
      letterSpacing: "0.03em",
      textTransform: "uppercase",
      whiteSpace: "nowrap",
    };
  },
  testBtn: {
    background: "transparent",
    border: `1px solid ${C.darkBorder}`,
    color: C.darkMuted,
    cursor: "pointer",
    fontSize: 10,
    fontWeight: 500,
    padding: "2px 8px",
    borderRadius: RADIUS.md,
    marginLeft: "auto",
    whiteSpace: "nowrap",
  },
  toggle: (enabled) => ({
    display: "inline-block",
    width: 36,
    height: 20,
    borderRadius: 10,
    background: enabled ? C.accent : C.darkSurf2,
    position: "relative",
    cursor: "pointer",
    transition: "background 0.2s ease",
    border: `1px solid ${enabled ? C.accentDim : C.darkBorder}`,
    flexShrink: 0,
  }),
  toggleKnob: (enabled) => ({
    position: "absolute",
    top: 2,
    left: enabled ? 18 : 2,
    width: 14,
    height: 14,
    borderRadius: "50%",
    background: enabled ? "#fff" : C.darkMuted,
    transition: "left 0.2s ease, background 0.2s ease",
  }),
  chatArea: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
  },
  emptyPanel: {
    padding: "24px 16px",
    textAlign: "center",
    color: C.darkMuted,
    fontSize: 12,
    lineHeight: 1.6,
  },
  loadingPanel: {
    padding: "24px 16px",
    textAlign: "center",
    color: C.darkMuted,
    fontSize: 12,
  },
};

// ─── Component ───

export default function AutomationBuilder({ automationEngine }) {
  const { user, platformIds, addPage } = usePlatform();

  // Chat state
  const [messages, setMessages] = useState([]);
  const [displayMessages, setDisplayMessages] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [choices, setChoices] = useState([]);
  const abortRef = useRef(false);
  const historyRef = useRef([]);

  // Rules state
  const [rules, setRules] = useState([]);
  const [rulesLoading, setRulesLoading] = useState(true);
  const [togglingIds, setTogglingIds] = useState(new Set());

  // ─── Fetch rules from Notion ───

  const fetchRules = useCallback(async () => {
    if (!platformIds.rulesDbId) {
      setRulesLoading(false);
      return;
    }
    try {
      setRulesLoading(true);
      const pages = await queryAll(
        user.workerUrl, user.notionKey,
        platformIds.rulesDbId
      );
      const parsed = pages.map((page) => {
        const props = page.properties || {};
        return {
          id: page.id,
          name: readProp(props.Name) || readProp(props.name) || "Untitled Rule",
          trigger: readProp(props.Trigger) || readProp(props.trigger) || "manual",
          enabled: readProp(props.Enabled) ?? readProp(props.enabled) ?? false,
        };
      });
      setRules(parsed);
    } catch (err) {
      console.error("[AutomationBuilder] Failed to fetch rules:", err);
    } finally {
      setRulesLoading(false);
    }
  }, [user.workerUrl, user.notionKey, platformIds.rulesDbId]);

  useEffect(() => {
    fetchRules();
  }, [fetchRules]);

  // ─── Toggle rule enabled/disabled ───

  const handleToggle = useCallback(async (ruleId, currentEnabled) => {
    const newValue = !currentEnabled;
    setTogglingIds((prev) => new Set(prev).add(ruleId));

    // Optimistic update
    setRules((prev) =>
      prev.map((r) => (r.id === ruleId ? { ...r, enabled: newValue } : r))
    );

    try {
      await updatePage(user.workerUrl, user.notionKey, ruleId, {
        Enabled: { checkbox: newValue },
      });
    } catch (err) {
      console.error("[AutomationBuilder] Toggle failed:", err);
      // Revert optimistic update
      setRules((prev) =>
        prev.map((r) => (r.id === ruleId ? { ...r, enabled: currentEnabled } : r))
      );
    } finally {
      setTogglingIds((prev) => {
        const next = new Set(prev);
        next.delete(ruleId);
        return next;
      });
    }
  }, [user.workerUrl, user.notionKey]);

  // ─── Test rule ───

  const handleTestRule = useCallback((ruleId) => {
    if (automationEngine?.runRule) {
      automationEngine.runRule(ruleId);
    }
  }, [automationEngine]);

  // ─── Tool executor ───

  const executeTool = useCallback((toolName, toolInput) => {
    const executor = createToolExecutor({
      workerUrl: user.workerUrl,
      notionKey: user.notionKey,
      parentPageId: platformIds.rootPageId,
      kbDbId: platformIds.kbDbId,
      notifDbId: platformIds.notifDbId,
      configDbId: platformIds.configDbId,
      rulesDbId: platformIds.rulesDbId,
      onPageCreated: (pageConfig) => {
        addPage(pageConfig);
      },
    });
    return executor(toolName, toolInput);
  }, [user, platformIds, addPage]);

  // ─── Build system prompt ───

  const buildSystemPrompt = useCallback(() => {
    const platformDbStr = [
      `Root Page: ${platformIds.rootPageId}`,
      `Knowledge Base: ${platformIds.kbDbId}`,
      `Page Configs: ${platformIds.configDbId}`,
      `Notifications: ${platformIds.notifDbId}`,
      `Automation Rules: ${platformIds.rulesDbId}`,
    ].join("\n");

    const rulesListStr = rules.length > 0
      ? rules.map((r) => `- ${r.name} (${r.trigger}, ${r.enabled ? "enabled" : "disabled"})`).join("\n")
      : "No rules created yet.";

    return `${buildWasabiPrompt({ platformDbIds: platformDbStr })}

## Automation Context
You are helping create and manage automation rules.
Available triggers: schedule, status_change, field_change, page_created, manual.

Template variables: Use {{field_name}} in instructions for fast-path execution (no AI call needed).
Example: "post_notification: {{Name}} is now {{Status}}"

Existing Rules:
${rulesListStr}`;
  }, [platformIds, rules]);

  // ─── Send message ───

  const handleSend = useCallback(async ({ text, files }) => {
    if (isLoading) return;

    let displayText = text;
    if (files?.length) {
      displayText += `\n\nAttached: ${files.map((f) => f.name).join(", ")}`;
    }

    setDisplayMessages((prev) => [...prev, { role: "user", content: displayText }]);
    setChoices([]);
    setIsLoading(true);

    let agentText = text;
    if (files?.length) {
      const fileContents = files
        .map((f) => `[File: ${f.name} (${f.type})]\n${f.text || "[binary file]"}`)
        .join("\n\n");
      agentText += `\n\nUploaded files:\n${fileContents}`;
    }

    const userMsg = { role: "user", content: agentText };
    const newHistory = [...historyRef.current, userMsg];

    try {
      const systemPrompt = buildSystemPrompt();

      const { text: reply, history } = await runAgent({
        messages: newHistory,
        systemPrompt,
        tools: WASABI_TOOLS,
        model: "claude-sonnet-4-20250514",
        workerUrl: user.workerUrl,
        claudeKey: user.claudeKey,
        executeTool,
        onToolCall: (name, input, result) => {
          console.log(`[Wasabi Automation] ${name}`, input);
        },
        abortRef,
        maxTokens: 2048,
      });

      historyRef.current = history;

      // Extract choices from response
      const extracted = extractChoices(reply);
      let cleanReply = reply;
      for (const c of extracted) {
        cleanReply = cleanReply.replace(c.raw, "").trim();
      }

      setDisplayMessages((prev) => [...prev, { role: "assistant", content: cleanReply }]);
      setChoices(extracted);

      // Re-fetch rules in case Wasabi created a new one
      fetchRules();
    } catch (err) {
      console.error("[AutomationBuilder] Agent error:", err);
      setDisplayMessages((prev) => [
        ...prev,
        { role: "assistant", content: `Something went wrong: ${err.message}. Let's try again.` },
      ]);
    } finally {
      setIsLoading(false);
    }
  }, [isLoading, user, buildSystemPrompt, executeTool, fetchRules]);

  // ─── Handle choice click ───

  const handleChoice = useCallback((choice) => {
    const label = typeof choice === "string" ? choice : choice.label;
    handleSend({ text: label });
  }, [handleSend]);

  // ─── Render ───

  return (
    <div style={styles.container}>
      {/* Rules Panel */}
      <div style={styles.panel}>
        <div style={styles.panelHeader}>
          <span>Automation Rules</span>
          <button
            style={styles.refreshBtn}
            onClick={fetchRules}
            title="Refresh rules"
            onMouseEnter={(e) => { e.target.style.color = C.darkText; }}
            onMouseLeave={(e) => { e.target.style.color = C.darkMuted; }}
          >
            &#x21bb;
          </button>
        </div>

        <div style={styles.rulesList}>
          {rulesLoading && (
            <div style={styles.loadingPanel}>Loading rules...</div>
          )}

          {!rulesLoading && rules.length === 0 && (
            <div style={styles.emptyPanel}>
              No automation rules yet. Use the chat to create your first rule.
            </div>
          )}

          {!rulesLoading && rules.map((rule) => (
            <div key={rule.id} style={styles.ruleItem}>
              <div style={styles.ruleTop}>
                <span style={styles.ruleName} title={rule.name}>
                  {rule.name}
                </span>
                <div
                  style={styles.toggle(rule.enabled)}
                  onClick={() => {
                    if (!togglingIds.has(rule.id)) {
                      handleToggle(rule.id, rule.enabled);
                    }
                  }}
                  title={rule.enabled ? "Disable rule" : "Enable rule"}
                  role="switch"
                  aria-checked={rule.enabled}
                >
                  <div style={styles.toggleKnob(rule.enabled)} />
                </div>
              </div>

              <div style={styles.ruleBottom}>
                <span style={styles.triggerPill(rule.trigger)}>
                  {rule.trigger.replace(/_/g, " ")}
                </span>
                {automationEngine && (
                  <button
                    style={styles.testBtn}
                    onClick={() => handleTestRule(rule.id)}
                    onMouseEnter={(e) => {
                      e.target.style.borderColor = C.accent;
                      e.target.style.color = C.accent;
                    }}
                    onMouseLeave={(e) => {
                      e.target.style.borderColor = C.darkBorder;
                      e.target.style.color = C.darkMuted;
                    }}
                    title="Run this rule manually"
                  >
                    Test
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Chat Area */}
      <div style={styles.chatArea}>
        <ChatUI
          messages={displayMessages}
          onSend={handleSend}
          isLoading={isLoading}
          choices={choices}
          onChoice={handleChoice}
          allowFiles={true}
          agentName="Wasabi"
          agentIcon={<WasabiOrb size={28} />}
          placeholder="Describe an automation rule to create..."
        />
      </div>
    </div>
  );
}
