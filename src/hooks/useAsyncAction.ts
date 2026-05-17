import { useCallback, useRef, useState } from "react";

export interface AsyncActionState<TArgs extends unknown[], TResult> {
  run: (...args: TArgs) => Promise<TResult | undefined>;
  pending: boolean;
  error: Error | null;
  reset: () => void;
}

/**
 * Wraps an async function so the UI can:
 *   1. Reflect a pending state (`pending` flag), and
 *   2. Refuse re-entry while a call is in flight (a single in-flight ref guards
 *      against double-clicks on Save / Analyze / Delete buttons that would
 *      otherwise fire two concurrent IPC calls).
 *
 * Returns a stable `run` function — safe to pass to onClick without
 * useCallback at the call site. Errors are captured into `error`; if the
 * caller wants to surface them they can read it (typical pattern: combine with
 * setStatus({ kind: "error", message: error.message })).
 */
export function useAsyncAction<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
): AsyncActionState<TArgs, TResult> {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const inflight = useRef(false);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const run = useCallback(async (...args: TArgs): Promise<TResult | undefined> => {
    if (inflight.current) return undefined;
    inflight.current = true;
    setPending(true);
    setError(null);
    try {
      return await fnRef.current(...args);
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      setError(err);
      throw err;
    } finally {
      inflight.current = false;
      setPending(false);
    }
  }, []);

  const reset = useCallback(() => setError(null), []);

  return { run, pending, error, reset };
}
