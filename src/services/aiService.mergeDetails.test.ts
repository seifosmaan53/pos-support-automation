import { describe, expect, it } from "vitest";
import { EMPTY_DETAILS, type ExtractedDetails } from "../types/ticket";
import { mergeDetails } from "./aiService";

function details(partial: Partial<ExtractedDetails>): ExtractedDetails {
  return {
    ...EMPTY_DETAILS,
    ...partial,
    evidence: { ...EMPTY_DETAILS.evidence, ...(partial.evidence ?? {}) },
  };
}

describe("mergeDetails", () => {
  it("aligns flags with merged result when AI overrides rule (Escalated vs Resolved)", () => {
    const rule = details({
      result: "Resolved",
      isResolved: true,
      isPending: false,
      isEscalated: false,
    });
    const ai = details({
      result: "Escalated",
      isResolved: false,
      isPending: false,
      isEscalated: true,
      issue: "AI issue text",
    });
    const m = mergeDetails(rule, ai);
    expect(m.result).toBe("Escalated");
    expect(m.isEscalated).toBe(true);
    expect(m.isResolved).toBe(false);
    expect(m.isPending).toBe(false);
    expect(m.issue).toBe("AI issue text");
  });

  it("falls back to rule when AI result is ResultNotConfirmed", () => {
    const rule = details({
      result: "Pending",
      isPending: true,
    });
    const ai = details({
      result: "ResultNotConfirmed",
      isResolved: true,
      isPending: false,
    });
    const m = mergeDetails(rule, ai);
    expect(m.result).toBe("Pending");
    expect(m.isPending).toBe(true);
    expect(m.isResolved).toBe(false);
  });

  it("uses AI result when valid and keeps flags consistent for Resolved", () => {
    const rule = details({ result: "Pending", isPending: true });
    const ai = details({ result: "Resolved", isResolved: true });
    const m = mergeDetails(rule, ai);
    expect(m.result).toBe("Resolved");
    expect(m.isResolved).toBe(true);
    expect(m.isPending).toBe(false);
    expect(m.isEscalated).toBe(false);
  });
});
