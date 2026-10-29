import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { VaultKeyContext } from "@siteward/contracts";
import { bytesToBase64 } from "../../src/crypto/base64.ts";
import { createVault } from "../../src/crypto/vault-setup.ts";
import type {
  CreatedVault,
  UnlockedVault,
} from "../../src/crypto/vault-setup.ts";
import { createSessionController } from "../../src/background/session/session-controller.ts";
import type { SessionController } from "../../src/background/session/session-controller.ts";
import { sessionStateSchema } from "../../src/background/session/session-schema.ts";
import type { SessionState } from "../../src/background/session/session-schema.ts";
import type { SessionStore } from "../../src/background/session/session-store.ts";
import { createVaultUnlocker } from "../../src/background/session/vault-unlocker.ts";

function createSignal() {
  let resolve!: () => void;

  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
}

describe("vault unlocker", () => {
  const password = "Vault unlocker test password";
  const now = 1_700_000_000_000;

  let created: CreatedVault;
  let context: VaultKeyContext;
  let encodedVaultKey: string;
  let saved: SessionState | undefined;
  let controller: SessionController;

  beforeAll(async () => {
    created = await createVault(password);

    context = {
      vaultId: created.setup.wrappedVaultKey.vaultId,
      keyVersion: created.setup.wrappedVaultKey.keyVersion,
    };

    const raw = new Uint8Array(
      await crypto.subtle.exportKey("raw", created.vaultKey),
    );

    try {
      encodedVaultKey = bytesToBase64(raw);
    } finally {
      raw.fill(0);
    }
  }, 30_000);

  afterAll(() => {
    created?.authKey.fill(0);
  });

  beforeEach(async () => {
    saved = undefined;

    const store: SessionStore = {
      async read() {
        return structuredClone(saved);
      },

      async write(input: unknown) {
        saved = sessionStateSchema.parse(input);
      },
    };

    controller = await createSessionController(store, () => now);
  });

  function makeDerivedKeys(): UnlockedVault {
    return {
      vaultKey: created.vaultKey,
      authKey: new Uint8Array(32).fill(7),
    };
  }

  it("unlocks with the real password and stores the original vault key", async () => {
    const unlock = createVaultUnlocker(controller);

    const status = await unlock(password, created.setup, context, 60_000);

    expect(status).toEqual({
      status: "unlocked",
      generation: 1,
      ...context,
      expiresAt: now + 60_000,
    });

    expect(saved).toEqual({
      sessionVersion: 1,
      status: "unlocked",
      generation: 1,
      ...context,
      unlockedAt: now,
      expiresAt: now + 60_000,
      vaultKeyBase64: encodedVaultKey,
    });
  }, 30_000);

  it("rejects the wrong password and cancels its attempt", async () => {
    const unlock = createVaultUnlocker(controller);

    await expect(
      unlock("Wrong password", created.setup, context, 60_000),
    ).rejects.toMatchObject({
      name: "OperationError",
    });

    expect(await controller.getStatus()).toEqual({
      status: "locked",
      generation: 2,
    });

    expect(saved).not.toHaveProperty("vaultKeyBase64");
  }, 30_000);

  it("allows Lock during derivation and clears returned authentication bytes", async () => {
    const started = createSignal();
    const release = createSignal();
    const keys = makeDerivedKeys();

    const unlock = createVaultUnlocker(controller, async () => {
      started.resolve();
      await release.promise;
      return keys;
    });

    const operation = unlock(password, created.setup, context, 60_000);

    const rejection = expect(operation).rejects.toThrow(
      "Unlock attempt is no longer valid.",
    );

    await started.promise;

    try {
      await controller.lock();
    } finally {
      release.resolve();
    }

    await rejection;

    expect(keys.authKey).toEqual(new Uint8Array(32));
    expect(saved).not.toHaveProperty("vaultKeyBase64");
    expect(await controller.getStatus()).toMatchObject({
      status: "locked",
    });
  });

  it("does not cancel a newer attempt when an older derivation fails", async () => {
    const started = createSignal();
    const release = createSignal();

    const unlock = createVaultUnlocker(controller, async () => {
      started.resolve();
      await release.promise;
      throw new Error("Older derivation failed");
    });

    const operation = unlock(password, created.setup, context, 60_000);

    const rejection = expect(operation).rejects.toThrow(
      "Older derivation failed",
    );

    await started.promise;

    const newerTicket = await controller.beginUnlock(context, 60_000);

    release.resolve();
    await rejection;

    await expect(
      controller.completeUnlock(newerTicket, encodedVaultKey),
    ).resolves.toMatchObject({
      status: "unlocked",
      generation: 2,
    });
  });

  it("clears authentication bytes and cancels when key export fails", async () => {
    const nonExtractableKey = await crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );

    const keys: UnlockedVault = {
      vaultKey: nonExtractableKey,
      authKey: new Uint8Array(32).fill(7),
    };

    const unlock = createVaultUnlocker(controller, async () => keys);

    await expect(
      unlock(password, created.setup, context, 60_000),
    ).rejects.toBeInstanceOf(DOMException);

    expect(keys.authKey).toEqual(new Uint8Array(32));
    expect(saved).not.toHaveProperty("vaultKeyBase64");
    expect(await controller.getStatus()).toMatchObject({
      status: "locked",
    });
  });

  it("cleans up when session completion rejects", async () => {
    const keys = makeDerivedKeys();

    vi.spyOn(controller, "completeUnlock").mockRejectedValueOnce(
      new Error("Completion failed"),
    );

    const unlock = createVaultUnlocker(controller, async () => keys);

    await expect(
      unlock(password, created.setup, context, 60_000),
    ).rejects.toThrow("Completion failed");

    expect(keys.authKey).toEqual(new Uint8Array(32));
    expect(saved).not.toHaveProperty("vaultKeyBase64");
    expect(await controller.getStatus()).toEqual({
      status: "locked",
      generation: 2,
    });
  });
});
