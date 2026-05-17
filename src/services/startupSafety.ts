/**
 * Phase 12 — startup safety warnings.
 *
 * Runs once at app boot (from main.tsx's initStorage().finally callback)
 * and computes a list of non-blocking warnings the user should see. These
 * are surfaced by `<StartupWarningBanner>` at the top of every page.
 *
 * Important: every check here is non-blocking. We never throw; if a check
 * itself fails (e.g. listAudioFilesOnDisk throws because the Tauri command
 * isn't registered), the failure becomes its own warning entry — better to
 * tell the user "we couldn't check X" than to silently swallow it.
 */
import {
  getRecentStorageErrors,
  getStorageBackend,
  ticketStore,
} from "./databaseService";
import { audioFilesStore } from "./audioFilesStore";
import { EXTRACTION_SOURCE_VERSION } from "../types/ticket";
import {
  audioDataDir,
  isPersistenceAvailable,
  listAudioFilesOnDisk,
} from "./audioStorage";
import { remindersStore } from "./remindersStore";
import { settingsStore } from "./databaseService";
import { pingLMStudio } from "./lmStudioService";
import { pingOllama } from "./ollamaService";
import { testWhisper } from "./whisperService";
import { logError } from "./errorLog";
import { getLastBackupAt } from "./backupService";

export type StartupWarningSeverity = "info" | "warning" | "error";

export interface StartupWarning {
  id: string;
  severity: StartupWarningSeverity;
  message: string;
  /** Optional route to navigate to so the user can fix the underlying problem. */
  link?: { to: string; label: string };
}

/**
 * The user's first launch should be ad-friendly — no warnings about "you
 * never backed up" before the user has even created a ticket. We only fire
 * the no-backup warning once tickets exist AND the user has been around
 * long enough that they should be expected to have a backup workflow.
 *
 * Phase 14 polish: tightened to also require at least one saved ticket. A
 * fresh install with whisper preconfigured (eg. installed by IT) shouldn't
 * see a "you never backed up" warning before they've done anything worth
 * backing up.
 */
function shouldWarnNoBackup(): boolean {
  if (getLastBackupAt()) return false;
  try {
    if (ticketStore.list().length === 0) return false;
    const settings = settingsStore.load();
    if (!settings.whisperExecutablePath && !settings.whisperModelPath) return false;
  } catch {
    return false;
  }
  return true;
}

