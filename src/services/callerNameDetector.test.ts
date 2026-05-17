import { describe, expect, it } from "vitest";
import {
  detectCallerName,
  detectCallerNameFromAnswer,
  detectCallerNameInSequence,
  detectCallerNameInText,
} from "./callerNameDetector";

// Tests use a variety of first names (Maria, David, Angela, Rebecca, John,
// Sarah, Marco, Priya, Carlos, Olivia, …) deliberately. The detector is
// pattern-based — it should work for ANY normal first name, not a list.

describe("detectCallerNameInText (inline patterns)", () => {
  it("picks up 'This is X.' — varied first names", () => {
    for (const n of ["Maria", "David", "Angela", "Priya", "Olivia"]) {
      expect(detectCallerNameInText(`This is ${n}.`)).toMatchObject({
        name: n,
        confidence: "high",
      });
    }
  });

  it("picks up 'My name is X.'", () => {
    expect(detectCallerNameInText("My name is Sarah.")).toMatchObject({
      name: "Sarah",
      confidence: "high",
    });
  });

  it("picks up 'X from Store NNN.' as the caller name", () => {
    expect(
      detectCallerNameInText("This is Angela from Store 1518."),
    ).toMatchObject({ name: "Angela", confidence: "high" });
  });

  it("picks up role-paired 'I'm the store manager, X.'", () => {
    const hit = detectCallerNameInText("I'm the store manager, Rebecca.");
    expect(hit).toMatchObject({
      name: "Rebecca",
      confidence: "high",
      role: "Store Manager",
    });
  });

  it("picks up 'I'm the manager, X.' without the 'store' prefix", () => {
    const hit = detectCallerNameInText("I'm the manager, Carlos.");
    expect(hit?.name).toBe("Carlos");
    expect(hit?.role).toBe("Store Manager");
  });

  it("picks up 'speaking with X.'", () => {
    expect(
      detectCallerNameInText("You're speaking with Jasmine."),
    ).toMatchObject({ name: "Jasmine", confidence: "high" });
  });

  it("does NOT match 'I'm calling from Store 1518.'", () => {
    expect(detectCallerNameInText("Hi, I'm calling from Store 1518.")).toBeNull();
  });

  it("does NOT match 'I am the manager here.' (no trailing name)", () => {
    expect(detectCallerNameInText("I am the manager here.")).toBeNull();
  });

  it("does NOT match a stop-name like 'Register' even with right shape", () => {
    expect(detectCallerNameInText("This is register 2.")).toBeNull();
    expect(detectCallerNameInText("This is the keyboard.")).toBeNull();
  });

  it("does NOT match brand or product nouns", () => {
    expect(detectCallerNameInText("This is the VeriFone speaking.")).toBeNull();
    expect(detectCallerNameInText("This is the receipt printer.")).toBeNull();
  });

  it("captures 'I'm X' at medium confidence", () => {
    expect(detectCallerNameInText("I'm Marco.")).toMatchObject({
      name: "Marco",
      confidence: "medium",
    });
  });

  it("demotes to review_needed when name has '?' near it", () => {
    expect(detectCallerNameInText("This is Kayla?")).toMatchObject({
      confidence: "review_needed",
    });
  });

  it("handles hyphenated names", () => {
    expect(detectCallerNameInText("This is Mary-Anne.")?.name).toBe("Mary-Anne");
  });

  it("title-cases lowercase input", () => {
    expect(detectCallerNameInText("my name is sarah")?.name).toBe("Sarah");
  });

  it("returns null for empty / no naming phrase", () => {
    expect(detectCallerNameInText("")).toBeNull();
    expect(detectCallerNameInText("Register 2 is not working.")).toBeNull();
  });
});

