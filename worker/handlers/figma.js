// ─── Figma integration handlers ───
// Proxies Figma REST API calls. API key stored encrypted in D1 connections table.

import { decryptSecret } from '../crypto.js';

const FIGMA_API = 'https://api.figma.com/v1';

// ── Helpers ──

async function getFigmaKey(env) {
  const row = await env.DB.prepare(
    "SELECT value FROM connections WHERE key = 'figma'"
  ).first();
  if (!row?.value) return null;
  return await decryptSecret(row.value, env);
}

async function getFigmaTeamId(env) {
  const row = await env.DB.prepare(
    "SELECT value FROM connections WHERE key = 'figma_team_id'"
  ).first();
  return row?.value || null;
}

async function figmaFetch(env, path, { method = 'GET', body = null } = {}) {
  const token = await getFigmaKey(env);
  if (!token) throw new Error('Figma API key not configured');

  const init = {
    method,
    headers: { 'X-FIGMA-TOKEN': token },
  };
  if (body) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  const res = await fetch(`${FIGMA_API}${path}`, init);

  if (res.status === 429) {
    const retryAfter = res.headers.get('Retry-After') || '60';
    throw new Error(`Figma rate limit exceeded. Retry after ${retryAfter}s.`);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Figma API error ${res.status}: ${text}`);
  }

  // DELETE responses can be empty
  const ct = res.headers.get('Content-Type') || '';
  if (!ct.includes('application/json')) return {};
  return res.json();
}

// ── Handlers ──

export async function handleFigmaStatus(env, jsonResponse) {
  try {
    const token = await getFigmaKey(env);
    if (!token) return jsonResponse({ connected: false });

    const me = await figmaFetch(env, '/me');
    return jsonResponse({
      connected: true,
      user: { handle: me.handle, email: me.email, img_url: me.img_url },
    });
  } catch (err) {
    return jsonResponse({ connected: false, error: err.message });
  }
}

export async function handleFigmaProjects(env, jsonResponse) {
  try {
    const teamId = await getFigmaTeamId(env);
    if (!teamId) return jsonResponse({ _error: 'Figma Team ID not configured' }, 400);

    const data = await figmaFetch(env, `/teams/${teamId}/projects`);
    return jsonResponse({ projects: data.projects || [] });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

export async function handleFigmaFiles(env, projectId, jsonResponse) {
  try {
    if (!projectId) return jsonResponse({ _error: 'Missing project ID' }, 400);

    const data = await figmaFetch(env, `/projects/${projectId}/files`);
    return jsonResponse({ name: data.name, files: data.files || [] });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

// ── Design Assets schema ──
const FIGMA_SYSTEM_KEY = 'figma_assets';
const DESIGN_ASSETS_COLUMNS = [
  { id: 'col_name', name: 'Name', type: 'title' },
  { id: 'col_status', name: 'Status', type: 'status', options: [
    { name: 'Draft', color: 'gray' },
    { name: 'In Review', color: 'yellow' },
    { name: 'Approved', color: 'green' },
    { name: 'Archived', color: 'red' },
  ]},
  { id: 'col_project', name: 'Project', type: 'text' },
  { id: 'col_figma_url', name: 'Figma URL', type: 'url' },
  { id: 'col_thumbnail', name: 'Thumbnail', type: 'url' },
  { id: 'col_last_modified', name: 'Last Modified', type: 'date' },
  { id: 'col_file_key', name: 'File Key', type: 'text' },
  { id: '_last_edited_time', name: 'Last Updated', type: 'last_edited_time', system: true },
  { id: '_created_time', name: 'Created', type: 'created_time', system: true },
];

async function getOrCreateDesignAssetsPage(env, userId) {
  // Check if Design Assets page already exists
  const existing = await env.DB.prepare(
    "SELECT id FROM page_configs WHERE config LIKE '%\"_systemInternal\":\"figma_assets\"%'"
  ).first();
  if (existing) return existing.id;

  // Create new page
  const id = crypto.randomUUID();
  const config = { _systemInternal: FIGMA_SYSTEM_KEY };

  await env.DB.prepare(
    `INSERT INTO page_configs (id, parent_id, title, icon, page_type, sort_order, config, created_by, created_at, updated_at)
     VALUES (?, NULL, 'Design Assets', '🎨', 'database', 0, ?, ?, datetime('now'), datetime('now'))`
  ).bind(id, JSON.stringify(config), userId || null).run();

  // Create schema
  await env.DB.prepare(
    `INSERT INTO table_schemas (id, columns, created_at, updated_at)
     VALUES (?, ?, datetime('now'), datetime('now'))`
  ).bind(id, JSON.stringify(DESIGN_ASSETS_COLUMNS)).run();

  // Auto-assign owner permission
  if (userId) {
    try {
      await env.DB.prepare(
        "INSERT OR IGNORE INTO page_permissions (page_id, user_id, permission, granted_by) VALUES (?, ?, 'owner', ?)"
      ).bind(id, userId, userId).run();
    } catch (_) {}
  }

  return id;
}

export async function handleFigmaImport(env, body, userId, jsonResponse) {
  try {
    const files = body.files;
    if (!Array.isArray(files) || files.length === 0) {
      return jsonResponse({ _error: 'No files to import' }, 400);
    }

    const pageId = await getOrCreateDesignAssetsPage(env, userId);

    // Get existing file keys to deduplicate
    const existingRows = await env.DB.prepare(
      "SELECT id, cells FROM table_rows WHERE table_id = ?"
    ).bind(pageId).all();

    const existingKeys = new Set();
    for (const row of (existingRows.results || [])) {
      const cells = JSON.parse(row.cells || '{}');
      if (cells.col_file_key) existingKeys.add(cells.col_file_key);
    }

    const imported = [];
    const skipped = [];
    const ownerVal = userId ? JSON.stringify([userId]) : 'default';

    for (const file of files) {
      if (existingKeys.has(file.key)) {
        skipped.push(file.key);
        continue;
      }

      const rowId = crypto.randomUUID();
      const cells = {
        col_name: file.name,
        col_status: 'Draft',
        col_project: file.projectName || '',
        col_figma_url: `https://www.figma.com/design/${file.key}`,
        col_thumbnail: file.thumbnail_url || '',
        col_last_modified: file.last_modified ? file.last_modified.split('T')[0] : '',
        col_file_key: file.key,
      };

      await env.DB.prepare(
        `INSERT INTO table_rows (id, table_id, cells, sort_order, metadata, sync_dirty, owner_user_id, parent_row_id, created_at, updated_at)
         VALUES (?, ?, ?, 0, '{}', 0, ?, NULL, datetime('now'), datetime('now'))`
      ).bind(rowId, pageId, JSON.stringify(cells), ownerVal).run();

      imported.push(file.key);
    }

    return jsonResponse({
      ok: true,
      pageId,
      imported: imported.length,
      skipped: skipped.length,
    });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

