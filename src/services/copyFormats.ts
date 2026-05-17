/**
 * Phase 9: Multiple "Copy Full Ticket" formats. Each format is a pure
 * function of TicketFields (and the user's FieldMappingSettings, when
 * order matters). No side effects, no clipboard interaction — that
 * responsibility lives in the component that calls these.
 */
import type { TicketFields } from "../types/ticket";
import {
  BUILTIN_FIELD_LABELS,
  resolveDisplayValue,
  resolveLabel,
  type FieldMappingSettings,
} from "../types/copyMode";
import { buildFullTicketText } from "./ticketFieldGenerator";

export type CopyFormat =
  | "plain"
  | "labeled"
  | "manage-engine"
  | "description-resolution"
  | "subject-description-resolution"
  | "default";

export const COPY_FORMATS: { value: CopyFormat; label: string; hint: string }[] = [
  {
    value: "default",
    label: "Full Ticket (default)",
    hint: "Subject + description + resolution + form fields + warnings.",
  },
  {
    value: "plain",
    label: "Plain Text",
    hint: "Subject, description, and resolution joined by blank lines — no labels.",
  },
  {
    value: "labeled",
    label: "Field Labels",
    hint: "Every visible field as 'Label: Value' on its own line.",
  },
  {
    value: "manage-engine",
    label: "ManageEngine Field Order",
    hint: "Fields ordered to match the user's real ticketing-system tabs.",
  },
  {
    value: "description-resolution",
    label: "Description + Resolution",
    hint: "Just the two narrative blocks, blank line between.",
  },
  {
    value: "subject-description-resolution",
    label: "Subject + Description + Resolution",
    hint: "Three labeled blocks. Useful for chat handoffs.",
  },
];

export function formatTicket(
  fields: TicketFields,
  format: CopyFormat,
  mapping: FieldMappingSettings,
): string {
  switch (format) {
    case "default":
      return buildFullTicketText(fields);
    case "plain":
      return [
        fields.subject,
        fields.description,
        fields.resolution,
      ]
        .map((s) => (s || "").trim())
        .filter(Boolean)
        .join("\n\n");
    case "labeled":
      return mapping.entries
        .filter((e) => e.enabled)
        .map((e) => {
          const value = resolveDisplayValue(fields, e);
          if (!value && e.skipIfEmpty) return null;
          return `${resolveLabel(e)}: ${value}`;
        })
        .filter((v): v is string => v !== null)
        .join("\n");
    case "manage-engine":
      return buildManageEngineBlock(fields);
    case "description-resolution":
      return [
        fields.description?.trim() || "",
        fields.resolution?.trim() || "",
      ]
        .filter(Boolean)
        .join("\n\n");
    case "subject-description-resolution":
      return [
        fields.subject ? `Subject:\n${fields.subject}` : "",
        fields.description ? `Description:\n${fields.description}` : "",
        fields.resolution ? `Resolution:\n${fields.resolution}` : "",
      ]
        .filter(Boolean)
        .join("\n\n");
  }
}

/**
 * Field order matching the user's real ticketing system tabs:
 *   Store Request → Requester Details → Transaction Details →
 *   Additional Info → Resolution.
 *
 * Mirrors the visual sectioning so the user can paste the block into a
 * notebook + scroll naturally to find each field.
 */
function buildManageEngineBlock(f: TicketFields): string {
  const lines: string[] = [];
  const section = (title: string, rows: [string, string][]) => {
    lines.push(`# ${title}`);
    for (const [label, value] of rows) {
      lines.push(`${label}: ${value}`);
    }
    lines.push("");
  };

  section("Store Request", [
    [BUILTIN_FIELD_LABELS.site, f.site || ""],
    [BUILTIN_FIELD_LABELS.storeNumber, f.storeNumber || ""],
    [BUILTIN_FIELD_LABELS.registerNumber, f.registerNumber || ""],
    [BUILTIN_FIELD_LABELS.dateTimeOfIssue, f.dateTimeOfIssue || ""],
    [BUILTIN_FIELD_LABELS.contactName, f.contactName || "Not provided"],
    [BUILTIN_FIELD_LABELS.requesterName, f.requesterName || "Not provided"],
    [BUILTIN_FIELD_LABELS.impact, f.impact || ""],
    [BUILTIN_FIELD_LABELS.urgency, f.urgency || ""],
    [BUILTIN_FIELD_LABELS.mode, f.mode || ""],
    [BUILTIN_FIELD_LABELS.requestType, f.requestType || ""],
    [BUILTIN_FIELD_LABELS.serviceCategory, f.serviceCategory || ""],
    [BUILTIN_FIELD_LABELS.status, f.status || ""],
  ]);
  section("Requester Details", [
    [BUILTIN_FIELD_LABELS.category, f.category || ""],
    [BUILTIN_FIELD_LABELS.subCategory, f.subCategory || ""],
    [BUILTIN_FIELD_LABELS.item, f.item || ""],
    [BUILTIN_FIELD_LABELS.transactionNumber, f.transactionNumber || ""],
    [BUILTIN_FIELD_LABELS.itemNumber, f.itemNumber || ""],
    [BUILTIN_FIELD_LABELS.typeOfTransaction, f.typeOfTransaction || ""],
    [BUILTIN_FIELD_LABELS.paymentType, f.paymentType || ""],
  ]);
  section("Transaction Details", [
    [BUILTIN_FIELD_LABELS.technician, f.technician || "Not provided"],
    [BUILTIN_FIELD_LABELS.subject, f.subject || ""],
    [BUILTIN_FIELD_LABELS.description, f.description || ""],
  ]);
  section("Additional Info", [
    [BUILTIN_FIELD_LABELS.forwardTo, f.forwardTo || "Not provided"],
    [BUILTIN_FIELD_LABELS.additionalComments, f.additionalComments || ""],
  ]);
  if (f.partRequest?.trim()) {
    section("Part Request", [[BUILTIN_FIELD_LABELS.partRequest, f.partRequest]]);
  }
  section("Resolution", [[BUILTIN_FIELD_LABELS.resolution, f.resolution || ""]]);

  return lines.join("\n").trimEnd();
}
