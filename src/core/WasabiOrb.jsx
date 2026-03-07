// ─── WasabiOrb ──────────────────────────────────────────────────────────────
// Animated wasabi-green liquid orb floating in zero gravity.
// Organic blob shape that undulates and morphs like a fluid droplet in 0g.
// Two expressive eyes wander, blink, and track surface deformation.
// Used exclusively as the chat avatar next to Wasabi's messages.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useRef, useEffect, useState, useMemo } from "react";
import { C } from "../design/tokens.js";

const VS = 64;
const CX = VS / 2;
const CY = VS / 2;
const BASE_R = 22;
const N_POINTS = 8;
const TWO_PI = Math.PI * 2;

let _orbIdCounter = 0;

// Smooth closed cubic-bezier curve through radial control points
function buildBlobPath(cx, cy, radii, angles) {
  const n = radii.length;
  const pts = [];
  for (let i = 0; i < n; i++) {
    pts.push({
      x: cx + Math.cos(angles[i]) * radii[i],
      y: cy + Math.sin(angles[i]) * radii[i],
    });
  }
  const tension = 0.33;
  let d = `M ${pts[0].x},${pts[0].y}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];
    const cp1x = p1.x + (p2.x - p0.x) * tension;
    const cp1y = p1.y + (p2.y - p0.y) * tension;
    const cp2x = p2.x - (p3.x - p1.x) * tension;
    const cp2y = p2.y - (p3.y - p1.y) * tension;
    d += ` C ${cp1x},${cp1y} ${cp2x},${cp2y} ${p2.x},${p2.y}`;
  }
  return d;
}

export default function WasabiOrb({ size = 32 }) {
  const sc = size / VS;

  // Refs for RAF-driven SVG updates
  const blobRef = useRef(null);
  const innerRef = useRef(null);
  const highlightRef = useRef(null);
  const shadowRef = useRef(null);
  const eyeContainerRef = useRef(null);
  const eyeSmoothed = useRef({ x: 0, y: 0 });
  const eyePosRef = useRef({ x: 0, y: 0 });

  const [isBlinking, setIsBlinking] = useState(false);
  const eye_t = useRef(null);
  const blink_t = useRef(null);

  // Stable gradient IDs so multiple orbs don't collide
  const ids = useMemo(() => {
    const id = ++_orbIdCounter;
    return {
      grad: `wOrb_g_${id}`,
      glow: `wOrb_gl_${id}`,
      hl: `wOrb_hl_${id}`,
      inner: `wOrb_in_${id}`,
    };
  }, []);

  // ── Eye wander ───────────────────────────────────────────────────────────
  useEffect(() => {
    const tick = () => {
      eye_t.current = setTimeout(() => {
        const big = Math.random() < 0.3;
        eyePosRef.current = {
          x: (Math.random() - 0.5) * (big ? 5 : 3),
          y: (Math.random() - 0.5) * (big ? 4 : 2.5),
        };
        tick();
      }, 1400 + Math.random() * 2400);
    };
    tick();
    return () => clearTimeout(eye_t.current);
  }, []);

  // ── Blink ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const tick = () => {
      blink_t.current = setTimeout(() => {
        setIsBlinking(true);
        setTimeout(() => {
          setIsBlinking(false);
          if (Math.random() < 0.25) {
            setTimeout(() => {
              setIsBlinking(true);
              setTimeout(() => setIsBlinking(false), 85);
            }, 220);
          }
        }, 100);
        tick();
      }, 2800 + Math.random() * 4500);
    };
    tick();
    return () => clearTimeout(blink_t.current);
  }, []);

  // ── Main animation loop ──────────────────────────────────────────────────
  useEffect(() => {
    let raf;

    // Per-point harmonic parameters for organic motion
    const harmonics = [];
    for (let i = 0; i < N_POINTS; i++) {
      harmonics.push({
        f1: 0.4 + i * 0.07,  p1: i * 1.3 + 0.5,  a1: 3.2 + (i % 3) * 0.8,
        f2: 0.9 + i * 0.11,  p2: i * 2.1 + 1.7,  a2: 1.5 + (i % 2) * 0.6,
        f3: 0.12 + i * 0.025, p3: i * 0.9 + 3.1,  a3: 2.0 + (i % 4) * 0.5,
      });
    }

    const tick = (ts) => {
      if (!blobRef.current) { raf = requestAnimationFrame(tick); return; }
      const t = ts * 0.001;
      const E = 0.15;

      // Floating drift
      const driftX = Math.sin(t * 0.3 + 1.0) * 1.2 + Math.sin(t * 0.7 + 2.5) * 0.6;
      const driftY = Math.cos(t * 0.25 + 0.5) * 1.0 + Math.sin(t * 0.55 + 1.8) * 0.5;
      const cx = CX + driftX;
      const cy = CY + driftY;

      // Rotation drift
      const rot = Math.sin(t * 0.15 + 0.3) * 0.25 + Math.sin(t * 0.4 + 2.0) * 0.1;

      // Deformed radii
      const radii = [];
      const angles = [];
      for (let i = 0; i < N_POINTS; i++) {
        const baseAngle = (i / N_POINTS) * TWO_PI + rot;
        const h = harmonics[i];
        const deform =
          Math.sin(t * h.f1 + h.p1) * h.a1 * E +
          Math.sin(t * h.f2 + h.p2) * h.a2 * E +
          Math.sin(t * h.f3 + h.p3) * h.a3;
        radii.push(BASE_R + deform);
        angles.push(baseAngle);
      }

      const pathD = buildBlobPath(cx, cy, radii, angles);
      blobRef.current.setAttribute("d", pathD);
      if (innerRef.current) innerRef.current.setAttribute("d", pathD);

      if (highlightRef.current) {
        const hlRadii = radii.map(r => r * 0.72);
        highlightRef.current.setAttribute("d", buildBlobPath(cx - 2.5, cy - 3.0, hlRadii, angles));
      }

      if (shadowRef.current) {
        const shRadii = radii.map(r => r * 1.05);
        shadowRef.current.setAttribute("d", buildBlobPath(cx + 0.5, cy + 1.0, shRadii, angles));
      }

      // Eyes follow blob center
      if (eyeContainerRef.current) {
        const es = eyeSmoothed.current;
        const et = eyePosRef.current;
        es.x += (et.x - es.x) * 0.06;
        es.y += (et.y - es.y) * 0.06;
        eyeContainerRef.current.style.transform =
          `translate(${(driftX + es.x) * sc}px, ${(driftY - 1.5 + es.y) * sc}px)`;
      }

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [sc]);

  // ── Eye dimensions ─────────────────────────────────────────────────────
  const eyeSize = Math.max(3, 6.5 * sc);
  const eyeBlinkW = Math.max(4, 8 * sc);
  const eyeBlinkH = Math.max(1, 1.8 * sc);
  const eyeGap = Math.max(2.5, 5.5 * sc);
  const eyeBlinkRad = Math.max(1, 2.5 * sc);

  return (
    <div style={{
      position: "relative",
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      width: size,
      height: size,
    }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${VS} ${VS}`}
        style={{ overflow: "visible", display: "block", flexShrink: 0 }}
      >
        <defs>
          <radialGradient id={ids.grad} cx="38%" cy="35%" r="60%">
            <stop offset="0%" stopColor="#c6f06a" />
            <stop offset="40%" stopColor="#a8e05a" />
            <stop offset="75%" stopColor={C.accent} />
            <stop offset="100%" stopColor="#5a9e2e" />
          </radialGradient>
          <radialGradient id={ids.hl} cx="35%" cy="30%" r="50%">
            <stop offset="0%" stopColor="rgba(255,255,255,0.35)" />
            <stop offset="60%" stopColor="rgba(255,255,255,0.08)" />
            <stop offset="100%" stopColor="rgba(255,255,255,0)" />
          </radialGradient>
          <radialGradient id={ids.glow} cx="50%" cy="50%" r="50%">
            <stop offset="60%" stopColor="rgba(125,193,67,0.15)" />
            <stop offset="100%" stopColor="rgba(125,193,67,0)" />
          </radialGradient>
          <radialGradient id={ids.inner} cx="55%" cy="65%" r="55%">
            <stop offset="0%" stopColor="rgba(0,0,0,0)" />
            <stop offset="80%" stopColor="rgba(0,0,0,0.06)" />
            <stop offset="100%" stopColor="rgba(0,0,0,0.12)" />
          </radialGradient>
        </defs>

        <circle cx={CX} cy={CY} r={BASE_R + 8} fill={`url(#${ids.glow})`} />
        <path ref={shadowRef} fill="rgba(0,0,0,0.10)" style={{ filter: "blur(3px)" }} />
        <path ref={blobRef} fill={`url(#${ids.grad})`} />
        <path ref={innerRef} fill={`url(#${ids.inner})`} style={{ pointerEvents: "none" }} />
        <path ref={highlightRef} fill={`url(#${ids.hl})`} style={{ pointerEvents: "none" }} />
      </svg>

      {/* Eyes */}
      <div
        ref={eyeContainerRef}
        style={{
          position: "absolute",
          pointerEvents: "none",
          display: "flex",
          alignItems: "center",
          gap: eyeGap,
          zIndex: 2,
        }}
      >
        {[0, 1].map((i) => (
          <div
            key={i}
            style={{
              position: "relative",
              width: isBlinking ? eyeBlinkW : eyeSize,
              height: isBlinking ? eyeBlinkH : eyeSize,
              borderRadius: isBlinking ? `${eyeBlinkRad}px` : "50%",
              background: "#1a2e0a",
              boxShadow: isBlinking ? "none" : `0 ${1 * sc}px ${2.5 * sc}px rgba(0,0,0,0.4)`,
              transition: "width 0.07s ease, height 0.07s ease, border-radius 0.07s ease",
              flexShrink: 0,
              overflow: "hidden",
            }}
          >
            {!isBlinking && (
              <div style={{
                position: "absolute", top: "12%", right: "12%",
                width: "35%", height: "35%", borderRadius: "50%",
                background: "rgba(255,255,255,0.85)",
              }} />
            )}
            {!isBlinking && eyeSize > 4 && (
              <div style={{
                position: "absolute", bottom: "18%", left: "18%",
                width: "18%", height: "18%", borderRadius: "50%",
                background: "rgba(255,255,255,0.4)",
              }} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
