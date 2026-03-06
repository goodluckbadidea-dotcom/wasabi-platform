// ─── Keyboard Shortcuts Hook ───
// Global keyboard shortcut manager for the Wasabi platform.
// Uses Cmd/Ctrl modifiers for cross-platform support.

import { useEffect, useCallback, useRef } from "react";

/**
 * Detect if running on macOS.
 */
const isMac = typeof navigator !== "undefined" && /Mac|iPod|iPhone|iPad/.test(navigator.platform);

/**
 * Check if an event matches a shortcut definition.
 * Shortcut format: "mod+k" (mod = Cmd on Mac, Ctrl elsewhere), "shift+mod+p", "escape", etc.
 */
function matchesShortcut(event, shortcut) {
  const parts = shortcut.toLowerCase().split("+");
  const key = parts.pop();

  const needsMod = parts.includes("mod");
  const needsShift = parts.includes("shift");
  const needsAlt = parts.includes("alt");

  const modKey = isMac ? event.metaKey : event.ctrlKey;

  if (needsMod && !modKey) return false;
  if (!needsMod && modKey) return false;
  if (needsShift && !event.shiftKey) return false;
  if (!needsShift && event.shiftKey && key !== "shift") return false;
  if (needsAlt && !event.altKey) return false;
  if (!needsAlt && event.altKey) return false;

  // Map special key names
  const keyMap = {
    escape: "Escape",
    enter: "Enter",
    space: " ",
    tab: "Tab",
    backspace: "Backspace",
    delete: "Delete",
    up: "ArrowUp",
    down: "ArrowDown",
    left: "ArrowLeft",
    right: "ArrowRight",
  };

  const expectedKey = keyMap[key] || key;
  return event.key.toLowerCase() === expectedKey.toLowerCase();
}

/**
 * Hook for registering keyboard shortcuts.
 *
 * @param {Array<{ shortcut: string, handler: Function, description: string, when?: () => boolean }>} shortcuts
 * @param {Array} deps - Dependencies to re-register shortcuts
 *
 * Usage:
 * useKeyboardShortcuts([
 *   { shortcut: "mod+k", handler: () => openSearch(), description: "Open search" },
 *   { shortcut: "escape", handler: () => closePanel(), description: "Close panel" },
 * ]);
 */
export function useKeyboardShortcuts(shortcuts, deps = []) {
  const shortcutsRef = useRef(shortcuts);
  shortcutsRef.current = shortcuts;

  useEffect(() => {
    function handleKeyDown(event) {
      // Skip if user is typing in an input, textarea, or contenteditable
      const tag = event.target?.tagName?.toLowerCase();
      const isEditable = tag === "input" || tag === "textarea" || tag === "select" || event.target?.isContentEditable;

      for (const { shortcut, handler, when } of shortcutsRef.current) {
        if (!matchesShortcut(event, shortcut)) continue;

        // Check conditional guard
        if (when && !when()) continue;

        // Allow escape to work even in inputs
        if (isEditable && !shortcut.includes("escape") && !shortcut.includes("mod+")) continue;

        event.preventDefault();
        event.stopPropagation();
        handler(event);
        return;
      }
    }

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, deps);
}

/**
 * Format a shortcut string for display.
 * "mod+k" -> "⌘K" (Mac) or "Ctrl+K" (Windows/Linux)
 */
export function formatShortcut(shortcut) {
  const parts = shortcut.split("+");
  const symbols = parts.map((p) => {
    switch (p.toLowerCase()) {
      case "mod": return isMac ? "\u2318" : "Ctrl";
      case "shift": return isMac ? "\u21E7" : "Shift";
      case "alt": return isMac ? "\u2325" : "Alt";
      case "escape": return "Esc";
      case "enter": return "\u21B5";
      case "backspace": return "\u232B";
      case "delete": return "Del";
      case "up": return "\u2191";
      case "down": return "\u2193";
      case "left": return "\u2190";
      case "right": return "\u2192";
      default: return p.toUpperCase();
    }
  });

  return isMac ? symbols.join("") : symbols.join("+");
}

/**
 * All available keyboard shortcuts for the platform.
 * Used for help display and documentation.
 */
export const SHORTCUT_MAP = {
  search: { shortcut: "mod+k", description: "Open search / command palette" },
  newPage: { shortcut: "mod+n", description: "New page (open builder)" },
  refresh: { shortcut: "mod+r", description: "Refresh current view" },
  toggleSidebar: { shortcut: "mod+b", description: "Toggle sidebar" },
  toggleWasabi: { shortcut: "mod+w", description: "Toggle Wasabi panel" },
  escape: { shortcut: "escape", description: "Close panel / cancel" },
  prevPage: { shortcut: "mod+up", description: "Previous page" },
  nextPage: { shortcut: "mod+down", description: "Next page" },
};
