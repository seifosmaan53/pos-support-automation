/**
 * Phase 4: correction-learning types.
 *
 * The schema's `ticket_feedback` row carries the raw corrected fields plus
 * a free-form `corrected_fields_json` blob and a `what_ai_missed` note.
 * `TicketFeedback` mirrors that 1:1 so persistence is a flat write.
 *
 * `FieldCorrection` is the unit the UI captures when the user edits a
 * generated field — we record `before` / `after` so a later Phase (ticket
 * intelligence) can train on the diff. Multiple corrections fold into one
 * `TicketFeedback` row via `correctedFields`.
 */

export type ResolutionStatus = "unknown" | "worked" | "did-not-work";

export type CorrectableField =
  | "subject"
  | "description"
  | "resolution"
  | "additionalComments"
  | "partRequest"
  | "storeNumber"
  | "callerName"
  | "registerNumber"
  | "deviceType"
  | "result"
  | "speakerLabel"
  | "transcriptCorrection"
  | "other";

export const CORRECTABLE_FIELDS: { value: CorrectableField; label: string }[] = [
  { value: "subject", label: "Subject" },
  { value: "description", label: "Description" },
  { value: "resolution", label: "Resolution" },
  { value: "additionalComments", label: "Additional Comments" },
  { value: "partRequest", label: "Part Request" },
  { value: "storeNumber", label: "Store Number" },
  { value: "callerName", label: "Caller Name" },
  { value: "registerNumber", label: "Register Number" },
  { value: "deviceType", label: "Device" },
  { value: "result", label: "Result" },
  { value: "speakerLabel", label: "Speaker Labels" },
  { value: "transcriptCorrection", label: "Transcript Corrections" },
  { value: "other", label: "Other" },
];

export interface FieldCorrection {
  field: CorrectableField;
  before: string;
  after: string;
  /** Free-form note the user can attach (eg. "AI dropped the part number"). */
  note?: string;
  createdAt: string;
}

export interface TicketFeedback {
  id: string;
  ticketId: string;
  /**
   * Snapshot of the AI-generated subject/description/resolution at the time
   * feedback was recorded. Lets later passes diff against the corrected
   * versions without needing to look up an ancient ticket history.
   */
  originalSubject: string;
  correctedSubject: string;
  originalDescription: string;
  correctedDescription: string;
  originalResolution: string;
  correctedResolution: string;
  /**
   * Map of field → { before, after, note? }. Stored as JSON so the schema
   * absorbs new field types (eg. `serviceCategory`) without an ALTER.
   */
  correctedFields: FieldCorrection[];
  /** Free-form "AI missed: ..." note. */
  whatAiMissed: string;
  resolutionWorked: ResolutionStatus;
  /** Optional reference to a Style Example created from this ticket. */
  styleExampleId?: string | null;
  createdAt: string;
}
