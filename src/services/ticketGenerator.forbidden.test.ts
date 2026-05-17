import { describe, expect, it } from "vitest";
import { EMPTY_DETAILS, type ExtractedDetails } from "../types/ticket";
import { DEFAULT_WRITING_STYLE } from "../types/settings";
import { generateTicket } from "./ticketGenerator";
import {
  buildDescription,
  buildPartRequest,
  buildResolution,
  buildSubject,
} from "./ticketFieldGenerator";
import { generateAllSummaries } from "./summaryGenerator";
import {
  FORBIDDEN_PHRASES,
  RESULT_GATED_FORBIDDEN_PHRASES,
} from "./writingRules";

/**
 * Phase 10D — Forbidden-phrase regression net.
 *
 * Sweeps a representative matrix of ExtractedDetails through every text
 * output the app emits (subject, description, resolution, partRequest, all
 * five generateTicket detail levels, and the summary set) and fails if any
 * banned phrase from {@link FORBIDDEN_PHRASES} survives.
 *
 * The scenarios are deliberately broader than the goldens because forbidden
 * patterns are negative assertions — they need to be exercised against many
 * shapes of input to be a real safety net.
 */

const PASSIVE = { ...DEFAULT_WRITING_STYLE, voice: "passive" } as const;

function detailsOf(over: Partial<ExtractedDetails>): ExtractedDetails {
  return { ...EMPTY_DETAILS, ...over };
}

interface Scenario {
  name: string;
  details: ExtractedDetails;
}

