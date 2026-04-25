// ─── Relationships Context (Phase 2b Step C) ───
//
// Frontend infrastructure for the unified relationships subsystem. Phase 2b
// scope: thin wrapper around the worker /relationships endpoints with a
// minimal in-memory cache. Does NOT pre-warm or auto-load — consumers fetch
// the slices they need (entity-scoped) and the context keeps a per-entity
// result cache so repeat reads in the same session are free.
//
// Phase 4's first-class Relationships panel is what'll really exercise this.
// Until then, this provider mounts but does no work unless something asks.

import React, { createContext, useContext, useCallback, useMemo, useRef, useState } from "react";
import {
  listRelationships as apiListRelationships,
  createRelationship as apiCreateRelationship,
  deleteRelationship as apiDeleteRelationship,
} from "../lib/api.js";
import { useAuth } from "./AuthContext.jsx";

const RelationshipsContext = createContext(null);

const CACHE_TTL_MS = 60 * 1000; // 1 minute — short, since edges can change live

// ─── Provider ───────────────────────────────────────────────────────────────

export function RelationshipsProvider({ children }) {
  const { isAuthenticated } = useAuth();

  // Per-entity cache: key is `${entity_type}:${entity_id}:${stableFiltersJson}`,
  // value is { data, ts }. Bumping `cacheVersion` invalidates everything.
  const cacheRef = useRef(new Map());
  const [cacheVersion, setCacheVersion] = useState(0);

  // Track in-flight requests so concurrent callers share a promise.
  const inflightRef = useRef(new Map());

  const invalidateAll = useCallback(() => {
    cacheRef.current.clear();
    inflightRef.current.clear();
    setCacheVersion((v) => v + 1);
  }, []);

  // Build a stable cache key from filter shape. Sorts keys so semantically
  // identical filter objects hash to the same key regardless of property order.
  function buildKey(filters) {
    const cleaned = {};
    for (const k of Object.keys(filters || {}).sort()) {
      const v = filters[k];
      if (v == null || v === "") continue;
      cleaned[k] = Array.isArray(v) ? [...v].sort() : v;
    }
    return JSON.stringify(cleaned);
  }

  /**
   * Load relationships for the given filter set. Returns
   * { edges, summary } from the worker. Uses a 1-minute in-memory cache
   * keyed on the filter shape; pass force=true to bypass.
   */
  const loadRelationships = useCallback(
    async (filters = {}, { force = false } = {}) => {
      if (!isAuthenticated) return { edges: [], summary: { by_type: {}, counts: { total: 0 } } };
      const key = buildKey(filters);

      if (!force) {
        const cached = cacheRef.current.get(key);
        if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.data;
      }

      // De-dup concurrent identical requests
      const pending = inflightRef.current.get(key);
      if (pending && !force) return pending;

      const promise = apiListRelationships(filters)
        .then((data) => {
          cacheRef.current.set(key, { data, ts: Date.now() });
          inflightRef.current.delete(key);
          return data;
        })
        .catch((err) => {
          inflightRef.current.delete(key);
          throw err;
        });
      inflightRef.current.set(key, promise);
      return promise;
    },
    [isAuthenticated]
  );

  /**
   * Sugar for the most common shape: edges touching one entity. Returns the
   * edges array directly (drops summary).
   */
  const loadForEntity = useCallback(
    async (entity_type, entity_id, opts = {}) => {
      if (!entity_type || !entity_id) return [];
      const result = await loadRelationships({ entity_type, entity_id, ...opts });
      return result?.edges || [];
    },
    [loadRelationships]
  );

  /**
   * Create a native edge (origin must be 'user_declared' or 'ai_inferred').
   * Invalidates the entire cache on success — relationships affecting many
   * unrelated entities are rare enough that surgical invalidation isn't worth
   * the complexity. Re-throws on failure so UI can show errors.
   */
  const createEdge = useCallback(
    async (body) => {
      const created = await apiCreateRelationship(body);
      invalidateAll();
      return created;
    },
    [invalidateAll]
  );

  /**
   * Soft-delete an edge by id. Invalidates the cache on success.
   */
  const deleteEdge = useCallback(
    async (id) => {
      const result = await apiDeleteRelationship(id);
      invalidateAll();
      return result;
    },
    [invalidateAll]
  );

  const value = useMemo(
    () => ({
      loadRelationships,
      loadForEntity,
      createEdge,
      deleteEdge,
      invalidateAll,
      cacheVersion,
    }),
    [loadRelationships, loadForEntity, createEdge, deleteEdge, invalidateAll, cacheVersion]
  );

  return (
    <RelationshipsContext.Provider value={value}>
      {children}
    </RelationshipsContext.Provider>
  );
}

export function useRelationships() {
  const ctx = useContext(RelationshipsContext);
  if (!ctx) throw new Error("useRelationships must be used within RelationshipsProvider");
  return ctx;
}

export default RelationshipsContext;
