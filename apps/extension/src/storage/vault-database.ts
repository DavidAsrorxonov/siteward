import { VaultSetup } from "@siteward/contracts";
import { openDB } from "idb";
import type { DBSchema, IDBPDatabase } from "idb";

const DATABASE_NAME = "siteward";
const DATABASE_VERSION = 1;

export interface StoredVault {
  vaultId: string;
  localRevision: number;
  setup: VaultSetup;
}

export interface SitewardDatabase extends DBSchema {
  vaults: {
    key: string;
    value: StoredVault;
  };
}

export type VaultDatabase = IDBPDatabase<SitewardDatabase>;

export async function openVaultDatabase(
  name: string = DATABASE_NAME,
): Promise<VaultDatabase> {
  const database = await openDB<SitewardDatabase>(name, DATABASE_VERSION, {
    upgrade(database, oldVersion) {
      if (oldVersion < 1) {
        database.createObjectStore("vaults", {
          keyPath: "vaultId",
        });
      }
    },
  });

  database.addEventListener("versionchange", () => {
    database.close();
  });

  return database;
}
