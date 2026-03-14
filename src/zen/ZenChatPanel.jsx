// ─── Zen Chat Panel ───
// Simplified Wasabi Chat for Zen mode. Haiku-only, no tools.
// Focused on queries, summaries, and quick answers.
// Reuses ChatUI for rendering, bypasses the full agent pipeline.

import React, { useState, useRef, useCallback, useEffect } from "react";
import { C, FONT, RADIUS } from "../design/tokens.js";
import { TRANSITION } from "../design/animations.js";
import { usePlatform } from "../context/PlatformContext.jsx";
import { IconClose } from "../design/icons.jsx";
import WasabiFlame from "../core/WasabiFlame.jsx";
import ChatUI from "../core/ChatUI.jsx";
import { HAIKU } from "../agent/aiRouter.js";
import { fetchGoogleContext } from "../google/googleContext.js";
import * as api from "../lib/api.js";

const DEFAULT_WIDTH = 320;
const MIN_WIDTH = 280;
const MAX_WIDTH = 520;

const ZEN_SYSTEM_PROMPT = `You are Wasabi — a calm, focused AI assistant in Sashimi mode.

## Your Role
You help the user stay productive by answering questions, summarizing information, and providing quick insights. You are conversational, concise, and mindful.

## Guidelines
- Keep responses short and focused (1-3 paragraphs max unless depth is requested)
- Use bullet points for lists
- Be direct — no filler phrases
- If you don't know something, say so briefly
- You cannot create, edit, or delete data in this mode — you're read-only and conversational
- Markdown formatting is supported (bold, lists, headers, code blocks)

## Context
Today's date: ${new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
Mode: Sashimi (simplified, mindfulness-focused)`;

