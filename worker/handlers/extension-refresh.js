// ─── Report update: facts from the tracker, text from Claude desktop, a person approves ───
// Lets a report (extension snapshot) be brought up to date from its source table.
// Only extensions whose ext_config.refresh.enabled is true take part.
//
// The Wasabi server never calls an AI model here. The written parts of the report
// (each tile's summary / next / flag / vendor, and suggested groups) are drafted in
// Claude desktop through the Wasabi MCP tool `wasabi_report_update`, and nothing the
// team sees changes until an approver reviews the draft inside the report.
//
//   POST /extensions/snapshots/:id/refresh          refresh facts only, no AI (editor)
//   GET  /extensions/snapshots/:id/refresh/context  everything Claude desktop needs to draft
//   POST /extensions/snapshots/:id/draft            submit the text Claude desktop wrote (editor)
//   GET  /extensions/snapshots/:id/draft            read the pending draft
//   POST /extensions/snapshots/:id/draft/decide     approve / deny / edit (approvers only)
//
// The draft lives in R2 beside the snapshot HTML, and every change to the live report
// archives the previous DATA blob under <snapshot>.history/ in R2.

import { safeParseJSON } from '../utils.js';
import { validateData, handleUpdateSnapshot } from './extensions.js';
import { createNotificationInternal } from './notifications.js';

const MAX_COMMENT_CHARS = 1500;
const DEFAULT_PAGE_SIZE = 5;   // page 1 also carries the writing rules + report definition

// Handed to Claude desktop with the context; the report's own definition follows it.
const WRITING_RULES = `You write the text parts of a production report that a team reads in its weekly meeting. Each tile covers one project, sometimes several tracker records that are one job. You are given every tile's facts from the tracker, all comments on its records (email updates, meeting notes and people's own notes), and the tile's current text.

For every tile, return text that describes the CURRENT state:
- Use only what the facts and comments say. Never invent quantities, dates, names or prices. If sources conflict, say so plainly and briefly.
- If nothing material changed since the current text was written, return the current text unchanged, word for word, with reason "no change".
- summary: one to four plain-language sentences (roughly 60 words at most), most recent state first. Spell out product codes the way the comments and current text do (for example "Drop Singles" rather than "DS"). No emoji, no markdown.
- next: the next concrete action and who owns it, if the comments say; otherwise an empty string.
- flag: one short line only when the team should watch something (a date at risk or missed, missing tracking, conflicting numbers, an order on hold); otherwise an empty string.
- vendor: the vendor or supplier named in the comments, else the current value, else an empty string.
- reason: a few words on what prompted the change, for example "Sep 14 meeting notes".
- A tile whose current summary is "No summary yet." is new and must get a real summary.

Groups: if comments show that separate tiles are really one job (the same email thread, the same print run, shipped together), propose a group listing every tileId involved, a title, the combined text and the reason. Only propose groups you are confident about. Never propose a group for records that already share a tile.`;

// Shape of what `wasabi_report_update submit` sends back.
const OUTPUT_FORMAT = {
  base_hash: 'string — copy from the context',
  tiles: [{ tileId: 'string', summary: 'string', next: 'string', flag: 'string', vendor: 'string', reason: 'string' }],
  groups: [{ tileIds: ['string'], title: 'string', summary: 'string', next: 'string', flag: 'string', vendor: 'string', reason: 'string' }],
  author: 'optional — who drafted it, e.g. "Claude desktop"',
  replace: 'optional boolean — replace a draft that is already waiting',
};

// ─── Context ───

async function loadContext(env, snapshotId) {
  const snap = await env.DB.prepare('SELECT * FROM extension_snapshots WHERE id = ?').bind(snapshotId).first();
  if (!snap) return { error: ['Snapshot not found', 404] };
  const ext = await env.DB.prepare('SELECT * FROM extensions WHERE id = ?').bind(snap.extension_id).first();
  if (!ext) return { error: ['Parent extension missing', 500] };
  const cfg = (safeParseJSON(ext.ext_config) || {}).refresh;
  if (!cfg?.enabled || !cfg.sourcePageId || !cfg.columns) {
    return { error: ['This report does not support Update', 400] };
  }
  const base = String(snap.html_key || '').replace(/\.html$/, '');
  return { snap, ext, cfg, draftKey: `${base}.draft.json`, historyPrefix: `${base}.history/` };
}

