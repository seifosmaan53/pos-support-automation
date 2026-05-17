/**
 * Phase 10A: Inline answers from the Live Assist panel.
 *
 * The user can answer "Missing — ask the caller" prompts in-place during a
 * call. Each answer flows through the store and is re-applied on top of the
 * analyzer's output every time `analyzeCurrentTranscript` runs, so manual
 * answers always survive a re-analysis.
 *
 * Future phases (B / C) will use these answers as training signal to learn
 * patterns from real calls. For now, they're a pure override layer.
 */
import type { ExtractedDetails, TicketFields, TicketResult } from "./ticket";

/** Field kinds the user can answer inline from Missing alerts. */
export type LiveAssistAnswerKind =
  | "storeNumber"
  | "callerName"
  | "registerNumber"
  | "errorMessage"
  | "result";

/** Stored answers, keyed by kind. Values absent ⇒ "user has not answered". */
export interface LiveAssistAnswers {
  storeNumber?: string;
  callerName?: string;
  registerNumber?: string;
  errorMessage?: string;
  result?: TicketResult;
}

/** Apply pending answers as overrides on top of an `ExtractedDetails`. */
export function applyLiveAssistAnswersToDetails(
  d: ExtractedDetails,
  a: LiveAssistAnswers,
): ExtractedDetails {
  if (Object.keys(a).length === 0) return d;
  const next: ExtractedDetails = {
    ...d,
    storeNumber: a.storeNumber?.trim() || d.storeNumber,
    callerName: a.callerName?.trim() || d.callerName,
    contactName: a.callerName?.trim() || d.contactName,
    requesterName: a.callerName?.trim() || d.requesterName,
    registerNumber: a.registerNumber?.trim() || d.registerNumber,
    errorMessage: a.errorMessage?.trim() || d.errorMessage,
  };
  if (a.result) {
    next.result = a.result;
    next.isResolved = a.result === "Resolved";
    next.isPending = a.result === "Pending" || a.result === "FollowUpRequired";
    next.isEscalated = a.result === "Escalated";
  }
  return next;
}

/**
 * Apply answers to the user-visible TicketFields.
 *
 * `callerName` is split: it lands in both `contactName` and `requesterName`
 * because tickets in the user's real system want the caller present in both
 * (Contact = the person who called; Requester = the originator). They're often
 * the same person but the user can edit them post-hoc on the form helper.
 */
export function applyLiveAssistAnswersToFields(
  f: TicketFields,
  a: LiveAssistAnswers,
): TicketFields {
  if (Object.keys(a).length === 0) return f;
  return {
    ...f,
    storeNumber: a.storeNumber?.trim() || f.storeNumber,
    contactName: a.callerName?.trim() || f.contactName,
    requesterName: a.callerName?.trim() || f.requesterName,
    registerNumber: a.registerNumber?.trim() || f.registerNumber,
  };
}
