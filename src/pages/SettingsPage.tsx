import { useState } from "react";
import { useAppStore } from "../services/appStore";
import { DETAIL_LEVELS } from "../types/ticket";
import {
  DEFAULT_SETTINGS,
  DEFAULT_CORRECTION_DICTIONARY,
  DEFAULT_WRITING_STYLE,
  type CorrectionEntry,
  type OpenerStyle,
  type ResolutionStyle,
  type WritingTone,
  type WritingVoice,
} from "../types/settings";
import { WarningBox } from "../components/WarningBox";
import { MigrationPanel } from "../components/MigrationPanel";
import { ticketStore } from "../services/databaseService";
import { pingOllama } from "../services/ollamaService";
import { pingLMStudio } from "../services/lmStudioService";
import { friendlyWhisperError, testWhisper } from "../services/whisperService";
import {
  BUILTIN_FIELD_LABELS,
  DEFAULT_FIELD_MAPPING_SETTINGS,
  type FieldMappingEntry,
} from "../types/copyMode";
import {
  EXTRACTION_KIND_LABELS,
  type ExtractionPattern,
  type ExtractionPatternKind,
} from "../types/extractionPattern";
import { extractionPatternsStore } from "../services/extractionPatternsStore";
import { Icon } from "../components/Icon";
import { useConfirm } from "../components/ConfirmDialog";
import { Spinner } from "../components/Spinner";
import { useAudioInputDevices } from "../components/AudioLevelMeter";
import type { AppSettings, UserMode } from "../types/settings";
import { USER_MODE_RANK } from "../types/settings";

type TestKind = "success" | "warning" | "error";

/**
 * Phase 17B — settings tabs. Tabs gate their visibility by user mode so a
 * Daily user sees only Basic / Audio / Transcription. Advanced reveals AI,
 * Ticket System, Advanced. Developer reveals everything.
 */
type SettingsTab =
  | "basic"
  | "audio"
  | "transcription"
  | "ai"
  | "ticket-system"
  | "advanced"
  | "developer";

const SETTINGS_TABS: { value: SettingsTab; label: string; minMode: UserMode }[] = [
  { value: "basic", label: "Basic", minMode: "daily" },
  { value: "audio", label: "Audio & Microphone", minMode: "daily" },
  { value: "transcription", label: "Transcription", minMode: "daily" },
  { value: "ai", label: "AI Provider", minMode: "advanced" },
  { value: "ticket-system", label: "Ticket Fields", minMode: "advanced" },
  { value: "advanced", label: "Advanced", minMode: "advanced" },
  { value: "developer", label: "Developer", minMode: "developer" },
];

const USER_MODE_OPTIONS: { value: UserMode; label: string; description: string }[] = [
  {
    value: "daily",
    label: "Daily",
    description: "Simple workflow: record, review, copy, save. Recommended for everyday use.",
  },
  {
    value: "advanced",
    label: "Advanced",
    description: "Adds Intelligence, Writing Lab, Templates, Style Examples, and the full workflow chain.",
  },
  {
    value: "developer",
    label: "Developer",
    description: "Adds Smoke Test, Pilot Mode, and other diagnostics. Use for testing and tuning.",
  },
];

