import "fake-indexeddb/auto";

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
import {
  createVault,
  resetVaultPassword,
} from "../../src/crypto/vault-setup.ts";
import type { CreatedVault } from "../../src/crypto/vault-setup.ts";
import { openVaultDatabase } from "../../src/storage/vault-database.ts";
import type { VaultDatabase } from "../../src/storage/vault-database.ts";
import {
  listVaultIds,
  loadVault,
  replaceVaultSetup,
  saveNewVault,
  saveFirstVault,
  VaultAlreadyExistsError,
} from "../../src/storage/vault-repository.ts";

describe("vault repository", () => {
  let original: CreatedVault;
  let replacement: CreatedVault;
  let vaultId: string;
  let databaseName: string;
  let database: VaultDatabase;

  beforeAll(async () => {
    original = await createVault("Original storage test password");
    vaultId = original.setup.wrappedVaultKey.vaultId;

    replacement = await resetVaultPassword(
      original.recoveryKey,
      "Replacement storage test password",
      original.setup,
      {
        vaultId,
        keyVersion: original.setup.wrappedVaultKey.keyVersion,
      },
    );
  }, 30_000);

  afterAll(() => {
    original?.authKey.fill(0);
    replacement?.authKey.fill(0);
  });

  beforeEach(async () => {
    databaseName = `siteward-test-${crypto.randomUUID()}`;
    database = await openVaultDatabase(databaseName);
  });

  afterEach(async () => {
    database?.close();
    await deleteDB(databaseName);
  });

  it("returns undefined for a missing vault", async () => {
    expect(await loadVault(database, vaultId)).toBeUndefined();
  });

  it("saves the first vault with only the encrypted setup and revision", async () => {
    const saved = await saveFirstVault(database, original.setup);
    expect(saved).toEqual({ vaultId, localRevision: 1, setup: original.setup });
    expect(await loadVault(database, vaultId)).toEqual(saved);
  });

  it("does not replace an existing vault through first-vault creation", async () => {
    const existing = await saveNewVault(database, original.setup);
    await expect(
      saveFirstVault(database, replacement.setup),
    ).rejects.toBeInstanceOf(VaultAlreadyExistsError);
    expect(await loadVault(database, vaultId)).toEqual(existing);
  });

  it("allows only one first-vault creation across competing connections", async () => {
    const secondConnection = await openVaultDatabase(databaseName);
    const secondId = crypto.randomUUID();
    // Structural fixture only: distinct IDs prove the guard is stronger than
    // the object store's duplicate-primary-key constraint. No decryption here.
    const secondSetup = {
      ...original.setup,
      wrappedVaultKey: { ...original.setup.wrappedVaultKey, vaultId: secondId },
      recovery: {
        ...original.setup.recovery,
        wrappedVaultKey: {
          ...original.setup.recovery.wrappedVaultKey,
          vaultId: secondId,
        },
      },
    };
    try {
      const results = await Promise.allSettled([
        saveFirstVault(database, original.setup),
        saveFirstVault(secondConnection, secondSetup),
      ]);
      expect(results.map((result) => result.status).sort()).toEqual([
        "fulfilled",
        "rejected",
      ]);
      const loser = results.find((result) => result.status === "rejected");
      expect(loser?.reason).toBeInstanceOf(VaultAlreadyExistsError);
      expect(await database.count("vaults")).toBe(1);
    } finally {
      secondConnection.close();
    }
  });

  it("discovers only the IDs of stored vaults", async () => {
    expect(await listVaultIds(database)).toEqual([]);

    await saveNewVault(database, original.setup);

    expect(await listVaultIds(database)).toEqual([vaultId]);
  });

  it("rejects malformed stored entries during discovery", async () => {
    await database.put("vaults", {
      vaultId,
      localRevision: 0,
      setup: original.setup,
    });

    await expect(listVaultIds(database)).rejects.toMatchObject({
      name: "ZodError",
    });
  });

  it("preserves setup after closing and reopening the connection", async () => {
    const saved = await saveNewVault(database, original.setup);

    database.close();
    database = await openVaultDatabase(databaseName);

    expect(await loadVault(database, vaultId)).toEqual(saved);
    expect(saved.localRevision).toBe(1);
  });

  it("refuses to overwrite an existing vault during creation", async () => {
    const saved = await saveNewVault(database, original.setup);

    await expect(
      saveNewVault(database, replacement.setup),
    ).rejects.toMatchObject({
      name: "ConstraintError",
    });

    expect(await loadVault(database, vaultId)).toEqual(saved);
  });

  it("rejects a setup containing the printable recovery key", async () => {
    await expect(
      saveNewVault(database, {
        ...original.setup,
        recoveryKey: original.recoveryKey,
      }),
    ).rejects.toMatchObject({
      name: "ZodError",
    });

    expect(await loadVault(database, vaultId)).toBeUndefined();
  });

  it("replaces the current revision and rejects a stale update", async () => {
    await saveNewVault(database, original.setup);

    const updated = await replaceVaultSetup(
      database,
      vaultId,
      1,
      replacement.setup,
    );

    expect(updated.localRevision).toBe(2);
    expect(updated.setup).toEqual(replacement.setup);

    await expect(
      replaceVaultSetup(database, vaultId, 1, original.setup),
    ).rejects.toThrow("Vault setup changed. Reload before saving.");

    expect(await loadVault(database, vaultId)).toEqual(updated);
  });

  it("allows only one competing update across two connections", async () => {
    await saveNewVault(database, original.setup);
    const secondConnection = await openVaultDatabase(databaseName);

    try {
      const results = await Promise.allSettled([
        replaceVaultSetup(database, vaultId, 1, replacement.setup),
        replaceVaultSetup(secondConnection, vaultId, 1, original.setup),
      ]);

      expect(results.map((result) => result.status).sort()).toEqual([
        "fulfilled",
        "rejected",
      ]);

      const winner = results.find((result) => result.status === "fulfilled");

      const loser = results.find((result) => result.status === "rejected");

      expect(loser?.reason).toMatchObject({
        message: "Vault setup changed. Reload before saving.",
      });

      expect(await loadVault(database, vaultId)).toEqual(winner?.value);
    } finally {
      secondConnection.close();
    }
  });

  it("rejects malformed data read from storage", async () => {
    // Bypass the repository to simulate malformed stored data.
    await database.put("vaults", {
      vaultId,
      localRevision: 0,
      setup: original.setup,
    });

    await expect(loadVault(database, vaultId)).rejects.toMatchObject({
      name: "ZodError",
    });
  });

  it("rejects changing the vault key version through setup replacement", async () => {
    const saved = await saveNewVault(database, original.setup);

    const changedSetup = {
      ...replacement.setup,
      wrappedVaultKey: {
        ...replacement.setup.wrappedVaultKey,
        keyVersion: 2,
      },
      recovery: {
        ...replacement.setup.recovery,
        wrappedVaultKey: {
          ...replacement.setup.recovery.wrappedVaultKey,
          keyVersion: 2,
        },
      },
    };

    await expect(
      replaceVaultSetup(database, vaultId, 1, changedSetup),
    ).rejects.toThrow(
      "Vault key version cannot change during setup replacement.",
    );

    expect(await loadVault(database, vaultId)).toEqual(saved);
  });
});
