import type { ExtractedDetails, SummarySet } from "../types/ticket";
import type { WritingStyleSettings } from "../types/settings";
import { DEFAULT_WRITING_STYLE } from "../types/settings";
import { generateTicket } from "./ticketGenerator";
import {
  articleFor,
  capitalize,
  collapseWhitespace,
  displayStoreNumber,
  ensurePeriod,
  isFiniteIssueClause,
  issueToDescriptionOpening,
  joinWithAnd,
  normalizeIssuePhrase,
  normalizeTroubleshootingStep,
  pastTenseIssue,
  transformStep,
} from "../utils/cleanText";
import { resultSentence } from "../utils/resultWording";

export interface SummaryInput {
  transcript: string;
  details: ExtractedDetails;
  cleanedTranscript?: string;
  writingStyle?: WritingStyleSettings;
}

/**
 * Build all eight summary variants the UI needs.
 *
 * - `original`     : raw transcript, exactly as captured.
 * - `clean`        : transcript with light filler-word cleanup, same wording.
 * - `cleanSummary` : a 2–4 sentence narrative summary built from STRUCTURED
 *                    FACTS only — never raw dialogue. This is the variant the
 *                    UI labels "Original Summary".
 * - `short` / `normal` / `detailed` / `technical` / `management`
 *                  : the five ticket-style summaries, also from structured facts.
 *
 * Critical contract: anything that is *not* `original` or `clean` MUST come
 * from structured fields. The summary generator never echoes transcript
 * sentences back as a "summary" — that was the source of the dialogue-style
 * output we used to ship.
 */
export function generateAllSummaries({
  transcript,
  details,
  cleanedTranscript,
  writingStyle,
}: SummaryInput): SummarySet {
  void writingStyle; // Reserved for future style hooks; level templates carry style today.
  const cleaned = cleanedTranscript?.trim() || cleanFiller(transcript);
  return {
    original: transcript.trim(),
    clean: cleaned,
    cleanSummary: composeNarrativeSummary(details),
    short: generateTicket({ detailLevel: "Short", details }),
    normal: generateTicket({ detailLevel: "Normal", details }),
    detailed: generateTicket({ detailLevel: "Detailed", details }),
    technical: generateTicket({ detailLevel: "Technical", details }),
    management: generateTicket({ detailLevel: "ManagementSummary", details }),
  };
}

/**
 * A faithful narrative summary in 2–4 sentences. Reads like a person describing
 * the call — not a dialogue, not a bullet list, not a ticket form.
 *
 * Order: who/what called → symptom → what was done → outcome. We never pull
 * sentences from the transcript here, because transcripts are often raw
 * back-and-forth dialogue and would surface things like "Hi, this is Store 9.
 * Unplug the printer." as a "summary".
 */
function composeNarrativeSummary(d: ExtractedDetails): string {
  // Wrong-caller and transfer outcomes are special — describe them on their own
  // terms instead of forcing them through the troubleshooting narrative.
  if (d.result === "WrongCaller") {
    const dept = d.transferDepartment ? ` (${d.transferDepartment})` : "";
    return collapseWhitespace(
      `A caller reached this department by mistake. The issue described did not belong to this team, so the caller was redirected to the appropriate department${dept}.`,
    );
  }
  if (d.result === "Transferred") {
    const store = d.storeNumber ? `Store ${displayStoreNumber(d.storeNumber)}` : "A store";
    const issue = stripLeadingArticle(pastTenseIssue(d.issue) || "an issue");
    const dept = d.transferDepartment ? ` to ${d.transferDepartment}` : "";
    return collapseWhitespace(
      `${store} called regarding ${issue}. After initial intake, the caller was transferred${dept} so the correct team could take over.`,
    );
  }

  const sentences: string[] = [];

  // Sentence 1 — who called and what they reported.
  const opener = composeOpener(d);
  sentences.push(opener);

  // Sentence 2 — error/transaction context, only if present.
  if (d.errorMessage) {
    sentences.push(`The system displayed: "${d.errorMessage}".`);
  } else if (d.transactionNumber) {
    sentences.push(`The transaction number was ${d.transactionNumber}.`);
  }

  // Sentence 3 — what was done.
  const stepsList = collectSteps(d);
  if (stepsList.length > 0) {
    sentences.push(`${capitalize(joinWithAnd(stepsList))} to address the issue.`);
  }

  // Sentence 4 — the result.
  sentences.push(narrativeOutcome(d));

  // Cap at 4 sentences — anything longer should use the Detailed view.
  return collapseWhitespace(sentences.slice(0, 4).filter(Boolean).join(" "));
}

