import type { DetailLevel, ExtractedDetails } from "../types/ticket";
import {
  articleFor,
  capitalize,
  collapseWhitespace,
  displayStoreNumber,
  ensurePeriod,
  isClause,
  isFiniteIssueClause,
  isNounPhrase,
  issueAsObject,
  issueToDescriptionOpening,
  joinWithAnd,
  normalizeIssuePhrase,
  normalizeTroubleshootingStep,
  pastTenseIssue,
  transformStep,
} from "../utils/cleanText";
import { resultSentence } from "../utils/resultWording";

export interface GenerateOptions {
  detailLevel: DetailLevel;
  details: ExtractedDetails;
}

/**
 * Build a single ticket-style summary at the requested detail level.
 *
 * The five levels are intentionally different — same facts, different
 * granularity and audience:
 *   • Short  → 1 sentence, store + issue + result.
 *   • Normal → 2–4 sentences, the everyday default.
 *   • Detailed → full timeline including caller/register/error/steps.
 *   • Technical → IT-style phrasing with services, devices, validation.
 *   • ManagementSummary → non-technical impact-focused wording.
 *
 * None of these read raw transcript dialogue back to the user — they all
 * compose from the structured ExtractedDetails object.
 */
export function generateTicket({ detailLevel, details }: GenerateOptions): string {
  // Wrong-caller and transfer outcomes get their own short, professional
  // phrasing at every level. Don't try to graft them onto the troubleshooting
  // templates — there is no troubleshooting to describe.
  if (details.result === "WrongCaller") {
    return composeWrongCaller(details, detailLevel);
  }
  if (details.result === "Transferred") {
    return composeTransferred(details, detailLevel);
  }

  switch (detailLevel) {
    case "Short":
      return composeShort(details);
    case "Normal":
      return composeNormal(details);
    case "Detailed":
      return composeDetailed(details);
    case "Technical":
      return composeTechnical(details);
    case "ManagementSummary":
      return composeManagement(details);
  }
}

export function generateTicketSafe(options: GenerateOptions): string {
  return ensurePeriod(generateTicket(options));
}

// ─────────────────────────────────────────────────────────
// Building blocks
// ─────────────────────────────────────────────────────────

function storeSubject(d: ExtractedDetails): string {
  if (!d.storeNumber) return "A store";
  return `Store ${displayStoreNumber(d.storeNumber)}`;
}

function callerPrefix(d: ExtractedDetails): string {
  const store = storeSubject(d);
  if (d.callerName && d.callerRole) return `${d.callerName} (${d.callerRole}) from ${store}`;
  if (d.callerName) return `${d.callerName} from ${store}`;
  if (d.callerRole) return `The ${d.callerRole.toLowerCase()} from ${store}`;
  return store;
}

/**
 * Canonical noun-phrase form of the issue, with leading article. Use for
 * any "called about ___", "experienced ___", "regarding ___" slot.
 *   - device known      → "a/an {device} issue"
 *   - clause issue      → "an issue with the {device}"  (via issueAsObject)
 *   - NP without article → "a/an {issue}"
 *   - empty             → "an issue"
 */
function issueClause(d: ExtractedDetails): string {
  if (d.deviceType) return `${articleFor(d.deviceType)} ${d.deviceType} issue`;
  if (!d.issue) return "an issue";
  // Normalize the case + strip stray articles BEFORE deciding article — without
  // this, "Credit card machine issue" leaks the capital C into mid-sentence.
  const normalized = normalizeIssuePhrase(d.issue);
  const past = pastTenseIssue(normalized);
  if (isFiniteIssueClause(past)) return issueAsObject(past);
  if (/^(?:a|an|the)\s/i.test(past)) return past;
  return `${articleFor(past)} ${past}`;
}

/**
 * Narrative form of issue with leading article preserved (past-tense),
 * for templates like "called reporting that the printer was not printing"
 * where the article reads more naturally than the bare clause.
 */
function issueNarrative(d: ExtractedDetails): string {
  if (!d.issue) return "an issue was reported";
  const past = pastTenseIssue(d.issue);
  const withArticle = /^(?:the|a|an|they|some|its|their|my|her|his|registers?\b)\s+/i.test(past)
    ? past
    : `the ${past}`;
  // Mid-sentence: lowercase the first character so it reads naturally after
  // "called reporting that ".
  return withArticle.charAt(0).toLowerCase() + withArticle.slice(1);
}

