import "fake-indexeddb/auto";

import { deleteDB, openDB } from "idb";
import type { IDBPDatabase } from "idb";
import { expect, it } from "vitest";
import { createVault } from "../../src/crypto/vault-setup.ts";
import { openVaultDatabase } from "../../src/storage/vault-database.ts";
import type {
  StoredVault,
  VaultDatabase,
} from "../../src/storage/vault-database.ts";
import { loadVault } from "../../src/storage/vault-repository.ts";

it("upgrades a version-1 database without losing vault setup", async () => {
  const databaseName = `siteward-upgrade-test-${crypto.randomUUID()}`;
  const created = await createVault("Database upgrade test password");

  let legacy: IDBPDatabase | undefined;
  let upgraded: VaultDatabase | undefined;

  try {
    // Reproduce the database layout from before this change.
    legacy = await openDB(databaseName, 1, {
      upgrade(database) {
        database.createObjectStore("vaults", {
          keyPath: "vaultId",
        });
      },
    });

    const stored: StoredVault = {
      vaultId: created.setup.wrappedVaultKey.vaultId,
      localRevision: 1,
      setup: created.setup,
    };

    await legacy.add("vaults", stored);
    legacy.close();

    // Opening through our application runs the upgrade.
    upgraded = await openVaultDatabase(databaseName);

    expect(upgraded.version).toBe(2);

    expect(await loadVault(upgraded, stored.vaultId)).toEqual(stored);

    expect(await upgraded.count("records")).toBe(0);
    expect(await upgraded.count("pendingWrites")).toBe(0);
  } finally {
    legacy?.close();
    upgraded?.close();
    created.authKey.fill(0);
    await deleteDB(databaseName);
  }
}, 30_000);
