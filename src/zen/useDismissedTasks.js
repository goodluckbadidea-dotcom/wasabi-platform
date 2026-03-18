// ─── useDismissedTasks Hook ───
// Session-scoped tracker for tasks the user has completed or dismissed.
// Prevents dismissed AI tasks from reappearing on re-scan within the same session.
// Uses sessionStorage so state clears on browser restart (fresh session = fresh list).

import { useState, useCallback } from "react";

const STORAGE_KEY = "wasabi_dismissed_tasks";

function loadFromSession() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

function saveToSession(ids) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]));
  } catch {}
}

export default function useDismissedTasks() {
  const [dismissedIds, setDismissedIds] = useState(() => loadFromSession());

  const dismiss = useCallback((taskId) => {
    setDismissedIds((prev) => {
      const next = new Set(prev);
      next.add(taskId);
      saveToSession(next);
      return next;
    });
  }, []);

  const isDismissed = useCallback((taskId) => dismissedIds.has(taskId), [dismissedIds]);

  const clear = useCallback(() => {
    setDismissedIds(new Set());
    try { sessionStorage.removeItem(STORAGE_KEY); } catch {}
  }, []);

  return {
    dismissedIds,
    completedCount: dismissedIds.size,
    dismiss,
    isDismissed,
    clear,
  };
}