function affectedClause(d: ExtractedDetails): string {
  const bits: string[] = [];
  if (d.deviceType) bits.push(`the ${d.deviceType}`);
  if (d.registerNumber) bits.push(`on Register ${d.registerNumber}`);
  else if (d.affectedRegisters.length > 0)
    bits.push(`(${joinWithAnd(d.affectedRegisters)})`);
  return bits.join(" ");
}

function stepsPastTense(d: ExtractedDetails): string[] {
  const bits: string[] = [];
  if (d.servicesRestarted.length > 0)
    bits.push(`restarted the ${joinWithAnd(d.servicesRestarted)}`);
  if (d.cacheRenamed) bits.push("renamed the cache");
  if (d.powerDrainPerformed) bits.push("performed a register power drain");
  if (d.manualRebootPerformed) bits.push("manually rebooted the device");
  if (d.cablesReseated) bits.push("reseated the cables");
  if (d.connectionsConfirmed) bits.push("checked the connection");
  for (const raw of d.steps) {
    // normalizeTroubleshootingStep handles BOTH the causative-wrapper /
    // article fixes ("advised store" → "advised the store") AND the
    // dialogue→ticket verb rewrites ("escaped out of" → "exited out of"),
    // so neither leaks through into a final past-tense or gerund variant.
    const past = transformStep(normalizeTroubleshootingStep(raw), "past");
    const norm = past.toLowerCase().trim();
    if (!bits.some((b) => b.toLowerCase().trim() === norm)) bits.push(past);
  }
  return dedupe(bits);
}

function joinSteps(d: ExtractedDetails): string {
  return joinWithAnd(stepsPastTense(d));
}

/**
 * Steps as gerunds for "after X" / "by X" / "Troubleshooting included X" clauses
 * where past tense reads awkwardly (e.g., "Troubleshooting included restarted
 * the POS" → "Troubleshooting included restarting the POS").
 */
function joinStepsGerund(d: ExtractedDetails): string {
  return joinWithAnd(stepsPastTense(d).map((s) => transformStep(s, "gerund")));
}

/**
 * Steps as imperatives ("restart the POS", "rename the cache") for templates
 * that describe what the store was *instructed* to do.
 */
function stepsImperative(d: ExtractedDetails): string[] {
  const past = stepsPastTense(d);
  return past.map((s) => {
    const m = /^([A-Za-z]+)(\b.*)$/.exec(s.trim());
    if (!m) return s;
    return transformStep(s, "past")
      .replace(/^([A-Za-z]+)/, (verb) => imperativeOf(verb));
  });
}

function imperativeOf(pastVerb: string): string {
  // Walk through known forms — return the base verb when the head matches.
  // We use the same data table as transformStep, but expressed inline so we
  // don't have to expose VERB_FORMS publicly.
  const map: Record<string, string> = {
    restarted: "restart",
    rebooted: "reboot",
    reset: "reset",
    unplugged: "unplug",
    plugged: "plug",
    replugged: "replug",
    reconnected: "reconnect",
    checked: "check",
    verified: "verify",
    tested: "test",
    ran: "run",
    replaced: "replace",
    swapped: "swap",
    cleaned: "clean",
    updated: "update",
    installed: "install",
    reinstalled: "reinstall",
    configured: "configure",
    renamed: "rename",
    reseated: "reseat",
    performed: "perform",
    created: "create",
    investigated: "investigate",
    confirmed: "confirm",
    deactivated: "deactivate",
    opened: "open",
    cut: "cut",
    sent: "send",
  };
  return map[pastVerb.toLowerCase()] ?? pastVerb;
}

/**
 * Convert a past-tense action ("restarted the POS") into passive narration
 * ("the POS was restarted"). Used by the Normal variant where retail-style
 * write-ups read more naturally in passive voice. Returns the original
 * step unchanged if the pattern doesn't match.
 */
// Verbs that share the same form for past tense and past participle, so
// "the X was <verb>" reads as a clean passive. Irregular verbs like "ran"
// (PP "run") or "saw" (PP "seen") are intentionally excluded — passivizing
// them produces ungrammatical output ("a test print was ran"). Causative
// helpers like "had / told / asked / made / got" are also excluded because
// "the store restart the modem was had" is gibberish.
const PASSIVE_SAFE_VERBS = new Set<string>([
  "restarted",
  "rebooted",
  "reset",
  "unplugged",
  "plugged",
  "replugged",
  "reconnected",
  "checked",
  "verified",
  "tested",
  "replaced",
  "swapped",
  "cleaned",
  "updated",
  "installed",
  "reinstalled",
  "configured",
  "renamed",
  "reseated",
  "performed",
  "created",
  "investigated",
  "confirmed",
  "deactivated",
  "opened",
  "advised",
  "instructed",
]);

