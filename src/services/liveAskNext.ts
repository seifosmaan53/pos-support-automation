/**
 * Phase 11A — domain-tailored "Ask next" packs.
 *
 * Given the analyzer's current ExtractedDetails plus the live transcript text,
 * returns a list of follow-up questions matched to the issue type. Each pack
 * is gated on a topic regex (keyboard / printer / internet / inseego) AND on
 * a "haven't asked yet" check against the transcript so the panel doesn't
 * suggest a question the tech already asked.
 *
 * Distinct from `suggestQuestions` (ticketKnowledge.ts): that file generates
 * generic intake gaps. This file is the *playbook* — domain-specific probes
 * a seasoned tech would ask for each common store-IT scenario.
 *
 * Output is de-duplicated case-insensitively against any existing question
 * list via `mergeQuestions` in LiveAssistPanel.
 */

import type { ExtractedDetails } from "../types/ticket";

export interface LiveAskNextInput {
  details: ExtractedDetails;
  transcript: string;
  /** True when a caller name has been mined or typed (suppresses "may I have your name"). */
  haveCallerName: boolean;
}

const TOPIC_KEYBOARD = /\b(keyboard|key\s*board)\b/i;
const TOPIC_PRINTER = /\b(receipt\s*printer|printer)\b/i;
const TOPIC_INTERNET = /\b(internet|offline|down|connection|network|inseego)\b/i;
const TOPIC_PIN_PAD = /\b(pin\s*pad|verifone|veri\s*fone|card\s*reader)\b/i;
const TOPIC_REGISTER = /\bregister\b/i;
const TOPIC_SCANNER = /\bscanner\b/i;

const ASKED_MOUSE = /\bmouse\b/i;
const ASKED_TYPE_NUMBERS = /\btype\s+(numbers|digits)\b/i;
const ASKED_POWER_DRAIN = /\bpower\s*drain\b/i;
const ASKED_REBOOT_OR_RESEAT = /\b(reboot|reseat|reset|restart|cable)\b/i;
const ASKED_PRINTER_MOVED = /\b(loses?\s+power|moved|move\s+the)\b/i;
const ASKED_ALL_REGISTERS = /\b(all\s+registers?|both\s+registers?|each\s+register)\b/i;
const ASKED_INSEEGO_RESTART = /\b(restart(?:ed)?|reboot(?:ed)?)\s+the\s+inseego\b/i;
const ASKED_ONLINE_NOW = /\b(online\s+now|back\s+online|came\s+back\s+online)\b/i;
const ASKED_RESOLVED = /\b(resolved|escalated|pending|working\s+now|fixed\s+now)\b/i;

export function liveAskNextQuestions(input: LiveAskNextInput): string[] {
  const out: string[] = [];
  const t = `${input.transcript}\n${input.details.issue ?? ""}`;
  const noRegister =
    !input.details.registerNumber &&
    (input.details.affectedRegisters?.length ?? 0) === 0;
  const noResult = !input.details.result || input.details.result === "ResultNotConfirmed";
  const noError = !input.details.errorMessage;
  const noStore = !input.details.storeNumber;

  // Keyboard pack
  if (TOPIC_KEYBOARD.test(t)) {
    if (noRegister) out.push("Which register is the keyboard connected to?");
    if (!ASKED_MOUSE.test(t)) out.push("Can the mouse move?");
    if (!ASKED_TYPE_NUMBERS.test(t)) out.push("Can you type numbers?");
    if (!ASKED_POWER_DRAIN.test(t))
      out.push("Did the keyboard work after the power drain?");
  }

  // Receipt printer pack
  if (TOPIC_PRINTER.test(t)) {
    if (noRegister) out.push("Which register is the printer connected to?");
    if (noError) out.push("What exact error is showing on the printer?");
    if (!ASKED_REBOOT_OR_RESEAT.test(t))
      out.push("Did rebooting or reseating cables fix it?");
    if (!ASKED_PRINTER_MOVED.test(t))
      out.push("Does the printer lose power when moved?");
  }

  // Internet / connectivity / Inseego pack
  if (TOPIC_INTERNET.test(t)) {
    if (!ASKED_ALL_REGISTERS.test(t))
      out.push("Is this affecting all registers or just one?");
    if (!ASKED_INSEEGO_RESTART.test(t))
      out.push("Did restarting the Inseego bring the store back online?");
    if (!ASKED_ONLINE_NOW.test(t))
      out.push("Are both registers online now?");
  }

  // PIN pad / VeriFone pack
  if (TOPIC_PIN_PAD.test(t)) {
    if (noRegister)
      out.push("Which register is the pin pad connected to?");
    if (noError)
      out.push("What exact error is the pin pad showing?");
    if (!ASKED_REBOOT_OR_RESEAT.test(t))
      out.push("Did unplugging and reconnecting the pin pad cable change anything?");
  }

  // Generic register pack (kept lean — the above issue-specific packs already
  // cover most concrete probes).
  if (TOPIC_REGISTER.test(t) && !TOPIC_KEYBOARD.test(t) && !TOPIC_PRINTER.test(t) && !TOPIC_PIN_PAD.test(t)) {
    if (noRegister) out.push("Which register number is affected?");
    if (!ASKED_REBOOT_OR_RESEAT.test(t))
      out.push("Have you tried restarting the register?");
  }

  // Scanner pack
  if (TOPIC_SCANNER.test(t)) {
    if (noError) out.push("Does the scanner show any error light or message?");
    if (!ASKED_REBOOT_OR_RESEAT.test(t))
      out.push("Did reconnecting the scanner cable help?");
  }

  // Result-near-end pack
  if (noResult) {
    out.push("Is everything working now?");
    out.push("Should this be marked resolved, pending, or escalated?");
  }

  // Universal gaps
  if (noStore) out.push("What store are you calling from?");
  if (!input.haveCallerName && !input.details.callerName) {
    out.push("May I have your name for the ticket?");
  }

  return dedupe(out);
}