const isApprover = (cfg, user) => !!user?.sub && (cfg.approvers || []).includes(user.sub);

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(text || '')));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function localISODate(timeZone) {
  return new Date().toLocaleDateString('en-CA', { timeZone: timeZone || 'America/Los_Angeles' });
}

function prettyDate(iso, withYear = true) {
  if (!iso) return '';
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', ...(withYear ? { year: 'numeric' } : {}), timeZone: 'UTC',
  });
}

async function archiveCurrent(env, ctx) {
  await env.DOCS.put(`${ctx.historyPrefix}${new Date().toISOString()}.json`, ctx.snap.data || '{}', {
    httpMetadata: { contentType: 'application/json' },
  });
}

// ─── Source data → records ───

const isBlank = (v) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);

function toRange(v) {
  if (!v) return null;
  if (typeof v === 'string') return { start: v, end: v };
  if (typeof v === 'object' && v.start) return { start: v.start, end: v.end || v.start };
  return null;
}

function buildRecord(row, cfg) {
  const c = safeParseJSON(row.cells) || {};
  const cols = cfg.columns;
  const subs = cfg.subColumns || {};
  const isSub = !!row.parent_row_id;
  const pick = (key) => {
    for (const id of [cols[key], subs[key]]) {
      if (id && !isBlank(c[id])) return c[id];
    }
    return null;
  };
  let figs = c[cols.figma] || [];
  if (typeof figs === 'string') figs = figs.trim().startsWith('[') ? (safeParseJSON(figs) || []) : [];
  const target = pick('target');
  const name = isSub ? (c[subs.name] || c[cols.name]) : c[cols.name];
  return {
    id: row.id,
    name: String(name || 'Untitled'),
    status: String(c[cols.status] || ''),
    markets: Array.isArray(c[cols.markets]) ? c[cols.markets].map(String) : [],
    target: typeof target === 'string' ? target : (target?.start || ''),
    production: toRange(pick('production')),
    shipping: toRange(pick('shipping')),
    tracking: String(pick('tracking') || '').split('\n').map((t) => t.trim()).filter(Boolean),
    figma: (Array.isArray(figs) ? figs : [])
      .filter((f) => f?.file_key)
      .map((f) => ({ key: String(f.file_key), name: String(f.file_name || 'Figma file') })),
    isSub,
    parentId: row.parent_row_id || '',
    updated: String(row.updated_at || '').slice(0, 10),
  };
}

function cleanComment(text) {
  return String(text || '').trim()
    .replace(/\n*Updated on the tracker:[\s\S]*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Mail/Meeting Bridge comments are posted as "MCP Server"; label them by origin.
function commentAuthor(userName, text) {
  if (userName !== 'MCP Server') return userName || 'User';
  return /^From the .{0,60}meeting/i.test(text) ? 'Meeting notes' : 'Email update';
}

async function loadSource(env, cfg) {
  const [rowsRes, commentsRes, schemaRow] = await Promise.all([
    env.DB.prepare(
      'SELECT id, cells, parent_row_id, updated_at FROM table_rows WHERE table_id = ? AND archived = 0 AND archived_at IS NULL'
    ).bind(cfg.sourcePageId).all(),
    env.DB.prepare(
      'SELECT record_id, user_name, content, created_at FROM record_comments WHERE page_config_id = ? ORDER BY created_at ASC'
    ).bind(cfg.sourcePageId).all(),
    env.DB.prepare('SELECT columns FROM table_schemas WHERE id = ?').bind(cfg.sourcePageId).first(),
  ]);

  const records = (rowsRes.results || []).map((row) => buildRecord(row, cfg));
  const commentsByRecord = new Map();
  for (const cm of commentsRes.results || []) {
    const text = cleanComment(cm.content);
    if (!text) continue;
    if (!commentsByRecord.has(cm.record_id)) commentsByRecord.set(cm.record_id, []);
    commentsByRecord.get(cm.record_id).push({
      date: String(cm.created_at || '').slice(0, 10),
      who: commentAuthor(cm.user_name, text),
      text,
    });
  }

  const columns = safeParseJSON(schemaRow?.columns) || [];
  const statusCol = columns.find((col) => col.id === cfg.columns.status);
  const statuses = (statusCol?.options || []).map((o) => ({
    name: String(o.name),
    color: String(o.color || 'gray'),
    category: ['not_started', 'in_progress', 'on_hold', 'complete', 'cancelled'].includes(o.category) ? o.category : 'in_progress',
  }));

  return { records, commentsByRecord, statuses };
}

// Up to three latest unique comments across a tile's records.
function latestUpdates(ids, commentsByRecord) {
  const seen = new Set();
  const ups = [];
  for (const id of ids) {
    for (const c of commentsByRecord.get(id) || []) {
      const key = c.text.slice(0, 90);
      if (seen.has(key)) continue;
      seen.add(key);
      ups.push({ date: c.date, who: c.who, text: c.text.length > 420 ? `${c.text.slice(0, 420)}...` : c.text });
    }
  }
  return ups.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)).slice(0, 3);
}

