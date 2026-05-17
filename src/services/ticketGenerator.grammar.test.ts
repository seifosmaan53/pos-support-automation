import { describe, expect, it } from "vitest";
import { EMPTY_DETAILS, type ExtractedDetails } from "../types/ticket";
import { DEFAULT_WRITING_STYLE } from "../types/settings";
import { generateTicket } from "./ticketGenerator";
import { buildDescription, buildResolution } from "./ticketFieldGenerator";
import {
  isClause,
  isNounPhrase,
  issueToDescriptionOpening,
  normalizeIssuePhrase,
  normalizeSentenceCase,
  normalizeTroubleshootingStep,
} from "../utils/cleanText";

function detailsOf(overrides: Partial<ExtractedDetails>): ExtractedDetails {
  return { ...EMPTY_DETAILS, ...overrides };
}

const PASSIVE_STYLE = { ...DEFAULT_WRITING_STYLE, voice: "passive" } as const;

// ─────────────────────────────────────────────────────────
// Helper-level invariants
// ─────────────────────────────────────────────────────────

describe("normalizeSentenceCase", () => {
  it("lowercases mid-sentence text but preserves protected acronyms", () => {
    expect(normalizeSentenceCase("Credit card machine issue")).toBe(
      "credit card machine issue",
    );
    expect(normalizeSentenceCase("USB cable problem")).toBe("USB cable problem");
    expect(normalizeSentenceCase("VeriFone failure on POS")).toBe(
      "VeriFone failure on POS",
    );
  });
});

describe("normalizeIssuePhrase", () => {
  it("strips leading articles and normalizes case", () => {
    expect(normalizeIssuePhrase("The Credit card machine issue")).toBe(
      "credit card machine issue",
    );
    expect(normalizeIssuePhrase("a Keyboard Problem")).toBe("keyboard problem");
    expect(normalizeIssuePhrase("internet down")).toBe("internet down");
  });
});

describe("isNounPhrase / isClause", () => {
  it("detects 'X issue/problem/error/glitch/failure' as noun phrases", () => {
    expect(isNounPhrase("credit card machine issue")).toBe(true);
    expect(isNounPhrase("keyboard issue")).toBe(true);
    expect(isNounPhrase("receipt printer hardware failure")).toBe(true);
    expect(isClause("credit card machine issue")).toBe(false);
  });
  it("detects clauses with finite verbs", () => {
    expect(isClause("the keyboard was not working")).toBe(true);
    expect(isClause("the registers were displaying store closed")).toBe(true);
    expect(isClause("internet down")).toBe(true); // state adjective counts
    expect(isNounPhrase("the keyboard was not working")).toBe(false);
  });
});

describe("normalizeTroubleshootingStep", () => {
  it("rewrites escape→exit and adds missing 'the' before bare nouns", () => {
    expect(normalizeTroubleshootingStep("escaped out of the transaction")).toBe(
      "exited out of the transaction",
    );
    expect(normalizeTroubleshootingStep("advised store to wait one second")).toBe(
      "advised the store to wait one second",
    );
    expect(
      normalizeTroubleshootingStep("had her restart the modem"),
    ).toBe("restart the modem");
  });
});

describe("issueToDescriptionOpening", () => {
  it("uses 'called regarding a/an {NP}' for noun-phrase issues", () => {
    expect(
      issueToDescriptionOpening("Berry from Store 523", "Credit card machine issue"),
    ).toBe("Berry from Store 523 called regarding a credit card machine issue.");
    expect(issueToDescriptionOpening("Store 521", "keyboard issue")).toBe(
      "Store 521 called regarding a keyboard issue.",
    );
  });
  it("uses 'called reporting that the {clause}' for clause issues", () => {
    expect(
      issueToDescriptionOpening(
        "Store 521",
        "the keyboard on Register 2 was not working",
      ),
    ).toBe(
      "Store 521 called reporting that the keyboard on Register 2 was not working.",
    );
  });
  it("inserts a copula for bare-state clauses (internet down)", () => {
    expect(issueToDescriptionOpening("Store 395", "internet down")).toBe(
      "Store 395 called reporting that the internet was down.",
    );
  });
  it("never produces the broken hybrid 'reporting that the X issue'", () => {
    const out = issueToDescriptionOpening(
      "Berry from Store 523",
      "Credit card machine issue",
    );
    expect(out).not.toMatch(/reporting that the .* issue/i);
    expect(out).not.toMatch(/the Credit card/);
  });
});

