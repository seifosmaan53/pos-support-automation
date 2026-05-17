import { CATEGORY_RULES } from "../data/defaultCategories";
import {
  EMPTY_DETAILS,
  EMPTY_EVIDENCE,
  type ExtractedDetails,
  type ExtractedEvidence,
  type TicketResult,
} from "../types/ticket";
import type { CorrectionEntry } from "../types/settings";
import {
  applyExtractionPatterns,
  type ExtractionPattern,
} from "../types/extractionPattern";
import { suggestTaxonomy, suggestQuestions } from "./ticketKnowledge";
import { correctTranscript, type CorrectionChange } from "./transcriptCorrector";
import { detectCallerNameInSequence } from "./callerNameDetector";

export interface AnalyzerOptions {
  prevDetails?: Partial<ExtractedDetails>;
  correctionDictionary?: CorrectionEntry[];
  enableTranscriptCorrection?: boolean;
  enableNumberWordNormalization?: boolean;
  /** Phase 10B+C — user-defined and learned patterns. Run as fallback. */
  customPatterns?: ExtractionPattern[];
  /** Called once per matched pattern; lets the store record use stats. */
  onPatternHit?: (patternId: string) => void;
}

export interface AnalyzerOutput {
  details: ExtractedDetails;
  cleanedTranscript: string;
  corrections: CorrectionChange[];
}

/**
 * Backwards-compatible facade — returns just ExtractedDetails.
 */
export function analyzeTranscript(
  transcript: string,
  options: AnalyzerOptions = {},
): ExtractedDetails {
  return analyzeTranscriptFull(transcript, options).details;
}

export function analyzeTranscriptFull(
  transcript: string,
  options: AnalyzerOptions = {},
): AnalyzerOutput {
  const raw = transcript.trim();
  if (!raw) {
    return {
      details: { ...EMPTY_DETAILS, missingInfo: ["Transcript is empty."] },
      cleanedTranscript: "",
      corrections: [],
    };
  }

  const correction = correctTranscript(raw, {
    dictionary: options.correctionDictionary ?? [],
    applyDictionary: options.enableTranscriptCorrection !== false,
    applyNumberWords: options.enableNumberWordNormalization !== false,
  });
  const text = correction.text;

  const lower = text.toLowerCase();
  const sentences = splitSentences(text);

  const storeNumber = extractStoreNumber(text);
  let registerNumber = extractRegisterNumber(text);
  const affectedRegisters = extractAffectedRegisters(text);
  const transactionNumber = extractTransactionNumber(text);
  const itemNumber = extractItemNumber(text);
  let errorMessage = extractErrorMessage(text);
  const typeOfTransaction = detectTypeOfTransaction(lower);
  const paymentType = detectPaymentType(lower);
  const dateTimeOfIssue = extractDateTime(text);
  const category = detectCategory(text);
  let issue = extractIssue(sentences);
  // If the issue extractor returned junk (very short or no recognizable noun),
  // fall back to a device-driven description. This is the difference between
  // an issue field that says "the numbers" (a stray fragment from a tech
  // question) and "Keyboard issue on Register 2" (a useful summary).
  if (!isUsefulIssueText(issue) && primaryDeviceType(text, extractDevices(text))) {
    const dev = primaryDeviceType(text, extractDevices(text));
    // Keep device name lowercase — `issue` is consumed mid-sentence in every
    // composer ("called reporting an issue with the credit card machine"),
    // and an uppercase first letter ("Credit") would surface as a stray cap
    // inside templates that already supply their own article.
    issue = registerNumber
      ? `${dev} issue on Register ${registerNumber}`
      : `${dev} issue`;
  }
  const steps = extractSteps(text, sentences);
  const servicesRestarted = detectServicesRestarted(text);
  const actions = detectActionFlags(text);
  let result = detectResult(lower);
  const parts = extractParts(text);
  const devices = extractDevices(text);
  const deviceType = primaryDeviceType(text, devices);
  const escalationNeeded = /\bescalat/i.test(text);
  const followUpNeeded = /\bfollow[\s-]?up\b/i.test(text) || result === "FollowUpRequired";
  const wrongCaller = detectWrongCaller(text);
  const transfer = detectTransfer(text);
  if (wrongCaller) result = "WrongCaller";
  else if (transfer.transferNeeded && result === "ResultNotConfirmed") result = "Transferred";

  const callerInfo = extractCaller(text, sentences);
  const employeeInfo = extractEmployeeIds(text);
  const partInfo = detectPartReplacement(text, devices, registerNumber);
  const existingTicket = detectExistingTicket(text);
  const vendorTicketNumber = extractVendorTicketNumber(text);

  // Phase 10B+C — user / learned patterns run AFTER built-ins as a sensitivity
  // booster. They never override a built-in hit (no surprise for cases that
  // already work) but they DO fill in fields the built-ins missed.
  const customPatterns = options.customPatterns ?? [];
  if (customPatterns.length > 0) {
    if (!storeNumber.value) {
      const m = applyExtractionPatterns(text, customPatterns, "storeNumber");
      if (m) {
        storeNumber.value = padStore(m.value);
        storeNumber.candidates = [m.value];
        storeNumber.evidence = m.evidence;
        options.onPatternHit?.(m.patternId);
      }
    }
    if (!registerNumber) {
      const m = applyExtractionPatterns(text, customPatterns, "registerNumber");
      if (m) {
        registerNumber = m.value;
        options.onPatternHit?.(m.patternId);
      }
    }
    if (!errorMessage) {
      const m = applyExtractionPatterns(text, customPatterns, "errorMessage");
      if (m) {
        errorMessage = m.value;
        options.onPatternHit?.(m.patternId);
      }
    }
    if (!callerInfo.name) {
      const m = applyExtractionPatterns(text, customPatterns, "callerName");
      if (m) {
        callerInfo.name = m.value;
        callerInfo.evidence = m.evidence;
        options.onPatternHit?.(m.patternId);
      }
    }
    if (result === "ResultNotConfirmed") {
      const m = applyExtractionPatterns(text, customPatterns, "result");
      if (m) {
        const v = m.value.toLowerCase();
        const next: TicketResult | null =
          /resolv|fixed|working/.test(v)
            ? "Resolved"
            : /pending|monitor/.test(v)
              ? "Pending"
              : /escalat/.test(v)
                ? "Escalated"
                : /transfer/.test(v)
                  ? "Transferred"
                  : null;
        if (next) {
          result = next;
          options.onPatternHit?.(m.patternId);
        }
      }
    }
  }

  const taxonomy = suggestTaxonomy({
    text,
    category,
    devices,
    typeOfTransaction,
  });

  const confidenceNotes: string[] = [];
  const missingInfo: string[] = [];

  if (!storeNumber.value) {
    missingInfo.push(
      "Store number was not captured. Ask for the store number before submitting.",
    );
    if (storeNumber.ambiguous && storeNumber.candidates.length > 0) {
      confidenceNotes.push(
        `Multiple possible store numbers detected (${storeNumber.candidates.join(", ")}). Verify which is correct.`,
      );
    }
  }

  if (!callerInfo.name && !callerInfo.role) {
    missingInfo.push(
      "Caller name was not captured. Ask who is calling if follow-up may be needed.",
    );
  } else if (callerInfo.needsReview && callerInfo.name) {
    // Caller name was captured via a brittle Q-and-A path (e.g. tech asks
    // "may I have your name?" and the next word is whatever Whisper heard).
    // Names get misheard frequently (Kayla vs Kaitlyn) so we flag this so the
    // UI shows a "may need review — ask the caller to spell it" warning.
    confidenceNotes.push(
      `Caller name may need review. Transcript detected "${callerInfo.name}" — ask the caller to spell their name if it is unclear.`,
    );
  }

  // Wrong-caller calls don't need most "missing detail" prompts — the call
  // is being redirected, not ticketed against this department's pipeline.
  const skipDetailWarnings = result === "WrongCaller";

  if (!issue && !skipDetailWarnings) missingInfo.push("Main issue was not captured clearly.");
  if (!category && !taxonomy.category && !skipDetailWarnings)
    confidenceNotes.push("Category could not be auto-detected.");
  if (result === "ResultNotConfirmed") {
    missingInfo.push(
      "Final result was not confirmed. Ask whether the issue is resolved, pending, or needs escalation.",
    );
  }
  if (result === "WrongCaller" && !transfer.department) {
    missingInfo.push(
      "Wrong caller — confirm which department they should contact and document the transfer.",
    );
  }
  if (result === "Transferred" && !transfer.department) {
    confidenceNotes.push(
      "Caller was transferred, but the destination department was not captured clearly.",
    );
  }

  if (!skipDetailWarnings && isReturnLike(typeOfTransaction) && !transactionNumber)
    missingInfo.push("Transaction number was not provided for return/exchange.");
  if (!skipDetailWarnings && isReturnLike(typeOfTransaction) && !itemNumber && /\bitem\b/i.test(text))
    missingInfo.push("Item number was not provided.");
  if (!skipDetailWarnings && isReturnLike(typeOfTransaction) && !paymentType)
    missingInfo.push("Payment type was not provided for refund/return.");
  if (
    !skipDetailWarnings &&
    !registerNumber &&
    affectedRegisters.length === 0 &&
    /\bregister|\bpos\b|\bpin\s*pad/i.test(text)
  ) {
    missingInfo.push(
      "Register number was not provided. Ask which register/device is affected.",
    );
  }
  if (!skipDetailWarnings && !errorMessage && /\berror\b/i.test(text)) {
    missingInfo.push(
      "Exact error message was not captured. Ask the store to read the full message if it appears again.",
    );
  }
  if (!skipDetailWarnings && partInfo.partNeeded && !partInfo.deviceConfirmed) {
    missingInfo.push(
      "Replacement may be needed, but the exact device was not confirmed. Ask which device and register need replacement.",
    );
  }
  if (existingTicket.mentioned && !existingTicket.ticketNumber) {
    missingInfo.push(
      "An existing ticket was mentioned, but the ticket number was not captured.",
    );
  }
  if (/\batt\b|phone\s*line|verifone/i.test(text) && !vendorTicketNumber) {
    if (/\batt\b|phone\s*line/i.test(text)) {
      missingInfo.push(
        "Vendor ticket number was not captured. Ask for the ATT/vendor ticket number if available.",
      );
    }
  }

  const suggestedQuestions = suggestQuestions({
    typeOfTransaction,
    category: category || taxonomy.category,
    issueText: text,
    missingStore: !storeNumber.value,
    missingRegister: !registerNumber && affectedRegisters.length === 0,
    missingTransaction: !transactionNumber,
    missingItem: !itemNumber,
    missingError: !errorMessage,
    missingResolution: result === "ResultNotConfirmed",
    missingPayment: !paymentType,
    missingRequester: !callerInfo.name,
    partNeeded: partInfo.partNeeded,
    partDeviceConfirmed: partInfo.deviceConfirmed,
    existingTicketWithoutNumber: existingTicket.mentioned && !existingTicket.ticketNumber,
  });

  const evidence: ExtractedEvidence = {
    ...EMPTY_EVIDENCE,
    storeNumber: storeNumber.evidence,
    callerName: callerInfo.evidence,
    registerNumber: extractEvidenceFor(text, /register\s*\d+|register\s+\w+|both registers|all\s+\d+\s+registers/i),
    issue: issue ?? "",
    errorMessage,
    stepsTaken: steps.length > 0 ? steps.join(" | ") : "",
    result: result === "ResultNotConfirmed" ? "" : extractEvidenceFor(text, RESULT_EVIDENCE_PATTERN),
    partNeeded: partInfo.evidence,
  };

  const merged: ExtractedDetails = {
    ...EMPTY_DETAILS,
    ...options.prevDetails,
    storeNumber: storeNumber.value,
    storeName: options.prevDetails?.storeName ?? "",
    callerName: callerInfo.name,
    callerRole: callerInfo.role,
    contactName: options.prevDetails?.contactName ?? callerInfo.name,
    requesterName: options.prevDetails?.requesterName ?? callerInfo.name,
    registerNumber,
    affectedRegisters,
    deviceType,
    deviceName: deviceType,
    deviceLocation: registerNumber ? `Register ${registerNumber}` : "",
    dateTimeOfIssue,
    category: category || taxonomy.category || options.prevDetails?.category || "",
    subCategory: taxonomy.subCategory || options.prevDetails?.subCategory || "",
    item: taxonomy.item || options.prevDetails?.item || "",
    transactionNumber,
    itemNumber,
    employeeName: employeeInfo.employeeName,
    employeeId: employeeInfo.employeeId,
    operatorId: employeeInfo.operatorId,
    typeOfTransaction,
    paymentType,
    issue: issue ?? options.prevDetails?.issue ?? "",
    symptoms: options.prevDetails?.symptoms ?? [],
    errorMessage,
    steps,
    servicesRestarted,
    cacheRenamed: actions.cacheRenamed,
    powerDrainPerformed: actions.powerDrainPerformed,
    manualRebootPerformed: actions.manualRebootPerformed,
    cablesReseated: actions.cablesReseated,
    connectionsConfirmed: actions.connectionsConfirmed,
    result,
    isResolved: result === "Resolved",
    isPending: result === "Pending",
    isEscalated: result === "Escalated",
    parts,
    partNeeded: partInfo.partNeeded,
    partRequest: "",
    replacementReason: partInfo.replacementReason,
    existingTicketMentioned: existingTicket.mentioned,
    existingTicketDetails: existingTicket.details,
    vendorTicketNumber,
    devices,
    systems: options.prevDetails?.systems ?? [],
    escalationNeeded,
    followUpNeeded,
    wrongCaller,
    transferNeeded: transfer.transferNeeded,
    transferDepartment: transfer.department,
    storeWasAdvised: detectStoreAdvised(text),
    caller: options.prevDetails?.caller ?? "",
    technicianAction: options.prevDetails?.technicianAction ?? "",
    confirmationMethod: detectConfirmation(lower),
    notes: options.prevDetails?.notes ?? "",
    confidenceNotes,
    missingInfo,
    suggestedQuestions,
    evidence,
  };

  return {
    details: merged,
    cleanedTranscript: text,
    corrections: correction.changes,
  };
}

