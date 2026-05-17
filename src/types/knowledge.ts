/**
 * Phase 7: Knowledge Base types.
 *
 * The SQLite `knowledge_items` table stores a typed record per row with the
 * shape (id, type, title, content_json, created_at, updated_at). The
 * per-type content shape lives in `content_json` so a single table can
 * carry every kind of knowledge without per-type tables.
 *
 * Design rules:
 *   • Each KnowledgeItemType has a matching content interface below. The
 *     KnowledgeItem<T> generic is narrowed via the discriminator on `.type`.
 *   • Default-content factories produce empty-but-valid content for the
 *     "Add knowledge item" form so the editor can render before the user
 *     types anything.
 *   • Knowledge MAY suggest, but the ticket fields stay sourced from the
 *     transcript/extracted details. Nothing in this file generates ticket
 *     copy — that responsibility lives in `ticketGenerator` /
 *     `ticketFieldGenerator`.
 */

export type KnowledgeItemType =
  | "common_problem"
  | "troubleshooting_guide"
  | "part_request_rule"
  | "escalation_rule"
  | "store_note"
  | "device_note"
  | "category_mapping"
  | "correction_rule";

export const KNOWLEDGE_TYPES: { value: KnowledgeItemType; label: string; hint: string }[] = [
  {
    value: "common_problem",
    label: "Common Problem",
    hint: "A repeating issue with symptoms and likely fix",
  },
  {
    value: "troubleshooting_guide",
    label: "Troubleshooting Guide",
    hint: "Step-by-step guide for a category or device",
  },
  {
    value: "part_request_rule",
    label: "Part Request Rule",
    hint: "Conditions that trigger a replacement suggestion",
  },
  {
    value: "escalation_rule",
    label: "Escalation Rule",
    hint: "When to escalate to vendor or higher tier",
  },
  {
    value: "store_note",
    label: "Store Note",
    hint: "Specific note about a store (manager, region, history)",
  },
  {
    value: "device_note",
    label: "Device Note",
    hint: "Note about a specific device or model",
  },
  {
    value: "category_mapping",
    label: "Category Mapping",
    hint: "Maps issue keywords to category / sub-category / item",
  },
  {
    value: "correction_rule",
    label: "Correction Rule",
    hint: "Transcript correction (misheard term → canonical)",
  },
];

export interface CommonProblemContent {
  category?: string;
  deviceType?: string;
  symptoms: string[];
  troubleshootingSteps: string[];
  likelyResolution: string;
  warnings: string[];
  /** Free-form keywords used by the relevance scorer. */
  keywords: string[];
  /** Linked ticket IDs that gave rise to this entry. */
  relatedTicketIds: string[];
}

export interface TroubleshootingGuideContent {
  category?: string;
  deviceType?: string;
  /** Plain "Issue:" paragraph for the prefill example. */
  issue: string;
  symptoms: string[];
  steps: string[];
  warnings: string[];
  /** Optional follow-up questions to surface as Suggested Questions. */
  questions: string[];
  keywords: string[];
  relatedTicketIds: string[];
}

export interface PartRequestRuleContent {
  /** Match on device type, eg. "Receipt Printer". */
  deviceType?: string;
  /** Match on category, eg. "IBM Registers". */
  category?: string;
  /** Symptom phrases that must appear (any-match). */
  triggerPhrases: string[];
  /** Plain-language reason wording surfaced in the suggestion. */
  reason: string;
  /** Replacement language to suggest, eg. "replacement receipt printer". */
  partLabel: string;
  /** Disqualifiers, eg. "fixed by power drain". */
  excludePhrases: string[];
  relatedTicketIds: string[];
}

export interface EscalationRuleContent {
  category?: string;
  deviceType?: string;
  /** Symptom phrases that should trigger escalation. */
  triggerPhrases: string[];
  escalateTo: string;
  reason: string;
  relatedTicketIds: string[];
}

export interface StoreNoteContent {
  storeNumber: string;
  region?: string;
  manager?: string;
  notes: string;
  relatedTicketIds: string[];
}

export interface DeviceNoteContent {
  deviceType: string;
  deviceModel?: string;
  notes: string;
  knownIssues: string[];
  relatedTicketIds: string[];
}

export interface CategoryMappingContent {
  triggerKeywords: string[];
  category: string;
  subCategory: string;
  item: string;
  relatedTicketIds: string[];
}

export interface CorrectionRuleContent {
  /** Transcript phrase as misheard. */
  detected: string;
  /** Canonical replacement. */
  corrected: string;
  /** Free-form note explaining when this rule applies. */
  notes: string;
  relatedTicketIds: string[];
}

