import type { ExtractedDetails, TicketFields } from "../types/ticket";
import { EMPTY_TICKET_FIELDS } from "../types/ticket";
import type { WritingStyleSettings } from "../types/settings";
import { DEFAULT_WRITING_STYLE } from "../types/settings";
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
  transformStep,
} from "../utils/cleanText";

const NOT_PROVIDED = "Not provided";
const NOT_CONFIRMED = "Not confirmed";

export interface FieldGenInput {
  details: ExtractedDetails;
  technicianName?: string;
  writingStyle?: WritingStyleSettings;
}

export function generateTicketFields({
  details,
  technicianName,
  writingStyle,
}: FieldGenInput): TicketFields {
  const style = writingStyle ?? DEFAULT_WRITING_STYLE;
  const subject = buildSubject(details);
  const description = buildDescription(details, style);
  const resolution = buildResolution(details, style);
  const partRequest = buildPartRequest(details);
  const additionalComments = buildAdditionalComments(details);
  const missingInfoWarnings = buildMissingInfoWarnings(details);
  const capturedNotices = buildCapturedNotices(details);

  return {
    ...EMPTY_TICKET_FIELDS,
    storeNumber: details.storeNumber || NOT_PROVIDED,
    registerNumber:
      details.registerNumber ||
      (details.affectedRegisters[0] ?? "") ||
      NOT_PROVIDED,
    dateTimeOfIssue: details.dateTimeOfIssue || NOT_PROVIDED,
    contactName:
      details.contactName ||
      details.callerName ||
      (details.callerRole ? details.callerRole : "") ||
      NOT_PROVIDED,
    requesterName:
      details.requesterName ||
      details.callerName ||
      (details.callerRole ? details.callerRole : "") ||
      NOT_PROVIDED,
    serviceCategory: details.category || NOT_CONFIRMED,
    category: details.category || NOT_CONFIRMED,
    subCategory: details.subCategory || NOT_CONFIRMED,
    item: details.item || NOT_CONFIRMED,
    transactionNumber: details.transactionNumber || NOT_PROVIDED,
    itemNumber: details.itemNumber || NOT_PROVIDED,
    typeOfTransaction: details.typeOfTransaction || NOT_PROVIDED,
    paymentType: details.paymentType || NOT_PROVIDED,
    technician: technicianName?.trim() || NOT_PROVIDED,
    subject,
    description,
    resolution,
    partRequest,
    additionalComments,
    forwardTo: NOT_PROVIDED,
    missingInfoWarnings,
    capturedNotices,
    suggestedQuestions: details.suggestedQuestions ?? [],
  };
}

// ─────────────────────────────────────────────────────────
// SUBJECT
// ─────────────────────────────────────────────────────────

export function buildSubject(d: ExtractedDetails): string {
  if (d.result === "WrongCaller") return "Wrong Caller / Redirected Call";
  // Display unpadded store numbers in the subject — internally storeNumber
  // is padded to 5 digits ("00521") for retail tooling, but a subject line
  // reading "Store 00521" looks like a bug to a human reader.
  const storeDisplay = d.storeNumber ? displayStoreNumber(d.storeNumber) : "";
  if (d.result === "Transferred") {
    const dept = d.transferDepartment ? ` to ${d.transferDepartment}` : "";
    const storePart = storeDisplay ? `Store ${storeDisplay}` : "Store Unknown";
    return `${storePart} - Transferred${dept}`;
  }
  const storePart = storeDisplay ? `Store ${storeDisplay}` : "Store Unknown";
  const issuePart = condenseIssueForSubject(d);
  if (!issuePart) return `${storePart} - Issue Reported`;
  return `${storePart} - ${issuePart}`;
}

