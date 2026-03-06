// ─── Page Builder ───
// Wasabi's page-building conversation flow.
// Uses ChatUI with Wasabi agent to collaboratively create pages.

import React, { useState, useCallback, useRef } from "react";
import ChatUI from "./ChatUI.jsx";
import { usePlatform } from "../context/PlatformContext.jsx";
import { runAgent, extractChoices } from "../agent/runAgent.js";
import { WASABI_TOOLS } from "../agent/tools.js";
import { buildWasabiPrompt } from "../agent/wasabiPrompt.js";
import { createToolExecutor } from "../agent/toolExecutor.js";

export default function PageBuilder({ initialTemplate = null, WasabiFlameIcon = null }) {
  const { user, platformIds, addPage } = usePlatform();
  const [messages, setMessages] = useState([]);
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
      // Send template selection as first message
      handleSend({
        text: `I'd like to create a ${initialTemplate.name} page. (Template: ${initialTemplate.id})`,
      });
    }
  }, [initialTemplate]);

  const executeTool = useCallback((toolName, toolInput) => {
    const executor = createToolExecutor({
      workerUrl: user.workerUrl,
      notionKey: user.notionKey,
      parentPageId: platformIds.rootPageId,
      kbDbId: platformIds.kbDbId,
      notifDbId: platformIds.notifDbId,
      configDbId: platformIds.configDbId,
      onPageCreated: (pageConfig) => {
        // Add the new page to the platform
        addPage(pageConfig);
      },
    });
    return executor(toolName, toolInput);
  }, [user, platformIds, addPage]);

  const handleSend = useCallback(async ({ text, files }) => {
    if (isLoading) return;

    // Build display message
    let displayText = text;
    if (files?.length) {
      displayText += `\n\n📎 ${files.map((f) => f.name).join(", ")}`;
    }

    // Add user message to display
    setDisplayMessages((prev) => [...prev, { role: "user", content: displayText }]);
    setChoices([]);
    setIsLoading(true);

    // Build agent message (include file content for parsing)
    let agentText = text;
    if (files?.length) {
      const fileContents = files.map((f) => `[File: ${f.name} (${f.type})]\n${f.text || "[binary file]"}`).join("\n\n");
      agentText += `\n\nUploaded files:\n${fileContents}`;
    }

    const userMsg = { role: "user", content: agentText };
    const newHistory = [...historyRef.current, userMsg];

    try {
      // Build system prompt
      const platformDbStr = [
        `Root Page: ${platformIds.rootPageId}`,
        `Knowledge Base: ${platformIds.kbDbId}`,
        `Page Configs: ${platformIds.configDbId}`,
        `Notifications: ${platformIds.notifDbId}`,
        `Automation Rules: ${platformIds.rulesDbId}`,
      ].join("\n");

      const systemPrompt = buildWasabiPrompt({
        platformDbIds: platformDbStr,
      });

      const { text: reply, history } = await runAgent({
        messages: newHistory,
        systemPrompt,
        tools: WASABI_TOOLS,
        model: "claude-sonnet-4-20250514",
        workerUrl: user.workerUrl,
        claudeKey: user.claudeKey,
        executeTool,
        onToolCall: (name, input, result) => {
          // Could show tool calls in UI if desired
          console.log(`[Wasabi Tool] ${name}`, input);
        },
        abortRef,
        maxTokens: 3000,
      });

      historyRef.current = history;

      // Extract choices from response
      const extracted = extractChoices(reply);

      // Clean choice markers from display text
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
  );
}