function passiveStep(past: string): string {
  const m = /^([A-Za-z]+)\s+((?:the|a|an)\s+.+)$/i.exec(past.trim());
  if (!m) return past;
  const verb = m[1].toLowerCase();
  if (!PASSIVE_SAFE_VERBS.has(verb)) return past;
  return `${m[2]} was ${verb}`;
}

function partSentence(d: ExtractedDetails): string {
  // Only emit when the *outcome* is that a replacement is needed. The
  // analyzer also sets `partNeeded` when it sees the word "replaced" in a
  // step ("replaced the cable") — that's a step that already happened on a
  // resolved ticket, not a forward-looking parts request, so it must not
  // surface as "Replacement X is required" on a Resolved or Escalated case.
  if (d.result !== "PartsNeeded") return "";
  const device = d.deviceType || d.parts[0] || "device";
  const reg = d.registerNumber ? ` on Register ${d.registerNumber}` : "";
  const reason = d.replacementReason
    ? ` (${d.replacementReason.toLowerCase()})`
    : "";
  return `Replacement ${device}${reg} is required${reason}.`;
}

function followUpSentence(d: ExtractedDetails): string {
  if (d.followUpNeeded && d.result !== "FollowUpRequired") return "Follow-up is required.";
  return "";
}

function stripLeadingArticle(s: string): string {
  return s.replace(/^the\s+/i, "").replace(/^a\s+/i, "").trim();
}

// ─────────────────────────────────────────────────────────
// SHORT — 1 sentence, store + issue + result
// ─────────────────────────────────────────────────────────

function composeShort(d: ExtractedDetails): string {
  const store = storeSubject(d);
  const np = issueClause(d);

  if (d.result === "Resolved") {
    const stepsGer = joinStepsGerund(d);
    const confirmGer =
      d.confirmationMethod === "Successful test print"
        ? "confirming a successful test print"
        : "";
    const after = joinWithAnd([stepsGer, confirmGer].filter(Boolean));
    if (after) {
      return collapseWhitespace(
        `${store} called about ${np} that was resolved after ${after}.`,
      );
    }
    return collapseWhitespace(`${store} called about ${np}; the issue was resolved.`);
  }
  if (d.result === "PartsNeeded") {
    const device = d.deviceType || "device";
    return collapseWhitespace(
      `${store} called about ${np}; a replacement ${device} is required.`,
    );
  }
  if (d.result === "Escalated") {
    return collapseWhitespace(`${store} called about ${np}; the case was escalated.`);
  }
  if (d.result === "FollowUpRequired") {
    return collapseWhitespace(`${store} called about ${np}; follow-up is required.`);
  }
  if (d.result === "Pending") {
    return collapseWhitespace(`${store} called about ${np}; the issue is still pending.`);
  }
  if (d.result === "ResultNotConfirmed") {
    return collapseWhitespace(
      `${store} called about ${np}; the final result was not confirmed.`,
    );
  }
  return collapseWhitespace(`${store} called about ${np}. ${resultSentence(d.result)}`);
}

// ─────────────────────────────────────────────────────────
// NORMAL — 2–4 sentences, the everyday default
// ─────────────────────────────────────────────────────────

function composeNormal(d: ExtractedDetails): string {
  const sentences: string[] = [];

  // Opener uses {@link issueToDescriptionOpening} so a noun-phrase issue
  // ("credit card machine issue") routes to "called regarding a …" and a
  // clause issue ("the keyboard was not working") routes to "called
  // reporting that …" — never the ungrammatical hybrid we used to ship.
  sentences.push(composeNarrativeOpener(d));

  // Gerund list reads cleanly after "Troubleshooting included" — past-tense
  // would yield "Troubleshooting included exited" which is broken.
  const gerundList = joinStepsGerund(d);
  if (gerundList) {
    sentences.push(`Troubleshooting included ${gerundList}.`);
  }

  sentences.push(outcomeSentence(d));

  const part = partSentence(d);
  if (part) sentences.push(part);

  return collapseWhitespace(sentences.filter(Boolean).join(" "));
}

