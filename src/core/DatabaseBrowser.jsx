// ─── Database Browser ───
// Search/browse Notion databases or paste a URL to connect.
// Used inside VisualPageBuilder for connecting databases to pages.

import React, { useState, useCallback, useEffect, useRef } from "react";
import { C, FONT, RADIUS, SHADOW } from "../design/tokens.js";
import { S } from "../design/styles.js";
import { usePlatform } from "../context/PlatformContext.jsx";
import { detectSchema, classifyProperties } from "../notion/schema.js";
import { IconSearch, IconDatabase, IconCheck, IconPlus, IconClose } from "../design/icons.jsx";

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
  connectedIds = [],
  multi = true,
}) {
  const { user } = usePlatform();
  const [mode, setMode] = useState("browse"); // "browse" | "paste"
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(null);

  // Paste mode
  const [pasteInput, setPasteInput] = useState("");
  const [pasteLoading, setPasteLoading] = useState(false);
  const [pasteError, setPasteError] = useState(null);

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
      if (!user?.workerUrl || !user?.notionKey) return;
      setSearching(true);
      setSearchError(null);
      try {
        const res = await fetch(`${user.workerUrl}/search`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${user.notionKey}`,
          },
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
              }}
              placeholder="Paste a Notion database URL or ID..."
              onKeyDown={(e) => {
                if (e.key === "Enter") handlePaste();
              }}
            />
            <div style={ds.hint}>
              Examples: https://notion.so/workspace/abc123... or just the 32-character ID
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

          {/* Schema preview for pasted DB */}
          {previewDb?.schema && mode === "paste" && (
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