function condenseIssueForSubject(d: ExtractedDetails): string {
  const text = `${d.issue || ""} ${d.errorMessage || ""} ${d.notes || ""}`.trim();
  const lower = text.toLowerCase();
  const reg = d.registerNumber ? `Register ${d.registerNumber}` : "";

  // Replacement-specific subjects
  if (d.partNeeded && /receipt\s+printer/i.test(text) && !/showing|hardware\s+failure/i.test(lower)) {
    return reg ? `Replacement Receipt Printer Request` : "Replacement Receipt Printer Request";
  }
  if (d.partNeeded && /keyboard/i.test(text) && !/click|typing/i.test(lower)) {
    return reg ? `Replacement Keyboard Request` : "Replacement Keyboard Request";
  }

  // Receipt printer + register + hardware failure (very common)
  if (/receipt\s+printer/i.test(lower) && /hardware\s+failure/i.test(lower)) {
    return reg ? `${reg} Receipt Printer Hardware Failure` : "Receipt Printer Hardware Failure";
  }
  if (/receipt\s+printer/i.test(lower) && reg) return `${reg} Receipt Printer Issue`;
  if (/receipt\s+printer/i.test(lower)) return "Receipt Printer Issue";

  // Keyboard + register
  if (/keyboard/i.test(lower) && reg) return `${reg} Keyboard Issue`;
  if (/keyboard/i.test(lower)) return "Keyboard Issue";

  if (/wrong\s+operator\s+id/i.test(lower)) return "Wrong Operator ID";
  if (/wrong\s+employee\s+id/i.test(lower)) return "Wrong Employee ID";
  if (/employee\s+(?:not\s+)?(?:showing|missing)\s+in\s+pcf|missing\s+in\s+pcf/i.test(lower))
    return "Employee Not Showing in PCF";
  if (/wisely\s+card/i.test(lower)) return "Wisely Card Issue";
  if (/verifone\s+system\s+information/i.test(lower)) return "VeriFone System Information";
  if (/verifone/i.test(lower)) return "VeriFone Issue";
  if (/lotus\s*notes/i.test(lower) && /phone/i.test(lower))
    return "Lotus Notes Email and Phone Line Issue";
  if (/lotus\s*notes/i.test(lower)) return "Lotus Notes Email Issue";
  if (/phone\s*line/i.test(lower)) return "Phone Line Issue";

  if (/store\s+closed/i.test(lower) && /start\s*of\s*day/i.test(lower))
    return "Store Closed Message After Start of Day";
  if (/store\s+closed/i.test(lower) && /terminal\s+closed/i.test(lower))
    return "Store Closed Message After Start of Day";
  if (/start\s*of\s*day/i.test(lower) || /\brenam(e|ed|ing)\s+(?:the\s+)?cache\b/i.test(lower))
    return "Start of Day Register Cache Issue";

  if (/internet/i.test(lower) && /(down|out|offline|instability|unstable)/i.test(lower))
    return "Internet Down";
  if (/internet/i.test(lower)) return "Internet Instability";
  if (/inseego/i.test(lower)) return "Internet Down";

  if (/\bbos\b/i.test(lower) && /employee/i.test(lower))
    return "BOS Stuck While Adding Employee";
  if (/\bbos\b/i.test(lower)) return "BOS Issue";
  if (/access\s+issue/i.test(lower) || /update.*progress|update.*30\s+min/i.test(lower))
    return "Access Issue During Update";
  if (/layaway/i.test(lower) && /(return|refund|error)/i.test(lower))
    return "Layaway Return Error";
  if (/exchange/i.test(lower) && /(return|process|wrong)/i.test(lower))
    return "Return Processed as Exchange";
  if (/no[-\s]?receipt\s+return/i.test(lower)) return "No-Receipt Return Issue";
  if (/return/i.test(lower) && /error/i.test(lower)) return "Return Error";
  if (/network\s*error/i.test(lower) && /receipt/i.test(lower))
    return "Out-of-State Receipt Network Error";
  if (/scanner/i.test(lower)) return "Scanner Issue";
  if (/cash\s*drawer/i.test(lower)) return "Cash Drawer Issue";

  if (/\bfailure\s+error\b/i.test(lower)) return "Failure Error Message";
  if (/gift\s*card/i.test(lower) && /refund|return/i.test(lower))
    return "Gift Card Transaction Refund";

  let short = (d.issue || "")
    .replace(/^the\s+/i, "")
    .replace(/^a\s+/i, "")
    .replace(/[.!?]+$/, "")
    .trim();

  short = short.split(/[.!?]/)[0].trim();
  const words = short.split(/\s+/).slice(0, 8);
  short = words.join(" ");
  return titleCase(short);
}

function titleCase(s: string): string {
  if (!s) return s;
  return s
    .split(/\s+/)
    .map((w, i) => {
      if (i > 0 && /^(of|the|a|an|and|or|but|for|in|on|at|to|by|with)$/i.test(w))
        return w.toLowerCase();
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    })
    .join(" ");
}

// ─────────────────────────────────────────────────────────
// DESCRIPTION
// ─────────────────────────────────────────────────────────