function composeOpener(d: ExtractedDetails): string {
  const store = d.storeNumber ? `Store ${displayStoreNumber(d.storeNumber)}` : "A store";
  const caller = d.callerName
    ? `${d.callerName} from ${store}`
    : d.callerRole
      ? `The ${d.callerRole.toLowerCase()} from ${store}`
      : store;

  const reg = d.registerNumber ? `on Register ${d.registerNumber}` : "";

  // Device-led opener: keep "a {device} issue" / "the {device} {clause-tail}"
  // shapes that read tightly when the analyzer is confident about the device.
  if (d.deviceType) {
    const phrase = normalizeIssuePhrase(d.issue || "");
    const tail = trimLeadingDevice(phrase, d.deviceType);
    if (tail && isFiniteIssueClause(tail)) {
      const past = pastTenseIssue(tail);
      return ensurePeriod(
        `${caller} called reporting that the ${d.deviceType}${reg ? ` ${reg}` : ""} ${past}`,
      );
    }
    return ensurePeriod(
      `${caller} called regarding ${articleFor(d.deviceType)} ${d.deviceType} issue${reg ? ` ${reg}` : ""}`,
    );
  }

  // No device → fall back to the canonical NP-vs-clause router so we never
  // emit a "called reporting that the credit card machine issue" hybrid.
  return issueToDescriptionOpening(caller, d.issue || "an issue");
}

function collectSteps(d: ExtractedDetails): string[] {
  const bits: string[] = [];
  if (d.servicesRestarted.length > 0)
    bits.push(`the ${joinWithAnd(d.servicesRestarted)} were restarted`);
  if (d.cacheRenamed) bits.push("the cache was renamed");
  if (d.powerDrainPerformed) bits.push("a power drain was performed");
  if (d.manualRebootPerformed) bits.push("the device was manually rebooted");
  if (d.cablesReseated) bits.push("the cables were reseated");
  if (d.connectionsConfirmed) bits.push("the connection was checked");
  for (const raw of d.steps) {
    // Normalize dialogue→ticket verbs first, then transform to past tense so
    // "escaped out of" → "exited out of" and "advised store" → "advised the
    // store" before the step is folded into the narrative.
    const past = transformStep(normalizeTroubleshootingStep(raw), "past");
    const lower = past.toLowerCase();
    if (bits.some((b) => b.toLowerCase().includes(lower))) continue;
    bits.push(`tech support ${past}`);
  }
  return dedupe(bits);
}

function narrativeOutcome(d: ExtractedDetails): string {
  if (d.result === "Resolved") {
    if (d.confirmationMethod === "Successful test print") {
      return "After the restart, the test print completed successfully and the issue was resolved.";
    }
    if (d.confirmationMethod) {
      return `The store confirmed ${d.confirmationMethod.toLowerCase()} and the issue was resolved.`;
    }
    if (d.affectedRegisters.length > 0 && d.affectedRegisters.some((r) => /both|all/i.test(r))) {
      return `${capitalize(d.affectedRegisters[0])} came back online and the issue was resolved.`;
    }
    return "The issue was confirmed resolved.";
  }
  if (d.result === "PartsNeeded") {
    const dev = d.deviceType || "device";
    return `A replacement ${dev} is needed; a replacement ticket will be opened.`;
  }
  if (d.result === "Escalated") return "The case was escalated for further review.";
  if (d.result === "FollowUpRequired") return "Follow-up is required.";
  if (d.result === "Pending") return "The issue is still pending.";
  if (d.result === "WaitingOnVendor") return "The case is waiting on a vendor response.";
  if (d.result === "WaitingOnStore") return "The case is waiting on the store.";
  if (d.result === "StoreDidNotAnswer") return "The store did not answer for follow-up.";
  if (d.result === "CouldNotReproduce") return "The issue could not be reproduced.";
  if (d.result === "Monitoring") return "The issue is being monitored.";
  return resultSentence(d.result);
}

function stripLeadingArticle(s: string): string {
  return s.replace(/^the\s+/i, "").replace(/^a\s+/i, "").trim();
}

function trimLeadingDevice(issue: string, device: string): string {
  const re = new RegExp(`^${device.replace(/\s+/g, "\\s+")}\\s+`, "i");
  return issue.replace(re, "").trim();
}

function dedupe<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

/**
 * Light filler-word cleanup for the "Cleaned Transcript" view.
 * This intentionally keeps the original wording and order — it is NOT a
 * summary. Use composeNarrativeSummary or generateTicket for those.
 */
function cleanFiller(transcript: string): string {
  let t = transcript.trim();
  if (!t) return "";

  t = t.replace(/\b(uh|um|er|hmm|like)\b[\s,]*/gi, "");
  t = t.replace(/\b(you know|i mean|i guess|sort of|kind of)\b[\s,]*/gi, "");
  t = t.replace(/\b(so|then),\s+/gi, "$1 ");
  t = t.replace(/\s+/g, " ").trim();

  const sentences = t
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => capitalize(s));

  return collapseWhitespace(sentences.join(" "));
}
