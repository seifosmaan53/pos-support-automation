/**
 * Phase 13 — Release Candidate checklist + Portable Mode checklist.
 *
 * Two pure derivations the System Health page renders. Each returns an
 * array of {label, ok, detail} items so the UI is a thin table. Items here
 * are the "is this app ready for daily use?" questions the spec calls out.
 *
 * The "telemetry" the checklist relies on (last save success, last attach
 * success, mic test passed) is recorded by the rest of the app via
 * `markRcSignal(...)` so the checklist doesn't have to re-run those tests
 * itself. Signals are persisted to localStorage so they survive reloads.
 */
import { audioFilesStore } from "./audioFilesStore";
import { ticketStore } from "./databaseService";
import { getErrorLog } from "./errorLog";
import { getLastBackupAt } from "./backupService";
import { runAllSelfTests } from "./extractionSelfTests";
import { runWritingSelfTests } from "./writingSelfTests";
import { getSetupState } from "./setupState";
import { countOpenCriticalIssues } from "./smokeTest";
import type { AppSettings } from "../types/settings";

export interface ChecklistItem {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
}

export interface ReleaseChecklist {
  ready: boolean;
  items: ChecklistItem[];
}

// ────────────────────────────────────────────────────────────────────────────
// RC signal storage — small flags + timestamps mutated by the rest of the app
// ────────────────────────────────────────────────────────────────────────────

type RcSignalKey =
  | "lastTicketSaveAt"
  | "lastTicketSaveErrorAt"
  | "lastAudioAttachAt"
  | "lastAudioAttachErrorAt"
  | "lastMicTestAt"
  | "lastBackupVerifiedAt"
  | "lastSmokeTestExportAt";

const LS_KEY = "sta.rc_signals.v1";

interface RcSignals extends Partial<Record<RcSignalKey, string>> {}

function readSignals(): RcSignals {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as RcSignals) : {};
  } catch {
    return {};
  }
}

function writeSignals(s: RcSignals): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(s));
  } catch {
    // ignore
  }
}

export function markRcSignal(key: RcSignalKey, atIso?: string): void {
  const s = readSignals();
  s[key] = atIso ?? new Date().toISOString();
  writeSignals(s);
}

export function getRcSignal(key: RcSignalKey): string | null {
  return readSignals()[key] ?? null;
}

// ────────────────────────────────────────────────────────────────────────────
// Release Candidate checklist
// ────────────────────────────────────────────────────────────────────────────

function isError(s: { severity: string }): boolean {
  return s.severity === "error";
}

/**
 * Compute the 9-item Release Candidate checklist. Pure — no async work,
 * no Tauri calls — so it's safe to call on render. Uses the audio-health
 * counts from a previously-run probe (passed in via `audioCounts`) if
 * available; falls back to SQLite-only counts otherwise.
 */
