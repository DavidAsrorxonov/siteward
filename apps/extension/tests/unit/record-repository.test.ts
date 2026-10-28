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
import { saveNewRecord } from "../../src/storage/record-repository.ts";
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
});
