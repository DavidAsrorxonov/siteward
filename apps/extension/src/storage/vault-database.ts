import { VaultSetup } from "@siteward/contracts";
import { openDB } from "idb";
import type { DBSchema, IDBPDatabase } from "idb";
import { PendingWrite, StoredRecord } from "./record-storage-schema";

const DATABASE_NAME = "siteward";
const DATABASE_VERSION = 2;

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

  records: {
    key: [string, string];
    value: StoredRecord;
    indexes: {
      "by-vault": string;
    };
  };

  pendingWrites: {
    key: [string, string];
    value: PendingWrite;
    indexes: {
      "by-vault": string;
      "by-record": [string, string];
    };
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

      if (oldVersion < 2) {
        const records = database.createObjectStore("records", {
          keyPath: ["envelope.vaultId", "envelope.id"],
        });

        records.createIndex("by-vault", "envelope.vaultId");

        const pendingWrites = database.createObjectStore("pendingWrites", {
          keyPath: ["envelope.vaultId", "envelope.mutationId"],
        });

        pendingWrites.createIndex("by-vault", "envelope.vaultId");
        pendingWrites.createIndex("by-record", [
          "envelope.vaultId",
          "envelope.id",
        ]);
      }
    },
  });

  database.addEventListener("versionchange", () => {
    database.close();
  });

  return database;
}
