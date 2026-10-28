import {
  encryptedRecordSchema,
  recordContextSchema,
  vaultKeyContextSchema,
} from "@siteward/contracts";
import {
  pendingWriteSchema,
  StoredRecord,
  storedRecordSchema,
} from "./record-storage-schema";
import { VaultDatabase } from "./vault-database";
import { parseStoredVault } from "./vault-repository";

export async function saveNewRecord(
  database: VaultDatabase,
  envelopeInput: unknown,
  expectedContextInput: unknown,
): Promise<StoredRecord> {
  const envelope = encryptedRecordSchema.parse(envelopeInput);
  const expected = recordContextSchema.parse(expectedContextInput);

  if (
    envelope.vaultId !== expected.vaultId ||
    envelope.id !== expected.id ||
    envelope.keyVersion !== expected.keyVersion
  ) {
    throw new Error("Record context mismatch.");
  }

  const stored = storedRecordSchema.parse({
    envelope,
    localRevision: 1,
    serverRevision: null,
  });

  const pending = pendingWriteSchema.parse({
    envelope,
    baseRevision: null,
  });

  const transaction = database.transaction(
    ["vaults", "records", "pendingWrites"],
    "readwrite",
  );

  const completion = transaction.done;

  // Observe early aborts; we still await the original promise below.
  void completion.catch(() => {});

  try {
    const vaultInput: unknown = await transaction
      .objectStore("vaults")
      .get(expected.vaultId);

    if (vaultInput === undefined) {
      throw new Error("Vault does not exist.");
    }

    const vault = parseStoredVault(vaultInput, expected.vaultId);

    if (vault.setup.wrappedVaultKey.keyVersion !== expected.keyVersion) {
      throw new Error("Vault key version mismatch.");
    }

    await transaction.objectStore("records").add(stored);
    await transaction.objectStore("pendingWrites").add(pending);
    await completion;

    return stored;
  } catch (error) {
    try {
      transaction.abort();
    } catch {
      // The transaction may already have finished or aborted.
    }

    await completion.catch(() => {});
    throw error;
  }
}

export async function loadRecord(
  database: VaultDatabase,
  expectedContextInput: unknown,
): Promise<StoredRecord | undefined> {
  const expected = recordContextSchema.parse(expectedContextInput);

  const storedInput: unknown = await database.get("records", [
    expected.vaultId,
    expected.id,
  ]);

  if (storedInput === undefined) {
    return undefined;
  }

  const stored = storedRecordSchema.parse(storedInput);

  if (
    stored.envelope.vaultId !== expected.vaultId ||
    stored.envelope.id !== expected.id ||
    stored.envelope.keyVersion !== expected.keyVersion
  ) {
    throw new Error("Record context mismatch.");
  }

  return stored;
}

export async function listRecords(
  database: VaultDatabase,
  expectedVaultContextInput: unknown,
): Promise<StoredRecord[]> {
  const expected = vaultKeyContextSchema.parse(expectedVaultContextInput);

  const storedInputs: unknown[] = await database.getAllFromIndex(
    "records",
    "by-vault",
    expected.vaultId,
  );

  return storedInputs.map((input) => {
    const stored = storedRecordSchema.parse(input);

    if (
      stored.envelope.vaultId !== expected.vaultId ||
      stored.envelope.keyVersion !== expected.keyVersion
    ) {
      throw new Error("Record context mismatch.");
    }

    return stored;
  });
}