const SCENARIOS: Scenario[] = [
  {
    name: "Berry / Store 523 / credit card machine issue",
    details: detailsOf({
      callerName: "Berry",
      storeNumber: "523",
      issue: "Credit card machine issue",
      steps: [
        "escaped out of the transaction",
        "re-entered the transaction from the beginning",
        "advised store to wait one second between key presses",
      ],
      result: "Resolved",
    }),
  },
  {
    name: "Store 521 / keyboard issue / power drain",
    details: detailsOf({
      storeNumber: "521",
      registerNumber: "2",
      issue: "keyboard issue",
      deviceType: "keyboard",
      powerDrainPerformed: true,
      cablesReseated: true,
      confirmationMethod: "Keyboard confirmed working",
      result: "Resolved",
    }),
  },
  {
    name: "Store 1378 / receipt printer hardware failure / parts needed",
    details: detailsOf({
      storeNumber: "1378",
      registerNumber: "3",
      issue: "receipt printer hardware failure",
      deviceType: "receipt printer",
      errorMessage: "hardware failure",
      partNeeded: true,
      parts: ["receipt printer"],
      replacementReason: "hardware failure persisted after troubleshooting",
      result: "PartsNeeded",
    }),
  },
  {
    name: "Store 657 / store closed clause issue",
    details: detailsOf({
      storeNumber: "657",
      issue: 'the registers were displaying "store closed" after start of day',
      cacheRenamed: true,
      affectedRegisters: ["both registers"],
      confirmationMethod: "Both registers back online",
      result: "Resolved",
    }),
  },
  {
    name: "Store 395 / internet down / Inseego",
    details: detailsOf({
      storeNumber: "395",
      issue: "internet down",
      devices: ["Inseego"],
      manualRebootPerformed: true,
      confirmationMethod: "Connection restored",
      result: "Resolved",
    }),
  },
  {
    name: "Store 204 / receipt printer replacement",
    details: detailsOf({
      storeNumber: "204",
      registerNumber: "1",
      issue: "receipt printer not printing after troubleshooting",
      deviceType: "receipt printer",
      cablesReseated: true,
      manualRebootPerformed: true,
      partNeeded: true,
      parts: ["receipt printer"],
      replacementReason: "printer still did not print after reseating cables and rebooting",
      result: "PartsNeeded",
    }),
  },
  {
    name: "Store 812 / return processed as exchange",
    details: detailsOf({
      storeNumber: "812",
      issue: "return processed as exchange in error",
      typeOfTransaction: "Return",
      transactionNumber: "112233",
      itemNumber: "44556",
      paymentType: "Card",
      steps: ["reviewed the transaction", "voided the exchange and re-rang the return"],
      confirmationMethod: "Confirmed back to normal",
      result: "Resolved",
    }),
  },
  {
    name: "Store 311 / layaway return error / follow-up required",
    details: detailsOf({
      storeNumber: "311",
      issue: "layaway return error",
      typeOfTransaction: "Layaway",
      transactionNumber: "778899",
      errorMessage: "layaway not found",
      steps: ["verified the layaway in the system", "advised store to retry the return"],
      result: "FollowUpRequired",
      followUpNeeded: true,
      storeWasAdvised: "call back if the error persists",
    }),
  },
  {
    name: "Store 118 / BOS stuck adding employee / pending",
    details: detailsOf({
      storeNumber: "118",
      issue: "BOS stuck while adding a new employee",
      systems: ["BOS"],
      employeeName: "Jane Doe",
      steps: ["had the manager log out and back in", "cleared browser cache"],
      result: "Pending",
    }),
  },
  {
    name: "Store 402 / wrong operator ID",
    details: detailsOf({
      storeNumber: "402",
      issue: "wrong operator ID assigned to a transaction",
      employeeId: "EMP-44",
      operatorId: "OP-09",
      steps: ["verified the operator ID in PCF", "corrected the operator ID on the transaction"],
      confirmationMethod: "Confirmed back to normal",
      result: "Resolved",
    }),
  },
  {
    name: "Store 907 / VeriFone not responding",
    details: detailsOf({
      storeNumber: "907",
      registerNumber: "2",
      issue: "VeriFone not responding on Register 2",
      deviceType: "VeriFone",
      cablesReseated: true,
      manualRebootPerformed: true,
      confirmationMethod: "Successful card transaction",
      result: "Resolved",
    }),
  },
  {
    name: "Store 555 / gift card refund failed",
    details: detailsOf({
      storeNumber: "555",
      issue: "gift card refund failed at the register",
      typeOfTransaction: "Refund",
      paymentType: "Gift Card",
      transactionNumber: "GC-991122",
      errorMessage: "card declined",
      steps: ["verified the gift card balance", "advised store to retry the refund"],
      result: "Pending",
      followUpNeeded: true,
    }),
  },
  // Edge case: Resolved with no confirmation — must not invent a confirmation.
  {
    name: "Store 9 / printer issue / Resolved with no confirmation",
    details: detailsOf({
      storeNumber: "9",
      registerNumber: "2",
      issue: "receipt printer issue",
      deviceType: "receipt printer",
      steps: ["restarted the POS", "ran a test print"],
      result: "Resolved",
    }),
  },
  // Edge case: Escalated — must NOT say "issue was resolved".
  {
    name: "Store 22 / internet escalated",
    details: detailsOf({
      storeNumber: "22",
      issue: "internet down",
      manualRebootPerformed: true,
      result: "Escalated",
    }),
  },
  // Edge case: ResultNotConfirmed — must NOT say "issue was resolved".
  {
    name: "Store 5 / scanner / result not confirmed",
    details: detailsOf({
      storeNumber: "5",
      issue: "scanner not reading barcodes",
      deviceType: "scanner",
      cablesReseated: true,
      result: "ResultNotConfirmed",
    }),
  },
];

/**
 * Pull every text output the app emits for a single details record. Returns
 * an array of [label, text] tuples so a test failure points at the exact
 * field that violates the rule.
 */
