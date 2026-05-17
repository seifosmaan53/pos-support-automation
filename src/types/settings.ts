import type { DetailLevel } from "./ticket";
import {
  DEFAULT_REMINDER_SETTINGS,
  type ReminderSettings,
} from "./reminder";
import {
  DEFAULT_FIELD_MAPPING_SETTINGS,
  type FieldMappingSettings,
} from "./copyMode";

export type AIProvider = "rule-based" | "ollama" | "lmstudio";
export type TranscriptionMode = "manual" | "whisper-cpp";
export type Theme = "light" | "dark" | "system";

/**
 * Phase 17A — progressive disclosure.
 *
 *   daily     — minimum surface for a working day: New Ticket, History,
 *               Reminders, KB, Settings, System Health, Help.
 *   advanced  — adds power tools (Intelligence, Writing Lab, Templates,
 *               Style Examples) and the full workflow chain in the sidebar.
 *   developer — adds Smoke Test, Pilot Mode, and other diagnostics.
 *
 * Routes for hidden items remain typeable — only the sidebar links are
 * filtered. This protects bookmarks, scripts, and links from this app's
 * own docs/help.
 */
export type UserMode = "daily" | "advanced" | "developer";

export const USER_MODE_RANK: Record<UserMode, number> = {
  daily: 0,
  advanced: 1,
  developer: 2,
};

export type WritingTone =
  | "Simple"
  | "Professional"
  | "Technical"
  | "ManagerFriendly"
  | "Custom";

export type OpenerStyle =
  | "called-about"
  | "called-reporting"
  | "reported"
  | "contacted-support"
  | "first-person";

export type ResolutionStyle = "concise" | "detailed";

export type WritingVoice = "active-first-person" | "passive";

export interface WritingStyleSettings {
  tone: WritingTone;
  detailLevel: DetailLevel;
  openerStyle: OpenerStyle;
  resolutionStyle: ResolutionStyle;
  voice: WritingVoice;
  customInstructions: string;
}

export const DEFAULT_WRITING_STYLE: WritingStyleSettings = {
  tone: "Professional",
  detailLevel: "Normal",
  openerStyle: "called-reporting",
  resolutionStyle: "concise",
  voice: "active-first-person",
  customInstructions:
    "Write like a clear retail/POS support technician. Mention the store, what was reported, what was tried, and the final result. Keep description and resolution separate. Do not invent any details that are not in the notes.",
};

export interface CorrectionEntry {
  from: string;
  to: string;
  /** Free-form context note shown in the Settings dictionary editor. */
  notes?: string;
  /** Disabled rules are kept in storage but skipped at correction time. */
  enabled?: boolean;
  /**
   * When true, the rule is applied automatically as soon as the transcript
   * arrives. When false, the rule still runs but the resulting change can be
   * shown in the Correction Review UI for the user to approve or undo.
   *
   * Defaults to true for entries created before this field existed.
   */
  autoApply?: boolean;
}

