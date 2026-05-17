import type { SpeakerLabel, SpeakerSegment } from "../types/speaker";

// ───────────────────────────────────────────────────────────────────────
// Signal lists
//
// Each list is a bag of regex hints for one role. classify() scans every
// pattern, sums hits per role, and the highest-scoring role wins. This is
// MUCH more robust than the old "first-match-wins" approach, which would
// flip an entire dialogue to "store_employee" the moment one ambiguous
// phrase ("we are on Register 2") leaked into a tech-support segment.
//
// Patterns are written so each one captures one *signal*. Stacking many
// weaker signals in a segment beats one accidental hit on the wrong role.
// ───────────────────────────────────────────────────────────────────────

const TECH_SIGNALS: RegExp[] = [
  // Greetings / intake
  /\bcomputer\s+room\b/i,
  /\bthank\s+you\s+for\s+calling\b/i,
  /\bthis\s+is\s+(?:tech\s+)?support\b/i,
  /\bcalling\s+from\s+(?:tech\s+support|support|help\s*desk)\b/i,
  // Intake questions (caller-side)
  /\bwhat\s+store\s+(?:are\s+you\s+calling|number|is\s+this|is\s+that)\b/i,
  /\bmay\s+I\s+(?:please\s+)?have\s+your\s+name\b/i,
  /\bwho\s+(?:am\s+I|are\s+we)\s+speaking\s+with\b/i,
  /\bwhich\s+register\s+(?:is\s+(?:that|this|affected|down|broken)|are\s+you\s+on)\b/i,
  /\bwhich\s+(?:device|machine|terminal|register)\b/i,
  /\bhow\s+(?:can|may)\s+I\s+help\s+you\b/i,
  /\bwhat'?s\s+going\s+on\b/i,
  // Diagnostic questions
  /\bcan\s+you\s+(?:move|type|see|read|spell|hear|hold|wait|test|try|check|verify|describe|tell\s+me)\b/i,
  /\bdo\s+you\s+see\b/i,
  /\bhave\s+you\s+tried\b/i,
  /\bwhat\s+(?:is|are|does|do|happens?)\b/i,
  /\bwhat\s+is\s+showing\s+on\b/i,
  /\bis\s+it\s+(?:working|on|coming\s+back|frozen|showing|displaying|back\s+up)\b/i,
  /\bis\s+(?:everything|it|the\s+register|the\s+printer)\s+working\s+now\b/i,
  /\bare\s+you\s+able\s+to\b/i,
  /\bcan\s+you\s+type\s+(?:anything|numbers|letters)\b/i,
  // Imperatives / instructions
  /^(?:tech\s+support:\s*)?(?:please\s+|so\s+|then\s+|now\s+)?(?:go\s+(?:to|ahead|back)|hit|press|click|tap|move|hold|unplug|plug|reseat|reconnect|restart|reboot|reset|shut\s*down|power\s*(?:on|off|cycle|down|up)|turn\s+(?:on|off)|leave|wait|test|try|check|verify|update|install|configure|rename|drain|swap|replace|log\s+(?:in|into))\b/i,
  /\bhold\s+the\s+power\s+button\b/i,
  /\bunplug\s+the\s+(?:power|cable|cord)\b/i,
  /\bgo\s+ahead\s+and\s+shut\s+down\b/i,
  /\bI\s+want\s+you\s+to\s+(?:go|hold|press|hit|click|move|unplug|plug|restart|reboot|reset|shut|power|turn|wait|test|try|check|verify|connect|reconnect)\b/i,
  /\blet'?s\s+(?:start|do|try|test|begin|go\s+ahead)\b/i,
  /\bgo\s+ahead\s+and\b/i,
  /\b(can\s+i|can\s+you|could\s+you|please)\s+(have|tell|read|give|spell|confirm|provide|restart|reboot|unplug|plug|reset|reseat|reconnect|test|run|try|check|verify|update|install|configure|rename|drain|swap|replace)\b/i,
  /\bplease\s+(?:give\s+me|read|hold|stand\s+by|reboot|restart|unplug|plug|wait)\b/i,
  // Tech-side action statements ("on my end" / "I'll open a ticket")
  /\bi\s+(?:restarted|renamed|reset|reseated|drained|rebooted|tested|advised|escalated|opened|cut|created|verified|confirmed|ran|kicked\s+off)\b/i,
  /\bi\s+(?:will|'?ll|would|'?d)\s+(?:open|cut|create|escalate|send|run)\b/i,
  /\bticket\s+(?:will\s+be\s+)?(?:opened|cut)\b/i,
  /\b(?:on\s+my\s+end|on\s+our\s+end|i'?ll\s+(?:open|escalate|create))\b/i,
  // Closing signals
  /\bis\s+there\s+anything\s+else\s+I\s+can\s+help\s+you\s+with\b/i,
  /\banything\s+else\s+(?:I\s+can\s+help\s+(?:you\s+)?with|today)\b/i,
  /\bhave\s+a\s+great\s+day\b/i,
  // Diagnostic conclusions
  /\bso\s+(?:that|this)\s+(?:just\s+)?means?\b/i,
  /\bkeyboard\s+has\s+a\s+short\b/i,
  /\bwe\s+fixed\s+it\s+by\b/i,
];

const STORE_SIGNALS: RegExp[] = [
  // Self-identification
  /^store\s+\d+\b/i,
  /^(?:my|our)\s+(?:store|register|printer|keyboard|verifone)\b/i,
  /\bthis\s+is\s+(?:store\s+)?\d+\b/i,
  /\bi\s+work\s+(?:at|in)\b/i,
  /\b(?:my|our)\s+(?:associate|cashier)\b/i,
  /\bi\s+am\s+calling\s+from\s+store\b/i,
  /\bcalling\s+from\s+store\s+\d+\b/i,
  // First-person store reports
  /\b(?:we|i)\s+(?:got|have|are\s+having|see|saw|got\s+a|have\s+a)\b/i,
  /\b(?:we|i)\s+(?:can'?t|cannot|aren'?t\s+able\s+to)\b/i,
  /\bit\s+(?:says|shows|won'?t|will\s+not|is\s+saying|displayed|showed|isn'?t|is\s+not)\b/i,
  /\bregister\s+\d+\s+(?:isn'?t|is\s+not|won'?t|wouldn'?t)\b/i,
  // Store reporting
  /\bcustomer\s+(?:is|wants|needs|came\s+in|brought)\b/i,
  /\bthe\s+keyboard\s+(?:isn'?t|is\s+not|won'?t)\s+(?:work|type|respond|let|letting)/i,
  /\bkeyboard\s+is\s+not\s+letting\s+me\s+type\b/i,
  /\b(?:the\s+)?mouse\s+(?:works|is\s+working|moves|is\s+moving)\b/i,
  /\bthe\s+(?:printer|register|pos|pin\s*pad|verifone|scanner)\s+(?:is|are|won'?t|isn'?t|aren'?t)\s+(?:down|frozen|broken|offline|stuck|not)/i,
  /\bit\s+says\s+hardware\s+failure\b/i,
  // Confirmations of tech-instructed action
  /^(?:yes|yeah|yep|yup|okay|ok|alright|all\s+right|sure|got\s+it)\b[,.\s]?$/i,
  /^(?:no|nope|not\s+yet)\b[,.\s]?$/i,
  /\bit\s+(?:printed|works?|worked|is\s+working|came\s+back|back\s+up|is\s+back\s+to\s+normal)\b/i,
  /\bback\s+to\s+normal\b/i,
  /\bstill\s+not\s+working\b/i,
  /\b(?:we|the\s+register)\s+(?:are\s+|is\s+)?back\s+(?:up|online)\b/i,
];

const MANAGER_SIGNALS: RegExp[] = [
  /\bi'?m\s+the\s+(?:store\s+)?manager\b/i,
  /\bthis\s+is\s+the\s+(?:store\s+)?manager\b/i,
  /\bstore\s+manager\s+(?:from|of|here|speaking|calling)\b/i,
  /\bassistant\s+manager\b/i,
  /\bas\s+the\s+manager\b/i,
];

const VENDOR_SIGNALS: RegExp[] = [
  /\bcalling\s+from\s+(?:att|at&t|verizon|inseego|verifone|toshiba)\b/i,
  /\bvendor\s+(?:ticket|reference|case)\b/i,
  /\bthis\s+is\s+(?:att|at&t|verizon|the\s+vendor)\b/i,
];

const CUSTOMER_SIGNALS: RegExp[] = [
  /\bi'?m\s+(?:the\s+)?customer\b/i,
  /\bi\s+came\s+in\s+to\s+(?:return|exchange|buy)\b/i,
];

const WRONG_CALLER_SIGNALS: RegExp[] = [
  /\b(?:i\s+think\s+)?(?:i\s+have\s+)?(?:the\s+)?wrong\s+(?:number|department|extension)\b/i,
  /\bthis\s+isn'?t\s+(?:tech\s+)?support\b/i,
  /\bdialed\s+the\s+wrong\b/i,
  /\boops,?\s+wrong\b/i,
  /\bi\s+meant\s+to\s+call\b/i,
  /\bsorry,?\s+wrong\s+number\b/i,
];

// Adjacency rules — what kind of question on segment N implies the role of N+1.
// "intake" questions get answered by the store side; "diagnostic" questions get
// answered by the store side too. Either way, an answer right after a tech
// question is store-side, not tech-side. We use this to break ties or rescue
// "unknown" segments that hold short factual answers (e.g. "Register 2.").
const TECH_INTAKE_OR_DIAGNOSTIC_QUESTION =
  /\b(what\s+store|what\s+(?:is\s+your|'s\s+your)\s+store|may\s+i\s+have\s+your\s+name|what\s+(?:is\s+your|'s\s+your)\s+name|who\s+am\s+i\s+speaking\s+(?:with|to)|which\s+register|which\s+device|which\s+printer|which\s+(?:one|terminal)\s+is\s+(?:affected|down|broken)|how\s+can\s+i\s+help|do\s+you\s+see|can\s+you\s+(move|type|see|read|hear|try|reboot|restart|reseat)|is\s+it\s+(working|on|coming\s+back|showing|back\s+up|back\s+online)|did\s+(?:that|it)\s+(fix|work|help|come\s+back)|did\s+it\s+(work|fix|help)|are\s+you\s+able\s+to|have\s+you\s+tried|what\s+error|what\s+(?:does\s+it|is\s+it)\s+say(?:ing)?)\b/i;

const SHORT_FACTUAL_ANSWER =
  /^(?:store\s+\d+|register\s+\d+|\d+|yes|yeah|yep|yup|no|nope|okay|ok|alright|all\s+right|got\s+it|sure|[A-Z][a-z]{2,15}|that'?s\s+correct)[.,!?]?$/i;

// ───────────────────────────────────────────────────────────────────────
// Public API
// ───────────────────────────────────────────────────────────────────────

/**
 * Live-call variant: classify one fresh segment given only the previous one.
 * Mirrors the post-hoc `applyAdjacencyRules` logic — a short factual answer
 * right after a tech intake/diagnostic question flips to store_employee even
 * when the segment itself only matched tech signals weakly (or matched
 * nothing). Used by Phase 11A live chunk handling.
 *
 * Unlike `detectSpeakers`, the caller owns segment IDs and timestamps — this
 * function is only responsible for the (speaker, confidence) pair.
 */
export interface PrevSegmentHint {
  speaker: SpeakerLabel;
  text: string;
  confidence: SpeakerSegment["confidence"];
}

export function classifyWithContext(
  text: string,
  prev: PrevSegmentHint | null,
): { speaker: SpeakerLabel; confidence: SpeakerSegment["confidence"]; reason: string } {
  const base = classify(text);
  // High-confidence labels (explicit "Tech Support:" prefix, distinctive
  // signals like wrong_caller or vendor) win regardless of context.
  if (base.confidence === "high") {
    return { ...base, reason: explainLabel(base.speaker, text, false) };
  }
  // Tie-breaker: a tech-style intake/diagnostic question (e.g. "May I have
  // your name?") often scores tech=1, store=1 because of generic "I have / I
  // see / I am" signal overlap. Classify() returns "unknown" on ties, which
  // for live capture is the wrong call — these are essentially never said
  // by the store side. Promote any "unknown" segment that matches the
  // intake/diagnostic question pattern to tech_support.
  if (base.speaker === "unknown" && TECH_INTAKE_OR_DIAGNOSTIC_QUESTION.test(text)) {
    return {
      speaker: "tech_support",
      confidence: "medium",
      reason: "Tech-side intake/diagnostic question.",
    };
  }
  if (!prev) {
    return { ...base, reason: explainLabel(base.speaker, text, false) };
  }
  const prevAsked =
    prev.speaker === "tech_support" &&
    (TECH_INTAKE_OR_DIAGNOSTIC_QUESTION.test(prev.text) || /\?\s*$/.test(prev.text));
  if (prevAsked && SHORT_FACTUAL_ANSWER.test(text.trim())) {
    return {
      speaker: "store_employee",
      confidence: "medium",
      reason: "Short factual answer right after a tech-support question.",
    };
  }
  // Unknown segment squeezed between two known turns — inherit from prev when
  // the previous segment is on the propagatable list (tech/store).
  if (base.speaker === "unknown" && (prev.speaker === "tech_support" || prev.speaker === "store_employee")) {
    // Don't propagate aggressively. Only inherit if the previous segment was
    // a question (the next is likely the answer → flip) or a statement (the
    // next is likely a continuation → same speaker, but only with low conf).
    if (prevAsked) {
      return {
        speaker: "store_employee",
        confidence: "low",
        reason: "Likely answer to a tech-support question.",
      };
    }
  }
  return { ...base, reason: explainLabel(base.speaker, text, false) };
}

export function detectSpeakers(transcript: string): SpeakerSegment[] {
  if (!transcript.trim()) return [];

  const rawSegments = splitIntoSegments(transcript);
  if (rawSegments.length === 0) return [];

  let segments: SpeakerSegment[] = rawSegments.map((text, idx) => {
    const { speaker, confidence } = classify(text);
    return {
      id: `seg-${idx}-${Math.random().toString(36).slice(2, 8)}`,
      speaker,
      text,
      originalText: text,
      timestampStart: "",
      timestampEnd: "",
      confidence,
      userCorrected: false,
      reason: explainLabel(speaker, text, false),
    };
  });

  segments = applyAdjacencyRules(segments);
  segments = propagateContext(segments);
  return segments;
}

interface RoleScores {
  tech_support: number;
  store_employee: number;
  store_manager: number;
  vendor: number;
  customer: number;
  wrong_caller: number;
}

function classify(
  text: string,
): { speaker: SpeakerLabel; confidence: SpeakerSegment["confidence"] } {
  // Explicit speaker labels (e.g. "Tech Support: ..." / "Store Employee: ...")
  // are the most reliable signal we ever get — when present, trust them
  // ahead of anything else.
  const labeled = explicitSpeakerLabel(text);
  if (labeled) return { speaker: labeled, confidence: "high" };

  const scores: RoleScores = {
    tech_support: countMatches(text, TECH_SIGNALS),
    store_employee: countMatches(text, STORE_SIGNALS),
    store_manager: countMatches(text, MANAGER_SIGNALS),
    vendor: countMatches(text, VENDOR_SIGNALS),
    customer: countMatches(text, CUSTOMER_SIGNALS),
    wrong_caller: countMatches(text, WRONG_CALLER_SIGNALS),
  };

  // Strong, distinctive signals win immediately, regardless of how many tech
  // signals also fired (e.g. a manager describing what tech support did).
  if (scores.wrong_caller >= 1) return { speaker: "wrong_caller", confidence: "high" };
  if (scores.vendor >= 1) return { speaker: "vendor", confidence: "high" };
  if (scores.store_manager >= 1) return { speaker: "store_manager", confidence: "high" };
  if (scores.customer >= 1) return { speaker: "customer", confidence: "medium" };

  const tech = scores.tech_support;
  const store = scores.store_employee;

  if (tech === 0 && store === 0) {
    return { speaker: "unknown", confidence: "low" };
  }
  // Segment length influences how much we trust a thin score. A single tech
  // signal in a 30-word segment is more meaningful than the same single
  // signal in a 4-word segment ("we got it" matches one store signal but is
  // really just a confirmation — the adjacency rule should be allowed to
  // override it). The bar for "high"/"medium" on short segments is one tier
  // higher than on long ones.
  const wordCount = text.trim().split(/\s+/).length;
  const isShort = wordCount < 8;

  if (tech > store) {
    const margin = tech - store;
    const conf: SpeakerSegment["confidence"] =
      tech >= 2 || margin >= 2
        ? isShort && tech < 3
          ? "medium"
          : "high"
        : isShort
          ? "low"
          : "medium";
    return { speaker: "tech_support", confidence: conf };
  }
  if (store > tech) {
    const margin = store - tech;
    const conf: SpeakerSegment["confidence"] =
      store >= 2 || margin >= 2
        ? isShort && store < 3
          ? "medium"
          : "high"
        : isShort
          ? "low"
          : "medium";
    return { speaker: "store_employee", confidence: conf };
  }
  return { speaker: "unknown", confidence: "low" };
}

function countMatches(text: string, patterns: RegExp[]): number {
  let count = 0;
  for (const p of patterns) if (p.test(text)) count++;
  return count;
}

/**
 * Recognize transcripts that include explicit "Speaker: ..." labels at the
 * start of each segment. Whisper-style auto transcripts often emit these,
 * and they are far more reliable than the heuristic signal lists.
 */
function explicitSpeakerLabel(text: string): SpeakerLabel | null {
  const head = text.trimStart().slice(0, 64).toLowerCase();
  if (/^tech(?:nician|nical)?\s+support\s*:/.test(head)) return "tech_support";
  if (/^(?:tech|support|help\s*desk|agent|it)\s*:/.test(head)) return "tech_support";
  if (/^store\s+employee\s*:/.test(head)) return "store_employee";
  if (/^store\s+manager\s*:/.test(head)) return "store_manager";
  if (/^(?:store|employee|associate|cashier)\s*:/.test(head)) return "store_employee";
  if (/^manager\s*:/.test(head)) return "store_manager";
  if (/^customer\s*:/.test(head)) return "customer";
  if (/^vendor\s*:/.test(head)) return "vendor";
  if (/^wrong\s+caller\s*:/.test(head)) return "wrong_caller";
  return null;
}

/**
 * Q-and-A turn-taking. Rule: a tech-support intake or diagnostic question is
 * almost always answered by the store side, not by tech support itself. So if
 * segment N classified as tech_support and ends with a question, segment N+1's
 * label gets a strong "this should be store-side" hint. Symmetrically, a short
 * factual answer that classified as tech_support is suspect — flip it to
 * store_employee if the previous segment was a tech-side question.
 *
 * We only adjust segments that are *unknown* or *low/medium confidence*. A
 * high-confidence label (e.g. an explicit "Tech Support:" prefix) is left alone.
 */
function applyAdjacencyRules(segments: SpeakerSegment[]): SpeakerSegment[] {
  const out = segments.map((s) => ({ ...s }));
  for (let i = 0; i < out.length; i++) {
    const seg = out[i];
    if (seg.userCorrected || seg.confidence === "high") continue;
    const prev = i > 0 ? out[i - 1] : null;
    const next = i < out.length - 1 ? out[i + 1] : null;

    const prevAsked =
      prev &&
      prev.speaker === "tech_support" &&
      (TECH_INTAKE_OR_DIAGNOSTIC_QUESTION.test(prev.text) || /\?\s*$/.test(prev.text));

    // Short factual answer immediately following a tech intake question →
    // store_employee with medium confidence.
    if (prevAsked && SHORT_FACTUAL_ANSWER.test(seg.text.trim())) {
      out[i] = { ...seg, speaker: "store_employee", confidence: "medium" };
      continue;
    }

    // Unknown segment between a known tech question and a known store answer:
    // most likely also store-side noise. Leave the deeper propagation to
    // propagateContext below.
    if (seg.speaker === "unknown" && prevAsked && next && next.speaker === "store_employee") {
      out[i] = { ...seg, speaker: "store_employee", confidence: "low" };
    }
  }
  return out;
}

/**
 * If a segment is "unknown" but neighbors agree on a speaker, inherit that speaker
 * with low confidence. Strongly-typed roles (manager/vendor/wrong_caller) are not
 * propagated — those should be self-asserted, not inferred from context.
 */
function propagateContext(segments: SpeakerSegment[]): SpeakerSegment[] {
  const propagatable = new Set<SpeakerLabel>(["tech_support", "store_employee"]);
  const out = segments.map((s) => ({ ...s }));
  for (let i = 0; i < out.length; i++) {
    if (out[i].speaker !== "unknown") continue;
    const prev = i > 0 ? out[i - 1].speaker : "unknown";
    const next = i < out.length - 1 ? out[i + 1].speaker : "unknown";
    const prevOk = propagatable.has(prev);
    const nextOk = propagatable.has(next);
    if (prevOk && nextOk && prev !== next) continue;
    if (prevOk) {
      out[i] = { ...out[i], speaker: prev, confidence: "low" };
      continue;
    }
    if (nextOk) {
      out[i] = { ...out[i], speaker: next, confidence: "low" };
    }
  }
  return out;
}

function splitIntoSegments(text: string): string[] {
  const lined = text
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (lined.length > 1) return lined;

  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function applySpeakerCorrection(
  segments: SpeakerSegment[],
  segmentId: string,
  newSpeaker: SpeakerLabel,
): SpeakerSegment[] {
  return segments.map((s) =>
    s.id === segmentId
      ? {
          ...s,
          speaker: newSpeaker,
          userCorrected: true,
          confidence: "high",
          reason: explainLabel(newSpeaker, s.text, true),
        }
      : s,
  );
}

/**
 * Plain-English explanation of why a label was chosen. Stored on each
 * segment so the History view can render the reason without re-running the
 * regex stack.
 */
export function explainLabel(
  speaker: SpeakerLabel,
  text: string,
  userCorrected: boolean,
): string {
  if (userCorrected) return "Corrected by you.";
  if (/^(?:tech\s+support|store\s+(?:employee|manager)|customer|vendor)\s*:/i.test(text.trimStart())) {
    return "Explicit speaker label in transcript.";
  }
  switch (speaker) {
    case "tech_support":
      if (/\?\s*$/.test(text)) return "Looks like a tech-support intake/diagnostic question.";
      if (/\b(unplug|reboot|restart|reseat|reconnect|shut\s*down|hold|press|drain)\b/i.test(text))
        return "Contains tech-support instruction verbs.";
      if (/\bI\s+(restarted|renamed|reset|opened|escalat)/i.test(text))
        return "First-person tech-support action.";
      return "Matched tech-support signal patterns.";
    case "store_employee":
      if (/^store\s+\d+\b/i.test(text)) return "Self-identifies as a store.";
      if (/^(?:yes|yeah|no|nope|okay|ok|sure|got\s+it)/i.test(text))
        return "Short factual answer to a tech question.";
      if (/\b(?:we|i)\s+(?:got|have|are\s+having|see|saw|can'?t)\b/i.test(text))
        return "First-person store report.";
      return "Matched store-side signal patterns.";
    case "store_manager":
      return "Self-identifies as a manager.";
    case "vendor":
      return "Mentions a vendor (ATT/Verizon/Inseego/VeriFone).";
    case "customer":
      return "Self-identifies as a customer.";
    case "wrong_caller":
      return "Mentions wrong number/department.";
    case "unknown":
    default:
      return "No strong role signal — please correct if you can.";
  }
}

/**
 * Bulk-set the speaker for a list of segment IDs. Used by the speaker-editor
 * UI's "Mark selected as Tech Support" / "Mark selected as Store Employee"
 * actions.
 */
export function applyBulkSpeakerCorrection(
  segments: SpeakerSegment[],
  segmentIds: string[],
  newSpeaker: SpeakerLabel,
): SpeakerSegment[] {
  const ids = new Set(segmentIds);
  return segments.map((s) =>
    ids.has(s.id)
      ? {
          ...s,
          speaker: newSpeaker,
          userCorrected: true,
          confidence: "high",
          reason: explainLabel(newSpeaker, s.text, true),
        }
      : s,
  );
}

/**
 * Apply alternating speakers starting from `firstSpeaker`. Useful when the
 * automatic detection failed catastrophically (everything labeled the same)
 * and the user knows the dialogue strictly alternates.
 */
export function applyAlternatingSpeakers(
  segments: SpeakerSegment[],
  firstSpeaker: SpeakerLabel = "tech_support",
): SpeakerSegment[] {
  const second: SpeakerLabel =
    firstSpeaker === "tech_support" ? "store_employee" : "tech_support";
  return segments.map((s, i) => {
    const speaker = i % 2 === 0 ? firstSpeaker : second;
    return {
      ...s,
      speaker,
      userCorrected: true,
      confidence: "high" as const,
      reason: explainLabel(speaker, s.text, true),
    };
  });
}

/**
 * Treat any "store-side" voice (employee, manager, customer) as the same group
 * for the purpose of joining "what the store reported". This lets extraction
 * latch onto facts from any non-tech speaker.
 */
const STORE_SIDE: SpeakerLabel[] = [
  "store_employee",
  "store_manager",
  "customer",
];

/**
 * Given speaker segments, return the text spoken by the requested label
 * (plus unknowns, which often hold facts the caller mentioned).
 */
export function joinByLabel(
  segments: SpeakerSegment[],
  label: SpeakerLabel | "any" | "store_side",
): string {
  if (label === "any") return segments.map((s) => s.text).join("\n");
  if (label === "store_side") {
    return segments
      .filter((s) => STORE_SIDE.includes(s.speaker) || s.speaker === "unknown")
      .map((s) => s.text)
      .join("\n");
  }
  return segments
    .filter((s) => s.speaker === label || s.speaker === "unknown")
    .map((s) => s.text)
    .join("\n");
}