function collectAllOutputs(d: ExtractedDetails): Array<[string, string]> {
  const subject = buildSubject(d);
  const description = buildDescription(d, PASSIVE);
  const resolution = buildResolution(d, DEFAULT_WRITING_STYLE);
  const partRequest = buildPartRequest(d);
  const summaries = generateAllSummaries({
    transcript: "",
    details: d,
    cleanedTranscript: "",
  });
  return [
    ["subject", subject],
    ["description", description],
    ["resolution", resolution],
    ["partRequest", partRequest],
    ["short", generateTicket({ detailLevel: "Short", details: d })],
    ["normal", generateTicket({ detailLevel: "Normal", details: d })],
    ["detailed", generateTicket({ detailLevel: "Detailed", details: d })],
    ["technical", generateTicket({ detailLevel: "Technical", details: d })],
    ["management", generateTicket({ detailLevel: "ManagementSummary", details: d })],
    ["summary.short", summaries.short],
    ["summary.normal", summaries.normal],
    ["summary.detailed", summaries.detailed],
    ["summary.technical", summaries.technical],
    ["summary.management", summaries.management],
    ["summary.cleanSummary", summaries.cleanSummary],
  ];
}

describe("No forbidden phrases in any generated output", () => {
  for (const scenario of SCENARIOS) {
    it(`scenario: ${scenario.name}`, () => {
      const outputs = collectAllOutputs(scenario.details);
      for (const [label, text] of outputs) {
        for (const { pattern, description } of FORBIDDEN_PHRASES) {
          if (pattern.test(text)) {
            throw new Error(
              `Forbidden phrase in ${label} for "${scenario.name}":\n` +
                `  Rule: ${description}\n` +
                `  Pattern: ${pattern}\n` +
                `  Text: ${text}`,
            );
          }
        }
        for (const { pattern, description, appliesWhen } of RESULT_GATED_FORBIDDEN_PHRASES) {
          if (
            appliesWhen({
              result: scenario.details.result,
              partNeeded: scenario.details.partNeeded,
            }) &&
            pattern.test(text)
          ) {
            throw new Error(
              `Result-gated forbidden phrase in ${label} for "${scenario.name}":\n` +
                `  Rule: ${description}\n` +
                `  Pattern: ${pattern}\n` +
                `  Text: ${text}`,
            );
          }
        }
      }
    });
  }
});

describe("Forbidden-phrase patterns are wired up correctly", () => {
  it("rejects the canonical Berry-broken hybrid in a probe string", () => {
    const probe = "Berry from Store 523 called reporting that the credit card machine issue was resolved.";
    const hits = FORBIDDEN_PHRASES.filter(({ pattern }) => pattern.test(probe));
    expect(hits.length).toBeGreaterThan(0);
  });

  it("rejects 'escaped out of' in a probe string", () => {
    const probe = "Troubleshooting included escaped out of the transaction.";
    const hits = FORBIDDEN_PHRASES.filter(({ pattern }) => pattern.test(probe));
    expect(hits.length).toBeGreaterThan(0);
  });

  it("rejects 'story' (ASR mishearing of 'store') in a probe string", () => {
    const probe = "Story 9 called about a printer issue.";
    const hits = FORBIDDEN_PHRASES.filter(({ pattern }) => pattern.test(probe));
    expect(hits.length).toBeGreaterThan(0);
  });

  it("rejects 'power green' (ASR mishearing of 'power drain') in a probe string", () => {
    const probe = "Performed a power green on Register 2.";
    const hits = FORBIDDEN_PHRASES.filter(({ pattern }) => pattern.test(probe));
    expect(hits.length).toBeGreaterThan(0);
  });

  it("flags 'issue was resolved' for a non-Resolved result", () => {
    const probe = "The issue was resolved by the on-call.";
    const gated = RESULT_GATED_FORBIDDEN_PHRASES.filter(
      ({ pattern, appliesWhen }) =>
        appliesWhen({ result: "Escalated", partNeeded: false }) && pattern.test(probe),
    );
    expect(gated.length).toBeGreaterThan(0);
  });

  it("does NOT flag 'issue was resolved' for a Resolved result", () => {
    const probe = "The issue was resolved.";
    const gated = RESULT_GATED_FORBIDDEN_PHRASES.filter(
      ({ pattern, appliesWhen }) =>
        appliesWhen({ result: "Resolved", partNeeded: false }) && pattern.test(probe),
    );
    expect(gated.length).toBe(0);
  });
});