export const DEFAULT_CORRECTION_DICTIONARY: CorrectionEntry[] = [
  { from: "registering one", to: "Register 1", notes: "Mishearing of 'register one'.", enabled: true, autoApply: true },
  { from: "registering two", to: "Register 2", notes: "Mishearing of 'register two'.", enabled: true, autoApply: true },
  { from: "registering three", to: "Register 3", notes: "Mishearing of 'register three'.", enabled: true, autoApply: true },
  { from: "register won", to: "Register 1", notes: "ASR sometimes hears 'won' for 'one'.", enabled: true, autoApply: true },
  { from: "register one", to: "Register 1", notes: "Number-word normalization.", enabled: true, autoApply: true },
  { from: "register two", to: "Register 2", notes: "Number-word normalization.", enabled: true, autoApply: true },
  { from: "register three", to: "Register 3", notes: "Number-word normalization.", enabled: true, autoApply: true },
  { from: "register four", to: "Register 4", notes: "Number-word normalization.", enabled: true, autoApply: true },
  { from: "register five", to: "Register 5", notes: "Number-word normalization.", enabled: true, autoApply: true },
  { from: "all three registers", to: "all 3 registers", notes: "Number-word normalization.", enabled: true, autoApply: true },
  { from: "all two registers", to: "both registers", notes: "Cleaner phrasing.", enabled: true, autoApply: true },
  { from: "calm services", to: "COM services", notes: "POS service brand.", enabled: true, autoApply: true },
  { from: "com services", to: "COM services", notes: "Capitalization.", enabled: true, autoApply: true },
  { from: "pro services", to: "Pro services", notes: "Capitalization.", enabled: true, autoApply: true },
  { from: "bos services", to: "BOS services", notes: "Back-Office Services initialism.", enabled: true, autoApply: true },
  { from: "in see go", to: "Inseego", notes: "Vendor name (gateway hardware).", enabled: true, autoApply: true },
  { from: "insego", to: "Inseego", notes: "Vendor name spelling.", enabled: true, autoApply: true },
  { from: "inseego", to: "Inseego", notes: "Vendor name capitalization.", enabled: true, autoApply: true },
  { from: "verifone", to: "VeriFone", notes: "Vendor name capitalization.", enabled: true, autoApply: true },
  { from: "very phone", to: "VeriFone", notes: "Common ASR mishearing.", enabled: true, autoApply: true },
  { from: "very fone", to: "VeriFone", notes: "Common ASR mishearing.", enabled: true, autoApply: true },
  { from: "lotus notes", to: "Lotus Notes", notes: "Capitalization.", enabled: true, autoApply: true },
  { from: "p c f", to: "PCF", notes: "Spelled-out initialism.", enabled: true, autoApply: true },
  { from: "pcf", to: "PCF", notes: "Initialism casing.", enabled: true, autoApply: true },
  { from: "b o s", to: "BOS", notes: "Spelled-out initialism.", enabled: true, autoApply: true },
  { from: "bos", to: "BOS", notes: "Initialism casing.", enabled: true, autoApply: true },
  { from: "att", to: "ATT", notes: "Vendor casing.", enabled: true, autoApply: true },
  { from: "at and t", to: "ATT", notes: "Spoken form of AT&T.", enabled: true, autoApply: true },
  { from: "at&t", to: "ATT", notes: "Symbol-free form.", enabled: true, autoApply: true },
  { from: "wisely card", to: "Wisely Card", notes: "Pay product name.", enabled: true, autoApply: true },
  { from: "pin pad", to: "pin pad", notes: "Spacing canonicalization.", enabled: true, autoApply: true },
  { from: "operator id", to: "operator ID", notes: "Initialism casing.", enabled: true, autoApply: true },
  { from: "employee id", to: "employee ID", notes: "Initialism casing.", enabled: true, autoApply: true },
  // Domain shorthand exposed here so users can disable individual repairs.
  { from: "story", to: "store", notes: "Context-bound — the domain repair pass only fires when 'story' is followed by a store-context phrase. Disabling has no effect on the safe regex pass.", enabled: true, autoApply: true },
  { from: "what story are you calling", to: "what store are you calling", notes: "Tech intake question mishearing.", enabled: true, autoApply: true },
  { from: "wrist", to: "register", notes: "Context-bound — fires only in shutdown/restart phrasing.", enabled: true, autoApply: true },
  { from: "rest", to: "register", notes: "Context-bound — same shutdown/restart phrasing as 'wrist'.", enabled: true, autoApply: true },
  { from: "power green", to: "power drain", notes: "POS power-drain procedure.", enabled: true, autoApply: true },
  { from: "power grain", to: "power drain", notes: "ASR mishearing of 'drain'.", enabled: true, autoApply: true },
];

export interface NameCorrection {
  /** Misheard form, lowercased for stable matching. */
  detected: string;
  /** Canonical form to substitute. */
  corrected: string;
}

/**
 * Phase 11A live-assist settings. The chunk size controls how often the
 * MediaRecorder is rolled to produce a short standalone audio file for
 * whisper.cpp to transcribe. 5 s gives the fastest preview but whisper-cpp
 * tends to hallucinate on clips shorter than ~10 s; 15 s is the most reliable.
 * "manual" disables chunked live transcription — the final pass after stop
 * still runs as normal.
 */
export type LiveChunkSize = 5 | 10 | 15 | "manual";

export interface LiveAssistSettings {
  enableLiveTranscript: boolean;
  enableLiveSpeakerDetection: boolean;
  chunkSizeSec: LiveChunkSize;
  /**
   * Phase 16D — overlap in seconds between adjacent live chunks. The
   * recorder briefly overlaps consecutive chunks so words at the seam are
   * captured by both whisper passes; the chunkOverlap dedup at merge time
   * removes the duplication. 0 = no overlap, 2 = recommended.
   */
  chunkOverlapSec: 0 | 1 | 2 | 3;
  showCapturedDetailCards: boolean;
  showMissingDetailAlerts: boolean;
  showAskNextPrompts: boolean;
  /**
   * Phase 11B readability controls. Live Conversation rows can be packed
   * tightly during a fast-paced call ("compact") or spread out with raw
   * text + corrections visible for accuracy work ("detailed").
   */
  viewMode: "compact" | "detailed";
  showConfidence: boolean;
  showRawText: boolean;
  showCorrections: boolean;
}

export const DEFAULT_LIVE_ASSIST: LiveAssistSettings = {
  enableLiveTranscript: true,
  enableLiveSpeakerDetection: true,
  chunkSizeSec: 10,
  chunkOverlapSec: 2,
  showCapturedDetailCards: true,
  showMissingDetailAlerts: true,
  showAskNextPrompts: true,
  viewMode: "detailed",
  showConfidence: true,
  showRawText: true,
  showCorrections: true,
};

