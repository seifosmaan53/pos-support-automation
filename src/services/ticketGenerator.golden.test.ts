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

/**
 * Phase 10D — Golden Ticket Examples.
 *
 * Twelve canonical scenarios with full expected output for every field the
 * UI presents (subject, description, resolution, all five generateTicket
 * detail levels, and part request when applicable). Failure of any single
 * assertion means the writing voice has drifted — fix the generator first,
 * not the expectation.
 *
 * Description is asserted in PASSIVE voice ("Troubleshooting included …")
 * because that's the canonical ticket-writing form. The active-first-person
 * voice ("I {pasts}.") is exercised by ticketGenerator.grammar.test.ts.
 */

const PASSIVE = { ...DEFAULT_WRITING_STYLE, voice: "passive" } as const;
const ACTIVE = DEFAULT_WRITING_STYLE;

function detailsOf(over: Partial<ExtractedDetails>): ExtractedDetails {
  return { ...EMPTY_DETAILS, ...over };
}

interface GoldenAssertion {
  subject: string;
  description: string;
  resolution: string;
  short: string;
  normal: string;
  detailed: string;
  technical: string;
  management: string;
  partRequest?: string;
}

function assertGolden(d: ExtractedDetails, expected: GoldenAssertion) {
  expect(buildSubject(d), "subject").toBe(expected.subject);
  expect(buildDescription(d, PASSIVE), "description").toBe(expected.description);
  expect(buildResolution(d, ACTIVE), "resolution").toBe(expected.resolution);
  expect(generateTicket({ detailLevel: "Short", details: d }), "short").toBe(expected.short);
  expect(generateTicket({ detailLevel: "Normal", details: d }), "normal").toBe(expected.normal);
  expect(generateTicket({ detailLevel: "Detailed", details: d }), "detailed").toBe(
    expected.detailed,
  );
  expect(generateTicket({ detailLevel: "Technical", details: d }), "technical").toBe(
    expected.technical,
  );
  expect(generateTicket({ detailLevel: "ManagementSummary", details: d }), "management").toBe(
    expected.management,
  );
  if (expected.partRequest !== undefined) {
    expect(buildPartRequest(d), "partRequest").toBe(expected.partRequest);
  } else {
    expect(buildPartRequest(d), "partRequest (none expected)").toBe("");
  }
}

