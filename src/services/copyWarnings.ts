/**
 * Phase 9: pre-flight warnings shown above Copy Mode. The list is purely
 * informational — it never blocks copying. Each warning maps to a real
 * ticketing-system pain point: a refund without a payment type, a return
 * without a transaction number, a part request without a store/register.
 *
 * Pure function — no React, no clipboard. Renderers call this and render
 * each string in their own UI, so the same logic can power both the
 * Ticket Form Helper banner and any future review screen.
 */
import type { ExtractedDetails, TicketFields } from "../types/ticket";

export interface CopyWarningInput {
  details: ExtractedDetails;
  fields: TicketFields;
}

const RETURN_LIKE_TYPES = new Set([
  "Return",
  "Exchange",
  "Refund",
  "No Receipt Return",
  "Layaway",
]);

export function buildCopyWarnings({ details, fields }: CopyWarningInput): string[] {
  const out: string[] = [];

  if (!fields.storeNumber.trim() && !details.storeNumber?.trim()) {
    out.push("Store number missing — confirm before pasting.");
  }
  if (
    !fields.registerNumber.trim() &&
    !details.registerNumber?.trim() &&
    looksLikeRegisterIssue(details, fields)
  ) {
    out.push(
      "Register number missing — required for register, keyboard, printer, and pin pad issues.",
    );
  }
  if (!fields.contactName.trim() && !fields.requesterName.trim()) {
    out.push("Contact / Requester name missing — fill in or mark Not provided.");
  }
  if (
    RETURN_LIKE_TYPES.has(fields.typeOfTransaction) &&
    !fields.transactionNumber.trim() &&
    !details.transactionNumber?.trim()
  ) {
    out.push(
      "Transaction number missing — required for returns, exchanges, refunds, and layaway tickets.",
    );
  }
  if (
    /\brefund\b/i.test(fields.typeOfTransaction) &&
    !fields.paymentType.trim() &&
    !details.paymentType?.trim()
  ) {
    out.push("Payment type missing — required for refund tickets.");
  }
  if (!details.result || details.result === "ResultNotConfirmed") {
    out.push("Resolution not confirmed — ask whether the issue was resolved, pending, or escalated.");
  }
  if (
    (details.partNeeded || fields.partRequest.trim()) &&
    (!fields.storeNumber.trim() || !fields.registerNumber.trim())
  ) {
    out.push(
      "Part request needs store + register — fill both before sending the replacement form.",
    );
  }

  return out;
}

function looksLikeRegisterIssue(
  details: ExtractedDetails,
  fields: TicketFields,
): boolean {
  const haystack = [
    details.issue || "",
    details.deviceType || "",
    fields.subject || "",
    fields.description || "",
    (details.devices ?? []).join(" "),
  ]
    .join(" ")
    .toLowerCase();
  return /(register|pos|cash\s*drawer|receipt|keyboard|verifone|pin\s*pad|scanner|printer)/i.test(
    haystack,
  );
}
