import { beforeEach, describe, expect, it, vi } from "vitest";
import { createVaultMessageHandler } from "../../src/background/vault-message-handler.ts";
import type { SavedSite, SavedSiteSummary } from "../../src/shared/schema.ts";
import type { SessionStatus } from "../../src/shared/session-messages.ts";

const extensionId = "a".repeat(32);
const origin = `chrome-extension://${extensionId}`;

const sender = {
  id: extensionId,
  url: `${origin}/src/sidepanel/index.html`,
  origin,
  documentLifecycle: "active" as const,
};

const context = {
  vaultId: "11111111-1111-4111-8111-111111111111",
  keyVersion: 1,
};

const site: SavedSite = {
  id: "22222222-2222-4222-8222-222222222222",
  schemaVersion: 1,
  title: "Example",
  urls: ["https://example.com/login"],
  username: "example-user",
  password: "Private test password",
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
};

const summary: SavedSiteSummary = {
  id: site.id,
  title: site.title,
  urls: site.urls,
  username: site.username,
  favorite: false,
  tags: [],
};

function makeHarness() {
  const controller = {
    getStatus: vi.fn(
      async (): Promise<SessionStatus> => ({
        status: "unlocked",
        generation: 1,
        ...context,
        expiresAt: 1_700_000_060_000,
      }),
    ),
  };

  const reader = {
    list: vi.fn(
      async (
        _context: unknown,
        publish: (sites: SavedSiteSummary[]) => undefined,
      ) => {
        publish([summary]);
      },
    ),

    open: vi.fn(
      async (
        _context: unknown,
        publish: (site: SavedSite | undefined) => undefined,
      ) => {
        publish(site);
      },
    ),
  };

  const getServices = vi.fn(async () => ({
    controller,
    reader,
  }));

  const handle = createVaultMessageHandler(extensionId, getServices);

  return {
    controller,
    reader,
    getServices,
    handle,
    send: vi.fn(),
  };
}

describe("vault message handler", () => {
  let h: ReturnType<typeof makeHarness>;

  beforeEach(() => {
    h = makeHarness();
  });

  it("lists sites using the worker's active vault", async () => {
    await h.handle({ channel: "siteward", type: "vault.list" }, sender, h.send);

    expect(h.reader.list).toHaveBeenCalledWith(context, expect.any(Function));

    expect(h.send).toHaveBeenCalledExactlyOnceWith({
      ok: true,
      type: "vault.list",
      sites: [summary],
    });
  });

  it("opens the requested record in the active vault", async () => {
    await h.handle(
      { channel: "siteward", type: "vault.open", id: site.id },
      sender,
      h.send,
    );

    expect(h.reader.open).toHaveBeenCalledWith(
      { ...context, id: site.id },
      expect.any(Function),
    );

    expect(h.send).toHaveBeenCalledExactlyOnceWith({
      ok: true,
      type: "vault.open",
      site,
    });
  });

  it("represents a missing site as null", async () => {
    h.reader.open.mockImplementationOnce(async (_context, publish) => {
      publish(undefined);
    });

    await h.handle(
      { channel: "siteward", type: "vault.open", id: site.id },
      sender,
      h.send,
    );

    expect(h.send).toHaveBeenCalledExactlyOnceWith({
      ok: true,
      type: "vault.open",
      site: null,
    });
  });

  it.each(["vault.list", "vault.open"] as const)(
    "rejects %s while locked",
    async (type) => {
      h.controller.getStatus.mockResolvedValueOnce({
        status: "locked",
        generation: 2,
      });

      const request =
        type === "vault.open"
          ? { channel: "siteward", type, id: site.id }
          : { channel: "siteward", type };

      await h.handle(request, sender, h.send);

      expect(h.send).toHaveBeenCalledExactlyOnceWith({
        ok: false,
        error: "VAULT_LOCKED",
      });

      expect(h.reader.list).not.toHaveBeenCalled();
      expect(h.reader.open).not.toHaveBeenCalled();
    },
  );

  it("rejects unauthorized senders before loading services", async () => {
    await h.handle(
      { channel: "siteward", type: "vault.list" },
      { ...sender, url: "https://example.com/" },
      h.send,
    );

    expect(h.send).toHaveBeenCalledExactlyOnceWith({
      ok: false,
      error: "UNAUTHORIZED",
    });

    expect(h.getServices).not.toHaveBeenCalled();
  });

  it.each([
    { channel: "siteward", type: "vault.open", id: "invalid" },
    {
      channel: "siteward",
      type: "vault.list",
      vaultId: context.vaultId,
    },
  ])("rejects invalid request %#", async (request) => {
    await h.handle(request, sender, h.send);

    expect(h.send).toHaveBeenCalledExactlyOnceWith({
      ok: false,
      error: "INVALID_REQUEST",
    });

    expect(h.getServices).not.toHaveBeenCalled();
  });

  it("hides internal reader errors", async () => {
    h.reader.list.mockRejectedValueOnce(new Error("Private internal details"));

    await h.handle({ channel: "siteward", type: "vault.list" }, sender, h.send);

    expect(h.send).toHaveBeenCalledExactlyOnceWith({
      ok: false,
      error: "VAULT_UNAVAILABLE",
    });
  });

  it("sends the reply inside the publishing callback", async () => {
    h.reader.list.mockImplementationOnce(async (_context, publish) => {
      publish([summary]);

      // Delivery must already have happened before the reader resolves.
      expect(h.send).toHaveBeenCalledTimes(1);
    });

    await h.handle({ channel: "siteward", type: "vault.list" }, sender, h.send);

    expect(h.send).toHaveBeenCalledExactlyOnceWith({
      ok: true,
      type: "vault.list",
      sites: [summary],
    });
  });
});