function dedupe(arr: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const q of arr) {
    const k = q.trim().toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(q);
  }
  return out;
}

export interface RankContext {
  details: ExtractedDetails;
  haveCallerName: boolean;
  /**
   * Phase 11B near-end signal — if troubleshooting steps were attempted
   * AND result is still missing, the call is closing and result questions
   * jump to the top of the list.
   */
  nearEndOfCall?: boolean;
}

/**
 * Order ask-next questions by urgency and cap to the most useful five.
 *
 * Urgency tiers (higher = sooner):
 *   100  result questions when nearEndOfCall && no result
 *   90   missing core intake when not yet captured (store / caller / register)
 *   70   device-specific diagnostic probes
 *   60   error / message gathering
 *   50   troubleshooting verifications (rebooted? reseated?)
 *   30   closing checks (replacement, anything else)
 *   10   fallback
 */
export function rankAndCapQuestions(
  questions: string[],
  ctx: RankContext,
  max = 5,
): string[] {
  const scored = questions.map((q) => ({ q, score: urgencyScore(q, ctx) }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, max).map((s) => s.q);
}

function urgencyScore(q: string, ctx: RankContext): number {
  const t = q.toLowerCase();
  const noStore = !ctx.details.storeNumber;
  const noCaller = !ctx.details.callerName && !ctx.haveCallerName;
  const noRegister =
    !ctx.details.registerNumber &&
    (ctx.details.affectedRegisters?.length ?? 0) === 0;

  // Near-end: result confirmation dominates.
  if (
    ctx.nearEndOfCall &&
    /(working\s+now|resolved|escalated|pending|is\s+it\s+(?:working|fixed))/i.test(t)
  ) {
    return 100;
  }

  // Core intake — only urgent if still missing.
  if (noStore && /\bwhat\s+store\b/i.test(t)) return 90;
  if (noCaller && /\b(your\s+name|may\s+i\s+have)/i.test(t)) return 88;
  if (noRegister && /\bwhich\s+register\b/i.test(t)) return 86;

  // Device-specific probes.
  if (/(mouse|type\s+(?:numbers|letters|anything))/i.test(t)) return 70;
  if (/printer.*(?:error|reboot|cable|power)/i.test(t)) return 68;
  if (/inseego|registers/i.test(t)) return 65;

  // Error/message gathering.
  if (/exact\s+error|error\s+(?:is\s+showing|message)/i.test(t)) return 60;

  // Troubleshooting verifications.
  if (/(reboot|reseat|power\s*drain)/i.test(t)) return 50;

  // Closing checks.
  if (/(replacement\s+(?:is\s+)?needed|anything\s+else)/i.test(t)) return 30;

  // Result fallback when not near-end (still want to ask, just lower).
  if (/(working\s+now|resolved|escalated|pending)/i.test(t)) return 40;

  return 10;
}

/**
 * Heuristic: are we near the end of the call? Triggered when troubleshooting
 * steps have been taken AND the result is still missing — that's the moment
 * the tech should be confirming whether to mark the ticket resolved.
 */
export function isNearEndOfCall(details: ExtractedDetails): boolean {
  const hasSteps = (details.steps?.length ?? 0) > 0;
  const noResult = !details.result || details.result === "ResultNotConfirmed";
  return hasSteps && noResult;
}
