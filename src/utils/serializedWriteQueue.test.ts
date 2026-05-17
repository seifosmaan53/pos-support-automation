import { describe, expect, it, vi } from "vitest";
import { createSerializedWriteQueue } from "./serializedWriteQueue";

describe("createSerializedWriteQueue", () => {
  it("runs tasks in order and passes through success values", async () => {
    const q = createSerializedWriteQueue();
    const order: number[] = [];
    const a = q.enqueue(async () => {
      order.push(1);
      return "a";
    }, vi.fn());
    const b = q.enqueue(async () => {
      order.push(2);
      return "b";
    }, vi.fn());
    await q.flush();
    expect(order).toEqual([1, 2]);
    expect(await a).toBe("a");
    expect(await b).toBe("b");
  });

  it("invokes onFailure when a task rejects but still runs the next task", async () => {
    const q = createSerializedWriteQueue();
    const failures: unknown[] = [];
    const fail = vi.fn((e: unknown) => failures.push(e));
    const order: string[] = [];
    const ok = Symbol("ok");

    const p1 = q.enqueue(async () => {
      order.push("first");
      throw new Error("disk full");
    }, fail);

    const p2 = q.enqueue(async () => {
      order.push("second");
      return ok;
    }, fail);

    await q.flush();

    await expect(p1).resolves.toBeUndefined();
    await expect(p2).resolves.toBe(ok);
    expect(order).toEqual(["first", "second"]);
    expect(fail).toHaveBeenCalledTimes(1);
    expect((failures[0] as Error).message).toBe("disk full");
  });

  it("flush settles after bursts of overlapping enqueues", async () => {
    const q = createSerializedWriteQueue();
    let n = 0;
    for (let i = 0; i < 5; i++) {
      q.enqueue(async () => {
        n++;
      }, vi.fn());
    }
    await q.flush();
    expect(n).toBe(5);
  });
});