function unionMarkets(recs) {
  const out = [];
  for (const r of recs) for (const m of r.markets) if (!out.includes(m)) out.push(m);
  return out;
}

function unionFigma(recs) {
  const seen = new Set();
  const out = [];
  for (const r of recs) for (const f of r.figma) if (!seen.has(f.key)) { seen.add(f.key); out.push(f); }
  return out;
}

// ─── Tiles (buckets) ───
// Existing tiles keep their records, id, grouping and text. New sub-items join
// their parent's tile; new top-level records get a tile of their own marked
// "No summary yet". Tiles whose records are all gone are dropped.

function buildBuckets(prevData, records, commentsByRecord, cfg) {
  const byId = new Map(records.map((r) => [r.id, r]));
  const childrenOf = new Map();
  for (const r of records) {
    if (!r.parentId) continue;
    if (!childrenOf.has(r.parentId)) childrenOf.set(r.parentId, []);
    childrenOf.get(r.parentId).push(r.id);
  }
  const assigned = new Set();
  const claim = (ids) => {
    const out = ids.filter((id) => byId.has(id) && !assigned.has(id));
    out.forEach((id) => assigned.add(id));
    for (const id of [...out]) {
      for (const kid of childrenOf.get(id) || []) {
        if (!assigned.has(kid)) { assigned.add(kid); out.push(kid); }
      }
    }
    return out;
  };

  const assemble = (ids, prev) => {
    const recs = ids.map((id) => byId.get(id));
    const lead = recs[0];
    const prevLeadName = prev?.records?.[0]?.name;
    return {
      id: prev?.id || `b-${lead.id.slice(0, 8)}`,
      title: prev && prev.title && prev.title !== prevLeadName ? prev.title : lead.name,
      status: lead.status,
      vendor: prev?.vendor || '',
      markets: unionMarkets(recs),
      groupNote: prev?.groupNote || '',
      summary: prev?.summary || 'No summary yet.',
      next: prev?.next || '',
      flag: prev?.flag || '',
      related: prev?.related || [],
      records: recs,
      updates: latestUpdates(ids, commentsByRecord),
      figma: unionFigma(recs),
      aiWritten: !!prev?.aiWritten,
      staleSummary: prev ? !!prev.staleSummary : true,
    };
  };

  const buckets = [];
  for (const pb of prevData?.buckets || []) {
    const ids = claim((pb.records || []).map((r) => r.id));
    if (ids.length) buckets.push(assemble(ids, pb));
  }
  for (const r of records) {
    if (assigned.has(r.id) || (r.parentId && byId.has(r.parentId))) continue;
    buckets.push(assemble(claim([r.id]), null));
  }
  for (const r of records) {          // orphans left over (defensive)
    if (!assigned.has(r.id)) buckets.push(assemble(claim([r.id]), null));
  }

  const liveIds = new Set(buckets.map((b) => b.id));
  for (const b of buckets) b.related = b.related.filter((id) => liveIds.has(id) && id !== b.id);

  const order = cfg.statusOrder || [];
  const rank = (s) => { const i = order.indexOf(s); return i === -1 ? order.length : i; };
  return buckets
    .map((b, i) => ({ b, i }))
    .sort((x, y) => rank(x.b.status) - rank(y.b.status) || x.i - y.i)
    .map(({ b }) => b);
}

// ─── What changed in the facts (shown to the reviewer) ───

