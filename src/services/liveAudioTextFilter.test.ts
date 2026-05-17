import { describe, expect, it } from "vitest";
import { classifyLiveChunkText, computeAudioStats } from "./liveAudioTextFilter";

const LOW_AUDIO = { peakLevel: 0.02, rmsLevel: 0.005 };
const HIGH_AUDIO = { peakLevel: 0.6, rmsLevel: 0.15 };

describe("classifyLiveChunkText — spec test cases", () => {
  it("Test 1: bracket-artifact-only noise is hidden", () => {
    const r = classifyLiveChunkText("[inaudible] [ Pause ] [ Pause ] [SOUND] [typing]");
    expect(r.kind).toBe("noise");
    expect(r.shouldShowInConversation).toBe(false);
    expect(r.cleanedText).toBe("");
  });

  it("Test 2: silence hallucination is hidden", () => {
    const r = classifyLiveChunkText("Thank you for watching.", LOW_AUDIO);
    expect(r.kind).toBe("hallucination");
    expect(r.shouldShowInConversation).toBe(false);
  });

  it("Test 3: real caller speech is kept", () => {
    const r = classifyLiveChunkText("Hi, I am calling from Store 1518.", HIGH_AUDIO);
    expect(r.kind).toBe("speech");
    expect(r.shouldShowInConversation).toBe(true);
    expect(r.cleanedText).toContain("1518");
  });

  it("Test 4: real tech speech is kept", () => {
    const r = classifyLiveChunkText("Computer room, how can I help you?", HIGH_AUDIO);
    expect(r.kind).toBe("speech");
    expect(r.shouldShowInConversation).toBe(true);
  });

  it("Test 5: short answer at audible level is kept (speaker layer handles turn-taking)", () => {
    const r = classifyLiveChunkText("Register 2.", HIGH_AUDIO);
    expect(r.kind).toBe("speech");
    expect(r.shouldShowInConversation).toBe(true);
  });

  it("Test 6: random text on silent audio is hidden", () => {
    const r = classifyLiveChunkText(
      "The printer will get that out. Okay, that's fine. Thank you.",
      { peakLevel: 0.03, rmsLevel: 0.005 },
    );
    expect(r.kind).toBe("hallucination");
    expect(r.shouldShowInConversation).toBe(false);
  });
});

describe("classifyLiveChunkText — edge cases", () => {
  it("empty whisper output is silence, hidden", () => {
    const r = classifyLiveChunkText("");
    expect(r.kind).toBe("silence");
    expect(r.shouldShowInConversation).toBe(false);
  });

  it("audible thank-you is kept as low-confidence speech (caller might have actually said it)", () => {
    const r = classifyLiveChunkText("Thank you.", HIGH_AUDIO);
    expect(r.kind).toBe("speech");
    expect(r.shouldShowInConversation).toBe(true);
    expect(r.confidence).toBe("low");
  });

  it("mixed brackets + a few real words is unclear and hidden", () => {
    const r = classifyLiveChunkText("[inaudible] [pause] hello");
    expect(r.shouldShowInConversation).toBe(false);
    expect(["noise", "unclear"]).toContain(r.kind);
  });

  it("generic 'okay' on a low-level chunk is treated as a hallucination", () => {
    const r = classifyLiveChunkText("Okay.", LOW_AUDIO);
    expect(r.shouldShowInConversation).toBe(false);
  });
});

describe("classifyLiveChunkText — Phase 16D per-device thresholds", () => {
  it("a chunk that's silent under defaults stays silent under defaults", () => {
    const stats = { peakLevel: 0.04, rmsLevel: 0.008 };
    const r = classifyLiveChunkText("Thank you.", stats);
    expect(r.kind).toBe("hallucination");
  });

  it("the same chunk becomes speech under per-device calibration that floors silence higher", () => {
    // A user with a quiet-room calibration: silenceRms = 0.002 means
    // 0.008 is well ABOVE silence. We also have to clear the peak
    // threshold (default 0.05) for the chunk to count as audible.
    const stats = { peakLevel: 0.15, rmsLevel: 0.008 };
    const r = classifyLiveChunkText("Thank you.", stats, {
      silenceRms: 0.002,
      speechRms: 0.005,
    });
    expect(r.kind).toBe("speech");
    expect(r.confidence).toBe("low");
  });

  it("calibrated speech-floor of 0.05 promotes a 0.04 chunk to 'low audio'", () => {
    // If calibration says "I normally speak louder than 0.05 rms",
    // anything at 0.008 is definitely low — generic short response
    // gets hidden.
    const stats = { peakLevel: 0.1, rmsLevel: 0.008 };
    const r = classifyLiveChunkText("Okay.", stats, {
      silenceRms: 0.003,
      speechRms: 0.05,
    });
    expect(r.shouldShowInConversation).toBe(false);
  });
});