describe("detectCallerNameFromAnswer (Q→A pair)", () => {
  it("'May I have your name?' → 'Maria.' → high", () => {
    const hit = detectCallerNameFromAnswer("May I have your name?", "Maria.");
    expect(hit).toMatchObject({ name: "Maria", confidence: "high" });
  });

  it("'Can I get your name?' → 'David.' → high", () => {
    const hit = detectCallerNameFromAnswer("Can I get your name?", "David.");
    expect(hit?.name).toBe("David");
  });

  it("'Who am I speaking with?' → 'This is David.' → high", () => {
    const hit = detectCallerNameFromAnswer(
      "Who am I speaking with?",
      "This is David.",
    );
    expect(hit).toMatchObject({ name: "David", confidence: "high" });
  });

  it("'What's your name?' → 'Olivia.' → high", () => {
    const hit = detectCallerNameFromAnswer("What's your name?", "Olivia.");
    expect(hit?.name).toBe("Olivia");
  });

  it("does NOT treat 'Store 870.' as a caller name", () => {
    const hit = detectCallerNameFromAnswer("Can I get your name?", "Store 870.");
    expect(hit).toBeNull();
  });

  it("does NOT treat 'Register 2.' as a caller name", () => {
    const hit = detectCallerNameFromAnswer("May I have your name?", "Register 2.");
    expect(hit).toBeNull();
  });

  it("does NOT treat 'Yes.' / 'No.' as a caller name", () => {
    expect(
      detectCallerNameFromAnswer("Can I get your name?", "Yes."),
    ).toBeNull();
    expect(
      detectCallerNameFromAnswer("Can I get your name?", "No, thank you."),
    ).toBeNull();
  });

  it("captures first + last name when both look like names", () => {
    const hit = detectCallerNameFromAnswer("May I have your name?", "Priya Patel.");
    expect(hit?.name).toBe("Priya Patel");
  });

  it("strips honorifics: 'Ms. Anita.' → 'Anita'", () => {
    const hit = detectCallerNameFromAnswer("May I have your name?", "Ms. Anita.");
    expect(hit?.name).toBe("Anita");
  });

  it("demotes to review_needed when the answer ends with '?'", () => {
    const hit = detectCallerNameFromAnswer("May I have your name?", "Kayla?");
    expect(hit?.confidence).toBe("review_needed");
  });

  it("returns null when the tech segment is NOT a name question", () => {
    expect(detectCallerNameFromAnswer("Which register?", "Maria.")).toBeNull();
  });
});

describe("detectCallerNameInSequence (multi-turn)", () => {
  it("walks tech-then-caller turn-taking", () => {
    const hit = detectCallerNameInSequence([
      { side: "tech", text: "May I have your name?" },
      { side: "caller", text: "Maria." },
    ]);
    expect(hit?.name).toBe("Maria");
  });

  it("uses the LATER hit when two introductions appear (caller corrects themselves)", () => {
    const hit = detectCallerNameInSequence([
      { side: "caller", text: "I'm Mark." },
      { side: "caller", text: "Sorry, my name is Markus." },
    ]);
    expect(hit?.name).toBe("Markus");
  });

  it("ignores tech-side inline matches (the tech isn't the caller)", () => {
    const hit = detectCallerNameInSequence([
      // Tech might say "Hi, this is Tech Support" — that's NOT the caller name.
      { side: "tech", text: "Hi, this is support." },
      { side: "caller", text: "Register 2." },
    ]);
    expect(hit).toBeNull();
  });

  it("works on unknown-side sentence streams (final analyzer path)", () => {
    const hit = detectCallerNameInSequence([
      { side: "unknown", text: "May I have your name?" },
      { side: "unknown", text: "This is Olivia." },
    ]);
    expect(hit?.name).toBe("Olivia");
  });

  it("returns null when nothing reliable lands across all turns", () => {
    const hit = detectCallerNameInSequence([
      { side: "tech", text: "Can I get your name?" },
      { side: "caller", text: "Store 870." },
      { side: "tech", text: "Which register?" },
      { side: "caller", text: "Register 2." },
    ]);
    expect(hit).toBeNull();
  });
});

// ── Phase 11B spec acceptance ──────────────────────────────────────
// These mirror the 7 numbered test cases from the spec (case 8 — user
// correction — is tested at the appStore action level, not here).

describe("Phase 11B spec acceptance", () => {
  it("Case 1: 'May I have your name?' → 'Maria.' → callerName=Maria", () => {
    const hit = detectCallerNameFromAnswer("May I have your name?", "Maria.");
    expect(hit?.name).toBe("Maria");
  });

  it("Case 2: 'Who am I speaking with?' → 'This is David.' → callerName=David", () => {
    const hit = detectCallerNameFromAnswer(
      "Who am I speaking with?",
      "This is David.",
    );
    expect(hit?.name).toBe("David");
  });

  it("Case 3: 'This is Angela from Store 1518.' → callerName=Angela", () => {
    expect(detectCallerNameInText("This is Angela from Store 1518.")?.name).toBe("Angela");
  });

  it("Case 4: 'I'm the store manager, Rebecca.' → name + role", () => {
    const hit = detectCallerNameInText("I'm the store manager, Rebecca.");
    expect(hit?.name).toBe("Rebecca");
    expect(hit?.role).toBe("Store Manager");
  });

  it("Case 5: 'Can I get your name?' → 'Store 870.' → null", () => {
    expect(
      detectCallerNameFromAnswer("Can I get your name?", "Store 870."),
    ).toBeNull();
  });

  it("Case 6: 'Register 2.' standalone → null", () => {
    expect(detectCallerName("Register 2.")).toBeNull();
  });

  it("Case 7: 'The keyboard is not working.' → null", () => {
    expect(detectCallerName("The keyboard is not working.")).toBeNull();
  });
});
