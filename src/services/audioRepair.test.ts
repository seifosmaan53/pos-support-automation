import { beforeAll, describe, expect, it } from "vitest";

beforeAll(() => {
  if (typeof localStorage === "undefined" || typeof (localStorage as Storage).setItem !== "function") {
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
  }
});

import {
  importDiskFileAsUnlinked,
  toCounts,
  type AudioHealthScan,
} from "./audioRepair";
import { audioFilesStore } from "./audioFilesStore";

describe("audioRepair.toCounts", () => {
  it("collapses a scan to length-based counts", () => {
    const scan: AudioHealthScan = {
      missing: [
        // shape-only fixtures — toCounts only reads .length
        // @ts-expect-error partial fixture for length count
        {},
        // @ts-expect-error partial fixture for length count
        {},
      ],
      // @ts-expect-error partial fixture for length count
      orphan: [{}],
      // @ts-expect-error partial fixture for length count
      unlinkedOnDisk: [{}, {}, {}],
      activeRows: 5,
      filesOnDisk: 4,
    };
    expect(toCounts(scan)).toEqual({
      missing: 2,
      orphan: 1,
      unlinkedOnDisk: 3,
    });
  });

  it("returns zeros for an empty scan", () => {
    const scan: AudioHealthScan = {
      missing: [],
      orphan: [],
      unlinkedOnDisk: [],
      activeRows: 0,
      filesOnDisk: 0,
    };
    expect(toCounts(scan)).toEqual({
      missing: 0,
      orphan: 0,
      unlinkedOnDisk: 0,
    });
  });
});

describe("audioRepair.importDiskFileAsUnlinked", () => {
  it("creates an active audio_files row with no ticketId", () => {
    const before = audioFilesStore.list().length;
    const row = importDiskFileAsUnlinked("/tmp/orphan-1.wav");
    expect(row.ticketId).toBeNull();
    expect(row.deleted).toBe(false);
    expect(row.path).toBe("/tmp/orphan-1.wav");
    expect(row.format).toBe("wav");
    expect(audioFilesStore.list().length).toBeGreaterThan(before);
  });

  it("infers format from the file extension", () => {
    const row = importDiskFileAsUnlinked("/tmp/something.m4a");
    expect(row.format).toBe("m4a");
  });

  it("falls back to wav when no extension is present", () => {
    const row = importDiskFileAsUnlinked("/tmp/no-extension");
    expect(row.format).toBe("wav");
  });
});
