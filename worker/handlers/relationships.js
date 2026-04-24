// ─── Relationships CRUD (Phase 1) ───
// Unified relationships subsystem endpoints. Native writes only in Phase 1 —
// projection origins are written by projection code (Phase 2), not this handler.
//
// Phase 1 scope: schema plumbing + endpoints. No consumers yet. No WebSocket
// events. See /Users/graham/.claude/plans/session-start-serialized-scott.md
// for the full design.

import { getFreshRole } from '../auth.js';
import { safeParseJSON } from '../utils.js';

const ALLOWED_ENTITY_TYPES = new Set([
  'record', 'page', 'field', 'user', 'neuron', 'comment',
]);
const NATIVE_ORIGINS = new Set(['user_declared', 'ai_inferred']);
const VALID_DIRECTIONS = new Set(['outgoing', 'incoming', 'both']);

function serializeRelationship(row) {
  if (!row) return null;
  return { ...row, meta: safeParseJSON(row.meta) };
}

// ─── Permission filter ───
// Builds a WHERE fragment that hides edges whose source or target page is
// explicitly restricted to 'none' permission for the calling user. Pages
// without explicit permission records fall through to route-level role access,
// matching the semantics of checkPagePermission() in worker/auth.js.
//
// Returns null for admin or shared-secret (MCP) callers — both bypass the filter.
async function buildPermissionFilter(env, user) {
  if (!user) return null; // Shared-secret auth (MCP) — synthetic admin
  const role = await getFreshRole(env, user);
  if (role === 'admin') return null;
  return {
    clause: `
      (source_page_id IS NULL OR source_page_id NOT IN (
        SELECT page_id FROM page_permissions
        WHERE user_id = ? AND permission = 'none'
      ))
      AND (target_page_id IS NULL OR target_page_id NOT IN (
        SELECT page_id FROM page_permissions
        WHERE user_id = ? AND permission = 'none'
      ))
    `,
    params: [user.sub, user.sub],
  };
}

