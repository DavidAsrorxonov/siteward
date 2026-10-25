import { deleteDB } from "idb";
import { createVault, unlockVault } from "../crypto/vault-setup";
import { openVaultDatabase } from "./vault-database";
import { loadVault, saveNewVault } from "./vault-repository";

const PROBE_DATABASE_NAME = "siteward-persistence-probe";
const PROBE_PASSWORD = "Siteward persistence probe - dummy password";

export async function savePersistenceProbe(): Promise<string> {
  const database = await openVaultDatabase(PROBE_DATABASE_NAME);

  try {
    const created = await createVault(PROBE_PASSWORD);

    try {
      const stored = await saveNewVault(database, created.setup);

      console.info("Dummy vault saved. Keep this vault ID:");
      return stored.vaultId;
    } finally {
      created.authKey.fill(0);
    }
  } finally {
    database.close();
  }
}

export async function verifyPersistenceProbe(
  vaultIdInput: unknown,
): Promise<void> {
  const database = await openVaultDatabase(PROBE_DATABASE_NAME);

  try {
    const stored = await loadVault(database, vaultIdInput);

    if (stored === undefined) {
      throw new Error("Probe vault not found. Check the saved vault ID.");
    }

    const unlocked = await unlockVault(PROBE_PASSWORD, stored.setup, {
      vaultId: vaultIdInput,
      keyVersion: 1,
    });

    try {
      console.info("Persisted vault unlocked successfully.", {
        vaultId: stored.vaultId,
        localRevision: stored.localRevision,
        keyAlgorithm: unlocked.vaultKey.algorithm.name,
      });
    } finally {
      unlocked.authKey.fill(0);
    }
  } finally {
    database.close();
  }
}

export async function clearPersistenceProbe(): Promise<void> {
  await deleteDB(PROBE_DATABASE_NAME);
  console.info("Probe database deleted.");
}
