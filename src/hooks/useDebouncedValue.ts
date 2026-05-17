import { useEffect, useState } from "react";

/**
 * Returns a value that updates after `delayMs` of no further changes.
 * Used by Live Assist to throttle re-analysis while the user is actively
 * typing/pasting/streaming a transcript — running rule-based extraction on
 * every keystroke is cheap, but rendering the full panel on every keystroke
 * causes layout thrash. 250ms is short enough that users perceive it as
 * "live" but long enough to coalesce a paste-burst into a single update.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}
