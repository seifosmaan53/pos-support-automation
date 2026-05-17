import { describe, expect, it } from "vitest";
import { highlightFactPhrases } from "./factHighlighter";

describe("highlightFactPhrases", () => {
  it("highlights Store NNN", () => {
    const spans = highlightFactPhrases("I am calling from Store 1518.");
    expect(spans.some((s) => s.kind === "fact" && /Store\s+1518/i.test(s.text))).toBe(true);
  });

  it("highlights Register N", () => {
    const spans = highlightFactPhrases("Register 2 is broken.");
    expect(spans[0]).toEqual({ kind: "fact", text: "Register 2" });
  });

  it("highlights multiple facts in one segment", () => {
    const spans = highlightFactPhrases(
      "Store 1518 Register 2 says hardware failure.",
    );
    const facts = spans.filter((s) => s.kind === "fact").map((s) => s.text.toLowerCase());
    expect(facts).toContain("store 1518");
    expect(facts).toContain("register 2");
    expect(facts).toContain("hardware failure");
  });

  it("returns one text span for unmatched input", () => {
    const spans = highlightFactPhrases("Just a regular sentence.");
    expect(spans).toEqual([{ kind: "text", text: "Just a regular sentence." }]);
  });

  it("returns empty for empty input", () => {
    expect(highlightFactPhrases("")).toEqual([]);
  });

  it("highlights brand tokens (PCF, Inseego)", () => {
    const spans = highlightFactPhrases("The PCF and Inseego both need a restart.");
    const facts = spans.filter((s) => s.kind === "fact").map((s) => s.text);
    expect(facts).toContain("PCF");
    expect(facts).toContain("Inseego");
  });

  it("highlights 'back to normal'", () => {
    const spans = highlightFactPhrases("It is back to normal now.");
    expect(spans.some((s) => s.kind === "fact" && /back\s+to\s+normal/i.test(s.text))).toBe(true);
  });

  it("highlights 'no replacement needed' as one span", () => {
    const spans = highlightFactPhrases("So no replacement is needed.");
    const facts = spans.filter((s) => s.kind === "fact");
    expect(facts).toHaveLength(1);
    expect(/no\s+replacement/i.test(facts[0].text)).toBe(true);
  });
});
