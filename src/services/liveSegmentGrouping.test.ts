import { describe, expect, it } from "vitest";
import {
  canMergeContinuation,
  groupSegmentsForDisplay,
  joinWithoutOverlap,
} from "./liveSegmentGrouping";
import type { LiveSegment } from "../types/live";

function seg(overrides: Partial<LiveSegment>): LiveSegment {
  return {
    id: Math.random().toString(36).slice(2, 8),
    index: 0,
    audioOffsetMs: 0,
    durationMs: 10000,
    rawText: overrides.repairedText ?? "",
    repairedText: "",
    speaker: "store_employee",
    confidence: "medium",
    userCorrected: false,
    reason: "",
    status: "ready",
    ...overrides,
  };
}

describe("joinWithoutOverlap", () => {
  it("joins two non-overlapping fragments with a space", () => {
    expect(joinWithoutOverlap(["I am calling", "from Store 1518"])).toBe(
      "I am calling from Store 1518",
    );
  });

  it("removes a long overlap at the chunk boundary", () => {
    const out = joinWithoutOverlap([
      "I am calling from Store",
      "from Store 1518",
    ]);
    expect(out).toBe("I am calling from Store 1518");
  });

  it("keeps coincidental short matches separate", () => {
    // "Press the" and "the button" are two distinct utterances that happen
    // to share the word "the". The dedup is whitespace-sensitive, so the
    // trailing-space + leading-no-space mismatch keeps them apart and the
    // joiner just concatenates with a space.
    expect(joinWithoutOverlap(["Press the", "the button"])).toBe(
      "Press the the button",
    );
  });

  it("collapses multiple parts", () => {
    expect(
      joinWithoutOverlap([
        "May I",
        "May I have",
        "have your name?",
      ]),
    ).toBe("May I have your name?");
  });

  it("attaches a leading punctuation without a space", () => {
    expect(joinWithoutOverlap(["Hello", ", how are you"])).toBe(
      "Hello, how are you",
    );
  });
});

describe("canMergeContinuation", () => {
  it("merges same-speaker fragment without terminal punctuation", () => {
    const a = seg({ repairedText: "I am calling", speaker: "store_employee" });
    const b = seg({ repairedText: "from Store 1518.", speaker: "store_employee" });
    expect(canMergeContinuation(a, b)).toBe(true);
  });

  it("refuses to merge across different speakers", () => {
    const a = seg({ repairedText: "May I have", speaker: "tech_support" });
    const b = seg({ repairedText: "your name?", speaker: "store_employee" });
    expect(canMergeContinuation(a, b)).toBe(false);
  });

  it("does not merge a complete sentence", () => {
    const a = seg({ repairedText: "Register 2 is broken.", speaker: "store_employee" });
    const b = seg({ repairedText: "It says hardware failure.", speaker: "store_employee" });
    expect(canMergeContinuation(a, b)).toBe(false);
  });

  it("leaves a stand-alone yes/no as its own row", () => {
    const a = seg({ repairedText: "Yes.", speaker: "store_employee" });
    const b = seg({ repairedText: "It works now.", speaker: "store_employee" });
    expect(canMergeContinuation(a, b)).toBe(false);
  });

  it("refuses to merge a wrong-flagged with a non-flagged chunk", () => {
    const a = seg({
      repairedText: "I am calling",
      speaker: "store_employee",
      wrongTranscription: true,
    });
    const b = seg({ repairedText: "from Store 1518", speaker: "store_employee" });
    expect(canMergeContinuation(a, b)).toBe(false);
  });
});

describe("groupSegmentsForDisplay", () => {
  it("collapses two-fragment caller utterance into one row", () => {
    const a = seg({ id: "a", repairedText: "I am calling", speaker: "store_employee" });
    const b = seg({
      id: "b",
      repairedText: "from Store 1518",
      speaker: "store_employee",
    });
    const groups = groupSegmentsForDisplay([a, b]);
    expect(groups).toHaveLength(1);
    expect(groups[0].segmentIds).toEqual(["a", "b"]);
    expect(groups[0].mergedText).toBe("I am calling from Store 1518");
    expect(groups[0].isMerged).toBe(true);
  });

  it("keeps tech/caller turns as separate rows", () => {
    const t = seg({
      id: "t",
      repairedText: "May I have your name?",
      speaker: "tech_support",
    });
    const c = seg({
      id: "c",
      repairedText: "This is Kaitlyn.",
      speaker: "store_employee",
    });
    const groups = groupSegmentsForDisplay([t, c]);
    expect(groups).toHaveLength(2);
    expect(groups[0].leadSegment.id).toBe("t");
    expect(groups[1].leadSegment.id).toBe("c");
  });

  it("does not collapse three independent caller statements with terminals", () => {
    const a = seg({ id: "a", repairedText: "Register 2.", speaker: "store_employee" });
    const b = seg({
      id: "b",
      repairedText: "The keyboard is not letting me type.",
      speaker: "store_employee",
    });
    const c = seg({
      id: "c",
      repairedText: "The mouse works.",
      speaker: "store_employee",
    });
    const groups = groupSegmentsForDisplay([a, b, c]);
    expect(groups).toHaveLength(3);
  });
});
