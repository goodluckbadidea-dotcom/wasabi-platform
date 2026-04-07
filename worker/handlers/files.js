// ─── File storage handlers (R2) ───
import { getFreshRole, checkPagePermission } from '../auth.js';

export async function handleFileUpload(request, env, jsonResponse) {
  try {
    const contentType = request.headers.get("content-type") || "";

    // Workspace quota check (5GB = 5368709120 bytes)
    const WORKSPACE_QUOTA = 5368709120;
    const FILE_MAX = 52428800; // 50MB per file

    // Support multipart form-data
    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const file = formData.get("file");
      if (!file || typeof file === "string") {
        return jsonResponse({ _error: "No file provided" }, 400);
      }
      if (file.size > FILE_MAX) {
        return jsonResponse({ _error: `File exceeds 50MB limit (${(file.size / 1048576).toFixed(1)}MB)` }, 400);
      }
      // Check workspace quota
      const usage = await env.DB.prepare("SELECT COALESCE(SUM(size), 0) as total FROM files").first();
      if ((usage?.total || 0) + file.size > WORKSPACE_QUOTA) {
        return jsonResponse({ _error: "Workspace storage limit (5GB) reached" }, 400);
      }

      const pageId = formData.get("page_id") || "";
      const recordId = formData.get("record_id") || "";
      const meta = formData.get("meta") || "{}";
      const id = crypto.randomUUID();
      const ext = file.name.split(".").pop() || "bin";
      const r2Key = `files/${id}.${ext}`;

      await env.DOCS.put(r2Key, file.stream(), {
        httpMetadata: { contentType: file.type || "application/octet-stream" },
      });

      await env.DB.prepare(
        `INSERT INTO files (id, name, r2_key, mime_type, size, page_id, record_id, meta) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(id, file.name, r2Key, file.type || "application/octet-stream", file.size, pageId, recordId, meta).run();

      return jsonResponse({ id, name: file.name, r2_key: r2Key, size: file.size, mime_type: file.type, record_id: recordId });
    }

    // Support JSON body with base64 data
    const body = await request.json();
    if (!body.name || !body.data) {
      return jsonResponse({ _error: "name and data (base64) required" }, 400);
    }
    const bytes = Uint8Array.from(atob(body.data), (c) => c.charCodeAt(0));
    if (bytes.length > FILE_MAX) {
      return jsonResponse({ _error: `File exceeds 50MB limit (${(bytes.length / 1048576).toFixed(1)}MB)` }, 400);
    }
    const usage = await env.DB.prepare("SELECT COALESCE(SUM(size), 0) as total FROM files").first();
    if ((usage?.total || 0) + bytes.length > WORKSPACE_QUOTA) {
      return jsonResponse({ _error: "Workspace storage limit (5GB) reached" }, 400);
    }

    const id = crypto.randomUUID();
    const ext = body.name.split(".").pop() || "bin";
    const r2Key = `files/${id}.${ext}`;
    const mimeType = body.mime_type || "application/octet-stream";

    await env.DOCS.put(r2Key, bytes, {
      httpMetadata: { contentType: mimeType },
    });

    await env.DB.prepare(
      `INSERT INTO files (id, name, r2_key, mime_type, size, page_id, record_id, meta) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, body.name, r2Key, mimeType, bytes.length, body.page_id || "", body.record_id || "", JSON.stringify(body.meta || {})).run();

    return jsonResponse({ id, name: body.name, r2_key: r2Key, size: bytes.length, mime_type: mimeType, record_id: body.record_id || "" });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

export async function handleListFiles(env, user, pageId, recordId, jsonResponse) {
  try {
    // Require page_id or record_id — no bare list-all (prevents leaking all workspace files)
    if (!pageId && !recordId) {
      // Admin can list all; non-admin must scope to a page or record
      const role = user ? await getFreshRole(env, user) : null;
      if (role !== "admin") {
        return jsonResponse({ _error: "page_id or record_id required" }, 400);
      }
    }

    let result;
    if (recordId) {
      // Verify user has access to the page this record belongs to
      if (user) {
        const record = await env.DB.prepare("SELECT table_id FROM table_rows WHERE id = ?").bind(recordId).first();
        if (record?.table_id) {
          const allowed = await checkPagePermission(env, user, record.table_id, "viewer");
          if (!allowed) return jsonResponse({ _error: "Access denied" }, 403);
        }
      }
      result = await env.DB.prepare("SELECT * FROM files WHERE record_id = ? ORDER BY created_at DESC").bind(recordId).all();
    } else if (pageId) {
      // Verify user has access to this page
      if (user) {
        const allowed = await checkPagePermission(env, user, pageId, "viewer");
        if (!allowed) return jsonResponse({ _error: "Access denied" }, 403);
      }
      result = await env.DB.prepare("SELECT * FROM files WHERE page_id = ? ORDER BY created_at DESC").bind(pageId).all();
    } else {
      result = await env.DB.prepare("SELECT * FROM files ORDER BY created_at DESC LIMIT 200").all();
    }
    return jsonResponse({ files: result.results || [] });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

export async function handleGetFile(env, user, id, jsonResponse) {
  try {
    const row = await env.DB.prepare("SELECT * FROM files WHERE id = ?").bind(id).first();
    if (!row) return jsonResponse({ _error: "File not found" }, 404);

    // Verify user has access to the page this file belongs to
    if (user && row.page_id) {
      const allowed = await checkPagePermission(env, user, row.page_id, "viewer");
      if (!allowed) return jsonResponse({ _error: "Access denied" }, 403);
    }

    const obj = await env.DOCS.get(row.r2_key);
    if (!obj) return jsonResponse({ _error: "File data not found in R2" }, 404);

    return new Response(obj.body, {
      headers: {
        ...jsonResponse.cors,
        "Content-Type": row.mime_type || "application/octet-stream",
        "Content-Disposition": `inline; filename="${row.name}"`,
        "Content-Length": String(row.size),
      },
    });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}

export async function handleDeleteFile(env, user, id, jsonResponse) {
  try {
    const row = await env.DB.prepare("SELECT r2_key, page_id FROM files WHERE id = ?").bind(id).first();
    if (!row) return jsonResponse({ _error: "File not found" }, 404);

    // Verify user has editor-level access to the page this file belongs to
    if (user && row.page_id) {
      const allowed = await checkPagePermission(env, user, row.page_id, "editor");
      if (!allowed) return jsonResponse({ _error: "Access denied" }, 403);
    }

    await env.DOCS.delete(row.r2_key);
    await env.DB.prepare("DELETE FROM files WHERE id = ?").bind(id).run();

    return jsonResponse({ success: true });
  } catch (err) {
    return jsonResponse({ _error: err.message }, 500);
  }
}