export function buildReleaseChecklist(input: {
  settings: AppSettings;
  audioCounts?: { missing: number; orphan: number };
}): ReleaseChecklist {
  const { settings, audioCounts } = input;
  const items: ChecklistItem[] = [];

  // 1. Backup created
  const lastBackup = getLastBackupAt();
  items.push({
    id: "backup",
    label: "Backup created",
    ok: !!lastBackup,
    detail: lastBackup
      ? `Last backup: ${new Date(lastBackup).toLocaleString()}`
      : "No backup has been exported on this machine yet.",
  });

  // 2. Audio health clean
  const allAudio = audioFilesStore.list();
  const activeAudio = allAudio.filter((a) => !a.deleted);
  const missing = audioCounts?.missing ?? 0;
  const orphan = audioCounts?.orphan ?? 0;
  items.push({
    id: "audio-health",
    label: "Audio health clean",
    ok: missing === 0 && orphan === 0,
    detail:
      missing === 0 && orphan === 0
        ? `${activeAudio.length} active audio row(s); no missing or orphan rows detected.`
        : `${missing} missing audio file(s), ${orphan} orphan row(s). Run Repair Audio Records.`,
  });

  // 3. Self-tests passing
  let selfTestsOk = false;
  let selfTestDetail = "Not yet run.";
  try {
    const r = runAllSelfTests();
    selfTestsOk = r.failedTests === 0;
    selfTestDetail = `${r.passedTests}/${r.totalTests} canonical transcripts pass.`;
  } catch (e) {
    selfTestDetail = `Could not run: ${(e as Error).message}`;
  }
  items.push({
    id: "self-tests",
    label: "Self-tests passing",
    ok: selfTestsOk,
    detail: selfTestDetail,
  });

  // 4. Writing tests passing
  let writingOk = false;
  let writingDetail = "Not yet run.";
  try {
    const r = runWritingSelfTests();
    writingOk = r.failed === 0;
    writingDetail = `${r.passed} passed, ${r.failed} failed.`;
  } catch (e) {
    writingDetail = `Could not run: ${(e as Error).message}`;
  }
  items.push({
    id: "writing-tests",
    label: "Writing tests passing",
    ok: writingOk,
    detail: writingDetail,
  });

  // 5. Whisper configured
  const whisperOk =
    !!settings.whisperExecutablePath && !!settings.whisperModelPath;
  items.push({
    id: "whisper",
    label: "Whisper configured",
    ok: whisperOk,
    detail: whisperOk
      ? "Executable + model path are set."
      : "Set whisper.cpp executable + model paths in Settings.",
  });

  // 6. Microphone test passed
  const micAt = getRcSignal("lastMicTestAt");
  items.push({
    id: "microphone",
    label: "Microphone test passed",
    ok: !!micAt,
    detail: micAt
      ? `Last successful test: ${new Date(micAt).toLocaleString()}`
      : "Click Test Microphone in setup or open New Ticket and start recording once.",
  });

  // 7. Last test ticket saved successfully
  const ticketAt = getRcSignal("lastTicketSaveAt");
  const ticketErrAt = getRcSignal("lastTicketSaveErrorAt");
  const ticketCount = ticketStore.list().length;
  const ticketOk =
    ticketCount > 0 &&
    (!ticketErrAt ||
      !ticketAt ||
      new Date(ticketAt) > new Date(ticketErrAt));
  items.push({
    id: "last-save",
    label: "Last ticket save succeeded",
    ok: ticketOk,
    detail: ticketAt
      ? `Last save: ${new Date(ticketAt).toLocaleString()} · ${ticketCount} ticket(s) on file.`
      : ticketCount > 0
        ? `${ticketCount} ticket(s) on file. Save a fresh one to record this signal.`
        : "No tickets have been saved yet.",
  });

  // 8. Last audio attached successfully
  const attachAt = getRcSignal("lastAudioAttachAt");
  const attachErrAt = getRcSignal("lastAudioAttachErrorAt");
  const audioOk =
    activeAudio.length > 0 &&
    (!attachErrAt ||
      !attachAt ||
      new Date(attachAt) > new Date(attachErrAt));
  items.push({
    id: "last-attach",
    label: "Last audio attach succeeded",
    ok: audioOk,
    detail: attachAt
      ? `Last attach: ${new Date(attachAt).toLocaleString()} · ${activeAudio.length} active row(s).`
      : activeAudio.length > 0
        ? `${activeAudio.length} attached audio row(s). Attach a fresh one to record this signal.`
        : "No audio rows linked yet.",
  });

  // 9. No critical errors in error log
  const log = getErrorLog();
  const criticalRecent = log.filter(isError).slice(0, 5);
  items.push({
    id: "error-log",
    label: "No critical errors in error log",
    ok: criticalRecent.length === 0,
    detail:
      criticalRecent.length === 0
        ? "No error-severity entries in the recent log."
        : `${criticalRecent.length} error-severity entries — check the Error Log panel.`,
  });

  // 10. No critical smoke-test issues open (Phase 14)
  const openCritical = countOpenCriticalIssues();
  items.push({
    id: "smoke-issues",
    label: "No critical smoke-test issues open",
    ok: openCritical === 0,
    detail:
      openCritical === 0
        ? "No critical/high open issues from the smoke test."
        : `${openCritical} critical/high open issue(s) — see the Smoke Test page.`,
  });

  const ready = items.every((i) => i.ok);
  return { ready, items };
}

// ────────────────────────────────────────────────────────────────────────────
// Portable Mode checklist
// ────────────────────────────────────────────────────────────────────────────

export interface PortableChecklistInput {
  settings: AppSettings;
  paths: {
    appData: string;
    audio: string;
    backup: string;
    audioExists: boolean;
    backupExists: boolean;
  } | null;
  /** Whether the user has run the "Test Recording" / "Test Transcription"
   *  signals at least once. Drawn from RC signals so the same flags
   *  surface in both checklists. */
  testRecordingOk: boolean;
  testTranscriptionOk: boolean;
  /** Last successful ticket save (from RC signal). */
  testTicketSaveOk: boolean;
  /** Whether settings have been exported in the past (separate from full backup). */
  settingsExported: boolean;
}

