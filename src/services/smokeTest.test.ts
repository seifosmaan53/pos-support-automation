import { beforeAll, beforeEach, describe, expect, it } from "vitest";

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
  __resetSmokeTest,
  addIssue,
  ALL_SMOKE_TEST_ITEM_IDS,
  countOpenCriticalIssues,
  countRun,
  getCurrentRun,
  listIssues,
  removeIssue,
  setItemNotes,
  setItemStatus,
  smokeTestReportMarkdown,
  startNewSmokeTest,
  updateIssue,
} from "./smokeTest";

describe("smokeTest run state", () => {
  beforeEach(() => __resetSmokeTest());

  it("startNewSmokeTest creates a fresh run with no records", () => {
    const run = startNewSmokeTest();
    expect(run.id).toMatch(/^run_/);
    expect(run.records).toEqual({});
    expect(run.finishedAt).toBeNull();
    expect(getCurrentRun()?.id).toBe(run.id);
  });

  it("setItemStatus records the status and preserves notes across status updates", () => {
    const id = ALL_SMOKE_TEST_ITEM_IDS[0];
    setItemNotes(id, "needs verification");
    const run = setItemStatus(id, "pass");
    expect(run.records[id].status).toBe("pass");
    expect(run.records[id].notes).toBe("needs verification");
  });

  it("countRun sums by status", () => {
    setItemStatus(ALL_SMOKE_TEST_ITEM_IDS[0], "pass");
    setItemStatus(ALL_SMOKE_TEST_ITEM_IDS[1], "pass");
    setItemStatus(ALL_SMOKE_TEST_ITEM_IDS[2], "fail");
    setItemStatus(ALL_SMOKE_TEST_ITEM_IDS[3], "skipped");
    const counts = countRun(getCurrentRun());
    expect(counts.pass).toBe(2);
    expect(counts.fail).toBe(1);
    expect(counts.skipped).toBe(1);
    expect(counts.total).toBe(ALL_SMOKE_TEST_ITEM_IDS.length);
    expect(counts.pending).toBe(counts.total - 4);
  });
});

describe("smokeTest issue tracking", () => {
  beforeEach(() => __resetSmokeTest());

  it("addIssue defaults to open + medium severity", () => {
    const issue = addIssue({ title: "Copy Mode broken" });
    expect(issue.status).toBe("open");
    expect(issue.severity).toBe("medium");
    expect(listIssues()).toHaveLength(1);
  });

  it("updateIssue patches status while preserving id + createdAt", () => {
    const issue = addIssue({ title: "first" });
    const updated = updateIssue(issue.id, { status: "fixed" });
    expect(updated?.status).toBe("fixed");
    expect(updated?.id).toBe(issue.id);
    expect(updated?.createdAt).toBe(issue.createdAt);
  });

  it("removeIssue deletes from the persisted list", () => {
    const issue = addIssue({ title: "to remove" });
    removeIssue(issue.id);
    expect(listIssues().find((i) => i.id === issue.id)).toBeUndefined();
  });

  it("countOpenCriticalIssues counts critical + high open issues only", () => {
    addIssue({ title: "c1", severity: "critical" });
    addIssue({ title: "h1", severity: "high" });
    addIssue({ title: "m1", severity: "medium" });
    addIssue({ title: "l1", severity: "low" });
    const fixed = addIssue({ title: "c2", severity: "critical" });
    updateIssue(fixed.id, { status: "fixed" });
    expect(countOpenCriticalIssues()).toBe(2);
  });
});

describe("smokeTest report markdown", () => {
  beforeEach(() => __resetSmokeTest());

  it("includes a checklist line for every item plus issue sections", () => {
    setItemStatus(ALL_SMOKE_TEST_ITEM_IDS[0], "pass");
    setItemStatus(ALL_SMOKE_TEST_ITEM_IDS[1], "fail", "broken on Mac");
    addIssue({ title: "TestBug", severity: "high", whatHappened: "click did nothing" });
    const md = smokeTestReportMarkdown();
    expect(md).toContain("# Store Ticket Assistant — Real-World Smoke Test report");
    expect(md).toContain("[x]");
    expect(md).toContain("[!]");
    expect(md).toContain("broken on Mac");
    expect(md).toContain("TestBug");
    expect(md).toContain("[HIGH]");
  });
});
