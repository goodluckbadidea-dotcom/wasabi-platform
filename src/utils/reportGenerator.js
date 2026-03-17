// ─── Report Generator ───
// Generates PDF reports from chat message content.
// Extracts tables, charts, and text from markdown and renders a clean report.

import { jsPDF } from "jspdf";

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
      blocks.push({ type: "heading", level: headingMatch[1].length, text: stripInline(headingMatch[2]) });
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
        items.push(stripInline(lines[i].replace(/^[\s]*[-*]\s+/, "")));
        i++;
      }
      blocks.push({ type: "list", items });
      continue;
    }

    // Ordered list
    if (line.match(/^\d+\.\s+/)) {
      const items = [];
      while (i < lines.length && lines[i].match(/^\d+\.\s+/)) {
        items.push(stripInline(lines[i].replace(/^\d+\.\s+/, "")));
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
    blocks.push({ type: "text", content: stripInline(line) });
    i++;
  }

  return blocks;
}

/** Strip markdown inline formatting (bold, italic, code, links) to plain text */
function stripInline(text) {
  if (!text) return "";
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")     // bold
    .replace(/_(.+?)_/g, "$1")             // italic
    .replace(/`(.+?)`/g, "$1")             // inline code
    .replace(/\[(.+?)\]\(.+?\)/g, "$1");   // links
}

// ─── PDF Generator ───

// Colors
const PDF_BG = [18, 18, 22];
const PDF_SURF = [28, 28, 34];
const PDF_TEXT = [230, 230, 235];
const PDF_MUTED = [140, 140, 150];
const PDF_ACCENT = [92, 198, 58]; // wasabi green
const PDF_BORDER = [50, 50, 58];
const PDF_TABLE_HEADER = [35, 35, 42];

const CHART_COLORS = [
  [92, 198, 58],   // green
  [58, 142, 198],  // blue
  [198, 142, 58],  // amber
  [198, 58, 92],   // red
  [142, 58, 198],  // purple
  [58, 198, 162],  // teal
  [198, 98, 58],   // orange
  [158, 198, 58],  // lime
];

/**
 * Generate a PDF report from a chat message's markdown content.
 * @param {string} content - Markdown text from the assistant message
 * @param {string} [title] - Optional report title override
 * @returns {Blob} PDF blob for download
 */
