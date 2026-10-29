import "fake-indexeddb/auto";

import type { VaultKeyContext } from "@siteward/contracts";
import { deleteDB } from "idb";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createVaultReader } from "../../src/background/vault-reader.ts";
import { createSessionController } from "../../src/background/session/session-controller.ts";
import type { SessionController } from "../../src/background/session/session-controller.ts";
import { sessionStateSchema } from "../../src/background/session/session-schema.ts";
import type { SessionState } from "../../src/background/session/session-schema.ts";
import { base64ToBytes, bytesToBase64 } from "../../src/crypto/base64.ts";
import { encryptRecord } from "../../src/crypto/record.ts";
import { createVault } from "../../src/crypto/vault-setup.ts";
import type { CreatedVault } from "../../src/crypto/vault-setup.ts";
import type { SavedSite, SavedSiteSummary } from "../../src/shared/schema.ts";
import { saveNewRecord } from "../../src/storage/record-repository.ts";
import { openVaultDatabase } from "../../src/storage/vault-database.ts";
import type { VaultDatabase } from "../../src/storage/vault-database.ts";
import { saveNewVault } from "../../src/storage/vault-repository.ts";

describe("vault reader", () => {
  const now = 1_700_000_000_000;

  const site: SavedSite = {
    id: "22222222-2222-4222-8222-222222222222",
    schemaVersion: 1,
    title: "Example account",
    urls: ["https://example.com/login"],
    username: "example-user",
    password: "Private test password",
    notes: "Private test notes",
    createdAt: now,
    updatedAt: now,
  };

  let created: CreatedVault;
  let context: VaultKeyContext;
  let encodedKey: string;
  let databaseName: string;
  let database: VaultDatabase;
  let controller: SessionController;
  let reader: ReturnType<typeof createVaultReader>;

  beforeAll(async () => {
    created = await createVault("Vault reader test password");

    context = {
      vaultId: created.setup.wrappedVaultKey.vaultId,
      keyVersion: created.setup.wrappedVaultKey.keyVersion,
    };

    const raw = new Uint8Array(
      await crypto.subtle.exportKey("raw", created.vaultKey),
    );

    try {
      encodedKey = bytesToBase64(raw);
    } finally {
      raw.fill(0);
    }
  }, 30_000);

  afterAll(() => {
    created?.authKey.fill(0);
  });

  beforeEach(async () => {
    databaseName = `siteward-reader-test-${crypto.randomUUID()}`;
    database = await openVaultDatabase(databaseName);
    await saveNewVault(database, created.setup);

    let session: SessionState = {
      sessionVersion: 1,
      status: "unlocked",
      generation: 1,
      ...context,
      unlockedAt: now,
      expiresAt: now + 60_000,
      vaultKeyBase64: encodedKey,
    };

    controller = await createSessionController(
      {
        async read() {
          return structuredClone(session);
        },

        async write(input: unknown) {
          session = sessionStateSchema.parse(input);
        },
      },
      () => now,
    );

    reader = createVaultReader(database, controller);
  });

  afterEach(async () => {
    database?.close();
    await deleteDB(databaseName);
  });

  async function saveSite(value: SavedSite = site) {
    const recordContext = {
      ...context,
      id: value.id,
    };

    const envelope = await encryptRecord(
      created.vaultKey,
      {
        formatVersion: 1,
        ...recordContext,
        mutationId: crypto.randomUUID(),
      },
      {
        kind: "site",
        baseRevision: null,
        site: value,
      },
    );

    return saveNewRecord(database, envelope, recordContext);
  }

  it("publishes an empty list for an empty vault", async () => {
    const publish = vi.fn((_sites: SavedSiteSummary[]) => undefined);

    await reader.list(context, publish);

    expect(publish).toHaveBeenCalledExactlyOnceWith([]);
  });

  it("publishes summaries without passwords or notes", async () => {
    await saveSite();

    const publish = vi.fn((_sites: SavedSiteSummary[]) => undefined);

    await reader.list(context, publish);

    expect(publish).toHaveBeenCalledExactlyOnceWith([
      {
        id: site.id,
        title: site.title,
        urls: site.urls,
        username: site.username,
        favorite: false,
        tags: [],
      },
    ]);
  });

  it("opens the full details of a selected site", async () => {
    await saveSite();

    const publish = vi.fn((_site: SavedSite | undefined) => undefined);

    await reader.open({ ...context, id: site.id }, publish);

    expect(publish).toHaveBeenCalledExactlyOnceWith(site);
  });

  it("publishes undefined for a missing record", async () => {
    const publish = vi.fn((_site: SavedSite | undefined) => undefined);

    await reader.open({ ...context, id: crypto.randomUUID() }, publish);

    expect(publish).toHaveBeenCalledExactlyOnceWith(undefined);
  });

  it("omits verified tombstones from lists and details", async () => {
    const envelope = await encryptRecord(
      created.vaultKey,
      {
        formatVersion: 1,
        ...context,
        id: site.id,
        mutationId: crypto.randomUUID(),
      },
      {
        kind: "tombstone",
        schemaVersion: 1,
        baseRevision: 1,
        deletedAt: now,
      },
    );

    // Simulate a stored deletion; deletion writes come later.
    await database.put("records", {
      envelope,
      localRevision: 1,
      serverRevision: 2,
    });

    const publishList = vi.fn((_sites: SavedSiteSummary[]) => undefined);

    const publishSite = vi.fn((_site: SavedSite | undefined) => undefined);

    await reader.list(context, publishList);
    await reader.open({ ...context, id: site.id }, publishSite);

    expect(publishList).toHaveBeenCalledExactlyOnceWith([]);
    expect(publishSite).toHaveBeenCalledExactlyOnceWith(undefined);
  });

  it("rejects tampered records without publishing a partial list", async () => {
    await saveSite();

    const damaged = await saveSite({
      ...site,
      id: "33333333-3333-4333-8333-333333333333",
      title: "Damaged account",
    });

    const ciphertext = base64ToBytes(damaged.envelope.ciphertext);

    ciphertext[0] = ciphertext[0]! ^ 1;

    await database.put("records", {
      ...damaged,
      envelope: {
        ...damaged.envelope,
        ciphertext: bytesToBase64(ciphertext),
      },
    });

    const publish = vi.fn((_sites: SavedSiteSummary[]) => undefined);

    await expect(reader.list(context, publish)).rejects.toMatchObject({
      name: "OperationError",
    });

    expect(publish).not.toHaveBeenCalled();
  });

  it("rejects list and detail requests while locked", async () => {
    await saveSite();
    await controller.lock();

    const publishList = vi.fn((_sites: SavedSiteSummary[]) => undefined);

    const publishSite = vi.fn((_site: SavedSite | undefined) => undefined);

    await expect(reader.list(context, publishList)).rejects.toThrow(
      "Vault is locked.",
    );

    await expect(
      reader.open({ ...context, id: site.id }, publishSite),
    ).rejects.toThrow("Vault is locked.");

    expect(publishList).not.toHaveBeenCalled();
    expect(publishSite).not.toHaveBeenCalled();
  });

  it("rejects requests for another vault", async () => {
    await saveSite();

    const publish = vi.fn((_sites: SavedSiteSummary[]) => undefined);

    await expect(
      reader.list({ ...context, vaultId: crypto.randomUUID() }, publish),
    ).rejects.toThrow("Vault key context mismatch.");

    expect(publish).not.toHaveBeenCalled();
  });
});