export type KnowledgeContentByType = {
  common_problem: CommonProblemContent;
  troubleshooting_guide: TroubleshootingGuideContent;
  part_request_rule: PartRequestRuleContent;
  escalation_rule: EscalationRuleContent;
  store_note: StoreNoteContent;
  device_note: DeviceNoteContent;
  category_mapping: CategoryMappingContent;
  correction_rule: CorrectionRuleContent;
};

/**
 * Single row shape. `content` is narrowed by the `type` discriminator —
 * consumers should switch on `.type` to recover the per-type fields safely.
 */
export interface KnowledgeItem<T extends KnowledgeItemType = KnowledgeItemType> {
  id: string;
  type: T;
  title: string;
  content: KnowledgeContentByType[T];
  createdAt: string;
  updatedAt: string;
}

export type AnyKnowledgeItem = {
  [K in KnowledgeItemType]: KnowledgeItem<K>;
}[KnowledgeItemType];

export function defaultContentForType<T extends KnowledgeItemType>(
  type: T,
): KnowledgeContentByType[T] {
  switch (type) {
    case "common_problem":
      return {
        category: "",
        deviceType: "",
        symptoms: [],
        troubleshootingSteps: [],
        likelyResolution: "",
        warnings: [],
        keywords: [],
        relatedTicketIds: [],
      } as unknown as KnowledgeContentByType[T];
    case "troubleshooting_guide":
      return {
        category: "",
        deviceType: "",
        issue: "",
        symptoms: [],
        steps: [],
        warnings: [],
        questions: [],
        keywords: [],
        relatedTicketIds: [],
      } as unknown as KnowledgeContentByType[T];
    case "part_request_rule":
      return {
        deviceType: "",
        category: "",
        triggerPhrases: [],
        reason: "",
        partLabel: "",
        excludePhrases: [],
        relatedTicketIds: [],
      } as unknown as KnowledgeContentByType[T];
    case "escalation_rule":
      return {
        category: "",
        deviceType: "",
        triggerPhrases: [],
        escalateTo: "",
        reason: "",
        relatedTicketIds: [],
      } as unknown as KnowledgeContentByType[T];
    case "store_note":
      return {
        storeNumber: "",
        region: "",
        manager: "",
        notes: "",
        relatedTicketIds: [],
      } as unknown as KnowledgeContentByType[T];
    case "device_note":
      return {
        deviceType: "",
        deviceModel: "",
        notes: "",
        knownIssues: [],
        relatedTicketIds: [],
      } as unknown as KnowledgeContentByType[T];
    case "category_mapping":
      return {
        triggerKeywords: [],
        category: "",
        subCategory: "",
        item: "",
        relatedTicketIds: [],
      } as unknown as KnowledgeContentByType[T];
    case "correction_rule":
      return {
        detected: "",
        corrected: "",
        notes: "",
        relatedTicketIds: [],
      } as unknown as KnowledgeContentByType[T];
  }
  // Exhaustive — the switch above covers every KnowledgeItemType.
  // Returning a CommonProblemContent shape here is unreachable but keeps TS happy.
  return {
    symptoms: [],
    troubleshootingSteps: [],
    likelyResolution: "",
    warnings: [],
    keywords: [],
    relatedTicketIds: [],
  } as unknown as KnowledgeContentByType[T];
}

/** Human-readable label for a stored type. */
export function labelForKnowledgeType(t: KnowledgeItemType): string {
  return KNOWLEDGE_TYPES.find((k) => k.value === t)?.label ?? t;
}

/** Returns true if the given content has any user-provided non-default fields. */
export function isContentEmpty(item: AnyKnowledgeItem): boolean {
  switch (item.type) {
    case "common_problem":
      return (
        !item.content.likelyResolution &&
        item.content.symptoms.length === 0 &&
        item.content.troubleshootingSteps.length === 0
      );
    case "troubleshooting_guide":
      return (
        !item.content.issue &&
        item.content.steps.length === 0 &&
        item.content.symptoms.length === 0
      );
    case "part_request_rule":
      return (
        !item.content.partLabel &&
        item.content.triggerPhrases.length === 0
      );
    case "escalation_rule":
      return (
        !item.content.escalateTo &&
        item.content.triggerPhrases.length === 0
      );
    case "store_note":
      return !item.content.storeNumber && !item.content.notes;
    case "device_note":
      return !item.content.deviceType && !item.content.notes;
    case "category_mapping":
      return (
        !item.content.category &&
        item.content.triggerKeywords.length === 0
      );
    case "correction_rule":
      return !item.content.detected && !item.content.corrected;
  }
}