function factChanges(prevData, buckets) {
  const prev = new Map();
  for (const b of prevData?.buckets || []) for (const r of b.records || []) prev.set(r.id, r);
  const now = new Map();
  for (const b of buckets) for (const r of b.records) now.set(r.id, r);
  const fmt = (g) => (!g ? 'not set' : g.start === g.end ? prettyDate(g.start, false) : `${prettyDate(g.start, false)} – ${prettyDate(g.end, false)}`);
  const out = [];
  for (const [id, r] of now) {
    const p = prev.get(id);
    if (!p) { out.push({ recordId: id, name: r.name, text: `New record${r.status ? ` (${r.status})` : ''}` }); continue; }
    const bits = [];
    if (p.name !== r.name) bits.push(`renamed from "${p.name}"`);
    if (p.status !== r.status) bits.push(`status ${p.status || 'none'} → ${r.status || 'none'}`);
    if ((p.target || '') !== (r.target || '')) bits.push(`in-hands target ${prettyDate(p.target, false) || 'not set'} → ${prettyDate(r.target, false) || 'not set'}`);
    if (JSON.stringify(p.production || null) !== JSON.stringify(r.production)) bits.push(`production ${fmt(p.production)} → ${fmt(r.production)}`);
    if (JSON.stringify(p.shipping || null) !== JSON.stringify(r.shipping)) bits.push(`shipping ${fmt(p.shipping)} → ${fmt(r.shipping)}`);
    if ((p.tracking || []).join('|') !== r.tracking.join('|')) bits.push('tracking updated');
    if ((p.markets || []).join(',') !== r.markets.join(',')) bits.push(`markets ${(p.markets || []).join(', ') || 'none'} → ${r.markets.join(', ') || 'none'}`);
    if ((p.figma || []).map((f) => f.key).join(',') !== r.figma.map((f) => f.key).join(',')) bits.push('design files updated');
    if (bits.length) out.push({ recordId: id, name: r.name, text: bits.join('; ') });
  }
  for (const [id, p] of prev) {
    if (!now.has(id)) out.push({ recordId: id, name: p.name, text: 'Removed from the tracker (archived or deleted)' });
  }
  return out;
}

// Current report rebuilt with fresh facts; every tile keeps its current text.
function rebuildReport(prevData, src, cfg) {
  const buckets = buildBuckets(prevData, src.records, src.commentsByRecord, cfg);
  const today = localISODate(cfg.timeZone);
  return {
    buckets,
    facts: factChanges(prevData, buckets),
    today,
    data: {
      ...prevData,
      reportDate: `Updated ${prettyDate(today)}`,
      generatedAt: today,
      statuses: src.statuses.length ? src.statuses : (prevData.statuses || []),
      buckets,
    },
  };
}

// Tiles whose facts moved since their text was written are marked out of date.
function markStaleTiles(prevData, buckets, facts) {
  const changed = new Set(facts.map((f) => f.recordId));
  const prevMembers = new Map((prevData?.buckets || []).map((b) => [b.id, (b.records || []).map((r) => r.id).join(',')]));
  for (const b of buckets) {
    const regrouped = prevMembers.has(b.id) && prevMembers.get(b.id) !== b.records.map((r) => r.id).join(',');
    if (regrouped || b.records.some((r) => changed.has(r.id))) b.staleSummary = true;
  }
}

// ─── Proposals from the text Claude desktop wrote ───

const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const pickText = (o) => ({ summary: norm(o.summary), next: norm(o.next), flag: norm(o.flag), vendor: norm(o.vendor) });

function buildProposals(buckets, output) {
  const byId = new Map(buckets.map((b) => [b.id, b]));
  const proposals = [];

  for (const t of output.tiles || []) {
    const b = byId.get(t?.tileId);
    if (!b) continue;
    const after = pickText(t);
    if (!after.summary) continue;
    const before = pickText(b);
    if (JSON.stringify(after) === JSON.stringify(before)) continue;
    proposals.push({
      id: `t:${b.id}`, type: 'text', bucketId: b.id, title: b.title, status: b.status,
      before, after, reason: norm(t.reason),
    });
  }

  const grouped = new Set();
  let n = 0;
  for (const g of output.groups || []) {
    const ids = [...new Set((g?.tileIds || []).filter((id) => byId.has(id)))];
    if (ids.length < 2 || ids.some((id) => grouped.has(id))) continue;
    const after = { ...pickText(g), title: norm(g.title) || byId.get(ids[0]).title };
    if (!after.summary) continue;
    ids.forEach((id) => grouped.add(id));
    n += 1;
    proposals.push({
      id: `g:${n}`, type: 'group', tileIds: ids, titles: ids.map((id) => byId.get(id).title),
      after, reason: norm(g.reason),
    });
  }
  return proposals;
}

