export type DetailLevel =
  | "Short"
  | "Normal"
  | "Detailed"
  | "Technical"
  | "ManagementSummary";

export const DETAIL_LEVELS: { value: DetailLevel; label: string; hint: string }[] = [
  { value: "Short", label: "Short", hint: "1 sentence" },
  { value: "Normal", label: "Normal", hint: "2–4 sentences (default)" },
  { value: "Detailed", label: "Detailed", hint: "Timeline-style" },
  { value: "Technical", label: "Technical", hint: "Tech-focused phrasing" },
  { value: "ManagementSummary", label: "Management Summary", hint: "Non-technical" },
];

export type TicketResult =
  | "Resolved"
  | "Escalated"
  | "Transferred"
  | "WrongCaller"
  | "Pending"
  | "PartsNeeded"
  | "FollowUpRequired"
  | "Monitoring"
  | "StoreDidNotAnswer"
  | "WaitingOnStore"
  | "WaitingOnVendor"
  | "CouldNotReproduce"
  | "ResultNotConfirmed";

export const TICKET_RESULTS: { value: TicketResult; label: string }[] = [
  { value: "Resolved", label: "Resolved" },
  { value: "Escalated", label: "Escalated" },
  { value: "Transferred", label: "Transferred" },
  { value: "WrongCaller", label: "Wrong Caller" },
  { value: "Pending", label: "Pending" },
  { value: "PartsNeeded", label: "Parts Needed" },
  { value: "FollowUpRequired", label: "Follow-up Required" },
  { value: "Monitoring", label: "Monitoring" },
  { value: "StoreDidNotAnswer", label: "Store Did Not Answer" },
  { value: "WaitingOnStore", label: "Waiting on Store" },
  { value: "WaitingOnVendor", label: "Waiting on Vendor" },
  { value: "CouldNotReproduce", label: "Could Not Reproduce" },
  { value: "ResultNotConfirmed", label: "Result Not Confirmed" },
];

export interface ExtractedEvidence {
  storeNumber: string;
  callerName: string;
  registerNumber: string;
  issue: string;
  errorMessage: string;
  stepsTaken: string;
  result: string;
  partNeeded: string;
}

export const EMPTY_EVIDENCE: ExtractedEvidence = {
  storeNumber: "",
  callerName: "",
  registerNumber: "",
  issue: "",
  errorMessage: "",
  stepsTaken: "",
  result: "",
  partNeeded: "",
};

export interface ExtractedDetails {
  storeNumber: string;
  storeName: string;
  callerName: string;
  callerRole: string;
  contactName: string;
  requesterName: string;
  registerNumber: string;
  affectedRegisters: string[];
  deviceType: string;
  deviceName: string;
  deviceLocation: string;
  dateTimeOfIssue: string;
  category: string;
  subCategory: string;
  item: string;
  transactionNumber: string;
  itemNumber: string;
  employeeName: string;
  employeeId: string;
  operatorId: string;
  typeOfTransaction: string;
  paymentType: string;
  issue: string;
  symptoms: string[];
  errorMessage: string;
  steps: string[];
  servicesRestarted: string[];
  cacheRenamed: boolean;
  powerDrainPerformed: boolean;
  manualRebootPerformed: boolean;
  cablesReseated: boolean;
  connectionsConfirmed: boolean;
  result: TicketResult;
  isResolved: boolean;
  isPending: boolean;
  isEscalated: boolean;
  parts: string[];
  partNeeded: boolean;
  partRequest: string;
  replacementReason: string;
  existingTicketMentioned: boolean;
  existingTicketDetails: string;
  vendorTicketNumber: string;
  devices: string[];
  systems: string[];
  escalationNeeded: boolean;
  followUpNeeded: boolean;
  wrongCaller: boolean;
  transferNeeded: boolean;
  transferDepartment: string;
  storeWasAdvised: string;
  caller: string;
  technicianAction: string;
  confirmationMethod: string;
  notes: string;
  confidenceNotes: string[];
  missingInfo: string[];
  suggestedQuestions: string[];
  evidence: ExtractedEvidence;
}

