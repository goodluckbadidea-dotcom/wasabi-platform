// ─── Page Builder ───
// Wasabi's page-building flow with two modes:
// 1. Chat mode: conversational builder with the Wasabi agent
// 2. Visual mode: drag-less visual editor for quick page assembly

import React, { useState, useCallback, useRef } from "react";
import ChatUI from "./ChatUI.jsx";
import VisualPageBuilder from "./VisualPageBuilder.jsx";
import { usePlatform } from "../context/PlatformContext.jsx";
import { runAgent, extractQuestions } from "../agent/runAgent.js";
import { WASABI_TOOLS } from "../agent/tools.js";
import { buildWasabiPrompt } from "../agent/wasabiPrompt.js";
import { createToolExecutor } from "../agent/toolExecutor.js";
import { C, FONT, RADIUS } from "../design/tokens.js";

// ── Mode tab styles ──
const tabStyle = (active) => ({
  padding: "8px 20px",
  fontSize: 12,
  fontWeight: 600,
  fontFamily: FONT,
  color: active ? C.darkText : C.darkMuted,
  background: active ? C.darkSurf2 : "transparent",
  border: `1px solid ${active ? C.darkBorder : "transparent"}`,
  borderBottom: active ? "none" : `1px solid ${C.darkBorder}`,
  borderRadius: `${RADIUS.md}px ${RADIUS.md}px 0 0`,
  cursor: "pointer",
  transition: "all 0.15s",
  letterSpacing: "0.02em",
  position: "relative",
  top: 1,
});

export default function PageBuilder({ initialTemplate = null, WasabiFlameIcon = null, defaultParentId = null }) {
  const { user, platformIds, addPage, pages } = usePlatform();
  const [selectedParent, setSelectedParent] = useState(null);
  const folderOptions = pages.filter(p =>
    p.type === "folder" || p.page_type === "workspace" || p.pageType === "workspace"
  );
  const [mode, setMode] = useState(initialTemplate ? "chat" : "visual"); // "chat" | "visual"
  const [displayMessages, setDisplayMessages] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [choices, setChoices] = useState([]);
  const abortRef = useRef(false);
  const historyRef = useRef([]);

  // Initialize with template context if provided
  const hasInitialized = useRef(false);
  React.useEffect(() => {
    if (hasInitialized.current) return;
    hasInitialized.current = true;

    if (initialTemplate) {
      handleSend({
        text: `I'd like to create a ${initialTemplate.name} page. (Template: ${initialTemplate.id})`,
      });
    }
  }, [initialTemplate]);

  const executeTool = useCallback((toolName, toolInput) => {
    // Inject selected parent folder into page creation if not explicitly set
    if (toolName === "create_page_config" && selectedParent && !toolInput.parent_id) {
      toolInput = { ...toolInput, parent_id: selectedParent };
    }
    const executor = createToolExecutor({
      workerUrl: user.workerUrl,
      notionKey: user.notionKey,
      parentPageId: selectedParent || platformIds.rootPageId,
      kbDbId: platformIds.kbDbId,
      notifDbId: platformIds.notifDbId,
      configDbId: platformIds.configDbId,
      rulesDbId: platformIds.rulesDbId,
      onPageCreated: (pageConfig) => {
        addPage(pageConfig);
      },
      claudeKey: user?.claudeKey || "",
    });
    return executor(toolName, toolInput);
  }, [user, platformIds, addPage, selectedParent]);

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
      const fileContents = files.map((f) => `[File: ${f.name} (${f.type})]\n${f.text || "[binary file]"}`).join("\n\n");
      agentText += `\n\nUploaded files:\n${fileContents}`;
    }

    const userMsg = { role: "user", content: agentText };
    const newHistory = [...historyRef.current, userMsg];

    try {
      const platformDbStr = [
        `Root Page: ${platformIds.rootPageId}`,
        `Knowledge Base: ${platformIds.kbDbId}`,
        `Page Configs: ${platformIds.configDbId}`,
        `Notifications: ${platformIds.notifDbId}`,
        `Automation Rules: ${platformIds.rulesDbId}`,
      ].join("\n");

      const systemPrompt = buildWasabiPrompt({ platformDbIds: platformDbStr });

      const { text: reply, history } = await runAgent({
        messages: newHistory,
        systemPrompt,
        tools: WASABI_TOOLS,
        model: "claude-sonnet-4-20250514",
        workerUrl: user.workerUrl,
        claudeKey: user.claudeKey,
        executeTool,
        onToolCall: (name, input, result) => {
          console.log(`[Wasabi Tool] ${name}`, input);
        },
        abortRef,
        maxTokens: 3000,
      });

      historyRef.current = history;

      const extracted = extractQuestions(reply);
      let cleanReply = reply;
      for (const c of extracted) {
        cleanReply = cleanReply.replace(c.raw, "").trim();
      }

      setDisplayMessages((prev) => [...prev, { role: "assistant", content: cleanReply }]);
      setChoices(extracted);
    } catch (err) {
      console.error("Agent error:", err);
      setDisplayMessages((prev) => [
        ...prev,
        { role: "assistant", content: `Something went wrong: ${err.message}. Let's try again.` },
      ]);
    } finally {
      setIsLoading(false);
    }
  }, [isLoading, user, platformIds, executeTool]);

  const handleChoice = useCallback((choice) => {
    const label = typeof choice === "string" ? choice : choice.label;
    handleSend({ text: label });
  }, [handleSend]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Location picker + Mode tabs */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 20px",
        borderBottom: `1px solid ${C.darkBorder}`,
        background: C.dark,
        gap: 0,
      }}>
      <div style={{ display: "flex", gap: 0 }}>
        <span style={tabStyle(mode === "visual")} onClick={() => setMode("visual")}>
          Visual Builder
        </span>
        <span style={tabStyle(mode === "chat")} onClick={() => setMode("chat")}>
          Chat Builder
        </span>
      </div>
      {/* Folder picker */}
      {folderOptions.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, paddingBottom: 1 }}>
          <span style={{ fontSize: 11, color: C.darkMuted, fontFamily: FONT }}>Location:</span>
          <select
            value={selectedParent || ""}
            onChange={(e) => setSelectedParent(e.target.value || null)}
            style={{
              background: C.darkSurf2, border: `1px solid ${C.darkBorder}`,
              borderRadius: RADIUS.md, padding: "5px 8px",
              fontSize: 11, fontFamily: FONT, color: C.darkText, outline: "none",
            }}
          >
            <option value="">Root</option>
            {folderOptions.map(f => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </select>
        </div>
      )}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: "hidden" }}>
        {mode === "chat" ? (
          <ChatUI
            messages={displayMessages}
            onSend={handleSend}
            isLoading={isLoading}
            choices={choices}
            onChoice={handleChoice}
            allowFiles={true}
            agentName="Wasabi"
            agentIcon={WasabiFlameIcon}
            placeholder="Describe what you want to build..."
          />
        ) : (
          <VisualPageBuilder onCancel={() => setMode("chat")} />
        )}
      </div>
    </div>
  );
}
