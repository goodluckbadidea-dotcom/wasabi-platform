// ─── useZenInsight Hook ───
// Lightweight hook that reads the AI-generated workspace insight from cache.
// The insight is produced by useAICuratedTasks and stored in localStorage.
// This hook allows components (like the sidebar) to display it without
// importing the full task curation logic.

import { useState, useEffect } from "react";
import { getCached } from "./taskHelpers.js";

const INSIGHT_CACHE_KEY = "wasabi_insight";
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours — stale insight > no insight
const POLL_INTERVAL = 5000; // check for new insight every 5s

export default function useInsight() {
  const [insight, setInsight] = useState(() => getCached(INSIGHT_CACHE_KEY, CACHE_TTL));

  // Poll localStorage for updates (written by useAICuratedTasks)
  useEffect(() => {
    const check = () => {
      const cached = getCached(INSIGHT_CACHE_KEY, CACHE_TTL);
      setInsight((prev) => cached !== prev ? cached : prev);
    };
    const id = setInterval(check, POLL_INTERVAL);
    return () => clearInterval(id);
  }, []);

  return insight;
}