// ─────────────────────────────────────────────────────────────────────
// 1. Store 523 — credit card machine issue (Berry)
// ─────────────────────────────────────────────────────────────────────
describe("Golden: Store 523 — credit card machine issue (Berry)", () => {
  const d = detailsOf({
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

  it("matches the canonical Berry/Store 523 output", () => {
    assertGolden(d, {
      subject: "Store 523 - Credit Card Machine Issue",
      description:
        "Berry from Store 523 called regarding a credit card machine issue. " +
        "Troubleshooting included exiting out of the transaction, " +
        "re-entering the transaction from the beginning, and advising the store " +
        "to wait one second between key presses. " +
        "The issue was confirmed resolved.",
      resolution:
        "Exited out of the transaction, re-entered the transaction from the beginning, " +
        "and advised the store to wait one second between key presses. " +
        "The issue was confirmed resolved.",
      short:
        "Store 523 called about a credit card machine issue that was resolved after " +
        "exiting out of the transaction, re-entering the transaction from the beginning, " +
        "and advising the store to wait one second between key presses.",
      normal:
        "Berry from Store 523 called regarding a credit card machine issue. " +
        "Troubleshooting included exiting out of the transaction, " +
        "re-entering the transaction from the beginning, and advising the store " +
        "to wait one second between key presses. " +
        "The issue was confirmed resolved.",
      detailed:
        "Berry from Store 523 called regarding a credit card machine issue. " +
        "Troubleshooting included exiting out of the transaction, " +
        "re-entering the transaction from the beginning, and advising the store " +
        "to wait one second between key presses. " +
        "The issue was confirmed resolved.",
      technical:
        "Store 523 reported a credit card machine issue. " +
        "Diagnostics: exited out of the transaction, " +
        "re-entered the transaction from the beginning, and advised the store " +
        "to wait one second between key presses. " +
        "Outcome: issue resolved.",
      management:
        "Store 523 experienced a credit card machine issue that affected normal store operations. " +
        "Support completed troubleshooting and the store confirmed normal operation.",
    });
  });
});

// ─────────────────────────────────────────────────────────────────────
// 2. Store 521 — Register 2 keyboard power drain
// ─────────────────────────────────────────────────────────────────────
describe("Golden: Store 521 — Register 2 keyboard power drain", () => {
  const d = detailsOf({
    storeNumber: "521",
    registerNumber: "2",
    issue: "keyboard issue",
    deviceType: "keyboard",
    powerDrainPerformed: true,
    cablesReseated: true,
    confirmationMethod: "Keyboard confirmed working",
    result: "Resolved",
  });

  it("emits the keyboard-issue NP form on every level", () => {
    assertGolden(d, {
      subject: "Store 521 - Register 2 Keyboard Issue",
      description:
        "Store 521 called regarding a keyboard issue on Register 2. " +
        "Troubleshooting included performing a register power drain and reseating the cables. " +
        "Keyboard confirmed working and the issue was confirmed resolved.",
      resolution:
        "Performed a register power drain and reseated the cables. Keyboard confirmed working.",
      short:
        "Store 521 called about a keyboard issue that was resolved after " +
        "performing a register power drain and reseating the cables.",
      normal:
        "Store 521 called regarding a keyboard issue on Register 2. " +
        "Troubleshooting included performing a register power drain and reseating the cables. " +
        "The keyboard was confirmed working and the issue was resolved.",
      detailed:
        "Store 521 called regarding a keyboard issue on Register 2. " +
        "Troubleshooting included performing a register power drain and reseating the cables. " +
        "The keyboard was confirmed working and the issue was resolved.",
      technical:
        "Store 521 reported a keyboard issue on Register 2. " +
        "Diagnostics: performed a register power drain and reseated the cables. " +
        "Validation: keyboard confirmed working. " +
        "Outcome: keyboard functionality restored.",
      management:
        "Store 521 experienced a keyboard issue that affected normal store operations. " +
        "Support completed troubleshooting and the store confirmed normal operation.",
    });
  });
});

// ─────────────────────────────────────────────────────────────────────
// 3. Store 1378 — Register 3 receipt printer hardware failure
// ─────────────────────────────────────────────────────────────────────
describe("Golden: Store 1378 — Register 3 receipt printer hardware failure", () => {
  const d = detailsOf({
    storeNumber: "1378",
    registerNumber: "3",
    issue: "receipt printer hardware failure",
    deviceType: "receipt printer",
    errorMessage: "hardware failure",
    partNeeded: true,
    parts: ["receipt printer"],
    replacementReason: "hardware failure persisted after troubleshooting",
    result: "PartsNeeded",
  });

  it("preserves 'hardware failure' in the subject and emits a part request", () => {
    assertGolden(d, {
      subject: "Store 1378 - Register 3 Receipt Printer Hardware Failure",
      description:
        "Store 1378 called regarding a receipt printer issue on Register 3. " +
        'The system displayed: "hardware failure". ' +
        "A replacement is required.",
      resolution:
        "Replacement needed. Issue persisted because: hardware failure persisted after troubleshooting. " +
        "A replacement ticket will be opened.",
      short:
        "Store 1378 called about a receipt printer issue; a replacement receipt printer is required.",
      normal:
        "Store 1378 called regarding a receipt printer hardware failure on Register 3. " +
        "Issue requires replacement parts. " +
        "Replacement receipt printer on Register 3 is required (hardware failure persisted after troubleshooting).",
      detailed:
        "Store 1378 called regarding a receipt printer hardware failure on Register 3. " +
        'The system displayed: "hardware failure". ' +
        "No troubleshooting steps were recorded. " +
        "Issue requires replacement parts. " +
        "Replacement receipt printer on Register 3 is required (hardware failure persisted after troubleshooting).",
      technical:
        "Store 1378 reported a receipt printer issue on Register 3. " +
        'Reported error: "hardware failure". ' +
        "Outcome: replacement hardware required. " +
        "Replacement receipt printer on Register 3 is required (hardware failure persisted after troubleshooting).",
      management:
        "Store 1378 experienced a receipt printer issue that affected printing. " +
        "Support reviewed the issue. A replacement device is being arranged so the store can return to normal.",
      partRequest:
        "The Register 3 receipt printer needs replacement. Hardware failure persisted after troubleshooting. " +
        "Please send a new receipt printer for Register 3.",
    });
  });
});

// ─────────────────────────────────────────────────────────────────────
// 4. Store 657 — store closed message after start of day
// ─────────────────────────────────────────────────────────────────────
describe("Golden: Store 657 — store closed message after start of day", () => {
  const d = detailsOf({
    storeNumber: "657",
    issue: 'the registers were displaying "store closed" after start of day',
    cacheRenamed: true,
    affectedRegisters: ["both registers"],
    confirmationMethod: "Both registers back online",
    result: "Resolved",
  });

  it("uses 'reporting that' for the clause and 'an issue with the registers' for short forms", () => {
    assertGolden(d, {
      subject: "Store 657 - Store Closed Message After Start of Day",
      description:
        'Store 657 called reporting that the registers were displaying "store closed" after start of day. ' +
        "Troubleshooting included renaming the cache. " +
        "Both registers back online and the issue was confirmed resolved.",
      resolution: "Renamed the cache. Both registers are back online.",
      short:
        "Store 657 called about an issue with the registers that was resolved after renaming the cache.",
      normal:
        'Store 657 called reporting that the registers were displaying "store closed" after start of day. ' +
        "Troubleshooting included renaming the cache. " +
        "Both registers came back online and the issue was resolved.",
      detailed:
        'Store 657 called reporting that the registers were displaying "store closed" after start of day. ' +
        "Troubleshooting included renaming the cache. " +
        "Both registers came back online and the issue was resolved.",
      technical:
        "Store 657 reported an issue with the registers. " +
        "Diagnostics: renamed the cache. " +
        "Validation: both registers verified back online. " +
        "Outcome: issue resolved.",
      management:
        "Store 657 experienced an issue with the registers that affected normal store operations. " +
        "Support completed troubleshooting and the store confirmed normal operation.",
    });
  });
});

// ─────────────────────────────────────────────────────────────────────
// 5. Store 395 — internet down / Inseego restart
// ─────────────────────────────────────────────────────────────────────
describe("Golden: Store 395 — internet down / Inseego restart", () => {
  const d = detailsOf({
    storeNumber: "395",
    issue: "internet down",
    devices: ["Inseego"],
    manualRebootPerformed: true,
    confirmationMethod: "Connection restored",
    result: "Resolved",
  });

  it("inserts a copula for 'internet down' and emits 'an issue with the internet' for short forms", () => {
    assertGolden(d, {
      subject: "Store 395 - Internet Down",
      description:
        "Store 395 called reporting that the internet was down. " +
        "Troubleshooting included manually rebooted the device. " +
        "Connection restored and the issue was confirmed resolved.",
      resolution: "Manually rebooted. Connection restored confirmed.",
      short:
        "Store 395 called about an issue with the internet that was resolved after manually rebooted the device.",
      normal:
        "Store 395 called reporting that the internet was down. " +
        "Troubleshooting included manually rebooted the device. " +
        "The connection was restored and the issue was resolved.",
      detailed:
        "Store 395 called reporting that the internet was down. " +
        "Troubleshooting included manually rebooted the device. " +
        "The connection was restored and the issue was resolved.",
      technical:
        "Store 395 reported an issue with the internet. " +
        "Diagnostics: manually rebooted the device. " +
        "Validation: network connection restored. " +
        "Outcome: issue resolved.",
      management:
        "Store 395 experienced an issue with the internet that affected normal store operations. " +
        "Support completed troubleshooting and the store confirmed normal operation.",
    });
  });
});

// ─────────────────────────────────────────────────────────────────────
// 6. Store 204 — receipt printer replacement request
// ─────────────────────────────────────────────────────────────────────
describe("Golden: Store 204 — receipt printer replacement request", () => {
  const d = detailsOf({
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
  });

  it("routes deviceType + clause-y issue into the NP form, not 'reporting that the receipt printer not printing'", () => {
    assertGolden(d, {
      subject: "Store 204 - Replacement Receipt Printer Request",
      description:
        "Store 204 called regarding a receipt printer issue on Register 1. " +
        "Troubleshooting included manually rebooted the device and reseating the cables. " +
        "A replacement is required.",
      resolution:
        "Manually rebooted and reseated the cables. " +
        "Issue persisted because: printer still did not print after reseating cables and rebooting. " +
        "Replacement ticket will be opened.",
      short:
        "Store 204 called about a receipt printer issue; a replacement receipt printer is required.",
      normal:
        "Store 204 called regarding a receipt printer issue on Register 1. " +
        "Troubleshooting included manually rebooted the device and reseating the cables. " +
        "Issue requires replacement parts. " +
        "Replacement receipt printer on Register 1 is required (printer still did not print after reseating cables and rebooting).",
      detailed:
        "Store 204 called regarding a receipt printer issue on Register 1. " +
        "Troubleshooting included manually rebooted the device and reseating the cables. " +
        "Issue requires replacement parts. " +
        "Replacement receipt printer on Register 1 is required (printer still did not print after reseating cables and rebooting).",
      technical:
        "Store 204 reported a receipt printer issue on Register 1. " +
        "Diagnostics: manually rebooted the device and reseated the cables. " +
        "Outcome: replacement hardware required. " +
        "Replacement receipt printer on Register 1 is required (printer still did not print after reseating cables and rebooting).",
      management:
        "Store 204 experienced a receipt printer issue that affected printing. " +
        "Support reviewed the issue. A replacement device is being arranged so the store can return to normal.",
      partRequest:
        "The Register 1 receipt printer needs replacement. Printer still did not print after reseating cables and rebooting. " +
        "Please send a new receipt printer for Register 1.",
    });
  });
});

// ─────────────────────────────────────────────────────────────────────
// 7. Store 812 — return processed as exchange
// ─────────────────────────────────────────────────────────────────────
describe("Golden: Store 812 — return processed as exchange", () => {
  const d = detailsOf({
    storeNumber: "812",
    issue: "return processed as exchange in error",
    typeOfTransaction: "Return",
    transactionNumber: "112233",
    itemNumber: "44556",
    paymentType: "Card",
    steps: ["reviewed the transaction", "voided the exchange and re-rang the return"],
    confirmationMethod: "Confirmed back to normal",
    result: "Resolved",
  });

  it("renders return-as-exchange resolution with normalized step verbs", () => {
    assertGolden(d, {
      subject: "Store 812 - Return Processed as Exchange",
      description:
        "Store 812 called regarding a return processed as exchange in error. " +
        "The transaction number was 112233, the item number was 44556. " +
        "Troubleshooting included reviewing the transaction and voiding the exchange and re-rang the return. " +
        "Confirmed back to normal and the issue was confirmed resolved.",
      resolution:
        "Reviewed the transaction and voided the exchange and re-rang the return. " +
        "The system is back to normal.",
      short:
        "Store 812 called about a return processed as exchange in error that was resolved after " +
        "reviewing the transaction and voiding the exchange and re-rang the return.",
      normal:
        "Store 812 called regarding a return processed as exchange in error. " +
        "Troubleshooting included reviewing the transaction and voiding the exchange and re-rang the return. " +
        "The store confirmed everything was back to normal and the issue was resolved.",
      detailed:
        "Store 812 called regarding a return processed as exchange in error. " +
        "The original transaction number was 112233. " +
        "Troubleshooting included reviewing the transaction and voiding the exchange and re-rang the return. " +
        "The store confirmed everything was back to normal and the issue was resolved.",
      technical:
        "Store 812 reported a return processed as exchange in error. " +
        "Transaction reference: 112233. " +
        "Diagnostics: reviewed the transaction and voided the exchange and re-rang the return. " +
        "Validation: store confirmed normal operation. " +
        "Outcome: issue resolved.",
      management:
        "Store 812 experienced a return processed as exchange in error that affected normal store operations. " +
        "Support completed troubleshooting and the store confirmed normal operation.",
    });
  });
});

// ─────────────────────────────────────────────────────────────────────
// 8. Store 311 — layaway return error
// ─────────────────────────────────────────────────────────────────────
describe("Golden: Store 311 — layaway return error", () => {
  const d = detailsOf({
    storeNumber: "311",
    issue: "layaway return error",
    typeOfTransaction: "Layaway",
    transactionNumber: "778899",
    errorMessage: "layaway not found",
    steps: ["verified the layaway in the system", "advised store to retry the return"],
    result: "FollowUpRequired",
    followUpNeeded: true,
    storeWasAdvised: "call back if the error persists",
  });

  it("emits a follow-up resolution with the store-advised text", () => {
    assertGolden(d, {
      subject: "Store 311 - Layaway Return Error",
      description:
        "Store 311 called regarding a layaway return error. " +
        'The system displayed: "layaway not found". ' +
        "The transaction number was 778899. " +
        "Troubleshooting included verifying the layaway in the system and advising the store to retry the return. " +
        "Follow-up is required.",
      resolution: "Follow-up required. Store was advised to call back if the error persists.",
      short: "Store 311 called about a layaway return error; follow-up is required.",
      normal:
        "Store 311 called regarding a layaway return error. " +
        "Troubleshooting included verifying the layaway in the system and advising the store to retry the return. " +
        "Follow-up is required.",
      detailed:
        "Store 311 called regarding a layaway return error. " +
        'The system displayed: "layaway not found". ' +
        "The original transaction number was 778899. " +
        "Troubleshooting included verifying the layaway in the system and advising the store to retry the return. " +
        "Follow-up is required.",
      technical:
        "Store 311 reported a layaway return error. " +
        'Reported error: "layaway not found". ' +
        "Transaction reference: 778899. " +
        "Diagnostics: verified the layaway in the system and advised the store to retry the return. " +
        "Outcome: follow-up required.",
      management:
        "Store 311 experienced a layaway return error that affected normal store operations. " +
        "Support reviewed the issue. Follow-up is required to confirm the issue is fully resolved.",
    });
  });
});

// ─────────────────────────────────────────────────────────────────────
// 9. Store 118 — BOS stuck while adding employee
// ─────────────────────────────────────────────────────────────────────
describe("Golden: Store 118 — BOS stuck while adding employee", () => {
  const d = detailsOf({
    storeNumber: "118",
    issue: "BOS stuck while adding a new employee",
    systems: ["BOS"],
    employeeName: "Jane Doe",
    steps: ["had the manager log out and back in", "cleared browser cache"],
    result: "Pending",
  });

  it("inserts copula ('BOS was stuck'), past-tenses 'logged out', preserves BOS as singular acronym", () => {
    assertGolden(d, {
      subject: "Store 118 - BOS Stuck While Adding Employee",
      description:
        "Store 118 called reporting that the BOS was stuck while adding a new employee. " +
        "Troubleshooting included logging out and back in and clearing browser cache. " +
        "The issue is still pending.",
      resolution: "Logged out and back in and cleared browser cache. Issue still pending.",
      short:
        "Store 118 called about an issue with the BOS; the issue is still pending.",
      normal:
        "Store 118 called reporting that the BOS was stuck while adding a new employee. " +
        "Troubleshooting included logging out and back in and clearing browser cache. " +
        "Issue is currently pending.",
      detailed:
        "Store 118 called reporting that the BOS was stuck while adding a new employee. " +
        "Troubleshooting included logging out and back in and clearing browser cache. " +
        "Issue is currently pending.",
      technical:
        "Store 118 reported an issue with the BOS. " +
        "Diagnostics: logged out and back in and cleared browser cache. " +
        "Outcome: pending further action.",
      management:
        "Store 118 experienced an issue with the BOS that affected normal store operations. " +
        "Support reviewed the issue. It is still pending and is being tracked.",
    });
  });
});

// ─────────────────────────────────────────────────────────────────────
// 10. Store 402 — wrong operator ID
// ─────────────────────────────────────────────────────────────────────
describe("Golden: Store 402 — wrong operator ID", () => {
  const d = detailsOf({
    storeNumber: "402",
    issue: "wrong operator ID assigned to a transaction",
    employeeId: "EMP-44",
    operatorId: "OP-09",
    steps: ["verified the operator ID in PCF", "corrected the operator ID on the transaction"],
    confirmationMethod: "Confirmed back to normal",
    result: "Resolved",
  });

  it("preserves PCF/ID acronyms in mid-sentence text", () => {
    assertGolden(d, {
      subject: "Store 402 - Wrong Operator ID",
      description:
        "Store 402 called regarding a wrong operator ID assigned to a transaction. " +
        "Troubleshooting included verifying the operator ID in PCF and corrected the operator ID on the transaction. " +
        "Confirmed back to normal and the issue was confirmed resolved.",
      resolution:
        "Verified the operator ID in PCF and corrected the operator ID on the transaction. " +
        "The system is back to normal.",
      short:
        "Store 402 called about a wrong operator ID assigned to a transaction that was resolved after " +
        "verifying the operator ID in PCF and corrected the operator ID on the transaction.",
      normal:
        "Store 402 called regarding a wrong operator ID assigned to a transaction. " +
        "Troubleshooting included verifying the operator ID in PCF and corrected the operator ID on the transaction. " +
        "The store confirmed everything was back to normal and the issue was resolved.",
      detailed:
        "Store 402 called regarding a wrong operator ID assigned to a transaction. " +
        "Troubleshooting included verifying the operator ID in PCF and corrected the operator ID on the transaction. " +
        "The store confirmed everything was back to normal and the issue was resolved.",
      technical:
        "Store 402 reported a wrong operator ID assigned to a transaction. " +
        "Diagnostics: verified the operator ID in PCF and corrected the operator ID on the transaction. " +
        "Validation: store confirmed normal operation. " +
        "Outcome: issue resolved.",
      management:
        "Store 402 experienced a wrong operator ID assigned to a transaction that affected normal store operations. " +
        "Support completed troubleshooting and the store confirmed normal operation.",
    });
  });
});

// ─────────────────────────────────────────────────────────────────────
// 11. Store 907 — VeriFone issue
// ─────────────────────────────────────────────────────────────────────
describe("Golden: Store 907 — VeriFone issue", () => {
  const d = detailsOf({
    storeNumber: "907",
    registerNumber: "2",
    issue: "VeriFone not responding on Register 2",
    deviceType: "VeriFone",
    cablesReseated: true,
    manualRebootPerformed: true,
    confirmationMethod: "Successful card transaction",
    result: "Resolved",
  });

  it("preserves VeriFone case and routes deviceType+clause issue into NP form", () => {
    assertGolden(d, {
      subject: "Store 907 - VeriFone Issue",
      description:
        "Store 907 called regarding a VeriFone issue on Register 2. " +
        "Troubleshooting included manually rebooted the device and reseating the cables. " +
        "Successful card transaction and the issue was confirmed resolved.",
      resolution:
        "Manually rebooted and reseated the cables. Successful card transaction confirmed.",
      short:
        "Store 907 called about a VeriFone issue that was resolved after " +
        "manually rebooted the device and reseating the cables.",
      normal:
        "Store 907 called regarding a VeriFone issue on Register 2. " +
        "Troubleshooting included manually rebooted the device and reseating the cables. " +
        "The card transaction went through successfully and the issue was resolved.",
      detailed:
        "Store 907 called regarding a VeriFone issue on Register 2. " +
        "Troubleshooting included manually rebooted the device and reseating the cables. " +
        "The card transaction went through successfully and the issue was resolved.",
      technical:
        "Store 907 reported a VeriFone issue on Register 2. " +
        "Diagnostics: manually rebooted the device and reseated the cables. " +
        "Validation: card transaction completed successfully. " +
        "Outcome: VeriFone functionality restored.",
      management:
        "Store 907 experienced a VeriFone issue that affected normal store operations. " +
        "Support completed troubleshooting and the store confirmed normal operation.",
    });
  });
});

// ─────────────────────────────────────────────────────────────────────
// 12. Store 555 — gift card refund
// ─────────────────────────────────────────────────────────────────────
describe("Golden: Store 555 — gift card refund", () => {
  const d = detailsOf({
    storeNumber: "555",
    issue: "gift card refund failed at the register",
    typeOfTransaction: "Refund",
    paymentType: "Gift Card",
    transactionNumber: "GC-991122",
    errorMessage: "card declined",
    steps: ["verified the gift card balance", "advised store to retry the refund"],
    result: "Pending",
    followUpNeeded: true,
  });

  it("renders a pending gift card refund without claiming it was resolved", () => {
    assertGolden(d, {
      subject: "Store 555 - Gift Card Transaction Refund",
      description:
        "Store 555 called regarding a gift card refund failed at the register. " +
        'The system displayed: "card declined". ' +
        "The transaction number was GC-991122. " +
        "Troubleshooting included verifying the gift card balance and advising the store to retry the refund. " +
        "The issue is still pending.",
      resolution:
        "Verified the gift card balance and advised the store to retry the refund. Issue still pending.",
      short:
        "Store 555 called about a gift card refund failed at the register; the issue is still pending.",
      normal:
        "Store 555 called regarding a gift card refund failed at the register. " +
        "Troubleshooting included verifying the gift card balance and advising the store to retry the refund. " +
        "Issue is currently pending.",
      detailed:
        "Store 555 called regarding a gift card refund failed at the register. " +
        'The system displayed: "card declined". ' +
        "The original transaction number was GC-991122. " +
        "Troubleshooting included verifying the gift card balance and advising the store to retry the refund. " +
        "Issue is currently pending. " +
        "Follow-up is required.",
      technical:
        "Store 555 reported a gift card refund failed at the register. " +
        'Reported error: "card declined". ' +
        "Transaction reference: GC-991122. " +
        "Diagnostics: verified the gift card balance and advised the store to retry the refund. " +
        "Outcome: pending further action.",
      management:
        "Store 555 experienced a gift card refund failed at the register that affected normal store operations. " +
        "Support reviewed the issue. It is still pending and is being tracked.",
    });
  });
});
