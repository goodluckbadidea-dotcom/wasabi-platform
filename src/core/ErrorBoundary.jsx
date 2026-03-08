// ─── Error Boundary + View Skeletons ───
// Catches render errors in child trees, shows a retry-able fallback.
// ViewSkeleton provides shimmer loading placeholders per view type.
// No emojis — all SVG icons.

import React, { Component } from "react";
import { C, RADIUS, FONT } from "../design/tokens.js";
import { S } from "../design/styles.js";

// ── Error Boundary (must be a class component) ─────────────────────────────

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error(`[ErrorBoundary] ${this.props.fallbackLabel || "Component"} crashed:`, error, info);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      const label = this.props.fallbackLabel || "Component";
      const msg = this.state.error?.message || "An unexpected error occurred";
      const truncated = msg.length > 120 ? msg.slice(0, 120) + "..." : msg;

      return (
        <div
          style={{
            padding: 32,
            background: C.darkSurf,
            borderRadius: RADIUS.xl,
            border: `1px solid #E0525233`,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 12,
            minHeight: 140,
            fontFamily: FONT,
          }}
        >
          {/* Warning icon */}
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
            <path
              d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
              stroke="#E05252"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>

          <span
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "#E05252",
              letterSpacing: "0.02em",
            }}
          >
            {label} encountered an error
          </span>

          <span
            style={{
              fontSize: 11,
              color: C.darkMuted,
              textAlign: "center",
              maxWidth: 360,
              lineHeight: 1.5,
            }}
          >
            {truncated}
          </span>

          <button
            onClick={this.handleRetry}
            style={{
              ...S.btnSecondary,
              marginTop: 4,
              fontSize: 12,
              padding: "6px 16px",
            }}
          >
            Retry
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

// ── Shimmer bar helper ──────────────────────────────────────────────────────

function getShimmerBg() {
  return {
    background: `linear-gradient(90deg, ${C.darkSurf2} 25%, ${C.darkBorder} 50%, ${C.darkSurf2} 75%)`,
    backgroundSize: "200% 100%",
    animation: "shimmer 1.8s ease-in-out infinite",
    borderRadius: RADIUS.md,
  };
}

function ShimmerBar({ width = "100%", height = 10, style = {} }) {
  return <div style={{ ...getShimmerBg(), width, height, ...style }} />;
}

function ShimmerRect({ width = "100%", height = 80, style = {} }) {
  return <div style={{ ...getShimmerBg(), width, height, borderRadius: RADIUS.lg, ...style }} />;
}

// ── View Skeleton ───────────────────────────────────────────────────────────

export function ViewSkeleton({ viewType = "default" }) {
  const pad = { padding: 20, display: "flex", flexDirection: "column", gap: 10 };

  switch (viewType) {
    case "table":
      return (
        <div style={pad}>
          {/* Header row */}
          <div style={{ display: "flex", gap: 12, marginBottom: 4 }}>
            <ShimmerBar width="18%" height={12} />
            <ShimmerBar width="22%" height={12} />
            <ShimmerBar width="14%" height={12} />
            <ShimmerBar width="18%" height={12} />
            <ShimmerBar width="10%" height={12} />
          </div>
          {/* Data rows */}
          {[100, 85, 92, 70, 88, 78].map((w, i) => (
            <div key={i} style={{ display: "flex", gap: 12 }}>
              <ShimmerBar width={`${w * 0.18}%`} height={10} />
              <ShimmerBar width={`${w * 0.22}%`} height={10} />
              <ShimmerBar width={`${w * 0.14}%`} height={10} />
              <ShimmerBar width={`${w * 0.18}%`} height={10} />
              <ShimmerBar width={`${w * 0.10}%`} height={10} />
            </div>
          ))}
        </div>
      );

    case "kanban":
      return (
        <div style={{ padding: 20, display: "flex", gap: 16 }}>
          {[0, 1, 2].map((col) => (
            <div
              key={col}
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                gap: 10,
              }}
            >
              <ShimmerBar width="60%" height={12} />
              <ShimmerRect height={72} />
              <ShimmerRect height={56} />
              {col === 1 && <ShimmerRect height={64} />}
            </div>
          ))}
        </div>
      );

    case "gantt":
      return (
        <div style={pad}>
          {[70, 45, 85, 55, 65].map((w, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <ShimmerBar width="80px" height={10} />
              <ShimmerBar width={`${w}%`} height={18} />
            </div>
          ))}
        </div>
      );

    case "charts":
      return (
        <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
          <ShimmerBar width="30%" height={14} />
          <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: 160 }}>
            {[60, 90, 45, 75, 55, 80, 40].map((h, i) => (
              <ShimmerRect key={i} width="12%" height={`${h}%`} style={{ flexShrink: 0 }} />
            ))}
          </div>
        </div>
      );

    case "cardGrid":
      return (
        <div style={{ padding: 20, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <ShimmerRect height={100} />
              <ShimmerBar width="70%" height={10} />
              <ShimmerBar width="40%" height={8} />
            </div>
          ))}
        </div>
      );

    case "form":
      return (
        <div style={{ ...pad, maxWidth: 500, margin: "0 auto", width: "100%" }}>
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <ShimmerBar width="25%" height={10} />
              <ShimmerRect height={36} />
            </div>
          ))}
          <ShimmerBar width="100px" height={36} style={{ marginTop: 8, borderRadius: RADIUS.pill }} />
        </div>
      );

    case "summaryTiles":
      return (
        <div style={{ padding: 20, display: "flex", gap: 12 }}>
          {[0, 1, 2, 3].map((i) => (
            <ShimmerRect key={i} width="25%" height={80} />
          ))}
        </div>
      );

    case "activityFeed":
    case "notificationFeed":
      return (
        <div style={pad}>
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <ShimmerRect width={32} height={32} style={{ borderRadius: "50%", flexShrink: 0 }} />
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
                <ShimmerBar width="60%" height={10} />
                <ShimmerBar width="35%" height={8} />
              </div>
            </div>
          ))}
        </div>
      );

    default:
      return (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 40,
          }}
        >
          <ShimmerRect width={200} height={120} />
        </div>
      );
  }
}
