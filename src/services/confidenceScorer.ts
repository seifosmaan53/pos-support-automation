import type { ExtractedDetails, TicketFields } from "../types/ticket";
import type { SpeakerLabel, SpeakerSegment } from "../types/speaker";
import type {
  ConfidenceLevel,
  FieldConfidence,
  SelfReviewResult,
} from "../types/confidence";

export interface SelfReviewInput {
  details: ExtractedDetails;
  fields: TicketFields;
  speakerSegments: SpeakerSegment[];
  transcript: string;
}

/**
 * Audits the extracted details and ticket fields. Produces per-field confidence,
 * overall confidence, and a list of flags the user should review.
 *
 * The audit checks the 11 questions from the spec:
 *   - Did we capture the store number?
 *   - Caller name? Register number? Device name?
 *   - Exact error message? Troubleshooting steps?
 *   - Did we separate issue from resolution?
 *   - Did we avoid inventing anything?
 *   - Did we generate warnings for missing details?
 *   - Did we generate suggested questions?
 */
export function runSelfReview({
  details,
  fields,
  speakerSegments,
  transcript,
}: SelfReviewInput): SelfReviewResult {
  const lower = transcript.toLowerCase();

  const fieldsScored: FieldConfidence[] = [
    scoreStoreNumber(details, lower),
    scoreCaller(details, lower),
    scoreRegister(details, lower),
    scoreDevice(details),
    scoreErrorMessage(details, lower),
    scoreSteps(details),
    scoreResult(details),
    scorePartRequest(details, fields),
    scoreSubjectDescription(fields),
    scoreResolution(fields),
  ];

  const flags: string[] = [];

  // Check that issue and resolution don't share the exact same text.
  if (
    fields.description &&
    fields.resolution &&
    fields.description.trim().toLowerCase() === fields.resolution.trim().toLowerCase()
  ) {
    flags.push(
      "Description and resolution are identical. Confirm the issue text is separate from the fix.",
    );
  }

  // Hallucination heuristic: if a numeric field appears in fields but not in transcript.
  if (details.storeNumber && !lower.replace(/\D/g, "").includes(details.storeNumber.replace(/^0+/, ""))) {
    flags.push(
      `Store number "${details.storeNumber}" was not found in the transcript. Verify before submitting.`,
    );
  }
  if (details.transactionNumber && !transcript.includes(details.transactionNumber)) {
    flags.push(
      `Transaction number "${details.transactionNumber}" was not found in the transcript.`,
    );
  }

  // Speaker mismatch: error message appears to come from tech support, not store.
  if (details.errorMessage && speakerSegments.length > 0) {
    const errorOwner = whichSpeakerSaidIt(speakerSegments, details.errorMessage);
    if (errorOwner === "tech_support") {
      flags.push(
        `Exact error message "${details.errorMessage.slice(0, 60)}…" appears to come from tech support, not the store. Confirm who reported it.`,
      );
    }
  }

  // Steps mostly come from tech support; if they appear from the store, flag.
  if (details.steps.length > 0 && speakerSegments.length > 0) {
    for (const step of details.steps) {
      const owner = whichSpeakerSaidIt(speakerSegments, step);
      if (owner === "store_employee") {
        flags.push(
          `Step "${step.slice(0, 50)}…" was attributed to the store employee. Confirm whether tech support or the store performed it.`,
        );
        break; // one flag is enough
      }
    }
  }

  // Number-word ambiguity warning: did transcript contain "registering one" (mishearing of Register 1)?
  if (/registering\s+one\b/i.test(transcript) && !/Register\s+1\b/.test(transcript)) {
    flags.push(
      'Transcript says "registering one," which may mean "Register 1." Confirm with the store.',
    );
  }

  if (!fields.missingInfoWarnings.length && fieldsScored.some((f) => f.level === "missing")) {
    flags.push("Missing-detail warnings were not generated despite missing fields. Re-run analysis.");
  }
  if (!fields.suggestedQuestions.length && hasEnoughIssue(details)) {
    flags.push("Suggested questions list is empty. Re-run analysis to populate it.");
  }

  const overall = aggregateConfidence(fieldsScored, flags.length);

  return {
    overall,
    fields: fieldsScored,
    flags,
    reviewRecommended: overall !== "high" || flags.length > 0,
  };
}

function scoreStoreNumber(d: ExtractedDetails, lowerTranscript: string): FieldConfidence {
  if (!d.storeNumber) {
    return { field: "Store Number", level: "missing", reason: "Not captured." };
  }
  const stripped = d.storeNumber.replace(/^0+/, "");
  if (lowerTranscript.includes(stripped)) {
    return {
      field: "Store Number",
      level: "high",
      reason: `Matches "${stripped}" in transcript.`,
    };
  }
  return {
    field: "Store Number",
    level: "low",
    reason: "Captured value not found in transcript.",
  };
}

function scoreCaller(d: ExtractedDetails, lower: string): FieldConfidence {
  if (!d.callerName && !d.callerRole) {
    return { field: "Caller", level: "missing", reason: "Not captured." };
  }
  if (d.callerName && lower.includes(d.callerName.toLowerCase())) {
    return { field: "Caller", level: "high", reason: `"${d.callerName}" appears in transcript.` };
  }
  if (d.callerRole) {
    return { field: "Caller", level: "medium", reason: "Role captured but no name." };
  }
  return { field: "Caller", level: "low", reason: "Caller text not verified in transcript." };
}

