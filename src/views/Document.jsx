// ─── Document View ───
// Renders Notion page blocks as rich text.
// When editable=true, renders the DocumentEditor for Phase 1 rich editing.
// Otherwise renders in read-only mode.

import React, { useState, useEffect, useCallback } from "react";
import { C, FONT, MONO, RADIUS } from "../design/tokens.js";
import { usePlatform } from "../context/PlatformContext.jsx";
import { getBlocks } from "../notion/client.js";
import DocumentEditor from "./DocumentEditor.jsx";

/**
 * Render Notion rich_text array into React elements.
 */
function renderRichText(richTextArr) {
  if (!richTextArr || !richTextArr.length) return null;

  return richTextArr.map((rt, i) => {
    const { plain_text, annotations = {}, href } = rt;
    const { bold, italic, strikethrough, underline, code, color } = annotations;

    let style = {};
    if (bold) style.fontWeight = 700;
    if (italic) style.fontStyle = "italic";
    if (strikethrough) style.textDecoration = "line-through";
    if (underline) style.textDecoration = (style.textDecoration || "") + " underline";
    if (color && color !== "default") {
      if (color.endsWith("_background")) {
        style.background = colorToCSS(color.replace("_background", "")) + "22";
        style.padding = "1px 3px";
        style.borderRadius = 3;
      } else {
        style.color = colorToCSS(color);
      }
    }

    if (code) {
      return (
        <code key={i} style={{
          fontFamily: MONO,
          fontSize: "0.9em",
          background: C.darkSurf2,
          borderRadius: RADIUS.sm,
          padding: "2px 6px",
          color: C.darkMuted,
        }}>
          {plain_text}
        </code>
      );
    }

    if (href) {
      return (
        <a key={i} href={href} target="_blank" rel="noopener noreferrer"
          style={{ color: C.accent, textDecoration: "underline", ...style }}>
          {plain_text}
        </a>
      );
    }

    if (Object.keys(style).length > 0) {
      return <span key={i} style={style}>{plain_text}</span>;
    }

    return <React.Fragment key={i}>{plain_text}</React.Fragment>;
  });
}

/**
 * Map Notion color names to CSS values.
 */
function colorToCSS(color) {
  const map = {
    gray: "#9B9B9B",
    brown: "#A0826D",
    orange: "#E8A33D",
    yellow: "#DFCC5A",
    green: "#7DC143",
    blue: "#5B9CF6",
    purple: "#9B6CD6",
    pink: "#E05EB2",
    red: "#E05252",
    default: C.darkText,
  };
  return map[color] || C.darkText;
}

/**
 * Render a single Notion block.
 */
