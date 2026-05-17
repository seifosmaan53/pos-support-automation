import { analyzeTranscriptFull } from "./transcriptAnalyzer";
import { generateTicketFields } from "./ticketFieldGenerator";
import { DEFAULT_CORRECTION_DICTIONARY, DEFAULT_WRITING_STYLE } from "../types/settings";
import type { TicketResult } from "../types/ticket";

export interface SelfTestExpected {
  storeNumber?: string;
  callerName?: string;
  callerNameContains?: string;
  registerNumber?: string;
  deviceType?: string;
  issueContains?: string;
  errorMessage?: string;
  stepsContains?: string[];
  result?: TicketResult;
  isResolved?: boolean;
  partNeeded?: boolean;
  partRequestContains?: string;
  subjectContains?: string;
  descriptionContains?: string;
  resolutionContains?: string;
  warningsContains?: string[];
  confidenceNotesContains?: string[];
  suggestedQuestionsContains?: string[];
}

export interface SelfTestCase {
  id: string;
  name: string;
  transcript: string;
  expected: SelfTestExpected;
}

export interface FieldCheckResult {
  field: string;
  ok: boolean;
  expected: string;
  actual: string;
}

export interface SelfTestResult {
  test: SelfTestCase;
  fieldChecks: FieldCheckResult[];
  passCount: number;
  failCount: number;
  passed: boolean;
  notes: string[];
}

export interface SelfTestSummary {
  results: SelfTestResult[];
  totalTests: number;
  passedTests: number;
  failedTests: number;
  totalFieldChecks: number;
  failedFieldChecks: number;
}

/**
 * 11 canonical transcripts from the spec. Each test asserts a few fields
 * by substring or exact match. Substring-style assertions are intentional —
 * we want to detect regressions without over-specifying wording.
 */
