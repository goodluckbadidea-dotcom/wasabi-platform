// ─── Data Collection Extension Handlers ───
// CRUD for the four dc_* tables backing extensions.type = 'data_collection':
//   dc_items          — Master Item Sheet catalog
//   dc_submissions    — one row per workbook page fill
//   dc_submission_entries — one row per counted item within a submission
//   dc_share_links    — anonymous submission tokens for iPad share URLs
//
// All endpoints resolve the extension by id or slug and refuse to operate on
// mcp_generated extensions. Ownership of every row is enforced via
// extension_id. See docs/18-extensions.md for the workflow.

import { safeParseJSON } from '../utils.js';

// ═════ Helpers ═════

function nowIso() {
  // SQLite `datetime('now')` returns 'YYYY-MM-DD HH:MM:SS'. Match that for
  // reads that construct timestamps client-side to keep sorting sane.
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

async function resolveDcExtension(env, ref) {
  const row = await env.DB.prepare(
    'SELECT id, slug, name, type, ext_config FROM extensions WHERE id = ? OR slug = ? LIMIT 1'
  ).bind(ref, ref).first();
  if (!row) return { error: { _error: 'Extension not found' }, status: 404 };
  if ((row.type || 'mcp_generated') !== 'data_collection') {
    return { error: { _error: `Extension '${row.slug}' is type '${row.type}', not data_collection.` }, status: 400 };
  }
  return {
    ext: {
      ...row,
      ext_config: safeParseJSON(row.ext_config) || {},
    },
  };
}

function rowToItem(row) {
  if (!row) return null;
  return {
    ...row,
    markets: safeParseJSON(row.markets) || [],
    archived: row.archived === 1,
    case_size: row.case_size ?? null,
    weight_unit: row.weight_unit ?? null,
  };
}

function rowToSubmission(row) {
  if (!row) return null;
  return { ...row };
}

function rowToEntry(row) {
  if (!row) return null;
  return { ...row };
}

function rowToShareLink(row) {
  if (!row) return null;
  return { ...row };
}

// Compute total_units from cases + case_size (case mode) or units_count (unit mode).
// For weight mode, leave null — weight is its own thing, not a unit count.
function computeTotalUnits(mode, casesCount, caseSize, unitsCount) {
  if (mode === 'case') {
    const c = Number(casesCount);
    const s = Number(caseSize);
    if (!isFinite(c) || !isFinite(s)) return null;
    return c * s;
  }
  if (mode === 'unit') {
    const u = Number(unitsCount);
    return isFinite(u) ? u : null;
  }
  return null;
}

// Generate a URL-safe token for share links (~32 chars of entropy).
function generateShareToken() {
  // 24 bytes of randomness → 32-char base64url
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ═════════════════════════════════════════════════════════════════════
// Items — Master Item Sheet CRUD
// ═════════════════════════════════════════════════════════════════════

export async function handleListDcItems(env, extensionRef, url, jsonResponse) {
  const { ext, error, status } = await resolveDcExtension(env, extensionRef);
  if (error) return jsonResponse(error, status);

  const channel  = url.searchParams.get('channel');
  const market   = url.searchParams.get('market');
  const typeKey  = url.searchParams.get('type');
  const archived = url.searchParams.get('archived') === '1' ? 1 : 0;
  const q        = url.searchParams.get('q');

  const conditions = ['extension_id = ?'];
  const params = [ext.id];
  conditions.push('archived = ?'); params.push(archived);
  if (channel) { conditions.push('channel = ?'); params.push(channel); }
  if (typeKey) { conditions.push('type_key = ?'); params.push(typeKey); }
  if (q) {
    conditions.push('(sku LIKE ? OR description LIKE ?)');
    const like = `%${q}%`;
    params.push(like, like);
  }

  const query = `SELECT * FROM dc_items WHERE ${conditions.join(' AND ')} ORDER BY sort_order, sku LIMIT 5000`;
  const { results } = await env.DB.prepare(query).bind(...params).all();
  let items = (results || []).map(rowToItem);
  if (market) {
    items = items.filter((i) => Array.isArray(i.markets) && i.markets.includes(market));
  }
  return jsonResponse({ items });
}

export async function handleGetDcItem(env, id, jsonResponse) {
  const row = await env.DB.prepare('SELECT * FROM dc_items WHERE id = ?').bind(id).first();
  if (!row) return jsonResponse({ _error: 'Item not found' }, 404);
  return jsonResponse(rowToItem(row));
}

export async function handleCreateDcItem(env, extensionRef, body, user, jsonResponse) {
  const { ext, error, status } = await resolveDcExtension(env, extensionRef);
  if (error) return jsonResponse(error, status);

  const sku = String(body.sku || '').trim();
  if (!sku) return jsonResponse({ _error: 'sku required' }, 400);

  const countMode = ['case', 'unit', 'weight'].includes(body.count_mode) ? body.count_mode : 'case';
  if (countMode === 'case' && body.case_size == null) {
    return jsonResponse({ _error: 'case_size required when count_mode is case' }, 400);
  }
  if (countMode === 'weight' && !body.weight_unit) {
    return jsonResponse({ _error: 'weight_unit required when count_mode is weight' }, 400);
  }

  const id = body.id || `dci_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const markets = Array.isArray(body.markets) ? body.markets : [];

  await env.DB.prepare(
    `INSERT INTO dc_items
       (id, extension_id, sku, description, channel, markets, type_key,
        vendor_ref, vendor_name, count_mode, case_size, weight_unit, notes,
        sort_order, archived, created_by, created_at, updated_at, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, datetime('now'), datetime('now'), ?)`
  ).bind(
    id, ext.id, sku,
    body.description || '',
    body.channel || '',
    JSON.stringify(markets),
    body.type_key || '',
    body.vendor_ref || '',
    body.vendor_name || '',
    countMode,
    countMode === 'case' ? Number(body.case_size) : null,
    countMode === 'weight' ? body.weight_unit : null,
    body.notes || '',
    body.sort_order || 0,
    user?.sub || '',
    user?.sub || ''
  ).run();

  const row = await env.DB.prepare('SELECT * FROM dc_items WHERE id = ?').bind(id).first();
  return jsonResponse(rowToItem(row), 201);
}

export async function handleUpdateDcItem(env, id, body, user, jsonResponse) {
  const existing = await env.DB.prepare('SELECT * FROM dc_items WHERE id = ?').bind(id).first();
  if (!existing) return jsonResponse({ _error: 'Item not found' }, 404);

  const sets = [];
  const vals = [];
  const scalars = ['sku', 'description', 'channel', 'type_key', 'vendor_ref', 'vendor_name', 'count_mode', 'weight_unit', 'notes'];
  for (const k of scalars) {
    if (k in body) { sets.push(`${k} = ?`); vals.push(body[k]); }
  }
  if ('markets' in body) {
    const arr = Array.isArray(body.markets) ? body.markets : [];
    sets.push('markets = ?'); vals.push(JSON.stringify(arr));
  }
  if ('case_size' in body) {
    sets.push('case_size = ?'); vals.push(body.case_size == null ? null : Number(body.case_size));
  }
  if ('sort_order' in body) { sets.push('sort_order = ?'); vals.push(Number(body.sort_order) || 0); }
  if ('archived' in body)   { sets.push('archived = ?');   vals.push(body.archived ? 1 : 0); }

  if (sets.length === 0) return jsonResponse({ _error: 'No fields to update' }, 400);
  sets.push("updated_at = datetime('now')");
  sets.push('updated_by = ?'); vals.push(user?.sub || '');
  vals.push(id);

  await env.DB.prepare(`UPDATE dc_items SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run();
  const row = await env.DB.prepare('SELECT * FROM dc_items WHERE id = ?').bind(id).first();
  return jsonResponse(rowToItem(row));
}

export async function handleDeleteDcItem(env, id, jsonResponse) {
  const existing = await env.DB.prepare('SELECT id FROM dc_items WHERE id = ?').bind(id).first();
  if (!existing) return jsonResponse({ _error: 'Item not found' }, 404);

  // Refuse hard-delete if any submission entries reference this item.
  // The caller should archive instead (PATCH archived=true).
  const entryCount = await env.DB.prepare(
    'SELECT COUNT(*) as count FROM dc_submission_entries WHERE item_id = ?'
  ).bind(id).first();
  if (entryCount?.count > 0) {
    return jsonResponse({
      _error: `Cannot delete item — ${entryCount.count} submission entries reference it. Archive the item instead (PATCH archived=true).`,
    }, 409);
  }

  await env.DB.prepare('DELETE FROM dc_items WHERE id = ?').bind(id).run();
  return jsonResponse({ ok: true, id });
}

// ═════════════════════════════════════════════════════════════════════
// Submissions — one per workbook page fill
// ═════════════════════════════════════════════════════════════════════

export async function handleListDcSubmissions(env, extensionRef, url, jsonResponse) {
  const { ext, error, status } = await resolveDcExtension(env, extensionRef);
  if (error) return jsonResponse(error, status);

  const market  = url.searchParams.get('market');
  const page    = url.searchParams.get('page');
  const status_ = url.searchParams.get('status');
  const counter = url.searchParams.get('counter');
  const limit   = Math.min(Number(url.searchParams.get('limit')) || 200, 1000);

  const conditions = ['extension_id = ?'];
  const params = [ext.id];
  if (market)  { conditions.push('market = ?');       params.push(market); }
  if (page)    { conditions.push('page = ?');         params.push(page); }
  if (status_) { conditions.push('status = ?');       params.push(status_); }
  if (counter) { conditions.push('counter_name LIKE ?'); params.push(`%${counter}%`); }

  const query = `SELECT * FROM dc_submissions WHERE ${conditions.join(' AND ')} ORDER BY COALESCE(submitted_at, created_at) DESC LIMIT ?`;
  params.push(limit);
  const { results } = await env.DB.prepare(query).bind(...params).all();
  return jsonResponse({ submissions: (results || []).map(rowToSubmission) });
}

export async function handleGetDcSubmission(env, id, jsonResponse) {
  const row = await env.DB.prepare('SELECT * FROM dc_submissions WHERE id = ?').bind(id).first();
  if (!row) return jsonResponse({ _error: 'Submission not found' }, 404);
  // Include entries + rollup counts for convenience
  const { results: entries } = await env.DB.prepare(
    'SELECT * FROM dc_submission_entries WHERE submission_id = ? ORDER BY created_at'
  ).bind(id).all();
  const rollup = {
    entry_count: (entries || []).length,
    total_units: (entries || []).reduce((sum, e) => sum + (Number(e.total_units) || 0), 0),
  };
  return jsonResponse({ submission: rowToSubmission(row), entries: (entries || []).map(rowToEntry), rollup });
}

export async function handleCreateDcSubmission(env, extensionRef, body, user, jsonResponse) {
  const { ext, error, status } = await resolveDcExtension(env, extensionRef);
  if (error) return jsonResponse(error, status);

  const market = String(body.market || '').trim().toUpperCase();
  const page   = String(body.page   || '').trim();
  if (!market || !page) return jsonResponse({ _error: 'market and page required' }, 400);

  const id = body.id || `dcs_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const status_ = body.status === 'submitted' ? 'submitted' : 'draft';
  const submittedAt = status_ === 'submitted' ? nowIso() : null;

  await env.DB.prepare(
    `INSERT INTO dc_submissions
       (id, extension_id, market, page, category, status, counter_name, counter_user_id,
        share_link_id, count_date, submitted_at, submitted_by, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
  ).bind(
    id, ext.id, market, page,
    body.category || '',
    status_,
    body.counter_name || (user?.name || user?.display_name || ''),
    user?.sub || '',
    body.share_link_id || '',
    body.count_date || null,
    submittedAt,
    submittedAt ? (user?.sub || '') : '',
    body.notes || ''
  ).run();

  const row = await env.DB.prepare('SELECT * FROM dc_submissions WHERE id = ?').bind(id).first();
  return jsonResponse(rowToSubmission(row), 201);
}

export async function handleUpdateDcSubmission(env, id, body, user, jsonResponse) {
  const existing = await env.DB.prepare('SELECT * FROM dc_submissions WHERE id = ?').bind(id).first();
  if (!existing) return jsonResponse({ _error: 'Submission not found' }, 404);

  const sets = [];
  const vals = [];
  const scalars = ['category', 'counter_name', 'count_date', 'notes'];
  for (const k of scalars) {
    if (k in body) { sets.push(`${k} = ?`); vals.push(body[k]); }
  }
  if ('status' in body) {
    const newStatus = body.status === 'submitted' ? 'submitted' : 'draft';
    sets.push('status = ?'); vals.push(newStatus);
    if (newStatus === 'submitted' && existing.status !== 'submitted') {
      sets.push('submitted_at = ?'); vals.push(nowIso());
      sets.push('submitted_by = ?'); vals.push(user?.sub || '');
    }
    if (newStatus === 'submitted' && existing.status === 'submitted') {
      sets.push('edited_at = ?'); vals.push(nowIso());
      sets.push('edited_by = ?'); vals.push(user?.sub || '');
    }
  } else if (existing.status === 'submitted') {
    // Any body change on an already-submitted submission counts as an edit
    sets.push('edited_at = ?'); vals.push(nowIso());
    sets.push('edited_by = ?'); vals.push(user?.sub || '');
  }

  if (sets.length === 0) return jsonResponse({ _error: 'No fields to update' }, 400);
  sets.push("updated_at = datetime('now')");
  vals.push(id);

  await env.DB.prepare(`UPDATE dc_submissions SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run();
  const row = await env.DB.prepare('SELECT * FROM dc_submissions WHERE id = ?').bind(id).first();
  return jsonResponse(rowToSubmission(row));
}

export async function handleDeleteDcSubmission(env, id, jsonResponse) {
  const existing = await env.DB.prepare('SELECT id FROM dc_submissions WHERE id = ?').bind(id).first();
  if (!existing) return jsonResponse({ _error: 'Submission not found' }, 404);
  // Cascade: entries first
  await env.DB.prepare('DELETE FROM dc_submission_entries WHERE submission_id = ?').bind(id).run();
  await env.DB.prepare('DELETE FROM dc_submissions WHERE id = ?').bind(id).run();
  return jsonResponse({ ok: true, id });
}

// CSV export of a single submission
export async function handleGetDcSubmissionCsv(env, id) {
  const sub = await env.DB.prepare('SELECT * FROM dc_submissions WHERE id = ?').bind(id).first();
  if (!sub) return new Response('Submission not found', { status: 404 });

  const { results: entries } = await env.DB.prepare(
    `SELECT e.*, i.sku, i.description, i.channel, i.type_key, i.vendor_name
       FROM dc_submission_entries e
       LEFT JOIN dc_items i ON i.id = e.item_id
      WHERE e.submission_id = ?
      ORDER BY i.sort_order, i.sku`
  ).bind(id).all();

  const rows = entries || [];
  const esc = (v) => {
    if (v == null) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const header = ['SKU', 'Description', 'Channel', 'Type', 'Vendor', 'Count mode', 'Cases', 'Units', 'Weight', 'Weight unit', 'Units per case', 'Total units', 'Notes'];
  const meta = [
    `# Wasabi Inventory · ${sub.market} · ${sub.page}`,
    `# Counter: ${sub.counter_name || '—'}`,
    `# Count date: ${sub.count_date || '—'}`,
    `# Submitted: ${sub.submitted_at || '—'}`,
    `# Status: ${sub.status}`,
    `# Rows: ${rows.length}`,
    '',
  ].join('\n');
  const body = [
    header.join(','),
    ...rows.map((r) => [
      r.sku || '',
      r.description || '',
      r.channel || '',
      r.type_key || '',
      r.vendor_name || '',
      r.count_mode,
      r.cases_count ?? '',
      r.units_count ?? '',
      r.weight_value ?? '',
      r.weight_unit || '',
      r.case_size_snapshot ?? '',
      r.total_units ?? '',
      r.notes || '',
    ].map(esc).join(',')),
  ].join('\n');

  const filename = `wasabi-inventory-${(sub.market || 'x').toLowerCase()}-${(sub.page || 'x').toLowerCase()}-${(sub.count_date || sub.submitted_at || 'draft').replace(/[^\d-]/g, '').slice(0, 10)}.csv`;

  return new Response(meta + body + '\n', {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}

// ═════════════════════════════════════════════════════════════════════
// Submission entries — upsert-per-item
// ═════════════════════════════════════════════════════════════════════

// Upsert an entry (create if missing, update if exists). Uses the
// (submission_id, item_id) unique index. Handles all three count modes.
export async function handleUpsertDcEntry(env, submissionId, body, user, jsonResponse) {
  const sub = await env.DB.prepare('SELECT id, extension_id, status FROM dc_submissions WHERE id = ?').bind(submissionId).first();
  if (!sub) return jsonResponse({ _error: 'Submission not found' }, 404);

  const itemId = String(body.item_id || '').trim();
  if (!itemId) return jsonResponse({ _error: 'item_id required' }, 400);

  const item = await env.DB.prepare('SELECT id, extension_id, count_mode, case_size, weight_unit FROM dc_items WHERE id = ?').bind(itemId).first();
  if (!item) return jsonResponse({ _error: 'Item not found' }, 404);
  if (item.extension_id !== sub.extension_id) {
    return jsonResponse({ _error: 'Item and submission belong to different extensions' }, 400);
  }

  const mode = body.count_mode || item.count_mode || 'case';
  const casesCount = body.cases_count != null ? Number(body.cases_count) : null;
  const unitsCount = body.units_count != null ? Number(body.units_count) : null;
  const weightValue = body.weight_value != null ? Number(body.weight_value) : null;
  const weightUnit  = body.weight_unit || item.weight_unit || null;
  const caseSize = body.case_size_snapshot != null ? Number(body.case_size_snapshot)
                    : (item.case_size != null ? Number(item.case_size) : null);
  const totalUnits = computeTotalUnits(mode, casesCount, caseSize, unitsCount);

  // Check for existing (submission_id, item_id) entry
  const existing = await env.DB.prepare(
    'SELECT id FROM dc_submission_entries WHERE submission_id = ? AND item_id = ?'
  ).bind(submissionId, itemId).first();

  if (existing) {
    await env.DB.prepare(
      `UPDATE dc_submission_entries
         SET count_mode = ?, cases_count = ?, units_count = ?, weight_value = ?,
             weight_unit = ?, case_size_snapshot = ?, total_units = ?, notes = ?,
             updated_at = datetime('now')
       WHERE id = ?`
    ).bind(mode, casesCount, unitsCount, weightValue, weightUnit, caseSize, totalUnits, body.notes || '', existing.id).run();
    const row = await env.DB.prepare('SELECT * FROM dc_submission_entries WHERE id = ?').bind(existing.id).first();
    return jsonResponse(rowToEntry(row));
  }

  const id = `dce_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  await env.DB.prepare(
    `INSERT INTO dc_submission_entries
       (id, submission_id, item_id, count_mode, cases_count, units_count, weight_value,
        weight_unit, case_size_snapshot, total_units, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
  ).bind(id, submissionId, itemId, mode, casesCount, unitsCount, weightValue, weightUnit, caseSize, totalUnits, body.notes || '').run();

  const row = await env.DB.prepare('SELECT * FROM dc_submission_entries WHERE id = ?').bind(id).first();
  return jsonResponse(rowToEntry(row), 201);
}

export async function handleDeleteDcEntry(env, id, jsonResponse) {
  const existing = await env.DB.prepare('SELECT id FROM dc_submission_entries WHERE id = ?').bind(id).first();
  if (!existing) return jsonResponse({ _error: 'Entry not found' }, 404);
  await env.DB.prepare('DELETE FROM dc_submission_entries WHERE id = ?').bind(id).run();
  return jsonResponse({ ok: true, id });
}

// ═════════════════════════════════════════════════════════════════════
// Share links — anonymous submission tokens
// ═════════════════════════════════════════════════════════════════════

export async function handleListDcShareLinks(env, extensionRef, jsonResponse) {
  const { ext, error, status } = await resolveDcExtension(env, extensionRef);
  if (error) return jsonResponse(error, status);
  const { results } = await env.DB.prepare(
    'SELECT * FROM dc_share_links WHERE extension_id = ? ORDER BY created_at DESC'
  ).bind(ext.id).all();
  return jsonResponse({ share_links: (results || []).map(rowToShareLink) });
}

export async function handleCreateDcShareLink(env, extensionRef, body, user, jsonResponse) {
  const { ext, error, status } = await resolveDcExtension(env, extensionRef);
  if (error) return jsonResponse(error, status);

  const id = `dcsl_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const token = generateShareToken();

  await env.DB.prepare(
    `INSERT INTO dc_share_links
       (id, extension_id, token, label, scope_market, scope_page,
        submission_limit, expires_at, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
  ).bind(
    id, ext.id, token,
    body.label || '',
    body.scope_market || '',
    body.scope_page || '',
    body.submission_limit != null ? Number(body.submission_limit) : null,
    body.expires_at || null,
    user?.sub || ''
  ).run();

  const row = await env.DB.prepare('SELECT * FROM dc_share_links WHERE id = ?').bind(id).first();
  return jsonResponse(rowToShareLink(row), 201);
}

export async function handleUpdateDcShareLink(env, id, body, user, jsonResponse) {
  const existing = await env.DB.prepare('SELECT id FROM dc_share_links WHERE id = ?').bind(id).first();
  if (!existing) return jsonResponse({ _error: 'Share link not found' }, 404);

  const sets = [];
  const vals = [];
  if ('label' in body)            { sets.push('label = ?');             vals.push(body.label); }
  if ('scope_market' in body)     { sets.push('scope_market = ?');      vals.push(body.scope_market || ''); }
  if ('scope_page' in body)       { sets.push('scope_page = ?');        vals.push(body.scope_page || ''); }
  if ('submission_limit' in body) { sets.push('submission_limit = ?');  vals.push(body.submission_limit == null ? null : Number(body.submission_limit)); }
  if ('expires_at' in body)       { sets.push('expires_at = ?');        vals.push(body.expires_at || null); }
  if ('revoke' in body && body.revoke === true) {
    sets.push('revoked_at = ?'); vals.push(nowIso());
  }
  if (body.revoke === false) {
    sets.push('revoked_at = ?'); vals.push(null);
  }

  if (sets.length === 0) return jsonResponse({ _error: 'No fields to update' }, 400);
  vals.push(id);
  await env.DB.prepare(`UPDATE dc_share_links SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run();
  const row = await env.DB.prepare('SELECT * FROM dc_share_links WHERE id = ?').bind(id).first();
  return jsonResponse(rowToShareLink(row));
}

export async function handleDeleteDcShareLink(env, id, jsonResponse) {
  const existing = await env.DB.prepare('SELECT id FROM dc_share_links WHERE id = ?').bind(id).first();
  if (!existing) return jsonResponse({ _error: 'Share link not found' }, 404);
  await env.DB.prepare('DELETE FROM dc_share_links WHERE id = ?').bind(id).run();
  return jsonResponse({ ok: true, id });
}

// ═════════════════════════════════════════════════════════════════════
// Public share-link routes (pre-auth) — used by iPads without accounts
// ═════════════════════════════════════════════════════════════════════

// Look up a share link by token. Returns { ok, link, ext } or { error }.
export async function resolveShareLink(env, token) {
  if (!token) return { error: { _error: 'Missing token' }, status: 401 };
  const link = await env.DB.prepare(
    'SELECT * FROM dc_share_links WHERE token = ? LIMIT 1'
  ).bind(token).first();
  if (!link) return { error: { _error: 'Invalid share link' }, status: 403 };
  if (link.revoked_at) return { error: { _error: 'Share link revoked' }, status: 403 };
  if (link.expires_at && link.expires_at < nowIso()) return { error: { _error: 'Share link expired' }, status: 403 };
  if (link.submission_limit != null && link.submission_count >= link.submission_limit) {
    return { error: { _error: 'Share link submission limit reached' }, status: 403 };
  }
  const ext = await env.DB.prepare('SELECT * FROM extensions WHERE id = ?').bind(link.extension_id).first();
  if (!ext) return { error: { _error: 'Extension missing for share link' }, status: 500 };
  return {
    ok: true,
    link,
    ext: { ...ext, ext_config: safeParseJSON(ext.ext_config) || {} },
  };
}

// GET /collect/:slug?t=<token>  — return the extension's config + items
// scoped by the share link. iPad UI uses this to render the workbook.
export async function handleShareLinkContext(env, extensionSlug, token, jsonResponse) {
  const resolved = await resolveShareLink(env, token);
  if (resolved.error) return jsonResponse(resolved.error, resolved.status);
  const { link, ext } = resolved;
  if (ext.slug !== extensionSlug) return jsonResponse({ _error: 'Token does not match extension' }, 403);

  // Return items scoped by the link's optional scope_market
  const marketFilter = link.scope_market || null;
  const { results: items } = await env.DB.prepare(
    'SELECT * FROM dc_items WHERE extension_id = ? AND archived = 0 ORDER BY sort_order, sku LIMIT 5000'
  ).bind(ext.id).all();
  let filtered = (items || []).map(rowToItem);
  if (marketFilter) {
    filtered = filtered.filter((i) => Array.isArray(i.markets) && i.markets.includes(marketFilter));
  }

  return jsonResponse({
    extension: {
      slug: ext.slug,
      name: ext.name,
      description: ext.description,
      ext_config: ext.ext_config,
    },
    share_link: {
      id: link.id,
      label: link.label,
      scope_market: link.scope_market,
      scope_page: link.scope_page,
      submission_limit: link.submission_limit,
      submission_count: link.submission_count,
    },
    items: filtered,
  });
}

// POST /collect/:slug/submissions?t=<token>
// Anonymous submission write. Creates the submission + its entries in one call.
export async function handleShareLinkSubmit(env, extensionSlug, token, body, jsonResponse) {
  const resolved = await resolveShareLink(env, token);
  if (resolved.error) return jsonResponse(resolved.error, resolved.status);
  const { link, ext } = resolved;
  if (ext.slug !== extensionSlug) return jsonResponse({ _error: 'Token does not match extension' }, 403);

  const market = String(body.market || link.scope_market || '').trim().toUpperCase();
  const page   = String(body.page   || link.scope_page   || '').trim();
  if (!market || !page) return jsonResponse({ _error: 'market and page required' }, 400);
  // Enforce link scope if set
  if (link.scope_market && link.scope_market !== market) {
    return jsonResponse({ _error: `Share link is scoped to market '${link.scope_market}'` }, 403);
  }
  if (link.scope_page && link.scope_page !== page) {
    return jsonResponse({ _error: `Share link is scoped to page '${link.scope_page}'` }, 403);
  }

  const subId = `dcs_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  await env.DB.prepare(
    `INSERT INTO dc_submissions
       (id, extension_id, market, page, category, status, counter_name, counter_user_id,
        share_link_id, count_date, submitted_at, submitted_by, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'submitted', ?, '', ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
  ).bind(
    subId, ext.id, market, page,
    body.category || '',
    body.counter_name || 'Guest',
    link.id,
    body.count_date || null,
    nowIso(),
    `share:${link.id}`,
    body.notes || ''
  ).run();

  // Insert entries
  const entries = Array.isArray(body.entries) ? body.entries : [];
  for (const e of entries) {
    if (!e.item_id) continue;
    // Look up the item's count_mode + case_size for snapshot
    const item = await env.DB.prepare('SELECT id, extension_id, count_mode, case_size, weight_unit FROM dc_items WHERE id = ?').bind(e.item_id).first();
    if (!item || item.extension_id !== ext.id) continue;
    const mode = e.count_mode || item.count_mode || 'case';
    const casesCount = e.cases_count != null ? Number(e.cases_count) : null;
    const unitsCount = e.units_count != null ? Number(e.units_count) : null;
    const weightValue = e.weight_value != null ? Number(e.weight_value) : null;
    const weightUnit  = e.weight_unit || item.weight_unit || null;
    const caseSize = e.case_size_snapshot != null ? Number(e.case_size_snapshot)
                      : (item.case_size != null ? Number(item.case_size) : null);
    const totalUnits = computeTotalUnits(mode, casesCount, caseSize, unitsCount);
    const entryId = `dce_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    await env.DB.prepare(
      `INSERT INTO dc_submission_entries
         (id, submission_id, item_id, count_mode, cases_count, units_count, weight_value,
          weight_unit, case_size_snapshot, total_units, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
    ).bind(entryId, subId, e.item_id, mode, casesCount, unitsCount, weightValue, weightUnit, caseSize, totalUnits, e.notes || '').run();
  }

  // Bump link submission_count
  await env.DB.prepare(
    'UPDATE dc_share_links SET submission_count = submission_count + 1 WHERE id = ?'
  ).bind(link.id).run();

  return jsonResponse({ ok: true, submission_id: subId, entry_count: entries.length }, 201);
}