// ─── Compose the approved report ───
// decisions: { [proposalId]: 'approve' | 'deny' | { edit: { summary?, next?, flag?, vendor?, title? } } }
// Anything not decided counts as denied (the tile keeps its current text).

function composeApproved(draft, decisions, approver) {
  const data = JSON.parse(JSON.stringify(draft.baseData));
  const byId = new Map(data.buckets.map((b) => [b.id, b]));
  const verdict = (id) => {
    const d = decisions?.[id];
    if (d === 'approve') return { ok: true };
    if (d && typeof d === 'object' && d.edit && typeof d.edit === 'object') return { ok: true, edit: d.edit };
    return { ok: false };
  };
  const applyText = (b, text, edit) => {
    const t = { ...text, ...(edit ? pickText({ ...text, ...edit }) : {}) };
    b.summary = t.summary || b.summary;
    b.next = t.next;
    b.flag = t.flag;
    b.vendor = t.vendor;
    b.aiWritten = true;
    b.staleSummary = false;
  };
  const counts = { approved: 0, edited: 0, denied: 0 };
  const absorbed = new Set();     // tiles merged into another tile by an approved group
  const groupLeads = new Set();   // tiles whose text came from an approved group

  for (const p of draft.proposals.filter((x) => x.type === 'group')) {
    const v = verdict(p.id);
    const members = p.tileIds
      .map((id) => byId.get(id))
      .filter((m) => m && !absorbed.has(m.id) && !groupLeads.has(m.id));
    if (!v.ok || members.length < 2) { counts.denied += 1; continue; }
    const lead = members[0];
    const recs = members.flatMap((m) => m.records);
    lead.records = recs;
    lead.markets = unionMarkets(recs);
    lead.figma = unionFigma(recs);
    const seen = new Set();
    lead.updates = members.flatMap((m) => m.updates)
      .filter((u) => { const k = u.text.slice(0, 90); if (seen.has(k)) return false; seen.add(k); return true; })
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
      .slice(0, 3);
    lead.related = [...new Set(members.flatMap((m) => m.related))].filter((id) => !p.tileIds.includes(id));
    lead.title = norm(v.edit?.title) || p.after.title;
    lead.groupNote = p.reason ? `Grouped from updates: ${p.reason}` : 'Grouped from updates.';
    applyText(lead, p.after, v.edit);
    members.slice(1).forEach((m) => absorbed.add(m.id));
    groupLeads.add(lead.id);
    counts[v.edit ? 'edited' : 'approved'] += 1;
  }
  data.buckets = data.buckets.filter((b) => !absorbed.has(b.id));

  for (const p of draft.proposals.filter((x) => x.type === 'text')) {
    const b = byId.get(p.bucketId);
    if (!b || absorbed.has(b.id) || groupLeads.has(b.id)) continue;   // an approved group's text wins
    const v = verdict(p.id);
    if (!v.ok) { b.staleSummary = true; counts.denied += 1; continue; }
    applyText(b, p.after, v.edit);
    counts[v.edit ? 'edited' : 'approved'] += 1;
  }

  const liveIds = new Set(data.buckets.map((b) => b.id));
  for (const b of data.buckets) b.related = (b.related || []).filter((id) => liveIds.has(id) && id !== b.id);

  const now = new Date().toISOString();
  data.updatedAt = now;
  data.approvedAt = now;
  data.approvedBy = approver?.name || '';
  return { data, counts };
}

// One-line blurb for the Reports table row.
function reportSummary(data) {
  const category = Object.fromEntries((data.statuses || []).map((s) => [s.name, s.category]));
  const isActive = (s) => !['complete', 'cancelled'].includes(category[s]);
  const active = data.buckets.flatMap((b) => b.records).filter((r) => !r.isSub && isActive(r.status)).length;
  const watch = data.buckets.filter((b) => b.flag && isActive(b.status)).map((b) => b.title);
  return `${active} active projects.${watch.length ? ` Watch: ${watch.join(', ')}.` : ''}`;
}

