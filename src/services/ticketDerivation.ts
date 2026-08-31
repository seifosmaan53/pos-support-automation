import type { ExtractedDetails, TicketFields } from "../types/ticket";

/**
 * Pure derivation helpers lifted out of `appStore.ts`.
 *
 * They were defined inside a 3,200-line module whose bulk is a single Zustand store,
 * which meant they could not be imported or tested on their own despite depending on
 * nothing but their arguments. Moving them here shrinks that file and — more usefully —
 * makes the behaviour below verifiable, which it previously was not.
 */

/**
 * Build the keyword set attached to a knowledge-base entry.
 *
 * Deliberately lossy: values shorter than three characters are dropped as too generic
 * to search on, subject words are stripped of punctuation so "printer." and "printer"
 * do not become two keywords, and the result is capped at eight so one verbose ticket
 * cannot flood the index. Order follows insertion, with duplicates removed.
 */
export function deriveKeywords(
  details: ExtractedDetails,
  fields: TicketFields,
): string[] {
  const out = new Set<string>();
  const push = (s: string | undefined) => {
    if (!s) return;
    const t = s.trim();
    if (t.length >= 3) out.add(t);
  };
  push(details.deviceType);
  push(details.category);
  push(details.subCategory);
  push(details.item);
  for (const d of details.devices ?? []) push(d);
  for (const w of (fields.subject || "").split(/\s+/)) {
    if (w.length >= 4) out.add(w.replace(/[^A-Za-z0-9]/g, ""));
  }
  return [...out].filter(Boolean).slice(0, 8);
}

/**
 * The phrases that should cause a saved part/fix to be suggested again later.
 *
 * Ordered most-specific first — an exact error message beats a general symptom — and
 * capped at five so a single ticket does not dominate future matching.
 */
export function derivePartTriggers(details: ExtractedDetails): string[] {
  const out: string[] = [];
  if (details.errorMessage) out.push(details.errorMessage);
  for (const s of details.symptoms ?? []) out.push(s);
  if (details.replacementReason) out.push(details.replacementReason);
  return out.slice(0, 5);
}

/**
 * Human-readable due date, relative to now.
 *
 * Returns the input unchanged when it cannot be parsed, so a malformed timestamp shows
 * the raw value rather than "Invalid Date" or an empty cell.
 */
export function formatDueLabel(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  const d = new Date(t);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return `today at ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
  }
  return `${d.toLocaleDateString([], { weekday: "short" })} at ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}
