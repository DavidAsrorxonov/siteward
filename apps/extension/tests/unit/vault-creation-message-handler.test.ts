import { describe, expect, it, vi } from "vitest";
import { createVaultCreationMessageHandler } from "../../src/background/vault-creation-message-handler.ts";
import { VaultCreationError } from "../../src/background/vault-creation-coordinator.ts";
import type { VaultCreationCoordinator } from "../../src/background/vault-creation-coordinator.ts";
import { createSessionMessageHandler } from "../../src/background/session-message-handler.ts";
import type { VaultCreationReply } from "../../src/shared/vault-creation-messages.ts";
import { VaultAlreadyExistsError } from "../../src/storage/vault-repository.ts";

const extensionId = "a".repeat(32);
const origin = `chrome-extension://${extensionId}`;
const trustedSender = {
  id: extensionId,
  origin,
  url: `${origin}/src/sidepanel/index.html`,
  documentLifecycle: "active" as const,
};
const prepared = {
  token: "11111111-1111-4111-8111-111111111111",
  vaultId: "22222222-2222-4222-8222-222222222222",
  // Format-only fixture: the handler does not verify recovery-key checksums.
  recoveryKey: `SW1-${Array(9).fill("12345678").join("-")}`,
};
const prepareRequest = {
  channel: "siteward",
  type: "vault.create.prepare",
  password: "Message handler test password",
};

function makeHarness() {
  const coordinator = {
    prepare: vi.fn<VaultCreationCoordinator["prepare"]>(
      async (_password, publish) => {
        publish(prepared);
      },
    ),
    confirm: vi.fn<VaultCreationCoordinator["confirm"]>(
      async () => prepared.vaultId,
    ),
    cancelPendingCreation: vi.fn(() => true),
  };
  const handle = createVaultCreationMessageHandler(extensionId, coordinator);
  const reply = vi.fn<(value: VaultCreationReply) => void>();
  return { coordinator, handle, reply };
}

