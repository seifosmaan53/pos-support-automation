/**
 * Phase 12 — system-health snapshot.
 *
 * The System Health page used to inline every count + probe in its render
 * function. Pulling it into a pure function gives us:
 *   • Diagnostics export ("dump everything the support team would ask for"
 *     in one call).
 *   • Backup metadata ("snapshot the world before applying a restore").
 *   • A single tested code path for "what is currently true about the app".
 *
 * Everything that requires Tauri probes (missing audio scan, AI pings) is
 * isolated in `probeSystem()` so the synchronous `summarizeSystem()` works
 * in unit tests + the browser preview.
 */
import { audioFilesStore } from "./audioFilesStore";
import { getStorageBackend, getRecentStorageErrors, ticketStore } from "./databaseService";
import { extractionPatternsStore } from "./extractionPatternsStore";
import { knowledgeStore } from "./knowledgeStore";
import { pingLMStudio } from "./lmStudioService";
import { pingOllama } from "./ollamaService";
import { remindersStore } from "./remindersStore";
import { styleExamplesStore } from "./styleExamplesStore";
import {
  audioDataDir,
  isPersistenceAvailable,
  listAudioFilesOnDisk,
} from "./audioStorage";
import { testWhisper } from "./whisperService";
import { getRecentErrors, type ErrorLogEntry } from "./errorLog";
import { EXTRACTION_SOURCE_VERSION } from "../types/ticket";
import type { AppSettings } from "../types/settings";

export interface SystemHealthCounts {
  tickets: number;
  audioRowsActive: number;
  audioRowsDeleted: number;
  audioRowsTotal: number;
  audioFilesOnDisk: number;
  audioMissingFromDisk: number;
  audioOrphanFiles: number;
  reminders: number;
  remindersOpen: number;
  remindersDue: number;
  knowledgeItems: number;
  styleExamples: number;
  extractionPatterns: number;
  ticketsOnOlderExtractor: number;
  currentExtractorVersion: string;
}

export type ProbeStatus = "ok" | "warning" | "error" | "unknown" | "not-configured";

export interface ProbeResult {
  status: ProbeStatus;
  message: string;
  /** Optional millisecond timing for connection pings. */
  ms?: number;
}

export interface SystemHealthSnapshot {
  /** ISO timestamp of when this snapshot was captured. */
  capturedAt: string;
  /** Storage backend the app booted with — "sqlite", "localStorage", or "uninitialized". */
  storageBackend: string;
  /** True when running inside the Tauri desktop shell. */
  isDesktopApp: boolean;
  counts: SystemHealthCounts;
  probes: {
    storage: ProbeResult;
    whisper: ProbeResult;
    ollama: ProbeResult;
    lmstudio: ProbeResult;
    audioDir: ProbeResult;
  };
  /** Last error message from each subsystem (newest first, capped at 3 each). */
  lastErrors: {
    storage: ErrorLogEntry[];
    audio: ErrorLogEntry[];
    transcription: ErrorLogEntry[];
    ai: ErrorLogEntry[];
  };
  audioDir: string | null;
}

function summarizeReminders(): { total: number; open: number; due: number } {
  const all = remindersStore.list();
  let open = 0;
  let due = 0;
  const now = Date.now();
  for (const r of all) {
    if (r.status !== "open") continue;
    open += 1;
    if (r.dueAt) {
      const t = Date.parse(r.dueAt);
      if (Number.isFinite(t) && t <= now) due += 1;
    }
  }
  return { total: all.length, open, due };
}

function countOlderExtractor(): number {
  const all = ticketStore.list();
  let count = 0;
  for (const t of all) {
    if (!t.extractionSourceVersion) {
      count += 1;
    } else if (t.extractionSourceVersion !== EXTRACTION_SOURCE_VERSION) {
      count += 1;
    }
  }
  return count;
}

/**
 * Synchronous part of the snapshot — counts only. Used by tests and by the
 * Backup export to embed "what was true at backup time" without needing
 * Tauri probes.
 */
