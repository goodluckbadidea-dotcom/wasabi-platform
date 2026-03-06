// ─── Onboarding Screen ───
// First screen after setup: Wasabi flame + "What do you want to build?" + template buttons.

import React, { useEffect } from "react";
import { C, FONT, RADIUS, SHADOW } from "../design/tokens.js";
import { ANIM, injectAnimations } from "../design/animations.js";
import { usePlatform } from "../context/PlatformContext.jsx";

// Template definitions
const TEMPLATES = [
  { id: "project-management", icon: "📊", name: "Project Management", desc: "Gantt timeline, task table, kanban board" },
  { id: "crm", icon: "🤝", name: "CRM", desc: "Contact cards, deal tracking, activity feed" },
  { id: "inventory", icon: "📦", name: "Inventory", desc: "Stock table, charts, reorder alerts" },
  { id: "operations", icon: "⚡", name: "Operations", desc: "Task kanban, timeline, notifications" },
  { id: "finances", icon: "💰", name: "Finances", desc: "Transaction table, charts, summaries" },
  { id: "todo", icon: "✅", name: "To-Do List", desc: "Simple kanban, table, quick-add form" },
];

export default function Onboarding({ WasabiFlame, onStartBlank, onStartTemplate }) {
  useEffect(() => { injectAnimations(); }, []);

  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      height: "100%",
      padding: 40,
      background: C.bg,
      overflow: "auto",
    }}>
      {/* Wasabi Flame */}
      <div style={{
        animation: ANIM.fadeUp(0),
        marginBottom: 24,
      }}>
        {WasabiFlame ? (
          <WasabiFlame size={100} />
        ) : (
          <div style={{
            width: 100,
            height: 100,
            borderRadius: "50%",
            background: `linear-gradient(135deg, #a8e05a, ${C.accent})`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 48,
            boxShadow: `0 8px 32px ${C.accent}33`,
          }}>
            🌿
          </div>
        )}
      </div>

      {/* Heading */}
      <h1 style={{
        fontSize: 28,
        fontWeight: 700,
        color: C.text,
        letterSpacing: "-0.03em",
        marginBottom: 6,
        animation: ANIM.fadeUp(0.05),
        textAlign: "center",
      }}>
        What do you want to build?
      </h1>

      <p style={{
        fontSize: 14,
        color: C.muted,
        marginBottom: 36,
        animation: ANIM.fadeUp(0.1),
        textAlign: "center",
        maxWidth: 420,
        lineHeight: 1.5,
      }}>
        Pick a template to get started, or describe what you need and we'll build it together.
      </p>

      {/* Template Grid */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
        gap: 12,
        width: "100%",
        maxWidth: 600,
        marginBottom: 24,
      }}>
        {TEMPLATES.map((tpl, i) => (
          <button
            key={tpl.id}
            onClick={() => onStartTemplate(tpl)}
            style={{
              background: C.white,
              border: `1px solid ${C.border}`,
              borderRadius: RADIUS.xl,
              padding: "18px 16px",
              cursor: "pointer",
              textAlign: "left",
              transition: "all 0.15s",
              boxShadow: SHADOW.card,
              fontFamily: FONT,
              animation: ANIM.fadeUp(0.1 + i * 0.03),
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = C.accent;
              e.currentTarget.style.boxShadow = SHADOW.cardHover;
              e.currentTarget.style.transform = "translateY(-2px)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = C.border;
              e.currentTarget.style.boxShadow = SHADOW.card;
              e.currentTarget.style.transform = "translateY(0)";
            }}
          >
            <div style={{ fontSize: 24, marginBottom: 8 }}>{tpl.icon}</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 4 }}>
              {tpl.name}
            </div>
            <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.4 }}>
              {tpl.desc}
            </div>
          </button>
        ))}
      </div>

      {/* Start blank */}
      <button
        onClick={onStartBlank}
        style={{
          ...({
            background: "transparent",
            color: C.accent,
            border: `1px solid ${C.accent}44`,
            borderRadius: RADIUS.pill,
            padding: "10px 24px",
            fontSize: 14,
            fontWeight: 600,
            fontFamily: FONT,
            cursor: "pointer",
            transition: "all 0.15s",
            animation: ANIM.fadeUp(0.3),
          }),
        }}
        onMouseEnter={(e) => {
          e.target.style.background = C.accent + "14";
          e.target.style.borderColor = C.accent + "66";
        }}
        onMouseLeave={(e) => {
          e.target.style.background = "transparent";
          e.target.style.borderColor = C.accent + "44";
        }}
      >
        Or start from scratch →
      </button>
    </div>
  );
}

export { TEMPLATES };
