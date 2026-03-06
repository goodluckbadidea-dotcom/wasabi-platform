// ─── WasabiFlame ─────────────────────────────────────────────────────────────
// Animated green flame character — the Wasabi platform mascot.
// Ported from production-pm-agent.jsx (lines 11222–11531, 11636–11664).
//
// Props:
//   size        — SVG canvas size in px (default 80)
//   isThinking  — boolean, spikes energy to 0.75+
//   energy      — optional 0–1 override for flame energy
// ─────────────────────────────────────────────────────────────────────────────

import React, { useRef, useEffect, useState, useMemo } from "react";
import { C } from "../design/tokens.js";

// ── Unique gradient ID factory (avoids collisions when multiple flames mount) ─
let _flameIdCounter = 0;

export default function WasabiFlame({ size = 80, isThinking = false, energy: energyOverride }) {
  const S = size;
  const H = S / 2;

  // ── Refs for direct DOM manipulation (no React re-renders in RAF loop) ─────
  const svgRef          = useRef(null);
  const pathRef         = useRef(null);
  const eyeContainerRef = useRef(null);
  const eyePosRef       = useRef({ x: 0, y: 0 });   // wander target
  const eyeSmoothed     = useRef({ x: 0, y: 0 });   // lerped toward target
  const mouthRef        = useRef(null);
  const mouthSmoothed   = useRef({ x: 0, y: 0, open: 0 });
  const tongue0Ref      = useRef(null);
  const tongue1Ref      = useRef(null);
  const tongue2Ref      = useRef(null);
  const tongueState     = useRef([
    { active: false, x: 0, y: 0, vx: 0, vy: 0, r: 2, op: 0, age: 0, maxAge: 52 },
    { active: false, x: 0, y: 0, vx: 0, vy: 0, r: 2, op: 0, age: 0, maxAge: 52 },
    { active: false, x: 0, y: 0, vx: 0, vy: 0, r: 2, op: 0, age: 0, maxAge: 52 },
  ]);
  const nextSpawn   = useRef([0, 0, 0]);
  const flameEnergy = useRef(0);

  // ── Eye state (React-driven for blink / wander CSS transitions) ────────────
  const [eyePos, setEyePos]       = useState({ x: 0, y: 0 });
  const [isBlinking, setIsBlinking] = useState(false);
  const eye_t   = useRef(null);
  const blink_t = useRef(null);

  // ── Stable gradient ID ─────────────────────────────────────────────────────
  const gradId = useMemo(() => `wasabiFlameGrad_${++_flameIdCounter}`, []);

  // ── Eye wander ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const tick = () => {
      eye_t.current = setTimeout(() => {
        const big = Math.random() < 0.35;
        const ex = (Math.random() - 0.5) * (big ? 11 : 6);
        const ey = (Math.random() - 0.5) * (big ? 8 : 4.5);
        eyePosRef.current = { x: ex, y: ey };
        setEyePos({ x: ex, y: ey });
        tick();
      }, 1200 + Math.random() * 2200);
    };
    tick();
    return () => clearTimeout(eye_t.current);
  }, []);

  // ── Blink (occasional double-blink) ────────────────────────────────────────
  useEffect(() => {
    const tick = () => {
      blink_t.current = setTimeout(() => {
        setIsBlinking(true);
        setTimeout(() => {
          setIsBlinking(false);
          if (Math.random() < 0.28) {
            setTimeout(() => {
              setIsBlinking(true);
              setTimeout(() => setIsBlinking(false), 90);
            }, 230);
          }
        }, 105);
        tick();
      }, 2500 + Math.random() * 4200);
    };
    tick();
    return () => clearTimeout(blink_t.current);
  }, []);

  // ── Main animation loop ────────────────────────────────────────────────────
  useEffect(() => {
    let raf;

    // ── Organic multi-peak flame path ──────────────────────────────────────
    // peaks: [{x, y, lean}]  lean in (-1,+1) — negative = leans left
    // Asymmetric bezier handles make each peak tilt like a real flame tongue.
    const buildFlamePath = (peaks, by, flatW, cp) => {
      const lx = peaks[0].x - flatW;
      const rx = peaks[peaks.length - 1].x + flatW;
      const n  = peaks.length;

      const handles = p => {
        const ht   = p.y;
        const base = 3.5 + (by - ht) * 0.10;
        const L    = p.lean || 0;
        return {
          lh: Math.max(1.5, base * (1 - L * 0.55)),
          rh: Math.max(1.5, base * (1 + L * 0.55)),
        };
      };

      const valleyY = (a, b) => {
        const deeper = Math.max(a.y, b.y);
        return deeper + 5 + Math.abs(b.y - a.y) * 0.10;
      };

      let d = 'M ' + lx + ',' + by + ' L ' + rx + ',' + by;

      // Right base corner -> rightmost peak
      const pr   = peaks[n - 1];
      const hr   = handles(pr);
      const vy_r = valleyY(pr, peaks[n - 2] || pr);
      d += ' C ' + (rx + cp) + ',' + by
         + ' ' + (pr.x + hr.rh) + ',' + vy_r
         + ' ' + pr.x + ',' + pr.y;

      // Traverse peaks right -> left through valleys
      for (let i = n - 2; i >= 0; i--) {
        const cur = peaks[i];
        const prv = peaks[i + 1];
        const hc  = handles(cur);
        const hp  = handles(prv);
        const vy  = valleyY(prv, cur);
        d += ' C ' + (prv.x - hp.lh) + ',' + vy
           + ' ' + (cur.x + hc.rh) + ',' + vy
           + ' ' + cur.x + ',' + cur.y;
      }

      // Leftmost peak -> left base corner
      const pl   = peaks[0];
      const hl   = handles(pl);
      const vy_l = valleyY(pl, peaks[1] || pl);
      d += ' C ' + (pl.x - hl.lh) + ',' + vy_l
         + ' ' + (lx - cp) + ',' + by
         + ' ' + lx + ',' + by + ' Z';

      return d;
    };

    // ── Raindrop lick path: fat round top, tip pointing DOWN ───────────────
    const dropPath = (cx, cy, r) => {
      const tipY = cy + r * 1.55;
      return (
        'M ' + cx + ',' + tipY + ' ' +
        'C ' + (cx + r * 0.85) + ',' + (cy + r * 0.95) + ' ' +
               (cx + r)        + ',' + (cy + r * 0.4)  + ' ' +
               (cx + r)        + ',' + cy + ' ' +
        'A ' + r + ',' + r + ' 0 0,0 ' + (cx - r) + ',' + cy + ' ' +
        'C ' + (cx - r)        + ',' + (cy + r * 0.4)  + ' ' +
               (cx - r * 0.85) + ',' + (cy + r * 0.95) + ' ' +
               cx + ',' + tipY + ' Z'
      );
    };

    const tick = ts => {
      if (!pathRef.current) { raf = requestAnimationFrame(tick); return; }
      const t = ts * 0.001;
      const n = (f, p, a) => Math.sin(t * f + p) * a;

      // ── Energy ───────────────────────────────────────────────────────────
      const baseEnergy = 0.15;
      if (energyOverride !== undefined) {
        flameEnergy.current = Math.max(0, Math.min(1, energyOverride));
      } else {
        if (isThinking) flameEnergy.current = Math.max(flameEnergy.current, 0.75);
        flameEnergy.current = Math.max(0, flameEnergy.current - 0.004);
      }
      const E = baseEnergy + flameEnergy.current; // 0.15 - 1.15

      // ── Leader peak (dominant, centre-ish) ─────────────────────────────
      const leaderSway  = n(0.9, 0.0, 3.5 + E * 4) + n(2.3, 1.2, 1.8 + E * 2);
      const leaderFlick = n(1.4, 0.7, 3.0 + E * 5) + n(3.5, 2.1, 1.2 + E * 2);
      const leaderX = H + leaderSway;
      const leaderY = 6 + Math.max(0, 8 - E * 10) + leaderFlick;
      const leaderLean = leaderSway / (3.5 + E * 4 + 1.8 + E * 2 + 0.01) * 0.6;

      // ── Right follower ─────────────────────────────────────────────────
      const rightX    = H + 12 + leaderSway * 0.4 + n(1.8, 0.5, 2.2 + E * 1.5);
      const rightY    = leaderY + 5 + n(2.1, 1.8, 3.5 + E * 4) + n(3.8, 0.9, 1.5);
      const rightLean = 0.3 + n(1.5, 0.8, 0.25);

      // ── Left follower — organically merges in/out (~38s period) ────────
      const mergeRaw = 0.5 + 0.5 * Math.sin(t * 0.165 + 2.1);
      const mergeW   = Math.max(0, Math.min(1, (mergeRaw - 0.15) / 0.55));
      const leftXFull    = H - 11 + leaderSway * 0.3 + n(1.5, 2.4, 1.8 + E * 1.2);
      const leftYFull    = leaderY + 7 + n(1.7, 3.1, 4.0 + E * 4.5) + n(4.2, 1.3, 1.2);
      const leftLeanFull = -0.35 + n(1.2, 1.9, 0.2);
      // Lerp toward leader when mergeW is low
      const leftX    = leftXFull  * mergeW + leaderX * (1 - mergeW);
      const leftY    = leftYFull  * mergeW + leaderY * (1 - mergeW);
      const leftLean = leftLeanFull * mergeW;

      const rawPeaks = [
        { x: leftX,   y: leftY,   lean: leftLean   },
        { x: leaderX, y: leaderY, lean: leaderLean },
        { x: rightX,  y: rightY,  lean: rightLean  },
      ];

      // Clamp within viewport
      const peaks = rawPeaks.map(p => ({
        x:    Math.max(4, Math.min(S - 4, p.x)),
        y:    Math.max(2, Math.min(H,     p.y)),
        lean: p.lean,
      }));

      const baseY = S - 2, flatW = 5, cp = 8;
      pathRef.current.setAttribute('d', buildFlamePath(peaks, baseY, flatW, cp));

      // ── Eyes follow leader — lerp wander toward target for smooth glide ──
      if (eyeContainerRef.current) {
        const eyeBodyY = leaderY + (baseY - leaderY) * 0.72 - H;
        const eyeBodyX = leaderX - H;
        const lerpK = 0.055;
        const es = eyeSmoothed.current;
        const et = eyePosRef.current;
        es.x += (et.x - es.x) * lerpK;
        es.y += (et.y - es.y) * lerpK;
        eyeContainerRef.current.style.transform =
          'translate(' + (eyeBodyX + es.x) + 'px, ' + (eyeBodyY + es.y) + 'px)';
      }

      // ── Expressive mouth — lazily follows eyes, morphs smile <-> O ────
      if (mouthRef.current) {
        const eyeBodyY = leaderY + (baseY - leaderY) * 0.72 - H;
        const eyeBodyX = leaderX - H;
        const mouthTargetX = eyeBodyX;
        const mouthTargetY = eyeBodyY + 7.5;

        const eyeDistFromBase = baseY - (leaderY + (baseY - leaderY) * 0.72);
        const maxDist = S * 0.55;
        const rawOpen = Math.max(0, Math.min(1, eyeDistFromBase / maxDist));
        const openTarget = Math.min(1, rawOpen + E * 0.15);

        const ms = mouthSmoothed.current;
        const mLerpK = 0.035;
        ms.x    += (mouthTargetX - ms.x) * mLerpK;
        ms.y    += (mouthTargetY - ms.y) * mLerpK;
        ms.open += (openTarget - ms.open) * mLerpK;

        const mOpen = ms.open;
        const mw = 2.2 + mOpen * 1.8;
        const mh = 0.4 + mOpen * 3.2;
        const smileCurve = Math.max(0, (1 - mOpen * 1.8)) * 1.5;
        const breathe = Math.sin(t * 1.8 + 0.5) * 0.15 * (1 + E);

        const mx = H + ms.x;
        const my = H + ms.y + breathe;

        if (mOpen < 0.12) {
          // Smile line
          const sw = mw * 0.9;
          mouthRef.current.setAttribute('d',
            'M ' + (mx - sw) + ',' + my +
            ' Q ' + mx + ',' + (my + smileCurve + 0.8) +
            ' ' + (mx + sw) + ',' + my
          );
          mouthRef.current.setAttribute('fill', 'none');
          mouthRef.current.setAttribute('stroke', '#0d1f06');
          mouthRef.current.setAttribute('stroke-width', '0.7');
          mouthRef.current.setAttribute('stroke-linecap', 'round');
          mouthRef.current.setAttribute('opacity', '0.6');
        } else {
          // Open mouth ellipse
          const rx = mw * 0.5;
          const ry = mh * 0.5;
          mouthRef.current.setAttribute('d',
            'M ' + (mx - rx) + ',' + my +
            ' A ' + rx + ',' + ry + ' 0 1,0 ' + (mx + rx) + ',' + my +
            ' A ' + rx + ',' + ry + ' 0 1,0 ' + (mx - rx) + ',' + my + ' Z'
          );
          mouthRef.current.setAttribute('fill', '#0d1f06');
          mouthRef.current.setAttribute('stroke', 'none');
          mouthRef.current.setAttribute('stroke-width', '0');
          mouthRef.current.setAttribute('opacity', String(0.35 + mOpen * 0.4));
        }
      }

      // ── Per-peak raindrop lick particles ─────────────────────────────────
      const tRefs  = [tongue0Ref.current, tongue1Ref.current, tongue2Ref.current];
      const parts  = tongueState.current;
      const spawns = nextSpawn.current;
      const spawnBase = 700 - E * 200;

      peaks.forEach((pk, pi) => {
        const part = parts[pi];
        const el   = tRefs[pi];
        if (!el) return;

        if (!part.active && ts > spawns[pi]) {
          part.active = true;
          part.x      = pk.x + (Math.random() - 0.5) * 3;
          part.y      = pk.y;
          part.vx     = (Math.random() - 0.5) * 0.45;
          part.vy     = 0.85 + Math.random() * 0.65 + E * 0.35;
          part.r      = 1.6 + Math.random() * 2.2 + E * 0.5;
          part.op     = 0.70 + Math.random() * 0.20;
          part.age    = 0;
          part.maxAge = 40 + Math.floor(Math.random() * 30);
          spawns[pi]  = ts + spawnBase + Math.random() * 500;
        }

        if (!part.active) { el.setAttribute('opacity', '0'); return; }
        part.age++;
        part.x  += part.vx;
        part.y  -= part.vy;   // rises upward
        part.vy *= 0.983;
        part.r  *= 0.977;     // shrinks
        part.op  = part.op * (1 - part.age / (part.maxAge * 2.6));
        if (part.age >= part.maxAge || part.r < 0.3 || part.op < 0.03) {
          part.active = false; el.setAttribute('opacity', '0'); return;
        }
        el.setAttribute('d',       dropPath(part.x, part.y, part.r));
        el.setAttribute('opacity', String(Math.max(0, part.op)));
      });

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [S, H, isThinking, energyOverride]);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
      {/* SVG flame body */}
      <svg
        ref={svgRef}
        width={S}
        height={S}
        viewBox={`0 0 ${S} ${S}`}
        style={{ overflow: 'visible', display: 'block', flexShrink: 0 }}
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="1" x2="0" y2="0" gradientUnits="objectBoundingBox">
            <stop offset="0%"   stopColor="#a8e05a" />
            <stop offset="100%" stopColor={C.accent} />
          </linearGradient>
        </defs>

        {/* Flame silhouette */}
        <path ref={pathRef} fill={`url(#${gradId})`} />

        {/* Tongue particles (one per peak) */}
        <path ref={tongue0Ref} fill="#9dd84a" opacity="0" style={{ pointerEvents: 'none' }} />
        <path ref={tongue1Ref} fill="#9dd84a" opacity="0" style={{ pointerEvents: 'none' }} />
        <path ref={tongue2Ref} fill="#9dd84a" opacity="0" style={{ pointerEvents: 'none' }} />

        {/* Expressive mouth */}
        <path ref={mouthRef} fill="none" opacity="0" style={{ pointerEvents: 'none' }} />
      </svg>

      {/* Eyes — positioned absolutely over the SVG, driven by RAF */}
      <div
        ref={eyeContainerRef}
        style={{
          position: 'absolute',
          pointerEvents: 'none',
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          zIndex: 2,
        }}
      >
        {[0, 1].map(i => (
          <div
            key={i}
            style={{
              position: 'relative',
              width:  isBlinking ? 7 : 5.5,
              height: isBlinking ? 2 : 5.5,
              borderRadius: isBlinking ? '2px' : '50%',
              background: '#0d1f06',
              boxShadow: '0 1.5px 3px rgba(0,0,0,0.45), 0 0.5px 1px rgba(0,0,0,0.3)',
              transition: 'width 0.07s ease, height 0.07s ease, border-radius 0.07s ease',
              flexShrink: 0,
              overflow: 'hidden',
            }}
          >
            {!isBlinking && (
              <div
                style={{
                  position: 'absolute',
                  top: '14%',
                  right: '14%',
                  width: '32%',
                  height: '32%',
                  borderRadius: '50%',
                  background: 'rgba(255,255,255,0.82)',
                  pointerEvents: 'none',
                }}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
