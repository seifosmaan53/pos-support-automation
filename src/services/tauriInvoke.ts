import { invoke as tauriInvoke } from "@tauri-apps/api/core";

export type InvokeFailureKind = "timeout" | "not-in-tauri" | "command";

export class InvokeError extends Error {
  constructor(public kind: InvokeFailureKind, public command: string, message: string) {
    super(message);
    this.name = "InvokeError";
  }
}

function isTauriContext(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export interface InvokeWithTimeoutOptions {
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

export async function invokeWithTimeout<T>(
  command: string,
  args?: Record<string, unknown>,
  opts: InvokeWithTimeoutOptions = {},
): Promise<T> {
  if (!isTauriContext()) {
    throw new InvokeError(
      "not-in-tauri",
      command,
      `Cannot run "${command}" in browser preview. Open the desktop app.`,
    );
  }
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let timer: number | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = window.setTimeout(() => {
      reject(
        new InvokeError(
          "timeout",
          command,
          `"${command}" did not respond after ${Math.round(timeoutMs / 1000)}s. The backend may be hung.`,
        ),
      );
    }, timeoutMs);
  });
  try {
    return await Promise.race([tauriInvoke<T>(command, args), timeoutPromise]);
  } catch (e) {
    if (e instanceof InvokeError) throw e;
    throw new InvokeError(
      "command",
      command,
      e instanceof Error ? e.message : String(e),
    );
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
