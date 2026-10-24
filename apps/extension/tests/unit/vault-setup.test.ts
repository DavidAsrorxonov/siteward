import type { VaultKeyContext } from "@siteward/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decryptBytes, encryptBytes } from "../../src/crypto/aes-gcm.ts";
import { createVault, unlockVault } from "../../src/crypto/vault-setup.ts";
import type { CreatedVault } from "../../src/crypto/vault-setup.ts";

const password = "  Siteward setup test password 🔐  ";
const encoder = new TextEncoder();

describe("vault setup and unlock", () => {
  let created: CreatedVault;
  let context: VaultKeyContext;

  beforeAll(async () => {
    created = await createVault(password);

    // This identity comes from our own creation operation.
    context = {
      vaultId: created.setup.wrappedVaultKey.vaultId,
      keyVersion: created.setup.wrappedVaultKey.keyVersion,
    };
  }, 30_000);

  afterAll(() => {
    created?.authKey.fill(0);
  });

  it("unlocks a JSON setup and decrypts existing data", async () => {
    const plaintext = encoder.encode("Example saved-site data");
    const aad = encoder.encode("setup-round-trip");

    const encrypted = await encryptBytes(created.vaultKey, plaintext, aad);

    const stored: unknown = JSON.parse(JSON.stringify(created.setup));

    const unlocked = await unlockVault(password, stored, context);

    try {
      expect(unlocked.authKey).toEqual(created.authKey);

      const decrypted = await decryptBytes(unlocked.vaultKey, encrypted, aad);

      expect(decrypted).toEqual(plaintext);
    } finally {
      unlocked.authKey.fill(0);
    }
  }, 30_000);

  it("creates a fresh salt and vault ID for another vault", async () => {
    const another = await createVault(password);

    try {
      expect(another.setup.kdf.salt).not.toBe(created.setup.kdf.salt);

      expect(another.setup.wrappedVaultKey.vaultId).not.toBe(
        created.setup.wrappedVaultKey.vaultId,
      );

      expect(another.authKey).not.toEqual(created.authKey);
    } finally {
      another.authKey.fill(0);
    }
  }, 30_000);

  it("rejects the wrong password", async () => {
    await expect(
      unlockVault("A different password", created.setup, context),
    ).rejects.toMatchObject({
      name: "OperationError",
    });
  }, 30_000);

  it("rejects setup belonging to an unexpected vault", async () => {
    await expect(
      unlockVault(password, created.setup, {
        ...context,
        vaultId: "22222222-2222-4222-8222-222222222222",
      }),
    ).rejects.toThrow("Vault key context mismatch.");
  });

  it("rejects unsupported setup versions", async () => {
    await expect(
      unlockVault(
        password,
        {
          ...created.setup,
          setupVersion: 2,
        },
        context,
      ),
    ).rejects.toMatchObject({
      name: "ZodError",
    });
  });
});
