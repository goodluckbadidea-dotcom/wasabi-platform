// ─── Wasabi Platform Markdown Renderer ───
// Renders markdown from agent responses into React elements.
// Supports: headings, bold, italic, code, code blocks, lists, tables, links, blockquotes.

import React from "react";
import { C, FONT, MONO, RADIUS } from "../design/tokens.js";

/**
 * Render a markdown string into React elements.
 * Lightweight — covers the subset of markdown that Claude typically generates.
 */
export function renderMarkdown(text) {
  if (!text) return null;

  const lines = text.split("\n");
  const elements = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Code block
    if (line.startsWith("```")) {
      const lang = line.slice(3).trim();
      const codeLines = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      elements.push(
        React.createElement("pre", {
          key: elements.length,
          style: {
            fontFamily: MONO,
            fontSize: 12,
            background: C.dark,
            color: C.darkText,
            borderRadius: RADIUS.lg,
            padding: "14px 18px",
            overflowX: "auto",
            lineHeight: 1.55,
            margin: "8px 0",
          },
        },
          React.createElement("code", null, codeLines.join("\n"))
        )
      );
      continue;
    }

    // Table (detect | delimited rows)
    if (line.includes("|") && line.trim().startsWith("|")) {
      const tableLines = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim().startsWith("|")) {
        tableLines.push(lines[i]);
        i++;
      }
      elements.push(renderTable(tableLines, elements.length));
      continue;
    }

    // Heading
    const headingMatch = line.match(/^(#{1,3})\s+(.+)/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const sizes = { 1: 18, 2: 15, 3: 13 };
      elements.push(
        React.createElement(`h${level}`, {
          key: elements.length,
          style: {
            fontSize: sizes[level],
            fontWeight: level === 1 ? 700 : 600,
            letterSpacing: "-0.01em",
            color: C.darkText,
            margin: `${level === 1 ? 16 : 12}px 0 6px`,
            lineHeight: 1.35,
          },
        }, renderInline(headingMatch[2]))
      );
      i++;
      continue;
    }

    // Blockquote
    if (line.startsWith("> ")) {
      const quoteLines = [];
      while (i < lines.length && lines[i].startsWith("> ")) {
        quoteLines.push(lines[i].slice(2));
        i++;
      }
      elements.push(
        React.createElement("blockquote", {
          key: elements.length,
          style: {
            borderLeft: `3px solid ${C.accent}`,
            paddingLeft: 14,
            margin: "8px 0",
            color: C.darkMuted,
            fontSize: 13,
            lineHeight: 1.6,
          },
        }, quoteLines.map((l, j) => renderInline(l)))
      );
      continue;
    }

    // Unordered list
    if (line.match(/^[\s]*[-*]\s+/)) {
      const listItems = [];
      while (i < lines.length && lines[i].match(/^[\s]*[-*]\s+/)) {
        listItems.push(lines[i].replace(/^[\s]*[-*]\s+/, ""));
        i++;
      }
      elements.push(
        React.createElement("ul", {
          key: elements.length,
          style: { margin: "6px 0", paddingLeft: 20, fontSize: 14, lineHeight: 1.65 },
        }, listItems.map((item, j) =>
          React.createElement("li", {
            key: j,
            style: { marginBottom: 3, color: C.darkText },
          }, renderInline(item))
        ))
      );
      continue;
    }

    // Ordered list
    if (line.match(/^\d+\.\s+/)) {
      const listItems = [];
      while (i < lines.length && lines[i].match(/^\d+\.\s+/)) {
        listItems.push(lines[i].replace(/^\d+\.\s+/, ""));
        i++;
      }
      elements.push(
        React.createElement("ol", {
          key: elements.length,
          style: { margin: "6px 0", paddingLeft: 20, fontSize: 14, lineHeight: 1.65 },
        }, listItems.map((item, j) =>
          React.createElement("li", {
            key: j,
            style: { marginBottom: 3, color: C.darkText },
          }, renderInline(item))
        ))
      );
      continue;
    }

    // Horizontal rule
    if (line.match(/^[-*_]{3,}\s*$/)) {
      elements.push(
        React.createElement("hr", {
          key: elements.length,
          style: { border: "none", height: 1, background: C.darkBorder, margin: "14px 0" },
        })
      );
      i++;
      continue;
    }

    // Empty line
    if (line.trim() === "") {
      i++;
      continue;
    }

    // Paragraph
    elements.push(
      React.createElement("p", {
        key: elements.length,
        style: { margin: "4px 0", fontSize: 14, lineHeight: 1.65, color: C.darkText },
      }, renderInline(line))
    );
    i++;
  }

  return elements;
}

/**
 * Render inline markdown: bold, italic, code, links
 */
function renderInline(text) {
  if (!text) return null;

  const parts = [];
  // Regex to match inline elements
  const regex = /(\*\*(.+?)\*\*)|(`(.+?)`)|(\[(.+?)\]\((.+?)\))|(_(.+?)_)/g;

  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    // Text before match
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }

    if (match[1]) {
      // Bold
      parts.push(
        React.createElement("strong", {
          key: parts.length,
          style: { fontWeight: 600 },
        }, match[2])
      );
    } else if (match[3]) {
      // Inline code
      parts.push(
        React.createElement("code", {
          key: parts.length,
          style: {
            fontFamily: MONO,
            fontSize: 12,
            background: C.darkSurf2,
            borderRadius: RADIUS.sm,
            padding: "2px 6px",
            color: C.darkMuted,
          },
        }, match[4])
      );
    } else if (match[5]) {
      // Link
      parts.push(
        React.createElement("a", {
          key: parts.length,
          href: match[7],
          target: "_blank",
          rel: "noopener noreferrer",
          style: { color: C.accent, textDecoration: "underline" },
        }, match[6])
      );
    } else if (match[8]) {
      // Italic
      parts.push(
        React.createElement("em", { key: parts.length }, match[9])
      );
    }

    lastIndex = match.index + match[0].length;
  }

  // Remaining text
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length === 1 ? parts[0] : parts;
}

/**
 * Render a markdown table
 */
function renderTable(lines, key) {
  const parseRow = (line) =>
    line.split("|").map((c) => c.trim()).filter((c) => c.length > 0);

  const rows = lines
    .filter((l) => !l.match(/^\|[\s-:|]+\|$/)) // skip separator row
    .map(parseRow);

  if (rows.length < 1) return null;

  const headers = rows[0];
  const body = rows.slice(1);

  return React.createElement("div", {
    key,
    style: {
      overflowX: "auto",
      margin: "8px 0",
      borderRadius: RADIUS.lg,
      border: `1px solid ${C.darkBorder}`,
    },
  },
    React.createElement("table", {
      style: { width: "100%", borderCollapse: "collapse", fontSize: 13 },
    },
      React.createElement("thead", null,
        React.createElement("tr", null,
          headers.map((h, j) =>
            React.createElement("th", {
              key: j,
              style: {
                textAlign: "left",
                padding: "8px 12px",
                fontSize: 11,
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                color: C.darkMuted,
                borderBottom: `1px solid ${C.darkBorder}`,
                background: C.darkSurf,
                whiteSpace: "nowrap",
              },
            }, h)
          )
        )
      ),
      React.createElement("tbody", null,
        body.map((row, i) =>
          React.createElement("tr", { key: i },
            row.map((cell, j) =>
              React.createElement("td", {
                key: j,
                style: {
                  padding: "8px 12px",
                  borderBottom: `1px solid ${C.darkBorder}`,
                  color: C.darkText,
                },
              }, renderInline(cell))
            )
          )
        )
      )
    )
  );
}
