/**
 * Phase 12 — System Health page.
 *
 * Successor to the original "System Check" page. The shape is now:
 *   1. Top-level health probes (storage, audio, whisper, AI providers).
 *   2. Counts panel — tickets, audio, reminders, knowledge, style, patterns.
 *   3. Action grid — health check, self-tests, export diagnostics / backup /
 *      settings / error log, import backup, check missing/orphan audio.
 *   4. Portable Setup — folder paths + Open buttons + Verify button.
 *   5. Error Log viewer.
 *
 * Heavy lifting (counts, probes, error log) is in `systemHealth.ts` and
 * `errorLog.ts` — this page is a thin renderer over those services.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useConfirm } from "../components/ConfirmDialog";
import { useAppStore } from "../services/appStore";
import {
  applyFullBackup,
  applySettingsBackup,
  buildFullBackup,
  buildSettingsBackup,
  backupFilename,
  parseBackup,
  serializeBackup,
  markBackupCreatedNow,
  getLastBackupAt,
  verifyBackupText,
  type BackupPreview,
  type BackupVerification,
  type RestoreMode,
} from "../services/backupService";
import { AudioRepairWizard } from "../components/AudioRepairWizard";
import {
  buildPortableChecklist,
  buildReleaseBuildChecklist,
  buildReleaseChecklist,
  getRcSignal,
  getReleaseBuildFlag,
  markRcSignal,
  portableChecklistMarkdown,
  portableInstructionsMarkdown,
  setReleaseBuildFlag,
  type ChecklistItem,
  type ReleaseBuildChecklist,
  type ReleaseBuildFlag,
  type ReleaseChecklist,
} from "../services/releaseChecklist";
import {
  getSetupState,
  resetSetupState,
  SETUP_STEP_LABELS,
  type SetupStepId,
} from "../services/setupState";
import {
  listOlderExtractorTickets,
  reExtractSavedTicket,
} from "../services/reExtract";
import type { SavedTicket } from "../types/ticket";
import { EXTRACTION_SOURCE_VERSION } from "../types/ticket";
import {
  clearErrorLog,
  formatErrorLog,
  getErrorLog,
  logError,
  subscribeErrorLog,
  type ErrorLogEntry,
} from "../services/errorLog";
import {
  importStorageErrorsIntoLog,
  probeSystem,
  summarizeSystem,
  type ProbeResult,
  type ProbeStatus,
  type SystemHealthSnapshot,
} from "../services/systemHealth";
import {
  runAllSelfTests,
  type SelfTestSummary,
} from "../services/extractionSelfTests";
import { runWritingSelfTests } from "../services/writingSelfTests";
import { audioFilesStore } from "../services/audioFilesStore";
import {
  checkPathsExist,
  copyAudioFiles,
  getAppPaths,
  isTauriDesktop,
  openInFolder,
  readTextFile,
  writeTextFile,
  type AppPaths,
} from "../services/systemStorage";
import { copyText } from "../services/clipboardService";

type Tone = "ok" | "warning" | "error" | "info" | "neutral";

function dot(tone: Tone): JSX.Element {
  const map: Record<Tone, string> = {
    ok: "bg-emerald-500",
    warning: "bg-amber-500",
    error: "bg-red-500",
    info: "bg-sky-500",
    neutral: "bg-slate-400",
  };
  return (
    <span className={`mr-2 inline-block h-2.5 w-2.5 rounded-full ${map[tone]}`} />
  );
}

function toneOf(status: ProbeStatus): Tone {
  if (status === "ok") return "ok";
  if (status === "warning") return "warning";
  if (status === "error") return "error";
  if (status === "unknown") return "neutral";
  return "info";
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "never";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

interface ActionResult {
  tone: Tone;
  message: string;
}

export function SystemCheckPage() {
  const settings = useAppStore((s) => s.settings);
  const confirm = useConfirm();
  const navigate = useNavigate();
  const navigateToSetup = useCallback(() => navigate("/setup"), [navigate]);

  // Snapshot used for the counts panel + probe display. Computed once on
  // mount and again whenever the user clicks Run Health Check.
  const [snapshot, setSnapshot] = useState<SystemHealthSnapshot | null>(null);
  const [paths, setPaths] = useState<AppPaths | null>(null);
  const [lastResult, setLastResult] = useState<ActionResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [errorLog, setErrorLog] = useState<ErrorLogEntry[]>(getErrorLog());
  const [selfTests, setSelfTests] = useState<SelfTestSummary | null>(null);
  const [writingTests, setWritingTests] = useState<{
    passed: number;
    failed: number;
    details: string[];
  } | null>(null);
  // Phase 12B state
  const [repairOpen, setRepairOpen] = useState(false);
  const [verifyResult, setVerifyResult] = useState<BackupVerification | null>(null);
  const [olderTickets, setOlderTickets] = useState<SavedTicket[]>(() =>
    listOlderExtractorTickets(),
  );

  const runHealthCheck = useCallback(async () => {
    setBusy("health");
    setLastResult(null);
    try {
      importStorageErrorsIntoLog((e) => {
        logError({ source: e.source, op: e.op, message: e.message, severity: e.severity });
      });
      const snap = await probeSystem(settings);
      setSnapshot(snap);
      if (isTauriDesktop()) {
        try {
          setPaths(await getAppPaths());
        } catch (e) {
          logError({
            source: "startup",
            op: "getAppPaths",
            message: (e as Error).message,
          });
        }
      }
      setLastResult({ tone: "ok", message: "Health check complete." });
    } catch (e) {
      const msg = (e as Error).message;
      logError({ source: "startup", op: "runHealthCheck", message: msg });
      setLastResult({ tone: "error", message: `Health check failed: ${msg}` });
    } finally {
      setBusy(null);
    }
  }, [settings]);

  useEffect(() => {
    // First render — sync counts immediately (no async probes) so the
    // counts panel isn't blank for the half-second the probes take.
    setSnapshot((prev) => prev ?? (summarizeSystem(settings) as SystemHealthSnapshot));
    void runHealthCheck();
  }, [runHealthCheck, settings]);

  useEffect(() => {
    const unsub = subscribeErrorLog(() => setErrorLog(getErrorLog()));
    return unsub;
  }, []);

  const counts = snapshot?.counts;
  const probes = snapshot?.probes;

  const exportJsonToFile = useCallback(
    async (filename: string, body: string, label: string): Promise<ActionResult> => {
      if (isTauriDesktop()) {
        try {
          const { save } = await import("@tauri-apps/plugin-dialog");
          const dest = await save({ defaultPath: filename });
          if (!dest) {
            return { tone: "info", message: `${label} canceled.` };
          }
          await writeTextFile(dest, body, true);
          markBackupCreatedNow();
          return { tone: "ok", message: `${label} written to ${dest}` };
        } catch (e) {
          const msg = (e as Error).message;
          logError({ source: "backup", op: label, message: msg });
          return { tone: "error", message: `${label} failed: ${msg}` };
        }
      }
      // Browser preview — fall back to a Blob download.
      try {
        const blob = new Blob([body], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1_000);
        markBackupCreatedNow();
        return { tone: "ok", message: `${label} downloaded.` };
      } catch (e) {
        const msg = (e as Error).message;
        logError({ source: "backup", op: label, message: msg });
        return { tone: "error", message: `${label} failed: ${msg}` };
      }
    },
    [],
  );

  const exportFullBackup = useCallback(
    async (includeAudio: boolean) => {
      setBusy("export-backup");
      const backup = buildFullBackup({ audioFilesIncluded: includeAudio });
      const body = serializeBackup(backup);
      const filename = backupFilename("store-ticket-assistant.full");
      let result = await exportJsonToFile(filename, body, "Backup");
      // When the user opted to include audio, copy the active WAV files into
      // a sibling /audio folder. Best-effort — failures here only soften the
      // result message; the JSON itself is already written.
      if (includeAudio && result.tone === "ok" && isTauriDesktop()) {
        try {
          const audioPaths = audioFilesStore
            .list()
            .filter((m) => !m.deleted && m.path)
            .map((m) => m.path);
          if (audioPaths.length > 0) {
            // Strip the backup filename off the path to get its directory,
            // then append "audio".
            const lastSep = result.message.lastIndexOf("/");
            const dir =
              lastSep > 0 ? result.message.slice(0, lastSep).replace(/^[^/]*to\s+/, "") : "";
            if (dir) {
              const copied = await copyAudioFiles(audioPaths, `${dir}/audio`);
              result = {
                tone: "ok",
                message: `${result.message} · ${copied}/${audioPaths.length} audio file(s) copied.`,
              };
            }
          }
        } catch (e) {
          const msg = (e as Error).message;
          logError({
            source: "backup",
            op: "copyAudioFiles",
            message: msg,
            severity: "warning",
          });
          result = {
            tone: "warning",
            message: `${result.message} — audio copy failed: ${msg}`,
          };
        }
      }
      setLastResult(result);
      setBusy(null);
    },
    [exportJsonToFile],
  );

  const exportSettings = useCallback(async () => {
    setBusy("export-settings");
    const body = serializeBackup(buildSettingsBackup());
    const filename = backupFilename("store-ticket-assistant.settings");
    setLastResult(await exportJsonToFile(filename, body, "Settings backup"));
    setBusy(null);
  }, [exportJsonToFile]);

  const exportDiagnostics = useCallback(async () => {
    setBusy("export-diag");
    const snap = await probeSystem(settings);
    setSnapshot(snap);
    const body = JSON.stringify(
      {
        __diagnostics: { kind: "store-ticket-assistant.diagnostics", version: 1 },
        snapshot: snap,
        errorLog: getErrorLog(),
        settingsSummary: {
          aiProvider: settings.aiProvider,
          transcriptionMode: settings.transcriptionMode,
          theme: settings.theme,
          portableMode: settings.portableMode,
          saveAudio: settings.saveAudio,
          deleteAudioAfterTranscription: settings.deleteAudioAfterTranscription,
          whisperConfigured: !!(
            settings.whisperExecutablePath && settings.whisperModelPath
          ),
        },
      },
      null,
      2,
    );
    const stamp = new Date()
      .toISOString()
      .replace(/[:.]/g, "-")
      .replace("T", "_")
      .slice(0, 19);
    setLastResult(
      await exportJsonToFile(`sta-diagnostics-${stamp}.json`, body, "Diagnostics"),
    );
    setBusy(null);
  }, [exportJsonToFile, settings]);

  const exportErrorLogToFile = useCallback(async () => {
    setBusy("export-errlog");
    const body = formatErrorLog();
    const stamp = new Date()
      .toISOString()
      .replace(/[:.]/g, "-")
      .replace("T", "_")
      .slice(0, 19);
    setLastResult(
      await exportJsonToFile(`sta-error-log-${stamp}.txt`, body, "Error log"),
    );
    setBusy(null);
  }, [exportJsonToFile]);

  const copyErrorLogToClipboard = useCallback(async () => {
    try {
      const text = formatErrorLog();
      // Phase 16 fix — route through the Tauri-clipboard-first wrapper so
      // this works inside the Tauri webview's strict CSP. The previous
      // direct navigator.clipboard.writeText call could fail with
      // NotAllowedError even when the plugin path would have worked.
      await copyText(text);
      setLastResult({ tone: "ok", message: "Error log copied to clipboard." });
    } catch (e) {
      setLastResult({
        tone: "error",
        message: `Could not copy: ${(e as Error).message}`,
      });
    }
  }, []);

  const clearLogConfirm = useCallback(async () => {
    const ok = await confirm({
      title: "Clear error log?",
      message:
        "The error log on this machine will be cleared. Diagnostics already exported are not affected. This cannot be undone.",
      confirmLabel: "Clear log",
      destructive: true,
    });
    if (!ok) return;
    clearErrorLog();
    setLastResult({ tone: "ok", message: "Error log cleared." });
  }, [confirm]);

  const importBackupFromFile = useCallback(async () => {
    setBusy("import");
    setLastResult(null);
    try {
      let text: string;
      if (isTauriDesktop()) {
        const { open } = await import("@tauri-apps/plugin-dialog");
        const chosen = await open({
          multiple: false,
          filters: [{ name: "Backup", extensions: ["json"] }],
        });
        if (!chosen || Array.isArray(chosen)) {
          setLastResult({ tone: "info", message: "Import canceled." });
          setBusy(null);
          return;
        }
        text = await readTextFile(chosen);
      } else {
        // Browser preview — use a file input.
        text = await pickFileTextFromBrowser();
      }
      const parsed = parseBackup(text);
      if (!parsed.ok) {
        setLastResult({ tone: "error", message: parsed.error });
        setBusy(null);
        return;
      }
      const mode = await chooseRestoreMode(confirm, parsed.preview);
      if (!mode) {
        setLastResult({ tone: "info", message: "Restore canceled." });
        setBusy(null);
        return;
      }
      // Pre-restore backup, as a safety net.
      const pre = serializeBackup(buildFullBackup());
      const stamp = new Date()
        .toISOString()
        .replace(/[:.]/g, "-")
        .replace("T", "_")
        .slice(0, 19);
      await exportJsonToFile(
        `sta-pre-restore-${stamp}.json`,
        pre,
        "Pre-restore backup",
      );

      if (parsed.kind === "store-ticket-assistant.full") {
        const results = applyFullBackup(parsed.data, mode);
        const summary = results
          .map(
            (r) =>
              `${r.collection}: +${r.added}` +
              (r.replaced ? `/${r.replaced} replaced` : "") +
              (r.skipped ? `/${r.skipped} skipped` : ""),
          )
          .join(" · ");
        setLastResult({ tone: "ok", message: `Restore complete — ${summary}` });
      } else {
        const r = applySettingsBackup(parsed.data, mode);
        setLastResult({
          tone: "ok",
          message: `Settings restore complete (${r.replaced} settings file applied).`,
        });
      }
      // Phase 16 bug fix: the restore wrote directly to settingsStore via
      // localStorage. The in-memory appStore.settings is still the pre-
      // restore value — every consumer of useAppStore((s) => s.settings)
      // (Settings page, TicketFormHelperPage, whisper paths, AI provider,
      // technician name, …) would otherwise see stale settings until reload.
      useAppStore.getState().reloadSettings();
      // Refresh counts + log so the page reflects the new state.
      const fresh = await probeSystem(useAppStore.getState().settings);
      setSnapshot(fresh);
    } catch (e) {
      const msg = (e as Error).message;
      logError({ source: "restore", op: "importBackup", message: msg });
      setLastResult({ tone: "error", message: `Restore failed: ${msg}` });
    } finally {
      setBusy(null);
    }
  }, [confirm, exportJsonToFile, settings]);

  const runSelfTests = useCallback(() => {
    setBusy("self-tests");
    setTimeout(() => {
      setSelfTests(runAllSelfTests());
      setBusy(null);
    }, 0);
  }, []);

  const runWritingTests = useCallback(() => {
    setBusy("writing");
    setTimeout(() => {
      try {
        const r = runWritingSelfTests();
        setWritingTests(r);
        setLastResult({
          tone: r.failed === 0 ? "ok" : "warning",
          message: `Writing tests: ${r.passed} passed, ${r.failed} failed.`,
        });
      } catch (e) {
        const msg = (e as Error).message;
        setLastResult({ tone: "error", message: `Writing tests crashed: ${msg}` });
      } finally {
        setBusy(null);
      }
    }, 0);
  }, []);

  const checkMissingAudio = useCallback(async () => {
    setBusy("missing-audio");
    try {
      const active = audioFilesStore.list().filter((m) => !m.deleted && m.path);
      const exists = await checkPathsExist(active.map((m) => m.path));
      const missing = active.filter((_, i) => !exists[i]);
      setLastResult({
        tone: missing.length === 0 ? "ok" : "error",
        message:
          missing.length === 0
            ? `All ${active.length} audio file(s) accounted for.`
            : `${missing.length} missing — IDs: ${missing.map((m) => m.id).slice(0, 5).join(", ")}${missing.length > 5 ? ", …" : ""}`,
      });
      if (missing.length > 0) {
        logError({
          source: "audio",
          op: "checkMissingAudio",
          message: `${missing.length} audio file(s) referenced in SQLite are missing on disk.`,
          severity: "warning",
        });
      }
    } catch (e) {
      const msg = (e as Error).message;
      setLastResult({ tone: "error", message: `Check failed: ${msg}` });
    } finally {
      setBusy(null);
    }
  }, []);

  const checkOrphans = useCallback(async () => {
    setBusy("orphans");
    try {
      const fresh = await probeSystem(settings);
      setSnapshot(fresh);
      const n = fresh.counts.audioOrphanFiles;
      setLastResult({
        tone: n === 0 ? "ok" : "warning",
        message:
          n === 0
            ? "No orphan audio files."
            : `${n} orphan audio file(s) on disk. Recover from History.`,
      });
    } catch (e) {
      const msg = (e as Error).message;
      setLastResult({ tone: "error", message: `Orphan check failed: ${msg}` });
    } finally {
      setBusy(null);
    }
  }, [settings]);

  const lastBackupAt = useMemo(() => getLastBackupAt(), [lastResult]);

  const verifyBackupFromFile = useCallback(async () => {
    setBusy("verify");
    setLastResult(null);
    try {
      let text: string;
      if (isTauriDesktop()) {
        const { open } = await import("@tauri-apps/plugin-dialog");
        const chosen = await open({
          multiple: false,
          filters: [{ name: "Backup", extensions: ["json"] }],
        });
        if (!chosen || Array.isArray(chosen)) {
          setLastResult({ tone: "info", message: "Verify canceled." });
          setBusy(null);
          return;
        }
        text = await readTextFile(chosen);
      } else {
        text = await pickFileTextFromBrowser();
      }
      const result = verifyBackupText(text);
      setVerifyResult(result);
      if (result.valid) {
        // Phase 15 — stamp the Release Build "backup verified" tile.
        markRcSignal("lastBackupVerifiedAt");
      }
      setLastResult({
        tone: result.valid ? "ok" : "error",
        message: result.valid
          ? `Backup valid (${result.counts.tickets} ticket(s), ${result.counts.reminders} reminder(s)).`
          : `Backup invalid: ${result.errors.join("; ")}`,
      });
    } catch (e) {
      const msg = (e as Error).message;
      logError({ source: "backup", op: "verify", message: msg });
      setLastResult({ tone: "error", message: `Verify failed: ${msg}` });
    } finally {
      setBusy(null);
    }
  }, []);

  const reExtractOne = useCallback(
    async (id: string) => {
      setBusy(`re-extract:${id}`);
      try {
        const r = await reExtractSavedTicket(id, settings);
        setOlderTickets(listOlderExtractorTickets());
        setLastResult({
          tone: r.ok ? "ok" : "error",
          message: r.ok
            ? `Re-extracted ${id.slice(0, 8)} (now ${r.newExtractionVersion}).`
            : `Re-extract failed: ${r.message}`,
        });
      } catch (e) {
        setLastResult({
          tone: "error",
          message: `Re-extract crashed: ${(e as Error).message}`,
        });
      } finally {
        setBusy(null);
      }
    },
    [settings],
  );

  const reExtractAllOlder = useCallback(async () => {
    if (olderTickets.length === 0) return;
    const ok = await confirm({
      title: `Re-extract ${olderTickets.length} ticket(s)?`,
      message:
        "Each ticket will be re-analyzed with the current extractor. The original transcript and audio attachment are preserved; only derived fields (details, summaries, ticket fields) are updated. This may take a moment.",
      confirmLabel: `Re-extract ${olderTickets.length}`,
    });
    if (!ok) return;
    setBusy("re-extract-all");
    let okCount = 0;
    let failCount = 0;
    for (const t of olderTickets) {
      const r = await reExtractSavedTicket(t.id, settings);
      if (r.ok) okCount += 1;
      else failCount += 1;
    }
    setOlderTickets(listOlderExtractorTickets());
    setLastResult({
      tone: failCount === 0 ? "ok" : "warning",
      message: `Re-extract complete — ${okCount} ok, ${failCount} failed.`,
    });
    setBusy(null);
  }, [confirm, olderTickets, settings]);

  const onAudioRepairChange = useCallback(async () => {
    const fresh = await probeSystem(settings);
    setSnapshot(fresh);
  }, [settings]);

  const showBackupFirstPrompt =
    !!counts && (counts.audioMissingFromDisk > 0 || counts.audioOrphanFiles > 0);
  // Phase 14 polish: don't nag fresh installs about backups. The warning
  // only matters once the user has accrued data worth losing.
  const showNoBackupWarning =
    !lastBackupAt && !!counts && counts.tickets > 0;

  const releaseChecklist = useMemo<ReleaseChecklist>(
    () =>
      buildReleaseChecklist({
        settings,
        audioCounts: counts
          ? {
              missing: counts.audioMissingFromDisk,
              orphan: counts.audioOrphanFiles,
            }
          : undefined,
      }),
    // `lastResult` is included so the checklist refreshes after an action
    // re-runs (eg. exporting a backup flips the "Backup created" tile).
    // `errorLog` ditto so the "no critical errors" tile flips when the
    // user clears the log.
    [settings, counts, lastResult, errorLog],
  );

  const releaseBuildChecklist = useMemo<ReleaseBuildChecklist>(
    () =>
      buildReleaseBuildChecklist({
        settings,
        audioCounts: counts
          ? {
              missing: counts.audioMissingFromDisk,
              orphan: counts.audioOrphanFiles,
            }
          : undefined,
      }),
    [settings, counts, lastResult],
  );

  const toggleReleaseFlag = useCallback(
    (flag: ReleaseBuildFlag) => {
      const current = !!getReleaseBuildFlag(flag);
      setReleaseBuildFlag(flag, !current);
      // Force a re-render via lastResult — the verdict tile depends on flags.
      setLastResult({
        tone: "info",
        message: `Release build flag "${flag}" set to ${!current}.`,
      });
    },
    [],
  );

  const exportPortableInstructions = useCallback(async () => {
    setBusy("portable-instructions");
    const md = portableInstructionsMarkdown({
      paths: paths
        ? {
            appData: paths.appData,
            audio: paths.audio,
            backup: paths.backup,
            models: paths.models,
          }
        : null,
      lastBackupAt,
    });
    const stamp = new Date()
      .toISOString()
      .replace(/[:.]/g, "-")
      .replace("T", "_")
      .slice(0, 19);
    setLastResult(
      await exportJsonToFile(
        `sta-portable-instructions-${stamp}.md`,
        md,
        "Portable instructions",
      ),
    );
    setBusy(null);
  }, [exportJsonToFile, lastBackupAt, paths]);

  const portableItems = useMemo<ChecklistItem[]>(() => {
    return buildPortableChecklist({
      settings,
      paths: paths
        ? {
            appData: paths.appData,
            audio: paths.audio,
            backup: paths.backup,
            audioExists: paths.audioExists,
            backupExists: paths.backupExists,
          }
        : null,
      testRecordingOk: !!getRcSignal("lastAudioAttachAt"),
      testTranscriptionOk: !!getRcSignal("lastAudioAttachAt"),
      testTicketSaveOk: !!getRcSignal("lastTicketSaveAt"),
      settingsExported: !!getRcSignal("lastTicketSaveAt") && !!lastBackupAt,
    });
  }, [settings, paths, lastBackupAt]);

  const exportPortableChecklist = useCallback(async () => {
    setBusy("portable-checklist");
    const md = portableChecklistMarkdown(portableItems);
    const stamp = new Date()
      .toISOString()
      .replace(/[:.]/g, "-")
      .replace("T", "_")
      .slice(0, 19);
    setLastResult(
      await exportJsonToFile(
        `sta-portable-checklist-${stamp}.md`,
        md,
        "Portable checklist",
      ),
    );
    setBusy(null);
  }, [exportJsonToFile, portableItems]);

  const setupState = useMemo(() => getSetupState(), [lastResult]);
  const skippedSetupIds = useMemo<SetupStepId[]>(
    () =>
      (Object.entries(setupState.steps) as [SetupStepId, "completed" | "skipped"][])
        .filter(([, status]) => status === "skipped")
        .map(([id]) => id),
    [setupState],
  );

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <header>
        <h1 className="page-title">System Health</h1>
        <p className="page-subtitle">
          Status of storage, audio, transcription, and AI providers. Run a
          health check, export a backup, or inspect the local error log.
        </p>
      </header>

      {showNoBackupWarning && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-200">
          <strong>No backup has been created yet.</strong> Create a backup
          before using the app daily so you can recover if SQLite gets
          corrupted or the machine fails.
        </div>
      )}

      {showBackupFirstPrompt && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-200">
          <div className="font-medium">
            Audio integrity issues detected — create a backup before repairing.
          </div>
          <div className="mt-1 text-xs">
            {counts?.audioMissingFromDisk
              ? `${counts.audioMissingFromDisk} missing audio file(s). `
              : ""}
            {counts?.audioOrphanFiles
              ? `${counts.audioOrphanFiles} orphan audio row(s).`
              : ""}
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {isTauriDesktop() && (
              <button
                className="btn-primary text-xs"
                onClick={() => void exportFullBackup(true)}
                disabled={!!busy}
              >
                Export Backup + Audio
              </button>
            )}
            <button
              className="btn-ghost text-xs"
              onClick={() => void exportFullBackup(false)}
              disabled={!!busy}
            >
              Export Full Backup
            </button>
            <button
              className="btn-primary text-xs"
              onClick={() => setRepairOpen(true)}
              disabled={!!busy}
            >
              Repair Audio Records
            </button>
          </div>
        </div>
      )}

      {lastResult && <ResultBanner result={lastResult} />}

      <ReleaseCandidatePanel checklist={releaseChecklist} />

      <ReleaseBuildPanel
        checklist={releaseBuildChecklist}
        onToggleFlag={toggleReleaseFlag}
        onExportInstructions={() => void exportPortableInstructions()}
        busy={busy}
      />

      {skippedSetupIds.length > 0 && (
        <SkippedSetupPanel
          skipped={skippedSetupIds}
          onResume={() => navigateToSetup()}
          onReset={() => {
            resetSetupState();
            setLastResult({
              tone: "info",
              message: "Setup state reset. Re-open the app to walk through setup again.",
            });
          }}
        />
      )}

      <ActionGrid
        busy={busy}
        onRunHealthCheck={runHealthCheck}
        onRunSelfTests={runSelfTests}
        onRunWritingTests={runWritingTests}
        onExportBackup={() => void exportFullBackup(false)}
        onExportBackupWithAudio={() => void exportFullBackup(true)}
        onExportSettings={() => void exportSettings()}
        onExportDiagnostics={() => void exportDiagnostics()}
        onExportErrorLog={() => void exportErrorLogToFile()}
        onCopyErrorLog={() => void copyErrorLogToClipboard()}
        onClearErrorLog={() => void clearLogConfirm()}
        onImportBackup={() => void importBackupFromFile()}
        onVerifyBackup={() => void verifyBackupFromFile()}
        onRepairAudio={() => setRepairOpen(true)}
        onCheckMissingAudio={() => void checkMissingAudio()}
        onCheckOrphans={() => void checkOrphans()}
        canCopyAudio={isTauriDesktop()}
      />

      {verifyResult && <VerifyBackupPanel result={verifyResult} />}

      <BackupStatusCard lastBackupAt={lastBackupAt} />

      {probes && <ProbesPanel probes={probes} />}

      {counts && <CountsPanel counts={counts} extractorVersion={counts.currentExtractorVersion} />}

      <OlderExtractorPanel
        tickets={olderTickets}
        currentVersion={EXTRACTION_SOURCE_VERSION}
        busy={busy}
        onReExtractOne={(id) => void reExtractOne(id)}
        onReExtractAll={() => void reExtractAllOlder()}
      />

      {selfTests && <SelfTestsResult summary={selfTests} />}

      {writingTests && (
        <section className="card space-y-2 text-sm">
          <h2 className="text-base font-semibold">Writing tests</h2>
          <div className="text-xs text-slate-600 dark:text-slate-400">
            {writingTests.passed} passed · {writingTests.failed} failed
          </div>
          {writingTests.failed > 0 && (
            <ul className="list-disc space-y-1 pl-5 text-xs text-red-700 dark:text-red-300">
              {writingTests.details.map((d, i) => (
                <li key={i}>{d}</li>
              ))}
            </ul>
          )}
        </section>
      )}

      <PortableSetupPanel
        paths={paths}
        items={portableItems}
        busy={busy}
        onExportChecklist={() => void exportPortableChecklist()}
        onVerify={() => {
          const failing = portableItems.filter((i) => !i.ok);
          setLastResult({
            tone: failing.length === 0 ? "ok" : "warning",
            message:
              failing.length === 0
                ? "Portable setup looks good — every checklist item passed."
                : `${failing.length} item(s) need attention: ${failing.map((f) => f.label).join(", ")}`,
          });
        }}
      />

      <ErrorLogPanel entries={errorLog} />

      <section className="card space-y-2 text-sm">
        <h2 className="text-base font-semibold">Need to move this app?</h2>
        <p className="text-slate-700 dark:text-slate-300">
          On the source machine, click <strong>Export Full Backup</strong>{" "}
          {isTauriDesktop() ? "(with audio if you need recordings)" : ""}. On
          the destination, install Store Ticket Assistant, click{" "}
          <strong>Import / Restore Backup</strong>, and choose "Replace
          current data" if it is a fresh install. The pre-restore safety
          backup written automatically lives next to the file you imported.
        </p>
        <Link to="/help" className="btn-ghost text-xs">
          Read the move guide in Help
        </Link>
      </section>

      <AudioRepairWizard
        open={repairOpen}
        onClose={() => setRepairOpen(false)}
        onChange={() => void onAudioRepairChange()}
      />
    </div>
  );
}

function ResultBanner({ result }: { result: ActionResult }) {
  const toneMap: Record<Tone, string> = {
    ok: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200",
    warning:
      "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200",
    error:
      "border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/30 dark:text-red-200",
    info: "border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-800 dark:bg-sky-950/30 dark:text-sky-200",
    neutral:
      "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100",
  };
  return (
    <div className={`rounded-md border px-3 py-2 text-sm ${toneMap[result.tone]}`}>
      {result.message}
    </div>
  );
}

interface ActionGridProps {
  busy: string | null;
  onRunHealthCheck: () => void;
  onRunSelfTests: () => void;
  onRunWritingTests: () => void;
  onExportBackup: () => void;
  onExportBackupWithAudio: () => void;
  onExportSettings: () => void;
  onExportDiagnostics: () => void;
  onExportErrorLog: () => void;
  onCopyErrorLog: () => void;
  onClearErrorLog: () => void;
  onImportBackup: () => void;
  onVerifyBackup: () => void;
  onRepairAudio: () => void;
  onCheckMissingAudio: () => void;
  onCheckOrphans: () => void;
  canCopyAudio: boolean;
}

function ActionGrid(props: ActionGridProps) {
  const buttons: { key: string; label: string; on: () => void; primary?: boolean }[] = [
    { key: "health", label: "Run Health Check", on: props.onRunHealthCheck, primary: true },
    { key: "self-tests", label: "Run Extraction Self-Tests", on: props.onRunSelfTests },
    { key: "writing", label: "Run Writing Tests", on: props.onRunWritingTests },
    { key: "export-backup", label: "Export Full Backup", on: props.onExportBackup },
    ...(props.canCopyAudio
      ? [
          {
            key: "export-backup-audio",
            label: "Export Backup + Audio",
            on: props.onExportBackupWithAudio,
          },
        ]
      : []),
    { key: "export-settings", label: "Export Settings", on: props.onExportSettings },
    { key: "import", label: "Import / Restore Backup", on: props.onImportBackup },
    { key: "verify", label: "Verify Backup", on: props.onVerifyBackup },
    { key: "export-diag", label: "Export Diagnostics", on: props.onExportDiagnostics },
    { key: "repair-audio", label: "Repair Audio Records", on: props.onRepairAudio },
    { key: "export-errlog", label: "Export Error Log", on: props.onExportErrorLog },
    { key: "copy-errlog", label: "Copy Error Log", on: props.onCopyErrorLog },
    { key: "clear-errlog", label: "Clear Error Log", on: props.onClearErrorLog },
    {
      key: "missing-audio",
      label: "Check Missing Audio Files",
      on: props.onCheckMissingAudio,
    },
    { key: "orphans", label: "Check Orphan Audio Rows", on: props.onCheckOrphans },
  ];
  return (
    <section className="card space-y-2">
      <h2 className="text-base font-semibold">Actions</h2>
      <p className="text-xs text-slate-500">
        Backup includes ticket data, settings, knowledge, reminders, and audio
        metadata. {props.canCopyAudio
          ? "Use Export Backup + Audio to also copy WAV files into a sibling folder."
          : "Audio file bytes are only backed up in the Tauri desktop app."}
      </p>
      <div className="flex flex-wrap gap-2">
        {buttons.map((b) => (
          <button
            key={b.key}
            className={b.primary ? "btn-primary" : "btn-ghost"}
            disabled={!!props.busy}
            onClick={b.on}
          >
            {props.busy === b.key ? "…" : b.label}
          </button>
        ))}
      </div>
    </section>
  );
}

function BackupStatusCard({ lastBackupAt }: { lastBackupAt: string | null }) {
  const tone: Tone = !lastBackupAt
    ? "warning"
    : Date.now() - new Date(lastBackupAt).getTime() > 30 * 24 * 60 * 60 * 1000
      ? "warning"
      : "ok";
  return (
    <section className="card space-y-1 text-sm">
      <div className="flex items-center gap-2">
        {dot(tone)}
        <span className="font-medium">
          Last backup: {lastBackupAt ? formatDate(lastBackupAt) : "never"}
        </span>
      </div>
      {tone === "warning" && (
        <div className="text-xs text-amber-700 dark:text-amber-300">
          Export a backup so you can recover if SQLite gets corrupted or the
          machine fails.
        </div>
      )}
    </section>
  );
}

function ProbesPanel({ probes }: { probes: SystemHealthSnapshot["probes"] }) {
  const rows: { label: string; r: ProbeResult; help?: string }[] = [
    { label: "Local storage (SQLite)", r: probes.storage },
    { label: "Audio directory", r: probes.audioDir },
    {
      label: "Local transcription (whisper.cpp)",
      r: probes.whisper,
      help: "Set executable + model path in Settings.",
    },
    { label: "Local AI (Ollama)", r: probes.ollama },
    { label: "Local AI (LM Studio)", r: probes.lmstudio },
  ];
  return (
    <section className="card divide-y divide-slate-200 dark:divide-slate-800">
      {rows.map((row) => (
        <div key={row.label} className="flex items-start gap-2 py-3 first:pt-0 last:pb-0">
          <div className="mt-1">{dot(toneOf(row.r.status))}</div>
          <div className="flex-1">
            <div className="text-sm font-medium">{row.label}</div>
            <div className="text-xs text-slate-600 dark:text-slate-400">
              {row.r.message}
              {row.r.ms !== undefined && (
                <span className="ml-1 opacity-70">· {row.r.ms} ms</span>
              )}
            </div>
            {row.help && row.r.status === "not-configured" && (
              <div className="mt-1 text-xs text-slate-500">{row.help}</div>
            )}
          </div>
        </div>
      ))}
    </section>
  );
}

function CountsPanel({
  counts,
  extractorVersion,
}: {
  counts: SystemHealthSnapshot["counts"];
  extractorVersion: string;
}) {
  const rows: { label: string; value: string | number; tone?: Tone; help?: string }[] = [
    { label: "Tickets", value: counts.tickets },
    {
      label: "Older-extractor tickets",
      value: counts.ticketsOnOlderExtractor,
      tone: counts.ticketsOnOlderExtractor > 0 ? "warning" : "neutral",
      help: "Tickets whose extractionSourceVersion doesn't match the current analyzer.",
    },
    { label: "Audio rows (active)", value: counts.audioRowsActive },
    { label: "Audio rows (deleted)", value: counts.audioRowsDeleted },
    {
      label: "Audio files on disk",
      value: counts.audioFilesOnDisk,
      help: "Audio files found in the app audio folder.",
    },
    {
      label: "Missing audio files",
      value: counts.audioMissingFromDisk,
      tone: counts.audioMissingFromDisk > 0 ? "error" : "neutral",
      help: "Audio metadata exists in the database, but the file is missing from disk.",
    },
    {
      label: "Orphan audio rows",
      value: counts.audioOrphanFiles,
      tone: counts.audioOrphanFiles > 0 ? "warning" : "neutral",
      help: "Audio records exist that are not clearly linked to a saved ticket or are inconsistent.",
    },
    { label: "Reminders (total)", value: counts.reminders },
    {
      label: "Reminders (open)",
      value: counts.remindersOpen,
    },
    {
      label: "Reminders (due now)",
      value: counts.remindersDue,
      tone: counts.remindersDue > 0 ? "warning" : "neutral",
    },
    { label: "Knowledge items", value: counts.knowledgeItems },
    { label: "Style examples", value: counts.styleExamples },
    { label: "Extraction patterns", value: counts.extractionPatterns },
    { label: "Extractor version", value: extractorVersion },
  ];
  return (
    <section className="card">
      <h2 className="text-base font-semibold">Counts</h2>
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-3">
        {rows.map((r) => (
          <div
            key={r.label}
            className="flex items-start justify-between gap-2"
            title={r.help}
          >
            <dt className="min-w-0 flex-1 text-xs text-slate-500">{r.label}</dt>
            <dd
              className={`font-mono text-sm ${
                r.tone === "error"
                  ? "text-red-700 dark:text-red-300"
                  : r.tone === "warning"
                    ? "text-amber-700 dark:text-amber-300"
                    : ""
              }`}
            >
              {r.value}
            </dd>
          </div>
        ))}
      </dl>
      <details className="mt-3 text-xs text-slate-500">
        <summary className="cursor-pointer font-medium">
          What do these audio counts mean?
        </summary>
        <ul className="mt-1 list-disc space-y-1 pl-5">
          <li>
            <strong>Audio files on disk</strong> — audio files found in the app audio
            folder.
          </li>
          <li>
            <strong>Missing audio files</strong> — audio metadata exists in the
            database, but the file is missing from disk.
          </li>
          <li>
            <strong>Orphan audio rows</strong> — audio records exist that are not
            clearly linked to a saved ticket or are inconsistent.
          </li>
          <li>
            <strong>Audio rows (deleted)</strong> — rows soft-deleted from
            History; kept for audit history but no longer playable.
          </li>
        </ul>
        <p className="mt-1">
          Use <strong>Repair Audio Records</strong> to walk through each
          category and fix or remove rows individually — no audio file or
          metadata is ever deleted without confirmation.
        </p>
      </details>
    </section>
  );
}

function SelfTestsResult({ summary }: { summary: SelfTestSummary }) {
  return (
    <section className="card space-y-1 text-sm">
      <div className="font-semibold">
        Self-tests: {summary.passedTests}/{summary.totalTests} tests passed
      </div>
      <div className="text-xs text-slate-500">
        {summary.failedFieldChecks > 0
          ? `${summary.failedFieldChecks} field check${summary.failedFieldChecks === 1 ? "" : "s"} failed.`
          : "All canonical transcripts extract correctly."}
      </div>
    </section>
  );
}

function PortableSetupPanel({
  paths,
  items,
  busy,
  onExportChecklist,
  onVerify,
}: {
  paths: AppPaths | null;
  items: ChecklistItem[];
  busy: string | null;
  onExportChecklist: () => void;
  onVerify: () => void;
}) {
  if (!isTauriDesktop()) {
    return (
      <section className="card space-y-1 text-sm">
        <h2 className="text-base font-semibold">Portable Setup</h2>
        <div className="text-xs text-slate-500">
          Folder paths are only available in the Tauri desktop app.
        </div>
      </section>
    );
  }
  if (!paths) {
    return (
      <section className="card text-sm text-slate-500">
        Loading app paths…
      </section>
    );
  }
  const rows: { label: string; path: string; exists?: boolean }[] = [
    { label: "App data folder", path: paths.appData, exists: true },
    { label: "Audio folder", path: paths.audio, exists: paths.audioExists },
    { label: "Backup folder", path: paths.backup, exists: paths.backupExists },
    { label: "Models folder", path: paths.models, exists: paths.modelsExists },
    { label: "Tools folder", path: paths.tools, exists: paths.toolsExists },
  ];
  const passing = items.filter((i) => i.ok).length;
  return (
    <section className="card space-y-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">Portable Setup</h2>
          <p className="text-xs text-slate-500">
            Folder paths and a checklist for moving the app to another machine.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            className="btn-ghost text-xs"
            onClick={onVerify}
            disabled={!!busy}
          >
            Verify Portable Setup
          </button>
          <button
            className="btn-ghost text-xs"
            onClick={onExportChecklist}
            disabled={!!busy}
          >
            Export Portable Package Checklist
          </button>
        </div>
      </div>
      <div className="space-y-1.5">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center gap-2">
            {dot(r.exists ? "ok" : "neutral")}
            <div className="flex-1 truncate">
              <div className="text-xs font-medium">{r.label}</div>
              <div
                title={r.path}
                className="truncate font-mono text-xs text-slate-600 dark:text-slate-400"
              >
                {r.path}
              </div>
            </div>
            <button
              className="btn-ghost shrink-0 text-xs"
              onClick={() => void openInFolder(r.path)}
            >
              Open
            </button>
          </div>
        ))}
      </div>
      <details className="text-xs">
        <summary className="cursor-pointer font-medium">
          Portable Mode checklist ({passing}/{items.length})
        </summary>
        <ul className="mt-2 space-y-1">
          {items.map((item) => (
            <li key={item.id} className="flex items-start gap-2">
              {dot(item.ok ? "ok" : "warning")}
              <div className="min-w-0 flex-1">
                <div className="text-xs font-medium">{item.label}</div>
                <div className="text-xs text-slate-500">{item.detail}</div>
              </div>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}

function ReleaseCandidatePanel({ checklist }: { checklist: ReleaseChecklist }) {
  const tone: Tone = checklist.ready ? "ok" : "warning";
  return (
    <section
      className={`rounded-md border px-3 py-3 text-sm ${
        checklist.ready
          ? "border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30"
          : "border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30"
      }`}
    >
      <div className="flex items-center gap-2">
        {dot(tone)}
        <h2 className="text-base font-semibold">
          {checklist.ready ? "Ready for daily use" : "Needs attention"}
        </h2>
        <span className="ml-auto text-xs text-slate-600 dark:text-slate-400">
          {checklist.items.filter((i) => i.ok).length} / {checklist.items.length} passing
        </span>
      </div>
      <ul className="mt-2 grid gap-1 sm:grid-cols-2">
        {checklist.items.map((item) => (
          <li
            key={item.id}
            className="flex items-start gap-2 rounded-md bg-white/70 px-2 py-1.5 text-xs dark:bg-slate-900/40"
          >
            <span className="mt-0.5 inline-block">
              {dot(item.ok ? "ok" : "warning")}
            </span>
            <div className="min-w-0 flex-1">
              <div className="font-medium">{item.label}</div>
              <div className="text-[11px] text-slate-600 dark:text-slate-400">
                {item.detail}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ReleaseBuildPanel({
  checklist,
  onToggleFlag,
  onExportInstructions,
  busy,
}: {
  checklist: ReleaseBuildChecklist;
  onToggleFlag: (flag: ReleaseBuildFlag) => void;
  onExportInstructions: () => void;
  busy: string | null;
}) {
  const tone: Tone = checklist.ready ? "ok" : "warning";
  const manualFlagIds: ReleaseBuildFlag[] = [
    "macOsBuildCreated",
    "appLaunchedFromBuild",
    "recordingTestedFromBuild",
    "ticketSavedFromBuild",
    "backupExportedFromBuild",
  ];
  return (
    <section
      className={`rounded-md border px-3 py-3 text-sm ${
        checklist.ready
          ? "border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30"
          : "border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30"
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        {dot(tone)}
        <h2 className="text-base font-semibold">
          Release Build —{" "}
          {checklist.ready ? "Ready to build" : "Needs attention"}
        </h2>
        <span className="ml-auto text-xs text-slate-600 dark:text-slate-400">
          {checklist.items.filter((i) => i.ok).length} / {checklist.items.length} passing
        </span>
      </div>
      <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
        12-item gate before shipping a build. Auto-derived items reflect the
        current state of the app; manual items are toggled once you've
        physically verified them on the build artifact.
      </p>
      <ul className="mt-2 grid gap-1 sm:grid-cols-2">
        {checklist.items.map((item) => {
          const isManual = manualFlagIds.includes(item.id as ReleaseBuildFlag);
          return (
            <li
              key={item.id}
              className="flex items-start gap-2 rounded-md bg-white/70 px-2 py-1.5 text-xs dark:bg-slate-900/40"
            >
              <span className="mt-0.5 inline-block">
                {dot(item.ok ? "ok" : "warning")}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 font-medium">
                  {item.label}
                  {isManual && (
                    <span className="text-[9px] uppercase tracking-wide opacity-60">
                      manual
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-slate-600 dark:text-slate-400">
                  {item.detail}
                </div>
              </div>
              {isManual && (
                <button
                  type="button"
                  className="btn-ghost text-[11px]"
                  disabled={!!busy}
                  onClick={() => onToggleFlag(item.id as ReleaseBuildFlag)}
                >
                  {item.ok ? "Unmark" : "Mark"}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          className="btn-ghost text-xs"
          disabled={!!busy}
          onClick={onExportInstructions}
        >
          Export Portable Instructions
        </button>
      </div>
    </section>
  );
}

function SkippedSetupPanel({
  skipped,
  onResume,
  onReset,
}: {
  skipped: SetupStepId[];
  onResume: () => void;
  onReset: () => void;
}) {
  return (
    <section className="card space-y-1 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">
          Setup steps you skipped ({skipped.length})
        </h2>
        <div className="flex gap-1">
          <button className="btn-ghost text-xs" onClick={onResume}>
            Resume setup
          </button>
          <button className="btn-ghost text-xs" onClick={onReset}>
            Reset setup state
          </button>
        </div>
      </div>
      <ul className="list-disc space-y-0.5 pl-5 text-xs text-slate-600 dark:text-slate-400">
        {skipped.map((id) => (
          <li key={id}>{SETUP_STEP_LABELS[id]}</li>
        ))}
      </ul>
    </section>
  );
}

function ErrorLogPanel({ entries }: { entries: ErrorLogEntry[] }) {
  if (entries.length === 0) {
    return (
      <section className="card space-y-1 text-sm">
        <h2 className="text-base font-semibold">Error log</h2>
        <div className="text-xs text-slate-500">
          No errors recorded. Errors from SQLite, audio attach, transcription,
          and AI providers will appear here when they happen.
        </div>
      </section>
    );
  }
  return (
    <section className="card space-y-2 text-sm">
      <h2 className="text-base font-semibold">Error log ({entries.length})</h2>
      <ul className="space-y-1.5 text-xs">
        {entries.slice(0, 30).map((e) => (
          <li
            key={e.id}
            className={`rounded-md border p-2 ${
              e.severity === "error"
                ? "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/30"
                : e.severity === "warning"
                  ? "border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30"
                  : "border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900"
            }`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] uppercase tracking-wide opacity-60">
                {e.severity}
              </span>
              <span className="font-mono text-[10px] opacity-60">{e.source}</span>
              <span className="font-mono text-[10px] opacity-60">{e.at}</span>
            </div>
            <div className="mt-1 font-medium">{e.op}</div>
            <div className="whitespace-pre-wrap break-words text-slate-700 dark:text-slate-300">
              {e.message}
            </div>
          </li>
        ))}
      </ul>
      {entries.length > 30 && (
        <div className="text-xs text-slate-500">
          Showing newest 30. Export the log to see all {entries.length} entries.
        </div>
      )}
    </section>
  );
}

async function chooseRestoreMode(
  confirmFn: ReturnType<typeof useConfirm>,
  preview: BackupPreview,
): Promise<RestoreMode | null> {
  const counts = preview.counts;
  const summary =
    `Found ${counts.tickets} ticket(s), ${counts.reminders} reminder(s), ` +
    `${counts.knowledgeItems} knowledge item(s), ${counts.styleExamples} style example(s), ` +
    `${counts.extractionPatterns} extraction pattern(s).`;
  const merge = await confirmFn({
    title: "Restore mode",
    message:
      `${summary}\n\nMerge will keep existing rows and add anything new. ` +
      "Replace will clear existing rows first (with a pre-restore safety backup written automatically).",
    confirmLabel: "Merge",
    cancelLabel: "Cancel",
  });
  if (!merge) {
    const replace = await confirmFn({
      title: "Replace current data?",
      message:
        "This will replace tickets, reminders, knowledge, style examples, and extraction patterns " +
        "with the contents of the backup. A pre-restore safety backup will be written first.\n\n" +
        "Audio metadata (audio_files rows) is MERGED regardless of mode — existing rows are kept " +
        "to avoid orphaning WAV files on disk. Audio files on disk are never touched.",
      confirmLabel: "Replace",
      destructive: true,
    });
    if (!replace) return null;
    return "replace";
  }
  return "merge";
}

function VerifyBackupPanel({ result }: { result: BackupVerification }) {
  const tone: Tone = result.valid
    ? result.warnings.length > 0
      ? "warning"
      : "ok"
    : "error";
  return (
    <section className="card space-y-2 text-sm">
      <div className="flex items-center gap-2">
        {dot(tone)}
        <h2 className="text-base font-semibold">
          Backup {result.valid ? "valid" : "invalid"}
        </h2>
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs sm:grid-cols-3">
        <div className="flex justify-between gap-2">
          <dt className="text-slate-500">Kind</dt>
          <dd className="font-mono">{result.kind ?? "—"}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-slate-500">Format version</dt>
          <dd className="font-mono">{result.formatVersion ?? "—"}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-slate-500">App version</dt>
          <dd className="font-mono">{result.appVersion ?? "—"}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-slate-500">Created</dt>
          <dd className="font-mono">{result.createdAt ?? "—"}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-slate-500">Tickets</dt>
          <dd className="font-mono">{result.counts.tickets}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-slate-500">Reminders</dt>
          <dd className="font-mono">{result.counts.reminders}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-slate-500">Knowledge</dt>
          <dd className="font-mono">{result.counts.knowledgeItems}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-slate-500">Style examples</dt>
          <dd className="font-mono">{result.counts.styleExamples}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-slate-500">Patterns</dt>
          <dd className="font-mono">{result.counts.extractionPatterns}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-slate-500">Audio metadata</dt>
          <dd className="font-mono">{result.counts.audioFiles}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-slate-500">Has settings</dt>
          <dd className="font-mono">{result.hasSettings ? "yes" : "no"}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-slate-500">Audio bundled</dt>
          <dd className="font-mono">{result.audioFilesIncluded ? "yes" : "no"}</dd>
        </div>
      </dl>
      {result.errors.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-5 text-xs text-red-700 dark:text-red-300">
          {result.errors.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      )}
      {result.warnings.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-5 text-xs text-amber-700 dark:text-amber-300">
          {result.warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

function OlderExtractorPanel({
  tickets,
  currentVersion,
  busy,
  onReExtractOne,
  onReExtractAll,
}: {
  tickets: SavedTicket[];
  currentVersion: string;
  busy: string | null;
  onReExtractOne: (id: string) => void;
  onReExtractAll: () => void;
}) {
  if (tickets.length === 0) {
    return (
      <section className="card space-y-1 text-sm">
        <h2 className="text-base font-semibold">Older Extractor Tickets</h2>
        <div className="text-xs text-slate-500">
          Every saved ticket was extracted with the current analyzer (
          <code>{currentVersion}</code>).
        </div>
      </section>
    );
  }
  return (
    <section className="card space-y-2 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">
            Older Extractor Tickets ({tickets.length})
          </h2>
          <div className="text-xs text-slate-500">
            Current extractor: <code>{currentVersion}</code>. Re-running
            preserves the raw transcript + audio attachment; only derived
            fields update.
          </div>
        </div>
        <button
          className="btn-primary text-xs"
          disabled={!!busy}
          onClick={onReExtractAll}
        >
          Re-extract All
        </button>
      </div>
      <ul className="divide-y divide-slate-200 dark:divide-slate-700">
        {tickets.slice(0, 50).map((t) => {
          const key = `re-extract:${t.id}`;
          const myBusy = busy === key;
          const subj =
            t.ticketFields?.subject?.trim() ||
            t.details?.issue?.trim() ||
            `Ticket ${t.id.slice(0, 8)}`;
          return (
            <li
              key={t.id}
              className="flex flex-wrap items-center justify-between gap-2 py-2 text-xs"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{subj}</div>
                <div className="font-mono text-xs text-slate-500">
                  {t.id.slice(0, 8)} · v=
                  {t.extractionSourceVersion || "(none)"}
                </div>
              </div>
              <div className="flex gap-1">
                <Link
                  to="/history"
                  className="btn-ghost text-xs"
                  state={{ ticketId: t.id }}
                >
                  View
                </Link>
                <button
                  className="btn-ghost text-xs"
                  disabled={!!busy}
                  onClick={() => onReExtractOne(t.id)}
                >
                  {myBusy ? "…" : "Re-extract"}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      {tickets.length > 50 && (
        <div className="text-xs text-slate-500">
          Showing the first 50. Use Re-extract All to process all{" "}
          {tickets.length}.
        </div>
      )}
    </section>
  );
}

function pickFileTextFromBrowser(): Promise<string> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) {
        reject(new Error("No file selected."));
        return;
      }
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.onerror = () => reject(new Error("Could not read file."));
      reader.readAsText(file);
    };
    input.click();
  });
}