function scoreRegister(d: ExtractedDetails, lower: string): FieldConfidence {
  if (!d.registerNumber && d.affectedRegisters.length === 0) {
    if (/\bregister|\bpos\b|\bpin\s*pad\b/i.test(lower)) {
      return {
        field: "Register",
        level: "missing",
        reason: "Register implied but no number captured.",
      };
    }
    return { field: "Register", level: "missing", reason: "No register mentioned." };
  }
  if (d.registerNumber) {
    return {
      field: "Register",
      level: "high",
      reason: `Register ${d.registerNumber} captured.`,
    };
  }
  return {
    field: "Register",
    level: "medium",
    reason: `Affected: ${d.affectedRegisters.join(", ")}`,
  };
}

function scoreDevice(d: ExtractedDetails): FieldConfidence {
  if (!d.deviceType && d.devices.length === 0) {
    return { field: "Device", level: "low", reason: "Device type not detected." };
  }
  return {
    field: "Device",
    level: "high",
    reason: d.deviceType || d.devices.join(", "),
  };
}

function scoreErrorMessage(d: ExtractedDetails, lower: string): FieldConfidence {
  if (!d.errorMessage) {
    // "missing" is misleading for issues that aren't error-message-driven
    // (a sticky keyboard, a hardware short, a user-permission problem). Only
    // mark missing when the transcript actually mentions an error or shows
    // an issue type we expect to surface one (printer hardware failure, store
    // closed, etc.).
    const issueImpliesError =
      /\berror\b/i.test(lower) ||
      /\bhardware\s+failure\b/i.test(lower) ||
      /\bstore\s+closed\b/i.test(lower) ||
      /\b(?:says|saying|displayed|showed)\s+["']/i.test(lower);
    if (issueImpliesError) {
      return {
        field: "Error Message",
        level: "missing",
        reason: 'Transcript implies an error message but no exact message was captured.',
      };
    }
    return {
      field: "Error Message",
      level: "high",
      reason: "Not applicable for this issue.",
    };
  }
  if (lower.includes(d.errorMessage.toLowerCase())) {
    return {
      field: "Error Message",
      level: "high",
      reason: "Exact message matches transcript.",
    };
  }
  return {
    field: "Error Message",
    level: "low",
    reason: "Captured message not found verbatim in transcript.",
  };
}

function scoreSteps(d: ExtractedDetails): FieldConfidence {
  if (d.steps.length === 0) {
    return { field: "Troubleshooting Steps", level: "missing", reason: "No steps captured." };
  }
  if (d.steps.length >= 2) {
    return {
      field: "Troubleshooting Steps",
      level: "high",
      reason: `${d.steps.length} steps captured.`,
    };
  }
  return {
    field: "Troubleshooting Steps",
    level: "medium",
    reason: "Only one step captured.",
  };
}

function scoreResult(d: ExtractedDetails): FieldConfidence {
  if (d.result === "ResultNotConfirmed") {
    return { field: "Result", level: "missing", reason: "Final result not confirmed." };
  }
  return { field: "Result", level: "high", reason: d.result };
}

function scorePartRequest(d: ExtractedDetails, f: TicketFields): FieldConfidence {
  if (!d.partNeeded && !f.partRequest) {
    return { field: "Part Request", level: "high", reason: "Not needed." };
  }
  if (d.partNeeded && f.partRequest) {
    return { field: "Part Request", level: "high", reason: "Replacement requested." };
  }
  if (d.partNeeded && !f.partRequest) {
    return {
      field: "Part Request",
      level: "low",
      reason: "Replacement detected but no part request generated.",
    };
  }
  return { field: "Part Request", level: "medium", reason: "Manually added." };
}

function scoreSubjectDescription(f: TicketFields): FieldConfidence {
  if (!f.subject || !f.description) {
    return {
      field: "Subject/Description",
      level: "missing",
      reason: "Subject or description is empty.",
    };
  }
  if (f.description.length < 30) {
    return {
      field: "Subject/Description",
      level: "low",
      reason: "Description very short. Confirm it captures the issue.",
    };
  }
  return { field: "Subject/Description", level: "high", reason: "Both populated." };
}

function scoreResolution(f: TicketFields): FieldConfidence {
  if (!f.resolution) {
    return { field: "Resolution", level: "missing", reason: "Resolution is empty." };
  }
  if (f.resolution.length < 20) {
    return { field: "Resolution", level: "low", reason: "Resolution very short." };
  }
  return { field: "Resolution", level: "high", reason: "Populated." };
}

function aggregateConfidence(fields: FieldConfidence[], flagCount: number): ConfidenceLevel {
  const required = fields.filter((f) =>
    ["Store Number", "Caller", "Result", "Subject/Description"].includes(f.field),
  );
  if (required.some((f) => f.level === "missing" || f.level === "low")) return "low";
  if (flagCount > 0) return "medium";
  if (fields.some((f) => f.level === "missing")) return "medium";
  if (fields.some((f) => f.level === "low")) return "medium";
  return "high";
}

function whichSpeakerSaidIt(segments: SpeakerSegment[], needle: string): SpeakerLabel {
  const n = needle.trim().toLowerCase().slice(0, 40);
  for (const s of segments) {
    if (s.text.toLowerCase().includes(n)) return s.speaker;
  }
  return "unknown";
}

function hasEnoughIssue(d: ExtractedDetails): boolean {
  return (d.issue?.length ?? 0) > 0 || d.devices.length > 0;
}