export default function ZenChatPanel({ onClose }) {
  const { user } = usePlatform();

  // ── State ──
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [statusText, setStatusText] = useState("");
  const historyRef = useRef([]); // Claude message format for conversation history
  const googleContextRef = useRef(""); // Cached Google context string

  // ── Resize ──
  const [panelWidth, setPanelWidth] = useState(DEFAULT_WIDTH);
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef({ startX: 0, startWidth: 0 });
  const isResized = panelWidth !== DEFAULT_WIDTH;

  const handleDragStart = useCallback((e) => {
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startWidth: panelWidth };
    setIsDragging(true);
  }, [panelWidth]);

  useEffect(() => {
    if (!isDragging) return;
    const handleDragMove = (e) => {
      const delta = e.clientX - dragRef.current.startX;
      const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, dragRef.current.startWidth + delta));
      setPanelWidth(newWidth);
    };
    const handleDragEnd = () => setIsDragging(false);

    document.addEventListener("mousemove", handleDragMove);
    document.addEventListener("mouseup", handleDragEnd);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    return () => {
      document.removeEventListener("mousemove", handleDragMove);
      document.removeEventListener("mouseup", handleDragEnd);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isDragging]);

  // ── Send message ──
  const handleSend = useCallback(async ({ text }) => {
    if (loading || !text?.trim()) return;

    // Add user message to display
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setLoading(true);
    setStatusText("Thinking...");

    // Build conversation history (keep last 6 exchanges = 12 messages)
    const newHistory = [
      ...historyRef.current.slice(-12),
      { role: "user", content: text },
    ];

    try {
      // Fetch Google context (cached 5 min) — best effort, don't block on failure
      try {
        const gStatus = await api.getGoogleStatus();
        if (gStatus?.connected) {
          googleContextRef.current = await fetchGoogleContext();
        }
      } catch { /* best effort */ }

      const systemPrompt = googleContextRef.current
        ? ZEN_SYSTEM_PROMPT + "\n\n" + googleContextRef.current
        : ZEN_SYSTEM_PROMPT;

      const result = await api.claudeProxy({
        model: HAIKU,
        system: systemPrompt,
        messages: newHistory,
        max_tokens: 1024,
      }, user?.claudeKey || "");

      // Extract text response
      const reply = result?.content
        ?.filter((c) => c.type === "text")
        .map((c) => c.text)
        .join("\n") || "I couldn't generate a response. Please try again.";

      // Update history
      historyRef.current = [
        ...newHistory,
        { role: "assistant", content: reply },
      ];

      setMessages((prev) => [...prev, { role: "assistant", content: reply }]);
    } catch (err) {
      console.error("[ZenChat] Error:", err);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `Something went wrong: ${err.message}` },
      ]);
    } finally {
      setLoading(false);
      setStatusText("");
    }
  }, [loading, user]);

  return (
    <div style={{
      width: panelWidth,
      flexShrink: 0,
      background: C.darkSurf,
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
      minHeight: 0,
      fontFamily: FONT,
      position: "relative",
      transition: isDragging ? "none" : TRANSITION.panelResize,
    }}>
      {/* ── Header ── */}
      <div style={{
        padding: "14px 14px 12px",
        flexShrink: 0,
        borderBottom: `1px solid ${C.darkBorder}`,
        background: C.dark,
        display: "flex",
        alignItems: "center",
        gap: 10,
      }}>
        <WasabiFlame size={24} />
        <span style={{
          fontFamily: FONT, fontSize: 13, fontWeight: 600,
          color: C.darkText, letterSpacing: "0.01em",
        }}>
          Wasabi
        </span>
        <span style={{
          fontSize: 9, fontFamily: FONT, color: C.darkMuted,
          background: C.darkSurf2, padding: "2px 6px",
          borderRadius: RADIUS.pill, letterSpacing: "0.05em",
          textTransform: "uppercase",
        }}>
          Sashimi
        </span>

        <div style={{ marginLeft: "auto", display: "flex", gap: 2 }}>
          {isResized && (
            <button
              onClick={() => setPanelWidth(DEFAULT_WIDTH)}
              title="Reset size"
              style={headerBtnStyle}
              onMouseEnter={(e) => { e.currentTarget.style.color = C.darkText; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = C.darkMuted; }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="4 14 10 14 10 20" />
                <polyline points="20 10 14 10 14 4" />
                <line x1="14" y1="10" x2="21" y2="3" />
                <line x1="3" y1="21" x2="10" y2="14" />
              </svg>
            </button>
          )}
          <button
            onClick={onClose}
            title="Close"
            style={headerBtnStyle}
            onMouseEnter={(e) => { e.currentTarget.style.color = C.darkText; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = C.darkMuted; }}
          >
            <IconClose size={12} color="currentColor" />
          </button>
        </div>
      </div>

      {/* ── Chat ── */}
      <ChatUI
        messages={messages}
        onSend={handleSend}
        isLoading={loading}
        statusText={statusText}
        allowFiles={false}
        agentName="Wasabi"
        agentIcon={<WasabiFlame size={20} />}
        placeholder="Ask anything..."
        compact={true}
        emptyState={
          <div style={{
            textAlign: "center", padding: "40px 20px",
            color: C.darkMuted, fontFamily: FONT,
          }}>
            <WasabiFlame size={32} />
            <div style={{ fontSize: 13, fontWeight: 600, marginTop: 12, color: C.darkText }}>
              Sashimi Chat
            </div>
            <div style={{ fontSize: 11, marginTop: 4, opacity: 0.6, lineHeight: 1.5 }}>
              Ask questions, get summaries,<br />or just think out loud.
            </div>
          </div>
        }
      />

      {/* ── Resize handle ── */}
      <div
        onMouseDown={handleDragStart}
        style={{
          position: "absolute",
          top: 0,
          right: -3,
          bottom: 0,
          width: 6,
          cursor: "col-resize",
          zIndex: 10,
        }}
      />
    </div>
  );
}

const headerBtnStyle = {
  background: "none",
  border: "none",
  cursor: "pointer",
  color: C.darkMuted,
  padding: 4,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: RADIUS.sm,
  transition: "color 0.12s",
};