export async function computeStartupWarnings(): Promise<StartupWarning[]> {
  const out: StartupWarning[] = [];

  // Storage backend
  try {
    const backend = getStorageBackend();
    if (backend === "localStorage") {
      const errs = getRecentStorageErrors();
      const why =
        errs.length > 0 ? ` (${errs[0].message})` : "";
      out.push({
        id: "storage-localstorage-fallback",
        severity: "error",
        message: `SQLite is unavailable; storage fell back to localStorage${why}.`,
        link: { to: "/system", label: "Open System Health" },
      });
    }
  } catch (e) {
    logError({
      source: "startup",
      op: "checkStorage",
      message: (e as Error).message,
      severity: "warning",
    });
  }

  // Audio directory + missing files
  try {
    if (isPersistenceAvailable()) {
      const [files, dir] = await Promise.all([
        listAudioFilesOnDisk().catch(() => []),
        audioDataDir().catch(() => null),
      ]);
      if (!dir) {
        out.push({
          id: "audio-dir-missing",
          severity: "warning",
          message:
            "Recordings can't be saved — the audio folder is missing. Open System Health to check where the app stores recordings.",
          link: { to: "/system", label: "Open System Health" },
        });
      } else {
        const onDisk = new Set(files.map((f) => f.path));
        const active = audioFilesStore.list().filter((m) => !m.deleted && m.path);
        const missing = active.filter((m) => !onDisk.has(m.path)).length;
        if (missing > 0) {
          // Phase 16 fix: embed the count in the id so a dismissal at
          // "3 missing" naturally expires the moment a 4th file goes
          // missing — the user gets a fresh banner instead of silently
          // worse state.
          out.push({
            id: `audio-files-missing:${missing}`,
            severity: "warning",
            message: `${missing} audio file(s) referenced in History are missing on disk.`,
            link: { to: "/system", label: "Run Health Check" },
          });
        }
      }
    }
  } catch (e) {
    logError({
      source: "startup",
      op: "checkAudio",
      message: (e as Error).message,
      severity: "warning",
    });
  }

  // Settings-dependent checks
  let settingsOk = true;
  try {
    const settings = settingsStore.load();

    // Whisper paths
    if (
      settings.transcriptionMode === "whisper-cpp" &&
      (!settings.whisperExecutablePath || !settings.whisperModelPath)
    ) {
      out.push({
        id: "whisper-not-configured",
        severity: "info",
        message:
          "Transcription mode is whisper-cpp but the executable or model path is not set.",
        link: { to: "/settings", label: "Configure whisper.cpp" },
      });
    }

    // AI provider reachability — best-effort, non-blocking.
    // Phase 16 fix: fingerprint dismissals on the endpoint so switching the
    // endpoint (or the provider) re-emits a fresh banner, but routine
    // restarts with the same unreachable endpoint stay dismissed.
    if (settings.aiProvider === "ollama" && settings.ollamaEndpoint) {
      const r = await pingOllama(settings.ollamaEndpoint, 1500).catch(() => null);
      if (r && !r.ok) {
        out.push({
          id: `ollama-unreachable:${settings.ollamaEndpoint}`,
          severity: "info",
          message: `Ollama is not running. Start Ollama or switch AI Provider to Rule-based mode. Configured endpoint: ${settings.ollamaEndpoint}.`,
          link: { to: "/settings", label: "Open Settings" },
        });
      }
    } else if (settings.aiProvider === "lmstudio" && settings.lmStudioEndpoint) {
      const r = await pingLMStudio(settings.lmStudioEndpoint, 1500).catch(
        () => null,
      );
      if (r && !r.ok) {
        out.push({
          id: `lmstudio-unreachable:${settings.lmStudioEndpoint}`,
          severity: "info",
          message: `LM Studio server is not running. Open LM Studio, start Local Server, then try again. Configured endpoint: ${settings.lmStudioEndpoint}.`,
          link: { to: "/settings", label: "Open Settings" },
        });
      }
    }

    // Whisper smoke probe — only if configured
    if (
      settings.whisperExecutablePath &&
      settings.whisperModelPath &&
      isPersistenceAvailable()
    ) {
      const r = await testWhisper({
        whisperPath: settings.whisperExecutablePath,
        modelPath: settings.whisperModelPath,
      }).catch(() => null);
      if (r && !r.ok && !r.executableOk) {
        out.push({
          id: "whisper-broken",
          severity: "warning",
          message: `whisper.cpp executable is not running: ${r.message}`,
          link: { to: "/settings", label: "Open Settings" },
        });
      }
    }
  } catch (e) {
    settingsOk = false;
    logError({
      source: "startup",
      op: "checkSettings",
      message: (e as Error).message,
      severity: "warning",
    });
  }

  // Due reminders — non-blocking, just a heads-up.
  try {
    const due = remindersStore.dueSoon(0).length;
    if (due > 0) {
      out.push({
        // Embed the count + local date so a daily reminder gets a fresh
        // banner each day even after the user dismissed yesterday's.
        id: `reminders-due:${due}:${new Date().toLocaleDateString()}`,
        severity: "info",
        message: `${due} reminder(s) due now.`,
        link: { to: "/reminders", label: "Open Reminders" },
      });
    }
  } catch (e) {
    logError({
      source: "startup",
      op: "checkReminders",
      message: (e as Error).message,
      severity: "warning",
    });
  }

  // No backup ever
  if (settingsOk && shouldWarnNoBackup()) {
    out.push({
      id: "no-backup-ever",
      severity: "info",
      message:
        "You have never exported a backup. Tickets, settings, and knowledge live only on this machine.",
      link: { to: "/system", label: "Export Backup" },
    });
  }

  // Older-extractor tickets — rebuild reminder, fired only when there are
  // many enough that the user might care.
  try {
    const old = ticketStore.list().filter(
      (t) =>
        !t.extractionSourceVersion ||
        t.extractionSourceVersion !== EXTRACTION_SOURCE_VERSION,
    ).length;
    if (old >= 5) {
      out.push({
        // Embed both the count and the current extractor version so a
        // dismissal expires either when the user re-extracts (count
        // changes) or when the extractor itself is bumped (version
        // changes), but stays dismissed across normal app restarts.
        id: `extractor-version-drift:${old}:${EXTRACTION_SOURCE_VERSION}`,
        severity: "info",
        message: `${old} ticket(s) were extracted with an older analyzer version. Re-extracting may improve them.`,
        link: { to: "/history", label: "Open History" },
      });
    }
  } catch {
    // ignore — count drift is purely advisory
  }

  return out;
}