// ─── GET /relationships ───
export async function handleListRelationships(env, url, user, jsonResponse) {
  const entityType = url.searchParams.get('entity_type');
  const entityId = url.searchParams.get('entity_id');
  const typesParam = url.searchParams.get('types') || url.searchParams.get('type');
  const direction = url.searchParams.get('direction') || 'both';
  const includeProjectedParam = url.searchParams.get('include_projected');
  const minConfidence = parseFloat(url.searchParams.get('min_confidence') || '0');
  const includeDeleted = url.searchParams.get('include_deleted') === '1';

  if (entityType && !ALLOWED_ENTITY_TYPES.has(entityType)) {
    return jsonResponse({ _error: `invalid entity_type: ${entityType}` }, 400);
  }
  if (!VALID_DIRECTIONS.has(direction)) {
    return jsonResponse({ _error: `invalid direction: ${direction}` }, 400);
  }
  if ((entityType && !entityId) || (!entityType && entityId)) {
    return jsonResponse({ _error: 'entity_type and entity_id must be provided together' }, 400);
  }

  const conditions = [];
  const params = [];

  if (entityType && entityId) {
    if (direction === 'outgoing') {
      conditions.push('(source_type = ? AND source_id = ?)');
      params.push(entityType, entityId);
    } else if (direction === 'incoming') {
      conditions.push('(target_type = ? AND target_id = ?)');
      params.push(entityType, entityId);
    } else {
      conditions.push('((source_type = ? AND source_id = ?) OR (target_type = ? AND target_id = ?))');
      params.push(entityType, entityId, entityType, entityId);
    }
  }

  if (typesParam) {
    const types = typesParam.split(',').map((t) => t.trim()).filter(Boolean);
    if (types.length > 0) {
      const placeholders = types.map(() => '?').join(',');
      conditions.push(`type IN (${placeholders})`);
      params.push(...types);
    }
  }

  // include_projected defaults to true; set to "false" or "0" to exclude.
  const includeProjected = includeProjectedParam !== 'false' && includeProjectedParam !== '0';
  if (!includeProjected) {
    conditions.push("origin NOT LIKE 'projected_%'");
  }

  if (!Number.isNaN(minConfidence) && minConfidence > 0) {
    conditions.push('(confidence IS NULL OR confidence >= ?)');
    params.push(minConfidence);
  }

  if (!includeDeleted) {
    conditions.push('deleted_at IS NULL');
  }

  const perm = await buildPermissionFilter(env, user);
  if (perm) {
    conditions.push(perm.clause);
    params.push(...perm.params);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const sql = `SELECT * FROM relationships ${whereClause} ORDER BY created_at DESC LIMIT 1000`;
  const { results } = await env.DB.prepare(sql).bind(...params).all();

  const edges = (results || []).map(serializeRelationship);

  const byType = {};
  for (const e of edges) {
    byType[e.type] = (byType[e.type] || 0) + 1;
  }

  return jsonResponse({
    edges,
    summary: {
      by_type: byType,
      counts: { total: edges.length },
    },
  });
}

// ─── POST /relationships ───
export async function handleCreateRelationship(env, body, user, jsonResponse) {
  const {
    type, source_type, source_id, target_type, target_id,
    source_page_id = null, target_page_id = null,
    origin, confidence = null, meta = null,
  } = body || {};

  if (!type || !source_type || !source_id || !target_type || !target_id || !origin) {
    return jsonResponse({
      _error: 'type, source_type, source_id, target_type, target_id, and origin are required',
    }, 400);
  }
  if (!NATIVE_ORIGINS.has(origin)) {
    return jsonResponse({
      _error: `origin must be one of: ${[...NATIVE_ORIGINS].join(', ')} (projected origins are written by projection code only)`,
    }, 400);
  }
  if (!ALLOWED_ENTITY_TYPES.has(source_type)) {
    return jsonResponse({ _error: `invalid source_type: ${source_type}` }, 400);
  }
  if (!ALLOWED_ENTITY_TYPES.has(target_type)) {
    return jsonResponse({ _error: `invalid target_type: ${target_type}` }, 400);
  }

  // Type must be registered in relationship_types. This also supplies the
  // authoritative `directed` value for the edge.
  const typeRow = await env.DB.prepare(
    'SELECT type, directed FROM relationship_types WHERE type = ? AND deprecated_at IS NULL'
  ).bind(type).first();
  if (!typeRow) {
    return jsonResponse({ _error: `unknown or deprecated relationship type: ${type}` }, 400);
  }

  if (origin === 'ai_inferred') {
    if (confidence == null || typeof confidence !== 'number' || confidence < 0 || confidence >= 1) {
      return jsonResponse({
        _error: 'ai_inferred edges require confidence as a number in [0, 1)',
      }, 400);
    }
  }

  // Dedupe: one active edge per (source, target, type) tuple.
  const existing = await env.DB.prepare(`
    SELECT id, origin FROM relationships
    WHERE source_type = ? AND source_id = ?
      AND target_type = ? AND target_id = ?
      AND type = ? AND deleted_at IS NULL
    LIMIT 1
  `).bind(source_type, source_id, target_type, target_id, type).first();
  if (existing) {
    return jsonResponse({
      _error: 'duplicate edge',
      existing_id: existing.id,
      existing_origin: existing.origin,
    }, 409);
  }

  const id = crypto.randomUUID();
  const createdBy = user?.sub || 'system';
  const now = new Date().toISOString();
  const metaJson = meta == null ? null : JSON.stringify(meta);

  await env.DB.prepare(`
    INSERT INTO relationships (
      id, type, source_type, source_id, source_page_id,
      target_type, target_id, target_page_id,
      directed, origin, confidence, meta,
      created_at, created_by, updated_at, deleted_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
  `).bind(
    id, type, source_type, source_id, source_page_id,
    target_type, target_id, target_page_id,
    typeRow.directed, origin, confidence, metaJson,
    now, createdBy, now,
  ).run();

  return jsonResponse({
    id, type, source_type, source_id, source_page_id,
    target_type, target_id, target_page_id,
    directed: typeRow.directed, origin, confidence,
    meta: safeParseJSON(metaJson),
    created_at: now, created_by: createdBy, updated_at: now,
    deleted_at: null,
  }, 201);
}

// ─── DELETE /relationships/:id ───
// Soft-delete via deleted_at. Preserves audit history and supports the
// cascade-reasoning use case documented in the design (Phase 2+).
export async function handleDeleteRelationship(env, id, user, jsonResponse) {
  const row = await env.DB.prepare(
    'SELECT id, deleted_at FROM relationships WHERE id = ?'
  ).bind(id).first();
  if (!row) {
    return jsonResponse({ _error: 'relationship not found' }, 404);
  }
  if (row.deleted_at) {
    return jsonResponse({ ok: true, id, already_deleted: true });
  }
  const now = new Date().toISOString();
  await env.DB.prepare(
    'UPDATE relationships SET deleted_at = ?, updated_at = ? WHERE id = ?'
  ).bind(now, now, id).run();
  return jsonResponse({ ok: true, id, deleted_at: now });
}