export function summarizeSystem(settings: AppSettings): {
  capturedAt: string;
  storageBackend: string;
  isDesktopApp: boolean;
  counts: SystemHealthCounts;
  lastErrors: SystemHealthSnapshot["lastErrors"];
} {
  const tickets = ticketStore.list();
  const audioRows = audioFilesStore.list();
  const audioActive = audioRows.filter((a) => !a.deleted);
  const audioDeleted = audioRows.filter((a) => a.deleted);
  const reminders = summarizeReminders();
  // settings is included in the signature so future versions can derive
  // version-dependent counts (e.g. tickets predating a setting change)
  void settings;

  return {
    capturedAt: new Date().toISOString(),
    storageBackend: getStorageBackend(),
    isDesktopApp: isPersistenceAvailable(),
    counts: {
      tickets: tickets.length,
      audioRowsActive: audioActive.length,
      audioRowsDeleted: audioDeleted.length,
      audioRowsTotal: audioRows.length,
      audioFilesOnDisk: 0,
      audioMissingFromDisk: 0,
      audioOrphanFiles: 0,
      reminders: reminders.total,
      remindersOpen: reminders.open,
      remindersDue: reminders.due,
      knowledgeItems: knowledgeStore.list().length,
      styleExamples: styleExamplesStore.list().length,
      extractionPatterns: extractionPatternsStore.list().length,
      ticketsOnOlderExtractor: countOlderExtractor(),
      currentExtractorVersion: EXTRACTION_SOURCE_VERSION,
    },
    lastErrors: {
      storage: getRecentErrors("storage", 3),
      audio: getRecentErrors("audio", 3),
      transcription: getRecentErrors("whisper", 3),
      ai: getRecentErrors("ai", 3),
    },
  };
}

async function probeStorage(): Promise<ProbeResult> {
  const backend = getStorageBackend();
  if (backend === "sqlite") {
    return { status: "ok", message: "SQLite — primary storage backend." };
  }
  if (backend === "localStorage") {
    return {
      status: "warning",
      message:
        "localStorage — fallback mode. SQLite is the default in the desktop app; see Error Log for the boot failure.",
    };
  }
  return { status: "unknown", message: "Storage backend has not finished initializing." };
}

async function probeWhisper(settings: AppSettings): Promise<ProbeResult> {
  if (!settings.whisperExecutablePath || !settings.whisperModelPath) {
    return {
      status: "not-configured",
      message: "Whisper executable or model path not set in Settings → Local Transcription.",
    };
  }
  try {
    const r = await testWhisper({
      whisperPath: settings.whisperExecutablePath,
      modelPath: settings.whisperModelPath,
    });
    if (r.ok) return { status: "ok", message: r.message };
    if (r.executableOk) return { status: "warning", message: r.message };
    return { status: "error", message: r.message };
  } catch (e) {
    return { status: "error", message: (e as Error).message };
  }
}

async function probeOllama(settings: AppSettings): Promise<ProbeResult> {
  const isActive = settings.aiProvider === "ollama";
  if (!settings.ollamaEndpoint) {
    return {
      status: isActive ? "warning" : "not-configured",
      message: isActive
        ? "Ollama is the active provider but no endpoint is configured."
        : "Not the active AI provider.",
    };
  }
  // Phase 12B: probe even when inactive so the user sees "reachable" /
  // "unreachable" info, but downgrade severity when it isn't selected.
  const timeout = isActive ? 4000 : 1500;
  const r = await pingOllama(settings.ollamaEndpoint, timeout).catch(() => null);
  if (!r || !r.ok) {
    if (!isActive) {
      return {
        status: "not-configured",
        message: "Ollama is not reachable, but it is not the active provider.",
        ms: r?.ms,
      };
    }
    return {
      status: "error",
      message: r?.error ?? "Could not reach Ollama.",
      ms: r?.ms,
    };
  }
  const hasModel = r.models.includes(settings.ollamaModel);
  if (!hasModel && isActive) {
    return {
      status: "warning",
      message: `Reachable but "${settings.ollamaModel}" is not installed. Run: ollama pull ${settings.ollamaModel}`,
      ms: r.ms,
    };
  }
  return {
    status: isActive ? "ok" : "not-configured",
    message: isActive
      ? `Reachable. ${r.models.length} model(s) installed.`
      : `Reachable, but not the active provider.`,
    ms: r.ms,
  };
}

