// ─── Links Context ───
// Global state for cross-page cell links.
// Loads links on mount, provides resolution and CRUD to all views.

import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";
import { usePlatform } from "./PlatformContext.jsx";
import { loadLinks, loadCachedLinks, saveLink, deleteLink, initLinksDB, resolveRef } from "../config/linkStorage.js";
import { savePlatformIds, loadPlatformIds } from "../config/setup.js";
import { queryAll } from "../notion/pagination.js";
import { fetchSheetData } from "../sheets/sheetClient.js";

const LinksContext = createContext({
  links: [],
  createLink: async () => {},
  removeLink: async () => {},
  resolveLinkedValue: () => null,
  getLinksForTarget: () => [],
  ensureLinksDb: async () => null,
});

export function LinksProvider({ children }) {
  const { user, platformIds, setPlatformIds, pages } = usePlatform();
  const [links, setLinks] = useState(() => loadCachedLinks());

  // Cross-page data cache: { key → { data, fetchedAt } }
  // Keys: "notion:dbId" or "sheet:sheetUrl"
  const dataCacheRef = useRef({});
  const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  // Load links from Notion on mount
  useEffect(() => {
    if (!user?.workerUrl || !user?.notionKey || !platformIds?.linksDbId) return;
    loadLinks(user.workerUrl, user.notionKey, platformIds.linksDbId)
      .then(setLinks)
      .catch((err) => console.error("[Links] Failed to load links:", err));
  }, [user?.workerUrl, user?.notionKey, platformIds?.linksDbId]);

  // Lazy-init links DB for existing users who don't have one
  const ensureLinksDb = useCallback(async () => {
    if (platformIds?.linksDbId) return platformIds.linksDbId;
    if (!user?.workerUrl || !user?.notionKey || !platformIds?.rootPageId) return null;
    try {
      const linksDbId = await initLinksDB(user.workerUrl, user.notionKey, platformIds.rootPageId);
      const newIds = { ...platformIds, linksDbId };
      setPlatformIds(newIds);
      savePlatformIds(newIds);
      return linksDbId;
    } catch (err) {
      console.error("[Links] Failed to init links DB:", err);
      return null;
    }
  }, [user, platformIds, setPlatformIds]);

  // Create a new link
  const createNewLink = useCallback(async (link) => {
    const dbId = await ensureLinksDb();
    if (!dbId) return null;
    try {
      const savedId = await saveLink(user.workerUrl, user.notionKey, dbId, link);
      const saved = { ...link, id: savedId };
      setLinks((prev) => [...prev.filter((l) => l.id !== savedId), saved]);
      return savedId;
    } catch (err) {
      console.error("[Links] Failed to create link:", err);
      return null;
    }
  }, [user, ensureLinksDb]);

  // Remove a link
  const removeLink = useCallback(async (linkId) => {
    setLinks((prev) => prev.filter((l) => l.id !== linkId));
    if (user?.workerUrl && user?.notionKey) {
      deleteLink(user.workerUrl, user.notionKey, linkId).catch(() => {});
    }
  }, [user]);

  // Fetch data for a source ref (with caching)
  const fetchSourceData = useCallback(async (sourceRef, sourcePageConfigId) => {
    if (!user?.workerUrl || !user?.notionKey) return { notionData: [], sheetDataMap: {} };

    if (sourceRef.type === "notion") {
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
          const data = await queryAll(user.workerUrl, user.notionKey, dbId);
          dataCacheRef.current[cacheKey] = { data, fetchedAt: Date.now() };
          return { notionData: data, sheetDataMap: {} };
        } catch {}
      }
      return { notionData: [], sheetDataMap: {} };
    }

    if (sourceRef.type === "sheet") {
      const cacheKey = `sheet:${sourceRef.sheetUrl}`;
      const cached = dataCacheRef.current[cacheKey];
      if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
        return { notionData: [], sheetDataMap: { [sourceRef.sheetUrl]: cached.data } };
      }
      try {
        const data = await fetchSheetData(user.workerUrl, sourceRef.sheetUrl);
        dataCacheRef.current[cacheKey] = { data, fetchedAt: Date.now() };
        return { notionData: [], sheetDataMap: { [sourceRef.sheetUrl]: data } };
      } catch {}
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
      const { notionData, sheetDataMap } = await fetchSourceData(link.sourceRef, link.sourcePage);
      const value = resolveRef(link.sourceRef, notionData, sheetDataMap);

      // Build a key for the target cell
      const ref = link.targetRef;
      const key = ref.type === "notion"
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
      ensureLinksDb,
      invalidateCache,
    }}>
      {children}
    </LinksContext.Provider>
  );
}

export const useLinks = () => useContext(LinksContext);