function BlockRenderer({ block, depth = 0 }) {
  const { type } = block;
  const content = block[type] || {};
  const text = renderRichText(content.rich_text);

  switch (type) {
    case "paragraph":
      return (
        <p style={{ margin: "6px 0", fontSize: 14, lineHeight: 1.7, color: C.darkText }}>
          {text || <span style={{ opacity: 0 }}>&nbsp;</span>}
        </p>
      );

    case "heading_1":
      return (
        <h1 style={{ fontSize: 22, fontWeight: 700, color: C.darkText, margin: "24px 0 8px", lineHeight: 1.3 }}>
          {text}
        </h1>
      );

    case "heading_2":
      return (
        <h2 style={{ fontSize: 18, fontWeight: 600, color: C.darkText, margin: "20px 0 6px", lineHeight: 1.35 }}>
          {text}
        </h2>
      );

    case "heading_3":
      return (
        <h3 style={{ fontSize: 15, fontWeight: 600, color: C.darkText, margin: "16px 0 4px", lineHeight: 1.4 }}>
          {text}
        </h3>
      );

    case "bulleted_list_item":
      return (
        <li style={{ fontSize: 14, lineHeight: 1.7, color: C.darkText, marginBottom: 2, marginLeft: depth * 20 }}>
          {text}
        </li>
      );

    case "numbered_list_item":
      return (
        <li style={{ fontSize: 14, lineHeight: 1.7, color: C.darkText, marginBottom: 2, marginLeft: depth * 20 }}>
          {text}
        </li>
      );

    case "to_do":
      return (
        <div style={{ display: "flex", alignItems: "flex-start", gap: 8, margin: "4px 0", marginLeft: depth * 20 }}>
          <span style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 16,
            height: 16,
            borderRadius: 3,
            border: `2px solid ${content.checked ? C.accent : C.darkBorder}`,
            background: content.checked ? C.accent : "transparent",
            color: "#fff",
            fontSize: 10,
            fontWeight: 700,
            flexShrink: 0,
            marginTop: 3,
          }}>
            {content.checked ? "\u2713" : ""}
          </span>
          <span style={{
            fontSize: 14,
            lineHeight: 1.7,
            color: C.darkText,
            textDecoration: content.checked ? "line-through" : "none",
            opacity: content.checked ? 0.6 : 1,
          }}>
            {text}
          </span>
        </div>
      );

    case "toggle":
      return (
        <details style={{ margin: "6px 0", marginLeft: depth * 20 }}>
          <summary style={{ fontSize: 14, lineHeight: 1.7, color: C.darkText, cursor: "pointer" }}>
            {text}
          </summary>
          {block.children && (
            <div style={{ paddingLeft: 16, marginTop: 4 }}>
              {block.children.map((child, i) => (
                <BlockRenderer key={child.id || i} block={child} depth={depth + 1} />
              ))}
            </div>
          )}
        </details>
      );

    case "code":
      return (
        <pre style={{
          fontFamily: MONO,
          fontSize: 12,
          background: C.dark,
          color: C.darkText,
          borderRadius: RADIUS.lg,
          padding: "14px 18px",
          overflowX: "auto",
          lineHeight: 1.55,
          margin: "8px 0",
        }}>
          <code>{content.rich_text?.map((rt) => rt.plain_text).join("") || ""}</code>
          {content.language && (
            <span style={{
              position: "absolute",
              top: 8,
              right: 12,
              fontSize: 10,
              color: C.darkMuted,
              textTransform: "uppercase",
            }}>
              {content.language}
            </span>
          )}
        </pre>
      );

    case "callout":
      return (
        <div style={{
          display: "flex",
          gap: 12,
          padding: "12px 16px",
          background: C.darkSurf2,
          borderRadius: RADIUS.lg,
          margin: "8px 0",
          borderLeft: `3px solid ${C.accent}`,
        }}>
          {content.icon && (
            <span style={{ fontSize: 18, flexShrink: 0 }}>
              {content.icon.emoji || "💡"}
            </span>
          )}
          <div style={{ fontSize: 14, lineHeight: 1.7, color: C.darkText }}>
            {text}
          </div>
        </div>
      );

    case "quote":
      return (
        <blockquote style={{
          borderLeft: `3px solid ${C.accent}`,
          paddingLeft: 14,
          margin: "8px 0",
          color: C.darkMuted,
          fontSize: 14,
          lineHeight: 1.7,
          fontStyle: "italic",
        }}>
          {text}
        </blockquote>
      );

    case "divider":
      return <hr style={{ border: "none", height: 1, background: C.darkBorder, margin: "16px 0" }} />;

    case "image":
      const url = content.file?.url || content.external?.url || "";
      return url ? (
        <div style={{ margin: "12px 0" }}>
          <img
            src={url}
            alt={content.caption?.map((c) => c.plain_text).join("") || "Image"}
            style={{ maxWidth: "100%", borderRadius: RADIUS.lg }}
          />
          {content.caption?.length > 0 && (
            <div style={{ fontSize: 12, color: C.darkMuted, marginTop: 6, textAlign: "center" }}>
              {renderRichText(content.caption)}
            </div>
          )}
        </div>
      ) : null;

    case "bookmark":
      return (
        <a
          href={content.url}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: "block",
            padding: "10px 14px",
            background: C.darkSurf2,
            border: `1px solid ${C.darkBorder}`,
            borderRadius: RADIUS.lg,
            color: C.accent,
            fontSize: 13,
            textDecoration: "none",
            margin: "6px 0",
          }}
        >
          {content.url}
        </a>
      );

    default:
      return null;
  }
}

