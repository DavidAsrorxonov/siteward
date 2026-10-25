import type { VaultKeyContext } from "@siteward/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decryptBytes, encryptBytes } from "../../src/crypto/aes-gcm.ts";
import type { EncryptedBytes } from "../../src/crypto/aes-gcm.ts";
import { generateRecoveryKey } from "../../src/crypto/recovery-key.ts";
import {
  createVault,
  recoverVaultKey,
  resetVaultPassword,
  unlockVault,
} from "../../src/crypto/vault-setup.ts";
import type { CreatedVault } from "../../src/crypto/vault-setup.ts";

const oldPassword = "Original Siteward test password";
const newPassword = "Replacement Siteward test password";

const encoder = new TextEncoder();
const plaintext = encoder.encode("Data saved before password reset");
const aad = encoder.encode("password-reset-test");

describe("local password reset", () => {
  let original: CreatedVault;
  let updated: CreatedVault;
  let context: VaultKeyContext;
  let encrypted: EncryptedBytes;
  let originalSetupJson: string;
  let storedSetup: unknown;

  beforeAll(async () => {
    original = await createVault(oldPassword);

    context = {
      vaultId: original.setup.wrappedVaultKey.vaultId,
      keyVersion: original.setup.wrappedVaultKey.keyVersion,
    };

    encrypted = await encryptBytes(original.vaultKey, plaintext, aad);

    originalSetupJson = JSON.stringify(original.setup);
    storedSetup = JSON.parse(originalSetupJson);

    updated = await resetVaultPassword(
      original.recoveryKey,
      newPassword,
      storedSetup,
      context,
    );
  }, 30_000);

  afterAll(() => {
    original?.authKey.fill(0);
    updated?.authKey.fill(0);
  });

  it("unlocks existing ciphertext with the new password", async () => {
    const unlocked = await unlockVault(newPassword, updated.setup, context);

    try {
      expect(await decryptBytes(unlocked.vaultKey, encrypted, aad)).toEqual(
        plaintext,
      );

      expect(unlocked.authKey).toEqual(updated.authKey);

      expect(updated.setup.wrappedVaultKey.vaultId).toBe(context.vaultId);

      expect(updated.setup.wrappedVaultKey.keyVersion).toBe(context.keyVersion);
    } finally {
      unlocked.authKey.fill(0);
    }
  }, 30_000);

  it("recovers existing ciphertext with the new recovery key", async () => {
    expect(updated.recoveryKey).not.toBe(original.recoveryKey);

    const recovered = await recoverVaultKey(
      updated.recoveryKey,
      updated.setup,
      context,
    );

    expect(await decryptBytes(recovered, encrypted, aad)).toEqual(plaintext);
  });

  it("rejects the old password against the replacement setup", async () => {
    await expect(
      unlockVault(oldPassword, updated.setup, context),
    ).rejects.toMatchObject({
      name: "OperationError",
    });
  }, 30_000);

  it("rejects the old recovery key against the replacement setup", async () => {
    await expect(
      recoverVaultKey(original.recoveryKey, updated.setup, context),
    ).rejects.toMatchObject({
      name: "OperationError",
    });
  });

  it("rotates password settings without mutating the supplied setup", () => {
    expect(updated.setup.kdf.salt).not.toBe(original.setup.kdf.salt);

    expect(updated.authKey).not.toEqual(original.authKey);

    expect(JSON.stringify(storedSetup)).toBe(originalSetupJson);
  });

  it("rejects reset using an incorrect recovery key", async () => {
    const wrongRecoveryKey = await generateRecoveryKey();

    await expect(
      resetVaultPassword(wrongRecoveryKey, newPassword, storedSetup, context),
    ).rejects.toMatchObject({
      name: "OperationError",
    });

    expect(JSON.stringify(storedSetup)).toBe(originalSetupJson);
  });
});
