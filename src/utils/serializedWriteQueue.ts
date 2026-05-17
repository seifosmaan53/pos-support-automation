/**
 * Serializes async work onto a promise chain so only one runs at a time.
 * Failures are isolated: a rejected step does not block subsequent steps.
 */

export interface SerializedWriteQueue {
  enqueue<T>(
    fn: () => Promise<T>,
    onFailure: (reason: unknown) => void,
  ): Promise<T>;
  /** Await until every enqueue issued so far has settled. */
  flush(): Promise<unknown>;
}

export function createSerializedWriteQueue(): SerializedWriteQueue {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    enqueue<T>(
      fn: () => Promise<T>,
      onFailure: (reason: unknown) => void,
    ): Promise<T> {
      const runChain = tail.catch(() => undefined).then(() =>
        fn().catch((e) => {
          onFailure(e);
          return undefined as unknown as T;
        }),
      );
      tail = runChain.catch(() => undefined);
      return runChain as Promise<T>;
    },
    flush() {
      return tail.catch(() => undefined);
    },
  };
}
