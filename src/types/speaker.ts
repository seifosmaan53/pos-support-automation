export type SpeakerLabel =
  | "tech_support"
  | "store_employee"
  | "store_manager"
  | "vendor"
  | "customer"
  | "wrong_caller"
  | "unknown";

export const SPEAKER_LABEL_OPTIONS: { value: SpeakerLabel; label: string; color: string }[] = [
  { value: "tech_support", label: "Tech Support", color: "sky" },
  { value: "store_employee", label: "Store Employee", color: "amber" },
  { value: "store_manager", label: "Store Manager", color: "violet" },
  { value: "vendor", label: "Vendor", color: "teal" },
  { value: "customer", label: "Customer", color: "rose" },
  { value: "wrong_caller", label: "Wrong Caller", color: "orange" },
  { value: "unknown", label: "Unknown", color: "slate" },
];

export interface SpeakerSegment {
  id: string;
  speaker: SpeakerLabel;
  /** Repaired text — the post-correction string the detector classifies. */
  text: string;
  /**
   * Pre-repair text. Differs from `text` only when transcript repair changed
   * something within the segment. Optional so legacy tickets and synthetic
   * segments don't need to carry it.
   */
  originalText?: string;
  timestampStart: string;
  timestampEnd: string;
  confidence: "high" | "medium" | "low";
  userCorrected: boolean;
  /** Plain-English reason for the auto-label, captured at detection time. */
  reason?: string;
}

export function speakerLabelText(s: SpeakerLabel): string {
  switch (s) {
    case "tech_support":
      return "Tech Support";
    case "store_employee":
      return "Store Employee";
    case "store_manager":
      return "Store Manager";
    case "vendor":
      return "Vendor";
    case "customer":
      return "Customer";
    case "wrong_caller":
      return "Wrong Caller";
    case "unknown":
    default:
      return "Speaker not confirmed";
  }
}
