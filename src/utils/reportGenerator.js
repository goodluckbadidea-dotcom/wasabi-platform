// ─── Report Generator ───
// Generates PDF reports from chat message content.
// Extracts tables, charts, and text from markdown and renders a themed report.
// Reads live theme tokens from the app's design system.

import { jsPDF } from "jspdf";
import { C } from "../design/tokens.js";

// ─── Helpers ───

/** Convert hex color (#RRGGBB or #RGB) to [r, g, b] array */
function hexToRgb(hex) {
  if (!hex || typeof hex !== "string") return [180, 180, 185];
  hex = hex.replace("#", "");
  // Strip alpha suffix if present (e.g. "5CC63A44" → "5CC63A")
  if (hex.length > 6) hex = hex.slice(0, 6);
  if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
  const n = parseInt(hex, 16);
  if (isNaN(n)) return [180, 180, 185];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Lighten an RGB array by a factor */
function lightenRgb(rgb, factor) {
  return rgb.map((c) => Math.round(c + (255 - c) * factor));
}

/** Darken an RGB array by a factor */
function darkenRgb(rgb, factor) {
  return rgb.map((c) => Math.round(c * (1 - factor)));
}

/**
 * Strip ALL non-ASCII characters (emoji, special Unicode) that jsPDF can't render.
 * Also strip markdown bold/italic/code/link formatting.
 */
function cleanText(text) {
  if (!text) return "";
  return text
    // Strip markdown
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/_(.+?)_/g, "$1")
    .replace(/`(.+?)`/g, "$1")
    .replace(/\[(.+?)\]\(.+?\)/g, "$1")
    // Strip emoji and non-Latin Unicode (keep basic ASCII + common Latin-1 supplement)
    .replace(/[\u{1F000}-\u{1FFFF}]/gu, "")
    .replace(/[\u{2600}-\u{27BF}]/gu, "")
    .replace(/[\u{FE00}-\u{FE0F}]/gu, "")
    .replace(/[\u{200B}-\u{200D}]/gu, "")
    .replace(/[\u{E0000}-\u{E007F}]/gu, "")
    // Replace common Unicode symbols with ASCII equivalents
    .replace(/\u2014/g, " -- ")  // em dash
    .replace(/\u2013/g, "-")     // en dash
    .replace(/\u2018|\u2019/g, "'")  // smart quotes
    .replace(/\u201C|\u201D/g, '"')  // smart double quotes
    .replace(/\u2026/g, "...")   // ellipsis
    .replace(/\u2022/g, "-")    // bullet
    .replace(/[\u0100-\u024F]/g, (c) => c.normalize("NFD").replace(/[\u0300-\u036f]/g, "")) // accented → base
    // Remove any remaining non-printable or unsupported chars
    .replace(/[^\x20-\x7E\n\r\t]/g, "")
    .trim();
}

// ─── Markdown Parser (extracts structured blocks) ───

function parseBlocks(text) {
  if (!text) return [];
  const lines = text.split("\n");
  const blocks = [];
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

      if (lang === "wasabi-chart") {
        try {
          const config = JSON.parse(codeLines.join("\n"));
          blocks.push({ type: "chart", config });
        } catch {
          blocks.push({ type: "code", content: codeLines.join("\n") });
        }
      } else {
        blocks.push({ type: "code", content: codeLines.join("\n") });
      }
      continue;
    }

    // Table
    if (line.includes("|") && line.trim().startsWith("|")) {
      const tableLines = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim().startsWith("|")) {
        tableLines.push(lines[i]);
        i++;
      }
      const parseRow = (l) => l.split("|").map((c) => c.trim()).filter((c) => c.length > 0);
      const rows = tableLines.filter((l) => !l.match(/^\|[\s-:|]+\|$/)).map(parseRow);
      if (rows.length >= 1) {
        blocks.push({ type: "table", headers: rows[0], rows: rows.slice(1) });
      }
      continue;
    }

    // Heading
    const headingMatch = line.match(/^(#{1,3})\s+(.+)/);
    if (headingMatch) {
      blocks.push({ type: "heading", level: headingMatch[1].length, text: cleanText(headingMatch[2]) });
      i++;
      continue;
    }

    // Horizontal rule
    if (line.match(/^[-*_]{3,}\s*$/)) {
      blocks.push({ type: "hr" });
      i++;
      continue;
    }

    // Bullet list
    if (line.match(/^[\s]*[-*]\s+/)) {
      const items = [];
      while (i < lines.length && lines[i].match(/^[\s]*[-*]\s+/)) {
        items.push(cleanText(lines[i].replace(/^[\s]*[-*]\s+/, "")));
        i++;
      }
      blocks.push({ type: "list", items });
      continue;
    }

    // Ordered list
    if (line.match(/^\d+\.\s+/)) {
      const items = [];
      while (i < lines.length && lines[i].match(/^\d+\.\s+/)) {
        items.push(cleanText(lines[i].replace(/^\d+\.\s+/, "")));
        i++;
      }
      blocks.push({ type: "olist", items });
      continue;
    }

    // Empty line
    if (line.trim() === "") {
      i++;
      continue;
    }

    // Paragraph
    blocks.push({ type: "text", content: cleanText(line) });
    i++;
  }

  return blocks;
}

