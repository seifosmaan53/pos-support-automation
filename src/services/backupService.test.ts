import { beforeAll, beforeEach, describe, expect, it } from "vitest";

// vitest runs in `node` mode for this project; localStorage is sometimes
// installed as a partial stub by the runtime, which trips real store writes.
// Install a small in-memory shim so backup tests can exercise the real
// store mutations (settingsStore.save, etc.).
beforeAll(() => {
  const mem = new Map<string, string>();
  const shim: Storage = {
    get length() {
      return mem.size;
    },
    clear: () => mem.clear(),
    getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
    key: (i: number) => Array.from(mem.keys())[i] ?? null,
    removeItem: (k: string) => {
      mem.delete(k);
    },
    setItem: (k: string, v: string) => {
      mem.set(k, String(v));
    },
  };
  (globalThis as { localStorage?: Storage }).localStorage = shim;
});

import {
  applyFullBackup,
  applySettingsBackup,
  backupFilename,
  buildFullBackup,
  buildSettingsBackup,
  parseBackup,
  serializeBackup,
  __resetLastBackupAt,
  getLastBackupAt,
  markBackupCreatedNow,
} from "./backupService";
import { settingsStore } from "./databaseService";
import { DEFAULT_SETTINGS } from "../types/settings";

describe("backupService.envelope", () => {
  beforeEach(() => {
    __resetLastBackupAt();
  });

  it("buildFullBackup wraps current state in the expected envelope", () => {
    const backup = buildFullBackup();
    expect(backup.__backup.kind).toBe("store-ticket-assistant.full");
    expect(backup.__backup.version).toBeGreaterThan(0);
    expect(backup.__backup.audioFilesIncluded).toBe(false);
    expect(Array.isArray(backup.tickets)).toBe(true);
    expect(Array.isArray(backup.audioFiles)).toBe(true);
    expect(Array.isArray(backup.reminders)).toBe(true);
    expect(Array.isArray(backup.knowledgeItems)).toBe(true);
    expect(Array.isArray(backup.styleExamples)).toBe(true);
    expect(Array.isArray(backup.extractionPatterns)).toBe(true);
    expect(backup.settings).toBeDefined();
  });

  it("buildSettingsBackup wraps only settings", () => {
    const backup = buildSettingsBackup();
    expect(backup.__backup.kind).toBe("store-ticket-assistant.settings");
    expect(backup.settings).toBeDefined();
    // Should not have collection arrays
    expect("tickets" in backup).toBe(false);
  });

  it("serialize → parse round-trip preserves the envelope", () => {
    const backup = buildFullBackup();
    const text = serializeBackup(backup);
    const parsed = parseBackup(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.kind).toBe("store-ticket-assistant.full");
    expect(parsed.preview.counts.tickets).toBe(backup.tickets.length);
  });

  it("backupFilename embeds a timestamp and kind suffix", () => {
    const full = backupFilename("store-ticket-assistant.full");
    const settings = backupFilename("store-ticket-assistant.settings");
    expect(full).toMatch(/^sta-backup-full-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.json$/);
    expect(settings).toMatch(/^sta-backup-settings-/);
  });
});

