import React, { useState, useRef, useEffect } from "react";
import { C, FONT, MONO, RADIUS } from "../../design/tokens.js";
import { ANIM } from "../../design/animations.js";
import { usePlatform } from "../../context/PlatformContext.jsx";
import { getSessionUsage, getUsageHistory, formatCost, formatTokens, getTierBreakdown, getAggregateUsage } from "../../utils/costTracker.js";
import * as api from "../../lib/api.js";
import { checkHealth } from "../../lib/api.js";
import StatCard from "./components/StatCard.jsx";
import IdRow from "./components/IdRow.jsx";

export default function OverviewTab() {
  const { user, platformIds, pages, identity } = usePlatform();

  // ── Overview stats ──
  const [stats, setStats] = useState({ pages: 0, kb: null, rules: null });
  const [statsLoading, setStatsLoading] = useState(true);
  const statsFetched = useRef(false);

  // ── Cost tracking ──
  const [costData, setCostData] = useState(null);
  const [tierData, setTierData] = useState(null);
  const [aggData, setAggData] = useState(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  // Load cost data
  useEffect(() => {
    setCostData(getSessionUsage());
    setTierData(getTierBreakdown());
    setAggData(getAggregateUsage());
  }, []);

  // Load stats
  useEffect(() => {
    if (statsFetched.current) return;
    statsFetched.current = true;

    const fetchStats = async () => {
      setStatsLoading(true);
      try {
        const [kbResult, rulesResult] = await Promise.all([
          api.listKB().catch(() => ({ entries: [] })),
          api.listRules().catch(() => ({ rules: [] })),
        ]);

        const kbCount = (kbResult.entries || []).length;
        const rulesCount = (rulesResult.rules || []).length;
        setStats({ pages: pages.length, kb: kbCount, rules: rulesCount });
      } catch (err) {
        console.warn("Failed to fetch system stats:", err);
        setStats({ pages: pages.length, kb: 0, rules: 0 });
      } finally {
        setStatsLoading(false);
      }
    };

    fetchStats();
  }, [pages.length]);

  // Update page count when pages change
  useEffect(() => {
    setStats((prev) => ({ ...prev, pages: pages.length }));
  }, [pages.length]);

  return (
    <div style={{ padding: "24px 32px" }}>
      {/* Platform status */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 20,
        }}
      >
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: C.accent,
            flexShrink: 0,
          }}
        />
        <span
          style={{
            fontSize: 13,
            color: C.darkText,
            fontFamily: FONT,
            fontWeight: 500,
          }}
        >
          Connected
        </span>
      </div>

      {/* Platform DB IDs */}
      <div
        style={{
          background: C.darkSurf,
          border: `1px solid ${C.darkBorder}`,
          borderRadius: RADIUS.lg,
          padding: "12px 14px",
          marginBottom: 20,
        }}
      >
        <div
          style={{
            fontSize: 10,
            color: C.darkMuted,
            fontFamily: FONT,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            marginBottom: 8,
          }}
        >
          Platform Database IDs
        </div>
        <IdRow label="root" id={platformIds?.rootPageId} />
        <IdRow label="KB" id={platformIds?.kbDbId} />
        <IdRow label="config" id={platformIds?.configDbId} />
        <IdRow label="notif" id={platformIds?.notifDbId} />
        <IdRow label="rules" id={platformIds?.rulesDbId} />
      </div>

      {/* Stats row */}
      <div
        style={{
          display: "flex",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <StatCard
          label="Pages"
          value={stats.pages}
          loading={false}
        />
        <StatCard
          label="KB Entries"
          value={stats.kb ?? 0}
          loading={statsLoading}
        />
        <StatCard
          label="Automation Rules"
          value={stats.rules ?? 0}
          loading={statsLoading}
        />
      </div>

      {/* ── Session Usage (Cost Tracking) ── */}
      {(() => {
        // Show aggregate data when current session has no calls
        const hasCurrentSession = costData && costData.callCount > 0;
        const displayData = hasCurrentSession ? costData : (aggData && aggData.callCount > 0 ? aggData : costData);
        const displayTier = hasCurrentSession ? tierData : (aggData && aggData.callCount > 0 ? aggData : tierData);
        const usageLabel = hasCurrentSession ? "Session Usage" : (aggData && aggData.callCount > 0 ? `Usage (${aggData.sessionCount} session${aggData.sessionCount !== 1 ? "s" : ""})` : "Session Usage");

        return (
          <div style={{ marginTop: 24 }}>
            <div
              style={{
                fontSize: 10,
                color: C.darkMuted,
                fontFamily: FONT,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                marginBottom: 12,
              }}
            >
              {usageLabel}
            </div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <StatCard
                label="API Calls"
                value={displayData ? displayData.callCount : 0}
                loading={!displayData}
              />
              <StatCard
                label="Input Tokens"
                value={displayData ? formatTokens(displayData.inputTokens) : "0"}
                loading={!displayData}
              />
              <StatCard
                label="Output Tokens"
                value={displayData ? formatTokens(displayData.outputTokens) : "0"}
                loading={!displayData}
              />
              <StatCard
                label="Est. Cost"
                value={displayData ? formatCost(displayData.estimatedCost) : "$0"}
                loading={!displayData}
              />
            </div>

            {/* ── AI Routing Breakdown ── */}
            {displayTier && (displayTier.haikuCalls > 0 || displayTier.sonnetCalls > 0 || displayTier.cacheHits > 0) && (() => {
              const totalCalls = (displayTier.haikuCalls || 0) + (displayTier.sonnetCalls || 0) + (displayTier.cacheHits || 0);
              const allSonnetCost = (displayTier.haikuCost || 0) + (displayTier.sonnetCost || 0) + (displayTier.savedCost || 0);
              const actualCost = (displayTier.haikuCost || 0) + (displayTier.sonnetCost || 0);
              const maxBarCost = Math.max(allSonnetCost, actualCost, 0.001);

              return (
                <div style={{ marginTop: 16 }}>
                  <div style={{
                    fontSize: 10, color: C.darkMuted, fontFamily: FONT,
                    textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10,
                  }}>
                    AI Routing Breakdown
                  </div>
                  <div style={{
                    background: C.darkSurf,
                    border: `1px solid ${C.darkBorder}`,
                    borderRadius: RADIUS.lg,
                    padding: "14px 16px",
                  }}>
                    {/* Tier rows */}
                    {[
                      { label: "Cache Hits", count: displayTier.cacheHits || 0, color: C.accent, cost: "$0.00" },
                      { label: "Haiku", count: displayTier.haikuCalls || 0, color: C.accent, cost: formatCost(displayTier.haikuCost || 0) },
                      { label: "Sonnet", count: displayTier.sonnetCalls || 0, color: C.error, cost: formatCost(displayTier.sonnetCost || 0) },
                    ].map((row) => (
                      <div key={row.label} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                        <span style={{ width: 8, height: 8, borderRadius: "50%", background: row.color, flexShrink: 0 }} />
                        <span style={{ fontSize: 11, color: C.darkText, fontFamily: FONT, minWidth: 80 }}>{row.label}</span>
                        <span style={{ fontSize: 11, color: C.darkMuted, fontFamily: MONO, minWidth: 30, textAlign: "right" }}>{row.count}</span>
                        <div style={{ flex: 1, height: 4, background: C.darkSurf2, borderRadius: 2, overflow: "hidden" }}>
                          <div style={{
                            height: "100%",
                            width: `${Math.min(100, (row.count / (totalCalls || 1)) * 100)}%`,
                            background: row.color,
                            borderRadius: 2,
                            transition: "width 0.3s",
                          }} />
                        </div>
                        <span style={{ fontSize: 10, color: C.darkMuted, fontFamily: MONO, minWidth: 50, textAlign: "right" }}>{row.cost}</span>
                      </div>
                    ))}

                    {/* ── Savings comparison bar chart ── */}
                    {(displayTier.savedCost || 0) > 0 && (
                      <div style={{
                        marginTop: 14, paddingTop: 14, borderTop: `1px solid ${C.darkBorder}`,
                      }}>
                        <div style={{ fontSize: 10, color: C.darkMuted, fontFamily: FONT, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>
                          Cost Savings from Haiku Routing
                        </div>
                        {/* All-Sonnet bar (what it would have cost) */}
                        <div style={{ marginBottom: 6 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                            <span style={{ fontSize: 10, color: C.darkMuted, fontFamily: FONT }}>If all Sonnet</span>
                            <span style={{ fontSize: 10, color: C.error, fontFamily: MONO }}>{formatCost(allSonnetCost)}</span>
                          </div>
                          <div style={{ height: 14, background: C.darkSurf2, borderRadius: 3, overflow: "hidden" }}>
                            <div style={{
                              height: "100%",
                              width: `${(allSonnetCost / maxBarCost) * 100}%`,
                              background: "linear-gradient(90deg, #E05252, #E0525288)",
                              borderRadius: 3,
                            }} />
                          </div>
                        </div>
                        {/* Actual cost bar (with Haiku routing) */}
                        <div style={{ marginBottom: 8 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                            <span style={{ fontSize: 10, color: C.darkMuted, fontFamily: FONT }}>With routing</span>
                            <span style={{ fontSize: 10, color: C.accent, fontFamily: MONO }}>{formatCost(actualCost)}</span>
                          </div>
                          <div style={{ height: 14, background: C.darkSurf2, borderRadius: 3, overflow: "hidden" }}>
                            <div style={{
                              height: "100%",
                              width: `${(actualCost / maxBarCost) * 100}%`,
                              background: `linear-gradient(90deg, ${C.accent}, ${C.accent}88)`,
                              borderRadius: 3,
                            }} />
                          </div>
                        </div>
                        {/* Savings summary */}
                        <div style={{
                          display: "flex", justifyContent: "space-between", alignItems: "center",
                          marginTop: 6,
                        }}>
                          <span style={{ fontSize: 11, color: C.accent, fontFamily: FONT, fontWeight: 600 }}>
                            Saved
                          </span>
                          <span style={{ fontSize: 14, fontWeight: 700, color: C.accent, fontFamily: MONO }}>
                            {formatCost(displayTier.savedCost)} ({((displayTier.savedCost / allSonnetCost) * 100).toFixed(0)}%)
                          </span>
                        </div>
                      </div>
                    )}

                    {(displayTier.cacheHits || 0) > 0 && (
                      <div style={{
                        marginTop: 10, paddingTop: 10, borderTop: `1px solid ${C.darkBorder}`,
                        display: "flex", justifyContent: "space-between", alignItems: "center",
                      }}>
                        <span style={{ fontSize: 11, color: C.darkMuted, fontFamily: FONT }}>Cache Hit Rate</span>
                        <span style={{ fontSize: 11, color: C.darkMuted, fontFamily: MONO }}>{displayTier.cacheHitRate}%</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}

            {/* Session History (collapsible) */}
            <div style={{ marginTop: 14 }}>
              <button
                onClick={() => setHistoryOpen((o) => !o)}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  fontFamily: FONT,
                  fontSize: 11,
                  color: C.darkMuted,
                  padding: "4px 0",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <svg
                  width="8"
                  height="5"
                  viewBox="0 0 8 5"
                  fill="none"
                  style={{
                    transition: "transform 0.15s",
                    transform: historyOpen ? "rotate(180deg)" : "rotate(0deg)",
                  }}
                >
                  <path d="M0.5 0.5L4 4.5L7.5 0.5" stroke={C.darkMuted} strokeWidth="1.2" strokeLinecap="round" />
                </svg>
                Session History
              </button>

              {historyOpen && (() => {
                const history = getUsageHistory().sort((a, b) =>
                  (b.startedAt || "").localeCompare(a.startedAt || "")
                ).slice(0, 5);

                if (history.length === 0) {
                  return (
                    <div style={{ fontSize: 11, color: C.darkMuted, padding: "8px 0", opacity: 0.6 }}>
                      No session history yet.
                    </div>
                  );
                }

                return (
                  <div
                    style={{
                      marginTop: 8,
                      background: C.darkSurf,
                      border: `1px solid ${C.darkBorder}`,
                      borderRadius: RADIUS.lg,
                      overflow: "hidden",
                    }}
                  >
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <thead>
                        <tr>
                          {["Started", "Calls", "Tokens In", "Tokens Out", "Cost"].map((h) => (
                            <th
                              key={h}
                              style={{
                                textAlign: "left",
                                padding: "6px 10px",
                                fontSize: 9,
                                fontWeight: 600,
                                textTransform: "uppercase",
                                letterSpacing: "0.06em",
                                color: C.darkMuted,
                                borderBottom: `1px solid ${C.darkBorder}`,
                                fontFamily: FONT,
                              }}
                            >
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {history.map((s, i) => (
                          <tr key={s.sessionId || i}>
                            <td style={{ padding: "5px 10px", fontSize: 11, fontFamily: MONO, color: C.darkText, borderBottom: `1px solid ${C.edgeLine}` }}>
                              {s.startedAt ? new Date(s.startedAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "--"}
                            </td>
                            <td style={{ padding: "5px 10px", fontSize: 11, fontFamily: MONO, color: C.darkText, borderBottom: `1px solid ${C.edgeLine}` }}>
                              {s.callCount}
                            </td>
                            <td style={{ padding: "5px 10px", fontSize: 11, fontFamily: MONO, color: C.darkText, borderBottom: `1px solid ${C.edgeLine}` }}>
                              {formatTokens(s.inputTokens)}
                            </td>
                            <td style={{ padding: "5px 10px", fontSize: 11, fontFamily: MONO, color: C.darkText, borderBottom: `1px solid ${C.edgeLine}` }}>
                              {formatTokens(s.outputTokens)}
                            </td>
                            <td style={{ padding: "5px 10px", fontSize: 11, fontFamily: MONO, color: C.darkText, borderBottom: `1px solid ${C.edgeLine}` }}>
                              {formatCost(s.estimatedCost)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              })()}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
