import { describe, expect, it } from "vitest";
import {
  isNearEndOfCall,
  liveAskNextQuestions,
  rankAndCapQuestions,
} from "./liveAskNext";
import { type ExtractedDetails } from "../types/ticket";

function baseDetails(overrides: Partial<ExtractedDetails> = {}): ExtractedDetails {
  return {
    storeNumber: "",
    callerName: "",
    callerRole: "",
    transferredFrom: "",
    registerNumber: "",
    affectedRegisters: [],
    deviceType: "",
    devices: [],
    typeOfTransaction: "",
    category: "",
    issue: "",
    steps: [],
    errorMessage: "",
    transactionNumber: "",
    itemNumber: "",
    paymentType: "",
    customerPresent: false,
    partNeeded: false,
    partRequest: null,
    result: "ResultNotConfirmed",
    confidenceNotes: [],
    existingTicketMentioned: false,
    vendorTicketNumber: "",
    ...overrides,
  } as ExtractedDetails;
}

describe("liveAskNextQuestions", () => {
  it("returns keyboard pack when keyboard is mentioned", () => {
    const out = liveAskNextQuestions({
      details: baseDetails(),
      transcript: "The keyboard isn't typing.",
      haveCallerName: true,
    });
    expect(out).toContain("Which register is the keyboard connected to?");
    expect(out).toContain("Can the mouse move?");
    expect(out).toContain("Can you type numbers?");
    expect(out).toContain("Did the keyboard work after the power drain?");
  });

  it("drops the register question once a register is known", () => {
    const out = liveAskNextQuestions({
      details: baseDetails({ registerNumber: "2" }),
      transcript: "The keyboard isn't typing.",
      haveCallerName: true,
    });
    expect(out).not.toContain("Which register is the keyboard connected to?");
  });

  it("drops the mouse question once the mouse is mentioned", () => {
    const out = liveAskNextQuestions({
      details: baseDetails({ registerNumber: "2" }),
      transcript: "The keyboard isn't typing but the mouse moves fine.",
      haveCallerName: true,
    });
    expect(out).not.toContain("Can the mouse move?");
  });

  it("returns printer pack with error question when no error captured", () => {
    const out = liveAskNextQuestions({
      details: baseDetails(),
      transcript: "The receipt printer is offline.",
      haveCallerName: true,
    });
    expect(out).toContain("What exact error is showing on the printer?");
    expect(out).toContain("Does the printer lose power when moved?");
  });

  it("returns internet pack with all-registers + Inseego probes", () => {
    const out = liveAskNextQuestions({
      details: baseDetails(),
      transcript: "We have no internet.",
      haveCallerName: true,
    });
    expect(out).toContain("Is this affecting all registers or just one?");
    expect(out).toContain(
      "Did restarting the Inseego bring the store back online?",
    );
  });

  it("always adds 'Is everything working now?' when result is not confirmed", () => {
    const out = liveAskNextQuestions({
      details: baseDetails(),
      transcript: "Some random call.",
      haveCallerName: true,
    });
    expect(out).toContain("Is everything working now?");
    expect(out).toContain(
      "Should this be marked resolved, pending, or escalated?",
    );
  });

  it("asks for store number when missing", () => {
    const out = liveAskNextQuestions({
      details: baseDetails(),
      transcript: "Keyboard issue.",
      haveCallerName: true,
    });
    expect(out).toContain("What store are you calling from?");
  });

  it("asks for caller name only when missing", () => {
    const withName = liveAskNextQuestions({
      details: baseDetails(),
      transcript: "Keyboard issue.",
      haveCallerName: true,
    });
    const withoutName = liveAskNextQuestions({
      details: baseDetails(),
      transcript: "Keyboard issue.",
      haveCallerName: false,
    });
    expect(withName).not.toContain("May I have your name for the ticket?");
    expect(withoutName).toContain("May I have your name for the ticket?");
  });

  it("never repeats a question within one call", () => {
    const out = liveAskNextQuestions({
      details: baseDetails(),
      transcript: "Keyboard and printer issue.",
      haveCallerName: true,
    });
    const unique = new Set(out);
    expect(unique.size).toBe(out.length);
  });
});

describe("rankAndCapQuestions", () => {
  it("caps to 5 questions by default", () => {
    const qs = [
      "What store are you calling from?",
      "May I have your name for the ticket?",
      "Which register is the keyboard connected to?",
      "Can the mouse move?",
      "Can you type numbers?",
      "Did the keyboard work after the power drain?",
      "Is this affecting all registers or just one?",
    ];
    const out = rankAndCapQuestions(qs, {
      details: baseDetails(),
      haveCallerName: false,
    });
    expect(out).toHaveLength(5);
  });

  it("ranks missing-store first when store is missing", () => {
    const qs = [
      "Did rebooting or reseating cables fix it?",
      "What store are you calling from?",
    ];
    const out = rankAndCapQuestions(qs, {
      details: baseDetails(),
      haveCallerName: true,
    });
    expect(out[0]).toBe("What store are you calling from?");
  });

  it("does not boost missing-store when store already captured", () => {
    const qs = [
      "Did rebooting or reseating cables fix it?",
      "What store are you calling from?",
    ];
    const out = rankAndCapQuestions(qs, {
      details: baseDetails({ storeNumber: "1518" }),
      haveCallerName: true,
    });
    // Now store probe ranks at the fallback (10), reboot probe ranks at 50.
    expect(out[0]).toBe("Did rebooting or reseating cables fix it?");
  });

  it("near end of call pushes result questions to top", () => {
    const qs = [
      "Can the mouse move?",
      "Is everything working now?",
      "Should this be marked resolved, pending, or escalated?",
    ];
    const out = rankAndCapQuestions(qs, {
      details: baseDetails({ storeNumber: "1518", steps: ["restart"] }),
      haveCallerName: true,
      nearEndOfCall: true,
    });
    expect(out[0]).toBe("Is everything working now?");
  });
});

describe("isNearEndOfCall", () => {
  it("is true when steps were taken and result missing", () => {
    expect(
      isNearEndOfCall(
        baseDetails({ steps: ["restart"], result: "ResultNotConfirmed" }),
      ),
    ).toBe(true);
  });

  it("is false when result is already confirmed", () => {
    expect(
      isNearEndOfCall(baseDetails({ steps: ["restart"], result: "Resolved" })),
    ).toBe(false);
  });

  it("is false when no troubleshooting steps yet", () => {
    expect(isNearEndOfCall(baseDetails())).toBe(false);
  });
});