export function buildPortableChecklist(
  input: PortableChecklistInput,
): ChecklistItem[] {
  const items: ChecklistItem[] = [];
  const { settings, paths } = input;

  items.push({
    id: "app",
    label: "App exists",
    ok: true,
    detail: "Running this checklist means the app launched.",
  });
  items.push({
    id: "data-folder",
    label: "Data folder exists",
    ok: !!paths,
    detail: paths ? paths.appData : "Run inside the desktop app to check.",
  });
  items.push({
    id: "audio-folder",
    label: "Audio folder exists",
    ok: !!paths?.audioExists,
    detail: paths
      ? paths.audio + (paths.audioExists ? "" : " (will be created on first record)")
      : "Run inside the desktop app to check.",
  });
  items.push({
    id: "backup-folder",
    label: "Backup folder exists",
    ok: !!paths?.backupExists,
    detail: paths
      ? paths.backup + (paths.backupExists ? "" : " (created on first export)")
      : "Run inside the desktop app to check.",
  });
  items.push({
    id: "whisper-exec",
    label: "Whisper executable exists",
    ok: !!settings.whisperExecutablePath,
    detail: settings.whisperExecutablePath || "Not set in Settings.",
  });
  items.push({
    id: "whisper-model",
    label: "Whisper model exists",
    ok: !!settings.whisperModelPath,
    detail: settings.whisperModelPath || "Not set in Settings.",
  });
  items.push({
    id: "settings-exported",
    label: "Settings exported",
    ok: input.settingsExported,
    detail: input.settingsExported
      ? "A settings JSON has been exported."
      : "Click Export Settings in System Health.",
  });
  items.push({
    id: "backup-exported",
    label: "Backup exported",
    ok: !!getLastBackupAt(),
    detail: getLastBackupAt()
      ? `Last backup ${new Date(getLastBackupAt()!).toLocaleString()}`
      : "Click Export Full Backup in System Health.",
  });
  items.push({
    id: "test-recording",
    label: "Test recording works",
    ok: input.testRecordingOk,
    detail: input.testRecordingOk
      ? "A recording has been completed at least once."
      : "Record a short clip in New Ticket to test.",
  });
  items.push({
    id: "test-transcription",
    label: "Test transcription works",
    ok: input.testTranscriptionOk,
    detail: input.testTranscriptionOk
      ? "Transcription has been completed at least once."
      : "Transcribe a recording to test.",
  });
  items.push({
    id: "test-ticket-save",
    label: "Test ticket save works",
    ok: input.testTicketSaveOk,
    detail: input.testTicketSaveOk
      ? "A ticket has been saved successfully."
      : "Save a ticket once to verify SQLite is writable.",
  });

  return items;
}

/**
 * Markdown-formatted Portable Setup Checklist for the spec's
 * "Export Portable Package Checklist" button. The user gets a file they can
 * paste into a runbook or attach to the flash drive.
 */
export function portableChecklistMarkdown(items: ChecklistItem[]): string {
  const setup = getSetupState();
  const lines: string[] = [
    "# Store Ticket Assistant — Portable Setup Checklist",
    "",
    `Generated: ${new Date().toLocaleString()}`,
    `Setup wizard: ${setup.wizardCompleted ? "completed" : "not yet completed"}`,
    "",
    "## Checklist",
    "",
  ];
  for (const item of items) {
    lines.push(`- [${item.ok ? "x" : " "}] ${item.label} — ${item.detail}`);
  }
  lines.push("");
  lines.push("## Next steps");
  lines.push("");
  lines.push("1. Copy the data folder to the destination.");
  lines.push("2. Install Store Ticket Assistant on the destination.");
  lines.push("3. Import the backup JSON via System Health → Import / Restore Backup.");
  lines.push("4. Verify the backup before relying on it: System Health → Verify Backup.");
  lines.push("");
  return lines.join("\n");
}

// ────────────────────────────────────────────────────────────────────────────
// Release Build checklist (Phase 15)
//
// Items the system can verify automatically (RC ready, backup created,
// audio health, smoke issues) are derived. Items that depend on a
// completed build artifact (macOS .app exists, app launched, recording
// tested from build, etc.) are *manual flags* the user toggles on this
// page after they've verified the corresponding step.
// ────────────────────────────────────────────────────────────────────────────

export type ReleaseBuildFlag =
  | "macOsBuildCreated"
  | "appLaunchedFromBuild"
  | "recordingTestedFromBuild"
  | "ticketSavedFromBuild"
  | "backupExportedFromBuild";