export function generateReport(content, title) {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pw = doc.internal.pageSize.getWidth();   // 210
  const ph = doc.internal.pageSize.getHeight();  // 297
  const margin = 15;
  const contentW = pw - margin * 2;
  let y = margin;

  const blocks = parseBlocks(content);

  // Detect title from first heading or use override
  let reportTitle = title || "Wasabi Report";
  if (!title && blocks.length > 0 && blocks[0].type === "heading") {
    reportTitle = blocks[0].text;
  }

  // ─── Page background ───
  function drawPageBg() {
    doc.setFillColor(...PDF_BG);
    doc.rect(0, 0, pw, ph, "F");
  }

  function checkPage(needed = 20) {
    if (y + needed > ph - margin) {
      doc.addPage();
      drawPageBg();
      drawFooter();
      y = margin;
    }
  }

  function drawFooter() {
    const pageNum = doc.getNumberOfPages();
    doc.setFontSize(8);
    doc.setTextColor(...PDF_MUTED);
    doc.text(`Page ${pageNum}`, pw / 2, ph - 8, { align: "center" });
    doc.text(new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }), pw - margin, ph - 8, { align: "right" });
  }

  drawPageBg();

  // ─── Header ───
  doc.setFillColor(...PDF_SURF);
  doc.roundedRect(margin, y, contentW, 22, 3, 3, "F");

  // Accent bar
  doc.setFillColor(...PDF_ACCENT);
  doc.rect(margin, y, 3, 22, "F");

  doc.setFontSize(16);
  doc.setTextColor(...PDF_TEXT);
  doc.setFont("helvetica", "bold");
  doc.text(reportTitle, margin + 10, y + 10);

  doc.setFontSize(9);
  doc.setTextColor(...PDF_MUTED);
  doc.setFont("helvetica", "normal");
  const dateStr = new Date().toLocaleDateString("en-US", {
    year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
  doc.text(`Generated ${dateStr}`, margin + 10, y + 17);

  y += 30;

  // ─── Render blocks ───
  for (const block of blocks) {
    // Skip the first heading if it was used as title
    if (block === blocks[0] && block.type === "heading" && !title) continue;

    switch (block.type) {
      case "heading":
        renderHeading(doc, block, margin, contentW);
        break;
      case "text":
        renderText(doc, block.content, margin, contentW);
        break;
      case "list":
        renderList(doc, block.items, margin, contentW, false);
        break;
      case "olist":
        renderList(doc, block.items, margin, contentW, true);
        break;
      case "table":
        renderTable(doc, block, margin, contentW);
        break;
      case "chart":
        renderChart(doc, block.config, margin, contentW);
        break;
      case "hr":
        checkPage(8);
        doc.setDrawColor(...PDF_BORDER);
        doc.setLineWidth(0.3);
        doc.line(margin, y + 3, margin + contentW, y + 3);
        y += 8;
        break;
      default:
        break;
    }
  }

  // Draw footer on all pages
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setFontSize(8);
    doc.setTextColor(...PDF_MUTED);
    doc.text(`Page ${p} of ${totalPages}`, pw / 2, ph - 8, { align: "center" });
    doc.text(dateStr.split(",")[0], pw - margin, ph - 8, { align: "right" });

    // Wasabi watermark
    doc.setFontSize(7);
    doc.setTextColor(...PDF_MUTED);
    doc.text("Wasabi", margin, ph - 8);
  }

  return doc.output("blob");

  // ─── Block renderers (closures over doc, y, margin, etc.) ───

  function renderHeading(doc, block) {
    const sizes = { 1: 14, 2: 12, 3: 10 };
    const fontSize = sizes[block.level] || 10;
    checkPage(fontSize + 8);
    y += block.level === 1 ? 8 : 5;
    doc.setFontSize(fontSize);
    doc.setTextColor(...PDF_TEXT);
    doc.setFont("helvetica", "bold");
    const wrappedLines = doc.splitTextToSize(block.text, contentW);
    doc.text(wrappedLines, margin, y);
    y += wrappedLines.length * (fontSize * 0.45) + 4;
    doc.setFont("helvetica", "normal");
  }

  function renderText(doc, text) {
    doc.setFontSize(10);
    doc.setTextColor(...PDF_TEXT);
    doc.setFont("helvetica", "normal");
    const wrappedLines = doc.splitTextToSize(text, contentW);
    const lineH = 4.5;
    checkPage(wrappedLines.length * lineH + 4);
    doc.text(wrappedLines, margin, y);
    y += wrappedLines.length * lineH + 3;
  }

  function renderList(doc, items, marginL, w, ordered) {
    doc.setFontSize(10);
    doc.setTextColor(...PDF_TEXT);
    doc.setFont("helvetica", "normal");
    const indent = 6;
    const lineH = 4.5;

    for (let idx = 0; idx < items.length; idx++) {
      const prefix = ordered ? `${idx + 1}. ` : "• ";
      const wrapped = doc.splitTextToSize(prefix + items[idx], w - indent);
      checkPage(wrapped.length * lineH + 2);
      doc.text(wrapped, marginL + indent, y);
      y += wrapped.length * lineH + 1.5;
    }
    y += 2;
  }

  function renderTable(doc, block) {
    const { headers, rows } = block;
    if (!headers || headers.length === 0) return;

    const numCols = headers.length;
    const colW = contentW / numCols;
    const cellPadX = 3;
    const rowH = 7;
    const headerH = 8;

    // Estimate total height
    const totalH = headerH + rows.length * rowH + 4;
    checkPage(Math.min(totalH, 60));

    y += 3;

    // Table border
    doc.setDrawColor(...PDF_BORDER);
    doc.setLineWidth(0.2);

    // Header row
    doc.setFillColor(...PDF_TABLE_HEADER);
    doc.rect(margin, y, contentW, headerH, "F");
    doc.setFontSize(8);
    doc.setTextColor(...PDF_MUTED);
    doc.setFont("helvetica", "bold");
    for (let c = 0; c < numCols; c++) {
      const text = headers[c] || "";
      const cellX = margin + c * colW + cellPadX;
      doc.text(text.toUpperCase(), cellX, y + 5.5, { maxWidth: colW - cellPadX * 2 });
    }
    y += headerH;

    // Data rows
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    for (let r = 0; r < rows.length; r++) {
      checkPage(rowH + 2);

      // Alternating row background
      if (r % 2 === 0) {
        doc.setFillColor(22, 22, 28);
        doc.rect(margin, y, contentW, rowH, "F");
      }

      doc.setTextColor(...PDF_TEXT);
      for (let c = 0; c < numCols; c++) {
        const text = (rows[r]?.[c] || "").toString();
        const cellX = margin + c * colW + cellPadX;
        doc.text(text, cellX, y + 5, { maxWidth: colW - cellPadX * 2 });
      }

      // Row border
      doc.setDrawColor(...PDF_BORDER);
      doc.line(margin, y + rowH, margin + contentW, y + rowH);
      y += rowH;
    }

    // Table outer border
    const tableTop = y - rows.length * rowH - headerH;
    doc.setDrawColor(...PDF_BORDER);
    doc.rect(margin, tableTop, contentW, y - tableTop);

    y += 5;
  }

  function renderChart(doc, config) {
    if (!config || !config.data?.length) return;

    const chartH = 50;
    checkPage(chartH + 15);

    y += 3;

    // Chart container
    doc.setFillColor(...PDF_SURF);
    doc.roundedRect(margin, y, contentW, chartH + 10, 2, 2, "F");

    // Title
    if (config.title) {
      doc.setFontSize(10);
      doc.setTextColor(...PDF_TEXT);
      doc.setFont("helvetica", "bold");
      doc.text(config.title, margin + 5, y + 7);
      doc.setFont("helvetica", "normal");
    }

    const chartTop = y + (config.title ? 12 : 5);
    const chartLeft = margin + 5;
    const chartWidth = contentW - 10;

    if (config.type === "bar") {
      renderBarChart(doc, config.data, chartLeft, chartTop, chartWidth, chartH - 5);
    } else if (config.type === "pie") {
      renderPieChart(doc, config.data, chartLeft, chartTop, chartWidth, chartH - 5);
    } else if (config.type === "metric") {
      renderMetricChart(doc, config.data, chartLeft, chartTop, chartWidth, chartH - 5);
    } else if (config.type === "line") {
      renderLineChart(doc, config.data, chartLeft, chartTop, chartWidth, chartH - 5);
    }

    y += chartH + 15;
  }

  function renderBarChart(doc, data, x, top, w, h) {
    const maxVal = Math.max(...data.map((d) => Number(d.value) || 0), 1);
    const barH = Math.min(6, (h - 4) / data.length);
    const labelW = 30;
    const barAreaW = w - labelW - 20;

    for (let i = 0; i < data.length; i++) {
      const val = Number(data[i].value) || 0;
      const barW = Math.max(1, (val / maxVal) * barAreaW);
      const barY = top + i * (barH + 2);
      const color = CHART_COLORS[i % CHART_COLORS.length];

      // Label
      doc.setFontSize(7);
      doc.setTextColor(...PDF_MUTED);
      const label = (data[i].label || "").slice(0, 15);
      doc.text(label, x + labelW - 2, barY + barH * 0.7, { align: "right" });

      // Bar
      doc.setFillColor(...color);
      doc.roundedRect(x + labelW, barY, barW, barH, 1, 1, "F");

      // Value
      doc.setFontSize(7);
      doc.setTextColor(...PDF_TEXT);
      const valStr = Number.isInteger(val) ? val.toLocaleString() : val.toFixed(1);
      doc.text(valStr, x + labelW + barW + 3, barY + barH * 0.7);
    }
  }

  function renderPieChart(doc, data, x, top, w, h) {
    // Render as legend-only in PDF (SVG arcs not supported in jsPDF natively)
    const total = data.reduce((s, d) => s + (Number(d.value) || 0), 0);
    const legendX = x + 5;
    let legendY = top + 3;

    doc.setFontSize(9);
    doc.setTextColor(...PDF_TEXT);
    doc.setFont("helvetica", "bold");
    doc.text(`Total: ${Number.isInteger(total) ? total.toLocaleString() : total.toFixed(1)}`, legendX, legendY);
    legendY += 6;
    doc.setFont("helvetica", "normal");

    for (let i = 0; i < data.length; i++) {
      const val = Number(data[i].value) || 0;
      const pct = total > 0 ? ((val / total) * 100).toFixed(0) : "0";
      const color = CHART_COLORS[i % CHART_COLORS.length];

      // Color dot
      doc.setFillColor(...color);
      doc.circle(legendX + 2, legendY - 1.2, 1.5, "F");

      doc.setFontSize(8);
      doc.setTextColor(...PDF_TEXT);
      doc.text(`${data[i].label || "?"}: ${val.toLocaleString()} (${pct}%)`, legendX + 6, legendY);
      legendY += 5;
    }
  }

  function renderMetricChart(doc, data, x, top, w, h) {
    const metricW = Math.min(45, (w - 4) / data.length);
    for (let i = 0; i < data.length; i++) {
      const mx = x + i * (metricW + 4);
      doc.setFillColor(22, 22, 28);
      doc.roundedRect(mx, top, metricW, h, 2, 2, "F");

      // Label
      doc.setFontSize(7);
      doc.setTextColor(...PDF_MUTED);
      doc.text((data[i].label || "").slice(0, 12), mx + 3, top + 5);

      // Value
      doc.setFontSize(14);
      doc.setTextColor(...PDF_TEXT);
      doc.setFont("helvetica", "bold");
      const val = data[i].value;
      const valStr = typeof val === "number"
        ? (Number.isInteger(val) ? val.toLocaleString() : val.toFixed(1))
        : String(val || "");
      doc.text(valStr + (data[i].suffix || ""), mx + 3, top + 14);
      doc.setFont("helvetica", "normal");

      // Trend
      if (data[i].trend) {
        const trendColor = data[i].trend === "up" ? [42, 107, 56] : [193, 57, 41];
        doc.setFontSize(10);
        doc.setTextColor(...trendColor);
        doc.text(data[i].trend === "up" ? "↑" : "↓", mx + metricW - 8, top + 14);
      }
    }
  }

  function renderLineChart(doc, data, x, top, w, h) {
    if (data.length < 2) return;
    const maxVal = Math.max(...data.map((d) => Number(d.value) || 0), 1);
    const padL = 15;
    const chartW = w - padL - 5;

    // Grid lines
    doc.setDrawColor(...PDF_BORDER);
    doc.setLineWidth(0.1);
    for (let g = 0; g <= 3; g++) {
      const gy = top + (g / 3) * h;
      doc.line(x + padL, gy, x + padL + chartW, gy);
      const gVal = maxVal * (1 - g / 3);
      doc.setFontSize(6);
      doc.setTextColor(...PDF_MUTED);
      doc.text(gVal.toFixed(0), x + padL - 2, gy + 1, { align: "right" });
    }

    // Line
    doc.setDrawColor(...PDF_ACCENT);
    doc.setLineWidth(0.6);
    const points = data.map((d, i) => ({
      x: x + padL + (i / (data.length - 1)) * chartW,
      y: top + h - ((Number(d.value) || 0) / maxVal) * h,
    }));
    for (let i = 0; i < points.length - 1; i++) {
      doc.line(points[i].x, points[i].y, points[i + 1].x, points[i + 1].y);
    }

    // Dots + labels
    for (let i = 0; i < points.length; i++) {
      doc.setFillColor(...PDF_ACCENT);
      doc.circle(points[i].x, points[i].y, 0.8, "F");
      if (data.length <= 12) {
        doc.setFontSize(5);
        doc.setTextColor(...PDF_MUTED);
        doc.text((data[i].label || "").slice(0, 8), points[i].x, top + h + 4, { align: "center" });
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
