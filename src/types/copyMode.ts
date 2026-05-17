/**
 * Phase 9: Copy Mode + Sequential Copy Assistant.
 *
 * Models the user's real ticketing-system field order so the helper page can
 * walk the user through Site → Register # → … → Resolution in the same
 * sequence they paste into. Field mapping is persisted in AppSettings and
 * is purely presentational — it never alters the saved TicketFields shape,
 * so changing mapping cannot affect History, Intelligence, or self-tests.
 */
import type { TicketFields } from "./ticket";

/**
 * The 19 fields the spec calls out, in the real-system paste order.
 * `key` is the property on TicketFields the row reads from. A few "fields"
 * (storeNumber alongside site) come from the same TicketFields key —
 * intentional; the user's UI shows them as separate prompts.
 */
export type CopyableFieldKey =
  | "site"
  | "storeNumber"
  | "registerNumber"
  | "dateTimeOfIssue"
  | "contactName"
  | "requesterName"
  | "impact"
  | "urgency"
  | "mode"
  | "requestType"
  | "serviceCategory"
  | "status"
  | "category"
  | "subCategory"
  | "item"
  | "transactionNumber"
  | "itemNumber"
  | "typeOfTransaction"
  | "paymentType"
  | "technician"
  | "subject"
  | "description"
  | "resolution"
  | "partRequest"
  | "additionalComments"
  | "forwardTo";

export interface FieldMappingEntry {
  key: CopyableFieldKey;
  /** Displayed label override. Empty → use builtin default. */
  label: string;
  /** Default value when the generated field is empty. */
  defaultValue: string;
  /** Show this field at all? */
  enabled: boolean;
  /** Highlight the row when generated value is empty. */
  required: boolean;
  /** Skip in Sequential Copy when generated value is empty. */
  skipIfEmpty: boolean;
}

/** Sensible default labels, mirroring the user's real ticketing system. */
export const BUILTIN_FIELD_LABELS: Record<CopyableFieldKey, string> = {
  site: "Site",
  storeNumber: "Store Number",
  registerNumber: "Register #",
  dateTimeOfIssue: "Date/Time of Issue",
  contactName: "Contact Name",
  requesterName: "Requester Name",
  impact: "Impact",
  urgency: "Urgency",
  mode: "Mode",
  requestType: "Request Type",
  serviceCategory: "Service Category",
  status: "Status",
  category: "Category",
  subCategory: "Sub Category",
  item: "Item",
  transactionNumber: "Transaction #",
  itemNumber: "Item #",
  typeOfTransaction: "Type of Transaction",
  paymentType: "Payment Type",
  technician: "Technician",
  subject: "Subject",
  description: "Description",
  resolution: "Resolution",
  partRequest: "Part Request",
  additionalComments: "Additional Comments",
  forwardTo: "Forward To",
};

/**
 * Default field mapping in the user's real-system order. Defaults align
 * with the spec; user can re-order, hide, or override labels in Settings.
 */
export const DEFAULT_FIELD_MAPPING: FieldMappingEntry[] = [
  { key: "site", label: "", defaultValue: "Stores", enabled: true, required: false, skipIfEmpty: false },
  { key: "storeNumber", label: "", defaultValue: "", enabled: true, required: true, skipIfEmpty: false },
  { key: "registerNumber", label: "", defaultValue: "", enabled: true, required: false, skipIfEmpty: true },
  { key: "dateTimeOfIssue", label: "", defaultValue: "", enabled: true, required: false, skipIfEmpty: true },
  { key: "contactName", label: "", defaultValue: "", enabled: true, required: false, skipIfEmpty: true },
  { key: "requesterName", label: "", defaultValue: "", enabled: true, required: false, skipIfEmpty: true },
  { key: "impact", label: "", defaultValue: "Affects Store", enabled: true, required: false, skipIfEmpty: false },
  { key: "urgency", label: "", defaultValue: "Normal", enabled: true, required: false, skipIfEmpty: false },
  { key: "mode", label: "", defaultValue: "Phone Call", enabled: true, required: false, skipIfEmpty: false },
  { key: "requestType", label: "", defaultValue: "Incident", enabled: true, required: false, skipIfEmpty: false },
  { key: "serviceCategory", label: "", defaultValue: "", enabled: true, required: false, skipIfEmpty: true },
  { key: "status", label: "", defaultValue: "Open", enabled: true, required: false, skipIfEmpty: false },
  { key: "category", label: "", defaultValue: "", enabled: true, required: false, skipIfEmpty: true },
  { key: "subCategory", label: "", defaultValue: "", enabled: true, required: false, skipIfEmpty: true },
  { key: "item", label: "", defaultValue: "", enabled: true, required: false, skipIfEmpty: true },
  { key: "transactionNumber", label: "", defaultValue: "", enabled: true, required: false, skipIfEmpty: true },
  { key: "itemNumber", label: "", defaultValue: "", enabled: true, required: false, skipIfEmpty: true },
  { key: "typeOfTransaction", label: "", defaultValue: "", enabled: true, required: false, skipIfEmpty: true },
  { key: "paymentType", label: "", defaultValue: "", enabled: true, required: false, skipIfEmpty: true },
  { key: "technician", label: "", defaultValue: "", enabled: true, required: false, skipIfEmpty: true },
  { key: "subject", label: "", defaultValue: "", enabled: true, required: true, skipIfEmpty: false },
  { key: "description", label: "", defaultValue: "", enabled: true, required: true, skipIfEmpty: false },
  { key: "resolution", label: "", defaultValue: "", enabled: true, required: false, skipIfEmpty: false },
  { key: "partRequest", label: "", defaultValue: "", enabled: true, required: false, skipIfEmpty: true },
  { key: "additionalComments", label: "", defaultValue: "", enabled: true, required: false, skipIfEmpty: true },
  { key: "forwardTo", label: "", defaultValue: "", enabled: true, required: false, skipIfEmpty: true },
];