/**
 * Group consecutive list items into <ul> or <ol> wrappers.
 */
function groupBlocks(blocks) {
  const result = [];
  let currentList = null;
  let listType = null;

  for (const block of blocks) {
    if (block.type === "bulleted_list_item") {
      if (listType !== "ul") {
        currentList = { type: "ul", items: [] };
        result.push(currentList);
        listType = "ul";
      }
      currentList.items.push(block);
    } else if (block.type === "numbered_list_item") {
      if (listType !== "ol") {
        currentList = { type: "ol", items: [] };
        result.push(currentList);
        listType = "ol";
      }
      currentList.items.push(block);
    } else {
      currentList = null;
      listType = null;
      result.push(block);
    }
  }

  return result;
}

export default function Document({ config = {}, editable = false, pageConfig }) {
  const { user } = usePlatform();
  const [blocks, setBlocks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const isStandalone = config?.standalone === true || pageConfig?.standalone === true;
  const pageId = config.pageId;

  // Standalone documents always use the DocumentEditor (they're always editable)
  if (isStandalone) {
    return <DocumentEditor config={config} pageConfig={pageConfig} />;
  }

  // Editable mode: render DocumentEditor for Notion-backed docs
  if (editable && pageId) {
    return <DocumentEditor pageId={pageId} config={config} pageConfig={pageConfig} />;
  }

  const fetchBlocks = useCallback(async () => {
    if (!user?.workerUrl || !user?.notionKey || !pageId) {
      setLoading(false);
      return;
    }

    try {
      const result = await getBlocks(user.workerUrl, user.notionKey, pageId);
      setBlocks(result || []);
      setError(null);
    } catch (err) {
      console.error("Failed to fetch blocks:", err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [user, pageId]);

  useEffect(() => {
    fetchBlocks();
  }, [fetchBlocks]);

  if (!pageId) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: C.darkMuted, fontSize: 14, fontFamily: FONT }}>
        No page ID configured for this document view.
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: C.darkMuted, fontSize: 14, fontFamily: FONT }}>
        <span style={{ animation: "spin 1s linear infinite", display: "inline-block" }}>&#x27F3;</span>
        {" "}Loading document...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: C.darkMuted, fontSize: 14, fontFamily: FONT }}>
        Failed to load document: {error}
      </div>
    );
  }

  const grouped = groupBlocks(blocks);

  return (
    <div style={{
      display: "flex",
      justifyContent: "center",
      overflowY: "auto",
      flex: 1,
      padding: "32px 24px",
      fontFamily: FONT,
    }}>
      <div style={{ width: "100%", maxWidth: 700 }}>
        {grouped.map((item, i) => {
          // List wrapper
          if (item.type === "ul" || item.type === "ol") {
            const Tag = item.type;
            return (
              <Tag key={i} style={{ margin: "6px 0", paddingLeft: 20, listStyleType: item.type === "ul" ? "disc" : "decimal" }}>
                {item.items.map((block, j) => (
                  <BlockRenderer key={block.id || j} block={block} />
                ))}
              </Tag>
            );
          }

          // Regular block
          return <BlockRenderer key={item.id || i} block={item} />;
        })}

        {blocks.length === 0 && (
          <div style={{ padding: 40, textAlign: "center", color: C.darkMuted, fontSize: 14 }}>
            This page has no content.
          </div>
        )}
      </div>
    </div>
  );
}