export async function handleFigmaFile(env, fileKey, jsonResponse) {
  try {
    if (!fileKey) return jsonResponse({ _error: 'Missing file key' }, 400);

    const data = await figmaFetch(env, `/files/${fileKey}?depth=1`);
    return jsonResponse({
      name: data.name,
      lastModified: data.lastModified,
      thumbnailUrl: data.thumbnailUrl,
      version: data.version,
      pages: (data.document?.children || []).map(p => ({ id: p.id, name: p.name })),
    });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

// ── Comments (Phase 2) ──
// All comments are posted using the workspace's stored Figma PAT, so they
// appear in Figma as authored by the PAT owner. We prefix each message with
// `[<wasabi user> via Wasabi]: ` so the actual author isn't lost.

export async function handleFigmaListComments(env, fileKey, jsonResponse) {
  try {
    if (!fileKey) return jsonResponse({ _error: 'Missing file key' }, 400);
    const data = await figmaFetch(env, `/files/${fileKey}/comments`);
    return jsonResponse({ comments: data.comments || [] });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

export async function handleFigmaPostComment(env, fileKey, body, user, jsonResponse) {
  try {
    if (!fileKey) return jsonResponse({ _error: 'Missing file key' }, 400);
    const raw = (body?.message || '').toString().trim();
    if (!raw) return jsonResponse({ _error: 'Message is required' }, 400);

    const displayName = user?.name || 'Wasabi user';
    // Avoid double-prefix if the client already added one for some reason.
    const message = /^\[.+ via Wasabi\]:/.test(raw)
      ? raw
      : `[${displayName} via Wasabi]: ${raw}`;

    const payload = { message };
    if (body?.comment_id) payload.comment_id = body.comment_id; // reply target

    const data = await figmaFetch(env, `/files/${fileKey}/comments`, {
      method: 'POST',
      body: payload,
    });
    return jsonResponse({ ok: true, comment: data });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

export async function handleFigmaDeleteComment(env, fileKey, commentId, jsonResponse) {
  try {
    if (!fileKey || !commentId) return jsonResponse({ _error: 'Missing file key or comment id' }, 400);
    await figmaFetch(env, `/files/${fileKey}/comments/${commentId}`, { method: 'DELETE' });
    return jsonResponse({ ok: true });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}
