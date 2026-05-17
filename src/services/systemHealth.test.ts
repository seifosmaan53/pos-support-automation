import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../types/settings";
import { summarizeSystem } from "./systemHealth";

describe("systemHealth.summarizeSystem", () => {
  it("returns counts and metadata in the expected shape", () => {
    const snap = summarizeSystem(DEFAULT_SETTINGS);
    // Shape checks — these surfaces all feed the System Health page and
    // diagnostics export, so they need to stay stable. Values themselves
    // depend on store state, which is empty in the test environment.
    expect(snap.capturedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(typeof snap.storageBackend).toBe("string");
    expect(typeof snap.isDesktopApp).toBe("boolean");
    expect(snap.counts).toBeDefined();
    expect(snap.counts.tickets).toBeGreaterThanOrEqual(0);
    expect(snap.counts.audioRowsActive).toBeGreaterThanOrEqual(0);
    expect(snap.counts.audioRowsDeleted).toBeGreaterThanOrEqual(0);
    expect(snap.counts.reminders).toBeGreaterThanOrEqual(0);
    expect(snap.counts.knowledgeItems).toBeGreaterThanOrEqual(0);
    expect(snap.counts.styleExamples).toBeGreaterThanOrEqual(0);
    expect(snap.counts.extractionPatterns).toBeGreaterThanOrEqual(0);
    expect(typeof snap.counts.currentExtractorVersion).toBe("string");
    expect(snap.counts.currentExtractorVersion.length).toBeGreaterThan(0);
    expect(snap.lastErrors).toBeDefined();
    expect(Array.isArray(snap.lastErrors.storage)).toBe(true);
    expect(Array.isArray(snap.lastErrors.audio)).toBe(true);
    expect(Array.isArray(snap.lastErrors.transcription)).toBe(true);
    expect(Array.isArray(snap.lastErrors.ai)).toBe(true);
  });

  it("audioRowsActive + audioRowsDeleted equals audioRowsTotal", () => {
    const snap = summarizeSystem(DEFAULT_SETTINGS);
    expect(snap.counts.audioRowsActive + snap.counts.audioRowsDeleted).toBe(
      snap.counts.audioRowsTotal,
    );
  });
});
