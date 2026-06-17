// ─── Forms Feature Handlers ───
// CRUD for form definitions, connections, and submissions.
// See docs/19-forms-feature.md for the design.

import { safeParseJSON } from '../utils.js';

// ─── Form Definitions ───

export async function handleListForms(env, tableId, jsonResponse) {
  try {
    const { results } = await env.DB.prepare(
      "SELECT * FROM form_definitions WHERE table_id = ? ORDER BY sort_order, created_at"
    ).bind(tableId).all();
    const forms = (results || []).map(parseFormRow);
    return jsonResponse({ forms });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

export async function handleCreateForm(env, tableId, body, user, jsonResponse) {
  try {
    const id = body.id || crypto.randomUUID();
    const name = body.name || 'Untitled form';
    const description = body.description || '';
    const formType = body.form_type === 'repeating' ? 'repeating' : 'single_instance';
    const fields = Array.isArray(body.fields) ? body.fields : [];
    const sortOrder = body.sort_order ?? 0;
    const createdBy = user?.sub || '';

    await env.DB.prepare(
      `INSERT INTO form_definitions (id, table_id, name, description, form_type, fields, sort_order, created_at, updated_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), ?)`
    ).bind(id, tableId, name, description, formType, JSON.stringify(fields), sortOrder, createdBy).run();

    const row = await env.DB.prepare("SELECT * FROM form_definitions WHERE id = ?").bind(id).first();
    return jsonResponse({ form: parseFormRow(row) }, 201);
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

export async function handleGetForm(env, formId, jsonResponse) {
  try {
    const row = await env.DB.prepare("SELECT * FROM form_definitions WHERE id = ?").bind(formId).first();
    if (!row) return jsonResponse({ _error: "Form not found" }, 404);
    return jsonResponse({ form: parseFormRow(row) });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

export async function handleUpdateForm(env, formId, body, user, jsonResponse) {
  try {
    const existing = await env.DB.prepare("SELECT * FROM form_definitions WHERE id = ?").bind(formId).first();
    if (!existing) return jsonResponse({ _error: "Form not found" }, 404);

    // Form Type can only change if no submissions exist
    if (body.form_type !== undefined && body.form_type !== existing.form_type) {
      const { count } = await env.DB.prepare(
        "SELECT COUNT(*) as count FROM form_submissions WHERE form_id = ?"
      ).bind(formId).first() || { count: 0 };
      if (count > 0) {
        return jsonResponse({ _error: "Can't change Form Type after submissions exist", code: "FORM_TYPE_LOCKED" }, 400);
      }
    }

    const sets = [];
    const binds = [];
    if (body.name !== undefined)        { sets.push("name = ?");        binds.push(body.name); }
    if (body.description !== undefined) { sets.push("description = ?"); binds.push(body.description); }
    if (body.form_type !== undefined)   { sets.push("form_type = ?");   binds.push(body.form_type === 'repeating' ? 'repeating' : 'single_instance'); }
    if (body.fields !== undefined)      { sets.push("fields = ?");      binds.push(JSON.stringify(body.fields)); }
    if (body.sort_order !== undefined)  { sets.push("sort_order = ?");  binds.push(body.sort_order); }

    if (sets.length === 0) return jsonResponse({ _error: "No fields to update" }, 400);

    sets.push("updated_at = datetime('now')");
    binds.push(formId);
    await env.DB.prepare(`UPDATE form_definitions SET ${sets.join(", ")} WHERE id = ?`).bind(...binds).run();

    const row = await env.DB.prepare("SELECT * FROM form_definitions WHERE id = ?").bind(formId).first();
    return jsonResponse({ form: parseFormRow(row) });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

export async function handleDeleteForm(env, formId, jsonResponse) {
  try {
    await env.DB.prepare("DELETE FROM form_submissions WHERE form_id = ?").bind(formId).run();
    await env.DB.prepare("DELETE FROM form_connections WHERE form_id = ?").bind(formId).run();
    await env.DB.prepare("DELETE FROM form_definitions WHERE id = ?").bind(formId).run();
    return jsonResponse({ ok: true });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

function parseFormRow(row) {
  if (!row) return null;
  return {
    ...row,
    fields: safeParseJSON(row.fields, []),
  };
}

// ─── Form Connections (record ↔ form) ───

export async function handleListConnectionsForRecord(env, recordId, jsonResponse) {
  try {
    const { results: conns } = await env.DB.prepare(
      "SELECT * FROM form_connections WHERE record_id = ? ORDER BY connected_at"
    ).bind(recordId).all();
    const connections = conns || [];

    // Fetch all submissions for this record in one query
    const { results: subs } = await env.DB.prepare(
      "SELECT * FROM form_submissions WHERE record_id = ? ORDER BY created_at DESC"
    ).bind(recordId).all();
    const submissions = (subs || []).map(parseSubmissionRow);

    // Group submissions by connection_id
    const byConn = {};
    for (const sub of submissions) {
      (byConn[sub.connection_id] ||= []).push(sub);
    }

    // Hydrate each connection with its submissions
    const hydrated = connections.map((c) => ({
      ...c,
      submissions: byConn[c.id] || [],
    }));

    return jsonResponse({ connections: hydrated });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

export async function handleCreateConnection(env, body, user, jsonResponse) {
  try {
    if (!body.form_id || !body.record_id || !body.table_id) {
      return jsonResponse({ _error: "form_id, record_id, table_id required" }, 400);
    }

    // For single-instance forms: refuse if a connection already exists
    const form = await env.DB.prepare("SELECT form_type FROM form_definitions WHERE id = ?").bind(body.form_id).first();
    if (!form) return jsonResponse({ _error: "Form not found" }, 404);
    if (form.form_type === 'single_instance') {
      const existing = await env.DB.prepare(
        "SELECT id FROM form_connections WHERE form_id = ? AND record_id = ?"
      ).bind(body.form_id, body.record_id).first();
      if (existing) return jsonResponse({ _error: "This form is already connected to this record", code: "ALREADY_CONNECTED", connection_id: existing.id }, 409);
    }

    const id = crypto.randomUUID();
    const connectedBy = user?.sub || '';
    await env.DB.prepare(
      `INSERT INTO form_connections (id, form_id, record_id, table_id, connected_at, connected_by)
       VALUES (?, ?, ?, ?, datetime('now'), ?)`
    ).bind(id, body.form_id, body.record_id, body.table_id, connectedBy).run();

    const row = await env.DB.prepare("SELECT * FROM form_connections WHERE id = ?").bind(id).first();
    return jsonResponse({ connection: { ...row, submissions: [] } }, 201);
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

export async function handleDeleteFormConnection(env, connId, jsonResponse) {
  try {
    await env.DB.prepare("DELETE FROM form_submissions WHERE connection_id = ?").bind(connId).run();
    await env.DB.prepare("DELETE FROM form_connections WHERE id = ?").bind(connId).run();
    return jsonResponse({ ok: true });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

// ─── Form Submissions ───

export async function handleCreateSubmission(env, body, user, jsonResponse) {
  try {
    if (!body.connection_id || !body.form_id || !body.record_id) {
      return jsonResponse({ _error: "connection_id, form_id, record_id required" }, 400);
    }
    const id = body.id || crypto.randomUUID();
    const status = body.status === 'submitted' ? 'submitted' : 'draft';
    const values = body.values || {};
    const userId = user?.sub || '';
    const draftOwnerId = status === 'draft' ? userId : null;
    const submittedAt = status === 'submitted' ? "datetime('now')" : null;
    const submittedBy = status === 'submitted' ? userId : null;

    if (submittedAt) {
      await env.DB.prepare(
        `INSERT INTO form_submissions (id, connection_id, form_id, record_id, status, values, draft_owner_id, submitted_at, submitted_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, datetime('now'), datetime('now'))`
      ).bind(id, body.connection_id, body.form_id, body.record_id, status, JSON.stringify(values), draftOwnerId, submittedBy).run();
    } else {
      await env.DB.prepare(
        `INSERT INTO form_submissions (id, connection_id, form_id, record_id, status, values, draft_owner_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
      ).bind(id, body.connection_id, body.form_id, body.record_id, status, JSON.stringify(values), draftOwnerId).run();
    }

    const row = await env.DB.prepare("SELECT * FROM form_submissions WHERE id = ?").bind(id).first();
    return jsonResponse({ submission: parseSubmissionRow(row) }, 201);
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

export async function handleUpdateSubmission(env, subId, body, user, jsonResponse) {
  try {
    const existing = await env.DB.prepare("SELECT * FROM form_submissions WHERE id = ?").bind(subId).first();
    if (!existing) return jsonResponse({ _error: "Submission not found" }, 404);
    const userId = user?.sub || '';

    const sets = [];
    const binds = [];
    if (body.values !== undefined) { sets.push("values = ?"); binds.push(JSON.stringify(body.values)); }

    // Status transitions
    if (body.status !== undefined) {
      const newStatus = body.status === 'submitted' ? 'submitted' : 'draft';
      sets.push("status = ?"); binds.push(newStatus);
      if (newStatus === 'submitted') {
        // First-time submit: stamp submitted_at + submitted_by; clear draft_owner
        if (existing.status !== 'submitted') {
          sets.push("submitted_at = datetime('now')");
          sets.push("submitted_by = ?"); binds.push(userId);
          sets.push("draft_owner_id = NULL");
        } else {
          // Editing an already-submitted: stamp edited_at + edited_by
          sets.push("edited_at = datetime('now')");
          sets.push("edited_by = ?"); binds.push(userId);
        }
      }
    } else if (existing.status === 'submitted' && body.values !== undefined) {
      // Editing an already-submitted submission without explicit status change
      sets.push("edited_at = datetime('now')");
      sets.push("edited_by = ?"); binds.push(userId);
    }

    if (sets.length === 0) return jsonResponse({ _error: "No fields to update" }, 400);
    sets.push("updated_at = datetime('now')");
    binds.push(subId);
    await env.DB.prepare(`UPDATE form_submissions SET ${sets.join(", ")} WHERE id = ?`).bind(...binds).run();

    const row = await env.DB.prepare("SELECT * FROM form_submissions WHERE id = ?").bind(subId).first();
    return jsonResponse({ submission: parseSubmissionRow(row) });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

export async function handleDeleteSubmission(env, subId, jsonResponse) {
  try {
    await env.DB.prepare("DELETE FROM form_submissions WHERE id = ?").bind(subId).run();
    return jsonResponse({ ok: true });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

function parseSubmissionRow(row) {
  if (!row) return null;
  return {
    ...row,
    values: safeParseJSON(row.values, {}),
  };
}
