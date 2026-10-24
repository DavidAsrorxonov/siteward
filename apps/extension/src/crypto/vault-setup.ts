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

export interface UnlockedVault {
  vaultKey: CryptoKey;
  authKey: Uint8Array<ArrayBuffer>;
}

export interface CreatedVault extends UnlockedVault {
  setup: VaultSetup;
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
    const wrappedVaultKey = await wrapVaultKey(keys.masterKey, vaultKey, {
      wrapFormatVersion: 1,
      vaultId: crypto.randomUUID(),
      keyVersion: 1,
    });

    const setup = vaultSetupSchema.parse({
      setupVersion: 1,
      kdf,
      wrappedVaultKey,
    });

    return {
      setup,
      vaultKey,
      authKey: keys.authKey,
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
