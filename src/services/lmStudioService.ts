/**
 * LM Studio uses an OpenAI-compatible local API.
 * Default endpoint: http://localhost:1234/v1
 * Same prompts as Ollama; same fallback to rule-based.
 */

interface LMStudioGenerateOptions {
  endpoint: string;
  model?: string;
  system: string;
  prompt: string;
  temperature?: number;
  maxTokens?: number;
  format?: "json" | "text";
  timeoutMs?: number;
}

interface OpenAICompletionResponse {
  choices?: Array<{ message?: { content?: string }; text?: string }>;
  error?: { message?: string };
}

export async function generateLMStudio(options: LMStudioGenerateOptions): Promise<string> {
  const url = normalizeEndpoint(options.endpoint) + "/chat/completions";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 30000);

  try {
    const body: Record<string, unknown> = {
      model: options.model || "local-model",
      messages: [
        { role: "system", content: options.system },
        { role: "user", content: options.prompt },
      ],
      temperature: options.temperature ?? 0.2,
      max_tokens: options.maxTokens ?? 800,
      stream: false,
    };
    if (options.format === "json") {
      body.response_format = { type: "json_object" };
    }

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errText = await safeReadText(res);
      throw new Error(`LM Studio HTTP ${res.status}: ${errText || res.statusText}`);
    }

    const json = (await res.json()) as OpenAICompletionResponse;
    if (json.error?.message) throw new Error(json.error.message);
    const content = json.choices?.[0]?.message?.content ?? json.choices?.[0]?.text ?? "";
    if (!content.trim()) throw new Error("LM Studio returned empty content.");
    return content;
  } finally {
    clearTimeout(timeout);
  }
}

export interface LMStudioPingResult {
  ok: boolean;
  ms: number;
  models: string[];
  error?: string;
}

export async function pingLMStudio(endpoint: string, timeoutMs = 4000): Promise<LMStudioPingResult> {
  const url = normalizeEndpoint(endpoint) + "/models";
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  const start = Date.now();
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      return {
        ok: false,
        ms: Date.now() - start,
        models: [],
        error: `LM Studio responded HTTP ${res.status}.`,
      };
    }
    const json = (await res.json()) as { data?: Array<{ id: string }> };
    const models = (json.data ?? []).map((m) => m.id).filter(Boolean);
    return { ok: true, ms: Date.now() - start, models };
  } catch (e) {
    return {
      ok: false,
      ms: Date.now() - start,
      models: [],
      error: friendlyLMStudioError(e),
    };
  } finally {
    clearTimeout(t);
  }
}

export function friendlyLMStudioError(e: unknown): string {
  const msg = (e as Error)?.message ?? String(e);
  if (/abort|timeout/i.test(msg)) return "LM Studio request timed out. Is the local server running?";
  // Same expanded pattern as ollamaService.friendlyError — Tauri's HTTP
  // plugin wraps reqwest, which emits "error sending request for url (...)"
  // when the daemon isn't reachable. Browser fetch uses different strings.
  // Cover both so the user gets one consistent message.
  if (
    /Failed to fetch|NetworkError|ECONNREFUSED|refused|fetch failed|load failed|error sending request|tcp connect error|connection reset/i.test(
      msg,
    )
  )
    return "Could not reach LM Studio. Start it (LM Studio → Local Server → Start Server) and verify the endpoint.";
  return msg;
}

function normalizeEndpoint(endpoint: string): string {
  let e = endpoint.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(e)) e = "http://" + e;
  if (!/\/v\d+$/.test(e)) {
    // Allow user-entered base URLs without /v1
    if (!e.endsWith("/v1")) e = e + "/v1";
  }
  return e;
}

async function safeReadText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}
