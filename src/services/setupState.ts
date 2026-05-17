/**
 * Phase 13 — first-run setup state.
 *
 * Tracks whether the wizard has been completed and which individual steps
 * the user skipped. Persisted to localStorage so the redirect-to-setup
 * decision survives reloads.
 *
 * Step semantics:
 *   • "completed"  → the user did this step.
 *   • "skipped"    → the user clicked Skip on this step.
 *   • absent        → not yet seen.
 *
 * Done = all steps either completed or skipped (i.e. the user reached the
 * end of the wizard at least once). Skipped items remain visible in System
 * Health so the user has a reminder to come back to them.
 */

export type SetupStepId =
  | "data-folder"
  | "audio-folder"
  | "whisper-exec"
  | "whisper-model"
  | "ai-provider"
  | "microphone"
  | "transcription"
  | "self-tests"
  | "first-backup";

export type StepStatus = "completed" | "skipped";

export interface SetupState {
  /** True once the user has reached the end of the wizard. */
  wizardCompleted: boolean;
  /** When the wizard was finished (ISO). null if never finished. */
  finishedAt: string | null;
  /** Per-step status keyed by step id. Missing entries = not seen. */
  steps: Partial<Record<SetupStepId, StepStatus>>;
}

const LS_KEY = "sta.setup.v1";

const EMPTY: SetupState = {
  wizardCompleted: false,
  finishedAt: null,
  steps: {},
};

function read(): SetupState {
  if (typeof localStorage === "undefined") return { ...EMPTY };
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return { ...EMPTY };
    const parsed = JSON.parse(raw) as Partial<SetupState>;
    return {
      wizardCompleted: !!parsed.wizardCompleted,
      finishedAt: typeof parsed.finishedAt === "string" ? parsed.finishedAt : null,
      steps: parsed.steps && typeof parsed.steps === "object" ? parsed.steps : {},
    };
  } catch {
    return { ...EMPTY };
  }
}

function write(state: SetupState): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(state));
  } catch {
    // best-effort — losing setup progress is recoverable
  }
}

export function getSetupState(): SetupState {
  return read();
}

export function isSetupCompleted(): boolean {
  return read().wizardCompleted;
}

export function markStep(id: SetupStepId, status: StepStatus): void {
  const state = read();
  state.steps[id] = status;
  write(state);
}

export function markWizardCompleted(): void {
  const state = read();
  state.wizardCompleted = true;
  state.finishedAt = new Date().toISOString();
  write(state);
}

/**
 * Skip the wizard entirely — used by the "Skip for now" button on step 1.
 * Marks the wizard completed (so the redirect doesn't fire again) but
 * leaves every step blank so System Health can flag them as "skipped".
 */
export function skipWizard(): void {
  markWizardCompleted();
}

export function resetSetupState(): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(LS_KEY);
  } catch {
    // ignore
  }
}

/**
 * IDs the user has explicitly skipped (so System Health can surface them
 * with "Resume setup" links). Steps that are completed OR not-yet-seen are
 * excluded — we only care about deliberate skips.
 */
export function getSkippedSteps(): SetupStepId[] {
  const state = read();
  return (Object.entries(state.steps) as [SetupStepId, StepStatus][])
    .filter(([, status]) => status === "skipped")
    .map(([id]) => id);
}

export const SETUP_STEP_LABELS: Record<SetupStepId, string> = {
  "data-folder": "Choose data folder",
  "audio-folder": "Confirm audio folder",
  "whisper-exec": "Configure whisper.cpp executable",
  "whisper-model": "Configure whisper.cpp model",
  "ai-provider": "Choose AI provider",
  microphone: "Test microphone",
  transcription: "Test transcription",
  "self-tests": "Run self-tests",
  "first-backup": "Create first backup",
};