// ─── Auto-generate chart from table data ───

/**
 * Analyze a table and produce a chart config if the data is chartable.
 * Looks for a numeric column paired with a label column.
 */
function autoChartFromTable(block) {
  const { headers, rows } = block;
  if (!headers || rows.length < 2 || rows.length > 20) return null;

  // Find numeric columns (>50% of values are numbers)
  const numericCols = [];
  const labelCols = [];
  for (let c = 0; c < headers.length; c++) {
    let numCount = 0;
    for (const row of rows) {
      const val = (row[c] || "").replace(/[$,%]/g, "").replace(/,/g, "").trim();
      if (val && !isNaN(Number(val))) numCount++;
    }
    if (numCount >= rows.length * 0.5) {
      numericCols.push(c);
    } else {
      labelCols.push(c);
    }
  }

  if (numericCols.length === 0 || labelCols.length === 0) return null;

  // Use first label column and first numeric column
  const labelCol = labelCols[0];
  const valueCol = numericCols[0];

  const data = rows.map((row) => ({
    label: cleanText(row[labelCol] || ""),
    value: Number((row[valueCol] || "0").replace(/[$,%]/g, "").replace(/,/g, "")) || 0,
  })).filter((d) => d.label);

  if (data.length < 2) return null;

  return {
    type: data.length <= 6 ? "bar" : "bar",
    title: cleanText(headers[valueCol]) || "Data",
    data,
  };
}


// ─── PDF Generator ───

/**
 * Generate a PDF report from a chat message's markdown content.
 * Uses the current app theme for colors.
 * @param {string} content - Markdown text from the assistant message
 * @param {string} [title] - Optional report title override
 * @returns {Blob} PDF blob for download
 */
