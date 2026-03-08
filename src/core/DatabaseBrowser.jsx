// ─── Database Browser ───
// Search/browse Notion databases or paste a URL to connect.
// Used inside VisualPageBuilder for connecting databases to pages.

import React, { useState, useCallback, useEffect, useRef } from "react";
import { C, FONT, RADIUS, SHADOW } from "../design/tokens.js";
import { S } from "../design/styles.js";
import { usePlatform } from "../context/PlatformContext.jsx";
import { detectSchema, classifyProperties } from "../notion/schema.js";
import { createDatabase, createPage, ensurePageActive } from "../notion/client.js";
import { getConnection } from "../lib/api.js";
import { buildProp } from "../notion/properties.js";
import { IconSearch, IconDatabase, IconCheck, IconPlus, IconClose, IconTrash, IconSheet, IconBolt } from "../design/icons.jsx";
import { detectSheetType, validateSheetUrl } from "../sheets/sheetClient.js";
import { fetchBoards } from "../monday/client.js";

// ── Styles ──
const ds = {
  container: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },
  tabBar: {
    display: "flex",
    gap: 0,
    borderBottom: `1px solid ${C.darkBorder}`,
    marginBottom: 4,
  },
  tab: (active) => ({
    padding: "8px 16px",
    fontSize: 12,
    fontWeight: active ? 600 : 400,
    fontFamily: FONT,
    color: active ? C.accent : C.darkMuted,
    background: "transparent",
    border: "none",
    borderBottom: active ? `2px solid ${C.accent}` : "2px solid transparent",
    cursor: "pointer",
    transition: "all 0.15s",
  }),
  searchWrap: {
    display: "flex",
    alignItems: "center",
    background: C.darkSurf2,
    border: `1px solid ${C.darkBorder}`,
    borderRadius: RADIUS.md,
    padding: "0 10px",
    height: 38,
    transition: "border-color 0.15s",
  },
  searchInput: {
    flex: 1,
    border: "none",
    outline: "none",
    background: "transparent",
    fontFamily: FONT,
    fontSize: 13,
    color: C.darkText,
    padding: "0 8px",
    height: "100%",
  },
  resultsArea: {
    maxHeight: 320,
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  dbCard: (selected) => ({
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "12px 14px",
    background: selected ? `${C.accent}12` : C.darkSurf2,
    border: `1px solid ${selected ? C.accent : C.darkBorder}`,
    borderRadius: RADIUS.lg,
    cursor: "pointer",
    transition: "all 0.15s",
  }),
  dbIcon: {
    width: 36,
    height: 36,
    borderRadius: RADIUS.md,
    background: `${C.accent}18`,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  dbInfo: {
    flex: 1,
    minWidth: 0,
  },
  dbTitle: {
    fontSize: 13,
    fontWeight: 600,
    color: C.darkText,
    marginBottom: 2,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  dbMeta: {
    fontSize: 11,
    color: C.darkMuted,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  connectBtn: {
    padding: "6px 14px",
    fontSize: 11,
    fontWeight: 600,
    borderRadius: RADIUS.md,
    border: "none",
    background: C.accent,
    color: "#fff",
    cursor: "pointer",
    whiteSpace: "nowrap",
    transition: "opacity 0.15s",
    flexShrink: 0,
  },
  connectedBadge: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    padding: "4px 10px",
    fontSize: 11,
    fontWeight: 600,
    borderRadius: RADIUS.pill,
    background: `${C.accent}18`,
    color: C.accent,
    border: `1px solid ${C.accent}40`,
  },
  schemaPreview: {
    marginTop: 12,
    padding: 14,
    background: C.darkSurf2,
    border: `1px solid ${C.darkBorder}`,
    borderRadius: RADIUS.lg,
  },
  schemaTitle: {
    fontSize: 13,
    fontWeight: 600,
    color: C.darkText,
    marginBottom: 8,
  },
  schemaField: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "4px 0",
    fontSize: 12,
    color: C.darkText,
  },
  fieldType: {
    fontSize: 10,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    color: C.darkMuted,
    background: C.darkSurf,
    padding: "2px 6px",
    borderRadius: RADIUS.sm,
    flexShrink: 0,
  },
  emptyState: {
    textAlign: "center",
    padding: "32px 16px",
    color: C.darkMuted,
    fontSize: 13,
  },
  urlInput: {
    width: "100%",
    background: C.darkSurf2,
    border: `1px solid ${C.darkBorder}`,
    borderRadius: RADIUS.md,
    padding: "10px 14px",
    fontSize: 13,
    fontFamily: FONT,
    color: C.darkText,
    outline: "none",
    boxSizing: "border-box",
    transition: "border-color 0.15s",
  },
  hint: {
    fontSize: 11,
    color: C.darkMuted,
    marginTop: 4,
    lineHeight: 1.4,
  },
  errorMsg: {
    fontSize: 12,
    color: "#E05252",
    marginTop: 4,
  },
};

// ── Helpers ──

/** Extract a Notion database ID from a URL or raw ID string */
function extractDatabaseId(input) {
  if (!input) return null;
  const trimmed = input.trim();

  // Already a UUID (with or without dashes)
  const uuidPattern = /^[a-f0-9]{32}$/i;
  const uuidDashPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  if (uuidPattern.test(trimmed)) return trimmed;
  if (uuidDashPattern.test(trimmed)) return trimmed.replace(/-/g, "");

  // Notion URL patterns:
  // https://www.notion.so/workspace/abc123...?v=xyz
  // https://www.notion.so/abc123...
  const urlMatch = trimmed.match(/notion\.so\/(?:[^/]+\/)?([a-f0-9]{32})/i);
  if (urlMatch) return urlMatch[1];

  // URL with dashed UUID
  const urlDashMatch = trimmed.match(
    /notion\.so\/(?:[^/]+\/)?.*?([a-f0-9]{8}-?[a-f0-9]{4}-?[a-f0-9]{4}-?[a-f0-9]{4}-?[a-f0-9]{12})/i
  );
  if (urlDashMatch) return urlDashMatch[1].replace(/-/g, "");

  // Try: last 32 hex chars in the string (common Notion URL format)
  const hexTail = trimmed.match(/([a-f0-9]{32})\s*(?:\?.*)?$/i);
  if (hexTail) return hexTail[1];

  return null;
}

/** Summarize a schema for display */
function schemaFieldSummary(schema) {
  if (!schema) return [];
  return schema.allFields
    .filter((f) => f.type !== "title")
    .slice(0, 8)
    .map((f) => ({ name: f.name, type: f.type }));
}

/** Parse database results from Notion search API */
function parseSearchResults(results) {
  return results
    .filter((r) => r.object === "database" && !r.archived)
    .map((db) => ({
      id: db.id,
      title:
        db.title?.map((t) => t.plain_text).join("") ||
        "Untitled",
      icon: db.icon?.emoji || null,
      propertyCount: Object.keys(db.properties || {}).length,
      _raw: db,
    }));
}

// ── Main Component ──
export default function DatabaseBrowser({
  onConnect,
  onConnectSheet,
  onConnectMonday,
  connectedIds = [],
  multi = true,
}) {
  const { user, platformIds } = usePlatform();
  const [mode, setMode] = useState("browse"); // "browse" | "paste" | "create" | "monday"
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(null);

  // Paste mode
  const [pasteInput, setPasteInput] = useState("");
  const [pasteLoading, setPasteLoading] = useState(false);
  const [pasteError, setPasteError] = useState(null);
  const [sheetPreview, setSheetPreview] = useState(null); // { url, type } when a sheet URL is detected

  // Create mode
  const [newDbTitle, setNewDbTitle] = useState("");
  const [newDbFields, setNewDbFields] = useState([{ name: "Name", type: "title" }]);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState(null);

  // Upload mode
  const [uploadFile, setUploadFile] = useState(null); // { name, headers, rows, rawText }
  const [uploadDbTitle, setUploadDbTitle] = useState("");
  const [uploadColumns, setUploadColumns] = useState([]); // [{ name, type, sample }]
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(null); // { done, total }
  const [dragOver, setDragOver] = useState(false);

  // Monday mode
  const [mondayBoards, setMondayBoards] = useState([]);
  const [mondayLoading, setMondayLoading] = useState(false);
  const [mondayError, setMondayError] = useState(null);

  // Schema preview
  const [previewDb, setPreviewDb] = useState(null); // { id, title, schema }
  const [previewLoading, setPreviewLoading] = useState(false);

  const searchInputRef = useRef(null);

  // Focus search on mount
  useEffect(() => {
    if (mode === "browse" && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [mode]);

  // ── Search databases ──
  const searchDatabases = useCallback(
    async (q) => {
      const conn = getConnection();
      const workerUrl = user?.workerUrl || conn?.workerUrl;
      if (!workerUrl) return;
      setSearching(true);
      setSearchError(null);
      try {
        const searchHeaders = { "Content-Type": "application/json" };
        if (user?.notionKey) searchHeaders["Authorization"] = `Bearer ${user.notionKey}`;
        if (conn?.secret) searchHeaders["X-Wasabi-Key"] = conn.secret;

        const res = await fetch(`${workerUrl}/search`, {
          method: "POST",
          headers: searchHeaders,
          body: JSON.stringify({
            query: q || "",
            filter: { value: "database", property: "object" },
            page_size: 20,
          }),
        });
        if (!res.ok) throw new Error(`Search failed (${res.status})`);
        const data = await res.json();
        setResults(parseSearchResults(data.results || []));
      } catch (err) {
        setSearchError(err.message);
        setResults([]);
      } finally {
        setSearching(false);
      }
    },
    [user]
  );

  // Initial search on mount (browse all)
  useEffect(() => {
    if (mode === "browse") {
      searchDatabases("");
    }
  }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch Monday boards when switching to monday tab
  useEffect(() => {
    if (mode !== "monday") return;
    const mondayKey = user?.mondayKey;
    if (!mondayKey) {
      setMondayError("No Monday.com API key configured. Add it in System Manager → Connections.");
      setMondayBoards([]);
      return;
    }
    setMondayLoading(true);
    setMondayError(null);
    fetchBoards(mondayKey)
      .then((boards) => {
        setMondayBoards(boards || []);
        if (boards.length === 0) setMondayError("No boards found. Check your Monday.com API key permissions.");
      })
      .catch((err) => {
        setMondayError(err.message || "Failed to fetch Monday.com boards");
        setMondayBoards([]);
      })
      .finally(() => setMondayLoading(false));
  }, [mode, user?.mondayKey]);

  // Debounced search as user types
  const searchTimeout = useRef(null);
  const handleSearchChange = useCallback(
    (val) => {
      setQuery(val);
      clearTimeout(searchTimeout.current);
      searchTimeout.current = setTimeout(() => searchDatabases(val), 400);
    },
    [searchDatabases]
  );

  // ── Preview schema for a database ──
  const handlePreview = useCallback(
    async (db) => {
      if (previewDb?.id === db.id) {
        setPreviewDb(null);
        return;
      }
      setPreviewLoading(true);
      try {
        const schema = classifyProperties(db._raw);
        setPreviewDb({
          id: db.id,
          title: db.title,
          schema,
        });
      } catch {
        // Fallback: fetch the database fresh
        try {
          const schema = await detectSchema(
            user.workerUrl,
            user.notionKey,
            db.id.replace(/-/g, "")
          );
          setPreviewDb({ id: db.id, title: db.title, schema });
        } catch (err) {
          console.error("Schema preview failed:", err);
        }
      } finally {
        setPreviewLoading(false);
      }
    },
    [previewDb, user]
  );

  // ── Connect a database ──
  const handleConnect = useCallback(
    (dbId, title, schema) => {
      if (onConnect) {
        onConnect({
          id: dbId.replace(/-/g, ""),
          title,
          schema,
        });
      }
    },
    [onConnect]
  );

  // ── Paste URL / ID handler ──
  const handlePaste = useCallback(async () => {
    setSheetPreview(null);

    // Check if this is a Google Sheet or CSV URL first
    const sheetValidation = validateSheetUrl(pasteInput);
    if (sheetValidation.type === "google_sheets" || sheetValidation.type === "csv") {
      if (sheetValidation.valid) {
        setSheetPreview({ url: pasteInput.trim(), type: sheetValidation.type });
        setPasteError(null);
        setPreviewDb(null);
      } else {
        setPasteError(sheetValidation.error || "Invalid sheet URL");
      }
      return;
    }
    if (sheetValidation.type === "unsupported") {
      setPasteError(sheetValidation.error || "This provider is not yet supported");
      return;
    }

    // Otherwise try as a Notion database URL/ID
    const dbId = extractDatabaseId(pasteInput);
    if (!dbId) {
      setPasteError("Could not find a valid database ID. Try pasting the full Notion URL.");
      return;
    }

    setPasteLoading(true);
    setPasteError(null);
    try {
      const schema = await detectSchema(user.workerUrl, user.notionKey, dbId);
      setPreviewDb({ id: dbId, title: schema.databaseTitle, schema });
    } catch (err) {
      setPasteError(
        err.message?.includes("401")
          ? "Access denied. Make sure your Notion integration has access to this database."
          : err.message || "Could not access database"
      );
    } finally {
      setPasteLoading(false);
    }
  }, [pasteInput, user]);

  const isConnected = (dbId) =>
    connectedIds.some((id) => id.replace(/-/g, "") === dbId.replace(/-/g, ""));

  return (
    <div style={ds.container}>
      {/* Tab bar: Browse | Paste URL */}
      <div style={ds.tabBar}>
        <button style={ds.tab(mode === "browse")} onClick={() => setMode("browse")}>
          Browse Databases
        </button>
        <button style={ds.tab(mode === "paste")} onClick={() => setMode("paste")}>
          Paste URL / ID
        </button>
        <button style={ds.tab(mode === "create")} onClick={() => setMode("create")}>
          Create New
        </button>
        <button style={ds.tab(mode === "upload")} onClick={() => setMode("upload")}>
          Upload File
        </button>
        <button style={ds.tab(mode === "monday")} onClick={() => setMode("monday")}>
          Monday.com
        </button>
      </div>

      {/* ── Browse Mode ── */}
      {mode === "browse" && (
        <>
          <div
            style={{
              ...ds.searchWrap,
              ...(query ? { borderColor: C.accent } : {}),
            }}
          >
            <IconSearch size={14} color={C.darkMuted} />
            <input
              ref={searchInputRef}
              type="text"
              placeholder="Search your Notion databases..."
              value={query}
              onChange={(e) => handleSearchChange(e.target.value)}
              style={ds.searchInput}
            />
            {query && (
              <span
                style={{ cursor: "pointer", padding: "0 4px" }}
                onClick={() => {
                  setQuery("");
                  searchDatabases("");
                }}
              >
                <IconClose size={10} color={C.darkMuted} />
              </span>
            )}
          </div>

          <div style={ds.resultsArea}>
            {searching && results.length === 0 && (
              <div style={ds.emptyState}>Searching...</div>
            )}

            {!searching && searchError && (
              <div style={ds.emptyState}>
                <div style={{ color: "#E05252", marginBottom: 4 }}>{searchError}</div>
                <button
                  style={{ ...S.btnGhost, fontSize: 12 }}
                  onClick={() => searchDatabases(query)}
                >
                  Retry
                </button>
              </div>
            )}

            {!searching && !searchError && results.length === 0 && (
              <div style={ds.emptyState}>
                {query
                  ? "No databases found matching your search."
                  : "No databases found. Make sure your Notion integration has access to at least one database."}
              </div>
            )}

            {results.map((db) => {
              const connected = isConnected(db.id);
              const previewing = previewDb?.id === db.id;

              return (
                <div key={db.id}>
                  <div
                    style={ds.dbCard(previewing)}
                    onClick={() => handlePreview(db)}
                    onMouseEnter={(e) => {
                      if (!previewing) e.currentTarget.style.borderColor = C.darkMuted;
                    }}
                    onMouseLeave={(e) => {
                      if (!previewing) e.currentTarget.style.borderColor = C.darkBorder;
                    }}
                  >
                    <div style={ds.dbIcon}>
                      {db.icon ? (
                        <span style={{ fontSize: 18 }}>{db.icon}</span>
                      ) : (
                        <IconDatabase size={18} color={C.accent} />
                      )}
                    </div>
                    <div style={ds.dbInfo}>
                      <div style={ds.dbTitle}>{db.title}</div>
                      <div style={ds.dbMeta}>
                        {db.propertyCount} properties
                      </div>
                    </div>

                    {connected ? (
                      <span style={ds.connectedBadge}>
                        <IconCheck size={12} color={C.accent} /> Connected
                      </span>
                    ) : (
                      <button
                        style={ds.connectBtn}
                        onClick={(e) => {
                          e.stopPropagation();
                          const schema = classifyProperties(db._raw);
                          handleConnect(db.id, db.title, schema);
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.opacity = "0.85"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.opacity = "1"; }}
                      >
                        Connect
                      </button>
                    )}
                  </div>

                  {/* Schema preview expansion */}
                  {previewing && previewDb?.schema && (
                    <SchemaPreview
                      schema={previewDb.schema}
                      isConnected={connected}
                      onConnect={() => handleConnect(db.id, db.title, previewDb.schema)}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* ── Paste Mode ── */}
      {mode === "paste" && (
        <>
          <div>
            <input
              type="text"
              style={ds.urlInput}
              value={pasteInput}
              onChange={(e) => {
                setPasteInput(e.target.value);
                setPasteError(null);
                setSheetPreview(null);
              }}
              placeholder="Paste a Notion database URL, Google Sheet URL, or CSV link..."
              onKeyDown={(e) => {
                if (e.key === "Enter") handlePaste();
              }}
            />
            <div style={ds.hint}>
              Examples: https://notion.so/workspace/abc123... or https://docs.google.com/spreadsheets/d/...
            </div>
            {pasteError && <div style={ds.errorMsg}>{pasteError}</div>}
          </div>

          <button
            style={{
              ...ds.connectBtn,
              width: "100%",
              padding: "10px 16px",
              fontSize: 13,
              opacity: pasteLoading || !pasteInput.trim() ? 0.5 : 1,
              cursor: pasteLoading || !pasteInput.trim() ? "not-allowed" : "pointer",
            }}
            onClick={handlePaste}
            disabled={pasteLoading || !pasteInput.trim()}
          >
            {pasteLoading ? "Looking up database..." : "Look Up Database"}
          </button>

          {/* Sheet URL detected preview */}
          {sheetPreview && (
            <div style={{
              padding: 16,
              background: C.darkSurf2,
              border: `1px solid ${C.darkBorder}`,
              borderRadius: RADIUS.md,
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <IconSheet size={20} color={C.accent} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: C.darkText }}>
                    {sheetPreview.type === "google_sheets" ? "Google Sheet detected" : "CSV file detected"}
                  </div>
                  <div style={{ fontSize: 11, color: C.darkMuted, marginTop: 2, wordBreak: "break-all" }}>
                    {sheetPreview.url.length > 80 ? sheetPreview.url.slice(0, 80) + "..." : sheetPreview.url}
                  </div>
                </div>
              </div>
              <div style={{ fontSize: 12, color: C.darkMuted, lineHeight: 1.5 }}>
                This will be added as a <strong style={{ color: C.darkText }}>Linked Sheet</strong> view —
                a read-only table that stays in sync with the source.
              </div>
              <button
                style={{
                  ...ds.connectBtn,
                  width: "100%",
                  padding: "10px 16px",
                  fontSize: 13,
                }}
                onClick={() => {
                  if (onConnectSheet) {
                    onConnectSheet({ sheetUrl: sheetPreview.url, sheetType: sheetPreview.type });
                  }
                  setSheetPreview(null);
                  setPasteInput("");
                }}
                onMouseEnter={(e) => { e.currentTarget.style.opacity = "0.85"; }}
                onMouseLeave={(e) => { e.currentTarget.style.opacity = "1"; }}
              >
                Connect as Linked Sheet
              </button>
            </div>
          )}

          {/* Schema preview for pasted DB */}
          {previewDb?.schema && mode === "paste" && !sheetPreview && (
            <SchemaPreview
              schema={previewDb.schema}
              isConnected={isConnected(previewDb.id)}
              onConnect={() =>
                handleConnect(previewDb.id, previewDb.title, previewDb.schema)
              }
            />
          )}
        </>
      )}

      {/* ── Upload Mode ── */}
      {mode === "upload" && (
        <UploadDatabaseForm
          uploadFile={uploadFile}
          setUploadFile={setUploadFile}
          uploadDbTitle={uploadDbTitle}
          setUploadDbTitle={setUploadDbTitle}
          uploadColumns={uploadColumns}
          setUploadColumns={setUploadColumns}
          uploading={uploading}
          uploadError={uploadError}
          uploadProgress={uploadProgress}
          dragOver={dragOver}
          setDragOver={setDragOver}
          onSubmit={async () => {
            if (!uploadFile) return;
            if (!uploadDbTitle.trim()) { setUploadError("Database name is required."); return; }
            if (uploadColumns.some((c) => !c.name.trim())) { setUploadError("All columns must have a name."); return; }

            setUploading(true);
            setUploadError(null);
            setUploadProgress(null);
            try {
              await ensurePageActive(user.workerUrl, user.notionKey, platformIds.rootPageId);

              // Build schema: first column with type=title, rest as detected
              const schema = uploadColumns.map((col, i) => ({
                name: col.name.trim(),
                type: i === 0 ? "title" : col.type,
                ...(col.options ? { options: col.options.split(",").map((o) => o.trim()).filter(Boolean) } : {}),
              }));

              const result = await createDatabase(
                user.workerUrl, user.notionKey,
                platformIds.rootPageId,
                uploadDbTitle.trim(),
                schema
              );
              const dbId = result.id;

              // Bulk create records
              const rows = uploadFile.rows;
              const total = rows.length;
              let done = 0;
              setUploadProgress({ done: 0, total });

              // Batch in groups of 3 for reasonable parallelism
              for (let i = 0; i < total; i += 3) {
                const batch = rows.slice(i, i + 3);
                await Promise.all(
                  batch.map((row) => {
                    const properties = {};
                    uploadColumns.forEach((col, ci) => {
                      const val = row[ci];
                      if (val !== undefined && val !== null && val !== "") {
                        const type = ci === 0 ? "title" : col.type;
                        const built = buildProp(type, val);
                        if (built) properties[col.name.trim()] = built;
                      }
                    });
                    return createPage(user.workerUrl, user.notionKey, dbId, properties);
                  })
                );
                done += batch.length;
                setUploadProgress({ done: Math.min(done, total), total });
              }

              // Detect schema and connect
              const detectedSchema = await detectSchema(user.workerUrl, user.notionKey, dbId);
              handleConnect(dbId, uploadDbTitle.trim(), detectedSchema);

              // Reset upload form
              setUploadFile(null);
              setUploadDbTitle("");
              setUploadColumns([]);
              setUploadProgress(null);
            } catch (err) {
              setUploadError(err.message || "Failed to import file");
            } finally {
              setUploading(false);
            }
          }}
        />
      )}

      {/* ── Monday.com Mode ── */}
      {mode === "monday" && (
        <>
          {mondayLoading && (
            <div style={ds.emptyState}>Loading Monday.com boards...</div>
          )}

          {!mondayLoading && mondayError && (
            <div style={ds.emptyState}>
              <div style={{ color: "#E05252", marginBottom: 8 }}>{mondayError}</div>
              {!user?.mondayKey && (
                <div style={{ fontSize: 11, color: C.darkMuted, lineHeight: 1.5 }}>
                  Go to <strong>System Manager → Connections</strong> to add your Monday.com API key.
                </div>
              )}
            </div>
          )}

          {!mondayLoading && !mondayError && mondayBoards.length === 0 && (
            <div style={ds.emptyState}>No boards found.</div>
          )}

          {!mondayLoading && mondayBoards.length > 0 && (
            <div style={ds.resultsArea}>
              {mondayBoards.map((board) => {
                const colCount = board.columns?.length || 0;
                return (
                  <div
                    key={board.id}
                    style={ds.dbCard(false)}
                    onMouseEnter={(e) => { e.currentTarget.style.borderColor = C.darkMuted; }}
                    onMouseLeave={(e) => { e.currentTarget.style.borderColor = C.darkBorder; }}
                  >
                    <div style={ds.dbIcon}>
                      <IconBolt size={18} color={C.accent} />
                    </div>
                    <div style={ds.dbInfo}>
                      <div style={ds.dbTitle}>{board.name}</div>
                      <div style={ds.dbMeta}>{colCount} columns</div>
                    </div>
                    <button
                      style={ds.connectBtn}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (onConnectMonday) {
                          onConnectMonday({ boardId: board.id, name: board.name, columns: board.columns });
                        }
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.opacity = "0.85"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.opacity = "1"; }}
                    >
                      Connect Board
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* ── Create Mode ── */}
      {mode === "create" && (
        <CreateDatabaseForm
          newDbTitle={newDbTitle}
          setNewDbTitle={setNewDbTitle}
          newDbFields={newDbFields}
          setNewDbFields={setNewDbFields}
          creating={creating}
          createError={createError}
          onSubmit={async () => {
            if (!newDbTitle.trim()) {
              setCreateError("Database name is required.");
              return;
            }
            if (newDbFields.some((f) => !f.name.trim())) {
              setCreateError("All fields must have a name.");
              return;
            }
            setCreating(true);
            setCreateError(null);
            try {
              // Ensure root page is active (auto-unarchive if needed)
              await ensurePageActive(user.workerUrl, user.notionKey, platformIds.rootPageId);

              const result = await createDatabase(
                user.workerUrl,
                user.notionKey,
                platformIds.rootPageId,
                newDbTitle.trim(),
                newDbFields.map((f) => ({
                  name: f.name.trim(),
                  type: f.type,
                  ...(f.options ? { options: f.options.split(",").map((o) => o.trim()).filter(Boolean) } : {}),
                }))
              );
              // Detect the full schema from the newly created database
              const schema = await detectSchema(user.workerUrl, user.notionKey, result.id);
              handleConnect(result.id, newDbTitle.trim(), schema);
              // Reset form
              setNewDbTitle("");
              setNewDbFields([{ name: "Name", type: "title" }]);
            } catch (err) {
              setCreateError(err.message || "Failed to create database");
            } finally {
              setCreating(false);
            }
          }}
        />
      )}
    </div>
  );
}

// ── Schema Preview Sub-Component ──
function SchemaPreview({ schema, isConnected, onConnect }) {
  const fields = schemaFieldSummary(schema);
  const totalFields = schema.allFields?.length || 0;

  return (
    <div style={ds.schemaPreview}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div style={ds.schemaTitle}>
          {schema.databaseTitle}
        </div>
        {!isConnected && (
          <button
            style={ds.connectBtn}
            onClick={onConnect}
            onMouseEnter={(e) => { e.currentTarget.style.opacity = "0.85"; }}
            onMouseLeave={(e) => { e.currentTarget.style.opacity = "1"; }}
          >
            Connect Database
          </button>
        )}
      </div>

      {schema.title && (
        <div style={ds.schemaField}>
          <span style={{ ...ds.fieldType, color: C.accent }}>{schema.title.type}</span>
          <span>{schema.title.name}</span>
        </div>
      )}

      {fields.map((f, i) => (
        <div key={i} style={ds.schemaField}>
          <span style={ds.fieldType}>{f.type.replace(/_/g, " ")}</span>
          <span>{f.name}</span>
        </div>
      ))}

      {totalFields > fields.length + 1 && (
        <div style={{ fontSize: 11, color: C.darkMuted, marginTop: 4, fontStyle: "italic" }}>
          + {totalFields - fields.length - 1} more fields
        </div>
      )}

      <div style={{ fontSize: 11, color: C.accent, marginTop: 10, fontStyle: "italic" }}>
        {isConnected
          ? "This database is already connected."
          : "Does this look right? Click Connect to add it."}
      </div>
    </div>
  );
}

// ── Supported field types for database creation ──
const FIELD_TYPE_OPTIONS = [
  { value: "title", label: "Title" },
  { value: "rich_text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "select", label: "Select" },
  { value: "status", label: "Status" },
  { value: "multi_select", label: "Multi Select" },
  { value: "date", label: "Date" },
  { value: "checkbox", label: "Checkbox" },
  { value: "url", label: "URL" },
  { value: "email", label: "Email" },
  { value: "phone_number", label: "Phone" },
];

const TYPES_WITH_OPTIONS = new Set(["select", "status", "multi_select"]);

// ── Create Database Form Sub-Component ──
function CreateDatabaseForm({
  newDbTitle, setNewDbTitle,
  newDbFields, setNewDbFields,
  creating, createError, onSubmit,
}) {
  const updateField = (idx, key, value) => {
    setNewDbFields((prev) =>
      prev.map((f, i) => (i === idx ? { ...f, [key]: value } : f))
    );
  };

  const removeField = (idx) => {
    setNewDbFields((prev) => prev.filter((_, i) => i !== idx));
  };

  const addField = () => {
    setNewDbFields((prev) => [...prev, { name: "", type: "rich_text" }]);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Database name */}
      <div>
        <label style={{ fontSize: 11, fontWeight: 600, color: C.darkMuted, textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: 6 }}>
          Database Name
        </label>
        <input
          type="text"
          style={ds.urlInput}
          value={newDbTitle}
          onChange={(e) => setNewDbTitle(e.target.value)}
          placeholder="e.g. Project Tasks"
        />
      </div>

      {/* Field list */}
      <div>
        <label style={{ fontSize: 11, fontWeight: 600, color: C.darkMuted, textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: 8 }}>
          Fields
        </label>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {newDbFields.map((field, idx) => {
            const isTitle = field.type === "title";
            return (
              <div key={idx} style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
                {/* Field name */}
                <input
                  type="text"
                  style={{ ...ds.urlInput, flex: 1, padding: "8px 10px", fontSize: 12 }}
                  value={field.name}
                  onChange={(e) => updateField(idx, "name", e.target.value)}
                  placeholder="Field name"
                />
                {/* Type dropdown */}
                <select
                  style={{
                    ...ds.urlInput,
                    width: 120,
                    flex: "none",
                    padding: "8px 6px",
                    fontSize: 12,
                    cursor: isTitle ? "not-allowed" : "pointer",
                    opacity: isTitle ? 0.6 : 1,
                  }}
                  value={field.type}
                  onChange={(e) => updateField(idx, "type", e.target.value)}
                  disabled={isTitle}
                >
                  {FIELD_TYPE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                {/* Remove button (not for title) */}
                {!isTitle ? (
                  <button
                    style={{
                      background: "none",
                      border: `1px solid ${C.darkBorder}`,
                      borderRadius: RADIUS.md,
                      padding: "8px",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      transition: "border-color 0.15s",
                      flexShrink: 0,
                    }}
                    onClick={() => removeField(idx)}
                    onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#E05252"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.borderColor = C.darkBorder; }}
                    title="Remove field"
                  >
                    <IconTrash size={12} color={C.darkMuted} />
                  </button>
                ) : (
                  <div style={{ width: 34, flexShrink: 0 }} /> // Spacer for alignment
                )}
                {/* Options input for select/status/multi_select */}
              </div>
            );
          })}
        </div>

        {/* Options inputs (shown below the field row for types that need them) */}
        {newDbFields.map((field, idx) =>
          TYPES_WITH_OPTIONS.has(field.type) ? (
            <div key={`opts-${idx}`} style={{ marginTop: 4, marginBottom: 4, paddingLeft: 8 }}>
              <input
                type="text"
                style={{ ...ds.urlInput, fontSize: 11, padding: "6px 10px" }}
                value={field.options || ""}
                onChange={(e) => updateField(idx, "options", e.target.value)}
                placeholder={`Options for "${field.name}" (comma-separated)`}
              />
            </div>
          ) : null
        )}

        {/* Add field button */}
        <button
          style={{
            background: "none",
            border: `1px dashed ${C.darkBorder}`,
            borderRadius: RADIUS.md,
            padding: "8px 14px",
            fontSize: 12,
            fontFamily: FONT,
            color: C.darkMuted,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 6,
            marginTop: 4,
            transition: "all 0.15s",
          }}
          onClick={addField}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = C.accent;
            e.currentTarget.style.color = C.accent;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = C.darkBorder;
            e.currentTarget.style.color = C.darkMuted;
          }}
        >
          <IconPlus size={12} color="currentColor" /> Add Field
        </button>
      </div>

      {/* Error display */}
      {createError && <div style={ds.errorMsg}>{createError}</div>}

      {/* Submit button */}
      <button
        style={{
          ...ds.connectBtn,
          width: "100%",
          padding: "10px 16px",
          fontSize: 13,
          opacity: creating || !newDbTitle.trim() ? 0.5 : 1,
          cursor: creating || !newDbTitle.trim() ? "not-allowed" : "pointer",
        }}
        onClick={onSubmit}
        disabled={creating || !newDbTitle.trim()}
      >
        {creating ? "Creating Database..." : "Create Database"}
      </button>

      <div style={ds.hint}>
        Creates a new Notion database under your workspace. You can always add more fields later in Notion.
      </div>
    </div>
  );
}

// ── CSV/TSV Parsing Helpers ──

/** Parse CSV/TSV text into { headers, rows }. Auto-detects delimiter. */
function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length === 0) return { headers: [], rows: [] };

  // Auto-detect delimiter: tab or comma
  const firstLine = lines[0];
  const delimiter = firstLine.includes("\t") ? "\t" : ",";

  const parseLine = (line) => {
    const cells = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"' && line[i + 1] === '"') {
          current += '"';
          i++;
        } else if (ch === '"') {
          inQuotes = false;
        } else {
          current += ch;
        }
      } else {
        if (ch === '"') {
          inQuotes = true;
        } else if (ch === delimiter) {
          cells.push(current.trim());
          current = "";
        } else {
          current += ch;
        }
      }
    }
    cells.push(current.trim());
    return cells;
  };

  const headers = parseLine(lines[0]);
  const rows = lines.slice(1).map(parseLine);
  return { headers, rows };
}

/** Detect the Notion property type for a column based on sample values. */
function detectColumnType(values) {
  const samples = values.filter((v) => v !== "" && v != null).slice(0, 50);
  if (samples.length === 0) return "rich_text";

  // Check if all are numbers
  if (samples.every((v) => !isNaN(v) && v !== "")) return "number";

  // Check if all are booleans
  const boolSet = new Set(["true", "false", "yes", "no", "1", "0"]);
  if (samples.every((v) => boolSet.has(v.toLowerCase()))) return "checkbox";

  // Check if all look like dates (ISO or common formats)
  const dateRe = /^\d{4}[-/]\d{1,2}[-/]\d{1,2}|^\d{1,2}[-/]\d{1,2}[-/]\d{2,4}/;
  if (samples.every((v) => dateRe.test(v))) return "date";

  // Check if all look like URLs
  if (samples.every((v) => /^https?:\/\//.test(v))) return "url";

  // Check if all look like emails
  if (samples.every((v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v))) return "email";

  // Check if low cardinality (good for select) — <=10 unique values out of 50+ rows
  const unique = new Set(samples);
  if (unique.size <= 10 && samples.length >= 5) return "select";

  return "rich_text";
}

/** Convert a checkbox-like string to boolean. */
function toBool(v) {
  if (typeof v === "boolean") return v;
  const s = String(v).toLowerCase().trim();
  return s === "true" || s === "yes" || s === "1";
}

// ── Upload Database Form Sub-Component ──
function UploadDatabaseForm({
  uploadFile, setUploadFile,
  uploadDbTitle, setUploadDbTitle,
  uploadColumns, setUploadColumns,
  uploading, uploadError, uploadProgress,
  dragOver, setDragOver, onSubmit,
}) {
  const fileInputRef = useRef(null);

  const handleFileSelected = (file) => {
    if (!file) return;
    const ext = file.name.split(".").pop().toLowerCase();
    if (!["csv", "tsv", "txt"].includes(ext)) {
      return; // silently ignore non-table files
    }

    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result;
      const { headers, rows } = parseCSV(text);
      if (headers.length === 0) return;

      // Detect column types from data
      const columns = headers.map((h, i) => {
        const colValues = rows.map((r) => r[i] || "");
        const detectedType = i === 0 ? "title" : detectColumnType(colValues);
        const samples = colValues.filter(Boolean).slice(0, 3);
        return { name: h, type: detectedType, sample: samples.join(", ") };
      });

      setUploadFile({ name: file.name, headers, rows, rawText: text });
      setUploadDbTitle(file.name.replace(/\.\w+$/, "").replace(/[_-]/g, " "));
      setUploadColumns(columns);
    };
    reader.readAsText(file);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer?.files?.[0];
    handleFileSelected(file);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setDragOver(true);
  };

  const previewRows = uploadFile?.rows?.slice(0, 5) || [];

  // Determine if ready to submit
  const canSubmit = uploadFile && uploadDbTitle.trim() && !uploading;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Drop zone / file picker */}
      {!uploadFile && (
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={() => setDragOver(false)}
          onClick={() => fileInputRef.current?.click()}
          style={{
            border: `2px dashed ${dragOver ? C.accent : C.darkBorder}`,
            borderRadius: RADIUS.lg,
            padding: "36px 20px",
            textAlign: "center",
            cursor: "pointer",
            background: dragOver ? `${C.accent}08` : C.darkSurf2,
            transition: "all 0.15s",
          }}
        >
          <div style={{ fontSize: 28, marginBottom: 8 }}>📄</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.darkText, marginBottom: 4 }}>
            Drop a CSV or TSV file here
          </div>
          <div style={{ fontSize: 11, color: C.darkMuted }}>
            or click to browse — accepts .csv, .tsv
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.tsv,.txt"
            style={{ display: "none" }}
            onChange={(e) => handleFileSelected(e.target.files?.[0])}
          />
        </div>
      )}

      {/* File loaded — show schema + preview */}
      {uploadFile && (
        <>
          {/* File info bar */}
          <div style={{
            display: "flex", alignItems: "center", gap: 10,
            padding: "10px 14px", background: C.darkSurf2,
            border: `1px solid ${C.darkBorder}`, borderRadius: RADIUS.lg,
          }}>
            <span style={{ fontSize: 16 }}>📄</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: C.darkText, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {uploadFile.name}
              </div>
              <div style={{ fontSize: 11, color: C.darkMuted }}>
                {uploadFile.rows.length} rows, {uploadFile.headers.length} columns
              </div>
            </div>
            <button
              style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}
              onClick={() => { setUploadFile(null); setUploadColumns([]); setUploadDbTitle(""); }}
              title="Remove file"
            >
              <IconClose size={12} color={C.darkMuted} />
            </button>
          </div>

          {/* Database name */}
          <div>
            <label style={{ fontSize: 11, fontWeight: 600, color: C.darkMuted, textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: 6 }}>
              Database Name
            </label>
            <input
              type="text"
              style={ds.urlInput}
              value={uploadDbTitle}
              onChange={(e) => setUploadDbTitle(e.target.value)}
              placeholder="e.g. Imported Data"
            />
          </div>

          {/* Column schema with type overrides */}
          <div>
            <label style={{ fontSize: 11, fontWeight: 600, color: C.darkMuted, textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: 8 }}>
              Columns (auto-detected types)
            </label>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {uploadColumns.map((col, idx) => (
                <div key={idx} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <input
                    type="text"
                    style={{ ...ds.urlInput, flex: 1, padding: "7px 10px", fontSize: 12 }}
                    value={col.name}
                    onChange={(e) => {
                      setUploadColumns((prev) =>
                        prev.map((c, i) => (i === idx ? { ...c, name: e.target.value } : c))
                      );
                    }}
                  />
                  <select
                    style={{
                      ...ds.urlInput, width: 120, flex: "none", padding: "7px 6px", fontSize: 12,
                      cursor: idx === 0 ? "not-allowed" : "pointer",
                      opacity: idx === 0 ? 0.6 : 1,
                    }}
                    value={idx === 0 ? "title" : col.type}
                    onChange={(e) => {
                      setUploadColumns((prev) =>
                        prev.map((c, i) => (i === idx ? { ...c, type: e.target.value } : c))
                      );
                    }}
                    disabled={idx === 0}
                  >
                    {FIELD_TYPE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                  {col.sample && (
                    <span style={{ fontSize: 10, color: C.darkMuted, maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flexShrink: 0 }}>
                      e.g. {col.sample}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Data preview */}
          {previewRows.length > 0 && (
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: C.darkMuted, textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: 8 }}>
                Preview (first {previewRows.length} rows)
              </label>
              <div style={{
                overflowX: "auto", border: `1px solid ${C.darkBorder}`,
                borderRadius: RADIUS.md, background: C.darkSurf2,
              }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, fontFamily: FONT }}>
                  <thead>
                    <tr>
                      {uploadColumns.map((col, i) => (
                        <th key={i} style={{
                          padding: "6px 10px", textAlign: "left", fontWeight: 600,
                          color: C.darkMuted, borderBottom: `1px solid ${C.darkBorder}`,
                          whiteSpace: "nowrap", fontSize: 10, textTransform: "uppercase",
                          letterSpacing: "0.04em",
                        }}>
                          {col.name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((row, ri) => (
                      <tr key={ri}>
                        {uploadColumns.map((_, ci) => (
                          <td key={ci} style={{
                            padding: "5px 10px", color: C.darkText,
                            borderBottom: ri < previewRows.length - 1 ? `1px solid ${C.darkBorder}20` : "none",
                            maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                          }}>
                            {row[ci] || ""}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {uploadFile.rows.length > 5 && (
                <div style={{ fontSize: 10, color: C.darkMuted, marginTop: 4, fontStyle: "italic" }}>
                  + {uploadFile.rows.length - 5} more rows
                </div>
              )}
            </div>
          )}

          {/* Progress bar */}
          {uploadProgress && (
            <div>
              <div style={{
                height: 6, borderRadius: 3, background: C.darkSurf2,
                border: `1px solid ${C.darkBorder}`, overflow: "hidden",
              }}>
                <div style={{
                  height: "100%", borderRadius: 3,
                  background: C.accent, transition: "width 0.3s",
                  width: `${Math.round((uploadProgress.done / uploadProgress.total) * 100)}%`,
                }} />
              </div>
              <div style={{ fontSize: 11, color: C.darkMuted, marginTop: 4, textAlign: "center" }}>
                {uploadProgress.done} / {uploadProgress.total} records imported
              </div>
            </div>
          )}

          {/* Error */}
          {uploadError && <div style={ds.errorMsg}>{uploadError}</div>}

          {/* Submit */}
          <button
            style={{
              ...ds.connectBtn, width: "100%", padding: "10px 16px", fontSize: 13,
              opacity: canSubmit ? 1 : 0.5,
              cursor: canSubmit ? "pointer" : "not-allowed",
            }}
            onClick={onSubmit}
            disabled={!canSubmit}
          >
            {uploading
              ? uploadProgress
                ? `Importing ${uploadProgress.done}/${uploadProgress.total}...`
                : "Creating database..."
              : `Create Database & Import ${uploadFile.rows.length} Records`}
          </button>

          <div style={ds.hint}>
            Creates a new Notion database with the detected schema and imports all rows as records.
          </div>
        </>
      )}
    </div>
  );
}
