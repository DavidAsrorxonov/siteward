import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createVaultCreationCoordinator } from "../../src/background/vault-creation-coordinator.ts";
import type { VaultCreationServices } from "../../src/background/vault-creation-coordinator.ts";
import { createVault } from "../../src/crypto/vault-setup.ts";
import type { CreatedVault } from "../../src/crypto/vault-setup.ts";
import type { SessionStatus } from "../../src/shared/session-messages.ts";
import type { PreparedVault } from "../../src/shared/vault-creation-messages.ts";

function createSignal() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("vault creation coordinator", () => {
  const password = "Creation coordinator test password";
  let fixture: CreatedVault;

  beforeAll(async () => {
    fixture = await createVault(password);
    fixture.authKey.fill(0);
  }, 30_000);

  afterAll(() => {
    fixture?.authKey.fill(0);
  });

  function makeHarness() {
    const derived = { ...fixture, authKey: new Uint8Array(32).fill(7) };
    const derive = vi.fn(async (_password: unknown) => derived);
    const services = {
      getStatus: vi.fn(
        async (): Promise<SessionStatus> => ({
          status: "locked",
          generation: 0,
        }),
      ),
      discover: vi.fn(async (): Promise<string[]> => []),
      save: vi.fn<VaultCreationServices["save"]>(async (setup) => ({
        vaultId: setup.wrappedVaultKey.vaultId,
        localRevision: 1,
        setup,
      })),
    };
    const getServices = vi.fn(
      async (): Promise<VaultCreationServices> => services,
    );
    const coordinator = createVaultCreationCoordinator(getServices, derive);
    const publish = vi.fn<(value: PreparedVault) => undefined>(() => undefined);

    async function prepare() {
      await coordinator.prepare(password, publish);
      return publish.mock.calls[0]![0];
    }

    return {
      coordinator,
      services,
      getServices,
      derive,
      derived,
      publish,
      prepare,
    };
  }

  it("publishes recovery information without saving or retaining authentication bytes", async () => {
    const h = makeHarness();
    const prepared = await h.prepare();
    expect(prepared).toEqual({
      token: expect.any(String),
      vaultId: fixture.setup.wrappedVaultKey.vaultId,
      recoveryKey: fixture.recoveryKey,
    });
    expect(h.services.save).not.toHaveBeenCalled();
    expect(h.derived.authKey).toEqual(new Uint8Array(32));
    expect(h.derive).toHaveBeenCalledWith(password);
  });

  it("saves only the encrypted setup after confirmation and consumes the token", async () => {
    const h = makeHarness();
    const prepared = await h.prepare();
    expect(await h.coordinator.confirm(prepared.token)).toBe(prepared.vaultId);
    expect(h.services.save).toHaveBeenCalledTimes(1);
    expect(h.services.save).toHaveBeenCalledWith(fixture.setup);
    await expect(h.coordinator.confirm(prepared.token)).rejects.toMatchObject({
      code: "CREATION_EXPIRED",
    });
  });

  it("does not discard the pending setup for a wrong token", async () => {
    const h = makeHarness();
    const prepared = await h.prepare();
    await expect(
      h.coordinator.confirm(crypto.randomUUID()),
    ).rejects.toMatchObject({
      code: "CREATION_EXPIRED",
    });
    await expect(h.coordinator.confirm(prepared.token)).resolves.toBe(
      prepared.vaultId,
    );
  });

  it("requires a fresh prepare after cancellation or worker restart", async () => {
    const h = makeHarness();
    const prepared = await h.prepare();
    const restarted = createVaultCreationCoordinator(h.getServices, h.derive);
    await expect(restarted.confirm(prepared.token)).rejects.toMatchObject({
      code: "CREATION_EXPIRED",
    });
    expect(h.coordinator.cancelPendingCreation()).toBe(true);
    await expect(h.coordinator.confirm(prepared.token)).rejects.toMatchObject({
      code: "CREATION_EXPIRED",
    });
    expect(h.services.save).not.toHaveBeenCalled();
  });

  it("rejects another prepare while awaiting confirmation", async () => {
    const h = makeHarness();
    await h.prepare();
    await expect(
      h.coordinator.prepare(password, h.publish),
    ).rejects.toMatchObject({
      code: "CREATION_BUSY",
    });
    expect(h.derive).toHaveBeenCalledTimes(1);
  });

  it.each(["initialization", "discovery", "derivation"] as const)(
    "cancels during %s without publishing or saving",
    async (stage) => {
      const h = makeHarness();
      const started = createSignal();
      const release = createSignal();
      async function pause() {
        started.resolve();
        await release.promise;
      }
      if (stage === "initialization") {
        h.getServices.mockImplementationOnce(async () => {
          await pause();
          return h.services;
        });
      } else if (stage === "discovery") {
        h.services.discover.mockImplementationOnce(async () => {
          await pause();
          return [];
        });
      } else {
        h.derive.mockImplementationOnce(async () => {
          await pause();
          return h.derived;
        });
      }
      const operation = h.coordinator.prepare(password, h.publish);
      const rejection = expect(operation).rejects.toMatchObject({
        code: "CREATION_CANCELLED",
      });
      await started.promise;
      try {
        expect(h.coordinator.cancelPendingCreation()).toBe(true);
        await expect(
          h.coordinator.prepare(password, h.publish),
        ).rejects.toMatchObject({
          code: "CREATION_BUSY",
        });
      } finally {
        release.resolve();
      }
      await rejection;
      expect(h.publish).not.toHaveBeenCalled();
      expect(h.services.save).not.toHaveBeenCalled();
      if (stage === "derivation") {
        expect(h.derived.authKey).toEqual(new Uint8Array(32));
      } else {
        expect(h.derive).not.toHaveBeenCalled();
      }
    },
  );

  it("cancels confirmation before the database write starts", async () => {
    const h = makeHarness();
    const prepared = await h.prepare();
    const started = createSignal();
    const release = createSignal();
    h.getServices.mockImplementationOnce(async () => {
      started.resolve();
      await release.promise;
      return h.services;
    });
    const confirmation = h.coordinator.confirm(prepared.token);
    const rejection = expect(confirmation).rejects.toMatchObject({
      code: "CREATION_CANCELLED",
    });
    await started.promise;
    h.coordinator.cancelPendingCreation();
    release.resolve();
    await rejection;
    expect(h.services.save).not.toHaveBeenCalled();
  });

  it("finishes a confirmed save and rejects cancellation or duplicate confirmation during commit", async () => {
    const h = makeHarness();
    const prepared = await h.prepare();
    const started = createSignal();
    const release = createSignal();
    h.services.save.mockImplementationOnce(async (setup) => {
      started.resolve();
      await release.promise;
      return { vaultId: prepared.vaultId, localRevision: 1, setup };
    });
    const confirmation = h.coordinator.confirm(prepared.token);
    await started.promise;
    try {
      expect(h.coordinator.cancelPendingCreation()).toBe(false);
      await expect(h.coordinator.confirm(prepared.token)).rejects.toMatchObject(
        { code: "CREATION_BUSY" },
      );
    } finally {
      release.resolve();
    }
    await expect(confirmation).resolves.toBe(prepared.vaultId);
    expect(h.services.save).toHaveBeenCalledTimes(1);
  });

  it("blocks creation when a local vault already exists", async () => {
    const h = makeHarness();
    h.services.discover.mockResolvedValueOnce([crypto.randomUUID()]);
    await expect(
      h.coordinator.prepare(password, h.publish),
    ).rejects.toMatchObject({ code: "VAULT_ALREADY_EXISTS" });
    expect(h.derive).not.toHaveBeenCalled();
  });

  it.each(["prepare", "confirm"] as const)(
    "requires a locked session during %s",
    async (stage) => {
      const h = makeHarness();
      const prepared = stage === "confirm" ? await h.prepare() : undefined;
      h.services.getStatus.mockResolvedValueOnce({
        status: "unlocked",
        generation: 1,
        vaultId: fixture.setup.wrappedVaultKey.vaultId,
        keyVersion: 1,
        expiresAt: 1_700_000_060_000,
      });
      await expect(
        prepared === undefined
          ? h.coordinator.prepare(password, h.publish)
          : h.coordinator.confirm(prepared.token),
      ).rejects.toMatchObject({ code: "SESSION_NOT_LOCKED" });
      expect(h.services.save).not.toHaveBeenCalled();
    },
  );

  it("discards pending setup if recovery-key delivery throws", async () => {
    const h = makeHarness();
    h.publish.mockImplementationOnce(() => {
      throw new Error("Panel closed");
    });
    await expect(h.coordinator.prepare(password, h.publish)).rejects.toThrow(
      "Panel closed",
    );
    const prepared = h.publish.mock.calls[0]![0];
    await expect(h.coordinator.confirm(prepared.token)).rejects.toMatchObject({
      code: "CREATION_EXPIRED",
    });
    expect(h.derived.authKey).toEqual(new Uint8Array(32));
  });

  it("releases the busy state after derivation fails", async () => {
    const h = makeHarness();
    h.derive.mockRejectedValueOnce(new Error("Derivation failed"));
    await expect(h.coordinator.prepare(password, h.publish)).rejects.toThrow(
      "Derivation failed",
    );
    await expect(
      h.coordinator.prepare(password, h.publish),
    ).resolves.toBeUndefined();
  });

  it("does not reuse a confirmation after a save failure", async () => {
    const h = makeHarness();
    const prepared = await h.prepare();
    h.services.save.mockRejectedValueOnce(new Error("Storage failed"));
    await expect(h.coordinator.confirm(prepared.token)).rejects.toThrow(
      "Storage failed",
    );
    await expect(h.coordinator.confirm(prepared.token)).rejects.toMatchObject({
      code: "CREATION_EXPIRED",
    });
    expect(h.services.save).toHaveBeenCalledTimes(1);
  });
});