// What Claude desktop reads for each tile.
function contextTile(b, commentsByRecord) {
  return {
    tileId: b.id,
    title: b.title,
    status: b.status,
    vendor: b.vendor,
    groupNote: b.groupNote,
    currentText: { summary: b.summary, next: b.next, flag: b.flag },
    records: b.records.map((r) => ({
      id: r.id,
      name: r.name,
      subItem: r.isSub,
      status: r.status,
      markets: r.markets,
      inHandsTarget: r.target || null,
      production: r.production,
      shipping: r.shipping,
      tracking: r.tracking,
      comments: (commentsByRecord.get(r.id) || []).map((c) => ({
        date: c.date, from: c.who, text: c.text.slice(0, MAX_COMMENT_CHARS),
      })),
    })),
  };
}

// ─── Handlers ───

// The report's button: bring facts up to date instantly. No AI, no draft.
export async function handleRefreshFacts(env, snapshotId, user, jsonResponse) {
  const ctx = await loadContext(env, snapshotId);
  if (ctx.error) return jsonResponse({ _error: ctx.error[0] }, ctx.error[1]);
  if (await env.DOCS.head(ctx.draftKey)) {
    return jsonResponse({ _error: 'An update is waiting for review. Review or discard it before refreshing.', pending: true }, 409);
  }
  const prevData = safeParseJSON(ctx.snap.data) || {};
  const src = await loadSource(env, ctx.cfg);
  const { buckets, facts, data } = rebuildReport(prevData, src, ctx.cfg);
  markStaleTiles(prevData, buckets, facts);
  data.updatedAt = new Date().toISOString();

  await archiveCurrent(env, ctx);
  const res = await handleUpdateSnapshot(env, snapshotId, { data, summary: reportSummary(data) }, jsonResponse);
  if (res.status !== 200) return res;
  return jsonResponse({ ok: true, changes: facts.length, facts });
}

// Everything Claude desktop needs to draft the text, a page of tiles at a time.
export async function handleGetRefreshContext(env, snapshotId, url, jsonResponse) {
  const ctx = await loadContext(env, snapshotId);
  if (ctx.error) return jsonResponse({ _error: ctx.error[0] }, ctx.error[1]);
  const prevData = safeParseJSON(ctx.snap.data) || {};
  const src = await loadSource(env, ctx.cfg);
  const { buckets, facts, today } = rebuildReport(prevData, src, ctx.cfg);

  const pageSize = Math.max(1, Math.min(50, parseInt(url?.searchParams?.get('page_size') || '', 10) || DEFAULT_PAGE_SIZE));
  const pages = Math.max(1, Math.ceil(buckets.length / pageSize));
  const page = Math.max(1, Math.min(pages, parseInt(url?.searchParams?.get('page') || '1', 10) || 1));
  const slice = buckets.slice((page - 1) * pageSize, page * pageSize);

  return jsonResponse({
    report: ctx.snap.title || ctx.ext.name,
    base_hash: await sha256(ctx.snap.data),
    today,
    page,
    pages,
    total_tiles: buckets.length,
    pending_draft: !!(await env.DOCS.head(ctx.draftKey)),
    ...(page === 1 ? { writing_rules: WRITING_RULES, definition: ctx.ext.definition || '', output_format: OUTPUT_FORMAT, facts } : {}),
    tiles: slice.map((b) => contextTile(b, src.commentsByRecord)),
  });
}