export const SELF_TEST_CASES: SelfTestCase[] = [
  {
    id: "test-01",
    name: "Store 433 internet down · Inseego · both registers online",
    transcript:
      "Store 433 called about the internet being down. I restarted the Inseego and both registers came back online.",
    expected: {
      storeNumber: "00433",
      deviceType: "Inseego",
      issueContains: "internet",
      stepsContains: ["restart"],
      result: "Resolved",
      isResolved: true,
      subjectContains: "433",
    },
  },
  {
    id: "test-02",
    name: "Store 395 internet down · Inseego · connections confirmed",
    transcript:
      "Store 395 called regarding the internet being down. I restarted the Inseego and confirmed the connections. Both registers are back online.",
    expected: {
      storeNumber: "00395",
      deviceType: "Inseego",
      stepsContains: ["restart"],
      result: "Resolved",
      isResolved: true,
    },
  },
  {
    id: "test-03",
    name: "Gift card transaction refund",
    transcript:
      "Store 712 called about a refund. The original transaction number is 12345678 and the customer wants the money back to the gift card.",
    expected: {
      storeNumber: "00712",
      issueContains: "refund",
    },
  },
  {
    id: "test-04",
    name: "Store 657 · Keyana · store closed vs terminal closed",
    transcript:
      "Keyana called from Store 657. The register says store closed instead of terminal closed. I renamed the cache on each register and restarted the Pro and COM services. Both registers are back online.",
    expected: {
      storeNumber: "00657",
      callerName: "Keyana",
      errorMessage: "store closed",
      stepsContains: ["renam"],
      result: "Resolved",
      isResolved: true,
    },
  },
  {
    id: "test-05",
    name: "Store 639 · Randa · Register 2 keyboard · bad power port",
    transcript:
      "Randa from Store 639 called regarding the keyboard on Register 2 not allowing her to type. I rebooted the register and reseated the cables, but the issue persists. There is a bad power supply port. A ticket will be opened to replace the keyboard.",
    expected: {
      storeNumber: "00639",
      callerName: "Randa",
      registerNumber: "2",
      deviceType: "keyboard",
      partNeeded: true,
      result: "PartsNeeded",
      partRequestContains: "keyboard",
    },
  },
  {
    id: "test-06",
    name: "Register 1 keyboard · transcription correction",
    transcript:
      "Store 482 called about registering one keyboard not working. The keyboard click is broken.",
    expected: {
      storeNumber: "00482",
      registerNumber: "1",
      deviceType: "keyboard",
      partNeeded: true,
    },
  },
  {
    id: "test-07",
    name: "Register 1 receipt printer hardware failure · replacement needed",
    transcript:
      "Store 1378 called about Register 1 receipt printer hardware failure. I rebooted the printer, reseated the cables, and tested it but the hardware failure persists. A replacement printer is needed.",
    expected: {
      storeNumber: "01378",
      registerNumber: "1",
      deviceType: "receipt printer",
      errorMessage: "hardware failure",
      partNeeded: true,
      result: "PartsNeeded",
      partRequestContains: "printer",
    },
  },
  {
    id: "test-08",
    name: "Part request · receipt printer power supply port bad",
    transcript:
      "Store 904 called about Register 2 receipt printer keeps losing power when moved. The bad power supply port is confirmed. Ticket will be opened to replace the printer.",
    expected: {
      storeNumber: "00904",
      registerNumber: "2",
      deviceType: "receipt printer",
      partNeeded: true,
      partRequestContains: "printer",
      result: "PartsNeeded",
    },
  },
  {
    id: "test-09",
    name: "Store 759 · PCF · incorrect employee ID",
    transcript:
      "Store 759 store manager called about an employee ID showing missing in PCF. Employee ID is A1234. I created the employee in PCF and confirmed the employee can now log in.",
    expected: {
      storeNumber: "00759",
      issueContains: "employee",
      stepsContains: ["creat"],
      result: "Resolved",
    },
  },
  {
    id: "test-10",
    name: "Store 1378 · Register 3 receipt printer hardware failure",
    transcript:
      "Store 1378 called about Register 3 receipt printer giving a hardware failure error message. The printer is no longer working. A replacement printer will be sent.",
    expected: {
      storeNumber: "01378",
      registerNumber: "3",
      deviceType: "receipt printer",
      errorMessage: "hardware failure",
      partNeeded: true,
    },
  },
  {
    id: "test-11",
    name: "Failure error · restart services · renamed cache",
    transcript:
      "Store 657 called about a failure error message on each register. I renamed the cache on each register and restarted the Pro and COM services. Both registers are back online.",
    expected: {
      storeNumber: "00657",
      stepsContains: ["renam", "restart"],
      result: "Resolved",
      isResolved: true,
    },
  },
  {
    id: "test-12",
    name: "Store 521 · Register 2 keyboard · power drain · no replacement",
    // The transcript intentionally contains the common mishearings
    // (story/story → store, wrist → register, power green → power drain) so
    // the test exercises the domain-repair pass before extraction. The store
    // employee answer to the name prompt is "Kayla" — that's what the
    // transcript actually has; the "needs review" warning prompts the agent
    // to confirm the spelling.
    transcript:
      "Hi, what story are you calling? Store 521. May I have your name? Kayla? How can I help you, Ms. Kayla? Which register is that? Register 2. Okay, so we're on Register 2, the keyboard. Can you move them up? Yeah. And what about the numbers? Can you type anything? Yeah. Okay. So that just means the keyboard has a short in it. So let's start by, since you can move the mouse, move the mouse to the bottom left and then start and hit shut down and then do a shut down on the wrist. Okay. Now, leave a shut down and go to the back and unplug the black power cable from the boxes. Okay. Now, I want you to go back to the front and hold the power button, the silver power button in the top right corner for 5 seconds. All right. Now, you can go back and connect the power cable again. Okay. After that, you can go back to the front and hit the silver power button. Yeah. So it should be coming on right now. It should be turning on. It takes about a minute. You're just going to make sure you go back into the POS and make sure you can log into the point of sale. No, this keyboard should not be replaced with this. We fixed it by doing a power green. All right. So the register should be back up. Can you, can you move the keyboard? Yes. Okay. Is there anything else I can help you with today? Have a great day.",
    expected: {
      storeNumber: "00521",
      callerNameContains: "Kayla",
      registerNumber: "2",
      deviceType: "keyboard",
      issueContains: "keyboard",
      stepsContains: ["shut down", "unplugged", "held", "power drain"],
      result: "Resolved",
      isResolved: true,
      partNeeded: false,
      subjectContains: "Register 2 Keyboard",
      resolutionContains: "power drain",
      confidenceNotesContains: ["may need review"],
    },
  },
];

export function runAllSelfTests(): SelfTestSummary {
  const results = SELF_TEST_CASES.map((tc) => runOneTest(tc));
  const passedTests = results.filter((r) => r.passed).length;
  const totalFieldChecks = results.reduce((acc, r) => acc + r.fieldChecks.length, 0);
  const failedFieldChecks = results.reduce((acc, r) => acc + r.failCount, 0);
  return {
    results,
    totalTests: results.length,
    passedTests,
    failedTests: results.length - passedTests,
    totalFieldChecks,
    failedFieldChecks,
  };
}