export interface FieldMappingSettings {
  entries: FieldMappingEntry[];
  /** When true, auto-skip fields whose value is empty during Sequential Copy. */
  autoSkipEmpty: boolean;
}

export const DEFAULT_FIELD_MAPPING_SETTINGS: FieldMappingSettings = {
  entries: [...DEFAULT_FIELD_MAPPING],
  autoSkipEmpty: true,
};

/** A single recorded copy event. Persists per-ticket in the SQLite copy_log. */
export interface CopyLogEntry {
  field: CopyableFieldKey;
  /** Snapshot of the value the user copied. */
  value: string;
  /** ISO timestamp the copy was recorded. */
  copiedAt: string;
}

/**
 * Read the field's current generated value from the TicketFields shape.
 * Centralized so the renderer, copy handler, and copy-log all see the
 * same value.
 */
export function readFieldValue(fields: TicketFields, key: CopyableFieldKey): string {
  switch (key) {
    case "site":
      return fields.site || "";
    case "storeNumber":
      return fields.storeNumber || "";
    case "registerNumber":
      return fields.registerNumber || "";
    case "dateTimeOfIssue":
      return fields.dateTimeOfIssue || "";
    case "contactName":
      return fields.contactName || "";
    case "requesterName":
      return fields.requesterName || "";
    case "impact":
      return fields.impact || "";
    case "urgency":
      return fields.urgency || "";
    case "mode":
      return fields.mode || "";
    case "requestType":
      return fields.requestType || "";
    case "serviceCategory":
      return fields.serviceCategory || "";
    case "status":
      return fields.status || "";
    case "category":
      return fields.category || "";
    case "subCategory":
      return fields.subCategory || "";
    case "item":
      return fields.item || "";
    case "transactionNumber":
      return fields.transactionNumber || "";
    case "itemNumber":
      return fields.itemNumber || "";
    case "typeOfTransaction":
      return fields.typeOfTransaction || "";
    case "paymentType":
      return fields.paymentType || "";
    case "technician":
      return fields.technician || "";
    case "subject":
      return fields.subject || "";
    case "description":
      return fields.description || "";
    case "resolution":
      return fields.resolution || "";
    case "partRequest":
      return fields.partRequest || "";
    case "additionalComments":
      return fields.additionalComments || "";
    case "forwardTo":
      return fields.forwardTo || "";
  }
}

/**
 * Resolve the displayed value: generated value first, fall back to the
 * mapping default, fall back to "Not provided" for fields the spec calls out
 * (Contact, Requester, Technician, Forward To).
 */
const NEVER_INVENT_KEYS = new Set<CopyableFieldKey>([
  "contactName",
  "requesterName",
  "technician",
  "forwardTo",
]);

export function resolveDisplayValue(
  fields: TicketFields,
  entry: FieldMappingEntry,
): string {
  const raw = readFieldValue(fields, entry.key).trim();
  if (raw) return raw;
  if (entry.defaultValue.trim()) return entry.defaultValue;
  if (NEVER_INVENT_KEYS.has(entry.key)) return "Not provided";
  return "";
}

export function resolveLabel(entry: FieldMappingEntry): string {
  return entry.label.trim() || BUILTIN_FIELD_LABELS[entry.key];
}
