import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetErrorLog,
  clearErrorLog,
  formatErrorLog,
  getErrorLog,
  getRecentErrors,
  logError,
  subscribeErrorLog,
} from "./errorLog";

describe("errorLog", () => {
  beforeEach(() => {
    __resetErrorLog();
  });

  it("records entries newest-first with default severity 'error'", () => {
    logError({ source: "storage", op: "upsert", message: "first" });
    logError({ source: "audio", op: "save", message: "second" });
    const log = getErrorLog();
    expect(log).toHaveLength(2);
    expect(log[0].message).toBe("second");
    expect(log[0].severity).toBe("error");
    expect(log[1].message).toBe("first");
  });

  it("caps the buffer at 200 entries", () => {
    for (let i = 0; i < 250; i++) {
      logError({ source: "other", op: "op", message: `msg-${i}` });
    }
    const log = getErrorLog();
    expect(log).toHaveLength(200);
    // Newest first → last-written msg-249 is at index 0
    expect(log[0].message).toBe("msg-249");
    expect(log[199].message).toBe("msg-50");
  });

  it("getRecentErrors filters by source and respects limit", () => {
    logError({ source: "storage", op: "a", message: "x1" });
    logError({ source: "audio", op: "b", message: "y1" });
    logError({ source: "storage", op: "c", message: "x2" });
    const storage = getRecentErrors("storage");
    expect(storage.map((e) => e.message)).toEqual(["x2", "x1"]);
    const limited = getRecentErrors(undefined, 2);
    expect(limited).toHaveLength(2);
  });

  it("clearErrorLog wipes entries and notifies subscribers", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeErrorLog(listener);
    logError({ source: "ui", op: "render", message: "boom" });
    expect(listener).toHaveBeenCalledTimes(1);
    clearErrorLog();
    expect(getErrorLog()).toHaveLength(0);
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it("formatErrorLog produces severity-prefixed lines", () => {
    logError({ source: "ai", op: "ping", message: "no models", severity: "warning" });
    const text = formatErrorLog();
    expect(text).toContain("WARNING");
    expect(text).toContain("ai");
    expect(text).toContain("ping: no models");
  });

  it("formatErrorLog handles empty buffer", () => {
    expect(formatErrorLog()).toBe("(error log empty)");
  });
});