export const EMPTY_DETAILS: ExtractedDetails = {
  storeNumber: "",
  storeName: "",
  callerName: "",
  callerRole: "",
  contactName: "",
  requesterName: "",
  registerNumber: "",
  affectedRegisters: [],
  deviceType: "",
  deviceName: "",
  deviceLocation: "",
  dateTimeOfIssue: "",
  category: "",
  subCategory: "",
  item: "",
  transactionNumber: "",
  itemNumber: "",
  employeeName: "",
  employeeId: "",
  operatorId: "",
  typeOfTransaction: "",
  paymentType: "",
  issue: "",
  symptoms: [],
  errorMessage: "",
  steps: [],
  servicesRestarted: [],
  cacheRenamed: false,
  powerDrainPerformed: false,
  manualRebootPerformed: false,
  cablesReseated: false,
  connectionsConfirmed: false,
  result: "ResultNotConfirmed",
  isResolved: false,
  isPending: false,
  isEscalated: false,
  parts: [],
  partNeeded: false,
  partRequest: "",
  replacementReason: "",
  existingTicketMentioned: false,
  existingTicketDetails: "",
  vendorTicketNumber: "",
  devices: [],
  systems: [],
  escalationNeeded: false,
  followUpNeeded: false,
  wrongCaller: false,
  transferNeeded: false,
  transferDepartment: "",
  storeWasAdvised: "",
  caller: "",
  technicianAction: "",
  confirmationMethod: "",
  notes: "",
  confidenceNotes: [],
  missingInfo: [],
  suggestedQuestions: [],
  evidence: { ...EMPTY_EVIDENCE },
};

export type SummaryVariant =
  | "original"
  | "clean"
  | "cleanSummary"
  | "short"
  | "normal"
  | "detailed"
  | "technical"
  | "management";

export const SUMMARY_VARIANTS: { value: SummaryVariant; label: string; hint: string }[] = [
  { value: "original", label: "Original Transcript", hint: "Raw, unmodified" },
  { value: "clean", label: "Cleaned Transcript", hint: "Light cleanup, same wording" },
  { value: "cleanSummary", label: "Original Summary", hint: "Faithful 2–4 sentence summary" },
  { value: "short", label: "Short", hint: "1 sentence" },
  { value: "normal", label: "Normal", hint: "Ticket description style" },
  { value: "detailed", label: "Detailed", hint: "Timeline-style" },
  { value: "technical", label: "Technical", hint: "Tech-focused" },
  { value: "management", label: "Management", hint: "Non-technical overview" },
];

export interface SummarySet {
  original: string;
  clean: string;
  cleanSummary: string;
  short: string;
  normal: string;
  detailed: string;
  technical: string;
  management: string;
}

export const EMPTY_SUMMARIES: SummarySet = {
  original: "",
  clean: "",
  cleanSummary: "",
  short: "",
  normal: "",
  detailed: "",
  technical: "",
  management: "",
};

export interface TicketFields {
  site: string;
  storeNumber: string;
  registerNumber: string;
  dateTimeOfIssue: string;
  contactName: string;
  requesterName: string;
  impact: string;
  urgency: string;
  mode: string;
  requestType: string;
  serviceCategory: string;
  status: string;
  category: string;
  subCategory: string;
  item: string;
  transactionNumber: string;
  itemNumber: string;
  typeOfTransaction: string;
  paymentType: string;
  technician: string;
  subject: string;
  description: string;
  resolution: string;
  partRequest: string;
  additionalComments: string;
  forwardTo: string;
  missingInfoWarnings: string[];
  capturedNotices: string[];
  suggestedQuestions: string[];
}

export const EMPTY_TICKET_FIELDS: TicketFields = {
  site: "Stores",
  storeNumber: "",
  registerNumber: "",
  dateTimeOfIssue: "",
  contactName: "",
  requesterName: "",
  impact: "Affects Store",
  urgency: "Normal",
  mode: "Phone Call",
  requestType: "Incident",
  serviceCategory: "",
  status: "Open",
  category: "",
  subCategory: "",
  item: "",
  transactionNumber: "",
  itemNumber: "",
  typeOfTransaction: "",
  paymentType: "",
  technician: "",
  subject: "",
  description: "",
  resolution: "",
  partRequest: "",
  additionalComments: "",
  forwardTo: "",
  missingInfoWarnings: [],
  capturedNotices: [],
  suggestedQuestions: [],
};