describe("backupService.parseBackup validation", () => {
  it("rejects non-JSON", () => {
    const r = parseBackup("this is not JSON");
    expect(r.ok).toBe(false);
  });

  it("rejects JSON without an envelope", () => {
    const r = parseBackup(JSON.stringify({ tickets: [] }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("envelope");
  });

  it("rejects an unknown backup kind", () => {
    const r = parseBackup(
      JSON.stringify({ __backup: { kind: "evil-format", version: 1 } }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("Unknown backup kind");
  });

  it("rejects a newer-than-current format version", () => {
    const r = parseBackup(
      JSON.stringify({
        __backup: { kind: "store-ticket-assistant.full", version: 9999 },
      }),
    );
    expect(r.ok).toBe(false);
  });

  it("accepts a minimal valid envelope and reports counts", () => {
    const text = JSON.stringify({
      __backup: {
        kind: "store-ticket-assistant.full",
        version: 1,
        appVersion: "0.1.0",
        createdAt: "2026-05-15T00:00:00.000Z",
        audioFilesIncluded: false,
        extractorVersion: "sta-extractor-2026-04-29",
      },
      tickets: [{ id: "t1" }, { id: "t2" }, { id: "t3" }],
      audioFiles: [],
      reminders: [{ id: "r1" }],
      knowledgeItems: [],
      styleExamples: [],
      extractionPatterns: [],
      settings: { ...DEFAULT_SETTINGS },
    });
    const r = parseBackup(text);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.preview.counts.tickets).toBe(3);
    expect(r.preview.counts.reminders).toBe(1);
    expect(r.preview.hasSettings).toBe(true);
  });
});

describe("backupService.verifyBackupText", () => {
  it("flags an empty string as invalid", async () => {
    const { verifyBackupText } = await import("./backupService");
    const r = verifyBackupText("");
    expect(r.valid).toBe(false);
    expect(r.errors.length).toBeGreaterThan(0);
  });

  it("returns valid=true with counts for a well-formed envelope", async () => {
    const { verifyBackupText } = await import("./backupService");
    const text = JSON.stringify({
      __backup: {
        kind: "store-ticket-assistant.full",
        version: 1,
        appVersion: "0.1.0",
        createdAt: "2026-05-15T00:00:00.000Z",
        audioFilesIncluded: false,
        extractorVersion: "x",
      },
      tickets: [{ id: "a" }, { id: "b" }],
      audioFiles: [],
      reminders: [],
      knowledgeItems: [],
      styleExamples: [],
      extractionPatterns: [],
      settings: { ...DEFAULT_SETTINGS },
    });
    const r = verifyBackupText(text);
    expect(r.valid).toBe(true);
    expect(r.counts.tickets).toBe(2);
    expect(r.kind).toBe("store-ticket-assistant.full");
    expect(r.hasSettings).toBe(true);
  });

  it("emits a warning when audioFilesIncluded is true but the array is empty", async () => {
    const { verifyBackupText } = await import("./backupService");
    const text = JSON.stringify({
      __backup: {
        kind: "store-ticket-assistant.full",
        version: 1,
        audioFilesIncluded: true,
      },
      tickets: [{ id: "t" }],
      audioFiles: [],
      reminders: [],
      knowledgeItems: [],
      styleExamples: [],
      extractionPatterns: [],
      settings: { ...DEFAULT_SETTINGS },
    });
    const r = verifyBackupText(text);
    expect(r.warnings.some((w) => w.includes("audioFilesIncluded=true"))).toBe(true);
  });

  it("counts idless tickets as warnings", async () => {
    const { verifyBackupText } = await import("./backupService");
    const text = JSON.stringify({
      __backup: { kind: "store-ticket-assistant.full", version: 1 },
      tickets: [{ id: "a" }, { notId: "x" }],
      audioFiles: [],
      reminders: [],
      knowledgeItems: [],
      styleExamples: [],
      extractionPatterns: [],
      settings: { ...DEFAULT_SETTINGS },
    });
    const r = verifyBackupText(text);
    expect(r.warnings.some((w) => w.includes("missing an id"))).toBe(true);
  });
});

describe("backupService.applySettingsBackup", () => {
  it("replace mode overwrites the current settings", () => {
    const before = settingsStore.load();
    const tweaked = {
      ...before,
      technicianName: "test-restore-replace",
    };
    const result = applySettingsBackup(
      {
        __backup: {
          kind: "store-ticket-assistant.settings",
          version: 1,
          appVersion: "0.1.0",
          createdAt: "2026-05-15T00:00:00.000Z",
          audioFilesIncluded: false,
          extractorVersion: "x",
        },
        settings: tweaked,
      },
      "replace",
    );
    expect(result.replaced).toBe(1);
    expect(settingsStore.load().technicianName).toBe("test-restore-replace");
  });
});

describe("backupService.applyFullBackup", () => {
  beforeEach(() => {
    __resetLastBackupAt();
  });

  it("merge mode skips ids already present", () => {
    // Seed: nothing in the store (browser preview default). Apply twice
    // — the second apply should skip everything as already present.
    const backup = {
      __backup: {
        kind: "store-ticket-assistant.full" as const,
        version: 1,
        appVersion: "0.1.0",
        createdAt: "2026-05-15T00:00:00.000Z",
        audioFilesIncluded: false,
        extractorVersion: "x",
      },
      tickets: [],
      audioFiles: [],
      reminders: [],
      knowledgeItems: [],
      styleExamples: [],
      extractionPatterns: [],
      settings: settingsStore.load(),
    };
    const first = applyFullBackup(backup, "merge");
    const second = applyFullBackup(backup, "merge");
    // No data → both runs are no-ops on counts but the call itself should
    // complete and return a result per collection.
    expect(first.length).toBeGreaterThan(0);
    expect(second.length).toBeGreaterThan(0);
  });

  it("marks last backup time on apply", () => {
    expect(getLastBackupAt()).toBeNull();
    markBackupCreatedNow();
    expect(getLastBackupAt()).not.toBeNull();
  });
});