function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

interface StoreNumberResult {
  value: string;
  candidates: string[];
  ambiguous: boolean;
  evidence: string;
}

function extractStoreNumber(text: string): StoreNumberResult {
  const ambiguityPattern =
    /\b(?:store|story|stores|location|number|#)\s*(?:maybe|possibly|might\s+be|could\s+be)\b/i;
  const orPattern = /\b(?:store|story|stores|location|#)\s*\d{1,5}\s*or\s*\d{1,5}\b/i;

  if (ambiguityPattern.test(text) || orPattern.test(text)) {
    const candidates = Array.from(text.matchAll(/\b(\d{1,5})\b/g)).map((m) => m[1]);
    return { value: "", candidates, ambiguous: true, evidence: "" };
  }

  // Adjacent: "store 523", "store #523", "store number 523". Includes "story"
  // / "stores" as aliases — common ASR mis-transcriptions ("what store are you
  // calling for" → "what story are you calling for").
  const explicit = /\b(?:store|story|stores|location)\s*(?:number\s*|#\s*)?(\d{1,5})\b/i.exec(text);
  if (explicit)
    return {
      value: padStore(explicit[1]),
      candidates: [explicit[1]],
      ambiguous: false,
      evidence: explicit[0],
    };

  // Question-then-answer: "What store are you calling for? 523." The number
  // can land on the next sentence/line within ~60 chars of "store/story".
  const callingFor =
    /\b(?:store|story|stores)\b[\s\S]{0,80}?\b(?:calling|asking|number|here|are\s+you)\b[\s\S]{0,40}?\b(\d{2,5})\b/i.exec(
      text,
    );
  if (callingFor)
    return {
      value: padStore(callingFor[1]),
      candidates: [callingFor[1]],
      ambiguous: false,
      evidence: callingFor[0].slice(0, 80),
    };

  const numberCalled = /\b(?:store\s*)?number\s*(\d{1,5})\b/i.exec(text);
  if (numberCalled)
    return {
      value: padStore(numberCalled[1]),
      candidates: [numberCalled[1]],
      ambiguous: false,
      evidence: numberCalled[0],
    };

  const positional = /\b(\d{2,5})\s+called\b/i.exec(text);
  if (positional)
    return {
      value: padStore(positional[1]),
      candidates: [positional[1]],
      ambiguous: false,
      evidence: positional[0],
    };

  return { value: "", candidates: [], ambiguous: false, evidence: "" };
}

function padStore(num: string): string {
  if (num.length >= 5) return num;
  return num.padStart(5, "0");
}

function extractRegisterNumber(text: string): string {
  const m = /\bregister\s*(?:number\s*|#\s*)?(\d{1,3})\b/i.exec(text);
  if (m) return m[1];
  const m2 = /\bregister\s+(\d{1,3})\b/i.exec(text);
  if (m2) return m2[1];
  return "";
}

function extractAffectedRegisters(text: string): string[] {
  const out: string[] = [];
  if (/\b(both\s+registers)\b/i.test(text)) out.push("both registers");
  const all = /\ball\s+(\d+)\s+registers\b/i.exec(text);
  if (all) out.push(`all ${all[1]} registers`);
  if (/\beach\s+register\b/i.test(text)) out.push("each register");
  // Multiple explicit "Register N" mentions
  const explicit = Array.from(text.matchAll(/\bregister\s+(\d{1,3})\b/gi)).map((m) => m[1]);
  for (const n of dedupe(explicit)) out.push(`Register ${n}`);
  return dedupe(out);
}

function extractTransactionNumber(text: string): string {
  const m =
    /\b(?:transaction|trans|trxn|txn)\s*(?:number\s*|#\s*|is\s*)?(\d{4,12})\b/i.exec(text);
  if (m) return m[1];
  const m2 = /\boriginal\s+transaction\s+(?:number\s+)?(?:is\s+)?(\d{4,12})\b/i.exec(text);
  if (m2) return m2[1];
  return "";
}

function extractItemNumber(text: string): string {
  const m = /\bitem\s*(?:number\s*|#\s*|is\s*)?(\d{6,15})\b/i.exec(text);
  if (m) return m[1];
  const m2 = /\bsku\s*(?:number\s*|#\s*|is\s*)?(\w{4,15})\b/i.exec(text);
  if (m2) return m2[1];
  return "";
}

function extractErrorMessage(text: string): string {
  const quoted = /"([^"]{4,200})"/.exec(text);
  if (quoted) return quoted[1].trim();
  // Single-quote pairs are ambiguous in dialogue — "we're", "isn't", "let's"
  // all contain an apostrophe, and naive matching would catch the text
  // *between* two contractions as a "quoted error message". Only accept
  // single-quoted regions that are clearly standalone (preceded by whitespace
  // or start-of-text and followed by whitespace/punctuation/end).
  const single = /(^|[\s(\[{])'([^']{4,200})'(?=$|[\s.,;:!?)\]}])/.exec(text);
  if (single) return single[2].trim();

  // Common phrasings: showing/displaying/saying/says/said followed by short phrase
  const keyworded =
    /\b(?:error|message|displayed|saying|says|said|showed|showing|gave|giving)[:\-]?\s+(?:a\s+|an\s+|the\s+)?["']?([^.!?\n"']{4,120})["']?/i.exec(
      text,
    );
  if (keyworded) {
    const candidate = keyworded[1].trim().replace(/[.,;]+$/, "");
    if (candidate && !/^(?:that|how|of|to)\b/i.test(candidate)) {
      return candidate;
    }
  }

  // Bare canonical retail errors
  const wellKnown = [
    /store\s+closed(?:\s+instead\s+of\s+terminal\s+closed)?/i,
    /terminal\s+closed/i,
    /hardware\s+failure/i,
    /failure\s+error\s+message/i,
    /no\s+items\s+available\s+for\s+refund\s+on\s+this\s+receipt/i,
  ];
  for (const p of wellKnown) {
    const m = p.exec(text);
    if (m) return m[0].trim();
  }
  return "";
}

function detectTypeOfTransaction(lower: string): string {
  if (/\bno[-\s]?receipt\s+return\b/i.test(lower)) return "No Receipt Return";
  if (/\blayaway\b/i.test(lower)) return "Layaway";
  if (/\bexchange(d)?\b/i.test(lower)) return "Exchange";
  if (/\breturn(ed)?\b/i.test(lower)) return "Return";
  if (/\boverride\b/i.test(lower)) return "Override";
  if (/\bno\s+sale\b/i.test(lower)) return "No Sale";
  if (/\brefund(?:ed)?\b/i.test(lower)) return "Refund";
  if (/\bcredit\b/i.test(lower) && /\b(card|customer|back)\b/i.test(lower)) return "Credit";
  if (/\bsale\b/i.test(lower)) return "Sale";
  if (/\bpayment\b/i.test(lower)) return "Payment";
  return "";
}

function detectPaymentType(lower: string): string {
  if (/\bwisely\s+card\b/i.test(lower)) return "Wisely Card";
  if (/\bgift\s+card\b/i.test(lower)) return "Gift Card";
  if (/\bcustomer'?s?\s+card\b|\bcredit\s+card\b|\bdebit\s+card\b/i.test(lower)) return "Card";
  if (/\bback\s+to\s+(?:the\s+)?card\b/i.test(lower)) return "Card";
  if (/\bcredit\b/i.test(lower)) return "Credit";
  if (/\bcash\b/i.test(lower)) return "Cash";
  if (/\bcheck\b/i.test(lower)) return "Check";
  return "";
}

function extractDateTime(text: string): string {
  const dateLine =
    /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4}\s+\d{1,2}:\d{2}\s*(?:AM|PM|am|pm)?/i.exec(
      text,
    );
  if (dateLine) return dateLine[0].trim();
  const slashDate =
    /\b\d{1,2}\/\d{1,2}\/\d{2,4}(?:\s+\d{1,2}:\d{2}\s*(?:AM|PM|am|pm)?)?/i.exec(text);
  if (slashDate) return slashDate[0].trim();
  return "";
}

function isReturnLike(t: string): boolean {
  return ["Return", "Exchange", "Layaway", "No Receipt Return", "Refund"].includes(t);
}

function detectCategory(text: string): string {
  for (const rule of CATEGORY_RULES) {
    if (rule.patterns.some((p) => p.test(text))) {
      return rule.category;
    }
  }
  return "";
}

function extractIssue(sentences: string[]): string {
  const issueMarkers =
    /\b(not\s+(printing|working|reading|responding|connecting|opening|coming back|letting|allowing)|(is|was|are|were)\s+(down|frozen|broken|offline|stuck|slow|crashing|not|displaying|showing)|won'?t|cannot|can'?t|will\s+not|isn'?t|aren'?t|no\s+(power|signal|response|internet)|frozen|crashing|stuck|error|hardware\s+failure|store\s+closed|click\s+is\s+broken|missing\s+in\s+pcf|not\s+showing|out\s+of\s+state|has\s+a\s+short|short\s+in\s+it)\b/i;
  // Strong causal markers — "called about/regarding/reporting" — anchor the
  // issue precisely. The bare "about" is intentionally NOT here because
  // tech-support questions like "what about the numbers?" overwhelm the signal.
  const strongCauseMarker =
    /\b(?:because|reporting(?:\s+that)?|reported(?:\s+that)?|called\s+about|called\s+because|called\s+regarding|calling\s+about|saying|regarding)\b/i;

  // Direct "the {device} {state}" pattern beats every other path.
  const directDeviceIssue =
    /\bthe\s+(keyboard|printer|register|pos|pin\s*pad|verifone|scanner|router|modem|inseego|cash\s*drawer|receipt\s+printer|kitchen\s+printer)\s+(?:has\s+a\s+short|is\s+(?:not|broken|frozen|down|stuck)|isn'?t\s+(?:working|printing|reading|responding)|won'?t\s+(?:print|work|read|respond|come\s+(?:up|on))|not\s+(?:working|printing|responding))[^.!?]*/i;
  for (const s of sentences) {
    const m = directDeviceIssue.exec(s);
    if (m) return cleanIssueText(m[0]);
  }

  for (const s of sentences) {
    if (strongCauseMarker.test(s) && issueMarkers.test(s)) {
      return cleanIssueText(extractAfterMarker(s, strongCauseMarker));
    }
  }
  for (const s of sentences) {
    if (strongCauseMarker.test(s)) {
      const rest = extractAfterMarker(s, strongCauseMarker);
      if (rest.length > 5) return cleanIssueText(rest);
    }
  }
  for (const s of sentences) {
    if (issueMarkers.test(s)) return cleanIssueText(s);
  }
  return "";
}

function extractAfterMarker(sentence: string, marker: RegExp): string {
  const match = marker.exec(sentence);
  if (!match) return sentence;
  return sentence.slice(match.index + match[0].length).trim();
}

/**
 * "Useful" issue text mentions a device noun or an issue verb. A stray
 * fragment like "the numbers" or "that just" passes the length check the
 * older code used but tells the reader nothing — better to fall back to
 * a device-driven description ("Keyboard issue on Register 2").
 */
function isUsefulIssueText(s: string): boolean {
  if (!s) return false;
  if (s.length < 10) return false;
  const lower = s.toLowerCase();
  const hasNoun = /\b(keyboard|printer|register|pos|pin\s*pad|verifone|scanner|router|modem|inseego|cash\s*drawer|internet|network|email|phone\s*line|employee|customer|cable|terminal|drawer|click)\b/i.test(
    lower,
  );
  const hasIssueVerb = /\b(not\s+(?:printing|working|reading|responding|coming|allowing|connecting)|won'?t|isn'?t|cannot|can'?t|frozen|stuck|broken|down|offline|error|hardware\s+failure|store\s+closed|has\s+a\s+short|missing|crashing)\b/i.test(
    lower,
  );
  return hasNoun || hasIssueVerb;
}

function cleanIssueText(s: string): string {
  let out = s.replace(/^that\s+/i, "");
  out = out.replace(/[.!?]+$/g, "").trim();
  out = out.replace(/^Store\s+\d+\s+had\s+/i, "they had ");
  out = out.replace(/^Store\s+\d+\s+/i, "");
  // Normalize register references to the proper-noun casing used elsewhere
  // ("on register 2" → "on Register 2"). Transcripts come in unpredictable
  // case; downstream templates display this string verbatim, so we fix it
  // here once at extraction time.
  out = out.replace(/\bregister\s+(\d+)\b/gi, "Register $1");
  out = out.trim();
  if (!/^(?:the|a|an|they|some|its|their|my|her|his|registers?\b)\s+/i.test(out)) {
    out = "the " + out;
  }
  // Mid-sentence reads better when the first content word is lowercase. ASR
  // output (or extracts from sentence-initial fragments) often hands us
  // "Credit card machine issue" with a stray uppercase that becomes ungrammatical
  // inside templates like "called reporting that the …". Preserve all-caps
  // abbreviations (POS, PCF, ID, PIN, NCR) and a small allow-list of domain
  // brand names; lowercase everything else.
  out = out.replace(
    /^(the|a|an|they|some|its|their|my|her|his|registers?)\s+(\S+)/i,
    (full, art: string, w: string) => {
      if (shouldPreserveLeadingCase(w)) return full;
      return `${art.toLowerCase()} ${w.charAt(0).toLowerCase()}${w.slice(1)}`;
    },
  );
  return out.trim();
}

function shouldPreserveLeadingCase(word: string): boolean {
  if (/^[A-Z]{2,}/.test(word)) return true;
  return /^(?:Verifone|Inseego|Toast|NCR|IBM|Microsoft|Windows|Apple|Mac|Toshiba|Citizen|Epson|Star|Bematech|Logitech|Symbol|Honeywell|Datalogic)\b/.test(
    word,
  );
}

const STEP_VERB_PREFIX =
  /^(?:(?:had|told|asked|got|made)\s+(?:them|the\s+store|him|her)\s+(?:to\s+)?|tried\s+to\s+)?(?:restart(?:ed|ing)?|reboot(?:ed|ing)?|reset|unplug(?:ged|ging)?|plug(?:ged|ging)?|replug(?:ged|ging)?|reconnect(?:ed|ing)?|check(?:ed|ing)?|verif(?:y|ied|ying)|test(?:ed|ing)?|ran|run|replac(?:e|ed|ing)|swap(?:ped|ping)?|clean(?:ed|ing)?|updat(?:e|ed|ing)|install(?:ed|ing)?|reinstall(?:ed|ing)?|configur(?:e|ed|ing)|power[\s-]?cycl(?:e|ed|ing)|renam(?:e|ed|ing)|did|performed|reseat(?:ed|ing)?|deactivat(?:e|ed|ing)|creat(?:e|ed|ing)|investigat(?:e|ed|ing)|confirm(?:ed|ing)?)\b/i;

const SKIP_STEP_PATTERNS = [
  /\b(it\s+worked|test\s+print\s+worked|test\s+print\s+was\s+successful|came\s+back\s+online)\b/i,
  /\bstill\s+(?:not|need|needs|happening|down|broken)\b/i,
  /\bissue\s+resolved\b/i,
  /\bescalated\b/i,
  /\bback\s+to\s+normal\b/i,
];

function extractSteps(text: string, sentences: string[]): string[] {
  // Run the polished instruction-pattern pass FIRST. Each match here is a
  // canonical past-tense label ("held the silver power button for 5 seconds")
  // — these are what we want to display to the user.
  const steps: string[] = [...extractInstructionSteps(text, sentences)];
  const signatures = new Set(steps.map(stepSignature));

  // Then add any remaining I/we statements (narrative-style transcripts) that
  // describe a step the instruction-pattern pass didn't already cover.
  const parts = text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+|,\s*(?:and\s+)?|\s+and\s+|\s+then\s+|\s+but\s+/i);

  for (const raw of parts) {
    let seg = raw
      .trim()
      .replace(/^(?:so|then|but|after\s+(?:that\s+)?)\s+/i, "")
      .replace(/[.!?]+$/g, "");
    seg = seg.replace(/^(?:I|we)\s+/i, "");
    if (!seg) continue;
    if (!STEP_VERB_PREFIX.test(seg)) continue;
    if (SKIP_STEP_PATTERNS.some((p) => p.test(seg))) continue;
    const humanized = humanizeStep(seg);
    const sig = stepSignature(humanized);
    if (sig && signatures.has(sig)) continue;
    if (steps.some((existing) => similarStep(existing, humanized))) continue;
    steps.push(humanized);
    if (sig) signatures.add(sig);
  }

  return dedupe(steps);
}

/**
 * Build a verb+object signature for step deduplication. Two phrasings of the
 * same action ("unplug the power cable" / "unplugged the power cable from the
 * back of the register") produce the same signature ("unplug|cable"), so the
 * second-best phrasing gets dropped without losing details from the winner.
 *
 * Returns the empty string when nothing canonical is found, in which case the
 * caller falls back to fuzzy similarity comparison.
 */
function stepSignature(step: string): string {
  const lower = step.toLowerCase();
  // Order matters: more specific verb-stems must come BEFORE generic ones,
  // because the loop breaks on the first match. "performed a register power
  // drain" needs to win on "perform" / "drain" — not "power" — otherwise it
  // collides with "powered the register back on" under the same signature.
  const VERBS: [string, string][] = [
    ["drain", "drain"],
    ["perform", "drain"],
    ["unplug", "unplug"],
    ["plug", "plug"],
    ["reconnect", "reconnect"],
    ["connect", "reconnect"],
    ["shutdown", "shutdown"],
    ["shutting", "shutdown"],
    ["shut", "shutdown"],
    ["held", "hold"],
    ["hold", "hold"],
    ["pressed", "press"],
    ["press", "press"],
    ["hit", "press"],
    ["powered", "power"],
    ["power", "power"],
    ["turned", "power"],
    ["turn", "power"],
    ["logged", "login"],
    ["log", "login"],
    ["restart", "restart"],
    ["reboot", "reboot"],
    ["reset", "reset"],
    ["reseat", "reseat"],
    ["renam", "rename"],
    ["test", "test"],
    ["confirm", "confirm"],
    ["check", "check"],
    ["verify", "verify"],
    ["access", "access"],
    ["navigat", "navigate"],
    ["go", "navigate"],
  ];
  // OBJECTS likewise: list more-specific phrases first. "drain" needs to win
  // over "register" inside "register power drain" so the perform-drain step
  // gets a (drain|drain) signature.
  const OBJECTS: [string, string][] = [
    ["power drain", "drain"],
    ["drain", "drain"],
    ["power button", "button"],
    ["silver button", "button"],
    ["button", "button"],
    ["power cable", "cable"],
    ["cable", "cable"],
    ["test print", "testprint"],
    ["printer", "printer"],
    ["keyboard", "keyboard"],
    ["point of sale", "pos"],
    ["pos", "pos"],
    ["cache", "cache"],
    ["services", "services"],
    ["connections", "connections"],
    ["back of the register", "back"],
    ["the back", "back"],
    ["front", "front"],
    ["register", "register"],
  ];
  let v = "";
  for (const [needle, canon] of VERBS) {
    if (new RegExp(`\\b${needle}`).test(lower)) {
      v = canon;
      break;
    }
  }
  let o = "";
  for (const [needle, canon] of OBJECTS) {
    if (lower.includes(needle)) {
      o = canon;
      break;
    }
  }
  if (!v && !o) return "";
  return `${v}|${o}`;
}

/**
 * Tech support gives instructions in imperative form. We scan the transcript
 * for canonical "do X" phrases and convert each to a past-tense step label.
 * Order matters — the first matching pattern wins for a given sentence.
 *
 * We only pull from sentences that look like instructions (start with a verb,
 * or have "you can / I want you to / let's / go ahead and" before the verb)
 * to avoid grabbing the store's confirmations ("yes I held it") as new steps.
 */
function extractInstructionSteps(text: string, sentences: string[]): string[] {
  const candidates: string[] = [];

  const INSTRUCTION_PATTERNS: { match: RegExp; label: (m: RegExpMatchArray) => string }[] = [
    {
      match: /\b(?:do\s+a\s+|perform\s+(?:a\s+)?|run\s+a\s+)?shut\s*down(?:\s+on)?(?:\s+the)?\s+(register|wrist|rest|machine|terminal|pos)\b/i,
      label: () => "shut down the register",
    },
    {
      match: /\b(?:do\s+a\s+shut\s*down|shut(?:ting)?\s+down|hit\s+shut\s*down)\b/i,
      label: () => "shut down the register",
    },
    {
      match: /\bunplug(?:ged|ging)?\s+(?:the\s+)?(?:black\s+|power\s+)?(?:power\s+)?cable\s+from\s+the\s+(?:back|register|box|boxes|register\s+box)\b/i,
      label: () => "unplugged the power cable from the back of the register",
    },
    {
      match: /\bunplug(?:ged|ging)?\s+(?:the\s+)?(?:black\s+|power\s+)?power\s+cable\b/i,
      label: () => "unplugged the power cable",
    },
    // "hold the power button ... for N seconds" — allows the speaker to
    // re-clarify the button color/location between "button" and "for N":
    // "hold the power button, the silver power button in the top right corner
    //  for 5 seconds." The lazy `[^.!?]*?` keeps the match within one sentence.
    {
      match: /\bhold(?:ing)?\s+(?:the\s+)?(?:silver\s+|black\s+|red\s+)?power\s+button[^.!?]*?\bfor\s+(\d+)\s+seconds?\b/i,
      label: (m) => `held the silver power button for ${m[1]} seconds`,
    },
    {
      match: /\bhold(?:ing)?\s+(?:the\s+)?(?:silver\s+|black\s+|red\s+)?power\s+button\b/i,
      label: () => "held the power button",
    },
    {
      // `(?:re)?` makes the entire "re" prefix optional. The previous form
      // `re?` literally meant "r" with optional "e", so a bare "connect"
      // would never match.
      match: /\b(?:re)?\s*connect(?:ed|ing)?\s+(?:the\s+)?(?:black\s+)?power\s+cable(?:\s+(?:again|back\s+in))?\b/i,
      label: () => "reconnected the power cable",
    },
    {
      match: /\bplug(?:ged|ging)?\s+(?:the\s+)?(?:black\s+|power\s+)?power\s+cable\s+(?:back\s+)?in\b/i,
      label: () => "reconnected the power cable",
    },
    {
      match: /\b(?:hit|press(?:ed|ing)?)\s+(?:the\s+)?(?:silver\s+|black\s+|red\s+)?power\s+button\b/i,
      label: () => "powered the register back on",
    },
    {
      match: /\b(?:turn(?:ed|ing)?\s+(?:it|the\s+register)\s+(?:back\s+)?on|power(?:ed)?\s+(?:it|the\s+register)\s+(?:back\s+)?on)\b/i,
      label: () => "powered the register back on",
    },
    {
      match: /\b(?:perform(?:ed|ing)?|did|do(?:ing)?)\s+(?:a\s+)?(?:register\s+)?power\s*drain\b/i,
      label: () => "performed a register power drain",
    },
    {
      match: /\bcan\s+you\s+(?:move|type)\b.*(?:keyboard|key)\b/i,
      label: () => "confirmed keyboard functionality",
    },
    {
      match: /\bkeyboard\s+(?:should\s+not\s+be\s+replaced|is\s+working|works\s+now|came\s+back)\b/i,
      label: () => "confirmed keyboard functionality",
    },
    {
      match: /\bcan\s+you\s+move\s+the\s+keyboard\b/i,
      label: () => "confirmed keyboard functionality",
    },
    {
      match: /\blog(?:ged|ging)?\s+(?:back\s+)?(?:in|into)\s+(?:the\s+)?(?:pos|point\s+of\s+sale|register)\b/i,
      label: () => "logged into the POS",
    },
    {
      match: /\bmake\s+sure\s+you\s+(?:can\s+)?log\s+(?:back\s+)?(?:in|into)\b/i,
      label: () => "logged into the POS",
    },
    {
      match: /\bgo\s+to\s+the\s+back\b/i,
      label: () => "accessed the back of the register",
    },
    // Credit-card / payment-terminal flow patterns — added so transcripts
    // that talk about card-swipe glitches don't show "Steps Taken: Low".
    {
      match: /\bescape\s+(?:out\s+)?of\s+(?:the\s+|this\s+)?transaction\b/i,
      label: () => "escaped out of the transaction",
    },
    {
      match: /\bread\s+(?:back\s+|through\s+)?(?:it|the\s+transaction|the\s+items?)\s+(?:back\s+)?(?:from|through)\s+(?:the\s+)?beginning\b/i,
      label: () => "re-entered the transaction from the beginning",
    },
    {
      match: /\b(?:do\s+it\s+|type\s+|press\s+keys?\s+)slow(?:ly|er)\b|\bgo\s+slow(?:ly|er)\b/i,
      label: () => "advised store to type slowly between key presses",
    },
    {
      match: /\bwait\s+(?:about\s+)?(?:one|a|1)\s+second\s+(?:between|before|after)\s+(?:every|each)\s+(?:key|button|press|character)\b/i,
      label: () => "advised store to wait one second between key presses",
    },
    {
      match: /\bswip(?:e|ed|ing)\s+the\s+card\s+(?:again|back)\b/i,
      label: () => "swiped the card again",
    },
    {
      match: /\b(?:re-?run|run\s+(?:the\s+)?(?:card|transaction)\s+(?:again|back))\b/i,
      label: () => "ran the transaction again",
    },
  ];

  for (const sentence of sentences) {
    // Skip clearly-store-side reports that don't describe a *new* action.
    if (/\b(?:we|I)\s+(?:got|have|are\s+having|see|saw)\b/i.test(sentence)) continue;

    for (const rule of INSTRUCTION_PATTERNS) {
      const m = sentence.match(rule.match);
      if (!m) continue;
      candidates.push(rule.label(m));
    }
  }

  // Dedupe by step signature, keeping the longer label. This is what makes
  // "held the silver power button for 5 seconds" win over the bare "held the
  // power button" — both share the (hold|button) signature but the first one
  // carries the timing detail.
  const bySig = new Map<string, string>();
  type Slot = { kind: "sig"; sig: string } | { kind: "bare"; idx: number };
  const slots: Slot[] = [];
  const bare: string[] = [];

  for (const c of candidates) {
    const sig = stepSignature(c);
    if (sig) {
      if (!bySig.has(sig)) {
        bySig.set(sig, c);
        slots.push({ kind: "sig", sig });
      } else if (c.length > bySig.get(sig)!.length) {
        bySig.set(sig, c);
      }
    } else if (!bare.includes(c)) {
      bare.push(c);
      slots.push({ kind: "bare", idx: bare.length - 1 });
    }
  }

  return slots.map((s) => (s.kind === "sig" ? bySig.get(s.sig)! : bare[s.idx]));
}

function similarStep(a: string, b: string): boolean {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/\b(the|a|an)\b/g, "")
      .replace(/\s+/g, " ")
      .trim();
  const na = norm(a);
  const nb = norm(b);
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  return false;
}

function humanizeStep(s: string): string {
  let out = s;
  out = out.replace(/^had\s+them\s+(?:to\s+)?/i, "had the store ");
  out = out.replace(/^told\s+them\s+to\s+/i, "had the store ");
  out = out.replace(/^asked\s+them\s+to\s+/i, "asked the store to ");
  out = out.replace(/^got\s+them\s+to\s+/i, "had the store ");
  out = out.replace(/^made\s+them\s+/i, "had the store ");
  out = out.replace(/^tried\s+to\s+/i, "");
  out = out.replace(/\bthem\b/gi, "the store");
  out = out.charAt(0).toLowerCase() + out.slice(1);
  return out.trim();
}

function detectServicesRestarted(text: string): string[] {
  const services: string[] = [];
  if (/\b(restart(?:ed|ing)?|reset)\s+(?:the\s+)?(?:Pro\s+(?:and\s+(?:the\s+)?)?COM|com\s+services?\s+and\s+(?:the\s+)?pro\s+services?|com\s+(?:and\s+pro\s+)?services?|pro\s+(?:and\s+com\s+)?services?)/i.test(
      text,
    )
  ) {
    if (/\bpro\s+services?\b/i.test(text)) services.push("Pro services");
    if (/\bcom\s+services?\b/i.test(text)) services.push("COM services");
  } else {
    if (/\b(restart(?:ed|ing)?|reset)\s+(?:the\s+)?pro\s+services?\b/i.test(text))
      services.push("Pro services");
    if (/\b(restart(?:ed|ing)?|reset)\s+(?:the\s+)?com\s+services?\b/i.test(text))
      services.push("COM services");
    if (/\b(restart(?:ed|ing)?|reset)\s+(?:the\s+)?bos\s+services?\b/i.test(text))
      services.push("BOS services");
    if (/\bservices?\s+(were|was)\s+restarted\b/i.test(text)) services.push("services");
  }
  return dedupe(services);
}

interface ActionFlags {
  cacheRenamed: boolean;
  powerDrainPerformed: boolean;
  manualRebootPerformed: boolean;
  cablesReseated: boolean;
  connectionsConfirmed: boolean;
}

function detectActionFlags(text: string): ActionFlags {
  return {
    cacheRenamed: /\b(rename(?:d|ing)?|renaming)\s+(?:the\s+)?cache\b/i.test(text),
    powerDrainPerformed: /\b(register\s+)?power\s*drain(?:ed|ing)?\b/i.test(text),
    manualRebootPerformed: /\bmanual(?:ly)?\s+reboot(?:ed|ing)?\b/i.test(text),
    cablesReseated: /\breseat(?:ed|ing)?\s+(?:the\s+)?cables?\b/i.test(text),
    connectionsConfirmed:
      /\bconfirm(?:ed|ing)?\s+(?:the\s+)?connections?\b/i.test(text) ||
      /\bcheck(?:ed|ing)?\s+(?:the\s+)?connections?\b/i.test(text),
  };
}

interface CallerInfo {
  name: string;
  role: string;
  evidence: string;
  needsReview: boolean; // True when name came from a brittle Q&A path
}

function extractCaller(text: string, sentences: string[]): CallerInfo {
  // Phase 11B: try the shared, generic name detector FIRST. It uses the
  // same patterns the live chunk processor uses, so live + final agree on
  // what counts as a name. The helper handles "this is X", "my name is X",
  // "X from Store N", "the manager, X", and tech→caller Q→A pairs.
  const shared = detectCallerNameInSequence(
    sentences.map((s) => ({ text: s, side: "unknown" as const })),
  );
  if (shared) {
    return {
      name: shared.name,
      role: shared.role ?? "",
      evidence: shared.source,
      needsReview: shared.confidence === "review_needed",
    };
  }

  // Existing patterns kept as a fallback — these recognise post-hoc summary
  // shapes the generic helper isn't trained on:

  // "Randa from Store 639 called" (third-person "called")
  const namedFromStore =
    /\b([A-Z][a-z]{2,15}(?:\s+[A-Z][a-z]{2,15})?)\s+from\s+Store\s+\d+\s+called\b/.exec(text);
  if (namedFromStore && !isStopName(namedFromStore[1])) {
    return { name: namedFromStore[1].trim(), role: "", evidence: namedFromStore[0], needsReview: false };
  }

  // "Store 657: Keyana called"
  const storeColonName = /\bStore\s+\d+\s*[:,\-]\s*([A-Z][a-z]{2,15})\s+called\b/.exec(text);
  if (storeColonName && !isStopName(storeColonName[1])) {
    return { name: storeColonName[1].trim(), role: "", evidence: storeColonName[0], needsReview: false };
  }

  // "Keyana called"
  const namedCalled = /\b([A-Z][a-z]{2,15})\s+called\b/.exec(text);
  if (namedCalled && !isStopName(namedCalled[1])) {
    return { name: namedCalled[1].trim(), role: "", evidence: namedCalled[0], needsReview: false };
  }

  // "Store manager from Store X called" / "the manager called"
  const roleCall =
    /\b((?:store\s+manager|manager|assistant\s+manager|associate|employee))\s+(?:from\s+Store\s+\d+\s+)?called\b/i.exec(
      text,
    );
  if (roleCall) {
    return {
      name: "",
      role: titleCaseRole(roleCall[1]),
      evidence: roleCall[0],
      needsReview: false,
    };
  }

  // "Store 759's store manager called"
  const possessiveStore =
    /\bStore\s+\d+'?s?\s+(store\s+manager|manager|assistant\s+manager|employee|associate)\s+called\b/i.exec(
      text,
    );
  if (possessiveStore) {
    return { name: "", role: titleCaseRole(possessiveStore[1]), evidence: possessiveStore[0], needsReview: false };
  }

  return { name: "", role: "", evidence: "", needsReview: false };
}

function isStopName(s: string): boolean {
  // Filter capitalized common words that aren't names
  return /^(?:Store|Register|The|She|He|They|It|We|Customer|Manager|Yesterday|Today|Tomorrow|Earlier|Later|Inseego|VeriFone|Pro|Com)$/i.test(
    s,
  );
}

function titleCaseRole(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

interface EmployeeIds {
  employeeName: string;
  employeeId: string;
  operatorId: string;
}

function extractEmployeeIds(text: string): EmployeeIds {
  const employeeId = /\bemployee\s+ID\s*(?:is\s*|=\s*|#\s*)?(\w{2,12})\b/i.exec(text)?.[1] ?? "";
  const operatorId = /\boperator\s+ID\s*(?:is\s*|=\s*|#\s*)?(\w{2,12})\b/i.exec(text)?.[1] ?? "";
  return { employeeName: "", employeeId, operatorId };
}

interface PartInfo {
  partNeeded: boolean;
  deviceConfirmed: boolean;
  replacementReason: string;
  evidence: string;
}

function detectPartReplacement(
  text: string,
  devices: string[],
  registerNumber: string,
): PartInfo {
  // Explicit negations win — if tech support said "should not be replaced",
  // "no replacement needed", or "we fixed it by [doing X]", flag this as
  // *not* a replacement case even when the words "replace" / "replacement"
  // appear elsewhere in the transcript.
  const explicitNoReplacement =
    /\b(?:should\s+not\s+be\s+replaced|do(?:es)?\s+not\s+need\s+(?:a\s+)?replacement|no\s+replacement\s+(?:needed|necessary|required)|fixed\s+(?:it\s+)?(?:by|with(?:out)?\s+replacement)|did\s+not\s+need\s+(?:a\s+)?replacement|back\s+to\s+normal\s+after\s+(?:a\s+|the\s+)?power\s*drain)\b/i;
  if (explicitNoReplacement.test(text)) {
    return {
      partNeeded: false,
      deviceConfirmed: devices.length > 0,
      replacementReason: "",
      evidence: "",
    };
  }

  const partKeywords =
    /\b(replace(?:d|ment)?|send\s+(?:a\s+)?new|please\s+send|needs?\s+(?:a\s+)?(?:new|replacement)|ticket\s+will\s+be\s+(?:opened|open)\s+to\s+replace|bad\s+power\s+(?:supply\s+)?port|keeps?\s+losing\s+power|click\s+is\s+broken|cable\s+is\s+bad|hardware\s+failure\s+persists|requires?\s+replacement)\b/i;
  const m = partKeywords.exec(text);
  const partNeeded = !!m;
  if (!partNeeded) {
    return {
      partNeeded: false,
      deviceConfirmed: devices.length > 0,
      replacementReason: "",
      evidence: "",
    };
  }

  let replacementReason = "";
  if (/\bbad\s+power\s+(?:supply\s+)?port\b/i.test(text)) replacementReason = "Bad power port";
  else if (/\bkeeps?\s+losing\s+power\s+when\s+(?:moved|it\s+moves)/i.test(text))
    replacementReason = "Loses power when moved";
  else if (/\bclick\s+is\s+broken\b/i.test(text)) replacementReason = "Click is broken";
  else if (/\bcable\s+is\s+bad\b|\bbad\s+cable\b/i.test(text)) replacementReason = "Bad cable";
  else if (/\bhardware\s+failure\s+persists\b/i.test(text))
    replacementReason = "Hardware failure persists";

  const deviceConfirmed = devices.length > 0 || /\bregister\s+\d+\s+\w+/i.test(text) || !!registerNumber;

  return {
    partNeeded: true,
    deviceConfirmed,
    replacementReason,
    evidence: m[0],
  };
}

interface ExistingTicketInfo {
  mentioned: boolean;
  ticketNumber: string;
  details: string;
}

function detectExistingTicket(text: string): ExistingTicketInfo {
  const mentions =
    /\b(there\s+is\s+(?:already\s+)?a?\s*ticket\s+(?:already\s+)?open|existing\s+ticket|ticket\s+(?:was|is)\s+already\s+open|already\s+(?:has|have)\s+a\s+ticket)\b/i;
  const m = mentions.exec(text);
  if (!m) return { mentioned: false, ticketNumber: "", details: "" };

  const numMatch = /\bticket\s*(?:number\s*|#\s*)?(\d{4,12})\b/i.exec(text);
  const detail = /\bopen\s+(?:to\s+replace|for|already\s+for)\s+([^.!?]+)/i.exec(text);
  return {
    mentioned: true,
    ticketNumber: numMatch?.[1] ?? "",
    details: detail?.[1]?.trim() ?? m[0],
  };
}

function extractVendorTicketNumber(text: string): string {
  const att = /\b(?:ATT|AT&T|vendor)\s+ticket\s*(?:number\s*|#\s*)?(\w{4,15})\b/i.exec(text);
  return att?.[1] ?? "";
}

function detectWrongCaller(text: string): boolean {
  return (
    /\b(?:i\s+think\s+)?(?:i\s+have\s+|got\s+)?(?:the\s+)?wrong\s+(?:number|department|extension|line)\b/i.test(
      text,
    ) ||
    /\bdialed\s+(?:the\s+)?wrong\b/i.test(text) ||
    /\boops,?\s+wrong\b/i.test(text) ||
    /\bsorry,?\s+wrong\s+number\b/i.test(text) ||
    /\bdoes\s+not\s+belong\s+to\s+(?:this|our)\s+(?:department|team)\b/i.test(text) ||
    /\bnot\s+(?:the\s+right|tech)\s+(?:support|department)\b/i.test(text)
  );
}

interface TransferInfo {
  transferNeeded: boolean;
  department: string;
}

function detectTransfer(text: string): TransferInfo {
  const m =
    /\b(?:transfer(?:red|ring)?|redirect(?:ed|ing)?|forward(?:ed|ing)?|sent\s+(?:them\s+|the\s+caller\s+)?)(?:\s+(?:them|the\s+caller))?\s+(?:to|over\s+to)\s+([A-Z][\w\s&\-]{1,40})/i.exec(
      text,
    );
  if (m) {
    return {
      transferNeeded: true,
      department: cleanDepartment(m[1]),
    };
  }
  const m2 = /\bneeds?\s+to\s+(?:contact|call|reach)\s+([A-Z][\w\s&\-]{1,40})/i.exec(text);
  if (m2) {
    return {
      transferNeeded: true,
      department: cleanDepartment(m2[1]),
    };
  }
  if (
    /\b(?:transfer(?:red|ring)?|redirected|forwarded)\b/i.test(text) &&
    !/\b(?:do\s+not|don'?t)\s+transfer/i.test(text)
  ) {
    return { transferNeeded: true, department: "" };
  }
  return { transferNeeded: false, department: "" };
}

function cleanDepartment(s: string): string {
  return s
    .replace(/[.,;].*/, "")
    .trim()
    .split(/\s+/)
    .slice(0, 6)
    .join(" ");
}

function detectStoreAdvised(text: string): string {
  const m = /\bstore\s+was\s+advised\s+to\s+([^.!?]+)/i.exec(text);
  if (m) return m[1].trim();
  const m2 = /\btold\s+the\s+store\s+to\s+([^.!?]+)/i.exec(text);
  if (m2) return m2[1].trim();
  const m3 = /\badvised\s+(?:them|the\s+store)\s+to\s+([^.!?]+)/i.exec(text);
  if (m3) return m3[1].trim();
  return "";
}

const RESULT_EVIDENCE_PATTERN =
  /(back\s+to\s+normal|back\s+online|both\s+registers\s+are\s+back\s+online|issue\s+resolved|resolved|fixed|escalated|came\s+back\s+online|test\s+print\s+(?:was\s+successful|worked)|(?:it|test\s+print|the\s+receipt|the\s+printer)\s+printed(?:\s+(?:now|fine|successfully|correctly))?|printer\s+is\s+(?:back\s+)?working)/i;

function extractEvidenceFor(text: string, pattern: RegExp): string {
  const m = pattern.exec(text);
  return m ? m[0] : "";
}

function dedupe<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

function detectResult(lower: string): TicketResult {
  if (/\bescalat/i.test(lower)) return "Escalated";
  if (/\bwaiting\s+on\s+vendor/i.test(lower)) return "WaitingOnVendor";
  if (/\bwaiting\s+on\s+(?:the\s+)?store/i.test(lower)) return "WaitingOnStore";
  if (/\b(part(s)?\s+(needed|required|on\s+order))\b/i.test(lower)) return "PartsNeeded";
  if (/\bticket\s+will\s+be\s+(?:open(?:ed)?|cut)\s+to\s+replace\b/i.test(lower))
    return "PartsNeeded";
  if (
    /\b(?:replacement|new)\s+\w+\s+(?:is|will\s+be)\s+(?:needed|required|sent|shipped)\b/i.test(
      lower,
    )
  )
    return "PartsNeeded";
  if (/\bneeds?\s+(?:to\s+be\s+)?replac(?:ed|ement)\b/i.test(lower)) return "PartsNeeded";
  if (/\bsend\s+(?:a\s+)?(?:new|replacement)\s+\w+/i.test(lower)) return "PartsNeeded";
  if (/\bhardware\s+failure\s+persists\b/i.test(lower)) return "PartsNeeded";
  if (/\bdid\s+not\s+answer\b|\bno\s+answer\b/i.test(lower)) return "StoreDidNotAnswer";
  if (/\bcould\s+not\s+reproduce\b|\bcouldn'?t\s+reproduce\b/i.test(lower))
    return "CouldNotReproduce";
  if (/\bcall\s+(?:back|tomorrow)\b/i.test(lower)) return "FollowUpRequired";
  if (/\bfollow[\s-]?up\b/i.test(lower)) return "FollowUpRequired";
  if (/\bmonitor(ing)?\b/i.test(lower)) return "Monitoring";
  if (/\bstill\s+(?:not|down|happening|broken|need|needs|there)\b/i.test(lower)) return "Pending";

  if (
    /\b(issue\s+resolved|resolved|fixed|it\s+worked|came\s+back\s+online|both\s+registers\s+are\s+back\s+online|back\s+online|test\s+print\s+(?:was\s+successful|worked|completed)|card\s+(?:transaction\s+)?(?:went\s+through|was\s+approved)|back\s+to\s+normal|back\s+up|register\s+(?:should\s+be|is)\s+back\s+up|can\s+now\s+(?:log\s+in|sign\s+in|access|use|connect|process)|(?:it|test\s+print|the\s+receipt|the\s+printer)\s+printed(?:\s+(?:now|fine|successfully|ok|okay|the\s+receipt|correctly))?|the\s+printer\s+(?:is|was)\s+(?:working|back|printing)(?:\s+(?:again|now))?|printer\s+is\s+(?:back\s+)?working|we\s+fixed\s+it\s+by|keyboard\s+(?:should\s+not\s+be\s+replaced|is\s+working|works\s+now))\b/i.test(
      lower,
    )
  ) {
    return "Resolved";
  }

  if (/\b(pending|in\s+progress)\b/i.test(lower)) return "Pending";

  return "ResultNotConfirmed";
}

function extractParts(text: string): string[] {
  const parts: string[] = [];
  const partPatterns: { name: string; pattern: RegExp }[] = [
    { name: "USB cable", pattern: /\busb\s*cable\b/i },
    { name: "power cable", pattern: /\bpower\s*cable\b/i },
    { name: "ethernet cable", pattern: /\bethernet\s*cable\b/i },
    { name: "network cable", pattern: /\bnetwork\s*cable\b/i },
    { name: "keyboard cable", pattern: /\bkeyboard\s*cable\b/i },
    { name: "receipt paper", pattern: /\breceipt\s*(?:paper|roll)\b/i },
    { name: "receipt printer", pattern: /\breceipt\s*printer\b/i },
    { name: "keyboard", pattern: /\bkeyboard\b/i },
    { name: "printer", pattern: /\bprinter\b/i },
    { name: "router", pattern: /\brouter\b/i },
    { name: "modem", pattern: /\bmodem\b/i },
    { name: "pin pad", pattern: /\bpin\s*pad\b/i },
    { name: "scanner", pattern: /\bscanner\b/i },
    { name: "cable", pattern: /\bcable\b/i },
  ];
  for (const p of partPatterns) if (p.pattern.test(text)) parts.push(p.name);
  return dedupe(parts);
}

function extractDevices(text: string): string[] {
  const devices: string[] = [];
  const devicePatterns: { name: string; pattern: RegExp }[] = [
    { name: "POS", pattern: /\bpos\b|point\s*of\s*sale/i },
    { name: "register", pattern: /\bregister\b/i },
    { name: "receipt printer", pattern: /receipt\s*printer/i },
    { name: "kitchen printer", pattern: /kitchen\s*printer/i },
    {
      name: "credit card machine",
      pattern: /\bcredit\s*card\s*(?:machine|terminal|reader)\b|\bpayment\s*terminal\b|\bcard\s*reader\b/i,
    },
    { name: "keyboard", pattern: /\bkeyboard\b/i },
    { name: "pin pad", pattern: /pin\s*pad/i },
    { name: "VeriFone", pattern: /verifone/i },
    { name: "scanner", pattern: /scanner/i },
    { name: "back office computer", pattern: /back\s*office/i },
    { name: "router", pattern: /router/i },
    { name: "modem", pattern: /modem/i },
    { name: "Inseego", pattern: /inseego/i },
    { name: "Lotus Notes", pattern: /lotus\s*notes/i },
    { name: "PCF", pattern: /\bpcf\b/i },
    { name: "BOS", pattern: /\bbos\b|back\s+office\s+system/i },
  ];
  for (const d of devicePatterns) if (d.pattern.test(text)) devices.push(d.name);
  return dedupe(devices);
}

function primaryDeviceType(text: string, devices: string[]): string {
  const lower = text.toLowerCase();
  // Specificity: prefer named devices over the generic "keyboard" — when a
  // call mentions "the keyboard on the credit card machine", the *device* is
  // the credit-card machine; "keyboard" is a part of it.
  if (/\bcredit\s*card\s*(?:machine|terminal|reader)\b|\bpayment\s*terminal\b|\bcard\s*reader\b/.test(lower))
    return "credit card machine";
  if (/\breceipt\s*printer\b/.test(lower)) return "receipt printer";
  if (/\bverifone|pin\s*pad/.test(lower)) return "VeriFone";
  if (/\binseego|router\b/.test(lower)) return "Inseego";
  if (/\bkeyboard\b/.test(lower)) return "keyboard";
  if (/\bregister\b/.test(lower)) return "register";
  return devices[0] ?? "";
}

function detectConfirmation(lower: string): string {
  if (/\bkeyboard\s+(?:should\s+not\s+be\s+replaced|is\s+working|works\s+now|came\s+back)\b/i.test(lower)) {
    return "Keyboard confirmed working";
  }
  if (/\bcan\s+you\s+move\s+the\s+keyboard\b.*\b(?:yes|yeah|yep)\b/i.test(lower)) {
    return "Keyboard confirmed working";
  }
  if (/\btest\s+print\s+(was\s+successful|worked|completed|succeeded)/i.test(lower)) {
    return "Successful test print";
  }
  if (
    /\b(?:it|test\s+print|the\s+receipt|the\s+printer)\s+printed(?:\s+(?:now|fine|successfully|ok|okay|the\s+receipt|correctly))?\b/i.test(
      lower,
    )
  ) {
    return "Successful test print";
  }
  if (/\bthe\s+printer\s+(?:is|was)\s+(?:working|back|printing)\b/i.test(lower)) {
    return "Successful test print";
  }
  if (/\bcard\s+(?:transaction\s+)?(?:went\s+through|was\s+approved)/i.test(lower)) {
    return "Successful card transaction";
  }
  if (/\bboth\s+registers\s+are\s+back\s+online\b/i.test(lower))
    return "Both registers back online";
  if (/\bcame\s+back\s+online\b|\bback\s+online\b/i.test(lower)) return "Connection restored";
  if (/\bback\s+to\s+normal\b/i.test(lower)) return "Confirmed back to normal";
  if (/\bback\s+up\b/i.test(lower)) return "Confirmed back up";
  if (/\bit\s+worked\b/i.test(lower)) return "Confirmed working by store";
  return "";
}