/**
 * Shared narrative opener used by Normal, Detailed, and the summary builders.
 * Routes through {@link issueToDescriptionOpening} after first composing the
 * caller phrase ("Berry from Store 523" / "The store manager from Store 9" /
 * "Store 521") and an optional `on Register N` suffix derived from the
 * extracted register number.
 */
function composeNarrativeOpener(d: ExtractedDetails): string {
  const caller = callerPrefix(d);
  const phrase = normalizeIssuePhrase(d.issue || "");
  const reg = d.registerNumber ? `on Register ${d.registerNumber}` : "";

  // Device-led path: when the analyzer extracted a deviceType, the opener
  // should ALWAYS be a noun phrase. Prefer the raw issue text when it's
  // already a clean noun phrase (so detail like "hardware failure" survives);
  // otherwise fall back to "a {device} issue". Without this branch the
  // generator routes a clause-y issue ("receipt printer not printing") into
  // "called reporting that the receipt printer not printing" — broken because
  // "not printing" has no finite verb.
  if (d.deviceType) {
    if (phrase && isNounPhrase(phrase)) {
      return ensurePeriod(
        `${caller} called regarding ${articleFor(phrase)} ${phrase}${reg ? ` ${reg}` : ""}`,
      );
    }
    const fallback = `${d.deviceType} issue`;
    return ensurePeriod(
      `${caller} called regarding ${articleFor(d.deviceType)} ${fallback}${reg ? ` ${reg}` : ""}`,
    );
  }

  if (!phrase) return ensurePeriod(`${caller} called`);
  // Use `isClause` (not `isFiniteIssueClause`) so any noun-phrase tail like
  // "X issue / X failure / X problem" stays a noun phrase even when an
  // earlier word in the regex would have matched (e.g. "hardware failure"
  // is a state-clause indicator inside `isFiniteIssueClause` but reads as
  // an NP tail to a human).
  if (isClause(phrase)) {
    return issueToDescriptionOpening(caller, phrase);
  }
  const np = phrase;
  if (reg) {
    return ensurePeriod(`${caller} called regarding ${articleFor(np)} ${np} ${reg}`);
  }
  return ensurePeriod(`${caller} called regarding ${articleFor(np)} ${np}`);
}

// ─────────────────────────────────────────────────────────
// DETAILED — full timeline, caller + register + error + steps
// ─────────────────────────────────────────────────────────

function composeDetailed(d: ExtractedDetails): string {
  const sentences: string[] = [];

  sentences.push(composeNarrativeOpener(d));

  if (d.errorMessage) {
    sentences.push(`The system displayed: "${d.errorMessage}".`);
  }
  if (d.transactionNumber) {
    sentences.push(`The original transaction number was ${d.transactionNumber}.`);
  }

  const stepImperatives = stepsImperative(d);
  if (
    d.result === "Resolved" &&
    d.confirmationMethod === "Successful test print" &&
    stepImperatives.length > 0
  ) {
    const device = d.deviceType || "device";
    const allInstructions = joinWithAnd([
      ...stepImperatives,
      `test the ${device} again`,
    ]);
    sentences.push(`The store was instructed to ${allInstructions}.`);
    sentences.push(
      "After the restart, the test print completed successfully and the store confirmed the printer was working.",
    );
    sentences.push("Issue resolved.");
  } else {
    const gerundList = joinStepsGerund(d);
    if (gerundList) {
      sentences.push(`Troubleshooting included ${gerundList}.`);
    } else {
      sentences.push("No troubleshooting steps were recorded.");
    }
    sentences.push(outcomeSentence(d));
  }

  const part = partSentence(d);
  if (part) sentences.push(part);

  const follow = followUpSentence(d);
  if (follow) sentences.push(follow);

  return collapseWhitespace(sentences.filter(Boolean).join(" "));
}

// ─────────────────────────────────────────────────────────
// TECHNICAL — IT-style phrasing
// ─────────────────────────────────────────────────────────

// Map confirmationMethod → short validation noun phrase used after the
// "Validation:" label. Empty string means no validation line is emitted.
const TECHNICAL_VALIDATION: Record<string, string> = {
  "Successful test print": "successful test print",
  "Keyboard confirmed working": "keyboard confirmed working",
  "Successful card transaction": "card transaction completed successfully",
  "Both registers back online": "both registers verified back online",
  "Connection restored": "network connection restored",
  "Confirmed back to normal": "store confirmed normal operation",
  "Confirmed back up": "store confirmed system back up",
  "Confirmed working by store": "store confirmed device working",
};

