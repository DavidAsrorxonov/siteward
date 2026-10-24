import {
  vaultKeyContextSchema,
  vaultKeyHeaderSchema,
  WrappedVaultKey,
  wrappedVaultKeySchema,
} from "@siteward/contracts";
import { buildVaultKeyAad } from "./vault-key-aad";
import { decryptBytes, encryptBytes } from "./aes-gcm";
import { base64ToBytes, bytesToBase64 } from "./base64";

function assertAes256Key(key: CryptoKey): void {
  const algorithm = key.algorithm as Partial<AesKeyAlgorithm>;

  if (
    key.type !== "secret" ||
    algorithm.name !== "AES-GCM" ||
    algorithm.length !== 256
  ) {
    throw new Error("Expected an AES-256-GCM key.");
  }
}

export async function wrapVaultKey(
  masterKey: CryptoKey,
  vaultKey: CryptoKey,
  headerInput: unknown,
): Promise<WrappedVaultKey> {
  const header = vaultKeyHeaderSchema.parse(headerInput);

  assertAes256Key(masterKey);
  assertAes256Key(vaultKey);

  const rawKey = new Uint8Array(await crypto.subtle.exportKey("raw", vaultKey));

  try {
    const encrypted = await encryptBytes(
      masterKey,
      rawKey,
      buildVaultKeyAad(header),
    );

    return wrappedVaultKeySchema.parse({
      ...header,
      iv: bytesToBase64(encrypted.iv),
      ciphertext: bytesToBase64(encrypted.ciphertext),
    });
  } finally {
    rawKey.fill(0);
  }
}

export async function unwrapVaultKey(
  masterKey: CryptoKey,
  envelopeInput: unknown,
  expectedContextInput: unknown,
): Promise<CryptoKey> {
  const envelope = wrappedVaultKeySchema.parse(envelopeInput);
  const expected = vaultKeyContextSchema.parse(expectedContextInput);

  assertAes256Key(masterKey);

  const { iv, ciphertext, ...header } = envelope;

  if (
    header.vaultId !== expected.vaultId ||
    header.keyVersion !== expected.keyVersion
  ) {
    throw new Error("Vault key context mismatch.");
  }

  const rawKey = await decryptBytes(
    masterKey,
    {
      iv: base64ToBytes(iv),
      ciphertext: base64ToBytes(ciphertext),
    },
    buildVaultKeyAad(header),
  );

  try {
    if (rawKey.byteLength !== 32) {
      throw new Error("Invalid vault key length.");
    }

    return await crypto.subtle.importKey(
      "raw",
      rawKey,
      { name: "AES-GCM" },
      true,
      ["encrypt", "decrypt"],
    );
  } finally {
    rawKey.fill(0);
  }
}
