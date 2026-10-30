import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createVaultAccessMessageHandler } from "../../src/background/vault-access-message-handler.ts";
import type { VaultAccessServices } from "../../src/background/vault-access-message-handler.ts";
import { createSessionMessageHandler } from "../../src/background/session-message-handler.ts";
import { createVault } from "../../src/crypto/vault-setup.ts";
import type { CreatedVault } from "../../src/crypto/vault-setup.ts";
import type { SessionStatus } from "../../src/shared/session-messages.ts";
import type { StoredVault } from "../../src/storage/vault-database.ts";

const extensionId = "a".repeat(32);
const origin = `chrome-extension://${extensionId}`;

const trustedSender = {
  id: extensionId,
  origin,
  url: `${origin}/src/sidepanel/index.html`,
  documentLifecycle: "active" as const,
};

function createSignal() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });

  return { promise, resolve };
}

describe("vault access message handler", () => {
  let created: CreatedVault;
  let stored: StoredVault;

  beforeAll(async () => {
    created = await createVault("Access handler fixture password");

    stored = {
      vaultId: created.setup.wrappedVaultKey.vaultId,
      localRevision: 1,
      setup: created.setup,
    };
  }, 30_000);

  afterAll(() => {
    created?.authKey.fill(0);
  });

  function makeHarness() {
    const session: SessionStatus = {
      status: "unlocked",
      generation: 1,
      vaultId: stored.vaultId,
      keyVersion: stored.setup.wrappedVaultKey.keyVersion,
      expiresAt: 1_700_000_060_000,
    };

    const services = {
      discover: vi.fn(async () => [stored.vaultId]),
      load: vi.fn(
        async (_vaultId: string): Promise<StoredVault | undefined> => stored,
      ),
      unlock: vi.fn<VaultAccessServices["unlock"]>(async () => session),
    };

    const getServices = vi.fn(
      async (): Promise<VaultAccessServices> => services,
    );

    const access = createVaultAccessMessageHandler(
      extensionId,
      getServices,
      60_000,
    );

    const request = {
      channel: "siteward",
      type: "vault.unlock",
      vaultId: stored.vaultId,
      password: "Entered password",
    };

    return { services, getServices, access, request, session };
  }

  it("returns vault IDs without setup data", async () => {
    const { access } = makeHarness();

    expect(
      await access.handle(
        { channel: "siteward", type: "vault.discover" },
        trustedSender,
      ),
    ).toEqual({
      ok: true,
      type: "vault.discover",
      vaultIds: [stored.vaultId],
    });
  });

  it("unlocks using the setup loaded by the worker", async () => {
    const { access, services, request, session } = makeHarness();

    expect(await access.handle(request, trustedSender)).toEqual({
      ok: true,
      type: "vault.unlock",
      session,
    });

    expect(services.load).toHaveBeenCalledWith(stored.vaultId);

    expect(services.unlock).toHaveBeenCalledWith(
      request.password,
      stored.setup,
      {
        vaultId: stored.vaultId,
        keyVersion: stored.setup.wrappedVaultKey.keyVersion,
      },
      60_000,
      expect.any(AbortSignal),
    );
  });

  it("does not derive a key for a missing vault", async () => {
    const { access, services, request } = makeHarness();
    services.load.mockResolvedValueOnce(undefined);

    expect(await access.handle(request, trustedSender)).toEqual({
      ok: false,
      error: "UNLOCK_FAILED",
    });

    expect(services.unlock).not.toHaveBeenCalled();
  });

  it("rejects an unauthorized sender before loading services", async () => {
    const { access, getServices, request } = makeHarness();

    expect(
      await access.handle(request, { ...trustedSender, tab: {} }),
    ).toEqual({
      ok: false,
      error: "UNAUTHORIZED",
    });

    expect(getServices).not.toHaveBeenCalled();
  });

  it("rejects a caller-provided timeout", async () => {
    const { access, getServices, request } = makeHarness();

    expect(
      await access.handle(
        { ...request, durationMs: 86_400_000 },
        trustedSender,
      ),
    ).toEqual({
      ok: false,
      error: "INVALID_REQUEST",
    });

    expect(getServices).not.toHaveBeenCalled();
  });

  it.each(["initialization", "loading"] as const)(
    "honors Lock while %s is pending",
    async (stage) => {
      const { access, services, getServices, request } = makeHarness();
      const started = createSignal();
      const release = createSignal();

      if (stage === "initialization") {
        getServices.mockImplementationOnce(async () => {
          started.resolve();
          await release.promise;
          return services;
        });
      } else {
        services.load.mockImplementationOnce(async () => {
          started.resolve();
          await release.promise;
          return stored;
        });
      }

      const operation = access.handle(request, trustedSender);
      await started.promise;

      const commands = {
        getStatus: vi.fn(async () => ({
          status: "locked" as const,
          generation: 1,
        })),
        lock: vi.fn(async () => ({
          status: "locked" as const,
          generation: 1,
        })),
      };

      const handleSession = createSessionMessageHandler(
        extensionId,
        async () => commands,
        access.cancelPendingUnlock,
      );

      try {
        await handleSession(
          { channel: "siteward", type: "session.lock" },
          trustedSender,
        );
      } finally {
        release.resolve();
      }

      expect(await operation).toEqual({
        ok: false,
        error: "UNLOCK_FAILED",
      });

      expect(services.unlock).not.toHaveBeenCalled();
      expect(commands.lock).toHaveBeenCalledTimes(1);
    },
  );

  it("rejects overlapping attempts and allows a later retry", async () => {
    const { access, services, request } = makeHarness();
    const started = createSignal();
    const release = createSignal();

    services.load.mockImplementationOnce(async () => {
      started.resolve();
      await release.promise;
      return stored;
    });

    const first = access.handle(request, trustedSender);
    await started.promise;

    try {
      expect(await access.handle(request, trustedSender)).toEqual({
        ok: false,
        error: "UNLOCK_BUSY",
      });
    } finally {
      access.cancelPendingUnlock();
      release.resolve();
    }

    expect(await first).toEqual({
      ok: false,
      error: "UNLOCK_FAILED",
    });

    expect(await access.handle(request, trustedSender)).toMatchObject({
      ok: true,
      type: "vault.unlock",
    });
  });

  it("does not expose internal unlock errors", async () => {
    const { access, services, request } = makeHarness();

    services.unlock.mockRejectedValueOnce(
      new Error("Private implementation details"),
    );

    expect(await access.handle(request, trustedSender)).toEqual({
      ok: false,
      error: "UNLOCK_FAILED",
    });
  });
});