// Map result → short outcome noun phrase used after the "Outcome:" label.
function technicalOutcome(d: ExtractedDetails): string {
  switch (d.result) {
    case "Resolved":
      if (d.deviceType === "receipt printer") return "printer functionality restored";
      if (d.deviceType) return `${d.deviceType} functionality restored`;
      return "issue resolved";
    case "PartsNeeded":
      return "replacement hardware required";
    case "Escalated":
      return "case escalated for further review";
    case "FollowUpRequired":
      return "follow-up required";
    case "Pending":
      return "pending further action";
    case "ResultNotConfirmed":
      return "no definitive resolution recorded";
    case "Transferred":
      return "call transferred";
    case "WrongCaller":
      return "inbound routed in error";
    case "Monitoring":
      return "monitoring for recurrence";
    case "StoreDidNotAnswer":
      return "store did not answer callback";
    case "WaitingOnStore":
      return "awaiting store response";
    case "WaitingOnVendor":
      return "awaiting vendor response";
    case "CouldNotReproduce":
      return "issue could not be reproduced";
  }
}

function composeTechnical(d: ExtractedDetails): string {
  const sentences: string[] = [];
  const store = storeSubject(d);

  // Opener — labeled noun-phrase form ("a receipt printer issue from the
  // POS on Register 2"). Reads like a ticket header, not a narrative.
  const issueLabel = d.deviceType
    ? `${articleFor(d.deviceType)} ${d.deviceType} issue`
    : (() => {
        const phrase = normalizeIssuePhrase(d.issue || "");
        if (!phrase) return "an issue";
        if (isFiniteIssueClause(phrase)) return issueAsObject(phrase);
        return `${articleFor(phrase)} ${phrase}`;
      })();
  const fromPos =
    d.deviceType === "receipt printer" && d.devices.includes("POS")
      ? " from the POS"
      : "";
  const onReg = d.registerNumber ? ` on Register ${d.registerNumber}` : "";
  sentences.push(`${store} reported ${issueLabel}${fromPos}${onReg}.`);

  if (d.errorMessage) sentences.push(`Reported error: "${d.errorMessage}".`);
  if (d.transactionNumber) {
    sentences.push(`Transaction reference: ${d.transactionNumber}.`);
  }

  const diagnosticBits = stepsPastTense(d);
  if (diagnosticBits.length > 0) {
    sentences.push(`Diagnostics: ${joinWithAnd(dedupe(diagnosticBits))}.`);
  }

  // Validation only makes sense when the issue was actually resolved.
  // The confirmation detector can fire on negated phrases ("still did not
  // come back online" trips the "back online" pattern), so gating on
  // result === "Resolved" keeps Technical honest.
  const validation =
    d.result === "Resolved" && d.confirmationMethod
      ? TECHNICAL_VALIDATION[d.confirmationMethod]
      : "";
  if (validation) {
    sentences.push(`Validation: ${validation}.`);
  }

  sentences.push(`Outcome: ${technicalOutcome(d)}.`);

  const part = partSentence(d);
  if (part) sentences.push(part);

  return collapseWhitespace(sentences.filter(Boolean).join(" "));
}

// ─────────────────────────────────────────────────────────
// MANAGEMENT — non-technical, impact-focused
// ─────────────────────────────────────────────────────────

function composeManagement(d: ExtractedDetails): string {
  const sentences: string[] = [];
  const store = storeSubject(d);

  if (d.deviceType) {
    const impact = d.deviceType === "receipt printer" ? "printing" : "normal store operations";
    sentences.push(
      `${store} experienced ${articleFor(d.deviceType)} ${d.deviceType} issue that affected ${impact}.`,
    );
  } else {
    sentences.push(
      `${store} experienced ${issueClause(d)} that affected normal store operations.`,
    );
  }

  if (d.result === "Resolved") {
    if (d.deviceType === "receipt printer") {
      sentences.push("Support completed troubleshooting and confirmed the printer was working again.");
    } else {
      sentences.push("Support completed troubleshooting and the store confirmed normal operation.");
    }
  } else if (d.result === "PartsNeeded") {
    sentences.push("Support reviewed the issue. A replacement device is being arranged so the store can return to normal.");
  } else if (d.result === "Escalated") {
    sentences.push("Support reviewed the issue. The case was escalated for further review.");
  } else if (d.result === "Pending") {
    sentences.push("Support reviewed the issue. It is still pending and is being tracked.");
  } else if (d.result === "FollowUpRequired") {
    sentences.push("Support reviewed the issue. Follow-up is required to confirm the issue is fully resolved.");
  } else {
    sentences.push("Support reviewed the issue. The final outcome has not been confirmed.");
  }

  return collapseWhitespace(sentences.filter(Boolean).join(" "));
}

