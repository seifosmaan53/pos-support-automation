export interface OllamaGenerateOptions {
  endpoint: string;
  model: string;
  system: string;
  prompt: string;
  temperature: number;
  format?: "json";
  timeoutMs: number;
  signal?: AbortSignal;
}

interface OllamaGenerateResponse {
  response?: string;
  done?: boolean;
  error?: string;
}

interface OllamaTagsResponse {
  models?: Array<{ name?: string }>;
}

export interface PingResult {
  ok: boolean;
  models: string[];
  error?: string;
  ms: number;
}

function isTauriContext(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function trimEndpoint(endpoint: string): string {
  return endpoint.replace(/\/+$/, "");
}

async function tauriRequest(
  url: string,
  init: RequestInit,
): Promise<{ ok: boolean; status: number; text: () => Promise<string>; json: () => Promise<unknown> }> {
  const mod = await import("@tauri-apps/plugin-http");
  const r = await mod.fetch(url, init);
  return {
    ok: r.ok,
    status: r.status,
    text: () => r.text(),
    json: () => r.json(),
  };
}

async function browserRequest(
  url: string,
  init: RequestInit,
): Promise<{ ok: boolean; status: number; text: () => Promise<string>; json: () => Promise<unknown> }> {
  const r = await fetch(url, init);
  return {
    ok: r.ok,
    status: r.status,
    text: () => r.text(),
    json: () => r.json(),
  };
}

async function request(url: string, init: RequestInit): Promise<unknown> {
  const r = isTauriContext() ? await tauriRequest(url, init) : await browserRequest(url, init);
  if (!r.ok) {
    let detail = "";
    try {
      detail = await r.text();
    } catch {}
    throw new Error(`Ollama HTTP ${r.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`);
  }
  return await r.json();
}

export async function generateText(opts: OllamaGenerateOptions): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  const signal = mergeSignals(opts.signal, controller.signal);
  try {
    const body = {
      model: opts.model,
      prompt: opts.prompt,
      system: opts.system,
      stream: false,
      options: { temperature: opts.temperature },
      ...(opts.format ? { format: opts.format } : {}),
    };
    const json = (await request(`${trimEndpoint(opts.endpoint)}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    })) as OllamaGenerateResponse;
    if (json.error) throw new Error(json.error);
    return json.response ?? "";
  } finally {
    clearTimeout(timer);
  }
}

export async function pingOllama(endpoint: string, timeoutMs = 3000): Promise<PingResult> {
  const start = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const json = (await request(`${trimEndpoint(endpoint)}/api/tags`, {
      method: "GET",
      signal: controller.signal,
    })) as OllamaTagsResponse;
    const models = Array.isArray(json.models)
      ? json.models.map((m) => m.name ?? "").filter(Boolean)
      : [];
    return { ok: true, models, ms: Date.now() - start };
  } catch (e) {
    return { ok: false, models: [], error: friendlyError(e), ms: Date.now() - start };
  } finally {
    clearTimeout(timer);
  }
}

export function friendlyError(e: unknown): string {
  const msg = (e as Error)?.message ?? String(e);
  if (/abort|timeout/i.test(msg)) {
    return "Ollama timed out. Is `ollama serve` running and the model loaded?";
  }
  // Tauri's HTTP plugin wraps reqwest, which emits errors like
  // "error sending request for url (http://localhost:11434/api/tags): error
  // trying to connect: tcp connect error: Connection refused (os error 61)"
  // when the daemon isn't running. The browser fetch path uses "ECONNREFUSED"
  // / "fetch failed" — different strings, same condition. Catch both here so
  // the user sees the same friendly message regardless of which path failed.
  if (
    /refused|ECONNREFUSED|fetch failed|networkerror|load failed|error sending request|tcp connect error|connection reset/i.test(
      msg,
    )
  ) {
    return "Could not reach Ollama. Make sure `ollama serve` is running and the endpoint URL is correct.";
  }
  if (/HTTP 404/i.test(msg)) {
    return "Ollama responded but the model was not found. Pull it with `ollama pull <model-name>` or check the model name in Settings.";
  }
  if (/HTTP 5\d\d/i.test(msg)) {
    return `Ollama returned a server error: ${msg}`;
  }
  if (/CORS|cross-origin/i.test(msg)) {
    return "Browser blocked the Ollama request (CORS). Run the desktop build with `npm run tauri:dev`, or start Ollama with `OLLAMA_ORIGINS='*' ollama serve`.";
  }
  return msg;
}

function mergeSignals(...signals: Array<AbortSignal | undefined>): AbortSignal | undefined {
  const real = signals.filter((s): s is AbortSignal => !!s);
  if (real.length === 0) return undefined;
  if (real.length === 1) return real[0];
  const c = new AbortController();
  for (const s of real) {
    if (s.aborted) {
      c.abort();
      break;
    }
    s.addEventListener("abort", () => c.abort(), { once: true });
  }
  return c.signal;
}
