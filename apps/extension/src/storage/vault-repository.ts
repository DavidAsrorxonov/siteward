import { vaultKeyContextSchema, vaultSetupSchema } from "@siteward/contracts";
import { z } from "zod";
import type { StoredVault, VaultDatabase } from "./vault-database.ts";

const vaultIdSchema = vaultKeyContextSchema.shape.vaultId;

const localRevisionSchema = z
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER);

const storedVaultSchema = z
  .strictObject({
    vaultId: vaultIdSchema,
    localRevision: localRevisionSchema,
    setup: vaultSetupSchema,
  })
  .refine((stored) => stored.vaultId === stored.setup.wrappedVaultKey.vaultId, {
    message: "Vault setup ID mismatch.",
    path: ["setup", "wrappedVaultKey", "vaultId"],
  });

export function parseStoredVault(
  input: unknown,
  expectedVaultId: string,
): StoredVault {
  const stored = storedVaultSchema.parse(input);

  if (stored.vaultId !== expectedVaultId) {
    throw new Error("Stored vault ID mismatch.");
  }

  return stored;
}

export async function saveNewVault(
  database: VaultDatabase,
  setupInput: unknown,
): Promise<StoredVault> {
  const setup = vaultSetupSchema.parse(setupInput);

  const stored = storedVaultSchema.parse({
    vaultId: setup.wrappedVaultKey.vaultId,
    localRevision: 1,
    setup,
  });

  await database.add("vaults", stored);

  return stored;
}

export async function loadVault(
  database: VaultDatabase,
  vaultIdInput: unknown,
): Promise<StoredVault | undefined> {
  const vaultId = vaultIdSchema.parse(vaultIdInput);
  const stored: unknown = await database.get("vaults", vaultId);

  if (stored === undefined) {
    return undefined;
  }

  return parseStoredVault(stored, vaultId);
}

export async function replaceVaultSetup(
  database: VaultDatabase,
  vaultIdInput: unknown,
  expectedRevisionInput: unknown,
  setupInput: unknown,
): Promise<StoredVault> {
  const vaultId = vaultIdSchema.parse(vaultIdInput);
  const expectedRevision = localRevisionSchema.parse(expectedRevisionInput);

  const replacement = storedVaultSchema.parse({
    vaultId,
    localRevision: expectedRevision + 1,
    setup: setupInput,
  });

  const transaction = database.transaction("vaults", "readwrite");
  const completion = transaction.done;

  // Observe early aborts; we still await the original promise below.
  void completion.catch(() => {});

  try {
    const currentInput: unknown = await transaction.store.get(vaultId);

    if (currentInput === undefined) {
      throw new Error("Vault does not exist.");
    }

    const current = parseStoredVault(currentInput, vaultId);

    if (current.localRevision !== expectedRevision) {
      throw new Error("Vault setup changed. Reload before saving.");
    }

    if (
      current.setup.wrappedVaultKey.keyVersion !==
      replacement.setup.wrappedVaultKey.keyVersion
    ) {
      throw new Error(
        "Vault key version cannot change during setup replacement.",
      );
    }

    await transaction.store.put(replacement);
    await completion;

    return replacement;
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

export async function listVaultIds(database: VaultDatabase): Promise<string[]> {
  const storedVaults = await database.getAll("vaults");

  return storedVaults.map((input) => {
    const stored = storedVaultSchema.parse(input);
    return stored.vaultId;
  });
}
