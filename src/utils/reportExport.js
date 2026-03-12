// ─── Report Export Utilities ───
// CSV download via Blob URL, PDF via browser print dialog.
// Zero external dependencies.

/**
 * Download data as a CSV file.
 * @param {string} title - Report title (used as filename)
 * @param {string[]} headers - Column headers
 * @param {Array[]} rows - Row data (arrays of values)
 * @returns {{ success: boolean, filename: string }}
 */
export function downloadCSV(title, headers, rows) {
  const escapeCSV = (val) => {
    if (val == null) return "";
    const str = String(val);
    if (str.includes(",") || str.includes('"') || str.includes("\n")) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const csvLines = [
    headers.map(escapeCSV).join(","),
    ...rows.map((row) => row.map(escapeCSV).join(",")),
  ];
  const csvString = csvLines.join("\n");

  const blob = new Blob([csvString], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const filename = `${(title || "report").replace(/[^a-zA-Z0-9_ -]/g, "")}.csv`;
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  // Revoke after a short delay to ensure download starts
  setTimeout(() => URL.revokeObjectURL(url), 5000);

  return { success: true, filename };
}

/**
 * Open a print dialog with a styled table for saving as PDF.
 * @param {string} title - Report title
 * @param {string[]} headers - Column headers
 * @param {Array[]} rows - Row data (arrays of values)
 * @param {string} [summary] - Optional summary text
 * @returns {{ success: boolean, method: string }}
 */
export function printPDF(title, headers, rows, summary) {
  const escapeHTML = (val) => {
    if (val == null) return "";
    return String(val)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  };

  const headerCells = headers.map((h) => `<th>${escapeHTML(h)}</th>`).join("");
  const bodyRows = rows.map((row) =>
    `<tr>${row.map((cell) => `<td>${escapeHTML(cell)}</td>`).join("")}</tr>`
  ).join("");

  const html = `<!DOCTYPE html>
<html>
<head>
  <title>${escapeHTML(title || "Report")}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 40px; color: #1a1a1a; }
    h1 { font-size: 20px; font-weight: 700; margin-bottom: 8px; }
    .summary { font-size: 13px; color: #666; margin-bottom: 20px; line-height: 1.5; }
    .meta { font-size: 11px; color: #999; margin-bottom: 16px; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th { text-align: left; padding: 8px 10px; font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: #666; border-bottom: 2px solid #ddd; background: #fafafa; }
    td { padding: 7px 10px; border-bottom: 1px solid #eee; }
    tr:nth-child(even) td { background: #fafafa; }
    @media print {
      body { padding: 20px; }
      @page { margin: 1cm; }
    }
  </style>
</head>
<body>
  <h1>${escapeHTML(title || "Report")}</h1>
  ${summary ? `<div class="summary">${escapeHTML(summary)}</div>` : ""}
  <div class="meta">Generated ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })} &middot; ${rows.length} rows</div>
  <table>
    <thead><tr>${headerCells}</tr></thead>
    <tbody>${bodyRows}</tbody>
  </table>
</body>
</html>`;

  const printWindow = window.open("", "_blank", "width=900,height=700");
  if (!printWindow) {
    return { success: false, error: "Pop-up blocked. Please allow pop-ups and try again." };
  }

  printWindow.document.write(html);
  printWindow.document.close();

  // Wait for content to render, then trigger print
  printWindow.onload = () => {
    setTimeout(() => {
      printWindow.print();
    }, 300);
  };

  return { success: true, method: "print_dialog" };
}