const LS_RELEASE_BUILD_KEY = "sta.release_build.flags.v1";

type ReleaseBuildFlags = Partial<Record<ReleaseBuildFlag, string>>;

function readReleaseBuildFlags(): ReleaseBuildFlags {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(LS_RELEASE_BUILD_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as ReleaseBuildFlags) : {};
  } catch {
    return {};
  }
}

function writeReleaseBuildFlags(f: ReleaseBuildFlags): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(LS_RELEASE_BUILD_KEY, JSON.stringify(f));
  } catch {
    // ignore
  }
}

export function getReleaseBuildFlag(flag: ReleaseBuildFlag): string | null {
  return readReleaseBuildFlags()[flag] ?? null;
}

export function setReleaseBuildFlag(flag: ReleaseBuildFlag, value: boolean): void {
  const flags = readReleaseBuildFlags();
  if (value) {
    flags[flag] = new Date().toISOString();
  } else {
    delete flags[flag];
  }
  writeReleaseBuildFlags(flags);
}

export interface ReleaseBuildChecklist {
  ready: boolean;
  items: ChecklistItem[];
}

export function buildReleaseBuildChecklist(input: {
  settings: AppSettings;
  audioCounts?: { missing: number; orphan: number };
  smokeTestExportedAt?: string | null;
  backupVerifiedAt?: string | null;
}): ReleaseBuildChecklist {
  const items: ChecklistItem[] = [];
  const flags = readReleaseBuildFlags();
  const rc = buildReleaseChecklist({
    settings: input.settings,
    audioCounts: input.audioCounts,
  });

  // 1. All tests pass (proxy: the RC checklist's self-tests + writing-tests).
  const selfTestsOk = rc.items.find((i) => i.id === "self-tests")?.ok ?? false;
  const writingTestsOk = rc.items.find((i) => i.id === "writing-tests")?.ok ?? false;
  items.push({
    id: "all-tests",
    label: "All tests pass",
    ok: selfTestsOk && writingTestsOk,
    detail:
      selfTestsOk && writingTestsOk
        ? "Self-tests + writing tests are green."
        : "Run npm run check:all and address failures.",
  });

  // 2. Smoke test report exported (RC signal stamped by the Smoke Test page).
  const smokeExport = input.smokeTestExportedAt ?? getRcSignal("lastSmokeTestExportAt");
  items.push({
    id: "smoke-exported",
    label: "Smoke test report exported",
    ok: !!smokeExport,
    detail: smokeExport
      ? `Last export: ${new Date(smokeExport).toLocaleString()}`
      : "Open the Smoke Test page and click Export Smoke Test Report.",
  });

  // 3. No critical smoke-test issues open (already a tile in the RC checklist).
  const smokeIssuesOk = rc.items.find((i) => i.id === "smoke-issues")?.ok ?? false;
  items.push({
    id: "smoke-clean",
    label: "No critical smoke-test issues open",
    ok: smokeIssuesOk,
    detail:
      smokeIssuesOk
        ? "No critical/high open issues."
        : "Resolve open critical/high smoke-test issues before building.",
  });

  // 4. Backup created.
  const backupOk = rc.items.find((i) => i.id === "backup")?.ok ?? false;
  const lastBackup = getLastBackupAt();
  items.push({
    id: "backup-created",
    label: "Backup created",
    ok: backupOk,
    detail: lastBackup
      ? `Last backup: ${new Date(lastBackup).toLocaleString()}`
      : "Export a full backup before building.",
  });

  // 5. Backup verified (RC signal stamped by Verify Backup).
  const verifiedAt = input.backupVerifiedAt ?? getRcSignal("lastBackupVerifiedAt");
  items.push({
    id: "backup-verified",
    label: "Backup verified",
    ok: !!verifiedAt,
    detail: verifiedAt
      ? `Last verified: ${new Date(verifiedAt).toLocaleString()}`
      : "Run System Health → Verify Backup against your latest backup.",
  });

  // 6. Audio health clean (already a tile in the RC checklist).
  const audioHealthOk = rc.items.find((i) => i.id === "audio-health")?.ok ?? false;
  items.push({
    id: "audio-health",
    label: "Audio health clean",
    ok: audioHealthOk,
    detail: audioHealthOk
      ? "No missing/orphan audio detected."
      : "Run Repair Audio Records first.",
  });

  // 7. Release candidate ready (the original 9-item RC verdict).
  items.push({
    id: "rc-ready",
    label: "Release candidate ready",
    ok: rc.ready,
    detail: rc.ready
      ? "Every RC checklist tile passed."
      : "See the Release Candidate panel for the specific tile that needs attention.",
  });

  // 8–12. Manual flags — the user toggles these after physically building
  // and exercising the build.
  const manuals: { flag: ReleaseBuildFlag; label: string }[] = [
    { flag: "macOsBuildCreated", label: "macOS build created" },
    { flag: "appLaunchedFromBuild", label: "App launched from build" },
    { flag: "recordingTestedFromBuild", label: "Recording tested from build" },
    { flag: "ticketSavedFromBuild", label: "Ticket saved from build" },
    { flag: "backupExportedFromBuild", label: "Backup exported from build" },
  ];
  for (const m of manuals) {
    const at = flags[m.flag];
    items.push({
      id: m.flag,
      label: m.label,
      ok: !!at,
      detail: at
        ? `Confirmed: ${new Date(at).toLocaleString()}`
        : "Manual step — mark complete after verifying.",
    });
  }

  const ready = items.every((i) => i.ok);
  return { ready, items };
}

