import { describe, it, expect, vi, afterEach } from "vitest";
import {
  deriveKeywords,
  derivePartTriggers,
  formatDueLabel,
} from "./ticketDerivation";
import type { ExtractedDetails, TicketFields } from "../types/ticket";

/* These three were unreachable for tests until they were lifted out of appStore.ts.
   They decide what a saved ticket can later be FOUND by, so a silent change here does
   not break anything loudly — it just quietly stops matching. Worth pinning. */

const details = (over: Partial<ExtractedDetails> = {}) =>
  ({ ...over }) as ExtractedDetails;
const fields = (over: Partial<TicketFields> = {}) => ({ ...over }) as TicketFields;

describe("deriveKeywords", () => {
  it("collects the classification fields", () => {
    const out = deriveKeywords(
      details({ deviceType: "printer", category: "hardware", item: "toner" }),
      fields(),
    );

    expect(out).toEqual(expect.arrayContaining(["printer", "hardware", "toner"]));
  });

  it("drops values shorter than three characters as too generic to search on", () => {
    const out = deriveKeywords(details({ deviceType: "PC", category: "hardware" }), fields());

    expect(out).not.toContain("PC");
    expect(out).toContain("hardware");
  });

  it("includes device names", () => {
    const out = deriveKeywords(details({ devices: ["register", "scanner"] }), fields());

    expect(out).toEqual(expect.arrayContaining(["register", "scanner"]));
  });

  it("takes subject words of four characters or more, stripped of punctuation", () => {
    const out = deriveKeywords(details(), fields({ subject: "The printer, is jammed." }));

    // "The" and "is" are too short; punctuation must not create a separate keyword.
    expect(out).toContain("printer");
    expect(out).toContain("jammed");
    expect(out).not.toContain("printer,");
    expect(out).not.toContain("The");
  });

  it("de-duplicates", () => {
    const out = deriveKeywords(
      details({ deviceType: "printer", category: "printer" }),
      fields({ subject: "printer" }),
    );

    expect(out.filter((k) => k === "printer")).toHaveLength(1);
  });

  it("caps the list at eight so one verbose ticket cannot flood the index", () => {
    const out = deriveKeywords(
      details({ devices: ["aaaa", "bbbb", "cccc", "dddd", "eeee", "ffff", "gggg"] }),
      fields({ subject: "hhhh iiii jjjj kkkk llll" }),
    );

    expect(out).toHaveLength(8);
  });

  it("returns an empty list when there is nothing to derive from", () => {
    expect(deriveKeywords(details(), fields())).toEqual([]);
  });

  it("tolerates missing optional collections", () => {
    expect(() => deriveKeywords(details({ devices: undefined }), fields())).not.toThrow();
  });
});

describe("derivePartTriggers", () => {
  it("puts the exact error message first, ahead of general symptoms", () => {
    const out = derivePartTriggers(
      details({ errorMessage: "E-041 paper feed", symptoms: ["jams often"] }),
    );

    expect(out[0]).toBe("E-041 paper feed");
  });

  it("includes symptoms and the replacement reason", () => {
    const out = derivePartTriggers(
      details({ symptoms: ["loud grinding"], replacementReason: "roller worn" }),
    );

    expect(out).toEqual(["loud grinding", "roller worn"]);
  });

  it("caps at five so one ticket cannot dominate later matching", () => {
    const out = derivePartTriggers(
      details({
        errorMessage: "err",
        symptoms: ["a", "b", "c", "d", "e"],
        replacementReason: "reason",
      }),
    );

    expect(out).toHaveLength(5);
  });

  it("returns an empty list when nothing was extracted", () => {
    expect(derivePartTriggers(details())).toEqual([]);
  });
});

describe("formatDueLabel", () => {
  afterEach(() => vi.useRealTimers());

  it('says "today" for a timestamp on the current day', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 15, 9, 0, 0));

    expect(formatDueLabel(new Date(2026, 0, 15, 14, 30, 0).toISOString())).toMatch(
      /^today at /,
    );
  });

  it("uses the weekday for any other day", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 15, 9, 0, 0));

    const label = formatDueLabel(new Date(2026, 0, 17, 14, 30, 0).toISOString());
    expect(label).not.toMatch(/^today/);
    expect(label).toMatch(/ at /);
  });

  it("returns the input unchanged when it cannot be parsed", () => {
    // Better to show the raw value in the UI than "Invalid Date" or an empty cell.
    expect(formatDueLabel("not-a-date")).toBe("not-a-date");
    expect(formatDueLabel("")).toBe("");
  });
});