function runOneTest(tc: SelfTestCase): SelfTestResult {
  const analysis = analyzeTranscriptFull(tc.transcript, {
    correctionDictionary: DEFAULT_CORRECTION_DICTIONARY,
    enableTranscriptCorrection: true,
    enableNumberWordNormalization: true,
  });
  const fields = generateTicketFields({
    details: analysis.details,
    technicianName: "Self-test",
    writingStyle: { ...DEFAULT_WRITING_STYLE },
  });

  const checks: FieldCheckResult[] = [];

  if (tc.expected.storeNumber !== undefined) {
    checks.push(
      eq("storeNumber", tc.expected.storeNumber, analysis.details.storeNumber),
    );
  }
  if (tc.expected.callerName !== undefined) {
    checks.push(eq("callerName", tc.expected.callerName, analysis.details.callerName));
  }
  if (tc.expected.callerNameContains !== undefined) {
    checks.push(
      includes(
        "callerName",
        tc.expected.callerNameContains,
        analysis.details.callerName,
      ),
    );
  }
  if (tc.expected.registerNumber !== undefined) {
    checks.push(
      eq("registerNumber", tc.expected.registerNumber, analysis.details.registerNumber),
    );
  }
  if (tc.expected.deviceType !== undefined) {
    checks.push(
      includes("deviceType", tc.expected.deviceType, analysis.details.deviceType),
    );
  }
  if (tc.expected.issueContains !== undefined) {
    checks.push(includes("issue", tc.expected.issueContains, analysis.details.issue));
  }
  if (tc.expected.errorMessage !== undefined) {
    checks.push(
      includes(
        "errorMessage",
        tc.expected.errorMessage,
        analysis.details.errorMessage,
      ),
    );
  }
  if (tc.expected.stepsContains !== undefined) {
    const stepsJoined = analysis.details.steps.join(" ");
    for (const expected of tc.expected.stepsContains) {
      checks.push(includes(`stepsTaken·${expected}`, expected, stepsJoined));
    }
  }
  if (tc.expected.result !== undefined) {
    checks.push(eq("result", tc.expected.result, analysis.details.result));
  }
  if (tc.expected.isResolved !== undefined) {
    checks.push(
      eq(
        "isResolved",
        String(tc.expected.isResolved),
        String(analysis.details.isResolved),
      ),
    );
  }
  if (tc.expected.partNeeded !== undefined) {
    checks.push(
      eq("partNeeded", String(tc.expected.partNeeded), String(analysis.details.partNeeded)),
    );
  }
  if (tc.expected.partRequestContains !== undefined) {
    checks.push(
      includes(
        "partRequest",
        tc.expected.partRequestContains,
        fields.partRequest,
      ),
    );
  }
  if (tc.expected.subjectContains !== undefined) {
    checks.push(includes("subject", tc.expected.subjectContains, fields.subject));
  }
  if (tc.expected.descriptionContains !== undefined) {
    checks.push(
      includes("description", tc.expected.descriptionContains, fields.description),
    );
  }
  if (tc.expected.resolutionContains !== undefined) {
    checks.push(
      includes("resolution", tc.expected.resolutionContains, fields.resolution),
    );
  }
  if (tc.expected.warningsContains !== undefined) {
    const w = fields.missingInfoWarnings.join(" ");
    for (const expected of tc.expected.warningsContains) {
      checks.push(includes(`warnings·${expected}`, expected, w));
    }
  }
  if (tc.expected.confidenceNotesContains !== undefined) {
    const notes = analysis.details.confidenceNotes.join(" ");
    for (const expected of tc.expected.confidenceNotesContains) {
      checks.push(includes(`confidenceNotes·${expected}`, expected, notes));
    }
  }
  if (tc.expected.suggestedQuestionsContains !== undefined) {
    const q = fields.suggestedQuestions.join(" ");
    for (const expected of tc.expected.suggestedQuestionsContains) {
      checks.push(includes(`suggestedQuestions·${expected}`, expected, q));
    }
  }

  const passCount = checks.filter((c) => c.ok).length;
  const failCount = checks.length - passCount;
  return {
    test: tc,
    fieldChecks: checks,
    passCount,
    failCount,
    passed: failCount === 0 && checks.length > 0,
    notes: [],
  };
}

function eq(field: string, expected: string, actual: string): FieldCheckResult {
  return {
    field,
    expected,
    actual,
    ok: actual === expected,
  };
}

function includes(field: string, expected: string, actual: string): FieldCheckResult {
  return {
    field,
    expected: `(includes) ${expected}`,
    actual,
    ok: actual.toLowerCase().includes(expected.toLowerCase()),
  };
}
