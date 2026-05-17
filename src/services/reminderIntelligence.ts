/**
 * Phase 6 reminder intelligence.
 *
 * Two responsibilities:
 *   1. `quickPresets` — pure helpers that return ISO due-times for the four
 *      named buttons (Tomorrow Morning, 30 Minutes, Next Shift, When Parts
 *      Arrive). Pure functions of "now" + the user's default settings, no
 *      state, easy to unit-test.
 *   2. `suggestRemindersForCurrent` — given the current ExtractedDetails +
 *      transcript + (optional) saved-ticket id, returns a list of
 *      ReminderSuggestion objects with title, message, dueAt, and a short
 *      reason. Suggestions are advisory; the caller decides whether to
 *      auto-create them based on `reminderSettings.autoCreateFromTranscript`.
 *
 * Detection rules (all are heuristics, never block creation):
 *   • details.followUpNeeded === true                     → follow-up
 *   • details.result === "Pending" / "Escalated"          → check resolution
 *   • details.partNeeded === true OR partRequest text     → parts ETA
 *   • vendor name in transcript (ATT, Inseego, VeriFone)  → vendor follow-up
 *   • transcript phrases ("call back tomorrow", "remind me", etc.)
 *
 * Each suggestion has a stable `key` so the panel can de-duplicate within a
 * render and so the user's per-session "Dismiss this suggestion" stays sticky.
 */
import type { ExtractedDetails, TicketFields } from "../types/ticket";
import type { ReminderSuggestion, ReminderSettings } from "../types/reminder";
import { DEFAULT_REMINDER_SETTINGS } from "../types/reminder";

// ─── Quick presets ────────────────────────────────────────────────────────

/**
 * Tomorrow at 9:00 AM local. Used by the "Tomorrow Morning" button.
 */
export function tomorrowMorning(now = new Date()): string {
  const d = new Date(now);
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return d.toISOString();
}

/**
 * `now + N minutes`. Used by the "30 Minutes" button (and snooze).
 */
export function inMinutes(minutes: number, now = new Date()): string {
  const d = new Date(now);
  d.setMinutes(d.getMinutes() + minutes);
  return d.toISOString();
}

/**
 * "Next shift" — if it's currently morning (before 14:00 local), that means
 * this afternoon at 16:00. If it's afternoon/evening, it means tomorrow
 * morning at 9:00. The retail support cadence is two shifts per day, so this
 * gives the user a sensible "I'll deal with it next time I'm at the desk".
 */
export function nextShift(now = new Date()): string {
  const d = new Date(now);
  if (d.getHours() < 14) {
    d.setHours(16, 0, 0, 0);
  } else {
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
  }
  return d.toISOString();
}

/**
 * "When parts arrive" — defaults to 3 business days out, at 10:00 local.
 * Stores generally see overnight shipping but rural sites take longer, so
 * three days gives a realistic cushion. Skips Sat/Sun the lazy way: just
 * keeps incrementing past weekend days.
 */
export function whenPartsArrive(now = new Date()): string {
  const d = new Date(now);
  let businessDays = 3;
  while (businessDays > 0) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) businessDays--;
  }
  d.setHours(10, 0, 0, 0);
  return d.toISOString();
}

/**
 * Default follow-up time derived from settings — used by quick "Create
 * Reminder" buttons that don't specify a preset.
 */
export function defaultFollowUp(settings: ReminderSettings, now = new Date()): string {
  const hours = Math.max(1, Math.round(settings.defaultFollowUpHours || DEFAULT_REMINDER_SETTINGS.defaultFollowUpHours));
  const d = new Date(now);
  d.setHours(d.getHours() + hours);
  return d.toISOString();
}

// ─── Title/message templates ──────────────────────────────────────────────

interface TicketContext {
  details: Partial<ExtractedDetails>;
  transcript: string;
  fields?: Partial<TicketFields>;
}

function storeLabel(d: Partial<ExtractedDetails>): string {
  const num = (d.storeNumber ?? "").trim();
  return num ? `Store ${num}` : "Store Unknown";
}

function shortIssue(d: Partial<ExtractedDetails>, fields?: Partial<TicketFields>): string {
  const candidates = [
    d.issue,
    d.errorMessage,
    fields?.subject,
    d.category,
  ].filter((s): s is string => !!s && s.trim().length > 0);
  const first = candidates[0] ?? "";
  return first.replace(/\s+/g, " ").trim().slice(0, 90);
}

/**
 * Build the title/message for a follow-up reminder when the resolution is
 * unconfirmed or pending. Spec example for an unresolved Store 521 ticket:
 *   Title:   Follow up with Store 521
 *   Message: Final result was not confirmed. Verify whether the issue is resolved.
 */