// The text Claude desktop wrote becomes a draft for the approver.
export async function handleSubmitDraft(env, snapshotId, body, user, jsonResponse) {
  const ctx = await loadContext(env, snapshotId);
  if (ctx.error) return jsonResponse({ _error: ctx.error[0] }, ctx.error[1]);
  const { snap, ext, cfg } = ctx;

  if (!Array.isArray(body?.tiles) || (body.groups != null && !Array.isArray(body.groups))) {
    return jsonResponse({ _error: 'Expected { base_hash, tiles: [...], groups: [...] }' }, 400);
  }
  if (body.base_hash !== await sha256(snap.data)) {
    return jsonResponse({ _error: 'The report changed after the context was read. Read it again and redo the draft.' }, 409);
  }
  if (!body.replace && await env.DOCS.head(ctx.draftKey)) {
    return jsonResponse({ _error: 'An update is already waiting for review.', pending: true }, 409);
  }

  const prevData = safeParseJSON(snap.data) || {};
  const src = await loadSource(env, cfg);
  const { buckets, facts, data: baseData } = rebuildReport(prevData, src, cfg);
  const draft = {
    version: 2,
    createdAt: new Date().toISOString(),
    createdBy: { id: user?.sub || '', name: norm(body.author) || user?.name || '' },
    baseHash: body.base_hash,
    facts,
    proposals: buildProposals(buckets, { tiles: body.tiles, groups: body.groups || [] }),
    baseData,
  };

  // Both extremes (deny everything, approve everything) must produce a valid report.
  const schema = safeParseJSON(ext.data_schema) || {};
  if (Object.keys(schema).length) {
    const approveAll = Object.fromEntries(draft.proposals.map((p) => [p.id, 'approve']));
    for (const decisions of [{}, approveAll]) {
      const check = validateData(composeApproved(draft, decisions, user).data, schema);
      if (!check.ok) {
        return jsonResponse({ _error: 'The drafted report failed validation', validation_errors: check.errors }, 422);
      }
    }
  }

  await env.DOCS.put(ctx.draftKey, JSON.stringify(draft), { httpMetadata: { contentType: 'application/json' } });

  const recipients = new Set([...(cfg.approvers || []), user?.sub].filter((id) => id && id !== '__mcp__'));
  for (const target of recipients) {
    await createNotificationInternal(env, {
      message: `${ext.name}: an update is ready for review (${draft.proposals.length} suggested changes)`,
      type: 'notification',
      source: `extension-snapshot:${snap.id}`,
      target_user_id: target,
      record_name: snap.title || ext.name,
      page_name: 'Reports',
      actor_name: draft.createdBy.name,
    });
  }

  return jsonResponse({ ok: true, proposals: draft.proposals.length, facts: facts.length });
}

export async function handleGetRefreshDraft(env, snapshotId, user, jsonResponse) {
  const ctx = await loadContext(env, snapshotId);
  if (ctx.error) return jsonResponse({ _error: ctx.error[0] }, ctx.error[1]);
  const canApprove = isApprover(ctx.cfg, user);
  const obj = await env.DOCS.get(ctx.draftKey);
  if (!obj) return jsonResponse({ pending: false, canApprove });
  const draft = await obj.json();
  const summary = {
    pending: true,
    canApprove,
    createdAt: draft.createdAt,
    createdBy: draft.createdBy?.name || '',
    proposals: draft.proposals.length,
  };
  if (!canApprove) return jsonResponse(summary);
  const { baseData, ...rest } = draft;
  return jsonResponse({ ...summary, stale: draft.baseHash !== await sha256(ctx.snap.data), draft: rest });
}

export async function handleDecideRefreshDraft(env, snapshotId, body, user, jsonResponse) {
  const ctx = await loadContext(env, snapshotId);
  if (ctx.error) return jsonResponse({ _error: ctx.error[0] }, ctx.error[1]);
  if (!isApprover(ctx.cfg, user)) return jsonResponse({ _error: 'Only the report approver can review updates' }, 403);

  const obj = await env.DOCS.get(ctx.draftKey);
  if (!obj) return jsonResponse({ _error: 'No update is waiting for review' }, 404);
  if (body?.action === 'discard') {
    await env.DOCS.delete(ctx.draftKey);
    return jsonResponse({ ok: true, discarded: true });
  }

  const draft = await obj.json();
  if (draft.baseHash !== await sha256(ctx.snap.data)) {
    return jsonResponse({ _error: 'The report changed after this update was drafted. Discard it and run Update again.' }, 409);
  }

  const { data, counts } = composeApproved(draft, body?.decisions || {}, user);
  await archiveCurrent(env, ctx);   // keep the version being replaced so it can be restored
  const res = await handleUpdateSnapshot(env, snapshotId, { data, summary: reportSummary(data) }, jsonResponse);
  if (res.status !== 200) return res;
  await env.DOCS.delete(ctx.draftKey);
  return jsonResponse({ ok: true, ...counts });
}

// Pure helpers, exported for local tests.
export {
  loadSource, buildBuckets, factChanges, rebuildReport, markStaleTiles,
  buildProposals, composeApproved, reportSummary, contextTile, WRITING_RULES,
};
