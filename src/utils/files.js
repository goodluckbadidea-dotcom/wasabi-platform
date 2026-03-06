// ─── Wasabi Platform File Parsing (Transient) ───
// Parses uploaded files in-memory, returns text content for AI processing.
// No persistent storage — R2 integration flagged for future development.

/**
 * Parse a File object into text content for the agent.
 * Supports: CSV, TSV, TXT, MD, JSON, PDF (base64), XLSX, DOCX
 * Returns { text, type, name, size }
 */
export async function parseFile(file) {
  const name = file.name || "file";
  const ext = name.split(".").pop().toLowerCase();
  const size = file.size;

  try {
    switch (ext) {
      case "csv":
      case "tsv":
      case "txt":
      case "md":
        return { text: await readAsText(file), type: ext, name, size };

      case "json":
        const raw = await readAsText(file);
        // Pretty-print JSON for readability
        try {
          return { text: JSON.stringify(JSON.parse(raw), null, 2), type: "json", name, size };
        } catch {
          return { text: raw, type: "json", name, size };
        }

      case "pdf":
        // PDF → base64 (agent interprets via Claude's PDF reading)
        const b64 = await readAsBase64(file);
        return { text: `[PDF file: ${name}, ${formatBytes(size)}]`, type: "pdf", name, size, base64: b64 };

      case "xlsx":
      case "xls":
      case "xlsm":
        return await parseExcel(file, name, size);

      case "docx":
      case "doc":
        return await parseWord(file, name, size);

      default:
        // Try reading as text
        try {
          return { text: await readAsText(file), type: "text", name, size };
        } catch {
          return { text: `[Unsupported file type: ${ext}]`, type: "unknown", name, size };
        }
    }
  } catch (err) {
    return { text: `[Error parsing ${name}: ${err.message}]`, type: "error", name, size };
  }
}

function readAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Failed to read file as text"));
    reader.readAsText(file);
  });
}

function readAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      // Strip data URL prefix
      const base64 = result.split(",")[1] || result;
      resolve(base64);
    };
    reader.onerror = () => reject(new Error("Failed to read file as base64"));
    reader.readAsDataURL(file);
  });
}

function readAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Failed to read file as array buffer"));
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Lazy-load XLSX.js from CDN, parse spreadsheet to text
 */
async function parseExcel(file, name, size) {
  if (!window._XLSX) {
    await loadScript("https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js");
    window._XLSX = window.XLSX;
  }
  const XLSX = window._XLSX;
  const buffer = await readAsArrayBuffer(file);
  const workbook = XLSX.read(buffer, { type: "array" });

  const sheets = [];
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const csv = XLSX.utils.sheet_to_csv(sheet);
    sheets.push(`--- Sheet: ${sheetName} ---\n${csv}`);
  }
  return { text: sheets.join("\n\n"), type: "xlsx", name, size };
}

/**
 * Lazy-load Mammoth.js from CDN, parse Word doc to text
 */
async function parseWord(file, name, size) {
  if (!window._mammoth) {
    await loadScript("https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js");
    window._mammoth = window.mammoth;
  }
  const buffer = await readAsArrayBuffer(file);
  const result = await window._mammoth.extractRawText({ arrayBuffer: buffer });
  return { text: result.value, type: "docx", name, size };
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}