/**
 * Persisted record of a transcript-repair change. Mirrors `CorrectionChange`
 * from `services/transcriptCorrector` but is duplicated here so the saved-ticket
 * schema doesn't transitively depend on a service.
 */
export interface SavedCorrectionChange {
  from: string;
  to: string;
  source: "domain" | "number-words" | "dictionary";
  autoApply: boolean;
}

export interface SavedNameCorrection {
  detected: string;
  corrected: string;
}

/**
 * Persisted speaker segment. Includes the audit fields the spec calls for
 * (originalText / repairedText / reason / userCorrected) so that re-opening a
 * saved ticket reproduces the same speaker-labeled view the user submitted.
 */
export interface SavedSpeakerSegment {
  id: string;
  originalText: string;
  repairedText: string;
  speakerLabel: string;
  confidence: "high" | "medium" | "low";
  reason: string;
  userCorrected: boolean;
  timestampStart?: string;
  timestampEnd?: string;
}

export interface SavedTicket {
  id: string;
  createdAt: string;
  updatedAt: string;
  /** Kept for back-compat; mirrors `rawTranscript` for legacy code paths. */
  transcript: string;
  details: ExtractedDetails;
  summaries: SummarySet;
  ticketFields: TicketFields;
  generatedTicket: string;
  detailLevel: DetailLevel;
  reviewed: boolean;
  copied: boolean;

  // ── Audit / repair trail ────────────────────────────────────────────
  rawTranscript: string;
  correctedTranscript: string;
  speakerSegments: SavedSpeakerSegment[];
  userCorrectedSpeakerSegments: SavedSpeakerSegment[];
  correctionChanges: SavedCorrectionChange[];
  approvedCorrections: SavedCorrectionChange[];
  undoneCorrections: SavedCorrectionChange[];
  nameCorrectionsApplied: SavedNameCorrection[];
  extractionSourceVersion: string;
  extractionTimestamp: string;

  // ── Phase 3 audio + transcript versioning ──────────────────────────
  /**
   * Foreign key into `audio_files`. Set when an audio recording was saved
   * along with the ticket. `null` / `undefined` means no audio was attached.
   * Note: a non-null `audioId` does NOT guarantee the audio file still
   * exists — the audio_files row may have `deleted = true` after the user
   * removed the recording. Inspect view has to look both up.
   */
  audioId?: string | null;

  /**
   * Append-only history of transcript revisions for this ticket. Stored as
   * JSON on the ticket row for now; the design accommodates promoting to a
   * `transcript_versions` table later without changing this shape. The
   * original transcript is always seeded as the first entry on first save.
   */
  transcriptVersions?: import("./audio").TranscriptVersion[];

  // ── Phase 9: Copy log (per-ticket field-copy history) ──────────────
  /** Append-only list of copy events per field. Optional for back-compat. */
  copyLog?: import("./copyMode").CopyLogEntry[];
  /** Set to true when the user reaches Finish in the Sequential Copy flow. */
  copySequenceCompleted?: boolean;
}

/** Bumped whenever the analyzer logic changes in a way that would alter results. */
export const EXTRACTION_SOURCE_VERSION = "sta-extractor-2026-04-29";

export const EXTRACTION_SELF_TEST_FIELDS = [
  "storeNumber",
  "callerName",
  "registerNumber",
  "deviceType",
  "issue",
  "errorMessage",
  "stepsTaken",
  "result",
  "isResolved",
  "partNeeded",
  "partRequest",
  "subject",
  "description",
  "resolution",
  "warnings",
  "suggestedQuestions",
] as const;

export type ExtractionSelfTestField = (typeof EXTRACTION_SELF_TEST_FIELDS)[number];