export function SettingsPage() {
  const settings = useAppStore((s) => s.settings);
  const update = useAppStore((s) => s.updateSettings);
  const setStatus = useAppStore((s) => s.setStatus);
  const askConfirm = useConfirm();
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ kind: TestKind; message: string } | null>(null);
  const [testingWhisper, setTestingWhisper] = useState(false);
  const [whisperResult, setWhisperResult] = useState<{ kind: TestKind; message: string } | null>(
    null,
  );

  const visibleTabs = SETTINGS_TABS.filter(
    (t) => USER_MODE_RANK[t.minMode] <= USER_MODE_RANK[settings.userMode],
  );
  const [activeTab, setActiveTab] = useState<SettingsTab>("basic");
  // If the user steps down their mode and the current tab disappears,
  // fall back to Basic on the next render.
  const currentTabVisible = visibleTabs.some((t) => t.value === activeTab);
  const renderedTab: SettingsTab = currentTabVisible ? activeTab : "basic";
  const [testingLMStudio, setTestingLMStudio] = useState(false);
  const [lmStudioResult, setLMStudioResult] = useState<{
    kind: TestKind;
    message: string;
  } | null>(null);

  async function testLMStudio() {
    setTestingLMStudio(true);
    setLMStudioResult(null);
    try {
      const r = await pingLMStudio(settings.lmStudioEndpoint, 4000);
      if (!r.ok) {
        setLMStudioResult({
          kind: "error",
          message: r.error ?? "Could not reach LM Studio.",
        });
        setStatus({
          kind: "error",
          message: r.error ?? "LM Studio unreachable.",
        });
        return;
      }
      const message = `Connected in ${r.ms} ms. ${r.models.length} model(s) loaded${
        r.models.length > 0 ? `: ${r.models.slice(0, 3).join(", ")}${r.models.length > 3 ? "…" : ""}` : ""
      }.`;
      setLMStudioResult({ kind: "success", message });
      setStatus({ kind: "success", message });
    } finally {
      setTestingLMStudio(false);
    }
  }

  async function testOllama() {
    setTesting(true);
    setTestResult(null);
    try {
      const r = await pingOllama(settings.ollamaEndpoint, 4000);
      if (!r.ok) {
        setTestResult({ kind: "error", message: r.error ?? "Could not reach Ollama." });
        setStatus({ kind: "error", message: r.error ?? "Ollama unreachable." });
        return;
      }
      const hasModel = r.models.includes(settings.ollamaModel);
      const message = hasModel
        ? `Connected in ${r.ms} ms. Model "${settings.ollamaModel}" is installed. ${r.models.length} model(s) available locally.`
        : `Connected in ${r.ms} ms but model "${settings.ollamaModel}" is not installed. Available: ${r.models.join(", ") || "none"}. Run: ollama pull ${settings.ollamaModel}`;
      const kind = hasModel ? "success" : "warning";
      setTestResult({ kind, message });
      setStatus({ kind, message });
    } finally {
      setTesting(false);
    }
  }

  async function testWhisperPaths() {
    setTestingWhisper(true);
    setWhisperResult(null);
    try {
      const r = await testWhisper({
        whisperPath: settings.whisperExecutablePath,
        modelPath: settings.whisperModelPath,
      });
      const kind: TestKind = r.ok ? "success" : r.executableOk ? "warning" : "error";
      setWhisperResult({ kind, message: r.message });
      setStatus({ kind, message: r.message });
    } catch (e) {
      const message = friendlyWhisperError(e);
      setWhisperResult({ kind: "error", message });
      setStatus({ kind: "error", message });
    } finally {
      setTestingWhisper(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <header>
        <h1 className="page-title">Settings</h1>
        <p className="page-subtitle">
          All settings are stored locally on this machine.
        </p>
      </header>

      <div className="flex flex-wrap gap-1 border-b border-slate-200 pb-1 dark:border-slate-800">
        {visibleTabs.map((tab) => {
          const active = renderedTab === tab.value;
          return (
            <button
              key={tab.value}
              type="button"
              onClick={() => setActiveTab(tab.value)}
              className={`rounded-t-md px-3 py-1.5 text-sm transition-colors ${
                active
                  ? "border-b-2 border-brand-500 bg-brand-50 font-semibold text-brand-900 dark:border-brand-400 dark:bg-brand-900/30 dark:text-brand-100"
                  : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {renderedTab === "basic" && (
      <section className="card space-y-3">
        <h2 className="text-base font-semibold">General</h2>

        <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50/60 p-3 dark:border-slate-700 dark:bg-slate-800/40">
          <div>
            <div className="text-sm font-medium">User Mode</div>
            <p className="text-[12px] text-slate-500 dark:text-slate-400">
              Controls how much of the app you see. Routes for hidden pages still work if you
              type the URL — only the sidebar links change.
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            {USER_MODE_OPTIONS.map((opt) => {
              const active = settings.userMode === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => update({ userMode: opt.value })}
                  className={`rounded-lg border px-3 py-2 text-left text-xs transition-colors ${
                    active
                      ? "border-brand-500 bg-brand-50 text-brand-900 dark:border-brand-400 dark:bg-brand-900/30 dark:text-brand-100"
                      : "border-slate-200 bg-white hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-slate-600"
                  }`}
                >
                  <div className="text-sm font-semibold">{opt.label}</div>
                  <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                    {opt.description}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Technician Name">
            <input
              className="input"
              value={settings.technicianName}
              onChange={(e) => update({ technicianName: e.target.value })}
            />
          </Field>
          <Field label="Default Detail Level">
            <select
              className="input"
              value={settings.defaultDetailLevel}
              onChange={(e) => update({ defaultDetailLevel: e.target.value as never })}
            >
              {DETAIL_LEVELS.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Theme">
            <select
              className="input"
              value={settings.theme}
              onChange={(e) => update({ theme: e.target.value as never })}
            >
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </Field>
          <label className="flex items-center gap-2 pt-6 text-sm">
            <input
              type="checkbox"
              checked={settings.autoSaveOnGenerate}
              onChange={(e) => update({ autoSaveOnGenerate: e.target.checked })}
            />
            Auto-save tickets when generated
          </label>
        </div>
      </section>

      )}

      {renderedTab === "ai" && (
      <section className="card space-y-3">
        <h2 className="text-base font-semibold">AI Provider</h2>
        <p className="text-xs text-slate-500">
          All AI runs locally on this machine. Nothing leaves your computer.
          Pick a provider below — Rule-based requires no setup, Ollama and
          LM Studio need their respective apps running locally.
        </p>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Provider">
            <select
              className="input"
              value={settings.aiProvider}
              onChange={(e) => update({ aiProvider: e.target.value as never })}
            >
              <option value="rule-based">Rule-based (no AI)</option>
              <option value="ollama">Ollama (local AI)</option>
              <option value="lmstudio">LM Studio (OpenAI-compatible local)</option>
            </select>
          </Field>
        </div>
        {settings.aiProvider === "rule-based" && (
          <WarningBox tone="info">
            Rule-based mode — nothing to configure. The app uses its built-in
            pattern-based extractor and never contacts a local LLM. Switch to
            Ollama or LM Studio above to reveal those provider settings.
          </WarningBox>
        )}
        {settings.aiProvider !== "rule-based" && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings.fallbackToRuleBased}
              onChange={(e) => update({ fallbackToRuleBased: e.target.checked })}
            />
            Fall back to rule-based mode if {settings.aiProvider === "ollama" ? "Ollama" : "LM Studio"} fails (recommended)
          </label>
        )}
      </section>
      )}

      {renderedTab === "ai" && settings.aiProvider === "ollama" && (
      <section className="card space-y-3">
        <h2 className="text-base font-semibold">Ollama settings</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Ollama Endpoint">
            <input
              className="input"
              value={settings.ollamaEndpoint}
              onChange={(e) => update({ ollamaEndpoint: e.target.value })}
              placeholder="http://localhost:11434"
            />
          </Field>
          <Field label="Ollama Model">
            <input
              className="input"
              value={settings.ollamaModel}
              onChange={(e) => update({ ollamaModel: e.target.value })}
              placeholder="llama3.1:8b"
            />
          </Field>
          <Field label="Temperature (low = strict)">
            <input
              type="number"
              className="input"
              step="0.1"
              min="0"
              max="2"
              value={settings.temperature}
              onChange={(e) => update({ temperature: Number(e.target.value) })}
            />
          </Field>
          <Field label="Timeout (ms)">
            <input
              type="number"
              className="input"
              step="1000"
              min="1000"
              max="120000"
              value={settings.timeoutMs}
              onChange={(e) => update({ timeoutMs: Number(e.target.value) })}
            />
          </Field>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            className="btn-secondary"
            onClick={testOllama}
            disabled={testing}
            title="Test the connection to Ollama."
          >
            {testing ? (
              <>
                <Spinner className="h-3.5 w-3.5" />
                Testing…
              </>
            ) : (
              "Test Connection"
            )}
          </button>
          <span className="text-xs text-slate-500">
            Pings <code>{settings.ollamaEndpoint}/api/tags</code> and confirms the model is installed.
          </span>
        </div>
        {testResult && (
          <WarningBox
            tone={
              testResult.kind === "success"
                ? "success"
                : testResult.kind === "warning"
                  ? "warning"
                  : "danger"
            }
          >
            {testResult.message}
          </WarningBox>
        )}
      </section>

      )}

      {renderedTab === "ai" && settings.aiProvider === "lmstudio" && (
      <section className="card space-y-3">
        <h2 className="text-base font-semibold">LM Studio</h2>
        <p className="text-xs text-slate-500">
          LM Studio exposes an OpenAI-compatible local API. Default port is
          1234. Same no-hallucination prompts as Ollama; same fallback to
          rule-based when unavailable.
        </p>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="LM Studio Endpoint">
            <input
              className="input"
              value={settings.lmStudioEndpoint}
              onChange={(e) => update({ lmStudioEndpoint: e.target.value })}
              placeholder="http://localhost:1234/v1"
            />
          </Field>
          <Field label="Max Tokens">
            <input
              type="number"
              className="input"
              step="50"
              min="50"
              max="4000"
              value={settings.maxTokens}
              onChange={(e) => update({ maxTokens: Number(e.target.value) })}
            />
          </Field>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            className="btn-secondary"
            onClick={testLMStudio}
            disabled={testingLMStudio}
            title="Test the connection to LM Studio."
          >
            {testingLMStudio ? (
              <>
                <Spinner className="h-3.5 w-3.5" />
                Testing…
              </>
            ) : (
              "Test LM Studio Connection"
            )}
          </button>
          <span className="text-xs text-slate-500">
            Pings <code>{settings.lmStudioEndpoint}/models</code>.
          </span>
        </div>
        {lmStudioResult && (
          <WarningBox
            tone={
              lmStudioResult.kind === "success"
                ? "success"
                : lmStudioResult.kind === "warning"
                  ? "warning"
                  : "danger"
            }
          >
            {lmStudioResult.message}
          </WarningBox>
        )}
      </section>

      )}

      {renderedTab === "transcription" && (
      <section className="card space-y-3">
        <h2 className="text-base font-semibold">Local Transcription (whisper.cpp)</h2>
        <WarningBox tone="info">
          Recording happens in this app and audio is transcribed locally by whisper.cpp. Nothing
          leaves the machine. Manual transcript mode remains available as a fallback.
        </WarningBox>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Mode">
            <select
              className="input"
              value={settings.transcriptionMode}
              onChange={(e) => update({ transcriptionMode: e.target.value as never })}
            >
              <option value="manual">Manual (paste/type)</option>
              <option value="whisper-cpp">whisper.cpp (local)</option>
            </select>
          </Field>
          <Field label="Threads">
            <input
              type="number"
              className="input"
              min="1"
              max="32"
              value={settings.whisperThreads}
              onChange={(e) =>
                update({ whisperThreads: Math.max(1, Number(e.target.value) || 1) })
              }
            />
          </Field>
          <Field label="whisper.cpp executable path">
            <input
              className="input"
              value={settings.whisperExecutablePath}
              onChange={(e) => update({ whisperExecutablePath: e.target.value })}
              placeholder="/path/to/whisper.cpp/build/bin/whisper-cli"
            />
          </Field>
          <Field label="Whisper model path">
            <input
              className="input"
              value={settings.whisperModelPath}
              onChange={(e) => update({ whisperModelPath: e.target.value })}
              placeholder="/path/to/ggml-medium.en.bin"
            />
            <WhisperModelHint path={settings.whisperModelPath} />
          </Field>
          <Field label="Language (e.g. en, auto)">
            <input
              className="input"
              value={settings.whisperLanguage}
              onChange={(e) => update({ whisperLanguage: e.target.value })}
            />
          </Field>
        </div>

        <div className="rounded-lg border border-slate-200/70 bg-slate-50/60 px-3 py-2 text-xs text-slate-600 dark:border-slate-800/70 dark:bg-slate-900/40 dark:text-slate-300">
          <strong className="font-semibold">Model quality:</strong> tiny = fastest / least accurate · base = fast ·
          small = better · medium = more accurate · large = best but slower.
          For US retail support calls, <code>ggml-medium.en.bin</code> is the usual
          sweet spot.
        </div>

        <Field label="Domain prompt (helps whisper.cpp spell brand names)">
          <textarea
            className="input min-h-[64px] font-mono text-[12px]"
            value={settings.whisperPrompt}
            onChange={(e) => update({ whisperPrompt: e.target.value })}
            rows={3}
            placeholder="Empty disables. Whisper.cpp uses --prompt as a vocabulary hint (~224 token cap)."
          />
        </Field>

        <div className="space-y-2 pt-1">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings.saveAudio}
              onChange={(e) => update({ saveAudio: e.target.checked })}
            />
            Save audio recordings permanently to disk
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings.deleteAudioAfterTranscription}
              onChange={(e) => update({ deleteAudioAfterTranscription: e.target.checked })}
            />
            Delete audio after transcription completes
          </label>
          {settings.deleteAudioAfterTranscription && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800/70 dark:bg-amber-950/30 dark:text-amber-200">
              <strong className="font-semibold">Warning:</strong> Turning this on
              may remove recordings needed for later ticket review. Re-transcription
              and the History → Audio playback features will not work for tickets
              recorded while this is on.
            </div>
          )}
          <p className="text-xs text-slate-500">
            With both off, audio is saved until you delete it manually. With "Save audio" off, the
            WAV is removed automatically as soon as whisper.cpp finishes — privacy-first default.
            For the History → Audio + Re-transcribe workflow, turn "Save audio" on and
            "Delete audio after transcription" off.
          </p>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings.saveTranscriptWithAudio}
              onChange={(e) => update({ saveTranscriptWithAudio: e.target.checked })}
            />
            Save transcript with audio (keeps the original transcript next to the file)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings.saveSpeakerLabeledTranscript}
              onChange={(e) => update({ saveSpeakerLabeledTranscript: e.target.checked })}
            />
            Save speaker-labeled transcript with the ticket
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            className="btn-secondary"
            onClick={testWhisperPaths}
            disabled={
              testingWhisper ||
              !settings.whisperExecutablePath.trim() ||
              !settings.whisperModelPath.trim()
            }
            title={
              !settings.whisperExecutablePath.trim() || !settings.whisperModelPath.trim()
                ? "Choose a whisper executable and model file first."
                : "Test that whisper.cpp runs and the model file is readable."
            }
          >
            {testingWhisper ? (
              <>
                <Spinner className="h-3.5 w-3.5" />
                Testing…
              </>
            ) : (
              "Test Whisper"
            )}
          </button>
          <span className="text-xs text-slate-500">
            Runs <code>--help</code> on the executable and checks the model file exists.
          </span>
        </div>
        {whisperResult && (
          <WarningBox
            tone={
              whisperResult.kind === "success"
                ? "success"
                : whisperResult.kind === "warning"
                  ? "warning"
                  : "danger"
            }
          >
            {whisperResult.message}
          </WarningBox>
        )}
      </section>

      )}

      {renderedTab === "audio" && (
      <AudioInputSection
        settings={settings}
        update={update}
      />
      )}

      {renderedTab === "transcription" && (
      <section className="card space-y-3">
        <h2 className="text-base font-semibold">Live Assist (Phase 11A)</h2>
        <p className="text-xs text-slate-500">
          During recording the app rolls the microphone into short audio
          chunks, transcribes each chunk with whisper.cpp, and shows a live
          transcript with speaker role labels. The final transcript runs on
          the full saved recording after Stop — it is the source of truth.
          Live preview can lag the call by 10–15 seconds because of
          whisper.cpp's fixed per-invocation overhead.
        </p>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Chunk size">
            <select
              className="input"
              value={String(settings.liveAssist.chunkSizeSec)}
              onChange={(e) => {
                const v = e.target.value;
                const next =
                  v === "manual" ? "manual" : (Number(v) as 5 | 10 | 15);
                update({
                  liveAssist: { ...settings.liveAssist, chunkSizeSec: next },
                });
              }}
            >
              <option value="5">5 seconds — fastest, less accurate</option>
              <option value="10">10 seconds — recommended</option>
              <option value="15">15 seconds — most accurate, slower</option>
              <option value="manual">Manual only — final pass after Stop</option>
            </select>
          </Field>
        </div>
        {settings.liveAssist.chunkSizeSec === 5 && (
          <WarningBox tone="warning" title="5-second chunks may hallucinate">
            whisper.cpp was trained on 30-second windows. On 5-second clips it
            occasionally produces phantom text out of silence (e.g. "Thanks
            for watching!"). Use 10 or 15 seconds if you see that.
          </WarningBox>
        )}
        {settings.liveAssist.chunkSizeSec === 15 && (
          <p className="text-xs text-slate-500">
            15-second chunks give the most reliable text but the preview is
            slower to appear.
          </p>
        )}
        {settings.liveAssist.chunkSizeSec === "manual" && (
          <p className="text-xs text-slate-500">
            Live transcription is disabled. The recording is still chunked
            internally so the final whisper pass after Stop has the full
            audio.
          </p>
        )}
        <div className="space-y-2 pt-1">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings.liveAssist.enableLiveTranscript}
              onChange={(e) =>
                update({
                  liveAssist: {
                    ...settings.liveAssist,
                    enableLiveTranscript: e.target.checked,
                  },
                })
              }
            />
            Enable live transcript preview
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings.liveAssist.enableLiveSpeakerDetection}
              onChange={(e) =>
                update({
                  liveAssist: {
                    ...settings.liveAssist,
                    enableLiveSpeakerDetection: e.target.checked,
                  },
                })
              }
            />
            Enable live speaker detection (Tech / Store Employee / Manager)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings.liveAssist.showCapturedDetailCards}
              onChange={(e) =>
                update({
                  liveAssist: {
                    ...settings.liveAssist,
                    showCapturedDetailCards: e.target.checked,
                  },
                })
              }
            />
            Show captured-detail cards while recording
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings.liveAssist.showMissingDetailAlerts}
              onChange={(e) =>
                update({
                  liveAssist: {
                    ...settings.liveAssist,
                    showMissingDetailAlerts: e.target.checked,
                  },
                })
              }
            />
            Show missing-detail alerts while recording
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings.liveAssist.showAskNextPrompts}
              onChange={(e) =>
                update({
                  liveAssist: {
                    ...settings.liveAssist,
                    showAskNextPrompts: e.target.checked,
                  },
                })
              }
            />
            Show "ask next" prompts while recording
          </label>
        </div>
      </section>

      )}

      {renderedTab === "advanced" && (
      <section className="card space-y-3">
        <h2 className="text-base font-semibold">Writing Style</h2>
        <p className="text-xs text-slate-500">
          Controls how the assistant phrases the description, resolution, and AI-generated note.
          Changes take effect on the next analyze or regenerate.
        </p>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Tone">
            <select
              className="input"
              value={settings.writingStyle.tone}
              onChange={(e) =>
                update({
                  writingStyle: {
                    ...settings.writingStyle,
                    tone: e.target.value as WritingTone,
                  },
                })
              }
            >
              <option value="Simple">Simple</option>
              <option value="Professional">Professional</option>
              <option value="Technical">Technical</option>
              <option value="ManagerFriendly">Manager-Friendly</option>
              <option value="Custom">Custom (use my instructions below)</option>
            </select>
          </Field>
          <Field label="Default Detail Level">
            <select
              className="input"
              value={settings.writingStyle.detailLevel}
              onChange={(e) =>
                update({
                  writingStyle: {
                    ...settings.writingStyle,
                    detailLevel: e.target.value as never,
                  },
                  defaultDetailLevel: e.target.value as never,
                })
              }
            >
              {DETAIL_LEVELS.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Opener Style">
            <select
              className="input"
              value={settings.writingStyle.openerStyle}
              onChange={(e) =>
                update({
                  writingStyle: {
                    ...settings.writingStyle,
                    openerStyle: e.target.value as OpenerStyle,
                  },
                })
              }
            >
              <option value="called-about">Store called about…</option>
              <option value="called-reporting">Store called reporting that…</option>
              <option value="reported">Store reported…</option>
              <option value="contacted-support">Store contacted support regarding…</option>
              <option value="first-person">First-person (I restarted…)</option>
            </select>
          </Field>
          <Field label="Resolution Style">
            <select
              className="input"
              value={settings.writingStyle.resolutionStyle}
              onChange={(e) =>
                update({
                  writingStyle: {
                    ...settings.writingStyle,
                    resolutionStyle: e.target.value as ResolutionStyle,
                  },
                })
              }
            >
              <option value="concise">Concise (one sentence)</option>
              <option value="detailed">Detailed (steps + outcome)</option>
            </select>
          </Field>
          <Field label="Voice">
            <select
              className="input"
              value={settings.writingStyle.voice}
              onChange={(e) =>
                update({
                  writingStyle: {
                    ...settings.writingStyle,
                    voice: e.target.value as WritingVoice,
                  },
                })
              }
            >
              <option value="active-first-person">Active / first-person ("I restarted…")</option>
              <option value="passive">Passive ("Services were restarted…")</option>
            </select>
          </Field>
        </div>
        <Field label="Custom style instructions">
          <textarea
            className="input"
            rows={4}
            value={settings.writingStyle.customInstructions}
            onChange={(e) =>
              update({
                writingStyle: {
                  ...settings.writingStyle,
                  customInstructions: e.target.value,
                },
              })
            }
            placeholder="Write like me. Keep it simple. Mention the store, issue, what I tried, and the final result. Keep description and resolution separate."
          />
        </Field>
        <div className="flex flex-wrap gap-2">
          <button
            className="btn-ghost"
            onClick={() => update({ writingStyle: { ...DEFAULT_WRITING_STYLE } })}
          >
            Reset Writing Style to Defaults
          </button>
        </div>
      </section>

      )}

      {renderedTab === "advanced" && (
      <section className="card space-y-3">
        <h2 className="text-base font-semibold">Transcript Repair Dictionary</h2>
        <p className="text-xs text-slate-500">
          The repair pass runs on every transcript before speaker detection so mishearings
          ("story" → store, "wrist" → register, "power green" → power drain) are fixed before any
          extraction logic looks at the text. Number-words become digits ("register one" →
          Register 1) and the dictionary handles repeatable phrase swaps. Disable a row to keep it
          in storage but skip it; turn off auto-apply to surface the change in the Correction
          Review UI for manual approval.
        </p>
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings.enableTranscriptCorrection}
              onChange={(e) => update({ enableTranscriptCorrection: e.target.checked })}
            />
            Apply correction dictionary
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings.enableNumberWordNormalization}
              onChange={(e) => update({ enableNumberWordNormalization: e.target.checked })}
            />
            Normalize number-words ("register one" → Register 1)
          </label>
        </div>
        <CorrectionDictionaryEditor
          entries={settings.correctionDictionary}
          onChange={(entries) => update({ correctionDictionary: entries })}
          onResetDefaults={() =>
            update({ correctionDictionary: [...DEFAULT_CORRECTION_DICTIONARY] })
          }
        />
      </section>

      )}

      {renderedTab === "advanced" && (
      <section className="card space-y-3">
        <h2 className="text-base font-semibold">Storage & Migration</h2>
        <p className="text-xs text-slate-500">
          Tickets are stored in a local SQLite database when running the desktop app. Older
          installs kept tickets in browser localStorage; use the controls below to migrate
          existing data, verify the copy, export a backup, and (only after verifying) delete the
          legacy localStorage data.
        </p>
        <MigrationPanel onStatus={(s) => setStatus(s)} />
      </section>

      )}

      {renderedTab === "basic" && (
      <section className="card space-y-3">
        <h2 className="text-base font-semibold">Reminders</h2>
        <p className="text-xs text-slate-500">
          Reminders are stored locally in SQLite. Desktop notifications are not
          available in this version — due reminders surface in an in-app banner
          at the top of the window.
        </p>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={settings.reminderSettings.enableReminders}
            onChange={(e) =>
              update({
                reminderSettings: {
                  ...settings.reminderSettings,
                  enableReminders: e.target.checked,
                },
              })
            }
          />
          Enable reminders
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={settings.reminderSettings.showBanner}
            onChange={(e) =>
              update({
                reminderSettings: {
                  ...settings.reminderSettings,
                  showBanner: e.target.checked,
                },
              })
            }
            disabled={!settings.reminderSettings.enableReminders}
          />
          Show in-app reminder banner when reminders are due
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={settings.reminderSettings.enableDesktopNotifications}
            disabled
            title="Desktop notifications require the Tauri notification plugin, which lands in a future phase."
          />
          <span className="text-slate-500">
            Enable desktop notifications (not supported in this version)
          </span>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={settings.reminderSettings.autoCreateFromTranscript}
            onChange={(e) =>
              update({
                reminderSettings: {
                  ...settings.reminderSettings,
                  autoCreateFromTranscript: e.target.checked,
                },
              })
            }
            disabled={!settings.reminderSettings.enableReminders}
          />
          Auto-create reminders from transcript phrases (off by default)
        </label>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Default follow-up time (hours from now)">
            <input
              type="number"
              min={1}
              max={168}
              className="input"
              value={settings.reminderSettings.defaultFollowUpHours}
              onChange={(e) =>
                update({
                  reminderSettings: {
                    ...settings.reminderSettings,
                    defaultFollowUpHours: Math.max(1, Number(e.target.value) || 16),
                  },
                })
              }
              disabled={!settings.reminderSettings.enableReminders}
            />
          </Field>
          <Field label="Default snooze (minutes)">
            <input
              type="number"
              min={5}
              max={720}
              className="input"
              value={settings.reminderSettings.defaultSnoozeMinutes}
              onChange={(e) =>
                update({
                  reminderSettings: {
                    ...settings.reminderSettings,
                    defaultSnoozeMinutes: Math.max(5, Number(e.target.value) || 30),
                  },
                })
              }
              disabled={!settings.reminderSettings.enableReminders}
            />
          </Field>
        </div>
      </section>

      )}

      {renderedTab === "ticket-system" && <FieldMappingSection />}

      {renderedTab === "advanced" && <ExtractionPatternsSection />}

      {renderedTab === "basic" && (
      <section className="card space-y-3">
        <h2 className="text-base font-semibold">Privacy</h2>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={settings.disableHistory}
            onChange={(e) => update({ disableHistory: e.target.checked })}
          />
          Disable history (don't save tickets locally)
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={settings.localOnlyLock}
            onChange={(e) => update({ localOnlyLock: e.target.checked })}
          />
          Local-only mode lock (cloud features disabled)
        </label>
        <div className="flex flex-wrap gap-2 pt-2">
          <button
            className="btn-danger"
            onClick={async () => {
              const ok = await askConfirm({
                title: "Delete ALL saved tickets?",
                message:
                  "Every ticket stored on this machine will be permanently removed. There is no undo. Export a backup first if you might need this data.",
                destructive: true,
                confirmLabel: "Delete everything",
              });
              if (!ok) return;
              ticketStore.clearAll();
              setStatus({ kind: "success", message: "All tickets cleared." });
            }}
          >
            Clear all tickets
          </button>
          <button
            className="btn-secondary"
            onClick={async () => {
              const ok = await askConfirm({
                title: "Reset all settings to defaults?",
                message:
                  "Theme, AI provider, whisper paths, writing style, and every other configuration option will be reset. Your saved tickets are not affected.",
                confirmLabel: "Reset settings",
              });
              if (!ok) return;
              update(DEFAULT_SETTINGS);
              setStatus({ kind: "success", message: "Settings reset to defaults." });
            }}
          >
            Reset settings
          </button>
        </div>
      </section>
      )}

      {renderedTab === "developer" && (
      <section className="card space-y-3">
        <h2 className="text-base font-semibold">Developer Tools</h2>
        <p className="text-xs text-slate-500">
          Pages and panels for testing and tuning. These are visible only in Developer mode.
        </p>
        <div className="flex flex-wrap gap-2">
          <a className="btn btn-secondary" href="/smoke-test">Open Smoke Test</a>
          <a className="btn btn-secondary" href="/pilot">Open Pilot Mode</a>
          <a className="btn btn-secondary" href="/writing-lab">Open Writing Lab</a>
          <a className="btn btn-secondary" href="/system">Open System Health</a>
        </div>
      </section>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="label mb-1">{label}</label>
      {children}
    </div>
  );
}

/**
 * Phase 16D follow-up — pure-UI hint that parses a whisper.cpp model
 * filename and renders a one-line "Detected: <size>" chip. Falls back
 * silently when the path doesn't match a known size token. No probing,
 * no file IO — just substring matching against the standard ggml model
 * naming convention.
 */
function WhisperModelHint({ path }: { path: string }) {
  const verdict = detectWhisperModel(path);
  if (!verdict) return null;
  const palette: Record<string, string> = {
    tiny: "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-200",
    base: "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-200",
    small: "border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-700 dark:bg-sky-950/30 dark:text-sky-200",
    medium: "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-200",
    large: "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-200",
  };
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
      <span
        className={`rounded border px-1.5 py-0.5 font-mono ${palette[verdict.size] ?? ""}`}
      >
        Detected: {verdict.size}
        {verdict.englishOnly ? " (.en)" : ""}
      </span>
      <span className="text-slate-500">{verdict.tradeoff}</span>
    </div>
  );
}

function detectWhisperModel(path: string): {
  size: "tiny" | "base" | "small" | "medium" | "large";
  englishOnly: boolean;
  tradeoff: string;
} | null {
  if (!path) return null;
  const lower = path.toLowerCase();
  // Largest-token-first so "large-v3" matches "large", not "tiny" inside ".../tinytown/...".
  // Anchored on a non-word boundary so "/path/medium-v3.bin" matches but
  // "/path/myfile.bin" doesn't accidentally hit "small" inside "samples".
  const order: ("large" | "medium" | "small" | "base" | "tiny")[] = [
    "large",
    "medium",
    "small",
    "base",
    "tiny",
  ];
  for (const size of order) {
    const re = new RegExp(`\\b${size}\\b`);
    if (re.test(lower)) {
      const englishOnly = /\.en\b/.test(lower);
      const tradeoff: Record<string, string> = {
        tiny: "fastest, least accurate",
        base: "fast, lower accuracy",
        small: "better accuracy",
        medium: "recommended for retail support calls",
        large: "best accuracy, slower",
      };
      return { size, englishOnly, tradeoff: tradeoff[size] };
    }
  }
  return null;
}

/**
 * Phase 9: Ticket System Field Mapping editor.
 *
 * Lets the user reorder, rename, gate, and default-fill the per-field
 * rows that Copy Mode walks through. Mapping is purely presentational —
 * it changes which rows appear in Copy Mode, but never alters the saved
 * TicketFields shape, so adjusting it here cannot break History,
 * Intelligence, or self-tests.
 */
function FieldMappingSection() {
  const settings = useAppStore((s) => s.settings);
  const update = useAppStore((s) => s.updateSettings);
  const setStatus = useAppStore((s) => s.setStatus);
  const askConfirm = useConfirm();
  const mapping = settings.fieldMapping;

  function patchEntry(index: number, patch: Partial<FieldMappingEntry>) {
    const next = mapping.entries.map((e, i) => (i === index ? { ...e, ...patch } : e));
    update({ fieldMapping: { ...mapping, entries: next } });
  }
  function move(index: number, dir: -1 | 1) {
    const target = index + dir;
    if (target < 0 || target >= mapping.entries.length) return;
    const next = [...mapping.entries];
    const tmp = next[index];
    next[index] = next[target];
    next[target] = tmp;
    update({ fieldMapping: { ...mapping, entries: next } });
  }
  async function resetMapping() {
    const ok = await askConfirm({
      title: "Reset field mapping?",
      message:
        "Restores the default order, labels, and visibility for the Copy Mode walkthrough. Saved tickets are not affected.",
      confirmLabel: "Reset mapping",
    });
    if (!ok) return;
    update({
      fieldMapping: {
        ...DEFAULT_FIELD_MAPPING_SETTINGS,
        entries: DEFAULT_FIELD_MAPPING_SETTINGS.entries.map((e) => ({ ...e })),
      },
    });
    setStatus({ kind: "success", message: "Field mapping reset to defaults." });
  }

  return (
    <section className="card space-y-3">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">Ticket System Field Mapping</h2>
          <p className="text-xs text-slate-500">
            Reorder, rename, hide, or set defaults for the fields Copy Mode
            walks through. Affects only the Copy Mode UI — saved tickets are
            unchanged.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1 text-xs">
            <input
              type="checkbox"
              checked={mapping.autoSkipEmpty}
              onChange={(e) =>
                update({
                  fieldMapping: { ...mapping, autoSkipEmpty: e.target.checked },
                })
              }
            />
            Auto-skip empty fields in sequence
          </label>
          <button className="btn-ghost text-xs" onClick={resetMapping}>
            Reset to defaults
          </button>
        </div>
      </header>
      <ul className="space-y-1">
        {mapping.entries.map((entry, idx) => (
          <li
            key={entry.key}
            className={`rounded-md border p-2 text-xs ${
              entry.enabled
                ? "border-slate-200 dark:border-slate-700"
                : "border-slate-200 bg-slate-50 opacity-60 dark:border-slate-700 dark:bg-slate-900/40"
            }`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex flex-col">
                <button
                  type="button"
                  className="text-xs leading-none disabled:opacity-30"
                  onClick={() => move(idx, -1)}
                  disabled={idx === 0}
                  title="Move up"
                >
                  ▲
                </button>
                <button
                  type="button"
                  className="text-xs leading-none disabled:opacity-30"
                  onClick={() => move(idx, 1)}
                  disabled={idx === mapping.entries.length - 1}
                  title="Move down"
                >
                  ▼
                </button>
              </div>
              <div className="flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="font-semibold">
                    {entry.label.trim() || BUILTIN_FIELD_LABELS[entry.key]}
                  </span>
                  <span className="text-[10px] text-slate-500">
                    [{entry.key}]
                  </span>
                </div>
                <div className="mt-1 grid grid-cols-1 gap-2 md:grid-cols-2">
                  <input
                    className="input text-xs"
                    placeholder={`Custom label (default: ${BUILTIN_FIELD_LABELS[entry.key]})`}
                    value={entry.label}
                    onChange={(e) => patchEntry(idx, { label: e.target.value })}
                  />
                  <input
                    className="input text-xs"
                    placeholder="Default value (used when generated value is empty)"
                    value={entry.defaultValue}
                    onChange={(e) =>
                      patchEntry(idx, { defaultValue: e.target.value })
                    }
                  />
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px]">
                  <label className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={entry.enabled}
                      onChange={(e) => patchEntry(idx, { enabled: e.target.checked })}
                    />
                    Show
                  </label>
                  <label className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={entry.required}
                      onChange={(e) => patchEntry(idx, { required: e.target.checked })}
                    />
                    Required
                  </label>
                  <label className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={entry.skipIfEmpty}
                      onChange={(e) =>
                        patchEntry(idx, { skipIfEmpty: e.target.checked })
                      }
                    />
                    Skip if empty
                  </label>
                </div>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function CorrectionDictionaryEditor({
  entries,
  onChange,
  onResetDefaults,
}: {
  entries: CorrectionEntry[];
  onChange: (entries: CorrectionEntry[]) => void;
  onResetDefaults: () => void;
}) {
  const [draftFrom, setDraftFrom] = useState("");
  const [draftTo, setDraftTo] = useState("");
  const [draftNotes, setDraftNotes] = useState("");

  function addEntry() {
    const from = draftFrom.trim();
    const to = draftTo.trim();
    if (!from || !to || from === to) return;
    const exists = entries.some(
      (e) => e.from.toLowerCase() === from.toLowerCase() && e.to === to,
    );
    if (exists) return;
    onChange([
      ...entries,
      {
        from,
        to,
        notes: draftNotes.trim() || undefined,
        enabled: true,
        autoApply: true,
      },
    ]);
    setDraftFrom("");
    setDraftTo("");
    setDraftNotes("");
  }

  function removeAt(idx: number) {
    onChange(entries.filter((_, i) => i !== idx));
  }

  function updateAt<K extends keyof CorrectionEntry>(
    idx: number,
    key: K,
    value: CorrectionEntry[K],
  ) {
    onChange(entries.map((e, i) => (i === idx ? { ...e, [key]: value } : e)));
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs">
        <div className="font-semibold">Repair Rules</div>
        <span className="text-slate-500">
          {entries.length} rule{entries.length === 1 ? "" : "s"}
        </span>
      </div>
      <div className="grid gap-2 md:grid-cols-[1fr_1fr_1fr_auto]">
        <input
          className="input text-sm"
          placeholder="Original (e.g. story)"
          value={draftFrom}
          onChange={(e) => setDraftFrom(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") addEntry();
          }}
        />
        <input
          className="input text-sm"
          placeholder="Corrected (e.g. store)"
          value={draftTo}
          onChange={(e) => setDraftTo(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") addEntry();
          }}
        />
        <input
          className="input text-sm"
          placeholder="Context note (optional)"
          value={draftNotes}
          onChange={(e) => setDraftNotes(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") addEntry();
          }}
        />
        <button className="btn-secondary" onClick={addEntry} disabled={!draftFrom || !draftTo}>
          Add
        </button>
      </div>
      <div className="max-h-96 overflow-y-auto rounded-md border border-slate-200 dark:border-slate-700">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-slate-50 text-xs uppercase tracking-wide text-slate-600 dark:bg-slate-900 dark:text-slate-300">
            <tr>
              <th className="px-2 py-1 text-left">Original</th>
              <th className="px-2 py-1 text-left">Corrected</th>
              <th className="px-2 py-1 text-left">Notes</th>
              <th className="px-2 py-1 text-center">On</th>
              <th className="px-2 py-1 text-center" title="Auto-apply: when off, the change shows in the Correction Review for manual approval.">
                Auto
              </th>
              <th className="w-10"></th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e, i) => {
              const enabled = e.enabled !== false;
              const auto = e.autoApply !== false;
              return (
                <tr
                  key={`${e.from}-${i}`}
                  className={`border-t border-slate-200 dark:border-slate-800 ${
                    enabled ? "" : "opacity-50"
                  }`}
                >
                  <td className="px-2 py-1">
                    <input
                      className="input w-full text-xs"
                      value={e.from}
                      onChange={(ev) => updateAt(i, "from", ev.target.value)}
                    />
                  </td>
                  <td className="px-2 py-1">
                    <input
                      className="input w-full text-xs"
                      value={e.to}
                      onChange={(ev) => updateAt(i, "to", ev.target.value)}
                    />
                  </td>
                  <td className="px-2 py-1">
                    <input
                      className="input w-full text-xs"
                      value={e.notes ?? ""}
                      placeholder="Context (optional)"
                      onChange={(ev) => updateAt(i, "notes", ev.target.value)}
                    />
                  </td>
                  <td className="px-2 py-1 text-center">
                    <input
                      type="checkbox"
                      checked={enabled}
                      onChange={(ev) => updateAt(i, "enabled", ev.target.checked)}
                      title="Enable/disable this rule"
                    />
                  </td>
                  <td className="px-2 py-1 text-center">
                    <input
                      type="checkbox"
                      checked={auto}
                      onChange={(ev) => updateAt(i, "autoApply", ev.target.checked)}
                      title="When off, the change will be queued for manual approval in the Correction Review."
                    />
                  </td>
                  <td className="px-2 py-1 text-right">
                    <button
                      className="btn-ghost px-2 py-0.5 text-xs"
                      onClick={() => removeAt(i)}
                      title="Delete this rule"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              );
            })}
            {entries.length === 0 && (
              <tr>
                <td colSpan={6} className="px-2 py-3 text-center text-xs text-slate-500">
                  No rules. Click <strong>Reset to Defaults</strong> to populate.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div>
        <button className="btn-ghost text-xs" onClick={onResetDefaults}>
          Reset to Defaults
        </button>
      </div>
    </div>
  );
}

// ── Phase 10B+C: Extraction Patterns section ───────────────────────────

function ExtractionPatternsSection() {
  const setStatus = useAppStore((s) => s.setStatus);
  const [tick, setTick] = useState(0);
  const [showNew, setShowNew] = useState(false);
  const [testTranscript, setTestTranscript] = useState("");

  // Re-read patterns each render. extractionPatternsStore is in-memory cached
  // so this is cheap; `tick` triggers refresh after add/edit/remove.
  void tick;
  const patterns = extractionPatternsStore.list();
  const refresh = () => setTick((n) => n + 1);

  return (
    <section className="card space-y-3">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-start gap-2.5">
          <span className="mt-0.5 inline-flex h-7 w-7 items-center justify-center rounded-lg bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300">
            <Icon name="sparkle" className="h-4 w-4" />
          </span>
          <div>
            <h2 className="text-base font-semibold">Extraction Patterns</h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              Custom regex patterns the analyzer runs <strong>before</strong> built-ins to
              boost detection sensitivity. Auto-learned patterns appear here every
              time you answer a "Missing — ask the caller" prompt during a call.
            </p>
          </div>
        </div>
        <button
          type="button"
          className="btn-secondary text-xs"
          onClick={() => setShowNew(!showNew)}
        >
          <Icon name="sparkle" className="h-3.5 w-3.5" />
          {showNew ? "Cancel" : "Add pattern"}
        </button>
      </header>

      {showNew && (
        <NewPatternEditor
          onSave={(input) => {
            extractionPatternsStore.create(input);
            setShowNew(false);
            refresh();
            setStatus({ kind: "success", message: "Pattern added." });
          }}
          onCancel={() => setShowNew(false)}
        />
      )}

      {patterns.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50/50 px-3 py-4 text-center text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-400">
          No custom patterns yet. Answer a missing field on the Voice page, or click <strong>Add pattern</strong> above to create one manually.
        </p>
      ) : (
        <div className="space-y-2">
          {patterns.map((p) => (
            <PatternRow
              key={p.id}
              pattern={p}
              onChange={() => refresh()}
              onRemove={() => {
                extractionPatternsStore.remove(p.id);
                refresh();
              }}
            />
          ))}
        </div>
      )}

      <div className="rounded-xl border border-slate-200/80 bg-slate-50/40 p-4 dark:border-slate-800/70 dark:bg-slate-900/30">
        <div className="mb-2 flex items-center gap-2">
          <Icon name="info" className="h-3.5 w-3.5 text-slate-500" />
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Test against a sample transcript
          </span>
        </div>
        <textarea
          className="input h-24 text-xs font-mono"
          placeholder="Paste a transcript here. Below: which patterns match it, and what they extract."
          value={testTranscript}
          onChange={(e) => setTestTranscript(e.target.value)}
        />
        {testTranscript.trim() && (
          <PatternTestResults patterns={patterns} text={testTranscript} />
        )}
      </div>
    </section>
  );
}

function PatternRow({
  pattern,
  onChange,
  onRemove,
}: {
  pattern: ExtractionPattern;
  onChange: () => void;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(pattern);
  const askConfirm = useConfirm();

  const sourceClass =
    pattern.source === "manual"
      ? "border-brand-200 bg-brand-50 text-brand-700 dark:border-brand-800/70 dark:bg-brand-900/40 dark:text-brand-300"
      : "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800/70 dark:bg-emerald-950/40 dark:text-emerald-300";

  if (editing) {
    return (
      <div className="rounded-xl border border-slate-200/80 bg-white p-3 dark:border-slate-800 dark:bg-slate-900/70">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <input
            className="input text-sm"
            value={draft.label}
            onChange={(e) => setDraft({ ...draft, label: e.target.value })}
            placeholder="Label"
          />
          <select
            className="input text-sm"
            value={draft.kind}
            onChange={(e) => setDraft({ ...draft, kind: e.target.value as ExtractionPatternKind })}
          >
            {(Object.keys(EXTRACTION_KIND_LABELS) as ExtractionPatternKind[]).map((k) => (
              <option key={k} value={k}>
                {EXTRACTION_KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </div>
        <input
          className="input mt-2 font-mono text-xs"
          value={draft.pattern}
          onChange={(e) => setDraft({ ...draft, pattern: e.target.value })}
          placeholder="Regex pattern"
        />
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <label className="flex items-center gap-1">
            Flags
            <input
              className="input h-7 w-16 font-mono"
              value={draft.flags}
              onChange={(e) => setDraft({ ...draft, flags: e.target.value })}
            />
          </label>
          <label className="flex items-center gap-1">
            Capture group
            <input
              type="number"
              min="0"
              className="input h-7 w-16 font-mono"
              value={draft.captureGroup}
              onChange={(e) => setDraft({ ...draft, captureGroup: Number(e.target.value) || 0 })}
            />
          </label>
          <button
            type="button"
            className="btn-primary text-xs"
            onClick={() => {
              extractionPatternsStore.update(pattern.id, {
                label: draft.label,
                kind: draft.kind,
                pattern: draft.pattern,
                flags: draft.flags,
                captureGroup: draft.captureGroup,
              });
              setEditing(false);
              onChange();
            }}
          >
            <Icon name="check" className="h-3.5 w-3.5" />
            Save
          </button>
          <button
            type="button"
            className="btn-ghost text-xs"
            onClick={() => {
              setDraft(pattern);
              setEditing(false);
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200/80 bg-white px-3 py-2.5 dark:border-slate-800 dark:bg-slate-900/70">
      <label className="flex items-center gap-1.5">
        <input
          type="checkbox"
          checked={pattern.enabled}
          onChange={(e) => {
            extractionPatternsStore.update(pattern.id, { enabled: e.target.checked });
            onChange();
          }}
        />
      </label>
      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${sourceClass}`}>
        {pattern.source}
      </span>
      <span className="badge-neutral !text-[10px]">
        {EXTRACTION_KIND_LABELS[pattern.kind]}
      </span>
      <span className="flex-1 text-sm font-medium text-slate-800 dark:text-slate-100">
        {pattern.label}
      </span>
      <span className="hidden text-[10px] text-slate-500 dark:text-slate-500 sm:inline">
        {pattern.useCount} hit{pattern.useCount === 1 ? "" : "s"}
      </span>
      <code className="hidden truncate rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-700 dark:bg-slate-800 dark:text-slate-300 md:inline-block md:max-w-xs">
        /{pattern.pattern}/{pattern.flags}
      </code>
      <button
        type="button"
        className="btn-ghost h-7 px-2 text-xs"
        onClick={() => setEditing(true)}
      >
        Edit
      </button>
      <button
        type="button"
        aria-label={`Delete pattern ${pattern.label}`}
        title="Delete this extraction pattern"
        className="inline-flex h-7 items-center rounded-md px-2 text-xs text-rose-600 transition-colors hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/30"
        onClick={async () => {
          const ok = await askConfirm({
            title: "Delete this extraction pattern?",
            message: <>Pattern <span className="font-semibold">{pattern.label}</span> will be removed. This cannot be undone.</>,
            destructive: true,
          });
          if (ok) onRemove();
        }}
      >
        <Icon name="trash" className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function NewPatternEditor({
  onSave,
  onCancel,
}: {
  onSave: (p: {
    kind: ExtractionPatternKind;
    label: string;
    pattern: string;
    flags: string;
    captureGroup: number;
  }) => void;
  onCancel: () => void;
}) {
  const [kind, setKind] = useState<ExtractionPatternKind>("storeNumber");
  const [label, setLabel] = useState("");
  const [pattern, setPattern] = useState("");
  const [flags, setFlags] = useState("i");
  const [captureGroup, setCaptureGroup] = useState(1);
  const [error, setError] = useState<string | null>(null);

  function validateAndSave() {
    setError(null);
    if (!pattern.trim()) {
      setError("Pattern is required.");
      return;
    }
    try {
      new RegExp(pattern, flags);
    } catch (e) {
      setError(`Invalid regex: ${(e as Error).message}`);
      return;
    }
    onSave({ kind, label: label.trim() || `${EXTRACTION_KIND_LABELS[kind]} pattern`, pattern, flags, captureGroup });
  }

  return (
    <div className="rounded-xl border border-brand-200 bg-brand-50/30 p-3 dark:border-brand-800/70 dark:bg-brand-950/20">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="text-xs">
          <span className="label mb-1 block">Field</span>
          <select
            className="input text-sm"
            value={kind}
            onChange={(e) => setKind(e.target.value as ExtractionPatternKind)}
          >
            {(Object.keys(EXTRACTION_KIND_LABELS) as ExtractionPatternKind[]).map((k) => (
              <option key={k} value={k}>
                {EXTRACTION_KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs">
          <span className="label mb-1 block">Label</span>
          <input
            className="input text-sm"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Store via 'calling for'"
          />
        </label>
      </div>
      <label className="mt-2 block text-xs">
        <span className="label mb-1 block">Regex pattern</span>
        <input
          className="input font-mono text-xs"
          value={pattern}
          onChange={(e) => setPattern(e.target.value)}
          placeholder="e.g. \\bstore\\b[\\s\\S]{0,40}?\\b(\\d{1,5})\\b"
        />
      </label>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        <label className="flex items-center gap-1">
          Flags
          <input
            className="input h-7 w-16 font-mono"
            value={flags}
            onChange={(e) => setFlags(e.target.value)}
          />
        </label>
        <label className="flex items-center gap-1">
          Capture group
          <input
            type="number"
            min="0"
            className="input h-7 w-16 font-mono"
            value={captureGroup}
            onChange={(e) => setCaptureGroup(Number(e.target.value) || 0)}
          />
        </label>
        <button type="button" className="btn-primary text-xs" onClick={validateAndSave}>
          <Icon name="check" className="h-3.5 w-3.5" />
          Save pattern
        </button>
        <button type="button" className="btn-ghost text-xs" onClick={onCancel}>
          Cancel
        </button>
      </div>
      {error && (
        <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">{error}</p>
      )}
    </div>
  );
}

function PatternTestResults({ patterns, text }: { patterns: ExtractionPattern[]; text: string }) {
  const results = patterns
    .map((p) => {
      if (!p.enabled) return null;
      try {
        const re = new RegExp(p.pattern, p.flags || "i");
        const m = text.match(re);
        if (!m) return null;
        return {
          id: p.id,
          label: p.label,
          kind: p.kind,
          value: m[p.captureGroup] ?? m[1] ?? m[0],
          evidence: m[0],
        };
      } catch {
        return null;
      }
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  if (results.length === 0) {
    return (
      <p className="mt-2 text-xs italic text-slate-500 dark:text-slate-500">
        No patterns matched this text.
      </p>
    );
  }
  return (
    <ul className="mt-2 space-y-1">
      {results.map((r) => (
        <li
          key={r.id}
          className="flex flex-wrap items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50/70 px-3 py-1.5 text-xs dark:border-emerald-800/70 dark:bg-emerald-950/30"
        >
          <Icon name="check" className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
          <span className="badge-neutral !text-[10px]">{EXTRACTION_KIND_LABELS[r.kind]}</span>
          <span className="font-medium text-emerald-900 dark:text-emerald-100">{r.label}</span>
          <span className="text-emerald-800 dark:text-emerald-200">→ <strong>{r.value}</strong></span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Phase 11A — Audio input controls. Mic selector + getUserMedia constraint
 * toggles. The dropdown enumerates `audioinput` MediaDevices on mount and
 * re-enumerates when the OS reports a `devicechange`. If browser permission
 * hasn't been granted yet, labels render as "Microphone (xxxxxx…)" — the
 * actual mic names only become available after the first allow-mic prompt.
 */
function AudioInputSection({
  settings,
  update,
}: {
  settings: AppSettings;
  update: (patch: Partial<AppSettings>) => void;
}) {
  const devices = useAudioInputDevices();
  const selectedExists =
    !settings.audioInputDeviceId ||
    devices.some((d) => d.deviceId === settings.audioInputDeviceId);
  const labelsMissing =
    devices.length > 0 && devices.every((d) => !d.label.includes(" "));

  return (
    <section className="card space-y-3">
      <h2 className="text-base font-semibold">Audio Input</h2>
      <p className="text-xs text-slate-500">
        Pick which microphone to record from and tune the browser's audio
        processing. The toggles below are passed to <code>getUserMedia</code>
        — the OS or webview may honor or silently ignore each one.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Microphone">
          <select
            className="input"
            value={settings.audioInputDeviceId}
            onChange={(e) => update({ audioInputDeviceId: e.target.value })}
          >
            <option value="">Default device</option>
            {devices.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label}
              </option>
            ))}
            {settings.audioInputDeviceId && !selectedExists && (
              <option value={settings.audioInputDeviceId}>
                (pinned device — currently unplugged)
              </option>
            )}
          </select>
        </Field>
        <div className="flex flex-col justify-end gap-1">
          {!selectedExists && settings.audioInputDeviceId && (
            <p className="text-[11px] text-amber-700 dark:text-amber-300">
              The pinned mic isn't connected. Recording will fall back to the
              default device automatically.
            </p>
          )}
          {labelsMissing && (
            <p className="text-[11px] text-slate-500">
              Start a recording once to grant the app permission — device
              names will then appear here.
            </p>
          )}
          {devices.length === 0 && (
            <p className="text-[11px] text-slate-500">
              No audio input devices detected yet.
            </p>
          )}
        </div>
      </div>

      <div className="space-y-2 pt-1">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={settings.audioNoiseSuppression}
            onChange={(e) =>
              update({ audioNoiseSuppression: e.target.checked })
            }
          />
          Noise suppression
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={settings.audioEchoCancellation}
            onChange={(e) =>
              update({ audioEchoCancellation: e.target.checked })
            }
          />
          Echo cancellation
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={settings.audioAutoGainControl}
            onChange={(e) =>
              update({ audioAutoGainControl: e.target.checked })
            }
          />
          Auto gain control
        </label>
        <p className="text-xs text-slate-500">
          Defaults are all on. Turn them off if the call audio sounds
          robotic, over-compressed, or has dropouts. Changes take effect on
          the next recording.
        </p>
      </div>

      <MicTestRow settings={settings} update={update} />

      <div className="space-y-1 border-t border-slate-200/70 pt-3 dark:border-slate-800/70">
        <Field label="Chunk overlap">
          <select
            className="input"
            value={settings.liveAssist.chunkOverlapSec}
            onChange={(e) =>
              update({
                liveAssist: {
                  ...settings.liveAssist,
                  chunkOverlapSec: Number(e.target.value) as 0 | 1 | 2 | 3,
                },
              })
            }
          >
            <option value={0}>Off — no overlap</option>
            <option value={1}>1 second</option>
            <option value={2}>2 seconds (recommended)</option>
            <option value={3}>3 seconds</option>
          </select>
        </Field>
        <p className="text-[11px] text-slate-500">
          Phase 16D — adjacent live chunks overlap by this much so words at
          the seam are captured by both whisper passes. The dedup at merge
          time removes the duplication. More overlap improves continuity at
          the cost of extra dedup work; 0 disables.
        </p>
      </div>
    </section>
  );
}

/**
 * Phase 16D — Test Microphone + Calibrate Microphone buttons. Records 3 s
 * (Test) or 5 s (Calibrate) from the current device. Test shows peak/rms +
 * a verdict; Calibrate stores the personalized thresholds keyed by deviceId
 * so the live classifier can use device-specific thresholds.
 *
 * Heavy lifting lives in services/microphoneDevices.quickProbe — this
 * component is just the UI + persistence path.
 */
function MicTestRow({
  settings,
  update,
}: {
  settings: AppSettings;
  update: (patch: Partial<AppSettings>) => void;
}) {
  const [busy, setBusy] = useState<"test" | "calibrate" | null>(null);
  const [result, setResult] = useState<{
    mode: "test" | "calibrate";
    peakLevel: number;
    rmsLevel: number;
    verdict: string;
    speech: boolean;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runTest = async () => {
    setBusy("test");
    setError(null);
    try {
      const { quickProbe } = await import("../services/microphoneDevices");
      const r = await quickProbe(
        settings.audioInputDeviceId || undefined,
        3000,
      );
      setResult({
        mode: "test",
        peakLevel: r.peakLevel,
        rmsLevel: r.rmsLevel,
        verdict: r.verdict,
        speech: r.speechDetected,
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const runCalibrate = async () => {
    setBusy("calibrate");
    setError(null);
    try {
      const { quickProbe, listInputDevices } = await import(
        "../services/microphoneDevices"
      );
      const r = await quickProbe(
        settings.audioInputDeviceId || undefined,
        5000,
      );
      // Calibration thresholds: silence = 25% of measured rms (any quieter is
      // certainly silence), speech = 60% of measured rms (a confident speech
      // floor), clipping = 95% of measured peak. Floor at sensible minima so
      // a calibration captured in a very quiet room doesn't make every
      // future chunk look "loud."
      const silenceRms = Math.max(0.003, r.rmsLevel * 0.25);
      const speechRms = Math.max(0.015, r.rmsLevel * 0.6);
      const peakClipping = Math.min(0.99, Math.max(0.4, r.peakLevel * 1.1));
      // Find a label for the device so the saved calibration is readable.
      let label = settings.audioInputDeviceId || "Default device";
      try {
        const devices = await listInputDevices();
        const match = devices.find(
          (d) => d.deviceId === (settings.audioInputDeviceId || "default"),
        );
        if (match?.label) label = match.label;
      } catch {
        // ignore — fall back to deviceId
      }
      const key = settings.audioInputDeviceId || "default";
      update({
        microphoneCalibrations: {
          ...settings.microphoneCalibrations,
          [key]: {
            label,
            silenceRms,
            speechRms,
            peakClipping,
            calibratedAt: new Date().toISOString(),
          },
        },
      });
      setResult({
        mode: "calibrate",
        peakLevel: r.peakLevel,
        rmsLevel: r.rmsLevel,
        verdict: r.verdict,
        speech: r.speechDetected,
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const verdictText: Record<string, string> = {
    good: "Microphone input looks good.",
    low: "Input level is low. Move closer or choose another microphone.",
    loud: "Input is clipping. Move farther away or lower gain.",
    silent: "Audio level is very low. The app may be using the wrong microphone.",
    noisy: "Background noise is high. Transcription may be less accurate.",
  };

  const currentKey = settings.audioInputDeviceId || "default";
  const currentCalibration = settings.microphoneCalibrations?.[currentKey];

  return (
    <div className="space-y-2 border-t border-slate-200/70 pt-3 dark:border-slate-800/70">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn-ghost text-xs"
          onClick={() => void runTest()}
          disabled={busy !== null}
        >
          {busy === "test" ? "Testing…" : "Test Microphone"}
        </button>
        <button
          type="button"
          className="btn-ghost text-xs"
          onClick={() => void runCalibrate()}
          disabled={busy !== null}
          title="Speak normally for ~5 seconds. Personalized thresholds are saved per-device."
        >
          {busy === "calibrate" ? "Calibrating…" : "Calibrate Microphone"}
        </button>
        <span className="text-[11px] text-slate-500">
          Test = 3 s probe. Calibrate = 5 s sample → personalized thresholds.
        </span>
      </div>
      {currentCalibration && (
        <div className="text-[11px] text-slate-500">
          Calibrated for <strong>{currentCalibration.label}</strong> on{" "}
          {new Date(currentCalibration.calibratedAt).toLocaleString()} · silence
          ≤ {currentCalibration.silenceRms.toFixed(3)} · speech ≥{" "}
          {currentCalibration.speechRms.toFixed(3)} · clipping ≥{" "}
          {currentCalibration.peakClipping.toFixed(2)}
        </div>
      )}
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700 dark:border-red-800/70 dark:bg-red-950/30 dark:text-red-200">
          {error}
        </div>
      )}
      {result && (
        <div
          className={`rounded-md border px-3 py-2 text-xs ${
            result.verdict === "good"
              ? "border-emerald-200 bg-emerald-50 dark:border-emerald-800/70 dark:bg-emerald-950/30"
              : result.verdict === "loud" || result.verdict === "silent"
                ? "border-red-200 bg-red-50 dark:border-red-800/70 dark:bg-red-950/30"
                : "border-amber-200 bg-amber-50 dark:border-amber-800/70 dark:bg-amber-950/30"
          }`}
        >
          <div className="font-medium">
            {result.mode === "calibrate" ? "Calibration saved. " : ""}
            {verdictText[result.verdict] ?? result.verdict}
          </div>
          <div className="mt-0.5 font-mono text-[10px] opacity-75">
            peak {result.peakLevel.toFixed(3)} · rms {result.rmsLevel.toFixed(3)} ·
            speech detected: {result.speech ? "yes" : "no"}
          </div>
        </div>
      )}
    </div>
  );
}
