import { describe, expect, it } from "vitest";
import {
  findOverlapLength,
  joinChunksWithOverlapDedup,
  mergeChunkTexts,
} from "./chunkOverlap";

describe("mergeChunkTexts — Phase 16D Test 5", () => {
  it("merges 'May I have your' + 'have your name?' without duplication", () => {
    expect(mergeChunkTexts("May I have your", "have your name?")).toBe(
      "May I have your name?",
    );
  });

  it("does not duplicate the overlap when prev ends mid-word", () => {
    const merged = mergeChunkTexts(
      "Can you confirm the store",
      "store number?",
    );
    expect(merged).toBe("Can you confirm the store number?");
  });

  it("returns next intact when there is no overlap", () => {
    expect(mergeChunkTexts("Tech: Computer room.", "Caller: Hi there.")).toBe(
      "Tech: Computer room. Caller: Hi there.",
    );
  });

  it("returns prev intact when next is empty", () => {
    expect(mergeChunkTexts("hello world", "")).toBe("hello world");
  });

  it("returns next intact when prev is empty", () => {
    expect(mergeChunkTexts("", "hello world")).toBe("hello world");
  });

  it("ignores single-character overlaps to avoid false positives", () => {
    // "a" appears at the boundary but is too short to be a real overlap.
    const merged = mergeChunkTexts("I see a", "a quick brown fox");
    expect(merged.toLowerCase()).toContain("a quick");
    expect(merged).not.toBe("I see a quick brown fox a"); // no duplication
  });

  it("is case-insensitive at the seam but preserves next's casing", () => {
    const merged = mergeChunkTexts("This is Maria from Store", "Store 1518.");
    expect(merged).toBe("This is Maria from Store 1518.");
  });

  it("is punctuation-tolerant — 'name?' and 'name.' overlap", () => {
    const merged = mergeChunkTexts("May I have your name?", "name. Maria.");
    // "name" is the matching prefix; the punctuation difference shouldn't
    // block the dedup.
    expect(merged).toBe("May I have your name? Maria.");
  });

  it("uses only the last 200 chars of prev when matching", () => {
    const longPrefix = "x".repeat(500);
    const merged = mergeChunkTexts(`${longPrefix} my name is Pat`, "my name is Pat. Thanks.");
    expect(merged.endsWith("my name is Pat. Thanks.")).toBe(true);
  });
});

describe("findOverlapLength", () => {
  it("returns 0 for no overlap", () => {
    expect(findOverlapLength("foo bar", "baz qux")).toBe(0);
  });

  it("returns the number of original chars consumed (including trailing ws)", () => {
    const drop = findOverlapLength("May I have your", "have your name?");
    expect(drop).toBeGreaterThan(0);
    expect("have your name?".slice(drop).trimStart()).toBe("name?");
  });
});

describe("joinChunksWithOverlapDedup", () => {
  it("merges a sequence with one overlap pair", () => {
    expect(
      joinChunksWithOverlapDedup([
        "Tech Support: May I have your",
        "have your name?",
        "Caller: Maria.",
      ]),
    ).toBe("Tech Support: May I have your name? Caller: Maria.");
  });

  it("ignores empty chunks", () => {
    expect(
      joinChunksWithOverlapDedup(["one", "", "two", ""]),
    ).toBe("one two");
  });
});
