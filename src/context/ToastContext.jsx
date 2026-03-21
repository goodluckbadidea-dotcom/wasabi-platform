// ─── Toast Context ───
// Global toast notification provider. Any component can show toasts via useToast().
// Usage: const { showToast } = useToast();
//        showToast("Page saved", "success");
//        showToast("Save failed", "error");

import React, { createContext, useContext, useState, useCallback, useRef } from "react";

const ToastContext = createContext(null);

let _nextId = 0;

// Module-level reference for non-component code (e.g., PagesContext).
// Set by ToastProvider on mount. Import and call: globalToast("message", "error")
let _globalShowToast = null;
export function globalToast(message, type = "info", durationMs = 4000) {
  if (_globalShowToast) return _globalShowToast(message, type, durationMs);
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timersRef = useRef(new Map());

  const dismiss = useCallback((id) => {
    // Mark as exiting for fade-out animation
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, exiting: true } : t)));
    // Remove after animation
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
      const timer = timersRef.current.get(id);
      if (timer) { clearTimeout(timer); timersRef.current.delete(id); }
    }, 200);
  }, []);

  const showToast = useCallback((message, type = "info", durationMs = 4000) => {
    const id = ++_nextId;
    setToasts((prev) => [...prev, { id, message, type, exiting: false }]);
    // Auto-dismiss
    const timer = setTimeout(() => dismiss(id), durationMs);
    timersRef.current.set(id, timer);
    return id;
  }, [dismiss]);

  // Register global reference for non-component code
  _globalShowToast = showToast;

  return (
    <ToastContext.Provider value={{ showToast, dismiss }}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

// ─── Toast Container (renders all active toasts) ───
import { C, FONT, RADIUS, SHADOW, Z } from "../design/tokens.js";

const TYPE_CONFIG = {
  success: { bg: "#1a2e1a", border: "#2A6B38", icon: "\u2713", color: "#4CAF50" },
  error:   { bg: "#2e1a1a", border: "#E05252", icon: "\u2717", color: "#E05252" },
  warning: { bg: "#2e261a", border: "#FF6B3D", icon: "\u26A0", color: "#FF6B3D" },
  info:    { bg: "#1a1a2e", border: C.accent, icon: "\u2139", color: C.accent },
};

function ToastContainer({ toasts, onDismiss }) {
  if (toasts.length === 0) return null;
  return (
    <div style={{
      position: "fixed", bottom: 24, right: 24, zIndex: Z.toast,
      display: "flex", flexDirection: "column-reverse", gap: 8,
      pointerEvents: "none",
    }}>
      {toasts.map((toast) => {
        const cfg = TYPE_CONFIG[toast.type] || TYPE_CONFIG.info;
        return (
          <div
            key={toast.id}
            style={{
              pointerEvents: "auto",
              background: cfg.bg,
              border: `1px solid ${cfg.border}`,
              borderRadius: RADIUS.lg,
              padding: "10px 16px",
              boxShadow: SHADOW.dropdown,
              fontFamily: FONT,
              fontSize: 13,
              color: C.darkText,
              display: "flex",
              alignItems: "center",
              gap: 10,
              maxWidth: 380,
              minWidth: 200,
              opacity: toast.exiting ? 0 : 1,
              transform: toast.exiting ? "translateX(20px)" : "translateX(0)",
              transition: "opacity 0.2s, transform 0.2s",
              animation: "toastSlideIn 0.2s ease-out",
            }}
          >
            <span style={{ fontSize: 16, color: cfg.color, flexShrink: 0 }}>{cfg.icon}</span>
            <span style={{ flex: 1 }}>{toast.message}</span>
            <button
              onClick={() => onDismiss(toast.id)}
              style={{
                background: "none", border: "none", color: C.darkMuted,
                cursor: "pointer", fontSize: 14, padding: "0 2px", flexShrink: 0,
              }}
            >
              ×
            </button>
          </div>
        );
      })}
      <style>{`
        @keyframes toastSlideIn {
          from { opacity: 0; transform: translateX(30px); }
          to { opacity: 1; transform: translateX(0); }
        }
      `}</style>
    </div>
  );
}
