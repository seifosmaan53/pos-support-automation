import { describe, expect, it } from "vitest";
import { assessTranscriptQuality } from "./transcriptQuality";

const LOW = { peakLevel: 0.03, rmsLevel: 0.005 };
const NORMAL = { peakLevel: 0.6, rmsLevel: 0.15 };

describe("assessTranscriptQuality — Phase 16C spec test cases", () => {
  it("Test 1: bracket-only → bad", () => {
    const r = assessTranscriptQuality(
      "[inaudible] [ Pause ] [SOUND] [typing] [BLANK_AUDIO]",
    );
    expect(r.quality).toBe("bad");
    expect(r.shouldAnalyze).toBe(false);
    expect(r.shouldShowLiveAssist).toBe(false);
    expect(r.shouldShowKnowledge).toBe(false);
    expect(r.shouldShowDeviceSpecificPrompts).toBe(false);
    expect(r.artifactCount).toBeGreaterThanOrEqual(5);
    expect(r.usefulWordCount).toBe(0);
  });

  it("Test 2: YouTube hallucination phrase on low audio → bad", () => {
    const r = assessTranscriptQuality(
      "You can see the link in the description below.",
      { audioStats: LOW },
    );
    expect(["poor", "bad"]).toContain(r.quality);
    expect(r.shouldAnalyze).toBe(false);
    expect(r.reasons.some((m) => m.toLowerCase().includes("hallucination"))).toBe(true);
  });

  it("Test 3: random low-audio printer chatter → poor or bad", () => {
    const r = assessTranscriptQuality(
      "The printer will get that out. Okay, that's fine. Thank you.",
      { audioStats: LOW },
    );
    expect(["poor", "bad"]).toContain(r.quality);
    expect(r.shouldShowDeviceSpecificPrompts).toBe(false);
  });

  it("Test 4: real ticket-quality conversation → good or usable", () => {
    const r = assessTranscriptQuality(
      "Computer room, how can I help you? Hi, I am calling from Store 1518. The keyboard is not working on Register 2.",
      { audioStats: NORMAL },
    );
    expect(["good", "usable"]).toContain(r.quality);
    expect(r.shouldAnalyze).toBe(true);
    expect(r.hasStoreNumber).toBe(true);
    expect(r.hasIssueSignal).toBe(true);
  });

  it("Test 5: noisy but useful → usable with review-recommended reasons", () => {
    const r = assessTranscriptQuality(
      "[Pause] [SOUND] Store 1518. [inaudible] keyboard not working.",
    );
    expect(r.shouldAnalyze).toBe(true);
    expect(r.hasStoreNumber).toBe(true);
    expect(r.hasIssueSignal).toBe(true);
    expect(r.artifactCount).toBeGreaterThanOrEqual(3);
    // Should have at least one warning reason about artifacts.
    expect(r.reasons.some((m) => /artifact/i.test(m))).toBe(true);
  });
});

describe("assessTranscriptQuality — additional invariants", () => {
  it("empty string is bad", () => {
    const r = assessTranscriptQuality("");
    expect(r.quality).toBe("bad");
    expect(r.shouldAnalyze).toBe(false);
  });

  it("good-quality long transcript with store + issue gets `good` verdict", () => {
    const long = `Tech Support: Computer room, how can I help you?
Caller: Hi, this is Maria from Store 1518. Our Register 2 keyboard is not typing anymore. We can move the mouse fine, but no characters come through.
Tech Support: Let's try a power drain. Shut Register 2 down, hold the power button for thirty seconds, then boot it back up.
Caller: One moment. Okay, it booted. The keyboard is working now.
Tech Support: Great. Closing the ticket as resolved.`;
    const r = assessTranscriptQuality(long);
    expect(r.quality).toBe("good");
    expect(r.shouldShowDeviceSpecificPrompts).toBe(true);
  });

  it("bracket-only output still reports artifact ratio = 1", () => {
    const r = assessTranscriptQuality("[inaudible] [BLANK_AUDIO]");
    expect(r.artifactRatio).toBe(1);
  });

  it("reasons include 'no store number detected' when applicable", () => {
    const r = assessTranscriptQuality("Hi, my keyboard is not working today.");
    expect(r.reasons.some((m) => /no store number/i.test(m))).toBe(true);
  });
});
