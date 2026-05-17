import { describe, expect, it } from "vitest";
import { deriveCurrentStep } from "./WorkflowSteps";

describe("deriveCurrentStep", () => {
  it("step 1 when nothing is captured yet", () => {
    expect(
      deriveCurrentStep({
        hasTranscript: false,
        stage: "idle",
        hasGeneratedFields: false,
        hasSavedTicket: false,
      }),
    ).toBe(1);
  });

  it("step 2 once a transcript exists", () => {
    expect(
      deriveCurrentStep({
        hasTranscript: true,
        stage: "transcript",
        hasGeneratedFields: false,
        hasSavedTicket: false,
      }),
    ).toBe(2);
  });

  it("step 3 once extraction has produced ticket fields", () => {
    expect(
      deriveCurrentStep({
        hasTranscript: true,
        stage: "details",
        hasGeneratedFields: true,
        hasSavedTicket: false,
      }),
    ).toBe(3);
  });

  it("step 4 on the Form Helper page", () => {
    expect(
      deriveCurrentStep({
        hasTranscript: true,
        stage: "form",
        hasGeneratedFields: true,
        hasSavedTicket: false,
      }),
    ).toBe(4);
  });

  it("step 5 after the ticket is saved", () => {
    expect(
      deriveCurrentStep({
        hasTranscript: true,
        stage: "form",
        hasGeneratedFields: true,
        hasSavedTicket: true,
      }),
    ).toBe(5);
  });

  it("saved-ticket wins over the form stage", () => {
    expect(
      deriveCurrentStep({
        hasTranscript: true,
        stage: "ticket",
        hasGeneratedFields: true,
        hasSavedTicket: true,
      }),
    ).toBe(5);
  });
});
