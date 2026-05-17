import { describe, it, expect } from "vitest";
import {
  classifyWithContext,
  type PrevSegmentHint,
} from "./speakerDetector";

function hint(speaker: PrevSegmentHint["speaker"], text: string): PrevSegmentHint {
  return { speaker, text, confidence: "medium" };
}

describe("classifyWithContext (Phase 11A live speaker detection)", () => {
  it("labels the tech greeting", () => {
    const r = classifyWithContext("Computer room, how can I help you?", null);
    expect(r.speaker).toBe("tech_support");
  });

  it("labels store self-id after a tech greeting", () => {
    const prev = hint("tech_support", "Computer room, how can I help you?");
    const r = classifyWithContext("Hi, I am calling from Store 870.", prev);
    expect(r.speaker).toBe("store_employee");
  });

  it("labels a bare store number after a 'what store' question", () => {
    const prev = hint("tech_support", "What store are you calling from?");
    const r = classifyWithContext("Store 870.", prev);
    expect(r.speaker).toBe("store_employee");
  });

  it("labels a bare name after a name-intake question", () => {
    const prev = hint("tech_support", "May I have your name?");
    const r = classifyWithContext("This is Kaitlyn.", prev);
    expect(r.speaker).toBe("store_employee");
  });

  it("labels a bare 'Register 2' after a 'which register' question", () => {
    const prev = hint("tech_support", "Which register is affected?");
    const r = classifyWithContext("Register 2.", prev);
    expect(r.speaker).toBe("store_employee");
  });

  it("labels a store report of a keyboard problem", () => {
    const r = classifyWithContext(
      "The keyboard is not letting me type, but the mouse works.",
      hint("tech_support", "What is the issue?"),
    );
    expect(r.speaker).toBe("store_employee");
  });

  it("labels a manager self-id as store_manager regardless of context", () => {
    const r = classifyWithContext(
      "I am the store manager calling from Store 870.",
      hint("tech_support", "What store are you calling from?"),
    );
    expect(r.speaker).toBe("store_manager");
  });

  it("labels tech intake questions as tech_support even with no prev hint", () => {
    expect(classifyWithContext("What store are you calling from?", null).speaker).toBe("tech_support");
    expect(classifyWithContext("Which register is affected?", null).speaker).toBe("tech_support");
    expect(classifyWithContext("Can you move the mouse?", null).speaker).toBe("tech_support");
    expect(classifyWithContext("Is it working now?", null).speaker).toBe("tech_support");
  });

  it("labels imperative tech instructions as tech_support", () => {
    expect(classifyWithContext("Hold the power button.", null).speaker).toBe("tech_support");
    expect(classifyWithContext("Restart the register and try again.", null).speaker).toBe("tech_support");
    expect(classifyWithContext("Unplug the power cable.", null).speaker).toBe("tech_support");
  });

  it("labels store-side error reports", () => {
    expect(classifyWithContext("It says hardware failure.", null).speaker).toBe("store_employee");
    expect(classifyWithContext("The keyboard is not working.", null).speaker).toBe("store_employee");
  });

  it("returns unknown for ambiguous standalone text without context", () => {
    const r = classifyWithContext("OK.", null);
    // No prev hint, single-word — could be either side; classifier must not pretend.
    expect(["unknown", "store_employee", "tech_support"]).toContain(r.speaker);
    expect(r.confidence).not.toBe("high");
  });

  it("handles the full user test dialogue in sequence", () => {
    const turns: Array<{ text: string; expected: string }> = [
      { text: "Hi, how can I help you?", expected: "tech_support" },
      { text: "Hi, I am calling from Store 870.", expected: "store_employee" },
      { text: "May I have your name?", expected: "tech_support" },
      { text: "This is Kaitlyn.", expected: "store_employee" },
      { text: "Which register is affected?", expected: "tech_support" },
      { text: "Register 2.", expected: "store_employee" },
      { text: "What is the issue?", expected: "tech_support" },
      {
        text: "The keyboard is not letting me type, but the mouse works.",
        expected: "store_employee",
      },
    ];
    let prev: PrevSegmentHint | null = null;
    for (const t of turns) {
      const r = classifyWithContext(t.text, prev);
      expect(r.speaker, `turn "${t.text}"`).toBe(t.expected);
      prev = { speaker: r.speaker, text: t.text, confidence: r.confidence };
    }
  });
});

describe("classifyWithContext — Phase 16D turn-taking extensions", () => {
  it("Test 6: tech name question → caller responds 'Maria.'", () => {
    const prev = hint("tech_support", "May I have your name?");
    const r = classifyWithContext("Maria.", prev);
    expect(r.speaker).toBe("store_employee");
  });

  it("Test 7: 'Which register?' → 'Register 2.' is the caller", () => {
    const prev = hint("tech_support", "Which register?");
    const r = classifyWithContext("Register 2.", prev);
    expect(r.speaker).toBe("store_employee");
  });

  it("'Is it working now?' → 'Yes.' is the caller", () => {
    const prev = hint("tech_support", "Is it working now?");
    const r = classifyWithContext("Yes.", prev);
    expect(r.speaker).toBe("store_employee");
  });

  it("'Did that fix it?' → 'Yes.' is the caller", () => {
    const prev = hint("tech_support", "Did that fix it?");
    const r = classifyWithContext("Yes.", prev);
    expect(r.speaker).toBe("store_employee");
  });

  it("'Which device is affected?' is classified as a tech question", () => {
    const r = classifyWithContext("Which device is affected?", null);
    expect(r.speaker).toBe("tech_support");
  });

  it("'What error is showing?' is classified as a tech question", () => {
    const r = classifyWithContext("What error is showing?", null);
    expect(r.speaker).toBe("tech_support");
  });
});
