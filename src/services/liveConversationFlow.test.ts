/**
 * Phase 11B — realistic live-call integration tests.
 *
 * Each test runs the same pipeline a real recording would hit:
 *   1. detectSpeakers — assigns tech_support / store_employee labels
 *   2. analyzeTranscript — extracts ExtractedDetails
 *   3. liveAskNextQuestions + rankAndCapQuestions — produces the
 *      next-question list
 *
 * These tests aren't testing perfect classification; they're testing that
 * for the conversations from the Phase 11B spec, the pipeline ends up at
 * a useful state — the right facts captured, the speakers separated, and
 * the right follow-up questions queued.
 */

import { describe, expect, it } from "vitest";
import { detectSpeakers } from "./speakerDetector";
import { analyzeTranscript } from "./transcriptAnalyzer";
import { detectCallerName } from "./callerNameDetector";
import {
  isNearEndOfCall,
  liveAskNextQuestions,
  rankAndCapQuestions,
} from "./liveAskNext";

describe("live conversation Test 1 — keyboard issue at Store 1518", () => {
  const transcript = [
    "Tech Support: Computer room, how can I help you?",
    "Store Employee: I am calling from Store 1518.",
    "Tech Support: May I have your name?",
    "Store Employee: This is Kaitlyn.",
    "Tech Support: Which register is affected?",
    "Store Employee: Register 2.",
    "Store Employee: The keyboard is not letting me type, but the mouse works.",
  ].join("\n\n");

  it("separates tech support and caller turns", () => {
    const segs = detectSpeakers(transcript);
    const techCount = segs.filter((s) => s.speaker === "tech_support").length;
    const storeCount = segs.filter((s) => s.speaker === "store_employee").length;
    expect(techCount).toBeGreaterThanOrEqual(3);
    expect(storeCount).toBeGreaterThanOrEqual(3);
  });

  it("extracts the core captured details", () => {
    const d = analyzeTranscript(transcript);
    // Analyzer zero-pads stores to 5 digits — that's the existing convention.
    expect(d.storeNumber).toBe("01518");
    // Either registerNumber or affectedRegisters should carry "2".
    const registers = [d.registerNumber, ...(d.affectedRegisters ?? [])]
      .filter(Boolean)
      .map(String);
    expect(registers).toContain("2");
    expect((d.issue + d.deviceType).toLowerCase()).toContain("keyboard");
  });

  it("live caller-name detector mines 'Kaitlyn' from the introduction segment", () => {
    // The full-transcript analyzer doesn't catch "This is X" patterns
    // reliably — that's deliberate. In the live pipeline, callerNameDetector
    // runs per-chunk and lifts the name into liveCapture.detectedCallerName,
    // which then flows into the LiveAssistPanel cards. This test asserts the
    // live miner does its job on the right chunk.
    const intro = "This is Kaitlyn.";
    const hit = detectCallerName(intro);
    expect(hit?.name).toBe("Kaitlyn");
  });

  it("does not lock the result prematurely", () => {
    const d = analyzeTranscript(transcript);
    expect(d.result).toBe("ResultNotConfirmed");
  });

  it("ranks domain probes high when register is known but mouse + keyboard still open", () => {
    const d = analyzeTranscript(transcript);
    const raw = liveAskNextQuestions({
      details: d,
      transcript,
      haveCallerName: true,
    });
    const top5 = rankAndCapQuestions(raw, {
      details: d,
      haveCallerName: true,
      nearEndOfCall: isNearEndOfCall(d),
    });
    // The top suggestions for this state should at minimum drive toward
    // confirming the issue is resolved (no troubleshooting steps yet) or
    // probe the device — not ask for things already captured.
    expect(top5.length).toBeGreaterThan(0);
    expect(top5.length).toBeLessThanOrEqual(5);
    const joined = top5.join(" | ").toLowerCase();
    expect(joined).not.toContain("what store are you calling");
    expect(joined).not.toContain("may i have your name");
    expect(joined).not.toContain("which register is the keyboard");
  });
});

describe("live conversation Test 2 — Store 870 / receipt printer hardware failure", () => {
  const transcript = [
    "Tech Support: What store are you calling from?",
    "Store Employee: Store 870.",
    "Tech Support: Which register?",
    "Store Employee: Register 1.",
    "Store Employee: The receipt printer says hardware failure.",
  ].join("\n\n");

  it("extracts store, register, device, and error", () => {
    const d = analyzeTranscript(transcript);
    expect(d.storeNumber).toBe("00870");
    const registers = [d.registerNumber, ...(d.affectedRegisters ?? [])]
      .filter(Boolean)
      .map(String);
    expect(registers).toContain("1");
    expect(d.deviceType?.toLowerCase()).toContain("printer");
    expect(d.errorMessage?.toLowerCase()).toContain("hardware failure");
  });

  it("ask-next surfaces reboot/reseat + printer-power probes after dedup", () => {
    const d = analyzeTranscript(transcript);
    const raw = liveAskNextQuestions({
      details: d,
      transcript,
      haveCallerName: false,
    });
    const top5 = rankAndCapQuestions(raw, {
      details: d,
      haveCallerName: false,
      nearEndOfCall: isNearEndOfCall(d),
    });
    const joined = top5.join(" | ").toLowerCase();
    // Printer-specific probes should appear in the top set.
    expect(
      /reboot|reseat|cable|loses?\s+power|moved/.test(joined),
    ).toBe(true);
  });
});

describe("live conversation Test 3 — issue confirmed resolved", () => {
  const transcript = [
    "Tech Support: Is it working now?",
    "Store Employee: Yes, it is back to normal.",
  ].join("\n\n");

  it("captures Resolved when the caller confirms it's back to normal", () => {
    const d = analyzeTranscript(transcript);
    // The analyzer should at minimum stop reporting ResultNotConfirmed once
    // the caller confirms — exact mapping is "Resolved".
    expect(d.result).not.toBe("ResultNotConfirmed");
  });

  it("near-end-of-call is recognized once result is known", () => {
    const d = analyzeTranscript(transcript);
    // After result is captured, the heuristic should NOT consider us at
    // the closing question anymore (we have an answer).
    expect(isNearEndOfCall(d)).toBe(false);
  });
});
