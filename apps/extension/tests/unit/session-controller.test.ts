import { describe, expect, it, vi } from "vitest";
import { bytesToBase64 } from "../../src/crypto/base64.ts";
import { createSessionController } from "../../src/background/session/session-controller.ts";
import { sessionStateSchema } from "../../src/background/session/session-schema.ts";
import type { SessionState } from "../../src/background/session/session-schema.ts";
import type { SessionStore } from "../../src/background/session/session-store.ts";
import { decryptBytes, encryptBytes } from "../../src/crypto/aes-gcm.ts";

function makeStore(initial?: SessionState) {
  let saved = structuredClone(initial);

  const store = {
    read: vi.fn(async () => structuredClone(saved)),

    write: vi.fn(async (input: unknown) => {
      saved = sessionStateSchema.parse(input);
    }),
  } satisfies SessionStore;

  return {
    store,
    readStored: () => structuredClone(saved),
  };
}

function createSignal() {
  let resolve!: () => void;

  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
}

describe("session controller", () => {
  const unlockedAt = 1_700_000_000_000;
  const expiresAt = unlockedAt + 60_000;

  const unlocked = {
    sessionVersion: 1 as const,
    status: "unlocked" as const,
    generation: 3,
    vaultId: "11111111-1111-4111-8111-111111111111",
    keyVersion: 1,
    unlockedAt,
    expiresAt,
    vaultKeyBase64: bytesToBase64(new Uint8Array(32).fill(7)),
  };

  const vaultContext = {
    vaultId: unlocked.vaultId,
    keyVersion: unlocked.keyVersion,
  };

  it("initializes missing state as locked and restores it", async () => {
    const fake = makeStore();

    const controller = await createSessionController(
      fake.store,
      () => unlockedAt,
    );

    expect(await controller.getStatus()).toEqual({
      status: "locked",
      generation: 0,
    });

    expect(fake.readStored()).toEqual({
      sessionVersion: 1,
      status: "locked",
      generation: 0,
    });

    const restored = await createSessionController(
      fake.store,
      () => unlockedAt,
    );

    expect(await restored.getStatus()).toEqual({
      status: "locked",
      generation: 0,
    });

    // Restoring an existing locked state needs no extra write.
    expect(fake.store.write).toHaveBeenCalledTimes(1);
  });

  it("restores an active session without exposing its key or extending it", async () => {
    const fake = makeStore(unlocked);
    let now = unlockedAt;

    const controller = await createSessionController(fake.store, () => now);

    const expected = {
      status: "unlocked",
      generation: 3,
      vaultId: unlocked.vaultId,
      keyVersion: 1,
      expiresAt,
    };

    expect(await controller.getStatus()).toEqual(expected);

    now = expiresAt - 1;

    expect(await controller.getStatus()).toEqual(expected);
    expect(fake.store.write).not.toHaveBeenCalled();
  });

  it("serializes competing locks and preserves the locked state", async () => {
    const fake = makeStore(unlocked);

    const controller = await createSessionController(
      fake.store,
      () => unlockedAt,
    );

    const results = await Promise.all([controller.lock(), controller.lock()]);

    expect(results).toEqual([
      { status: "locked", generation: 4 },
      { status: "locked", generation: 5 },
    ]);

    expect(fake.readStored()).toEqual({
      sessionVersion: 1,
      status: "locked",
      generation: 5,
    });

    const restored = await createSessionController(
      fake.store,
      () => unlockedAt,
    );

    expect(await restored.getStatus()).toEqual({
      status: "locked",
      generation: 5,
    });
  });

  it("removes an expired session during initialization", async () => {
    const fake = makeStore(unlocked);

    const controller = await createSessionController(
      fake.store,
      () => expiresAt,
    );

    expect(await controller.getStatus()).toEqual({
      status: "locked",
      generation: 4,
    });

    expect(fake.readStored()).toEqual({
      sessionVersion: 1,
      status: "locked",
      generation: 4,
    });
  });

  it("locks on expiration without an alarm and does not repeatedly advance", async () => {
    const fake = makeStore(unlocked);
    let now = unlockedAt;

    const controller = await createSessionController(fake.store, () => now);

    now = expiresAt;

    expect(await controller.getStatus()).toEqual({
      status: "locked",
      generation: 4,
    });

    now += 10_000;

    expect(await controller.getStatus()).toEqual({
      status: "locked",
      generation: 4,
    });

    expect(fake.store.write).toHaveBeenCalledTimes(1);
    expect(fake.readStored()).not.toHaveProperty("vaultKeyBase64");
  });

  it("blocks status after a failed lock write and permits a lock retry", async () => {
    const fake = makeStore(unlocked);

    const controller = await createSessionController(
      fake.store,
      () => unlockedAt,
    );

    fake.store.write.mockRejectedValueOnce(new Error("Storage unavailable"));

    await expect(controller.lock()).rejects.toThrow("Storage unavailable");

    await expect(controller.getStatus()).rejects.toThrow(
      "Session persistence failed. Retry locking.",
    );

    // The failed write did not remove the persisted key.
    expect(fake.readStored()).toEqual(unlocked);

    await expect(controller.lock()).resolves.toEqual({
      status: "locked",
      generation: 5,
    });

    expect(fake.readStored()).toEqual({
      sessionVersion: 1,
      status: "locked",
      generation: 5,
    });
  });

  it("rejects initialization when reading storage fails", async () => {
    const fake = makeStore();

    fake.store.read.mockRejectedValueOnce(new Error("Read failed"));

    await expect(
      createSessionController(fake.store, () => unlockedAt),
    ).rejects.toThrow("Read failed");

    expect(fake.store.write).not.toHaveBeenCalled();
  });

  it("keeps an exhausted generation locked without wrapping around", async () => {
    const fake = makeStore({
      ...unlocked,
      generation: Number.MAX_SAFE_INTEGER,
    });

    const controller = await createSessionController(
      fake.store,
      () => unlockedAt,
    );

    const expected = {
      status: "locked",
      generation: Number.MAX_SAFE_INTEGER,
    };

    expect(await controller.getStatus()).toEqual(expected);
    expect(await controller.lock()).toEqual(expected);

    expect(fake.readStored()).not.toHaveProperty("vaultKeyBase64");

    await expect(controller.beginUnlock(vaultContext, 60_000)).rejects.toThrow(
      "Session generation exhausted.",
    );
  });

  it("completes an unlock and persists its expiration", async () => {
    const fake = makeStore();

    const controller = await createSessionController(
      fake.store,
      () => unlockedAt,
    );

    const ticket = await controller.beginUnlock(vaultContext, 60_000);

    expect(await controller.getStatus()).toEqual({
      status: "locked",
      generation: 1,
    });

    const status = await controller.completeUnlock(
      ticket,
      unlocked.vaultKeyBase64,
    );

    expect(status).toEqual({
      status: "unlocked",
      generation: 1,
      ...vaultContext,
      expiresAt,
    });

    expect(fake.readStored()).toEqual({
      ...unlocked,
      generation: 1,
    });

    expect(status).not.toHaveProperty("vaultKeyBase64");
  });

  it("rejects a derived result when Lock occurred during derivation", async () => {
    const fake = makeStore();

    const controller = await createSessionController(
      fake.store,
      () => unlockedAt,
    );

    const ticket = await controller.beginUnlock(vaultContext, 60_000);

    // Represents Lock while password derivation is still running.
    await controller.lock();

    await expect(
      controller.completeUnlock(ticket, unlocked.vaultKeyBase64),
    ).rejects.toThrow("Unlock attempt is no longer valid.");

    expect(fake.readStored()).toEqual({
      sessionVersion: 1,
      status: "locked",
      generation: 2,
    });
  });

  it("accepts only the newest attempt and prevents ticket reuse", async () => {
    const fake = makeStore();

    const controller = await createSessionController(
      fake.store,
      () => unlockedAt,
    );

    const first = await controller.beginUnlock(vaultContext, 60_000);

    const second = await controller.beginUnlock(vaultContext, 60_000);

    await expect(
      controller.completeUnlock(first, unlocked.vaultKeyBase64),
    ).rejects.toThrow("Unlock attempt is no longer valid.");

    await controller.completeUnlock(second, unlocked.vaultKeyBase64);

    await expect(
      controller.completeUnlock(second, unlocked.vaultKeyBase64),
    ).rejects.toThrow("Unlock attempt is no longer valid.");

    expect(await controller.getStatus()).toMatchObject({
      status: "unlocked",
      generation: 2,
    });
  });

  it("cancels an unlock when Lock arrives during its storage write", async () => {
    const fake = makeStore();

    const controller = await createSessionController(
      fake.store,
      () => unlockedAt,
    );

    const ticket = await controller.beginUnlock(vaultContext, 60_000);

    const writeNormally = fake.store.write.getMockImplementation()!;
    const lockRequests: Promise<unknown>[] = [];

    fake.store.write.mockImplementationOnce(async (input) => {
      await writeNormally(input);

      // Do not await a queued operation from inside the current one.
      lockRequests.push(controller.lock());
    });

    await expect(
      controller.completeUnlock(ticket, unlocked.vaultKeyBase64),
    ).rejects.toThrow("Unlock cancelled or expired.");

    expect(lockRequests).toHaveLength(1);
    await Promise.all(lockRequests);

    expect(await controller.getStatus()).toMatchObject({
      status: "locked",
    });

    expect(fake.readStored()).not.toHaveProperty("vaultKeyBase64");
  });

  it("removes an unlock that expires during its storage write", async () => {
    const fake = makeStore();
    let now = unlockedAt;

    const controller = await createSessionController(fake.store, () => now);

    const ticket = await controller.beginUnlock(vaultContext, 60_000);

    const writeNormally = fake.store.write.getMockImplementation()!;

    fake.store.write.mockImplementationOnce(async (input) => {
      await writeNormally(input);
      now = expiresAt;
    });

    await expect(
      controller.completeUnlock(ticket, unlocked.vaultKeyBase64),
    ).rejects.toThrow("Unlock cancelled or expired.");

    expect(fake.readStored()).toEqual({
      sessionVersion: 1,
      status: "locked",
      generation: 2,
    });
  });

  it("cleans up after an unlock write fails", async () => {
    const fake = makeStore();

    const controller = await createSessionController(
      fake.store,
      () => unlockedAt,
    );

    const ticket = await controller.beginUnlock(vaultContext, 60_000);

    fake.store.write.mockRejectedValueOnce(new Error("Unlock write failed"));

    await expect(
      controller.completeUnlock(ticket, unlocked.vaultKeyBase64),
    ).rejects.toThrow("Unlock write failed");

    expect(await controller.getStatus()).toEqual({
      status: "locked",
      generation: 2,
    });

    expect(fake.readStored()).not.toHaveProperty("vaultKeyBase64");
  });

  it("rejects invalid inputs and consumes a failed completion ticket", async () => {
    const fake = makeStore();

    const controller = await createSessionController(
      fake.store,
      () => unlockedAt,
    );

    await expect(controller.beginUnlock(vaultContext, 0)).rejects.toMatchObject(
      {
        name: "ZodError",
      },
    );

    const ticket = await controller.beginUnlock(vaultContext, 60_000);

    await expect(
      controller.completeUnlock(ticket, "invalid-key"),
    ).rejects.toMatchObject({
      name: "ZodError",
    });

    await expect(
      controller.completeUnlock(ticket, unlocked.vaultKeyBase64),
    ).rejects.toThrow("Unlock attempt is no longer valid.");

    expect(fake.readStored()).not.toHaveProperty("vaultKeyBase64");
  });

  it("restores a usable non-extractable key and publishes decrypted data", async () => {
    const fake = makeStore(unlocked);

    const controller = await createSessionController(
      fake.store,
      () => unlockedAt,
    );

    // Matches the dummy key bytes in the unlocked fixture.
    const originalKey = await crypto.subtle.importKey(
      "raw",
      new Uint8Array(32).fill(7),
      { name: "AES-GCM" },
      false,
      ["encrypt"],
    );

    const plaintext = new TextEncoder().encode("Saved credential");
    const aad = new TextEncoder().encode("session-access-test");
    const encrypted = await encryptBytes(originalKey, plaintext, aad);

    const publish = vi.fn((_value: Uint8Array<ArrayBuffer>) => undefined);

    await controller.readWithVaultKey(
      vaultContext,
      async (key) => {
        expect(key.extractable).toBe(false);
        return decryptBytes(key, encrypted, aad);
      },
      publish,
    );

    expect(publish).toHaveBeenCalledExactlyOnceWith(plaintext);
    expect(fake.store.write).not.toHaveBeenCalled();
  });

  it("does not invoke either callback while locked", async () => {
    const fake = makeStore();

    const controller = await createSessionController(
      fake.store,
      () => unlockedAt,
    );

    const read = vi.fn(async () => "secret");
    const publish = vi.fn((_value: string) => undefined);

    await expect(
      controller.readWithVaultKey(vaultContext, read, publish),
    ).rejects.toThrow("Vault is locked.");

    expect(read).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: "vault ID",
      context: {
        vaultId: "22222222-2222-4222-8222-222222222222",
        keyVersion: 1,
      },
    },
    {
      label: "key version",
      context: {
        ...vaultContext,
        keyVersion: 2,
      },
    },
  ])("rejects a different $label before reading", async ({ context }) => {
    const fake = makeStore(unlocked);

    const controller = await createSessionController(
      fake.store,
      () => unlockedAt,
    );

    const read = vi.fn(async () => "secret");
    const publish = vi.fn((_value: string) => undefined);

    await expect(
      controller.readWithVaultKey(context, read, publish),
    ).rejects.toThrow("Vault key context mismatch.");

    expect(read).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it("allows Lock during a read and refuses to publish its result", async () => {
    const fake = makeStore(unlocked);

    const controller = await createSessionController(
      fake.store,
      () => unlockedAt,
    );

    const started = createSignal();
    const release = createSignal();
    const publish = vi.fn((_value: string) => undefined);

    const operation = controller.readWithVaultKey(
      vaultContext,
      async () => {
        started.resolve();
        await release.promise;
        return "secret";
      },
      publish,
    );

    const rejection = expect(operation).rejects.toThrow(
      "Session changed or expired.",
    );

    await started.promise;

    try {
      await controller.lock();
    } finally {
      release.resolve();
    }

    await rejection;

    expect(publish).not.toHaveBeenCalled();
    expect(fake.readStored()).not.toHaveProperty("vaultKeyBase64");
  });

  it("refuses to publish when the session expires during a read", async () => {
    const fake = makeStore(unlocked);
    let now = unlockedAt;

    const controller = await createSessionController(fake.store, () => now);

    const publish = vi.fn((_value: string) => undefined);

    await expect(
      controller.readWithVaultKey(
        vaultContext,
        async () => {
          now = expiresAt;
          return "secret";
        },
        publish,
      ),
    ).rejects.toThrow("Session changed or expired.");

    expect(publish).not.toHaveBeenCalled();

    expect(await controller.getStatus()).toEqual({
      status: "locked",
      generation: 4,
    });

    expect(fake.readStored()).not.toHaveProperty("vaultKeyBase64");
  });

  it("rejects an old read even after the same vault is unlocked again", async () => {
    const fake = makeStore(unlocked);

    const controller = await createSessionController(
      fake.store,
      () => unlockedAt,
    );

    const started = createSignal();
    const release = createSignal();
    const publish = vi.fn((_value: string) => undefined);

    const operation = controller.readWithVaultKey(
      vaultContext,
      async () => {
        started.resolve();
        await release.promise;
        return "old result";
      },
      publish,
    );

    const rejection = expect(operation).rejects.toThrow(
      "Session changed or expired.",
    );

    await started.promise;

    try {
      await controller.lock();

      const ticket = await controller.beginUnlock(vaultContext, 60_000);

      await controller.completeUnlock(ticket, unlocked.vaultKeyBase64);
    } finally {
      release.resolve();
    }

    await rejection;

    expect(publish).not.toHaveBeenCalled();

    expect(await controller.getStatus()).toMatchObject({
      status: "unlocked",
      generation: 5,
    });
  });
});
