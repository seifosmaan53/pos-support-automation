export type ConfidenceLevel = "high" | "medium" | "low" | "missing";

export interface FieldConfidence {
  field: string;
  level: ConfidenceLevel;
  reason: string;
}

export interface SelfReviewResult {
  overall: ConfidenceLevel;
  fields: FieldConfidence[];
  flags: string[];
  reviewRecommended: boolean;
}

export const EMPTY_SELF_REVIEW: SelfReviewResult = {
  overall: "missing",
  fields: [],
  flags: [],
  reviewRecommended: false,
};

export function confidenceLabel(c: ConfidenceLevel): string {
  if (c === "high") return "High-confidence";
  if (c === "medium") return "Review recommended";
  if (c === "low") return "Low-confidence field";
  return "Missing detail";
}

export function confidenceColor(c: ConfidenceLevel): string {
  if (c === "high") return "emerald";
  if (c === "medium") return "amber";
  if (c === "low") return "orange";
  return "red";
}
