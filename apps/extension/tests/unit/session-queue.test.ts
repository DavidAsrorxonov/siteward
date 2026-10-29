import { describe, expect, it } from "vitest";
import { createSessionQueue } from "../../src/background/session/session-queue.ts";

function createSignal() {
  let resolve!: () => void;

  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
}

describe("session queue", () => {
  it("waits for each operation and preserves request order", async () => {
    const run = createSessionQueue();
    const started = createSignal();
    const release = createSignal();
    const events: string[] = [];

    const first = run(async () => {
      events.push("first:start");
      started.resolve();

      await release.promise;

      events.push("first:end");
      return "first result";
    });

    const second = run(() => {
      events.push("second");
      return 2;
    });

    const third = run(() => {
      events.push("third");
      return true;
    });

    await started.promise;

    try {
      expect(events).toEqual(["first:start"]);
    } finally {
      release.resolve();
    }

    expect(await Promise.all([first, second, third])).toEqual([
      "first result",
      2,
      true,
    ]);

    expect(events).toEqual(["first:start", "first:end", "second", "third"]);
  });

  it("reports a synchronous failure and continues queued work", async () => {
    const run = createSessionQueue();
    const failure = new Error("Transition failed");
    const events: string[] = [];

    const failed = run(() => {
      events.push("failed");
      throw failure;
    });

    const next = run(() => {
      events.push("next");
      return "continued";
    });

    await expect(failed).rejects.toBe(failure);
    await expect(next).resolves.toBe("continued");

    expect(events).toEqual(["failed", "next"]);
  });

  it("reports an asynchronous failure and continues queued work", async () => {
    const run = createSessionQueue();
    const started = createSignal();
    const release = createSignal();
    const failure = new Error("Storage write failed");
    const events: string[] = [];

    const failed = run(async () => {
      events.push("failed:start");
      started.resolve();

      await release.promise;

      events.push("failed:end");
      throw failure;
    });

    const next = run(() => {
      events.push("next");
      return "continued";
    });

    // Attach the rejection assertion before releasing the operation.
    const rejectionCheck = expect(failed).rejects.toBe(failure);

    await started.promise;

    try {
      expect(events).toEqual(["failed:start"]);
    } finally {
      release.resolve();
    }

    await rejectionCheck;
    await expect(next).resolves.toBe("continued");

    expect(events).toEqual(["failed:start", "failed:end", "next"]);
  });
});