export function buildDescription(d: ExtractedDetails, style: WritingStyleSettings): string {
  if (d.result === "WrongCaller") {
    return "Caller contacted support, but the issue did not belong to this department.";
  }
  if (d.result === "Transferred") {
    const store = d.storeNumber
      ? `Store ${displayStoreNumber(d.storeNumber)}`
      : "A store";
    const issue = normalizeIssuePhrase(d.issue || "an issue");
    return `${store} called regarding ${issue}. The call was forwarded to the correct team for handling.`;
  }
  const opener = composeOpener(d, style);

  const detailParts: string[] = [];

  // Inline error message: "showing a 'hardware failure' error"
  if (d.errorMessage) {
    const msg = d.errorMessage.replace(/^["']|["']$/g, "");
    detailParts.push(`The system displayed: "${msg}".`);
  }

  // Register/transaction context
  const ctx: string[] = [];
  if (d.transactionNumber) ctx.push(`The transaction number was ${d.transactionNumber}`);
  if (d.itemNumber) ctx.push(`the item number was ${d.itemNumber}`);
  if (d.affectedRegisters.length > 1)
    ctx.push(`affecting ${joinWithAnd(d.affectedRegisters)}`);
  if (ctx.length) detailParts.push(capitalize(ctx.join(", ")) + ".");

  // Step list — picks "I {pasts}." for active-first-person voice and the
  // canonical "Troubleshooting included {gerunds}." pattern otherwise. Both
  // routes go through normalizeTroubleshootingStep so dialogue verbs
  // ("escaped out of") never leak into the final ticket.
  const stepNarrative = composeStepNarrative(d, style);
  if (stepNarrative) detailParts.push(stepNarrative);

  // Outcome sentence so the description always closes with the result, not
  // a stranded "I exited out of the transaction." with no verdict.
  const outcome = describeOutcome(d);
  if (outcome) detailParts.push(outcome);

  if (d.existingTicketMentioned) {
    const num = d.existingTicketDetails ? `: ${d.existingTicketDetails}` : "";
    detailParts.push(`An existing ticket was already open${num}.`);
  }

  return collapseWhitespace([opener, ...detailParts].filter(Boolean).join(" "));
}

/**
 * Compose the step-list sentence for the description, in the voice the user
 * configured. Two shapes:
 *
 *   - active-first-person → "I exited out of the transaction, …"
 *   - passive (default)  → "Troubleshooting included exiting out of the
 *                            transaction, …"
 *
 * Both forms go through {@link normalizeTroubleshootingStep} first, so
 * "escaped out of" / "advised store" never reach the user.
 */
function composeStepNarrative(d: ExtractedDetails, style: WritingStyleSettings): string {
  const stepBits: string[] = [];
  if (d.servicesRestarted.length > 0)
    stepBits.push(`restarted the ${joinWithAnd(d.servicesRestarted)}`);
  if (d.cacheRenamed) stepBits.push("renamed the cache");
  if (d.powerDrainPerformed) stepBits.push("performed a register power drain");
  if (d.manualRebootPerformed) stepBits.push("manually rebooted the device");
  if (d.cablesReseated) stepBits.push("reseated the cables");
  if (d.connectionsConfirmed) stepBits.push("checked the connection");
  for (const raw of d.steps) {
    const past = transformStep(normalizeTroubleshootingStep(raw), "past");
    const norm = past.toLowerCase().trim();
    if (!stepBits.some((b) => b.toLowerCase().trim() === norm)) stepBits.push(past);
  }

  const deduped = dedupe(stepBits);
  if (deduped.length === 0) return "";

  if (style.voice === "active-first-person") {
    // Convert each step's leading verb to imperative-as-past for first-person.
    return ensurePeriod(`I ${joinWithAnd(deduped)}`);
  }
  // Passive / default: gerund list after "Troubleshooting included".
  const gerunds = deduped.map((past) => transformStep(past, "gerund"));
  return ensurePeriod(`Troubleshooting included ${joinWithAnd(gerunds)}`);
}

/**
 * Outcome sentence for the description. Mirrors the ticket-generator outcome
 * but written for the description-context (not the resolution-context),
 * which is why it's separate from buildResolution.
 */
function describeOutcome(d: ExtractedDetails): string {
  if (d.result === "Resolved") {
    if (d.confirmationMethod === "Successful test print") {
      return "After the test print completed successfully, the issue was confirmed resolved.";
    }
    if (d.confirmationMethod) {
      return `${capitalize(d.confirmationMethod)} and the issue was confirmed resolved.`;
    }
    return "The issue was confirmed resolved.";
  }
  if (d.result === "Escalated") return "The case was escalated for further review.";
  if (d.result === "PartsNeeded") return "A replacement is required.";
  if (d.result === "FollowUpRequired") return "Follow-up is required.";
  if (d.result === "Pending") return "The issue is still pending.";
  if (d.result === "WaitingOnVendor") return "The case is waiting on a vendor response.";
  if (d.result === "WaitingOnStore") return "The case is waiting on the store.";
  if (d.result === "Monitoring") return "The issue is being monitored.";
  if (d.result === "StoreDidNotAnswer") return "The store did not answer for follow-up.";
  if (d.result === "CouldNotReproduce") return "The issue could not be reproduced.";
  if (d.result === "ResultNotConfirmed") return "The final result was not confirmed.";
  return "";
}

function composeOpener(d: ExtractedDetails, style: WritingStyleSettings): string {
  const storePrefix = d.storeNumber
    ? `Store ${displayStoreNumber(d.storeNumber)}`
    : "The store";
  const callerPrefix = d.callerName
    ? `${d.callerName} from ${storePrefix}`
    : d.callerRole
      ? `The ${d.callerRole.toLowerCase()} from ${storePrefix}`
      : storePrefix;

  // For the "called-reporting" / default style, route through
  // issueToDescriptionOpening so noun-phrase issues get "called regarding a
  // <thing>" and clauses get "called reporting that <thing was …>". Other
  // openerStyle settings keep their explicit verb but still pass the issue
  // through normalizeIssuePhrase so capitalisation + leading articles are
  // cleaned up.
  if (style.openerStyle === "called-reporting" || style.openerStyle === "first-person") {
    return composeNarrativeDescriptionOpener(callerPrefix, d);
  }

  const subjectMatter = composeSubjectMatter(d);
  let verb: string;
  switch (style.openerStyle) {
    case "called-about":
      verb = "called about";
      break;
    case "reported":
      verb = "reported";
      break;
    case "contacted-support":
      verb = "contacted support regarding";
      break;
    default:
      verb = "called regarding";
      break;
  }
  return `${callerPrefix} ${verb} ${subjectMatter}.`;
}

/**
 * Build the description opener using the same NP-vs-clause rules as the
 * summary generator. Differs from {@link issueToDescriptionOpening} only in
 * that it understands the full ExtractedDetails record (deviceType, register
 * number) so it can promote the device into the noun phrase and append
 * "on Register N" where appropriate.
 */
function composeNarrativeDescriptionOpener(
  caller: string,
  d: ExtractedDetails,
): string {
  const reg = d.registerNumber ? `on Register ${d.registerNumber}` : "";

  // Device-led NP form: "a {device} issue" / "a {device} issue on Register N"
  if (d.deviceType) {
    const phrase = `${d.deviceType} issue`;
    return ensurePeriod(
      `${caller} called regarding ${articleFor(d.deviceType)} ${phrase}${reg ? ` ${reg}` : ""}`,
    );
  }

  const phrase = normalizeIssuePhrase(d.issue || "");
  if (!phrase) return ensurePeriod(`${caller} called`);

  if (isFiniteIssueClause(phrase)) {
    // Clause path uses the imperative helper directly so register suffix is
    // already inside the clause when extraction captured it there.
    return issueToDescriptionOpening(caller, phrase);
  }
  // Noun-phrase path: append register suffix outside the article-bearing NP.
  if (reg) {
    return ensurePeriod(`${caller} called regarding ${articleFor(phrase)} ${phrase} ${reg}`);
  }
  return ensurePeriod(`${caller} called regarding ${articleFor(phrase)} ${phrase}`);
}

function composeSubjectMatter(d: ExtractedDetails): string {
  if (
    d.typeOfTransaction &&
    /return|exchange|layaway|refund/i.test(d.typeOfTransaction)
  ) {
    const what =
      d.typeOfTransaction === "Layaway"
        ? "a layaway return issue"
        : `a ${d.typeOfTransaction.toLowerCase()} issue`;
    return what;
  }

  // Device + register: "the keyboard on Register 2 not allowing her to type"
  const reg = d.registerNumber ? `on Register ${d.registerNumber}` : "";
  if (d.deviceType && d.issue) {
    const issue = stripLeadingThe(d.issue);
    if (reg && !new RegExp(`register\\s+${d.registerNumber}`, "i").test(issue)) {
      return `the ${d.deviceType} ${reg} ${stripLeadingDevice(issue, d.deviceType)}`.trim();
    }
    return `the ${d.deviceType} ${stripLeadingDevice(issue, d.deviceType)}`.trim();
  }

  if (d.issue) return stripLeadingThe(d.issue);
  return "an issue";
}

function stripLeadingDevice(s: string, device: string): string {
  // Strip "the {device}" or just "{device}" — whichever is at the head. The
  // bare-device case happens because cleanIssueText / extractIssue often
  // emit "keyboard has a short in it" without the article, and we want
  // composeSubjectMatter to produce "the keyboard ... has a short" rather
  // than "the keyboard ... keyboard has a short".
  const re = new RegExp(`^(?:the\\s+)?${device.replace(/\s+/g, "\\s+")}\\s+`, "i");
  return s.replace(re, "").replace(/^the\s+/i, "");
}

function formatStepsInVoice(stepList: string, style: WritingStyleSettings): string {
  const sentence = capitalize(stepList);
  if (style.voice === "passive") {
    return `${convertToPassive(sentence)}.`;
  }
  return `I ${stepList}.`;
}

function convertToPassive(s: string): string {
  // Light passive rewrite: "restarted X" -> "X was restarted"
  return s.replace(
    /\b(restarted|rebooted|reset|renamed|reseated|confirmed|checked|performed)\s+(?:the\s+)?([\w\s]+?)(?=,|\s+and\s+|$)/gi,
    (_, verb: string, obj: string) => {
      const v = passiveVerb(verb);
      return `the ${obj.trim()} ${v}`;
    },
  );
}

function passiveVerb(v: string): string {
  const lower = v.toLowerCase();
  const map: Record<string, string> = {
    restarted: "was restarted",
    rebooted: "was rebooted",
    reset: "was reset",
    renamed: "was renamed",
    reseated: "were reseated",
    confirmed: "were confirmed",
    checked: "were checked",
    performed: "was performed",
  };
  return map[lower] ?? `was ${lower}`;
}

function stripLeadingThe(s: string): string {
  return s.replace(/^the\s+/i, "").replace(/^a\s+/i, "");
}

// ─────────────────────────────────────────────────────────
// RESOLUTION
// ─────────────────────────────────────────────────────────

export function buildResolution(
  d: ExtractedDetails,
  style: WritingStyleSettings,
): string {
  void style.resolutionStyle;

  if (d.result === "WrongCaller") {
    const dept = d.transferDepartment ? ` (${d.transferDepartment})` : "";
    return `Caller was redirected to the appropriate department${dept}.`;
  }
  if (d.result === "Transferred") {
    const dept = d.transferDepartment ? ` to ${d.transferDepartment}` : "";
    return `Call was transferred${dept} for handling.`;
  }

  if (d.result === "Resolved") {
    const stepList = composeResolutionSteps(d);
    const outcome = composeOutcomeSentence(d);
    if (stepList && outcome) {
      // Both modes drop the bare-step ending. Verbose mode used to glue an
      // extra "and confirmed the issue resolved" before the outcome which
      // produced redundant doubled phrasing ("... confirmed the issue
      // resolved. The issue was confirmed resolved."). The outcome already
      // closes the verdict, so we simply append it.
      return ensurePeriod(`${capitalize(stepList)}. ${outcome}`);
    }
    if (outcome) return ensurePeriod(outcome);
    if (d.confirmationMethod) return ensurePeriod(`${capitalize(d.confirmationMethod)} confirmed by store`);
    return "Issue resolved.";
  }

  if (d.result === "Escalated") return "Issue was escalated for further review.";
  if (d.result === "WaitingOnVendor") return "Waiting on vendor response.";
  if (d.result === "WaitingOnStore") return "Waiting on store response.";
  if (d.result === "FollowUpRequired") {
    const advised = d.storeWasAdvised ? ` Store was advised to ${d.storeWasAdvised}.` : "";
    return `Follow-up required.${advised || " Store was advised to call back."}`.trim();
  }

  if (d.result === "PartsNeeded") {
    const stepBits = composeResolutionSteps(d);
    const reason = d.replacementReason ? ` Issue persisted because: ${d.replacementReason.toLowerCase()}.` : "";
    if (stepBits) {
      return ensurePeriod(
        `${capitalize(stepBits)}.${reason} Replacement ticket will be opened`,
      );
    }
    return `Replacement needed.${reason} A replacement ticket will be opened.`.trim();
  }

  if (d.result === "Pending") {
    const steps = composeResolutionSteps(d);
    if (steps) return ensurePeriod(`${capitalize(steps)}. Issue still pending`);
    return "Issue is pending. Result not confirmed.";
  }
  if (d.result === "Monitoring") return "Issue is being monitored.";
  if (d.result === "StoreDidNotAnswer") return "Store did not answer.";
  if (d.result === "CouldNotReproduce") return "Issue could not be reproduced.";
  return "Resolution not confirmed.";
}

function composeResolutionSteps(d: ExtractedDetails): string {
  const bits: string[] = [];
  if (d.servicesRestarted.length > 0)
    bits.push(`restarted the ${joinWithAnd(d.servicesRestarted)}`);
  if (d.cacheRenamed) bits.push("renamed the cache");
  if (d.powerDrainPerformed) bits.push("performed a register power drain");
  if (d.manualRebootPerformed) bits.push("manually rebooted");
  if (d.cablesReseated) bits.push("reseated the cables");
  if (d.connectionsConfirmed) bits.push("confirmed the connections");
  for (const raw of d.steps) {
    // Run every raw step through the dialogue→ticket normalizer (escape →
    // exit, "advised store" → "advised the store") and then transform to
    // past tense. Without this the resolution echoes raw transcript phrasing.
    const past = transformStep(normalizeTroubleshootingStep(raw), "past");
    if (!bits.some((b) => similar(b, past))) bits.push(past);
  }
  return joinWithAnd(dedupe(bits));
}

function similar(a: string, b: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  return norm(a) === norm(b);
}

function composeOutcomeSentence(d: ExtractedDetails): string {
  if (d.affectedRegisters.length > 0 && d.affectedRegisters.some((r) => /both|all/i.test(r))) {
    return `${capitalize(d.affectedRegisters[0])} are back online.`;
  }
  if (d.confirmationMethod) {
    if (/back\s+online/i.test(d.confirmationMethod)) return "The store is back online.";
    if (/back\s+to\s+normal/i.test(d.confirmationMethod))
      return "The system is back to normal.";
    if (/back\s+up/i.test(d.confirmationMethod)) return "The store is back up.";
    // If the confirmationMethod text already contains "confirm" / "working",
    // appending another "confirmed." would produce "Keyboard confirmed working
    // confirmed." Trust the canonical phrasing as-is.
    if (/\bconfirm/i.test(d.confirmationMethod))
      return `${capitalize(d.confirmationMethod)}.`;
    return `${capitalize(d.confirmationMethod)} confirmed.`;
  }
  // Default Resolved outcome — keeps the resolution from ending on a stranded
  // step list. Older versions returned "" here, which left the resolution as
  // "Exited out of the transaction." with no closing verdict.
  if (d.result === "Resolved") return "The issue was confirmed resolved.";
  return "";
}

// ─────────────────────────────────────────────────────────
// PART REQUEST
// ─────────────────────────────────────────────────────────

export function buildPartRequest(d: ExtractedDetails): string {
  if (!d.partNeeded) return "";

  const reg = d.registerNumber ? `Register ${d.registerNumber}` : "";
  const device = d.deviceType || (d.devices[0] ?? "device");
  const reason = d.replacementReason
    ? ` ${capitalize(d.replacementReason.toLowerCase())}.`
    : "";

  if (/receipt\s*printer/i.test(device)) {
    if (reg) {
      return `The ${reg} receipt printer needs replacement.${reason} Please send a new receipt printer for ${reg}.`;
    }
    return `The receipt printer needs replacement.${reason} Please send a new receipt printer.`;
  }
  if (/keyboard/i.test(device)) {
    if (reg) {
      return `The ${reg} keyboard appears to require replacement.${reason} Please send a replacement keyboard${/cable/i.test(d.replacementReason) ? " with cable" : ""} for ${reg}.`;
    }
    return `The keyboard appears to require replacement.${reason} Please send a replacement keyboard.`;
  }
  if (/verifone|pin\s*pad/i.test(device)) {
    if (reg) {
      return `The VeriFone device on ${reg} is not functioning after troubleshooting.${reason} Please send a replacement VeriFone device if approved.`;
    }
    return `The VeriFone device is not functioning after troubleshooting.${reason} Please send a replacement VeriFone device if approved.`;
  }
  if (reg) {
    return `The ${reg} ${device} requires replacement.${reason} Please send a replacement ${device} for ${reg}.`;
  }
  return `The ${device} requires replacement.${reason} Please send a replacement ${device}.`;
}

// ─────────────────────────────────────────────────────────
// ADDITIONAL COMMENTS & WARNINGS
// ─────────────────────────────────────────────────────────

export function buildAdditionalComments(d: ExtractedDetails): string {
  const bits: string[] = [];
  if (d.followUpNeeded && d.result !== "FollowUpRequired")
    bits.push("Follow-up may be required.");
  if (d.escalationNeeded && d.result !== "Escalated")
    bits.push("Escalation may be required.");
  if (d.existingTicketMentioned) {
    const num = d.existingTicketDetails ? `: ${d.existingTicketDetails}` : "";
    bits.push(`Existing ticket already open${num}.`);
  }
  if (d.vendorTicketNumber) bits.push(`Vendor ticket: ${d.vendorTicketNumber}.`);
  if (d.notes) bits.push(d.notes.trim());
  if (d.transactionNumber && !d.paymentType)
    bits.push("Transaction number was provided, but payment type was not mentioned.");
  if (d.devices.includes("Inseego") && !bits.some((b) => /Inseego/i.test(b)))
    bits.push(`Devices involved: ${joinWithAnd(d.devices)}.`);
  if (bits.length === 0) return "";
  return bits.join(" ");
}

export function buildMissingInfoWarnings(d: ExtractedDetails): string[] {
  const warnings: string[] = [];
  // For wrong-caller calls, most "missing detail" warnings don't apply — the
  // call is being redirected, not ticketed for our team. Surface only the
  // routing-specific warning.
  if (d.result === "WrongCaller") {
    if (!d.transferDepartment) {
      warnings.push(
        "Wrong caller — confirm which department they should contact and document the transfer.",
      );
    }
    return warnings;
  }
  if (!d.storeNumber) {
    warnings.push(
      "Store number was not captured. Ask the employee for the store number before submitting the ticket.",
    );
  }
  if (!d.callerName && !d.callerRole && !d.contactName && !d.requesterName) {
    warnings.push(
      "Caller name was not captured. Ask who is calling if follow-up may be needed.",
    );
  }
  if (
    !d.registerNumber &&
    d.affectedRegisters.length === 0 &&
    /\b(register|pos|pin\s*pad|cash\s*drawer|receipt|keyboard)\b/i.test(d.issue || "")
  ) {
    warnings.push(
      "Register number was not provided. Ask which register/device is affected.",
    );
  }
  if (
    ["Return", "Exchange", "Layaway", "No Receipt Return", "Refund"].includes(d.typeOfTransaction) &&
    !d.transactionNumber
  ) {
    warnings.push(
      "Transaction number was not provided. For return or exchange issues, ask for the original transaction number.",
    );
  }
  if (
    ["Return", "Exchange", "Refund"].includes(d.typeOfTransaction) &&
    !d.itemNumber
  ) {
    warnings.push(
      "Item number was not provided. For item-specific return issues, ask for the item number or SKU.",
    );
  }
  if (!d.errorMessage && /\berror\b/i.test(d.issue || "")) {
    warnings.push(
      "Exact error message was not captured. Ask the store to read the full error message if it appears again.",
    );
  }
  if (d.result === "ResultNotConfirmed") {
    warnings.push(
      "Final result was not confirmed. Ask whether the issue is resolved, pending, or needs escalation.",
    );
  }
  if (
    ["Return", "Exchange", "Refund", "No Receipt Return"].includes(d.typeOfTransaction) &&
    !d.paymentType
  ) {
    warnings.push(
      "Payment type was not provided. For refund issues, ask whether the refund was cash, card, credit, Wisely card, gift card, or another payment method.",
    );
  }
  if (d.partNeeded && !d.deviceType) {
    warnings.push(
      "Replacement may be needed, but the exact device was not confirmed. Ask which device and register need replacement.",
    );
  }
  if (d.existingTicketMentioned && !/\d{4,}/.test(d.existingTicketDetails)) {
    warnings.push(
      "An existing ticket was mentioned, but the ticket number was not captured.",
    );
  }
  if (/\bphone\s*line|\batt\b/i.test(d.issue || "") && !d.vendorTicketNumber) {
    warnings.push(
      "Vendor ticket number was not captured. Ask for the ATT/vendor ticket number if available.",
    );
  }
  if (/verifone|pin\s*pad/i.test(d.issue || "") && !d.registerNumber) {
    warnings.push(
      "Ask whether all VeriFone devices are affected or only one register/pin pad.",
    );
  }
  if (
    /internet|inseego/i.test(d.issue || "") &&
    d.affectedRegisters.length === 0 &&
    !d.registerNumber
  ) {
    warnings.push(
      "Ask whether all registers are affected or only one register.",
    );
  }
  return warnings;
}

export function buildCapturedNotices(d: ExtractedDetails): string[] {
  const notices: string[] = [];
  if (d.storeNumber) notices.push(`Store number captured: Store ${d.storeNumber}`);
  if (d.callerName) notices.push(`Caller captured: ${d.callerName}`);
  else if (d.callerRole) notices.push(`Caller role captured: ${d.callerRole}`);
  if (d.registerNumber) notices.push(`Register captured: Register ${d.registerNumber}`);
  else if (d.affectedRegisters.length > 0)
    notices.push(`Registers captured: ${joinWithAnd(d.affectedRegisters)}`);
  if (d.errorMessage) notices.push(`Error message captured: "${d.errorMessage}"`);
  if (d.partNeeded) notices.push("Part replacement detected");
  if (d.existingTicketMentioned) notices.push("Existing ticket mentioned");
  if (d.result === "Resolved") notices.push("Result confirmed: resolved");
  return notices;
}

// ─────────────────────────────────────────────────────────
// COPY BUNDLES
// ─────────────────────────────────────────────────────────

export function buildFullTicketText(f: TicketFields): string {
  const lines: string[] = [];
  lines.push(`Subject:\n${f.subject}`);
  lines.push("");
  lines.push(`Description:\n${f.description}`);
  lines.push("");
  lines.push(`Resolution:\n${f.resolution}`);
  if (f.partRequest) {
    lines.push("");
    lines.push(`Part Request:\n${f.partRequest}`);
  }
  if (f.additionalComments) {
    lines.push("");
    lines.push(`Additional Comments:\n${f.additionalComments}`);
  }
  lines.push("");
  lines.push("--- Ticket Form Fields ---");
  lines.push(`Site: ${f.site}`);
  lines.push(`Store Number: ${f.storeNumber}`);
  lines.push(`Register #: ${f.registerNumber}`);
  lines.push(`Date/Time of Issue: ${f.dateTimeOfIssue}`);
  lines.push(`Contact Name: ${f.contactName}`);
  lines.push(`Requester Name: ${f.requesterName}`);
  lines.push(`Impact: ${f.impact}`);
  lines.push(`Urgency: ${f.urgency}`);
  lines.push(`Mode: ${f.mode}`);
  lines.push(`Request Type: ${f.requestType}`);
  lines.push(`Service Category: ${f.serviceCategory}`);
  lines.push(`Status: ${f.status}`);
  lines.push(`Category: ${f.category}`);
  lines.push(`Sub Category: ${f.subCategory}`);
  lines.push(`Item: ${f.item}`);
  lines.push(`Transaction #: ${f.transactionNumber}`);
  lines.push(`Item #: ${f.itemNumber}`);
  lines.push(`Type of Transaction: ${f.typeOfTransaction}`);
  lines.push(`Payment Type: ${f.paymentType}`);
  lines.push(`Technician: ${f.technician}`);
  if (f.forwardTo && f.forwardTo !== "Not provided") lines.push(`Forward To: ${f.forwardTo}`);

  if (f.missingInfoWarnings.length > 0) {
    lines.push("");
    lines.push("Warnings:");
    for (const w of f.missingInfoWarnings) lines.push(`- ${w}`);
  }
  if (f.suggestedQuestions.length > 0) {
    lines.push("");
    lines.push("Suggested Questions:");
    for (const q of f.suggestedQuestions) lines.push(`- ${q}`);
  }

  return lines.join("\n");
}

export function buildAllFieldsBlock(f: TicketFields): string {
  const lines: string[] = [];
  lines.push(`Site: ${f.site}`);
  lines.push(`Store Number: ${f.storeNumber}`);
  lines.push(`Register #: ${f.registerNumber}`);
  lines.push(`Date/Time of Issue: ${f.dateTimeOfIssue}`);
  lines.push(`Contact Name: ${f.contactName}`);
  lines.push(`Requester Name: ${f.requesterName}`);
  lines.push(`Impact: ${f.impact}`);
  lines.push(`Urgency: ${f.urgency}`);
  lines.push(`Mode: ${f.mode}`);
  lines.push(`Request Type: ${f.requestType}`);
  lines.push(`Service Category: ${f.serviceCategory}`);
  lines.push(`Status: ${f.status}`);
  lines.push(`Category: ${f.category}`);
  lines.push(`Sub Category: ${f.subCategory}`);
  lines.push(`Item: ${f.item}`);
  lines.push(`Transaction #: ${f.transactionNumber}`);
  lines.push(`Item #: ${f.itemNumber}`);
  lines.push(`Type of Transaction: ${f.typeOfTransaction}`);
  lines.push(`Payment Type: ${f.paymentType}`);
  lines.push(`Technician: ${f.technician}`);
  lines.push(`Subject: ${f.subject}`);
  lines.push("");
  lines.push(`Description:\n${f.description}`);
  lines.push("");
  lines.push(`Resolution:\n${f.resolution}`);
  if (f.partRequest) {
    lines.push("");
    lines.push(`Part Request:\n${f.partRequest}`);
  }
  if (f.additionalComments) {
    lines.push("");
    lines.push(`Additional Comments:\n${f.additionalComments}`);
  }
  return lines.join("\n");
}

function dedupe<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}
