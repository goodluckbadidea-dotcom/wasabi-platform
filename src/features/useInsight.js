// ─── useInsight Hook ───
// Lightweight hook that reads the AI-generated workspace insight from cache.
// The insight is produced by useAICuratedTasks and stored in localStorage.
// This hook allows components (like the sidebar) to display it without
// importing the full task curation logic.

import { useState, useEffect } from "react";
import { getCached } from "./taskHelpers.js";

const INSIGHT_CACHE_KEY = "wasabi_insight";
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days — insight persists across sessions
const POLL_INTERVAL = 5000; // check for new insight every 5s
const FALLBACK_DELAY = 10000; // show fallback after 10s if no insight

export default function useInsight(userId) {
  const cacheKey = userId ? `${INSIGHT_CACHE_KEY}_${userId}` : INSIGHT_CACHE_KEY;
  const [insight, setInsight] = useState(() => getCached(cacheKey, CACHE_TTL));
  const [fallback, setFallback] = useState(null);

  // Poll localStorage for updates (written by useAICuratedTasks)
  useEffect(() => {
    const check = () => {
      const cached = getCached(cacheKey, CACHE_TTL);
      if (cached) setFallback(null); // clear fallback once real insight arrives
      setInsight((prev) => cached !== prev ? cached : prev);
    };
    const id = setInterval(check, POLL_INTERVAL);
    return () => clearInterval(id);
  }, [cacheKey]);

  // Show fallback message if no insight after 10 seconds
  useEffect(() => {
    if (insight) return;
    const timer = setTimeout(() => {
      setFallback("Visit Tasks to generate your workspace insight");
    }, FALLBACK_DELAY);
    return () => clearTimeout(timer);
  }, [insight]);

  return insight || fallback;
}
