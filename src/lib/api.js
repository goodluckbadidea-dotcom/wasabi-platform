// ─── Wasabi API Client ───
// Centralized fetch wrapper with X-Wasabi-Key + JWT auth.
// All backend calls go through here.

const STORAGE_KEY = "wasabi_connection";
const JWT_STORAGE_KEY = "wasabi_jwt";

// ─── JWT Token Helpers ───

export function getJwt() {
  try { return localStorage.getItem(JWT_STORAGE_KEY) || null; } catch { return null; }
}

export function saveJwt(token) {
  try { localStorage.setItem(JWT_STORAGE_KEY, token); } catch {}
}

export function clearJwt() {
  try { localStorage.removeItem(JWT_STORAGE_KEY); } catch {}
}

/**
 * Get saved connection info (worker URL + secret).
 */
export function getConnection() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Save connection info.
 */
export function saveConnection(workerUrl, secret) {
  const conn = { workerUrl: workerUrl.replace(/\/+$/, ""), secret };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(conn));
  return conn;
}

/**
 * Clear connection info.
 */
export function clearConnection() {
  localStorage.removeItem(STORAGE_KEY);
}

/**
 * Core fetch wrapper — adds auth header + handles errors.
 */
async function apiFetch(path, options = {}) {
  const conn = getConnection();
  if (!conn?.workerUrl) {
    throw new Error("Not connected — complete setup first");
  }

  const url = `${conn.workerUrl}${path}`;
  const jwt = getJwt();
  const headers = {
    "Content-Type": "application/json",
    ...(conn.secret ? { "X-Wasabi-Key": conn.secret } : {}),
    ...(jwt ? { "Authorization": `Bearer ${jwt}` } : {}),
    ...(options.headers || {}),
  };

  const res = await fetch(url, {
    ...options,
    headers,
    body: options.body ? (typeof options.body === "string" ? options.body : JSON.stringify(options.body)) : undefined,
  });

  const data = await res.json().catch(() => ({ _error: `HTTP ${res.status}` }));

  if (!res.ok || data._error) {
    const err = new Error(data._error || `API error: ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }

  return data;
}

// ─── Health & Init ───

export async function checkHealth() {
  return apiFetch("/health", { method: "GET" });
}

export async function initDatabase() {
  return apiFetch("/init", { method: "POST" });
}

export async function factoryReset() {
  return apiFetch("/factory-reset", { method: "POST" });
}

// ─── Connections ───

export async function getConnections() {
  return apiFetch("/connections", { method: "GET" });
}

export async function setConnection(key, value, metadata = {}) {
  return apiFetch("/connections", {
    method: "POST",
    body: { key, value, metadata },
  });
}

export async function deleteConnection(key) {
  return apiFetch(`/connections/${key}`, { method: "DELETE" });
}

// ─── Page Config CRUD ───

export async function listPages() {
  return apiFetch("/pages", { method: "GET" });
}

export async function createPageConfig(pageConfig) {
  return apiFetch("/pages", { method: "POST", body: pageConfig });
}

export async function getPageConfig(id) {
  return apiFetch(`/pages/${id}`, { method: "GET" });
}

export async function updatePageConfig(id, updates) {
  return apiFetch(`/pages/${id}`, { method: "PATCH", body: updates });
}

export async function deletePageConfig(id) {
  return apiFetch(`/pages/${id}`, { method: "DELETE" });
}
export async function reorderPages(items) {
  return apiFetch("/pages/reorder", { method: "POST", body: { items } });
}

// ─── Table Schema ───

export async function getTableSchema(id) {
  return apiFetch(`/pages/${id}/schema`, { method: "GET" });
}

export async function updateTableSchema(id, columns) {
  return apiFetch(`/pages/${id}/schema`, { method: "PATCH", body: { columns } });
}

// ─── Table Rows ───

export async function listRows(tableId, { limit, offset, archived } = {}) {
  const params = new URLSearchParams();
  if (limit) params.set("limit", limit);
  if (offset) params.set("offset", offset);
  if (archived) params.set("archived", "true");
  const qs = params.toString();
  return apiFetch(`/tables/${tableId}/rows${qs ? `?${qs}` : ""}`, { method: "GET" });
}

export async function createRows(tableId, rows) {
  return apiFetch(`/tables/${tableId}/rows`, {
    method: "POST",
    body: { rows: Array.isArray(rows) ? rows : [rows] },
  });
}

export async function updateRow(tableId, rowId, updates) {
  // Default to merge mode for cell updates (partial cell updates)
  const body = { ...updates };
  if (body.cells && body.merge_cells === undefined) {
    body.merge_cells = true;
  }
  return apiFetch(`/tables/${tableId}/rows/${rowId}`, { method: "PATCH", body });
}

export async function updateRowOwner(tableId, rowId, ownerUserIds) {
  return apiFetch(`/tables/${tableId}/rows/${rowId}`, {
    method: "PATCH",
    body: { owner_user_id: ownerUserIds },
  });
}

export async function deleteRow(tableId, rowId) {
  return apiFetch(`/tables/${tableId}/rows/${rowId}`, { method: "DELETE" });
}

export async function queryTable(tableId, { filters, sorts, limit, offset } = {}) {
  return apiFetch(`/tables/${tableId}/query`, {
    method: "POST",
    body: { filters, sorts, limit, offset },
  });
}

// ─── Sheets ───

export async function getSheet(id) {
  return apiFetch(`/sheets/${id}`, { method: "GET" });
}

export async function updateSheet(id, updates) {
  return apiFetch(`/sheets/${id}`, { method: "PATCH", body: updates });
}

export async function sheetFormula(id, fn, args, target) {
  return apiFetch(`/sheets/${id}/formula`, {
    method: "POST",
    body: { fn, args, target },
  });
}

export async function sheetStructure(id, action, index) {
  return apiFetch(`/sheets/${id}/structure`, {
    method: "POST",
    body: { action, index },
  });
}

export async function resizeSheet(id, dimensions) {
  return apiFetch(`/sheets/${id}/resize`, {
    method: "POST",
    body: dimensions,
  });
}

// ─── Documents (R2) ───

export async function getDocument(id) {
  return apiFetch(`/docs/${id}`, { method: "GET" });
}

export async function saveDocument(id, content) {
  return apiFetch(`/docs/${id}`, { method: "PUT", body: { content } });
}

export async function updateDocBlocks(id, updates) {
  return apiFetch(`/docs/${id}/blocks`, {
    method: "PATCH",
    body: { updates },
  });
}

export async function exportDocNotion(id) {
  return apiFetch(`/docs/${id}/export/notion`, { method: "GET" });
}

// ─── Automation Rules ───

export async function listRules({ enabled } = {}) {
  const params = new URLSearchParams();
  if (enabled !== undefined) params.set("enabled", enabled);
  const qs = params.toString();
  return apiFetch(`/d1/rules${qs ? `?${qs}` : ""}`, { method: "GET" });
}

export async function createRule(rule) {
  return apiFetch("/d1/rules", { method: "POST", body: rule });
}

export async function getRule(id) {
  return apiFetch(`/d1/rules/${id}`, { method: "GET" });
}

export async function updateRule(id, updates) {
  return apiFetch(`/d1/rules/${id}`, { method: "PATCH", body: updates });
}

export async function deleteRule(id) {
  return apiFetch(`/d1/rules/${id}`, { method: "DELETE" });
}

// ─── Automation Flows ───

export async function listFlows({ enabled } = {}) {
  const params = new URLSearchParams();
  if (enabled !== undefined) params.set("enabled", enabled);
  const qs = params.toString();
  return apiFetch(`/d1/flows${qs ? `?${qs}` : ""}`, { method: "GET" });
}

export async function createFlow(flow) {
  return apiFetch("/d1/flows", { method: "POST", body: flow });
}

export async function getFlow(id) {
  return apiFetch(`/d1/flows/${id}`, { method: "GET" });
}

export async function updateFlow(id, updates) {
  return apiFetch(`/d1/flows/${id}`, { method: "PATCH", body: updates });
}

export async function deleteFlow(id) {
  return apiFetch(`/d1/flows/${id}`, { method: "DELETE" });
}

// ─── Notifications ───

export async function listNotifications({ status, limit, offset } = {}) {
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  if (limit) params.set("limit", limit);
  if (offset) params.set("offset", offset);
  const qs = params.toString();
  return apiFetch(`/d1/notifications${qs ? `?${qs}` : ""}`, { method: "GET" });
}

export async function createNotification({ message, type, source, record_id, record_name, page_config_id, page_name, actor_name, target_user_id }) {
  return apiFetch("/d1/notifications", {
    method: "POST",
    body: { message, type, source, record_id, record_name, page_config_id, page_name, actor_name, target_user_id },
  });
}

export async function updateNotification(id, updates) {
  return apiFetch(`/d1/notifications/${id}`, { method: "PATCH", body: updates });
}

export async function deleteNotification(id) {
  return apiFetch(`/d1/notifications/${id}`, { method: "DELETE" });
}

export async function markAllNotificationsRead() {
  return apiFetch("/d1/notifications/mark-all-read", { method: "POST" });
}

export async function getUnreadNotificationCount() {
  return apiFetch("/d1/notifications/unread-count", { method: "GET" });
}

export async function getNotificationPreferences() {
  return apiFetch("/d1/notifications/preferences", { method: "GET" });
}

export async function putNotificationPreferences(prefs) {
  return apiFetch("/d1/notifications/preferences", { method: "PUT", body: prefs });
}

// ─── Knowledge Base ───

export async function listKB({ category } = {}) {
  const params = new URLSearchParams();
  if (category) params.set("category", category);
  const qs = params.toString();
  return apiFetch(`/d1/kb${qs ? `?${qs}` : ""}`, { method: "GET" });
}

export async function createKBEntry({ key, category, content, source, related_pages }) {
  return apiFetch("/d1/kb", {
    method: "POST",
    body: { key, category, content, source, related_pages },
  });
}

export async function updateKBEntry(id, updates) {
  return apiFetch(`/d1/kb/${id}`, { method: "PATCH", body: updates });
}

export async function deleteKBEntry(id) {
  return apiFetch(`/d1/kb/${id}`, { method: "DELETE" });
}

export async function searchKB(query, category) {
  return apiFetch("/d1/kb/search", {
    method: "POST",
    body: { query, category },
  });
}

// ─── Custom Functions ───

export async function listCustomFunctions({ status, type } = {}) {
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  if (type) params.set("type", type);
  const qs = params.toString();
  return apiFetch(`/d1/custom-functions${qs ? `?${qs}` : ""}`, { method: "GET" });
}

export async function createCustomFunction({ id, name, description, type, inputs, outputs, code, status, meta }) {
  return apiFetch("/d1/custom-functions", {
    method: "POST",
    body: { id, name, description, type, inputs, outputs, code, status, meta },
  });
}

export async function getCustomFunction(id) {
  return apiFetch(`/d1/custom-functions/${id}`, { method: "GET" });
}

export async function updateCustomFunction(id, updates) {
  return apiFetch(`/d1/custom-functions/${id}`, { method: "PATCH", body: updates });
}

export async function deleteCustomFunction(id) {
  return apiFetch(`/d1/custom-functions/${id}`, { method: "DELETE" });
}

// ─── Function Executions (Audit Trail) ───

export async function listFunctionExecutions({ function_id, limit = 50 } = {}) {
  const params = new URLSearchParams();
  if (function_id) params.set("function_id", function_id);
  if (limit) params.set("limit", String(limit));
  const qs = params.toString();
  return apiFetch(`/d1/function-executions${qs ? `?${qs}` : ""}`, { method: "GET" });
}

export async function createFunctionExecution(data) {
  return apiFetch("/d1/function-executions", { method: "POST", body: data });
}

// ─── Flow Executions ───

export async function listFlowExecutions({ flow_id, limit = 50 } = {}) {
  const params = new URLSearchParams();
  if (flow_id) params.set("flow_id", flow_id);
  if (limit) params.set("limit", String(limit));
  const qs = params.toString();
  return apiFetch(`/d1/flow-executions${qs ? `?${qs}` : ""}`, { method: "GET" });
}

export async function createFlowExecution(data) {
  return apiFetch("/d1/flow-executions", { method: "POST", body: data });
}

export async function updateFlowExecution(id, data) {
  return apiFetch(`/d1/flow-executions/${encodeURIComponent(id)}`, { method: "PATCH", body: data });
}

// ─── External API Proxy ───

export async function proxyExternalApi({ url, method = "GET", headers = {}, body, transform_path }) {
  return apiFetch("/proxy/external-api", {
    method: "POST",
    body: { url, method, headers, body, transform_path },
  });
}

// ─── Notion Sync ───

export async function configureSyncNotionDB(tableId, { notion_db_id, direction, field_mapping }) {
  return apiFetch(`/sync/${tableId}/configure`, {
    method: "POST",
    body: { notion_db_id, direction, field_mapping },
  });
}

export async function syncPush(tableId) {
  return apiFetch(`/sync/${tableId}/push`, { method: "POST" });
}

export async function syncPull(tableId, fullResync = false) {
  const qs = fullResync ? "?full=1" : "";
  return apiFetch(`/sync/${tableId}/pull${qs}`, { method: "POST" });
}

export async function syncFlush() {
  return apiFetch("/sync/flush", { method: "POST" });
}

export async function getSyncStatus(tableId) {
  return apiFetch(`/sync/${tableId}/status`, { method: "GET" });
}

export async function deleteSync(tableId) {
  return apiFetch(`/sync/${tableId}`, { method: "DELETE" });
}

// ─── Disconnect & Sync Backup ───

export async function disconnectPage(pageId) {
  return apiFetch(`/pages/${pageId}/disconnect`, { method: "POST" });
}

export async function createSyncBackup(pageId, parentPageId) {
  return apiFetch(`/pages/${pageId}/sync-backup`, {
    method: "POST",
    body: JSON.stringify({ parent_page_id: parentPageId }),
  });
}

// ─── Data Summary Cache ───

export async function getSummaryCache(pageId) {
  return apiFetch(`/pages/${pageId}/summary`, { method: "GET" });
}

export async function setSummaryCache(pageId, summary) {
  return apiFetch(`/pages/${pageId}/summary`, { method: "PUT", body: { summary } });
}

// ─── Notion Proxy (backward compat) ───
// These maintain the existing API surface so current code keeps working.

export async function notionProxy(path, method, body, notionKey) {
  const headers = {};
  if (notionKey) headers["Authorization"] = `Bearer ${notionKey}`;
  return apiFetch(path, { method, body, headers });
}

// ─── Claude Proxy (backward compat) ───

export async function claudeProxy(body, claudeKey) {
  const headers = {};
  if (claudeKey) headers["X-Claude-Key"] = claudeKey;
  return apiFetch("/claude", { method: "POST", body, headers });
}

// ─── Relation Title Resolution ───

export async function resolvePageTitles(ids) {
  if (!ids || ids.length === 0) return {};
  return apiFetch("/pages/titles", { method: "POST", body: { ids } });
}

// ─── Record Notes ───

export async function getRecordNote(recordId, pageConfigId) {
  return apiFetch(`/records/${recordId}/notes?page_config_id=${encodeURIComponent(pageConfigId)}`);
}

export async function saveRecordNote(recordId, pageConfigId, content) {
  return apiFetch(`/records/${recordId}/notes`, {
    method: "PUT",
    body: { page_config_id: pageConfigId, content },
  });
}

// ─── Record Comments ───

export async function listRecordComments(recordId, pageConfigId) {
  return apiFetch(`/records/${recordId}/comments?page_config_id=${encodeURIComponent(pageConfigId)}`);
}

export async function createRecordComment(recordId, pageConfigId, content, userId, userName) {
  return apiFetch(`/records/${recordId}/comments`, {
    method: "POST",
    body: { page_config_id: pageConfigId, content, user_id: userId, user_name: userName },
  });
}

export async function deleteRecordComment(recordId, commentId) {
  return apiFetch(`/records/${recordId}/comments/${commentId}`, { method: "DELETE" });
}

// ─── Cell Links ───

export async function listLinks(targetPageId, targetViewIdx) {
  const params = new URLSearchParams();
  if (targetPageId) params.set("target_page_id", targetPageId);
  if (targetViewIdx != null) params.set("target_view_idx", String(targetViewIdx));
  const qs = params.toString();
  return apiFetch(`/links${qs ? `?${qs}` : ""}`, { method: "GET" });
}

export async function getLink(id) {
  return apiFetch(`/links/${id}`, { method: "GET" });
}

export async function createLinkAPI(link) {
  return apiFetch("/links", { method: "POST", body: link });
}

export async function updateLinkAPI(id, updates) {
  return apiFetch(`/links/${id}`, { method: "PATCH", body: updates });
}

export async function deleteLinkAPI(id) {
  return apiFetch(`/links/${id}`, { method: "DELETE" });
}

export async function getLinksBySource(pageId) {
  return apiFetch(`/links/by-source/${encodeURIComponent(pageId)}`, { method: "GET" });
}

// ─── Neurons ───

export async function listNeurons() {
  return apiFetch("/neurons", { method: "GET" });
}

export async function getNeuron(id) {
  return apiFetch(`/neurons/${id}`, { method: "GET" });
}

export async function createNeuronAPI(name, nodes) {
  return apiFetch("/neurons", { method: "POST", body: { name, nodes } });
}

export async function updateNeuronAPI(id, updates) {
  return apiFetch(`/neurons/${id}`, { method: "PATCH", body: updates });
}

export async function deleteNeuronAPI(id) {
  return apiFetch(`/neurons/${id}`, { method: "DELETE" });
}

export async function addNeuronNode(neuronId, node) {
  return apiFetch(`/neurons/${neuronId}/nodes`, { method: "POST", body: node });
}

export async function removeNeuronNode(neuronId, nodeId) {
  return apiFetch(`/neurons/${neuronId}/nodes/${nodeId}`, { method: "DELETE" });
}

export async function getNeuronsByNode(nodeId) {
  return apiFetch(`/neurons/by-node/${encodeURIComponent(nodeId)}`, { method: "GET" });
}

export async function getNeuronGraph() {
  return apiFetch("/neurons/graph", { method: "GET" });
}

// ─── File Storage (R2) ───

export async function uploadFile(file, pageId = "") {
  const conn = getConnection();
  if (!conn?.workerUrl) throw new Error("Not connected");

  const formData = new FormData();
  formData.append("file", file);
  if (pageId) formData.append("page_id", pageId);

  const jwt = getJwt();
  const res = await fetch(`${conn.workerUrl}/files`, {
    method: "POST",
    headers: {
      ...(conn.secret ? { "X-Wasabi-Key": conn.secret } : {}),
      ...(jwt ? { "Authorization": `Bearer ${jwt}` } : {}),
    },
    body: formData,
  });
  const data = await res.json().catch(() => ({ _error: `HTTP ${res.status}` }));
  if (!res.ok || data._error) throw new Error(data._error || `Upload error: ${res.status}`);
  return data;
}

export async function listFiles(pageId) {
  const qs = pageId ? `?page_id=${encodeURIComponent(pageId)}` : "";
  return apiFetch(`/files${qs}`, { method: "GET" });
}

export function getFileUrl(fileId) {
  const conn = getConnection();
  if (!conn?.workerUrl) return "";
  return `${conn.workerUrl}/files/${fileId}`;
}

export async function deleteFile(fileId) {
  return apiFetch(`/files/${fileId}`, { method: "DELETE" });
}

// ─── Record Files (per-record) ───

export async function listFilesByRecord(recordId) {
  return apiFetch(`/files?record_id=${encodeURIComponent(recordId)}`, { method: "GET" });
}

export async function uploadFileToRecord(file, recordId, pageConfigId = "") {
  const conn = getConnection();
  if (!conn?.workerUrl) throw new Error("Not connected");

  const formData = new FormData();
  formData.append("file", file);
  formData.append("record_id", recordId);
  if (pageConfigId) formData.append("page_id", pageConfigId);

  const jwt = getJwt();
  const res = await fetch(`${conn.workerUrl}/files`, {
    method: "POST",
    headers: {
      ...(conn.secret ? { "X-Wasabi-Key": conn.secret } : {}),
      ...(jwt ? { "Authorization": `Bearer ${jwt}` } : {}),
    },
    body: formData,
  });
  const data = await res.json().catch(() => ({ _error: `HTTP ${res.status}` }));
  if (!res.ok || data._error) throw new Error(data._error || `Upload error: ${res.status}`);
  return data;
}

// ─── Record Badge Counts ───

export async function getRecordBadgeCounts(recordIds, pageConfigId) {
  return apiFetch("/records/badge-counts", {
    method: "POST",
    body: { record_ids: recordIds, page_config_id: pageConfigId },
  });
}

// ─── Google OAuth ───

export async function getGoogleAuthUrl() {
  return apiFetch("/google/auth-url", { method: "GET" });
}

export async function getGoogleStatus() {
  return apiFetch("/google/status", { method: "GET" });
}

export async function disconnectGoogle() {
  return apiFetch("/google/disconnect", { method: "POST" });
}

// ─── Gmail ───

export async function getGmailSummary() {
  return apiFetch("/google/gmail/summary", { method: "GET" });
}

export async function searchEmails(query, maxResults = 20, labelIds) {
  return apiFetch("/google/gmail/messages", {
    method: "POST",
    body: { q: query, maxResults, labelIds },
  });
}

export async function getEmail(messageId) {
  return apiFetch(`/google/gmail/messages/${messageId}`, { method: "GET" });
}

export async function sendEmail({ to, subject, bodyText, threadId, inReplyTo, references }) {
  return apiFetch("/google/gmail/send", {
    method: "POST",
    body: { to, subject, bodyText, threadId, inReplyTo, references },
  });
}

export async function createDraft({ to, subject, bodyText }) {
  return apiFetch("/google/gmail/drafts", {
    method: "POST",
    body: { to, subject, bodyText },
  });
}

export async function modifyEmail(messageId, action) {
  return apiFetch(`/google/gmail/modify/${messageId}`, {
    method: "POST",
    body: typeof action === "string" ? { action } : action,
  });
}

export async function getThread(threadId) {
  return apiFetch(`/google/gmail/threads/${threadId}`, { method: "GET" });
}

export async function updateDraft(draftId, { to, subject, bodyText, threadId }) {
  return apiFetch(`/google/gmail/drafts/${draftId}`, {
    method: "PUT",
    body: { to, subject, bodyText, threadId },
  });
}

// ─── Task Activity ───

export async function listTaskActivity(source) {
  return apiFetch(`/task-activity?source=${encodeURIComponent(source)}`);
}

export async function upsertTaskActivity(taskId, source, lastActivityAt) {
  return apiFetch(`/task-activity/${taskId}`, {
    method: "PUT",
    body: { source, last_activity_at: lastActivityAt },
  });
}

// ─── Task Interaction Journal ───

export async function logTaskInteraction(taskId, source, userId, interactionType, detail) {
  return apiFetch("/task-interactions", {
    method: "POST",
    body: { task_id: taskId, source, user_id: userId || "default", interaction_type: interactionType, detail: detail || null },
  });
}

export async function listTaskInteractions(source, userId) {
  const params = new URLSearchParams();
  if (source) params.set("source", source);
  if (userId) params.set("user_id", userId);
  return apiFetch(`/task-interactions?${params.toString()}`, { method: "GET" });
}

export async function getInteractionSummary(taskId) {
  return apiFetch(`/task-interactions/${taskId}/summary`, { method: "GET" });
}

// ─── Google Calendar ───

export async function listCalendars() {
  return apiFetch("/google/calendar/list", { method: "GET" });
}

export async function getCalendarSummary() {
  return apiFetch("/google/calendar/summary", { method: "GET" });
}

export async function listCalendarEvents(timeMin, timeMax, maxResults = 50) {
  const params = new URLSearchParams();
  if (timeMin) params.set("timeMin", timeMin);
  if (timeMax) params.set("timeMax", timeMax);
  if (maxResults) params.set("maxResults", String(maxResults));
  return apiFetch(`/google/calendar/events?${params}`, { method: "GET" });
}

export async function createCalendarEvent({ summary, start, end, description, location, attendees }) {
  return apiFetch("/google/calendar/events", {
    method: "POST",
    body: { summary, start, end, description, location, attendees },
  });
}

export async function updateCalendarEvent(eventId, updates) {
  return apiFetch(`/google/calendar/events/${eventId}`, {
    method: "PATCH",
    body: updates,
  });
}

export async function deleteCalendarEvent(eventId) {
  return apiFetch(`/google/calendar/events/${eventId}`, { method: "DELETE" });
}

export async function checkFreeBusy(timeMin, timeMax) {
  return apiFetch("/google/calendar/freebusy", {
    method: "POST",
    body: { timeMin, timeMax },
  });
}

// ─── Auth ───

export async function authRegister(inviteCode, displayName, password) {
  return apiFetch("/auth/register", {
    method: "POST",
    body: { invite_code: inviteCode, display_name: displayName, password },
  });
}

export async function authLogin(displayName, password) {
  return apiFetch("/auth/login", {
    method: "POST",
    body: { display_name: displayName, password },
  });
}

export async function authMe() {
  return apiFetch("/auth/me", { method: "GET" });
}

export async function authRefresh() {
  return apiFetch("/auth/refresh", { method: "POST" });
}

// ─── User Management ───

export async function createInvite(role = "viewer", displayName = "Invited User") {
  return apiFetch("/users/invite", {
    method: "POST",
    body: { role, display_name: displayName },
  });
}

export async function listUsers() {
  return apiFetch("/users", { method: "GET" });
}

export async function updateUser(id, updates) {
  return apiFetch(`/users/${id}`, { method: "PATCH", body: updates });
}

export async function deleteUser(id) {
  return apiFetch(`/users/${id}`, { method: "DELETE" });
}

export async function restoreUser(id) {
  return apiFetch(`/users/${id}/restore`, { method: "POST" });
}

export async function hardDeleteUser(id, transferTo = "unassigned") {
  return apiFetch(`/users/${id}/hard-delete`, {
    method: "POST",
    body: { transfer_to: transferTo },
  });
}

export async function resetUserPassword(id) {
  return apiFetch(`/users/${id}/reset`, { method: "POST" });
}

// ─── Per-User State ───

export async function getUserState() {
  return apiFetch("/user-state", { method: "GET" });
}

export async function putUserState(updates) {
  return apiFetch("/user-state", { method: "PUT", body: updates });
}

// ─── Per-User Dashboard ───

export async function getUserDashboard() {
  return apiFetch("/user-dashboard", { method: "GET" });
}

export async function putUserDashboard(widgets) {
  return apiFetch("/user-dashboard", { method: "PUT", body: { widgets } });
}

// ─── Record Views ───

export async function putRecordView(recordId) {
  return apiFetch(`/record-views/${recordId}`, { method: "PUT" });
}

export async function getRecordViews(since) {
  const params = since ? `?since=${encodeURIComponent(since)}` : "";
  return apiFetch(`/record-views${params}`, { method: "GET" });
}

// ─── PIN Lock ───

export async function setPin(pin) {
  return apiFetch("/pin/set", { method: "POST", body: { pin } });
}

export async function verifyPin(pin, pageId) {
  return apiFetch("/pin/verify", { method: "POST", body: { pin, page_id: pageId } });
}

// ─── Page Permissions ───

export async function getPagePermissions(pageId) {
  return apiFetch(`/pages/${pageId}/permissions`, { method: "GET" });
}

export async function setPagePermission(pageId, userId, permission) {
  return apiFetch(`/pages/${pageId}/permissions`, {
    method: "PUT",
    body: { user_id: userId, permission },
  });
}

export async function removePagePermission(pageId, userId) {
  return apiFetch(`/pages/${pageId}/permissions/${userId}`, { method: "DELETE" });
}

// ─── Audit Log ───

export async function getAuditLog({ action, resource_type, limit = 100, offset = 0 } = {}) {
  const params = new URLSearchParams();
  if (action) params.set("action", action);
  if (resource_type) params.set("resource_type", resource_type);
  params.set("limit", String(limit));
  params.set("offset", String(offset));
  return apiFetch(`/audit-log?${params}`, { method: "GET" });
}
