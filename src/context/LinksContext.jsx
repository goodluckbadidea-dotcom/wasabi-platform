// ─── Links Context ───
// Global state for cross-page cell links.
// Loads links on mount, provides resolution and CRUD to all views.
// Links are stored in D1 via the /links API.

import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";
import { usePlatform } from "./PlatformContext.jsx";
import { loadLinks, loadCachedLinks, saveLink, deleteLink, resolveRef, invalidateLinksCache } from "../config/linkStorage.js";
import { queryAll } from "../notion/pagination.js";
import { fetchSheetData } from "../sheets/sheetClient.js";
import { listRows, getTableSchema } from "../lib/api.js";
import { resolveSourceType } from "../lib/dataSource.js";

const LinksContext = createContext({
  links: [],
  createLink: async () => {},
  removeLink: async () => {},
  resolveLinkedValue: () => null,
  getLinksForTarget: () => [],
  invalidateCache: () => {},
});

export function LinksProvider({ children }) {
  const { user, pages, isAuthenticated } = usePlatform();
  const [links, setLinks] = useState(() => loadCachedLinks());

  // Cross-page data cache: { key → { data, fetchedAt } }
  // Keys: "notion:dbId" or "sheet:sheetUrl"
  const dataCacheRef = useRef({});
  const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  // Load links from D1 on mount (wait for auth)
  useEffect(() => {
    if (!isAuthenticated) return;
    if (!user?.workerUrl) return;
    loadLinks()
      .then(setLinks)
      .catch((err) => console.error("[Links] Failed to load links:", err));
  }, [isAuthenticated, user?.workerUrl]);

  // Create a new link
  const createNewLink = useCallback(async (link) => {
    try {
      const savedId = await saveLink(null, null, null, link);
      const saved = { ...link, id: savedId };
      setLinks((prev) => [...prev.filter((l) => l.id !== savedId), saved]);
      return savedId;
    } catch (err) {
      console.error("[Links] Failed to create link:", err);
      return null;
    }
  }, []);

  // Remove a link
  const removeLink = useCallback(async (linkId) => {
    setLinks((prev) => prev.filter((l) => l.id !== linkId));
    deleteLink(null, null, linkId).catch(err => console.warn("[LinksContext] deleteLink:", err.message || err));
  }, []);

  // Fetch data for a source ref (with caching)
  const fetchSourceData = useCallback(async (sourceRef, sourcePageConfigId) => {
    if (!user?.workerUrl) return { notionData: [], sheetDataMap: {} };

    if (sourceRef.type === "notion") {
      if (!user?.notionKey) return { notionData: [], sheetDataMap: {} };
      // Find which database this page belongs to
      const pageConfig = pages.find((p) => p.id === sourcePageConfigId);
      if (!pageConfig?.databaseIds?.length) return { notionData: [], sheetDataMap: {} };

      // Try each database
      for (const dbId of pageConfig.databaseIds) {
        const cacheKey = `notion:${dbId}`;
        const cached = dataCacheRef.current[cacheKey];
        if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
          return { notionData: cached.data, sheetDataMap: {} };
        }
        try {
          const data = await queryAll(dbId);
          dataCacheRef.current[cacheKey] = { data, fetchedAt: Date.now() };
          return { notionData: data, sheetDataMap: {} };
        } catch (err) { console.warn("[LinksContext] queryAll:", err.message || err); }
      }
      return { notionData: [], sheetDataMap: {} };
    }

    if (sourceRef.type === "d1") {
      const pageConfig = pages.find((p) => p.id === sourcePageConfigId);
      if (!pageConfig) return { notionData: [], sheetDataMap: {}, d1Data: null };
      const tableId = pageConfig.id;
      const cacheKey = `d1:${tableId}`;
      const cached = dataCacheRef.current[cacheKey];
      if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
        return { notionData: [], sheetDataMap: {}, d1Data: cached.data };
      }
      try {
        const [schemaRes, rowsRes] = await Promise.all([
          getTableSchema(tableId),
          listRows(tableId, { limit: 500 }),
        ]);
        const d1Data = { columns: schemaRes.columns || [], rows: rowsRes.rows || [] };
        dataCacheRef.current[cacheKey] = { data: d1Data, fetchedAt: Date.now() };
        return { notionData: [], sheetDataMap: {}, d1Data };
      } catch (err) { console.warn("[LinksContext] D1 fetch:", err.message || err); }
      return { notionData: [], sheetDataMap: {}, d1Data: null };
    }

    if (sourceRef.type === "sheet") {
      const cacheKey = `sheet:${sourceRef.sheetUrl}`;
      const cached = dataCacheRef.current[cacheKey];
      if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
        return { notionData: [], sheetDataMap: { [sourceRef.sheetUrl]: cached.data } };
      }
      try {
        const data = await fetchSheetData(sourceRef.sheetUrl);
        dataCacheRef.current[cacheKey] = { data, fetchedAt: Date.now() };
        return { notionData: [], sheetDataMap: { [sourceRef.sheetUrl]: data } };
      } catch (err) { console.warn("[LinksContext] fetchSheetData:", err.message || err); }
      return { notionData: [], sheetDataMap: {} };
    }

    return { notionData: [], sheetDataMap: {} };
  }, [user, pages]);

  // Resolve all linked values for a view (batched)
  // Returns a Map: "pageId:field" or "rowIndex:column" → { value, link }
  const resolveLinksForView = useCallback(async (targetPageConfigId, targetViewIdx) => {
    const viewLinks = links.filter(
      (l) => l.targetPage === targetPageConfigId && l.targetView === targetViewIdx
    );
    if (!viewLinks.length) return new Map();

    const resolved = new Map();
    for (const link of viewLinks) {
      const { notionData, sheetDataMap, d1Data } = await fetchSourceData(link.sourceRef, link.sourcePage);
      const value = resolveRef(link.sourceRef, notionData, sheetDataMap, d1Data);

      // Build a key for the target cell
      const ref = link.targetRef;
      const key = ref.type === "d1"
        ? `${ref.record_id}:${ref.column_name}`
        : ref.type === "notion"
          ? `${ref.pageId}:${ref.field}`
          : `${ref.rowIndex}:${ref.column}`;

      resolved.set(key, {
        value,
        link,
        stale: value === undefined,
      });
    }
    return resolved;
  }, [links, fetchSourceData]);

  // Get all links targeting a specific page/view
  const getLinksForTarget = useCallback((pageConfigId, viewIdx) => {
    return links.filter((l) => l.targetPage === pageConfigId && l.targetView === viewIdx);
  }, [links]);

  // Invalidate cache for a specific source
  const invalidateCache = useCallback((cacheKey) => {
    delete dataCacheRef.current[cacheKey];
  }, []);

  return (
    <LinksContext.Provider value={{
      links,
      createLink: createNewLink,
      removeLink,
      resolveLinksForView,
      getLinksForTarget,
      invalidateCache,
    }}>
      {children}
    </LinksContext.Provider>
  );
}

export const useLinks = () => useContext(LinksContext);