function unconfirmedResolutionSuggestion(ctx: TicketContext): ReminderSuggestion {
  const store = storeLabel(ctx.details);
  return {
    key: "result-pending",
    title: `Follow up with ${store}`,
    message:
      "Final result was not confirmed. Verify whether the issue is resolved.",
    dueAt: tomorrowMorning(),
    reason: "Result is Pending or unconfirmed in the extracted details.",
  };
}

function escalatedSuggestion(ctx: TicketContext): ReminderSuggestion {
  const store = storeLabel(ctx.details);
  const issue = shortIssue(ctx.details, ctx.fields);
  return {
    key: "result-escalated",
    title: `Follow up on escalated ticket — ${store}`,
    message: issue
      ? `Issue was escalated: ${issue}. Check whether the next-tier team has resolved it.`
      : "Issue was escalated. Check whether the next-tier team has resolved it.",
    dueAt: tomorrowMorning(),
    reason: "Result is Escalated.",
  };
}

function partsSuggestion(ctx: TicketContext): ReminderSuggestion {
  const store = storeLabel(ctx.details);
  const partText =
    ctx.fields?.partRequest?.trim() ||
    ctx.details.partRequest?.trim() ||
    "replacement part";
  // Spec example: "Follow up on replacement receipt printer"
  // Use the part text if it reads like a noun phrase; otherwise fall back to a
  // generic "replacement part".
  const partLabel = partText.length > 0 && partText.length < 60 ? partText : "replacement part";
  return {
    key: "parts-arrival",
    title: `Follow up on ${partLabel}`,
    message: `Check whether the ${partLabel} was sent/received and whether ${store} is back to normal.`,
    dueAt: whenPartsArrive(),
    reason: "Replacement part is needed for this ticket.",
  };
}

function vendorSuggestion(vendor: string, ctx: TicketContext): ReminderSuggestion {
  const issueText = shortIssue(ctx.details, ctx.fields);
  // Spec example for ATT/phone:
  //   Title:   Follow up on ATT phone line issue
  //   Message: Check if the store's phone line issue was resolved or if ATT follow-up is still needed.
  const isPhone = /phone|line|att/i.test(`${vendor} ${issueText}`);
  return {
    key: `vendor-${vendor.toLowerCase()}`,
    title: isPhone
      ? `Follow up on ${vendor} phone line issue`
      : `Follow up on ${vendor} ticket`,
    message: isPhone
      ? `Check if the store's phone line issue was resolved or if ${vendor} follow-up is still needed.`
      : `Check whether ${vendor} resolved the issue or whether further escalation is required.`,
    dueAt: tomorrowMorning(),
    reason: `${vendor} was involved in this call.`,
  };
}

function callBackSuggestion(ctx: TicketContext, kind: "tomorrow" | "later"): ReminderSuggestion {
  const store = storeLabel(ctx.details);
  // Spec example for "central database not checked":
  //   Title:   Follow up with Store Unknown about receipt network error
  //   Message: Store was advised to call back tomorrow morning because the central database could not be checked.
  const issueText = shortIssue(ctx.details, ctx.fields);
  return {
    key: `callback-${kind}`,
    title: issueText
      ? `Follow up with ${store} about ${issueText}`
      : `Follow up with ${store}`,
    message: issueText
      ? `Store was advised to call back ${kind === "tomorrow" ? "tomorrow morning" : "later"} about: ${issueText}.`
      : `Store was advised to call back ${kind === "tomorrow" ? "tomorrow morning" : "later"}.`,
    dueAt: kind === "tomorrow" ? tomorrowMorning() : inMinutes(120),
    reason:
      kind === "tomorrow"
        ? "Transcript mentioned calling back tomorrow."
        : "Transcript mentioned calling back later.",
  };
}

function checkBackSuggestion(): ReminderSuggestion {
  return {
    key: "check-back-30",
    title: "Check back in 30 minutes",
    message: "Caller asked to check back in 30 minutes.",
    dueAt: inMinutes(30),
    reason: "Transcript mentioned checking back in 30 minutes.",
  };
}

function recurringIssueSuggestion(): ReminderSuggestion {
  return {
    key: "recurring-issue",
    title: "Check whether the issue recurred",
    message:
      "Caller asked to verify the issue does not come back. Confirm with the store later today or tomorrow.",
    dueAt: tomorrowMorning(),
    reason: "Transcript mentioned 'check if the issue came back'.",
  };
}

// ─── Transcript phrase detection ──────────────────────────────────────────

const VENDOR_PATTERNS: Array<{ vendor: string; re: RegExp }> = [
  { vendor: "ATT", re: /\bat\s*&?\s*t\b|\batt\b/i },
  { vendor: "Inseego", re: /\bins?eego\b/i },
  { vendor: "VeriFone", re: /\bveri\s*fone\b/i },
  { vendor: "Verizon", re: /\bverizon\b/i },
  { vendor: "Lotus Notes", re: /\blotus notes\b/i },
];

