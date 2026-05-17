import { describe, expect, it } from "vitest";
import { findSourceForValue, formatSourceLabel } from "./liveDetailProvenance";
import type { LiveSegment } from "../types/live";

function seg(text: string, offsetMs: number, speaker: LiveSegment["speaker"] = "store_employee"): LiveSegment {
  return {
    id: `s-${offsetMs}`,
    index: 0,
    audioOffsetMs: offsetMs,
    durationMs: 10000,
    rawText: text,
    repairedText: text,
    speaker,
    confidence: "medium",
    userCorrected: false,
    reason: "",
    status: "ready",
  };
}

describe("findSourceForValue", () => {
  it("finds the earliest segment containing the value", () => {
    const segs = [
      seg("Hi this is a store call.", 1000),
      seg("I am calling from Store 1518.", 4000),
      seg("Yes, Store 1518 again.", 9000),
    ];
    const src = findSourceForValue("1518", segs);
    expect(src?.audioOffsetMs).toBe(4000);
  });

  it("returns null when no segment contains the value", () => {
    const segs = [seg("hello there", 1000)];
    expect(findSourceForValue("9999", segs)).toBeNull();
  });

  it("respects word boundaries (Kate is not in Kaitlyn)", () => {
    const segs = [seg("This is Kaitlyn.", 5000)];
    expect(findSourceForValue("Kate", segs)).toBeNull();
  });

  it("is case-insensitive", () => {
    const segs = [seg("My name is kaitlyn.", 3000)];
    const src = findSourceForValue("Kaitlyn", segs);
    expect(src?.audioOffsetMs).toBe(3000);
  });

  it("skips wrongTranscription-flagged segments", () => {
    const a: LiveSegment = { ...seg("Store 1518.", 1000), wrongTranscription: true };
    const b = seg("Store 1518 confirmed.", 8000);
    const src = findSourceForValue("1518", [a, b]);
    expect(src?.audioOffsetMs).toBe(8000);
  });
});

describe("formatSourceLabel", () => {
  it("renders 'Caller at MM:SS' for store-side speakers", () => {
    expect(
      formatSourceLabel({
        segmentId: "x",
        audioOffsetMs: 14000,
        speakerLabel: "store_employee",
      }),
    ).toBe("Caller at 00:14");
  });

  it("renders 'Tech Support at MM:SS' for tech speakers", () => {
    expect(
      formatSourceLabel({
        segmentId: "x",
        audioOffsetMs: 65000,
        speakerLabel: "tech_support",
      }),
    ).toBe("Tech Support at 01:05");
  });
});