// ─────────────────────────────────────────────────────────
// Wrong-caller / transferred outcomes
// ─────────────────────────────────────────────────────────

function composeWrongCaller(d: ExtractedDetails, level: DetailLevel): string {
  const dept = d.transferDepartment ? ` (${d.transferDepartment})` : "";
  switch (level) {
    case "Short":
      return "Wrong-number call — caller was redirected to the appropriate department.";
    case "Normal":
      return collapseWhitespace(
        `Caller contacted support, but the issue did not belong to this department. The caller was redirected to the appropriate department${dept}.`,
      );
    case "Detailed":
      return collapseWhitespace(
        `A caller reached this department by mistake. The issue described did not match this team's scope, so the caller was redirected to the appropriate department${dept}. No troubleshooting was performed.`,
      );
    case "Technical":
      return collapseWhitespace(
        `Inbound call routed in error to this queue. No diagnostics were performed; caller was transferred${dept ? ` to ${d.transferDepartment}` : ""}.`,
      );
    case "ManagementSummary":
      return "A caller reached the wrong department and was redirected to the appropriate team. No service work was required from this team.";
  }
}

function composeTransferred(d: ExtractedDetails, level: DetailLevel): string {
  const store = storeSubject(d);
  const issue = issueClause(d);
  const dept = d.transferDepartment ? ` to ${d.transferDepartment}` : "";
  switch (level) {
    case "Short":
      return collapseWhitespace(
        `${store} called about ${issue}; the call was transferred${dept}.`,
      );
    case "Normal":
      return collapseWhitespace(
        `${store} called reporting ${issue}. The call was transferred${dept} for handling.`,
      );
    case "Detailed":
      return collapseWhitespace(
        `${store} called regarding ${issue}. After initial intake the caller was transferred${dept} so the correct team could continue troubleshooting.`,
      );
    case "Technical":
      return collapseWhitespace(
        `${store} reported ${issue}. Call routed${dept} for follow-up; no remediation completed by this queue.`,
      );
    case "ManagementSummary":
      return collapseWhitespace(
        `${store} experienced an issue that needed handling by another team. The call was passed${dept} to keep the store moving.`,
      );
  }
}

// ─────────────────────────────────────────────────────────
// Outcome sentence used by Normal/Detailed/Technical
// ─────────────────────────────────────────────────────────

// Each confirmationMethod is a controlled-vocabulary string from the
// analyzer's detectConfirmation. Mapping to a complete sentence avoids
// stitching that produced gibberish like "the store confirmed the
// confirmed working by store and the issue was resolved."
const RESOLVED_CONFIRMATION_SENTENCES: Record<string, string> = {
  "Successful test print":
    "After the test print completed successfully, the issue was confirmed resolved.",
  "Keyboard confirmed working":
    "The keyboard was confirmed working and the issue was resolved.",
  "Successful card transaction":
    "The card transaction went through successfully and the issue was resolved.",
  "Both registers back online":
    "Both registers came back online and the issue was resolved.",
  "Connection restored":
    "The connection was restored and the issue was resolved.",
  "Confirmed back to normal":
    "The store confirmed everything was back to normal and the issue was resolved.",
  "Confirmed back up":
    "The store confirmed the system was back up and the issue was resolved.",
  "Confirmed working by store":
    "The store confirmed the device was working and the issue was resolved.",
};

function outcomeSentence(d: ExtractedDetails): string {
  if (d.result === "Resolved") {
    if (d.confirmationMethod && RESOLVED_CONFIRMATION_SENTENCES[d.confirmationMethod]) {
      return RESOLVED_CONFIRMATION_SENTENCES[d.confirmationMethod];
    }
    if (d.affectedRegisters.length > 0 && d.affectedRegisters.some((r) => /both|all/i.test(r))) {
      return `${capitalize(d.affectedRegisters[0])} are back online and the issue was resolved.`;
    }
    // Default Resolved phrasing — reads as a complete sentence and confirms
    // the outcome, rather than the bare "Issue resolved." we used to emit.
    return "The issue was confirmed resolved.";
  }
  return resultSentence(d.result);
}

function dedupe<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}
