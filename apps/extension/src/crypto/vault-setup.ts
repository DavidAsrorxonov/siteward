import {
  PasswordKdf,
  vaultKeyContextSchema,
  VaultSetup,
  vaultSetupSchema,
} from "@siteward/contracts";
import { bytesToBase64 } from "./base64";
import { derivePasswordKeys } from "./password-keys";
import { generateVaultKey } from "./aes-gcm";
import { unwrapVaultKey, wrapVaultKey } from "./vault-key";
import { generateRecoveryKey } from "./recovery-key.ts";
import { deriveRecoveryWrappingKey } from "./recovery-wrapping-key.ts";

export interface UnlockedVault {
  vaultKey: CryptoKey;
  authKey: Uint8Array<ArrayBuffer>;
}

export interface CreatedVault extends UnlockedVault {
  setup: VaultSetup;
  recoveryKey: string;
}

export async function createVault(
  passwordInput: unknown,
): Promise<CreatedVault> {
  const kdf: PasswordKdf = {
    configVersion: 1,
    algorithm: "argon2id",
    argon2Version: 19,
    memoryKiB: 65_536,
    iterations: 3,
    parallelism: 4,
    hashLength: 32,
    salt: bytesToBase64(crypto.getRandomValues(new Uint8Array(16))),
  };

  const keys = await derivePasswordKeys(passwordInput, kdf);

  try {
    const vaultKey = await generateVaultKey();
    const header = {
      wrapFormatVersion: 1,
      vaultId: crypto.randomUUID(),
      keyVersion: 1,
    };

    const context = {
      vaultId: header.vaultId,
      keyVersion: header.keyVersion,
    };

    const wrappedVaultKey = await wrapVaultKey(
      keys.masterKey,
      vaultKey,
      header,
    );

    const recoveryKey = await generateRecoveryKey();

    const recoveryWrappingKey = await deriveRecoveryWrappingKey(
      recoveryKey,
      context,
    );

    const recoveryWrappedVaultKey = await wrapVaultKey(
      recoveryWrappingKey,
      vaultKey,
      header,
    );

    const setup = vaultSetupSchema.parse({
      setupVersion: 2,
      kdf,
      wrappedVaultKey,
      recovery: {
        recoveryVersion: 1,
        wrappedVaultKey: recoveryWrappedVaultKey,
      },
    });

    return {
      setup,
      vaultKey,
      authKey: keys.authKey,
      recoveryKey,
    };
  } catch (error) {
    keys.authKey.fill(0);
    throw error;
  }
}

export async function unlockVault(
  passwordInput: unknown,
  setupInput: unknown,
  expectedContextInput: unknown,
): Promise<UnlockedVault> {
  const setup = vaultSetupSchema.parse(setupInput);
  const expected = vaultKeyContextSchema.parse(expectedContextInput);
  const wrapped = setup.wrappedVaultKey;

  if (
    wrapped.keyVersion !== expected.keyVersion ||
    wrapped.vaultId !== expected.vaultId
  ) {
    throw new Error("Vault key context mismatch.");
  }

  const keys = await derivePasswordKeys(passwordInput, setup.kdf);

  try {
    const vaultKey = await unwrapVaultKey(keys.masterKey, wrapped, expected);

    return {
      vaultKey,
      authKey: keys.authKey,
    };
  } catch (error) {
    keys.authKey.fill(0);
    throw error;
  }
}

export async function recoverVaultKey(
  recoveryKeyInput: unknown,
  setupInput: unknown,
  expectedContextInput: unknown,
): Promise<CryptoKey> {
  const setup = vaultSetupSchema.parse(setupInput);
  const expected = vaultKeyContextSchema.parse(expectedContextInput);
  const wrapped = setup.recovery.wrappedVaultKey;

  if (
    wrapped.vaultId !== expected.vaultId ||
    wrapped.keyVersion !== expected.keyVersion
  ) {
    throw new Error("Vault key context mismatch.");
  }

  const wrappingKey = await deriveRecoveryWrappingKey(
    recoveryKeyInput,
    expected,
  );

  return unwrapVaultKey(wrappingKey, wrapped, expected);
}