const PHRASE_RULES = {
  remindTomorrow: /(?:remind me|follow up|check back|call back)\b[^.]{0,60}\b(?:tomorrow|next morning|in the morning)/i,
  callBackLater: /\bcall back later\b|\bcall back in (?:a )?(?:few|couple)\b/i,
  checkBack30: /\bcheck back in (?:about )?(\d{1,3})\s*(?:min|minutes?)\b/i,
  waitingOnVendor: /\bwaiting (?:on|for) (?:vendor|att|inseego|verifone|verizon)\b/i,
  partsArriving: /\bparts? (?:arriv|on the way|coming|shipping|shipped|en route)/i,
  issueCameBack: /\b(?:issue|problem) (?:came back|came back again|recurr|comes back|return)/i,
  toldToCallBack: /\b(?:told|advised|asked) (?:them|the store|caller|her|him) to call back\b/i,
};

function detectVendor(transcript: string): string | null {
  for (const { vendor, re } of VENDOR_PATTERNS) {
    if (re.test(transcript)) return vendor;
  }
  return null;
}

// ─── Public API ───────────────────────────────────────────────────────────

export interface SuggestRemindersInput {
  details: Partial<ExtractedDetails>;
  transcript: string;
  fields?: Partial<TicketFields>;
  /** Whether the caller already saved the ticket — used for messaging only.
   *  The suggestion is still surfaced even for unsaved tickets. */
  ticketId?: string | null;
}

/**
 * Build a deduplicated list of reminder suggestions from the current ticket
 * context. Order: most actionable first (escalated/pending → vendor → parts
 * → transcript phrases). At most ~6 suggestions so the panel doesn't overflow.
 */
export function suggestRemindersForCurrent(input: SuggestRemindersInput): ReminderSuggestion[] {
  const ctx: TicketContext = {
    details: input.details ?? {},
    transcript: input.transcript ?? "",
    fields: input.fields,
  };
  const out: ReminderSuggestion[] = [];
  const seen = new Set<string>();

  function push(s: ReminderSuggestion | null | undefined): void {
    if (!s) return;
    if (seen.has(s.key)) return;
    seen.add(s.key);
    out.push(s);
  }

  const result = (ctx.details.result ?? "").toLowerCase();
  if (result === "pending" || ctx.details.followUpNeeded === true) {
    push(unconfirmedResolutionSuggestion(ctx));
  }
  if (result === "escalated") {
    push(escalatedSuggestion(ctx));
  }

  if (
    ctx.details.partNeeded === true ||
    (ctx.details.partRequest && !/not needed/i.test(ctx.details.partRequest))
  ) {
    push(partsSuggestion(ctx));
  }

  const transcript = ctx.transcript || "";
  const vendor = detectVendor(transcript);
  if (vendor) {
    push(vendorSuggestion(vendor, ctx));
  }

  if (PHRASE_RULES.toldToCallBack.test(transcript) || PHRASE_RULES.remindTomorrow.test(transcript)) {
    push(callBackSuggestion(ctx, "tomorrow"));
  } else if (PHRASE_RULES.callBackLater.test(transcript)) {
    push(callBackSuggestion(ctx, "later"));
  }

  if (PHRASE_RULES.checkBack30.test(transcript)) {
    push(checkBackSuggestion());
  }

  if (PHRASE_RULES.waitingOnVendor.test(transcript) && !vendor) {
    push({
      key: "waiting-on-vendor",
      title: `Follow up with vendor about ${storeLabel(ctx.details)}`,
      message:
        "Call mentioned waiting on a vendor. Verify whether the vendor closed the loop.",
      dueAt: tomorrowMorning(),
      reason: "Transcript mentioned waiting on a vendor.",
    });
  }

  if (PHRASE_RULES.partsArriving.test(transcript)) {
    push(partsSuggestion(ctx));
  }

  if (PHRASE_RULES.issueCameBack.test(transcript)) {
    push(recurringIssueSuggestion());
  }

  return out.slice(0, 6);
}

/**
 * Convenience for the "Create Follow-up Reminder" button: if intelligence
 * surfaces any suggestions, pick the first one as a sensible default. Falls
 * back to a generic Store-X follow-up when nothing matched.
 */
export function defaultFollowUpForCurrent(
  input: SuggestRemindersInput,
  settings: ReminderSettings,
): { title: string; message: string; dueAt: string } {
  const top = suggestRemindersForCurrent(input)[0];
  if (top) return { title: top.title, message: top.message, dueAt: top.dueAt };
  const store = storeLabel(input.details);
  const issue = shortIssue(input.details, input.fields);
  return {
    title: `Follow up with ${store}`,
    message: issue
      ? `Confirm whether the issue is resolved: ${issue}.`
      : "Confirm status of the open ticket.",
    dueAt: defaultFollowUp(settings),
  };
}