export function generateReport(content, title) {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pw = doc.internal.pageSize.getWidth();
  const ph = doc.internal.pageSize.getHeight();
  const margin = 16;
  const contentW = pw - margin * 2;
  let y = margin;

  // Read theme colors
  const colBg = hexToRgb(C.dark);
  const colSurf = hexToRgb(C.darkSurf);
  const colSurf2 = hexToRgb(C.darkSurf2);
  const colText = hexToRgb(C.darkText);
  const colMuted = hexToRgb(C.darkMuted);
  const colAccent = hexToRgb(C.accent);
  const colBorder = hexToRgb(C.darkBorder);
  const colTableHead = darkenRgb(colSurf, 0.15);

  const CHART_COLORS = [
    colAccent,
    [88, 166, 222],  // blue
    [222, 166, 88],  // amber
    [222, 88, 120],  // rose
    [166, 88, 222],  // purple
    [88, 222, 188],  // teal
    [222, 128, 88],  // orange
    lightenRgb(colAccent, 0.3), // light accent
  ];

  const blocks = parseBlocks(content);

  // Detect title from first heading, or first bold text, or fallback
  let reportTitle = title || "";
  if (!reportTitle) {
    const firstHeading = blocks.find((b) => b.type === "heading");
    if (firstHeading) reportTitle = firstHeading.text;
  }
  if (!reportTitle) {
    // Try to extract from first text line that looks like a title
    const firstText = blocks.find((b) => b.type === "text");
    if (firstText && firstText.content.length < 80) reportTitle = firstText.content;
  }
  if (!reportTitle) reportTitle = "Wasabi Report";

  const dateStr = new Date().toLocaleDateString("en-US", {
    year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit",
  });

  // ─── Page utilities ───

  function drawPageBg() {
    doc.setFillColor(...colBg);
    doc.rect(0, 0, pw, ph, "F");
  }

  function checkPage(needed = 20) {
    if (y + needed > ph - 18) {
      doc.addPage();
      drawPageBg();
      y = margin;
      return true;
    }
    return false;
  }

  // ─── Page 1 ───
  drawPageBg();

  // Header block
  doc.setFillColor(...colSurf);
  doc.roundedRect(margin, y, contentW, 24, 3, 3, "F");
  doc.setFillColor(...colAccent);
  doc.rect(margin, y, 3, 24, "F");

  doc.setFontSize(15);
  doc.setTextColor(...colText);
  doc.setFont("helvetica", "bold");
  const titleClean = cleanText(reportTitle);
  const titleLines = doc.splitTextToSize(titleClean, contentW - 16);
  doc.text(titleLines[0] || "Report", margin + 10, y + 10.5);

  doc.setFontSize(8.5);
  doc.setTextColor(...colMuted);
  doc.setFont("helvetica", "normal");
  doc.text("Generated " + dateStr, margin + 10, y + 18);
  // Wasabi label on right
  doc.setFontSize(8);
  doc.setTextColor(...colAccent);
  doc.setFont("helvetica", "bold");
  doc.text("WASABI", margin + contentW - 5, y + 10.5, { align: "right" });
  doc.setFont("helvetica", "normal");

  y += 32;

  // ─── Render all blocks ───
  for (let bi = 0; bi < blocks.length; bi++) {
    const block = blocks[bi];

    // Skip first heading if used as title
    if (block === blocks[0] && block.type === "heading" && !title) continue;

    switch (block.type) {
      case "heading":
        _renderHeading(block);
        break;
      case "text":
        _renderText(block.content);
        break;
      case "list":
        _renderList(block.items, false);
        break;
      case "olist":
        _renderList(block.items, true);
        break;
      case "table":
        _renderTable(block);
        break;
      case "chart":
        _renderChart(block.config);
        break;
      case "code":
        _renderCode(block.content);
        break;
      case "hr":
        checkPage(8);
        doc.setDrawColor(...colBorder);
        doc.setLineWidth(0.3);
        doc.line(margin + 10, y + 3, margin + contentW - 10, y + 3);
        y += 8;
        break;
    }
  }

  // ─── Footers on all pages ───
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    // Subtle footer line
    doc.setDrawColor(...colBorder);
    doc.setLineWidth(0.2);
    doc.line(margin, ph - 12, margin + contentW, ph - 12);

    doc.setFontSize(7.5);
    doc.setTextColor(...colMuted);
    doc.setFont("helvetica", "normal");
    doc.text("Wasabi", margin, ph - 7);
    doc.text(p + " / " + totalPages, pw / 2, ph - 7, { align: "center" });
    doc.text(dateStr.split(",")[0], margin + contentW, ph - 7, { align: "right" });
  }

  return doc.output("blob");

  // ─── Block renderers (closures) ───

  function _renderHeading(block) {
    const sizes = { 1: 13, 2: 11, 3: 9.5 };
    const fontSize = sizes[block.level] || 9.5;
    const spacing = block.level === 1 ? 10 : 7;
    checkPage(fontSize + spacing + 4);

    y += spacing;

    // Accent underline for h1
    if (block.level === 1) {
      doc.setFillColor(...colAccent);
      doc.rect(margin, y - 2, 20, 0.8, "F");
    }

    doc.setFontSize(fontSize);
    doc.setTextColor(...colText);
    doc.setFont("helvetica", "bold");
    const wrapped = doc.splitTextToSize(block.text, contentW);
    doc.text(wrapped, margin, y + 2);
    y += wrapped.length * (fontSize * 0.42) + 5;
    doc.setFont("helvetica", "normal");
  }

  function _renderText(text) {
    if (!text) return;
    doc.setFontSize(9.5);
    doc.setTextColor(...colText);
    doc.setFont("helvetica", "normal");
    const wrapped = doc.splitTextToSize(text, contentW);
    const lineH = 4.2;
    checkPage(wrapped.length * lineH + 4);
    doc.text(wrapped, margin, y);
    y += wrapped.length * lineH + 3;
  }

  function _renderList(items, ordered) {
    doc.setFontSize(9.5);
    doc.setTextColor(...colText);
    doc.setFont("helvetica", "normal");
    const indent = 5;
    const lineH = 4.2;

    for (let idx = 0; idx < items.length; idx++) {
      const prefix = ordered ? `${idx + 1}. ` : "- ";
      const fullText = prefix + items[idx];
      const wrapped = doc.splitTextToSize(fullText, contentW - indent);
      checkPage(wrapped.length * lineH + 2);

      // Accent bullet dot for unordered
      if (!ordered) {
        doc.setFillColor(...colAccent);
        doc.circle(margin + 1.5, y - 1, 0.8, "F");
        doc.setTextColor(...colText);
      }

      doc.text(wrapped, margin + indent, y);
      y += wrapped.length * lineH + 1.5;
    }
    y += 2;
  }

  function _renderCode(content) {
    if (!content) return;
    doc.setFontSize(8);
    const cleaned = cleanText(content);
    const wrapped = doc.splitTextToSize(cleaned, contentW - 12);
    const lineH = 3.5;
    const blockH = wrapped.length * lineH + 10;
    checkPage(Math.min(blockH, 80));

    doc.setFillColor(...darkenRgb(colBg, 0.2));
    doc.roundedRect(margin, y, contentW, Math.min(blockH, 80), 2, 2, "F");
    doc.setDrawColor(...colBorder);
    doc.setLineWidth(0.2);
    doc.roundedRect(margin, y, contentW, Math.min(blockH, 80), 2, 2, "S");

    doc.setFont("courier", "normal");
    doc.setTextColor(...colMuted);
    const maxLines = Math.floor(70 / lineH);
    const displayLines = wrapped.slice(0, maxLines);
    doc.text(displayLines, margin + 6, y + 5);
    doc.setFont("helvetica", "normal");

    y += Math.min(blockH, 80) + 4;
  }

  function _renderTable(block) {
    const { headers, rows } = block;
    if (!headers || headers.length === 0) return;

    const numCols = headers.length;

    // Smart column widths based on content
    const colWidths = _calcColWidths(headers, rows, numCols);
    const cellPadX = 2.5;
    const headerH = 7.5;

    checkPage(headerH + 10);
    y += 4;

    const tableStartY = y;

    // Header row
    doc.setFillColor(...colTableHead);
    doc.roundedRect(margin, y, contentW, headerH, 1.5, 1.5, "F");
    doc.setFontSize(7.5);
    doc.setTextColor(...colMuted);
    doc.setFont("helvetica", "bold");

    let xOff = margin;
    for (let c = 0; c < numCols; c++) {
      const text = cleanText(headers[c] || "").toUpperCase();
      doc.text(text, xOff + cellPadX, y + 5, { maxWidth: colWidths[c] - cellPadX * 2 });
      xOff += colWidths[c];
    }
    y += headerH;

    // Data rows
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);

    for (let r = 0; r < rows.length; r++) {
      // Calculate row height based on content wrapping
      let maxCellH = 6;
      const cellTexts = [];
      for (let c = 0; c < numCols; c++) {
        const raw = cleanText(rows[r]?.[c] || "");
        const wrapped = doc.splitTextToSize(raw, colWidths[c] - cellPadX * 2);
        cellTexts.push(wrapped);
        const cellH = wrapped.length * 3.8 + 3;
        if (cellH > maxCellH) maxCellH = cellH;
      }

      // Cap row height
      const rowH = Math.min(maxCellH, 18);

      if (checkPage(rowH + 2)) {
        // Redraw header on new page
        doc.setFillColor(...colTableHead);
        doc.roundedRect(margin, y, contentW, headerH, 1.5, 1.5, "F");
        doc.setFontSize(7.5);
        doc.setTextColor(...colMuted);
        doc.setFont("helvetica", "bold");
        let xh = margin;
        for (let c = 0; c < numCols; c++) {
          doc.text(cleanText(headers[c] || "").toUpperCase(), xh + cellPadX, y + 5, { maxWidth: colWidths[c] - cellPadX * 2 });
          xh += colWidths[c];
        }
        y += headerH;
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8.5);
      }

      // Alternating row bg
      if (r % 2 === 0) {
        doc.setFillColor(...darkenRgb(colSurf, 0.08));
        doc.rect(margin, y, contentW, rowH, "F");
      }

      // Cell text
      doc.setTextColor(...colText);
      xOff = margin;
      for (let c = 0; c < numCols; c++) {
        const lines = cellTexts[c];
        // Only show lines that fit
        const maxLines = Math.floor((rowH - 1) / 3.8);
        const display = lines.slice(0, Math.max(1, maxLines));
        doc.text(display, xOff + cellPadX, y + 4);
        xOff += colWidths[c];
      }

      // Row bottom border
      doc.setDrawColor(...colBorder);
      doc.setLineWidth(0.15);
      doc.line(margin, y + rowH, margin + contentW, y + rowH);
      y += rowH;
    }

    // Table outer border
    doc.setDrawColor(...colBorder);
    doc.setLineWidth(0.3);
    doc.roundedRect(margin, tableStartY, contentW, y - tableStartY, 1.5, 1.5, "S");

    y += 4;

    // Auto-generate visualization from table data
    const autoChart = autoChartFromTable(block);
    if (autoChart) {
      _renderChart(autoChart);
    }
  }

  function _calcColWidths(headers, rows, numCols) {
    // Measure max content width per column
    doc.setFontSize(8.5);
    const widths = new Array(numCols).fill(0);

    for (let c = 0; c < numCols; c++) {
      // Header width
      widths[c] = Math.max(widths[c], doc.getTextWidth(cleanText(headers[c] || "").toUpperCase()) + 6);
      // Sample first 10 rows
      for (let r = 0; r < Math.min(rows.length, 10); r++) {
        const w = doc.getTextWidth(cleanText(rows[r]?.[c] || "")) + 6;
        widths[c] = Math.max(widths[c], Math.min(w, 65)); // Cap individual col at 65mm
      }
    }

    // Normalize to fit contentW
    const totalW = widths.reduce((a, b) => a + b, 0);
    if (totalW === 0) return new Array(numCols).fill(contentW / numCols);

    // Ensure minimum col width of 18mm
    const minW = 18;
    return widths.map((w) => Math.max(minW, (w / totalW) * contentW));
  }

  function _renderChart(config) {
    if (!config || !config.data?.length) return;

    const data = config.data;
    const type = config.type || "bar";

    // Dynamic height based on data
    let chartH;
    if (type === "metric") {
      chartH = 30;
    } else if (type === "bar") {
      chartH = Math.min(80, 12 + data.length * 7);
    } else {
      chartH = 55;
    }

    const containerH = chartH + (config.title ? 14 : 6);
    checkPage(containerH + 6);
    y += 3;

    // Chart container
    doc.setFillColor(...colSurf);
    doc.roundedRect(margin, y, contentW, containerH, 2.5, 2.5, "F");
    doc.setDrawColor(...colBorder);
    doc.setLineWidth(0.2);
    doc.roundedRect(margin, y, contentW, containerH, 2.5, 2.5, "S");

    // Title
    if (config.title) {
      doc.setFontSize(9);
      doc.setTextColor(...colText);
      doc.setFont("helvetica", "bold");
      doc.text(cleanText(config.title), margin + 8, y + 8);
      doc.setFont("helvetica", "normal");
    }

    const chartTop = y + (config.title ? 14 : 4);
    const chartLeft = margin + 6;
    const chartWidth = contentW - 12;

    if (type === "bar") {
      _drawBarChart(data, chartLeft, chartTop, chartWidth, chartH);
    } else if (type === "pie") {
      _drawPieChart(data, chartLeft, chartTop, chartWidth, chartH);
    } else if (type === "metric") {
      _drawMetrics(data, chartLeft, chartTop, chartWidth, chartH);
    } else if (type === "line") {
      _drawLineChart(data, chartLeft, chartTop, chartWidth, chartH);
    }

    y += containerH + 6;
  }

  function _drawBarChart(data, x, top, w, h) {
    const maxVal = Math.max(...data.map((d) => Number(d.value) || 0), 1);
    const gap = 1.5;
    const barH = Math.min(7, Math.max(3.5, (h - gap * data.length) / data.length));
    const labelW = Math.min(40, w * 0.25);
    const valueW = 22;
    const barAreaW = w - labelW - valueW - 4;

    for (let i = 0; i < data.length; i++) {
      const val = Number(data[i].value) || 0;
      const barW = Math.max(1.5, (val / maxVal) * barAreaW);
      const barY = top + i * (barH + gap);
      const color = CHART_COLORS[i % CHART_COLORS.length];

      // Label
      doc.setFontSize(7);
      doc.setTextColor(...colMuted);
      const label = cleanText(data[i].label || "").slice(0, 20);
      doc.text(label, x + labelW - 2, barY + barH * 0.65, { align: "right", maxWidth: labelW - 4 });

      // Bar background track
      doc.setFillColor(...darkenRgb(colBg, 0.1));
      doc.roundedRect(x + labelW, barY + 0.5, barAreaW, barH - 1, 1.5, 1.5, "F");

      // Bar fill
      doc.setFillColor(...color);
      doc.roundedRect(x + labelW, barY + 0.5, barW, barH - 1, 1.5, 1.5, "F");

      // Value
      doc.setFontSize(7.5);
      doc.setTextColor(...colText);
      doc.setFont("helvetica", "bold");
      const valStr = Number.isInteger(val) ? val.toLocaleString() : val.toFixed(1);
      doc.text(valStr, x + labelW + barAreaW + 3, barY + barH * 0.65);
      doc.setFont("helvetica", "normal");
    }
  }

  function _drawPieChart(data, x, top, w, h) {
    // jsPDF can't draw arcs easily, so render a proportional stacked bar + legend
    const total = data.reduce((s, d) => s + (Number(d.value) || 0), 0);
    if (total === 0) return;

    // Stacked horizontal bar
    const barY = top + 2;
    const barH = 8;
    let barX = x;

    for (let i = 0; i < data.length; i++) {
      const val = Number(data[i].value) || 0;
      const segW = (val / total) * w;
      const color = CHART_COLORS[i % CHART_COLORS.length];
      doc.setFillColor(...color);
      if (i === 0) {
        doc.roundedRect(barX, barY, segW, barH, 2, 2, "F");
      } else if (i === data.length - 1) {
        doc.roundedRect(barX, barY, segW, barH, 2, 2, "F");
      } else {
        doc.rect(barX, barY, segW, barH, "F");
      }
      barX += segW;
    }

    // Legend
    const legendTop = barY + barH + 5;
    const legendColW = Math.min(60, w / Math.min(data.length, 3));
    const cols = Math.min(3, data.length);

    for (let i = 0; i < data.length; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const lx = x + col * legendColW;
      const ly = legendTop + row * 6;
      const val = Number(data[i].value) || 0;
      const pct = ((val / total) * 100).toFixed(0);
      const color = CHART_COLORS[i % CHART_COLORS.length];

      doc.setFillColor(...color);
      doc.circle(lx + 1.5, ly - 1, 1.2, "F");

      doc.setFontSize(7);
      doc.setTextColor(...colText);
      doc.text(cleanText(data[i].label || "?").slice(0, 15) + " " + pct + "%", lx + 5, ly);
    }
  }

  function _drawMetrics(data, x, top, w, h) {
    const count = Math.min(data.length, 6);
    const gap = 4;
    const metricW = (w - gap * (count - 1)) / count;

    for (let i = 0; i < count; i++) {
      const mx = x + i * (metricW + gap);
      const color = CHART_COLORS[i % CHART_COLORS.length];

      // Metric card
      doc.setFillColor(...darkenRgb(colBg, 0.05));
      doc.roundedRect(mx, top, metricW, h - 4, 2, 2, "F");

      // Top accent line
      doc.setFillColor(...color);
      doc.rect(mx + 3, top, metricW - 6, 0.8, "F");

      // Label
      doc.setFontSize(6.5);
      doc.setTextColor(...colMuted);
      doc.text(cleanText(data[i].label || "").slice(0, 14), mx + 3, top + 6);

      // Value
      doc.setFontSize(12);
      doc.setTextColor(...colText);
      doc.setFont("helvetica", "bold");
      const val = data[i].value;
      const valStr = typeof val === "number"
        ? (Number.isInteger(val) ? val.toLocaleString() : val.toFixed(1))
        : cleanText(String(val || ""));
      doc.text(valStr + cleanText(data[i].suffix || ""), mx + 3, top + 15);
      doc.setFont("helvetica", "normal");

      // Trend arrow
      if (data[i].trend) {
        const tc = data[i].trend === "up" ? [72, 187, 88] : [220, 80, 70];
        doc.setFontSize(9);
        doc.setTextColor(...tc);
        doc.text(data[i].trend === "up" ? "^" : "v", mx + metricW - 6, top + 15);
      }
    }
  }

  function _drawLineChart(data, x, top, w, h) {
    if (data.length < 2) return;
    const maxVal = Math.max(...data.map((d) => Number(d.value) || 0), 1);
    const padL = 14;
    const padB = 8;
    const chartW = w - padL - 4;
    const chartH = h - padB;

    // Grid
    doc.setDrawColor(...lightenRgb(colBorder, 0.1));
    doc.setLineWidth(0.1);
    for (let g = 0; g <= 4; g++) {
      const gy = top + (g / 4) * chartH;
      doc.line(x + padL, gy, x + padL + chartW, gy);
      doc.setFontSize(6);
      doc.setTextColor(...colMuted);
      const gVal = maxVal * (1 - g / 4);
      doc.text(gVal.toFixed(0), x + padL - 2, gy + 1, { align: "right" });
    }

    // Area fill
    const points = data.map((d, i) => ({
      px: x + padL + (i / (data.length - 1)) * chartW,
      py: top + chartH - ((Number(d.value) || 0) / maxVal) * chartH,
    }));

    // jsPDF doesn't have polygon fill easily, so just draw the line
    doc.setDrawColor(...colAccent);
    doc.setLineWidth(0.7);
    for (let i = 0; i < points.length - 1; i++) {
      doc.line(points[i].px, points[i].py, points[i + 1].px, points[i + 1].py);
    }

    // Dots
    for (let i = 0; i < points.length; i++) {
      doc.setFillColor(...colAccent);
      doc.circle(points[i].px, points[i].py, 1, "F");
      // White inner dot
      doc.setFillColor(...colSurf);
      doc.circle(points[i].px, points[i].py, 0.4, "F");
    }

    // X-axis labels
    if (data.length <= 15) {
      doc.setFontSize(5.5);
      doc.setTextColor(...colMuted);
      for (let i = 0; i < points.length; i++) {
        const label = cleanText(data[i].label || "").slice(0, 10);
        doc.text(label, points[i].px, top + chartH + 5, { align: "center" });
      }
    }
  }
}

/**
 * Check if a markdown message has reportable content (tables, charts, data).
 */
export function hasReportableContent(content) {
  if (!content) return false;
  // Has a markdown table
  if (/\|.+\|/.test(content) && content.includes("---")) return true;
  // Has a chart code block
  if (content.includes("```wasabi-chart")) return true;
  // Has multiple headings (structured analysis)
  const headings = (content.match(/^#{1,3}\s+/gm) || []).length;
  if (headings >= 2) return true;
  return false;
}

/**
 * Trigger PDF download from a blob.
 */
export function downloadReport(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || `wasabi-report-${Date.now()}.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
