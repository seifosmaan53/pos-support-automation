import { beforeAll, beforeEach, describe, expect, it } from "vitest";

beforeAll(() => {
  if (
    typeof localStorage === "undefined" ||
    typeof (localStorage as Storage).setItem !== "function"
  ) {
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
  __resetPilotMode,
  addTuningItem,
  FEEDBACK_TAGS,
  getPilotCounts,
  getTicketFeedback,
  listTuningItems,
  PILOT_EVENT_TYPES,
  pilotReportMarkdown,
  recordPilotEvent,
  removeTuningItem,
  setTicketFeedbackNotes,
  toggleTicketTag,
  updateTuningItem,
} from "./pilotMode";

describe("pilotMode counters", () => {
  beforeEach(() => __resetPilotMode());

  it("records a single event into today's bucket", () => {
    recordPilotEvent("ticketCreated");
    const counts = getPilotCounts("today");
    expect(counts.ticketCreated).toBe(1);
    // every other counter is zero
    for (const t of PILOT_EVENT_TYPES) {
      if (t !== "ticketCreated") expect(counts[t]).toBe(0);
    }
  });

  it("sums multiple events into today + week + all", () => {
    recordPilotEvent("ticketCreated");
    recordPilotEvent("ticketCreated");
    recordPilotEvent("recordingSaved", 3);
    expect(getPilotCounts("today").ticketCreated).toBe(2);
    expect(getPilotCounts("week").recordingSaved).toBe(3);
    expect(getPilotCounts("all").recordingSaved).toBe(3);
  });
});

describe("pilotMode feedback tags", () => {
  beforeEach(() => __resetPilotMode());

  it("toggles tags on and off without affecting other ticket entries", () => {
    toggleTicketTag("t1", "goodOutput");
    toggleTicketTag("t1", "badResolution");
    expect(getTicketFeedback("t1").tags).toEqual(["goodOutput", "badResolution"]);
    toggleTicketTag("t1", "goodOutput"); // toggle off
    expect(getTicketFeedback("t1").tags).toEqual(["badResolution"]);
    // Unrelated ticket is untouched
    expect(getTicketFeedback("t2").tags).toEqual([]);
  });

  it("sets notes without erasing tags", () => {
    toggleTicketTag("t1", "needsCorrection");
    setTicketFeedbackNotes("t1", "AI dropped store number");
    const fb = getTicketFeedback("t1");
    expect(fb.tags).toEqual(["needsCorrection"]);
    expect(fb.notes).toBe("AI dropped store number");
  });

  it("toggling certain tags rolls up to aggregate counters", () => {
    toggleTicketTag("t1", "needsCorrection");
    toggleTicketTag("t2", "wrongSpeakerLabels");
    toggleTicketTag("t3", "wrongCallerName");
    const counts = getPilotCounts("today");
    expect(counts.aiMissedDetailReported).toBe(1);
    expect(counts.speakerCorrection).toBe(1);
    expect(counts.callerNameCorrection).toBe(1);
  });

  it("eleven feedback tags are exported", () => {
    expect(FEEDBACK_TAGS).toHaveLength(11);
  });
});

describe("pilotMode tuning queue", () => {
  beforeEach(() => __resetPilotMode());

  it("addTuningItem defaults to open + medium", () => {
    const item = addTuningItem({ title: "Test", category: "transcription" });
    expect(item.status).toBe("open");
    expect(item.severity).toBe("medium");
    expect(listTuningItems()).toHaveLength(1);
  });

  it("critical/high tuning items bump the critical-issue counter", () => {
    addTuningItem({ title: "Crit", category: "audioAttachment", severity: "critical" });
    addTuningItem({ title: "Med", category: "uiConfusion", severity: "medium" });
    expect(getPilotCounts("today").criticalIssueOpened).toBe(1);
  });

  it("updateTuningItem patches status and preserves id/createdAt", () => {
    const item = addTuningItem({ title: "X", category: "copyMode" });
    const updated = updateTuningItem(item.id, { status: "fixed" });
    expect(updated?.status).toBe("fixed");
    expect(updated?.id).toBe(item.id);
    expect(updated?.createdAt).toBe(item.createdAt);
  });

  it("removeTuningItem deletes from the persisted list", () => {
    const item = addTuningItem({ title: "to remove", category: "uiConfusion" });
    removeTuningItem(item.id);
    expect(listTuningItems().find((i) => i.id === item.id)).toBeUndefined();
  });
});

describe("pilotMode report markdown", () => {
  it("includes totals, corrections, and recommended fixes", () => {
    const md = pilotReportMarkdown({
      totalTickets: 12,
      totalRecordings: 10,
      audioAttachSuccessRate: 0.9,
      mostCommonIssueTypes: [{ label: "needs correction", count: 3 }],
      mostCommonStores: [{ storeNumber: "521", count: 2 }],
      mostCommonCorrections: [{ label: "Speaker label flip", count: 4 }],
      callerNameCorrections: 1,
      speakerCorrections: 4,
      transcriptCorrections: 2,
      ticketsNeedingRework: 3,
      openCriticalIssues: 0,
      recommendedFixes: ["Tune speaker detector for fast turn-taking"],
    });
    expect(md).toContain("# Store Ticket Assistant — Pilot Week Report");
    expect(md).toContain("Total tickets: **12**");
    expect(md).toContain("90.0%");
    expect(md).toContain("Most common stores");
    expect(md).toContain("Store 521: 2");
    expect(md).toContain("Tune speaker detector");
  });
});