describe("vault creation message handler", () => {
  it("delivers the recovery key synchronously inside the guarded publisher", async () => {
    const h = makeHarness();
    h.coordinator.prepare.mockImplementationOnce(async (_password, publish) => {
      publish(prepared);
      expect(h.reply).toHaveBeenCalledWith({
        ok: true,
        type: "vault.create.prepare",
        ...prepared,
      });
    });
    await h.handle(prepareRequest, trustedSender, h.reply);
    expect(h.reply).toHaveBeenCalledTimes(1);
  });

  it("requires explicit recovery-key acknowledgement before confirmation", async () => {
    const h = makeHarness();
    await h.handle(
      {
        channel: "siteward",
        type: "vault.create.confirm",
        token: prepared.token,
        recoveryKeySaved: true,
      },
      trustedSender,
      h.reply,
    );
    expect(h.coordinator.confirm).toHaveBeenCalledWith(prepared.token);
    expect(h.reply).toHaveBeenCalledWith({
      ok: true,
      type: "vault.create.confirm",
      vaultId: prepared.vaultId,
    });
  });

  it.each([
    { ...prepareRequest, password: "short" },
    { ...prepareRequest, setup: {} },
    {
      channel: "siteward",
      type: "vault.create.confirm",
      token: prepared.token,
    },
    {
      channel: "siteward",
      type: "vault.create.confirm",
      token: prepared.token,
      recoveryKeySaved: false,
    },
    {
      channel: "siteward",
      type: "vault.create.confirm",
      token: "invalid",
      recoveryKeySaved: true,
    },
    { channel: "siteward", type: "vault.create.cancel", role: "sidepanel" },
  ])(
    "rejects invalid creation request %# before accessing the coordinator",
    async (request) => {
      const h = makeHarness();
      await h.handle(request, trustedSender, h.reply);
      expect(h.reply).toHaveBeenCalledWith({
        ok: false,
        error: "INVALID_REQUEST",
      });
      expect(h.coordinator.prepare).not.toHaveBeenCalled();
      expect(h.coordinator.confirm).not.toHaveBeenCalled();
      expect(h.coordinator.cancelPendingCreation).not.toHaveBeenCalled();
    },
  );

  it.each([
    "vault.create.prepare",
    "vault.create.confirm",
    "vault.create.cancel",
  ])("rejects unauthorized %s messages", async (type) => {
    const h = makeHarness();
    await h.handle(
      { channel: "siteward", type },
      { ...trustedSender, tab: {} },
      h.reply,
    );
    expect(h.reply).toHaveBeenCalledWith({ ok: false, error: "UNAUTHORIZED" });
    expect(h.coordinator.prepare).not.toHaveBeenCalled();
    expect(h.coordinator.confirm).not.toHaveBeenCalled();
    expect(h.coordinator.cancelPendingCreation).not.toHaveBeenCalled();
  });

  it("cancels pending creation", async () => {
    const h = makeHarness();
    await h.handle(
      { channel: "siteward", type: "vault.create.cancel" },
      trustedSender,
      h.reply,
    );
    expect(h.coordinator.cancelPendingCreation).toHaveBeenCalledTimes(1);
    expect(h.reply).toHaveBeenCalledWith({
      ok: true,
      type: "vault.create.cancel",
    });
  });

  it("does not claim cancellation after commit has started", async () => {
    const h = makeHarness();
    h.coordinator.cancelPendingCreation.mockReturnValueOnce(false);
    await h.handle(
      { channel: "siteward", type: "vault.create.cancel" },
      trustedSender,
      h.reply,
    );
    expect(h.reply).toHaveBeenCalledWith({ ok: false, error: "CREATION_BUSY" });
  });

  it.each([
    {
      error: new VaultCreationError("CREATION_EXPIRED"),
      code: "CREATION_EXPIRED",
    },
    { error: new VaultAlreadyExistsError(), code: "VAULT_ALREADY_EXISTS" },
    { error: new Error("Private details"), code: "CREATION_FAILED" },
  ])("returns a fixed $code response", async ({ error, code }) => {
    const h = makeHarness();
    h.coordinator.confirm.mockRejectedValueOnce(error);
    await h.handle(
      {
        channel: "siteward",
        type: "vault.create.confirm",
        token: prepared.token,
        recoveryKeySaved: true,
      },
      trustedSender,
      h.reply,
    );
    expect(h.reply).toHaveBeenCalledWith({ ok: false, error: code });
  });

  it("does not deliver an extra key field attached to a prepared response", async () => {
    const h = makeHarness();
    h.coordinator.prepare.mockImplementationOnce(async (_password, publish) => {
      const unexpected = { ...prepared, vaultKeyBase64: "private" };
      publish(unexpected);
    });
    await h.handle(prepareRequest, trustedSender, h.reply);
    expect(h.reply).toHaveBeenCalledTimes(1);
    expect(h.reply).toHaveBeenCalledWith({
      ok: false,
      error: "CREATION_FAILED",
    });
  });

  it("cancels immediately on an authorized Lock before controller readiness", async () => {
    const h = makeHarness();
    const commands = {
      getStatus: vi.fn(async () => ({
        status: "locked" as const,
        generation: 1,
      })),
      lock: vi.fn(async () => ({ status: "locked" as const, generation: 1 })),
    };
    const getController = vi.fn(async () => {
      expect(h.coordinator.cancelPendingCreation).toHaveBeenCalledTimes(1);
      return commands;
    });
    const handleSession = createSessionMessageHandler(
      extensionId,
      getController,
      () => {
        h.coordinator.cancelPendingCreation();
      },
    );
    await handleSession(
      { channel: "siteward", type: "session.lock" },
      trustedSender,
    );
    expect(commands.lock).toHaveBeenCalledTimes(1);
  });

  it("does not cancel creation for an unauthorized Lock", async () => {
    const h = makeHarness();
    const getController = vi.fn(async () => {
      throw new Error("Must not initialize");
    });
    const handleSession = createSessionMessageHandler(
      extensionId,
      getController,
      () => {
        h.coordinator.cancelPendingCreation();
      },
    );
    expect(
      await handleSession(
        { channel: "siteward", type: "session.lock" },
        { ...trustedSender, origin: "null" },
      ),
    ).toEqual({ ok: false, error: "UNAUTHORIZED" });
    expect(h.coordinator.cancelPendingCreation).not.toHaveBeenCalled();
    expect(getController).not.toHaveBeenCalled();
  });
});
