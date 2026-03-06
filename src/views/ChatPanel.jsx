// ─── Chat Panel (Page Agent) ───
// Scoped chat for a page's agent. Handles escalation to Wasabi.

import React, { useState, useCallback, useRef } from "react";
import ChatUI from "../core/ChatUI.jsx";
import { usePlatform } from "../context/PlatformContext.jsx";
import { runAgent, extractChoices } from "../agent/runAgent.js";
import { PAGE_TOOLS, WASABI_TOOLS } from "../agent/tools.js";
import { buildPageAgentPrompt, buildWasabiPrompt } from "../agent/wasabiPrompt.js";
import { createPageToolExecutor, createToolExecutor } from "../agent/toolExecutor.js";
import { C } from "../design/tokens.js";

export default function ChatPanel({ pageConfig, schema, data, onRefresh }) {
  const { user, platformIds, addPage } = usePlatform();
  const [displayMessages, setDisplayMessages] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [choices, setChoices] = useState([]);
  const [currentAgent, setCurrentAgent] = useState("page"); // "page" or "wasabi"
  const historyRef = useRef([]);
  const abortRef = useRef(false);

  const pageToolExecutor = useCallback((toolName, toolInput) => {
    const executor = createPageToolExecutor({
      workerUrl: user.workerUrl,
      notionKey: user.notionKey,
      notifDbId: platformIds.notifDbId,
      kbDbId: platformIds.kbDbId,
      scopedDatabaseIds: pageConfig.databaseIds,
    });
    return executor(toolName, toolInput);
  }, [user, platformIds, pageConfig]);

  const wasabiToolExecutor = useCallback((toolName, toolInput) => {
    const executor = createToolExecutor({
      workerUrl: user.workerUrl,
      notionKey: user.notionKey,
      parentPageId: platformIds.rootPageId,
      kbDbId: platformIds.kbDbId,
      notifDbId: platformIds.notifDbId,
      configDbId: platformIds.configDbId,
      onPageCreated: addPage,
    });
    return executor(toolName, toolInput);
  }, [user, platformIds, addPage]);

  const handleSend = useCallback(async ({ text, files }) => {
    if (isLoading) return;

    setDisplayMessages((prev) => [...prev, { role: "user", content: text }]);
    setChoices([]);
    setIsLoading(true);

    let agentText = text;
    if (files?.length) {
      const fileContents = files.map((f) => `[File: ${f.name}]\n${f.text || "[binary]"}`).join("\n\n");
      agentText += `\n\nFiles:\n${fileContents}`;
    }

    const userMsg = { role: "user", content: agentText };
    const newHistory = [...historyRef.current, userMsg];

    try {
      const isWasabi = currentAgent === "wasabi";

      const systemPrompt = isWasabi
        ? buildWasabiPrompt({ platformDbIds: Object.entries(platformIds).map(([k, v]) => `${k}: ${v}`).join("\n") })
        : buildPageAgentPrompt({
            pageName: pageConfig.name,
            agentPrompt: pageConfig.agentConfig?.prompt,
            databaseIds: pageConfig.databaseIds || [],
            schemaText: schema ? JSON.stringify(schema, null, 2) : "",
          });

      const { text: reply, history } = await runAgent({
        messages: newHistory,
        systemPrompt,
        tools: isWasabi ? WASABI_TOOLS : PAGE_TOOLS,
        model: isWasabi ? "claude-sonnet-4-20250514" : "claude-haiku-4-5-20251001",
        workerUrl: user.workerUrl,
        claudeKey: user.claudeKey,
        executeTool: isWasabi ? wasabiToolExecutor : pageToolExecutor,
        onToolCall: (name, input, result) => {
          // Check for escalation
          if (name === "escalate_to_wasabi") {
            try {
              const parsed = JSON.parse(result);
              if (parsed._escalate) {
                setCurrentAgent("wasabi");
                setDisplayMessages((prev) => [
                  ...prev,
                  { role: "system", content: `🌿 Wasabi is stepping in to help. Reason: ${parsed.reason}` },
                ]);
              }
            } catch {}
          }
        },
        abortRef,
        maxTokens: 2048,
      });

      historyRef.current = history;

      const extracted = extractChoices(reply);
      let cleanReply = reply;
      for (const c of extracted) {
        cleanReply = cleanReply.replace(c.raw, "").trim();
      }

      setDisplayMessages((prev) => [...prev, { role: "assistant", content: cleanReply }]);
      setChoices(extracted);

      // Refresh data after agent actions
      if (onRefresh) onRefresh();
    } catch (err) {
      console.error("Chat error:", err);
      setDisplayMessages((prev) => [
        ...prev,
        { role: "assistant", content: `Error: ${err.message}` },
      ]);
    } finally {
      setIsLoading(false);
    }
  }, [isLoading, currentAgent, user, platformIds, pageConfig, schema, pageToolExecutor, wasabiToolExecutor]);

  const handleChoice = useCallback((choice) => {
    handleSend({ text: typeof choice === "string" ? choice : choice.label });
  }, [handleSend]);

  const agentIcon = currentAgent === "wasabi" ? (
    <span style={{ fontSize: 14 }}>🌿</span>
  ) : (
    <span style={{ fontSize: 14 }}>{pageConfig.icon || "📄"}</span>
  );

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      {/* Agent indicator */}
      <div style={{
        padding: "8px 16px",
        borderBottom: `1px solid ${C.border}`,
        fontSize: 11,
        color: C.muted,
        display: "flex",
        alignItems: "center",
        gap: 6,
        background: C.white,
      }}>
        {currentAgent === "wasabi" ? "🌿 Wasabi" : `${pageConfig.icon || "📄"} ${pageConfig.name}`}
        {currentAgent === "wasabi" && (
          <button
            onClick={() => setCurrentAgent("page")}
            style={{
              marginLeft: "auto",
              background: "transparent",
              border: `1px solid ${C.border}`,
              borderRadius: 999,
              padding: "2px 10px",
              fontSize: 10,
              cursor: "pointer",
              color: C.muted,
              fontFamily: "inherit",
            }}
          >
            Return to page agent
          </button>
        )}
      </div>

      <ChatUI
        messages={displayMessages}
        onSend={handleSend}
        isLoading={isLoading}
        choices={choices}
        onChoice={handleChoice}
        allowFiles={true}
        agentName={currentAgent === "wasabi" ? "Wasabi" : pageConfig.name}
        agentIcon={agentIcon}
        placeholder={`Ask ${currentAgent === "wasabi" ? "Wasabi" : pageConfig.name}...`}
      />
    </div>
  );
}