describe("classifyLiveChunkText — Phase 16D follow-up: calibration scenarios", () => {
  it("Spec 1: no calibration → uses default thresholds", () => {
    // rmsLevel 0.008 < default SILENCE_RMS 0.01 → silent → hallucination on
    // a real phrase.
    const r = classifyLiveChunkText("I am calling from Store 1518.", {
      peakLevel: 0.04,
      rmsLevel: 0.008,
    });
    expect(r.kind).toBe("hallucination");
    expect(r.shouldShowInConversation).toBe(false);
  });

  it("Spec 2: calibration lowers silence floor → audio above calibrated silence is NOT silent", () => {
    // Same 0.008 rmsLevel, but calibrated silenceRms = 0.002 → 0.008 is well
    // above silence. Also bump peakClipping out of the picture by passing a
    // high peak so the audible branch fires.
    const r = classifyLiveChunkText("I am calling from Store 1518.", {
      peakLevel: 0.4,
      rmsLevel: 0.008,
    }, {
      silenceRms: 0.002,
      speechRms: 0.005,
    });
    expect(r.kind).toBe("speech");
    expect(r.shouldShowInConversation).toBe(true);
  });

  it("Spec 3: calibration raises speech floor → audio below it is low-level / hidden", () => {
    // rmsLevel 0.02 would normally pass default speech floor (0.025 is the
    // threshold, but it's borderline). With a calibrated speechRms of 0.05,
    // an "okay" at 0.02 is well below speech-level → hide.
    const r = classifyLiveChunkText("Okay.", {
      peakLevel: 0.2,
      rmsLevel: 0.02,
    }, {
      silenceRms: 0.002,
      speechRms: 0.05,
    });
    expect(r.shouldShowInConversation).toBe(false);
  });

  it("Spec 4: peak exceeds calibrated peakClipping → peakClipping flag set", () => {
    const r = classifyLiveChunkText("I am calling from Store 1518.", {
      peakLevel: 0.92,
      rmsLevel: 0.2,
    }, {
      peakClipping: 0.85,
    });
    expect(r.peakClipping).toBe(true);
    // Clipping doesn't change the text-classification kind — clipped real
    // speech is still real speech, just loud.
    expect(r.kind).toBe("speech");
  });

  it("Spec 5: calibration for a different mic is NOT used (caller filters)", () => {
    // We don't simulate per-mic lookup here — appStore.processLiveChunk owns
    // that. Instead we assert that passing no thresholds falls back to
    // defaults so "wrong-mic calibration" can't leak in.
    const r = classifyLiveChunkText("I am calling from Store 1518.", {
      peakLevel: 0.04,
      rmsLevel: 0.008,
    });
    expect(r.kind).toBe("hallucination"); // same as Spec 1 — no calibration applied
  });

  it("peakClipping = false when below the default 0.95 threshold", () => {
    const r = classifyLiveChunkText("Hi there.", {
      peakLevel: 0.5,
      rmsLevel: 0.1,
    });
    expect(r.peakClipping).toBe(false);
  });
});

describe("computeAudioStats", () => {
  it("returns zeros for an empty buffer", () => {
    expect(computeAudioStats(new Float32Array(0))).toEqual({ peakLevel: 0, rmsLevel: 0 });
  });

  it("computes peak + rms correctly", () => {
    const samples = new Float32Array([0.5, -0.5, 0.5, -0.5]);
    const stats = computeAudioStats(samples);
    expect(stats.peakLevel).toBeCloseTo(0.5);
    expect(stats.rmsLevel).toBeCloseTo(0.5);
  });
});
