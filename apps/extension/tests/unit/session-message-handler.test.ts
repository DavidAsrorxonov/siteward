import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSessionMessageHandler } from "../../src/background/session-message-handler.ts";

const extensionId = "a".repeat(32);
const origin = `chrome-extension://${extensionId}`;
const sidePanelUrl = `${origin}/src/sidepanel/index.html`;

const trustedSender = {
  id: extensionId,
  url: sidePanelUrl,
  origin,
  documentLifecycle: "active" as const,
};

const locked = {
  status: "locked" as const,
  generation: 0,
};

function makeHarness() {
  const commands = {
    getStatus: vi.fn(async () => locked),

    lock: vi.fn(async () => ({
      ...locked,
      generation: 1,
    })),
  };

  const getController = vi.fn(async () => commands);

  const handle = createSessionMessageHandler(extensionId, getController);

  return { commands, getController, handle };
}

describe("session message handler", () => {
  let harness: ReturnType<typeof makeHarness>;

  beforeEach(() => {
    harness = makeHarness();
  });

  it("returns status to the approved side panel", async () => {
    expect(
      await harness.handle(
        { channel: "siteward", type: "session.status" },
        trustedSender,
      ),
    ).toEqual({
      ok: true,
      session: locked,
    });

    expect(harness.commands.getStatus).toHaveBeenCalledTimes(1);
    expect(harness.commands.lock).not.toHaveBeenCalled();
  });

  it("routes an approved Lock request", async () => {
    expect(
      await harness.handle(
        { channel: "siteward", type: "session.lock" },
        trustedSender,
      ),
    ).toEqual({
      ok: true,
      session: {
        status: "locked",
        generation: 1,
      },
    });

    expect(harness.commands.lock).toHaveBeenCalledTimes(1);
    expect(harness.commands.getStatus).not.toHaveBeenCalled();
  });

  it.each([
    { label: "missing extension ID", patch: { id: undefined } },
    { label: "another extension", patch: { id: "b".repeat(32) } },
    { label: "a website", patch: { url: "https://example.com/" } },
    { label: "a lookalike path", patch: { url: `${sidePanelUrl}.evil` } },
    { label: "an opaque origin", patch: { origin: "null" } },
    { label: "missing origin", patch: { origin: undefined } },
    { label: "a tab context", patch: { tab: {} } },
    { label: "a child frame", patch: { frameId: 1 } },
    {
      label: "an inactive document",
      patch: { documentLifecycle: "cached" as const },
    },
  ])("rejects $label before accessing the controller", async ({ patch }) => {
    expect(
      await harness.handle(
        {
          channel: "siteward",
          type: "session.status",
          role: "sidepanel",
        },
        { ...trustedSender, ...patch },
      ),
    ).toEqual({
      ok: false,
      error: "UNAUTHORIZED",
    });

    expect(harness.getController).not.toHaveBeenCalled();
  });

  it.each([
    null,
    { channel: "siteward", type: "vault.export" },
    {
      channel: "siteward",
      type: "session.status",
      role: "sidepanel",
    },
    {
      channel: "siteward",
      type: "session.lock",
      vaultKeyBase64: "unexpected",
    },
  ])("rejects invalid request %#", async (message) => {
    expect(await harness.handle(message, trustedSender)).toEqual({
      ok: false,
      error: "INVALID_REQUEST",
    });

    expect(harness.getController).not.toHaveBeenCalled();
  });

  it("returns a fixed error instead of internal error details", async () => {
    harness.commands.getStatus.mockRejectedValueOnce(
      new Error("Private internal details"),
    );

    expect(
      await harness.handle(
        { channel: "siteward", type: "session.status" },
        trustedSender,
      ),
    ).toEqual({
      ok: false,
      error: "SESSION_UNAVAILABLE",
    });
  });

  it("handles controller initialization failure", async () => {
    harness.getController.mockRejectedValueOnce(
      new Error("Initialization failed"),
    );

    expect(
      await harness.handle(
        { channel: "siteward", type: "session.status" },
        trustedSender,
      ),
    ).toEqual({
      ok: false,
      error: "SESSION_UNAVAILABLE",
    });

    expect(harness.commands.getStatus).not.toHaveBeenCalled();
  });

  it("rejects an accidental secret attached to a status response", async () => {
    const unexpectedStatus = {
      ...locked,
      vaultKeyBase64: "Must not leave the worker",
    };

    harness.commands.getStatus.mockResolvedValueOnce(unexpectedStatus);

    expect(
      await harness.handle(
        { channel: "siteward", type: "session.status" },
        trustedSender,
      ),
    ).toEqual({
      ok: false,
      error: "SESSION_UNAVAILABLE",
    });
  });
});