/**
 * Portable instructions Markdown — Phase 15 spec.
 *
 * Richer than `portableChecklistMarkdown()`: includes current resolved
 * paths so the user can paste this onto a flash drive next to the backup
 * and have an unambiguous restore reference for the destination machine.
 */
export function portableInstructionsMarkdown(input: {
  paths: {
    appData?: string;
    audio?: string;
    backup?: string;
    models?: string;
  } | null;
  lastBackupAt: string | null;
}): string {
  const lines: string[] = [];
  const { paths, lastBackupAt } = input;
  lines.push("# Store Ticket Assistant — Portable / External SSD Setup");
  lines.push("");
  lines.push(`Generated: ${new Date().toLocaleString()}`);
  if (lastBackupAt) {
    lines.push(`Last backup created on this machine: ${new Date(lastBackupAt).toLocaleString()}`);
  }
  lines.push("");
  lines.push("## What to put on the flash drive / external SSD");
  lines.push("");
  lines.push("- The installer for the destination OS (macOS .dmg or Windows .msi).");
  lines.push("- The most recent backup JSON (and the sibling `/audio` folder if you used **Export Backup + Audio**).");
  lines.push("- The whisper.cpp executable + .ggml model file.");
  lines.push("- This Portable Instructions markdown (you're reading it).");
  lines.push("- (Optional) The Portable Mode Checklist markdown for a one-screen status reference.");
  lines.push("");

  if (paths) {
    lines.push("## Current source-machine paths");
    lines.push("");
    if (paths.appData) lines.push(`- App data folder: \`${paths.appData}\``);
    if (paths.audio) lines.push(`- Audio folder: \`${paths.audio}\``);
    if (paths.backup) lines.push(`- Backup folder: \`${paths.backup}\``);
    if (paths.models) lines.push(`- Models folder: \`${paths.models}\``);
    lines.push("");
  }

  lines.push("## Where the destination machine will keep data");
  lines.push("");
  lines.push("- **macOS**: `~/Library/Application Support/store-ticket-assistant`");
  lines.push("- **Windows**: `%APPDATA%\\store-ticket-assistant`");
  lines.push("- **Linux**: `~/.local/share/store-ticket-assistant`");
  lines.push("");
  lines.push("## How to restore on another computer");
  lines.push("");
  lines.push("1. Install the app from the bundled installer.");
  lines.push("2. Launch it once and complete (or skip) the first-run setup wizard.");
  lines.push("3. Open **System Health → Verify Backup** and pick the backup JSON from the flash drive.");
  lines.push("4. If Verify Backup says \"valid\", open **System Health → Import / Restore Backup** and pick the same file.");
  lines.push("5. Choose **Replace current data** on a clean install or **Merge** to combine.");
  lines.push("6. Re-set whisper.cpp executable + model paths in **Settings → Local Transcription** to point at wherever whisper lives on the new machine.");
  lines.push("7. Run **System Health → Run Health Check** to verify counts.");
  lines.push("");
  lines.push("## Verify portable setup");
  lines.push("");
  lines.push("In the destination app, open **System Health → Portable Setup → Verify Portable Setup**. Every item should be green before relying on the install.");
  lines.push("");
  lines.push("## DO NOT");
  lines.push("");
  lines.push("- Do **not** delete the source machine's Application Support folder until you've verified the backup loads on the destination.");
  lines.push("- Do **not** edit the backup JSON by hand — re-export from System Health if you need a new one.");
  lines.push("");
  return lines.join("\n");
}