// ─────────────────────────────────────────────────────────
// Canonical case from the bug report (Berry / Store 523)
// ─────────────────────────────────────────────────────────

const berry = detailsOf({
  callerName: "Berry",
  storeNumber: "523",
  issue: "Credit card machine issue",
  steps: [
    "escaped out of the transaction",
    "re-entered the transaction from the beginning",
    "advised store to wait one second between key presses",
  ],
  result: "Resolved",
});

describe("Berry / Store 523 — credit card machine issue", () => {
  it("Normal summary uses 'called regarding a credit card machine issue' (NP form)", () => {
    const normal = generateTicket({ detailLevel: "Normal", details: berry });
    expect(normal).toBe(
      "Berry from Store 523 called regarding a credit card machine issue. " +
        "Troubleshooting included exiting out of the transaction, " +
        "re-entering the transaction from the beginning, and advising the store " +
        "to wait one second between key presses. " +
        "The issue was confirmed resolved.",
    );
  });
  it("Description matches the spec — no broken patterns", () => {
    const description = buildDescription(berry, PASSIVE_STYLE);
    expect(description).toBe(
      "Berry from Store 523 called regarding a credit card machine issue. " +
        "Troubleshooting included exiting out of the transaction, " +
        "re-entering the transaction from the beginning, and advising the store " +
        "to wait one second between key presses. " +
        "The issue was confirmed resolved.",
    );
    expect(description).not.toMatch(/reporting that the credit card machine issue/i);
    expect(description).not.toMatch(/escaped out of/);
    expect(description).not.toMatch(/advised store to wait/);
    expect(description).not.toMatch(/the Credit card/);
  });
  it("Resolution past-tenses every step and ends with the verdict", () => {
    const resolution = buildResolution(berry, DEFAULT_WRITING_STYLE);
    expect(resolution).toBe(
      "Exited out of the transaction, re-entered the transaction from the beginning, " +
        "and advised the store to wait one second between key presses. " +
        "The issue was confirmed resolved.",
    );
  });
});

// ─────────────────────────────────────────────────────────
// Additional cases the user listed
// ─────────────────────────────────────────────────────────

describe("Store 521 — keyboard issue", () => {
  it("Normal opener uses 'called regarding a keyboard issue on Register 2'", () => {
    const d = detailsOf({
      storeNumber: "521",
      registerNumber: "2",
      issue: "keyboard issue",
      result: "Resolved",
    });
    const normal = generateTicket({ detailLevel: "Normal", details: d });
    expect(normal).toContain(
      "Store 521 called regarding a keyboard issue on Register 2.",
    );
  });
});

describe("Store 1378 — receipt printer hardware failure", () => {
  it("treats 'hardware failure' as a noun phrase tail", () => {
    const d = detailsOf({
      storeNumber: "1378",
      registerNumber: "3",
      issue: "receipt printer hardware failure",
      result: "Resolved",
    });
    const normal = generateTicket({ detailLevel: "Normal", details: d });
    expect(normal).toContain(
      "Store 1378 called regarding a receipt printer hardware failure on Register 3.",
    );
  });
});

describe("Store 657 — store closed message after start of day", () => {
  it("treats a clause with 'displaying' as a clause and uses 'reporting that'", () => {
    const d = detailsOf({
      storeNumber: "657",
      issue: 'the registers were displaying "store closed" after start of day',
      result: "Resolved",
    });
    const normal = generateTicket({ detailLevel: "Normal", details: d });
    expect(normal).toContain(
      'Store 657 called reporting that the registers were displaying "store closed" after start of day.',
    );
  });
});

describe("Store 395 — internet down", () => {
  it("inserts a copula for the bare-state clause", () => {
    const d = detailsOf({
      storeNumber: "395",
      issue: "internet down",
      result: "Resolved",
    });
    const normal = generateTicket({ detailLevel: "Normal", details: d });
    expect(normal).toContain(
      "Store 395 called reporting that the internet was down.",
    );
  });
});
