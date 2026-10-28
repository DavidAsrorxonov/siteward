import "fake-indexeddb/auto";

import type { EncryptedRecord, RecordContext } from "@siteward/contracts";
import { deleteDB } from "idb";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { decryptRecord, encryptRecord } from "../../src/crypto/record.ts";
import { createVault } from "../../src/crypto/vault-setup.ts";
import type { CreatedVault } from "../../src/crypto/vault-setup.ts";
import {
  saveNewRecord,
  loadRecord,
  listRecords,
} from "../../src/storage/record-repository.ts";
import { openVaultDatabase } from "../../src/storage/vault-database.ts";
import type { VaultDatabase } from "../../src/storage/vault-database.ts";
import { saveNewVault } from "../../src/storage/vault-repository.ts";

describe("record repository", () => {
  let created: CreatedVault;
  let context: RecordContext;
  let envelope: EncryptedRecord;
  let databaseName: string;
  let database: VaultDatabase;

  const recordId = "22222222-2222-4222-8222-222222222222";

  const payload = {
    kind: "site" as const,
    baseRevision: null,
    site: {
      id: recordId,
      schemaVersion: 1 as const,
      title: "Example account",
      urls: ["https://example.com/login"],
      username: "example-user",
      password: "Example test password",
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
    },
  };

  beforeAll(async () => {
    created = await createVault("Record repository test password");

    context = {
      vaultId: created.setup.wrappedVaultKey.vaultId,
      id: recordId,
      keyVersion: created.setup.wrappedVaultKey.keyVersion,
    };

    envelope = await encryptRecord(
      created.vaultKey,
      {
        formatVersion: 1,
        ...context,
        mutationId: crypto.randomUUID(),
      },
      payload,
    );
  }, 30_000);

  afterAll(() => {
    created?.authKey.fill(0);
  });

  beforeEach(async () => {
    databaseName = `siteward-record-test-${crypto.randomUUID()}`;
    database = await openVaultDatabase(databaseName);

    await saveNewVault(database, created.setup);
  });

  afterEach(async () => {
    database?.close();
    await deleteDB(databaseName);
  });

  async function expectEmptyRecordStores(): Promise<void> {
    expect(await database.count("records")).toBe(0);
    expect(await database.count("pendingWrites")).toBe(0);
  }

  function currentVaultContext() {
    return {
      vaultId: context.vaultId,
      keyVersion: context.keyVersion,
    };
  }

  it("persists the encrypted record and its pending write together", async () => {
    const saved = await saveNewRecord(database, envelope, context);

    database.close();
    database = await openVaultDatabase(databaseName);

    const persisted = await database.get("records", [
      context.vaultId,
      context.id,
    ]);

    expect(persisted).toEqual(saved);
    expect(saved).toEqual({
      envelope,
      localRevision: 1,
      serverRevision: null,
    });

    expect(
      await database.get("pendingWrites", [
        context.vaultId,
        envelope.mutationId,
      ]),
    ).toEqual({
      envelope,
      baseRevision: null,
    });

    expect(
      await decryptRecord(created.vaultKey, persisted?.envelope, context),
    ).toEqual(payload);
  });

  it("rejects a duplicate record without adding another pending write", async () => {
    const saved = await saveNewRecord(database, envelope, context);

    const anotherEnvelope = await encryptRecord(
      created.vaultKey,
      {
        formatVersion: 1,
        ...context,
        mutationId: crypto.randomUUID(),
      },
      payload,
    );

    await expect(
      saveNewRecord(database, anotherEnvelope, context),
    ).rejects.toMatchObject({
      name: "ConstraintError",
    });

    expect(
      await database.get("records", [context.vaultId, context.id]),
    ).toEqual(saved);

    expect(await database.count("pendingWrites")).toBe(1);

    expect(
      await database.get("pendingWrites", [
        context.vaultId,
        anotherEnvelope.mutationId,
      ]),
    ).toBeUndefined();
  });

  it("rolls back the record when adding the pending write fails", async () => {
    const existingPending = {
      envelope,
      baseRevision: null,
    };

    // Deliberately seed a duplicate mutation to fail the second write.
    await database.add("pendingWrites", existingPending);

    await expect(
      saveNewRecord(database, envelope, context),
    ).rejects.toMatchObject({
      name: "ConstraintError",
    });

    expect(await database.count("records")).toBe(0);
    expect(await database.count("pendingWrites")).toBe(1);

    expect(
      await database.get("pendingWrites", [
        context.vaultId,
        envelope.mutationId,
      ]),
    ).toEqual(existingPending);
  });

  it("rejects saving into a missing vault", async () => {
    await database.delete("vaults", context.vaultId);

    await expect(saveNewRecord(database, envelope, context)).rejects.toThrow(
      "Vault does not exist.",
    );

    await expectEmptyRecordStores();
  });

  it("rejects an envelope for a different requested record", async () => {
    await expect(
      saveNewRecord(database, envelope, {
        ...context,
        id: crypto.randomUUID(),
      }),
    ).rejects.toThrow("Record context mismatch.");

    await expectEmptyRecordStores();
  });

  it("rejects a key version that differs from the stored vault", async () => {
    const differentContext = {
      ...context,
      keyVersion: context.keyVersion + 1,
    };

    const differentEnvelope = await encryptRecord(
      created.vaultKey,
      {
        formatVersion: 1,
        ...differentContext,
        mutationId: crypto.randomUUID(),
      },
      payload,
    );

    await expect(
      saveNewRecord(database, differentEnvelope, differentContext),
    ).rejects.toThrow("Vault key version mismatch.");

    await expectEmptyRecordStores();
  });

  it("returns undefined when the requested record does not exist", async () => {
    expect(await loadRecord(database, context)).toBeUndefined();
  });

  it("loads a saved record that can be decrypted after reopening", async () => {
    const saved = await saveNewRecord(database, envelope, context);

    database.close();
    database = await openVaultDatabase(databaseName);

    const loaded = await loadRecord(database, context);

    expect(loaded).toEqual(saved);

    expect(
      await decryptRecord(created.vaultKey, loaded?.envelope, context),
    ).toEqual(payload);
  });

  it("rejects malformed revision metadata read from storage", async () => {
    const saved = await saveNewRecord(database, envelope, context);

    // Bypass the repository to simulate malformed stored data.
    await database.put("records", {
      ...saved,
      localRevision: 0,
    });

    await expect(loadRecord(database, context)).rejects.toMatchObject({
      name: "ZodError",
    });
  });

  it("rejects a stored record with an unexpected key version", async () => {
    const saved = await saveNewRecord(database, envelope, context);

    // Keep the lookup key unchanged but alter the envelope's version.
    await database.put("records", {
      ...saved,
      envelope: {
        ...saved.envelope,
        keyVersion: context.keyVersion + 1,
      },
    });

    await expect(loadRecord(database, context)).rejects.toThrow(
      "Record context mismatch.",
    );
  });

  it("returns an empty list when the vault has no records", async () => {
    expect(await listRecords(database, currentVaultContext())).toEqual([]);
  });

  it("lists all encrypted records belonging to the vault", async () => {
    const first = await saveNewRecord(database, envelope, context);

    const secondContext = {
      ...context,
      id: crypto.randomUUID(),
    };

    const secondEnvelope = await encryptRecord(
      created.vaultKey,
      {
        formatVersion: 1,
        ...secondContext,
        mutationId: crypto.randomUUID(),
      },
      {
        ...payload,
        site: {
          ...payload.site,
          id: secondContext.id,
          title: "Second account",
        },
      },
    );

    const second = await saveNewRecord(database, secondEnvelope, secondContext);

    const records = await listRecords(database, currentVaultContext());

    expect(records).toHaveLength(2);
    expect(records).toEqual(expect.arrayContaining([first, second]));
  });

  it("keeps records from different vaults separate", async () => {
    const ownRecord = await saveNewRecord(database, envelope, context);

    const otherVault = await createVault("Other vault listing test password");

    try {
      await saveNewVault(database, otherVault.setup);

      // Reuse the record ID to check separation by vault ID.
      const otherContext = {
        ...context,
        vaultId: otherVault.setup.wrappedVaultKey.vaultId,
        keyVersion: otherVault.setup.wrappedVaultKey.keyVersion,
      };

      const otherEnvelope = await encryptRecord(
        otherVault.vaultKey,
        {
          formatVersion: 1,
          ...otherContext,
          mutationId: crypto.randomUUID(),
        },
        payload,
      );

      const otherRecord = await saveNewRecord(
        database,
        otherEnvelope,
        otherContext,
      );

      expect(await listRecords(database, currentVaultContext())).toEqual([
        ownRecord,
      ]);

      expect(
        await listRecords(database, {
          vaultId: otherContext.vaultId,
          keyVersion: otherContext.keyVersion,
        }),
      ).toEqual([otherRecord]);
    } finally {
      otherVault.authKey.fill(0);
    }
  }, 30_000);

  it("rejects malformed metadata in a listed record", async () => {
    const saved = await saveNewRecord(database, envelope, context);

    await database.put("records", {
      ...saved,
      localRevision: 0,
    });

    await expect(
      listRecords(database, currentVaultContext()),
    ).rejects.toMatchObject({
      name: "ZodError",
    });
  });

  it("rejects an unexpected key version in a listed record", async () => {
    const saved = await saveNewRecord(database, envelope, context);

    await database.put("records", {
      ...saved,
      envelope: {
        ...saved.envelope,
        keyVersion: context.keyVersion + 1,
      },
    });

    await expect(listRecords(database, currentVaultContext())).rejects.toThrow(
      "Record context mismatch.",
    );
  });
});
