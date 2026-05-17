import type { SavedTicket } from "../types/ticket";

/**
 * Flattens every searchable text field on a SavedTicket into one lowercased
 * string. Used by the History page so each keystroke does a single
 * `String.includes()` per ticket instead of touching nested objects.
 *
 * Spec fields covered: subject, description, resolution, additionalComments,
 * raw transcript, corrected transcript, store number, caller name, caller
 * role, category, subcategory, item, device type, register number, error
 * message, part request.
 */
export function ticketHaystack(t: SavedTicket): string {
  const f = t.ticketFields;
  const d = t.details;
  const parts: string[] = [
    f?.subject ?? "",
    f?.description ?? "",
    f?.resolution ?? "",
    f?.additionalComments ?? "",
    f?.partRequest ?? "",
    t.rawTranscript ?? "",
    t.correctedTranscript ?? "",
    t.transcript ?? "",
    d.storeNumber ?? "",
    d.storeName ?? "",
    d.callerName ?? "",
    d.callerRole ?? "",
    d.category ?? "",
    d.subCategory ?? "",
    d.item ?? "",
    d.deviceType ?? "",
    d.deviceName ?? "",
    d.registerNumber ?? "",
    d.errorMessage ?? "",
    d.partRequest ?? "",
    d.issue ?? "",
    t.generatedTicket ?? "",
  ];
  return parts.join("  ").toLowerCase();
}

/**
 * Multi-token search — splits the query on whitespace and requires every
 * token to appear in the haystack. This makes "521 printer" match a ticket
 * for store 521 with a printer issue, rather than treating the whole string
 * as one literal.
 */
export function matchesQuery(haystack: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const tokens = q.split(/\s+/).filter(Boolean);
  return tokens.every((tok) => haystack.includes(tok));
}