export interface AppSettings {
  technicianName: string;
  defaultDetailLevel: DetailLevel;
  theme: Theme;
  /**
   * Phase 17A — progressive disclosure. `daily` is the simple workflow,
   * `advanced` adds power tools, `developer` adds diagnostics. Default
   * `daily`. Hidden sidebar items remain accessible via URL.
   */
  userMode: UserMode;
  autoSaveOnGenerate: boolean;
  askBeforeDelete: boolean;

  aiProvider: AIProvider;
  ollamaEndpoint: string;
  ollamaModel: string;
  lmStudioEndpoint: string;
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
  fallbackToRuleBased: boolean;

  transcriptionMode: TranscriptionMode;
  whisperExecutablePath: string;
  whisperModelPath: string;
  whisperLanguage: string;
  whisperThreads: number;
  /**
   * Domain prompt prepended to whisper.cpp via `--prompt`. Helps the model
   * spell brand names like Inseego, VeriFone, PCF, BOS, etc. correctly when
   * the audio is noisy. Empty string disables.
   */
  whisperPrompt: string;
  /**
   * Optional MediaDeviceInfo.deviceId to pin recording to a specific
   * microphone. Empty string means "use the default device".
   */
  audioInputDeviceId: string;
  /**
   * Phase 16D — per-device calibration. Keyed by deviceId; each record holds
   * the personalized silence / speech / clipping thresholds measured during
   * Calibrate Microphone. Empty for un-calibrated devices — safe defaults
   * from `liveAudioTextFilter` are used instead.
   */
  microphoneCalibrations: Record<
    string,
    {
      label: string;
      silenceRms: number;
      speechRms: number;
      peakClipping: number;
      calibratedAt: string;
    }
  >;
  /**
   * getUserMedia constraints. All three are best-effort — browser/OS may
   * silently ignore them (e.g. Safari on macOS may flag NS on by default).
   */
  audioNoiseSuppression: boolean;
  audioEchoCancellation: boolean;
  audioAutoGainControl: boolean;
  saveAudio: boolean;
  deleteAudioAfterTranscription: boolean;
  /** When true, the original transcript is preserved alongside the audio file. */
  saveTranscriptWithAudio: boolean;
  /** When true, speaker-labeled segments are persisted with the saved ticket. */
  saveSpeakerLabeledTranscript: boolean;

  writingStyle: WritingStyleSettings;
  correctionDictionary: CorrectionEntry[];
  nameCorrections: NameCorrection[];
  enableTranscriptCorrection: boolean;
  enableNumberWordNormalization: boolean;

  portableMode: boolean;
  dataDir: string;

  disableHistory: boolean;
  autoDeleteAfterDays: number;
  localOnlyLock: boolean;

  reminderSettings: ReminderSettings;
  fieldMapping: FieldMappingSettings;

  liveAssist: LiveAssistSettings;
}

export const DEFAULT_SETTINGS: AppSettings = {
  technicianName: "Seif",
  defaultDetailLevel: "Normal",
  theme: "system",
  userMode: "daily",
  autoSaveOnGenerate: true,
  askBeforeDelete: true,

  aiProvider: "rule-based",
  ollamaEndpoint: "http://localhost:11434",
  ollamaModel: "llama3.1:8b",
  lmStudioEndpoint: "http://localhost:1234/v1",
  temperature: 0.2,
  maxTokens: 800,
  timeoutMs: 30000,
  fallbackToRuleBased: true,

  transcriptionMode: "manual",
  whisperExecutablePath: "",
  whisperModelPath: "",
  whisperLanguage: "en",
  whisperThreads: 4,
  whisperPrompt:
    "This is a retail IT support call. Common words include store, register, POS, receipt printer, VeriFone, pin pad, Inseego, COM services, Pro services, BOS, PCF, operator ID, employee ID, power drain, transaction number, item number.",
  audioInputDeviceId: "",
  microphoneCalibrations: {},
  audioNoiseSuppression: true,
  audioEchoCancellation: true,
  audioAutoGainControl: true,
  saveAudio: true,
  deleteAudioAfterTranscription: false,
  saveTranscriptWithAudio: true,
  saveSpeakerLabeledTranscript: true,

  writingStyle: { ...DEFAULT_WRITING_STYLE },
  correctionDictionary: [...DEFAULT_CORRECTION_DICTIONARY],
  nameCorrections: [],
  enableTranscriptCorrection: true,
  enableNumberWordNormalization: true,

  portableMode: false,
  dataDir: "",

  disableHistory: false,
  autoDeleteAfterDays: 0,
  localOnlyLock: true,

  reminderSettings: { ...DEFAULT_REMINDER_SETTINGS },
  fieldMapping: {
    ...DEFAULT_FIELD_MAPPING_SETTINGS,
    entries: DEFAULT_FIELD_MAPPING_SETTINGS.entries.map((e) => ({ ...e })),
  },

  liveAssist: { ...DEFAULT_LIVE_ASSIST },
};
