import { useEffect, useState } from "react";

/**
 * Ticking Date.now() for duration displays ("for 3m 48s"). Runs one interval
 * only while active — idle transcripts pay no timer.
 */
export function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}
