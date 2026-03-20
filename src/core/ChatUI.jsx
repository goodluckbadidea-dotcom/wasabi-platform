// ─── Reusable Chat UI Component ───
// Used by Wasabi, page agents, system manager, automation builder.
// Centered layout with choices, file upload, and markdown rendering.
// Full dark mode. No emojis.

import React, { useState, useRef, useEffect, useCallback } from "react";
import { C, FONT, RADIUS } from "../design/tokens.js";
import { S } from "../design/styles.js";
import { ANIM, injectAnimations } from "../design/animations.js";
import { renderMarkdown } from "../utils/markdown.js";
import { parseFile } from "../utils/files.js";
import { IconPaperclip } from "../design/icons.jsx";
import { hasReportableContent, generateReport, downloadReport } from "../utils/reportGenerator.js";

export default function ChatUI({
  messages = [],
  onSend,
  isLoading = false,
  statusText = "", // Live status text shown below thinking dots
  choices = [],
  onChoice,
  allowFiles = true,
  agentName = "Wasabi",
  agentIcon = null, // React element (e.g. WasabiFlame)
  placeholder = "Type a message...",
  emptyState = null,
  compact = false, // Narrow mode for panels
}) {
  const [input, setInput] = useState("");
  const [focused, setFocused] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [files, setFiles] = useState([]);
  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => { injectAnimations(); }, []);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  // Auto-resize textarea
  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 140) + "px";
  }, []);

  useEffect(() => { autoResize(); }, [input, autoResize]);

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text && files.length === 0) return;
    if (isLoading) return;

    onSend({ text, files: files.length > 0 ? files : undefined });
    setInput("");
    setFiles([]);
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  }, [input, files, isLoading, onSend]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  const [fileWarnings, setFileWarnings] = useState([]);

  const processFiles = useCallback(async (rawFiles) => {
    const warnings = [];
    const toProcess = [];
    for (const f of rawFiles) {
      if (f.size > 2 * 1024 * 1024) {
        warnings.push(`${f.name} is ${(f.size / (1024 * 1024)).toFixed(1)}MB — large files may be slow to process`);
      }
      toProcess.push(f);
    }
    if (warnings.length) setFileWarnings(warnings);
    else setFileWarnings([]);
    const parsed = await Promise.all(toProcess.map(parseFile));
    return parsed;
  }, []);

  const handleFileDrop = useCallback(async (e) => {
    e.preventDefault();
    setDragOver(false);
    if (!allowFiles) return;
    const dropped = Array.from(e.dataTransfer?.files || []);
    const parsed = await processFiles(dropped);
    setFiles((prev) => [...prev, ...parsed]);
  }, [allowFiles, processFiles]);

  const handleFileSelect = useCallback(async (e) => {
    const selected = Array.from(e.target.files || []);
    const parsed = await processFiles(selected);
    setFiles((prev) => [...prev, ...parsed]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [processFiles]);

  const removeFile = useCallback((idx) => {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  // Per-message report generation state: { [msgIndex]: "idle" | "generating" | "ready" }
  const [reportStates, setReportStates] = useState({});
  const reportBlobsRef = useRef({});

  const handleGenerateReport = useCallback(async (msgIndex, content) => {
    setReportStates((prev) => ({ ...prev, [msgIndex]: "generating" }));
    try {
      // Run in a microtask to avoid blocking UI
      await new Promise((r) => setTimeout(r, 50));
      const blob = generateReport(content);
      reportBlobsRef.current[msgIndex] = blob;
      setReportStates((prev) => ({ ...prev, [msgIndex]: "ready" }));
    } catch (err) {
      console.error("Report generation failed:", err);
      setReportStates((prev) => ({ ...prev, [msgIndex]: "error" }));
    }
  }, []);

  const handleDownloadReport = useCallback((msgIndex) => {
    const blob = reportBlobsRef.current[msgIndex];
    if (blob) downloadReport(blob);
  }, []);

  const hasContent = input.trim().length > 0 || files.length > 0;
  const maxMsgW = compact ? "100%" : 680;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: C.dark }}>
      {/* Messages area */}
      <div style={{ ...S.messages, padding: compact ? "12px 0 8px" : "24px 0" }}>
        {messages.length === 0 && !isLoading && emptyState}

        {messages.map((msg, i) => (
          <div key={i} style={{
            ...S.msgOuter,
            padding: compact ? "4px 12px" : "4px 20px",
            justifyContent: msg.role === "user" ? "flex-end" : "center",
            animation: ANIM.settleIn(0.05),
          }}>
            {msg.role === "user" ? (
              <div style={{ maxWidth: maxMsgW, width: "100%", display: "flex", justifyContent: "flex-end" }}>
                <div style={S.bubbleUser}>{msg.content}</div>
              </div>
            ) : msg.role === "system" ? (
              <div style={{
                maxWidth: maxMsgW,
                width: "100%",
                fontSize: 12,
                color: C.darkMuted,
                fontStyle: "italic",
                padding: "8px 0",
                textAlign: "center",
              }}>
                {msg.content}
              </div>
            ) : (
              <div style={{ ...S.msgInner, maxWidth: maxMsgW }}>
                {!compact && (
                  <div style={{
                    ...S.avatarWrap,
                    ...(agentIcon ? { background: "transparent", overflow: "visible" } : {}),
                  }}>
                    {agentIcon || agentName.charAt(0)}
                  </div>
                )}
                <div style={{ flex: 1 }}>
                  <div style={S.bubbleAssistant}>
                    {renderMarkdown(msg.content)}
                  </div>
                  {msg.truncated && (
                    <div style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      marginTop: 6,
                      padding: "5px 10px",
                      background: "rgba(224,160,48,0.08)",
                      border: "1px solid rgba(224,160,48,0.2)",
                      borderRadius: 8,
                      fontSize: 11,
                      color: "#E0A030",
                      lineHeight: 1.4,
                    }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                        <circle cx="12" cy="12" r="10" />
                        <line x1="12" y1="8" x2="12" y2="12" />
                        <line x1="12" y1="16" x2="12.01" y2="16" />
                      </svg>
                      Response was cut short. Try asking me to continue or rephrase with a more specific question.
                    </div>
                  )}

                  {/* Report generation button — shown for data-rich messages */}
                  {msg.role === "assistant" && hasReportableContent(msg.content) && (
                    <div style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      marginTop: 8,
                      animation: ANIM.settleIn(0.1),
                    }}>
                      {(!reportStates[i] || reportStates[i] === "idle") && (
                        <button
                          onClick={() => handleGenerateReport(i, msg.content)}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                            background: C.accent + "14",
                            border: `1px solid ${C.accent}44`,
                            borderRadius: RADIUS.pill,
                            padding: "5px 12px",
                            fontSize: 11,
                            fontWeight: 500,
                            color: C.accent,
                            cursor: "pointer",
                            fontFamily: "inherit",
                            transition: "all 0.15s",
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background = C.accent + "28";
                            e.currentTarget.style.borderColor = C.accent + "66";
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = C.accent + "14";
                            e.currentTarget.style.borderColor = C.accent + "44";
                          }}
                        >
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                            <polyline points="14 2 14 8 20 8" />
                            <line x1="16" y1="13" x2="8" y2="13" />
                            <line x1="16" y1="17" x2="8" y2="17" />
                          </svg>
                          Generate Report
                        </button>
                      )}

                      {reportStates[i] === "generating" && (
                        <div style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          padding: "5px 12px",
                          fontSize: 11,
                          color: C.darkMuted,
                        }}>
                          <div style={{
                            width: 12,
                            height: 12,
                            border: `2px solid ${C.accent}44`,
                            borderTopColor: C.accent,
                            borderRadius: "50%",
                            animation: "spin 0.8s linear infinite",
                          }} />
                          Generating PDF...
                          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
                        </div>
                      )}

                      {reportStates[i] === "ready" && (
                        <button
                          onClick={() => handleDownloadReport(i)}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                            background: C.accent,
                            border: "none",
                            borderRadius: RADIUS.pill,
                            padding: "6px 14px",
                            fontSize: 11,
                            fontWeight: 600,
                            color: "#fff",
                            cursor: "pointer",
                            fontFamily: "inherit",
                            transition: "all 0.15s",
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.opacity = "0.85";
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.opacity = "1";
                          }}
                        >
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                            <polyline points="7 10 12 15 17 10" />
                            <line x1="12" y1="15" x2="12" y2="3" />
                          </svg>
                          Download Report
                        </button>
                      )}

                      {reportStates[i] === "error" && (
                        <div style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          fontSize: 11,
                          color: "#C13929",
                        }}>
                          Failed to generate report
                          <button
                            onClick={() => handleGenerateReport(i, msg.content)}
                            style={{
                              background: "transparent",
                              border: `1px solid #C1392944`,
                              borderRadius: RADIUS.sm,
                              padding: "2px 8px",
                              fontSize: 10,
                              color: "#C13929",
                              cursor: "pointer",
                              fontFamily: "inherit",
                            }}
                          >
                            Retry
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}

        {/* Thinking indicator */}
        {isLoading && (
          <div style={{ ...S.msgOuter, animation: ANIM.settleIn(), padding: compact ? "4px 12px" : "4px 20px" }}>
            <div style={{ ...S.msgInner, maxWidth: maxMsgW }}>
              {!compact && (
                <div style={{
                  ...S.avatarWrap,
                  ...(agentIcon ? { background: "transparent", overflow: "visible" } : {}),
                }}>
                  {agentIcon || agentName.charAt(0)}
                </div>
              )}
              <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: "12px 0" }}>
                <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                  {[0, 1, 2].map((i) => (
                    <div key={i} style={{
                      ...S.thinkingDot(i),
                      animation: ANIM.bounce(i),
                    }} />
                  ))}
                </div>
                {statusText && (
                  <div style={{
                    fontSize: 11,
                    color: C.darkMuted,
                    letterSpacing: "0.01em",
                    animation: ANIM.fadeIn(0.1),
                  }}>
                    {statusText}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Questions / Choices */}
        {choices.length > 0 && !isLoading && (
          <div style={{
            ...S.msgOuter,
            padding: compact ? "4px 12px" : "4px 20px",
            animation: ANIM.settleIn(0.1),
          }}>
            <div style={{
              maxWidth: maxMsgW,
              width: "100%",
              display: "flex",
              flexDirection: "column",
              gap: 10,
              padding: compact ? "4px 0" : "4px 44px",
            }}>
              {choices.map((item, i) => (
                item.question ? (
                  /* New format: question + answer options */
                  <div key={i} style={{ animation: ANIM.settleIn(0.05 + i * 0.04) }}>
                    <div style={{
                      fontSize: 12,
                      color: C.darkMuted,
                      marginBottom: 6,
                      fontWeight: 500,
                    }}>
                      {item.question}
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {item.options.map((opt, j) => (
                        <button
                          key={j}
                          onClick={() => onChoice?.({ label: opt.label || opt })}
                          style={{
                            ...S.btnChoice,
                            animation: ANIM.settleIn(0.08 + i * 0.04 + j * 0.02),
                          }}
                          onMouseEnter={(e) => {
                            e.target.style.background = C.accent + "28";
                            e.target.style.borderColor = C.accent + "66";
                          }}
                          onMouseLeave={(e) => {
                            e.target.style.background = C.accent + "14";
                            e.target.style.borderColor = C.accent + "44";
                          }}
                        >
                          {opt.label || opt}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  /* Legacy format: flat choice button */
                  <button
                    key={i}
                    onClick={() => onChoice?.(item)}
                    style={{
                      ...S.btnChoice,
                      animation: ANIM.settleIn(0.05 + i * 0.03),
                    }}
                    onMouseEnter={(e) => {
                      e.target.style.background = C.accent + "28";
                      e.target.style.borderColor = C.accent + "66";
                    }}
                    onMouseLeave={(e) => {
                      e.target.style.background = C.accent + "14";
                      e.target.style.borderColor = C.accent + "44";
                    }}
                  >
                    {item.label || item}
                  </button>
                )
              ))}
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* File warnings */}
      {fileWarnings.length > 0 && (
        <div style={{
          padding: compact ? "6px 12px" : "6px 20px",
          display: "flex",
          flexDirection: "column",
          gap: 4,
        }}>
          {fileWarnings.map((w, i) => (
            <div key={i} style={{
              fontSize: 11,
              color: "#E0A030",
              background: "rgba(224,160,48,0.08)",
              border: "1px solid rgba(224,160,48,0.2)",
              borderRadius: RADIUS.sm,
              padding: "4px 8px",
            }}>
              {w}
            </div>
          ))}
        </div>
      )}

      {/* File attachments preview */}
      {files.length > 0 && (
        <div style={{
          padding: compact ? "8px 12px 0" : "8px 20px 0",
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
        }}>
          {files.map((f, i) => (
            <div key={i} style={{
              background: C.darkSurf,
              borderRadius: RADIUS.pill,
              padding: "4px 10px",
              fontSize: 12,
              color: C.darkMuted,
              display: "flex",
              alignItems: "center",
              gap: 6,
              border: `1px solid ${C.darkBorder}`,
            }}>
              <span style={{ maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {f.name}
              </span>
              <span style={{ fontSize: 10, color: C.darkMuted, opacity: 0.6 }}>
                {f.size > 1024 ? (f.size / 1024).toFixed(0) + "K" : f.size + "B"}
              </span>
              <button
                onClick={() => removeFile(i)}
                style={{
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  color: C.darkMuted,
                  fontSize: 14,
                  padding: 0,
                  lineHeight: 1,
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Input area */}
      <div
        style={{
          ...S.inputBox,
          padding: compact ? "10px 12px 14px" : "12px 20px 16px",
          ...(dragOver ? { background: C.darkSurf2 } : {}),
        }}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleFileDrop}
      >
        <div style={{
          ...S.inputWrap,
          ...(focused ? S.inputWrapFocused : {}),
        }}>
          {allowFiles && (
            <>
              <button
                onClick={() => fileInputRef.current?.click()}
                style={{
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  color: C.darkMuted,
                  fontSize: 18,
                  padding: "0 8px 0 0",
                  display: "flex",
                  alignItems: "center",
                }}
                title="Attach file"
              >
                +
              </button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                onChange={handleFileSelect}
                style={{ display: "none" }}
                accept=".csv,.tsv,.txt,.md,.json,.pdf,.xlsx,.xls,.xlsm,.docx,.doc"
              />
            </>
          )}

          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder={placeholder}
            rows={1}
            style={S.textarea}
          />
        </div>

        <button
          onClick={handleSend}
          disabled={!hasContent || isLoading}
          style={{
            ...S.sendBtn,
            background: hasContent && !isLoading ? C.accent : C.darkSurf2,
            color: hasContent && !isLoading ? "#fff" : C.darkMuted,
            cursor: hasContent && !isLoading ? "pointer" : "default",
          }}
          title="Send"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </div>
    </div>
  );
}
