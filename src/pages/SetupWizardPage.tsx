/**
 * Phase 13 — first-run setup wizard.
 *
 * One vertical page with all nine steps as collapsible cards rather than a
 * one-at-a-time wizard. Two reasons:
 *   1. Lets the user see the whole scope before they start, instead of
 *      feeling locked into a black-box flow.
 *   2. Lets them complete steps out of order — eg. configure whisper while
 *      Ollama downloads in another tab.
 *
 * Each card has Skip / Complete actions. Skipping is a real state — System
 * Health surfaces skipped steps so the user has a path back.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAppStore } from "../services/appStore";
import {
  getSetupState,
  markStep,
  markWizardCompleted,
  skipWizard,
  SETUP_STEP_LABELS,
  type SetupStepId,
  type StepStatus,
} from "../services/setupState";
import { AudioRecorder } from "../services/audioRecorder";
import { testWhisper } from "../services/whisperService";
import { runAllSelfTests } from "../services/extractionSelfTests";
import {
  buildFullBackup,
  serializeBackup,
  backupFilename,
  markBackupCreatedNow,
} from "../services/backupService";
import {
  getAppPaths,
  isTauriDesktop,
  writeTextFile,
} from "../services/systemStorage";
import { logError } from "../services/errorLog";

type StepState = StepStatus | "pending" | "running";

interface StepRowProps {
  id: SetupStepId;
  title: string;
  description: string;
  state: StepState;
  message?: string;
  onComplete?: () => void | Promise<void>;
  onSkip: () => void;
  primaryLabel?: string;
}

function statusBadge(state: StepState) {
  const map: Record<StepState, { label: string; classes: string }> = {
    completed: {
      label: "Done",
      classes:
        "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200",
    },
    skipped: {
      label: "Skipped",
      classes:
        "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200",
    },
    pending: {
      label: "Not done",
      classes:
        "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
    },
    running: {
      label: "Running…",
      classes:
        "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-200",
    },
  };
  const m = map[state];
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${m.classes}`}>
      {m.label}
    </span>
  );
}

function StepRow({
  title,
  description,
  state,
  message,
  onComplete,
  onSkip,
  primaryLabel,
}: StepRowProps) {
  return (
    <li className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">{title}</span>
            {statusBadge(state)}
          </div>
          <p className="mt-0.5 text-xs text-slate-500">{description}</p>
          {message && (
            <p className="mt-1 text-xs text-slate-700 dark:text-slate-300">
              {message}
            </p>
          )}
        </div>
        <div className="flex flex-none gap-1">
          {onComplete && state !== "completed" && state !== "running" && (
            <button
              type="button"
              className="btn-primary text-xs"
              onClick={() => void onComplete()}
            >
              {primaryLabel ?? "Complete"}
            </button>
          )}
          {state !== "completed" && state !== "skipped" && (
            <button
              type="button"
              className="btn-ghost text-xs"
              onClick={onSkip}
            >
              Skip
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

export function SetupWizardPage() {
  const navigate = useNavigate();
  const settings = useAppStore((s) => s.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const initial = useMemo(() => getSetupState(), []);
  const [steps, setSteps] = useState<Partial<Record<SetupStepId, StepState>>>(
    () => initial.steps,
  );
  const [messages, setMessages] = useState<Partial<Record<SetupStepId, string>>>({});

  function setStep(id: SetupStepId, state: StepState, message?: string) {
    setSteps((prev) => ({ ...prev, [id]: state }));
    if (message !== undefined) setMessages((prev) => ({ ...prev, [id]: message }));
    if (state === "completed" || state === "skipped") {
      markStep(id, state);
    }
  }

  const getState = useCallback(
    (id: SetupStepId): StepState => (steps[id] ?? "pending"),
    [steps],
  );

  // Step: data folder — read-only, just shows where it is and asks the user
  // to confirm. Defaults to the OS app-data folder.
  const completeDataFolder = useCallback(async () => {
    if (!isTauriDesktop()) {
      setStep(
        "data-folder",
        "completed",
        "Browser preview — using in-memory + localStorage. No on-disk data folder needed.",
      );
      return;
    }
    try {
      const p = await getAppPaths();
      setStep(
        "data-folder",
        "completed",
        `Using OS default: ${p.appData}`,
      );
    } catch (e) {
      setStep("data-folder", "skipped", (e as Error).message);
    }
  }, []);

  const completeAudioFolder = useCallback(async () => {
    if (!isTauriDesktop()) {
      setStep("audio-folder", "completed", "Browser preview — audio is in-memory only.");
      return;
    }
    try {
      const p = await getAppPaths();
      setStep("audio-folder", "completed", `Audio folder: ${p.audio}`);
    } catch (e) {
      setStep("audio-folder", "skipped", (e as Error).message);
    }
  }, []);

  const completeWhisperExec = useCallback(() => {
    if (settings.whisperExecutablePath) {
      setStep(
        "whisper-exec",
        "completed",
        `Whisper executable: ${settings.whisperExecutablePath}`,
      );
    } else {
      setStep(
        "whisper-exec",
        "pending",
        "Open Settings → Local Transcription to set the path, then return here.",
      );
    }
  }, [settings.whisperExecutablePath]);

  const completeWhisperModel = useCallback(() => {
    if (settings.whisperModelPath) {
      setStep(
        "whisper-model",
        "completed",
        `Whisper model: ${settings.whisperModelPath}`,
      );
    } else {
      setStep(
        "whisper-model",
        "pending",
        "Open Settings → Local Transcription to set the path, then return here.",
      );
    }
  }, [settings.whisperModelPath]);

  const completeAiProvider = useCallback(() => {
    const label =
      settings.aiProvider === "ollama"
        ? `Ollama (${settings.ollamaModel})`
        : settings.aiProvider === "lmstudio"
          ? "LM Studio"
          : "Rule-based (no AI)";
    setStep("ai-provider", "completed", `Selected: ${label}`);
  }, [settings.aiProvider, settings.ollamaModel]);

  const completeMicrophone = useCallback(async () => {
    setStep("microphone", "running");
    if (!AudioRecorder.isAvailable()) {
      setStep(
        "microphone",
        "skipped",
        "Microphone access is not exposed in this environment.",
      );
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      setStep("microphone", "completed", "Microphone access granted.");
    } catch (e) {
      setStep(
        "microphone",
        "skipped",
        `Microphone permission denied or unavailable: ${(e as Error).message}`,
      );
    }
  }, []);

  const completeTranscription = useCallback(async () => {
    setStep("transcription", "running");
    if (!settings.whisperExecutablePath || !settings.whisperModelPath) {
      setStep(
        "transcription",
        "skipped",
        "Whisper paths not set. Finish whisper steps first.",
      );
      return;
    }
    try {
      const r = await testWhisper({
        whisperPath: settings.whisperExecutablePath,
        modelPath: settings.whisperModelPath,
      });
      if (r.ok) {
        setStep("transcription", "completed", r.message);
      } else {
        setStep("transcription", "skipped", r.message);
      }
    } catch (e) {
      setStep("transcription", "skipped", (e as Error).message);
    }
  }, [settings.whisperExecutablePath, settings.whisperModelPath]);

  const completeSelfTests = useCallback(() => {
    setStep("self-tests", "running");
    setTimeout(() => {
      try {
        const r = runAllSelfTests();
        if (r.failedTests === 0) {
          setStep(
            "self-tests",
            "completed",
            `${r.passedTests}/${r.totalTests} canonical transcripts passed.`,
          );
        } else {
          setStep(
            "self-tests",
            "skipped",
            `${r.passedTests}/${r.totalTests} passed — ${r.failedTests} failing tests need review.`,
          );
        }
      } catch (e) {
        setStep("self-tests", "skipped", (e as Error).message);
      }
    }, 0);
  }, []);

  const completeFirstBackup = useCallback(async () => {
    setStep("first-backup", "running");
    try {
      const backup = buildFullBackup();
      const body = serializeBackup(backup);
      const filename = backupFilename("store-ticket-assistant.full");
      if (isTauriDesktop()) {
        const { save } = await import("@tauri-apps/plugin-dialog");
        const dest = await save({ defaultPath: filename });
        if (!dest) {
          setStep("first-backup", "pending", "Backup save canceled.");
          return;
        }
        await writeTextFile(dest, body, true);
        markBackupCreatedNow();
        setStep("first-backup", "completed", `Backup saved to ${dest}`);
      } else {
        const blob = new Blob([body], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1_000);
        markBackupCreatedNow();
        setStep("first-backup", "completed", "Backup downloaded.");
      }
    } catch (e) {
      const msg = (e as Error).message;
      logError({ source: "backup", op: "setup-first-backup", message: msg });
      setStep("first-backup", "skipped", msg);
    }
  }, []);

  // Initial sync — when the wizard loads, mirror current settings into the
  // step state so we don't re-ask the user about things they already set.
  useEffect(() => {
    if (settings.whisperExecutablePath && getState("whisper-exec") === "pending") {
      setSteps((prev) => ({ ...prev, "whisper-exec": "completed" }));
    }
    if (settings.whisperModelPath && getState("whisper-model") === "pending") {
      setSteps((prev) => ({ ...prev, "whisper-model": "completed" }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const allTouched = useMemo(() => {
    const ids = Object.keys(SETUP_STEP_LABELS) as SetupStepId[];
    return ids.every((id) => {
      const s = steps[id];
      return s === "completed" || s === "skipped";
    });
  }, [steps]);

  const completedCount = useMemo(() => {
    return Object.values(steps).filter((s) => s === "completed").length;
  }, [steps]);

  function finish() {
    markWizardCompleted();
    navigate("/");
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <header>
        <h1 className="page-title">First-time setup</h1>
        <p className="page-subtitle">
          Walk through the items below to get the app ready for daily use.
          You can skip any step — System Health will surface what's pending.
        </p>
      </header>

      <section className="card space-y-1 text-sm">
        <div className="font-medium">
          Progress: {completedCount} / {Object.keys(SETUP_STEP_LABELS).length} completed
        </div>
        <div className="h-1.5 w-full rounded-full bg-slate-100 dark:bg-slate-800">
          <div
            className="h-1.5 rounded-full bg-emerald-500 transition-all"
            style={{
              width: `${(completedCount / Object.keys(SETUP_STEP_LABELS).length) * 100}%`,
            }}
          />
        </div>
      </section>

      <ol className="space-y-2">
        <StepRow
          id="data-folder"
          title={SETUP_STEP_LABELS["data-folder"]}
          description="Where tickets, audio metadata, and settings live on disk."
          state={getState("data-folder")}
          message={messages["data-folder"]}
          onComplete={completeDataFolder}
          onSkip={() => setStep("data-folder", "skipped")}
          primaryLabel="Use default"
        />
        <StepRow
          id="audio-folder"
          title={SETUP_STEP_LABELS["audio-folder"]}
          description="Subfolder of the data folder where recorded WAV files are written."
          state={getState("audio-folder")}
          message={messages["audio-folder"]}
          onComplete={completeAudioFolder}
          onSkip={() => setStep("audio-folder", "skipped")}
          primaryLabel="Confirm"
        />
        <StepRow
          id="whisper-exec"
          title={SETUP_STEP_LABELS["whisper-exec"]}
          description="Path to the whisper.cpp executable (whisper-cli on macOS, main.exe on Windows)."
          state={getState("whisper-exec")}
          message={messages["whisper-exec"]}
          onComplete={completeWhisperExec}
          onSkip={() => setStep("whisper-exec", "skipped")}
          primaryLabel={settings.whisperExecutablePath ? "Confirm" : "Check"}
        />
        <StepRow
          id="whisper-model"
          title={SETUP_STEP_LABELS["whisper-model"]}
          description="Path to the ggml model (e.g. ggml-base.en.bin)."
          state={getState("whisper-model")}
          message={messages["whisper-model"]}
          onComplete={completeWhisperModel}
          onSkip={() => setStep("whisper-model", "skipped")}
          primaryLabel={settings.whisperModelPath ? "Confirm" : "Check"}
        />
        <StepRow
          id="ai-provider"
          title={SETUP_STEP_LABELS["ai-provider"]}
          description="Rule-based works without any AI. Ollama and LM Studio are optional upgrades."
          state={getState("ai-provider")}
          message={messages["ai-provider"]}
          onComplete={completeAiProvider}
          onSkip={() => setStep("ai-provider", "skipped")}
          primaryLabel="Confirm"
        />
        <StepRow
          id="microphone"
          title={SETUP_STEP_LABELS.microphone}
          description="Requests microphone access and stops the stream immediately."
          state={getState("microphone")}
          message={messages.microphone}
          onComplete={completeMicrophone}
          onSkip={() => setStep("microphone", "skipped")}
          primaryLabel="Test microphone"
        />
        <StepRow
          id="transcription"
          title={SETUP_STEP_LABELS.transcription}
          description="Probes whisper.cpp end-to-end with the configured paths."
          state={getState("transcription")}
          message={messages.transcription}
          onComplete={completeTranscription}
          onSkip={() => setStep("transcription", "skipped")}
          primaryLabel="Run probe"
        />
        <StepRow
          id="self-tests"
          title={SETUP_STEP_LABELS["self-tests"]}
          description="Runs the canonical transcripts through the analyzer and ticket builder."
          state={getState("self-tests")}
          message={messages["self-tests"]}
          onComplete={completeSelfTests}
          onSkip={() => setStep("self-tests", "skipped")}
          primaryLabel="Run tests"
        />
        <StepRow
          id="first-backup"
          title={SETUP_STEP_LABELS["first-backup"]}
          description="Writes a JSON backup so you can recover if SQLite gets corrupted."
          state={getState("first-backup")}
          message={messages["first-backup"]}
          onComplete={completeFirstBackup}
          onSkip={() => setStep("first-backup", "skipped")}
          primaryLabel="Export backup"
        />
      </ol>

      <section className="card space-y-2 text-sm">
        <p className="text-slate-700 dark:text-slate-300">
          {allTouched
            ? "Everything is either done or explicitly skipped. You can finish setup now."
            : "You can finish setup at any time. Skipped items will appear in System Health so you have a path back."}
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-primary" onClick={finish}>
            Finish setup
          </button>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => {
              skipWizard();
              navigate("/");
            }}
          >
            Skip for now
          </button>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => void updateSettings({})}
            title="Re-read current settings to pick up changes made in another tab/Settings page."
          >
            Refresh
          </button>
        </div>
      </section>
    </div>
  );
}