async function probeLMStudio(settings: AppSettings): Promise<ProbeResult> {
  const isActive = settings.aiProvider === "lmstudio";
  if (!settings.lmStudioEndpoint) {
    return {
      status: isActive ? "warning" : "not-configured",
      message: isActive
        ? "LM Studio is the active provider but no endpoint is configured."
        : "Not the active AI provider.",
    };
  }
  const timeout = isActive ? 4000 : 1500;
  const r = await pingLMStudio(settings.lmStudioEndpoint, timeout).catch(() => null);
  if (!r || !r.ok) {
    if (!isActive) {
      return {
        status: "not-configured",
        message: "LM Studio is not reachable, but it is not the active provider.",
        ms: r?.ms,
      };
    }
    return {
      status: "error",
      message: r?.error ?? "Could not reach LM Studio.",
      ms: r?.ms,
    };
  }
  return {
    status: isActive ? "ok" : "not-configured",
    message: isActive
      ? `Reachable. ${r.models.length} model(s) loaded.`
      : `Reachable, but not the active provider.`,
    ms: r.ms,
  };
}

interface AudioDirResult {
  probe: ProbeResult;
  audioFilesOnDisk: number;
  audioMissingFromDisk: number;
  audioOrphanFiles: number;
  audioDir: string | null;
}

async function probeAudioDir(): Promise<AudioDirResult> {
  if (!isPersistenceAvailable()) {
    return {
      probe: {
        status: "not-configured",
        message: "Audio directory is only available in the desktop app.",
      },
      audioFilesOnDisk: 0,
      audioMissingFromDisk: 0,
      audioOrphanFiles: 0,
      audioDir: null,
    };
  }
  try {
    const [files, dir] = await Promise.all([listAudioFilesOnDisk(), audioDataDir()]);
    const activeRows = audioFilesStore.list().filter((m) => !m.deleted);
    const onDiskPaths = new Set(files.map((f) => f.path));
    const linkedPaths = new Set(activeRows.map((m) => m.path));
    const missing = activeRows.filter((m) => !onDiskPaths.has(m.path)).length;
    const orphans = files.filter((f) => !linkedPaths.has(f.path)).length;
    const message =
      `${files.length} file(s) on disk` +
      (missing ? ` · ${missing} missing` : "") +
      (orphans ? ` · ${orphans} orphan` : "") +
      (dir ? ` · ${dir}` : "");
    const status: ProbeStatus = missing > 0 ? "error" : orphans > 0 ? "warning" : "ok";
    return {
      probe: { status, message },
      audioFilesOnDisk: files.length,
      audioMissingFromDisk: missing,
      audioOrphanFiles: orphans,
      audioDir: dir,
    };
  } catch (e) {
    return {
      probe: { status: "error", message: (e as Error).message },
      audioFilesOnDisk: 0,
      audioMissingFromDisk: 0,
      audioOrphanFiles: 0,
      audioDir: null,
    };
  }
}

/**
 * Full snapshot — counts + async probes. Used by the System Health page's
 * "Run Health Check" button and by Export Diagnostics.
 */
export async function probeSystem(settings: AppSettings): Promise<SystemHealthSnapshot> {
  const sync = summarizeSystem(settings);
  const [storage, whisper, ollama, lmstudio, audio] = await Promise.all([
    probeStorage(),
    probeWhisper(settings),
    probeOllama(settings),
    probeLMStudio(settings),
    probeAudioDir(),
  ]);

  return {
    ...sync,
    counts: {
      ...sync.counts,
      audioFilesOnDisk: audio.audioFilesOnDisk,
      audioMissingFromDisk: audio.audioMissingFromDisk,
      audioOrphanFiles: audio.audioOrphanFiles,
    },
    probes: {
      storage,
      whisper,
      ollama,
      lmstudio,
      audioDir: audio.probe,
    },
    audioDir: audio.audioDir,
  };
}

/**
 * Pull recentStorageErrors out of databaseService into the central log so
 * "the log" is genuinely complete. Idempotent — calling it twice doesn't
 * duplicate entries, because each storage error already has a stable {at}
 * timestamp that we use for the key.
 */
const importedStorageErrorKeys = new Set<string>();
export function importStorageErrorsIntoLog(
  log: (input: { source: "storage"; op: string; message: string; severity?: "error" }) => void,
): void {
  const recent = getRecentStorageErrors();
  for (const e of recent) {
    const key = `${e.at}::${e.op}::${e.message}`;
    if (importedStorageErrorKeys.has(key)) continue;
    importedStorageErrorKeys.add(key);
    log({
      source: "storage",
      op: e.op,
      message: e.message,
      severity: "error",
    });
  }
}
