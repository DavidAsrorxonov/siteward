import type { WrappedVaultKey } from "@siteward/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decryptBytes, generateVaultKey } from "../../src/crypto/aes-gcm.ts";
import { base64ToBytes, bytesToBase64 } from "../../src/crypto/base64.ts";
import { derivePasswordKeys } from "../../src/crypto/password-keys.ts";
import type { PasswordKeys } from "../../src/crypto/password-keys.ts";
import { unwrapVaultKey, wrapVaultKey } from "../../src/crypto/vault-key.ts";

const password = "  Siteward test password 🔐  ";

const configuration = {
  configVersion: 1,
  algorithm: "argon2id",
  argon2Version: 19,
  memoryKiB: 65_536,
  iterations: 3,
  parallelism: 4,
  hashLength: 32,
  salt: "AAECAwQFBgcICQoLDA0ODw==",
};

const header = {
  wrapFormatVersion: 1,
  vaultId: "11111111-1111-4111-8111-111111111111",
  keyVersion: 1,
};

const context = {
  vaultId: header.vaultId,
  keyVersion: header.keyVersion,
};

describe("password-derived keys", () => {
  let keys: PasswordKeys;
  let vaultKey: CryptoKey;
  let wrapped: WrappedVaultKey;

  beforeAll(async () => {
    keys = await derivePasswordKeys(password, configuration);
    vaultKey = await generateVaultKey();
    wrapped = await wrapVaultKey(keys.masterKey, vaultKey, header);
  }, 30_000);

  afterAll(() => {
    keys?.authKey.fill(0);
  });

  it("matches the fixed derivation fixtures", async () => {
    expect(bytesToBase64(keys.authKey)).toBe(
      "0UOJXaSx3XPxADtBWY74PBcnZZpl4XN4ym2zhMGmqLo=",
    );

    expect(keys.masterKey.extractable).toBe(false);

    const plaintext = await decryptBytes(
      keys.masterKey,
      {
        // Fixed IV belongs only to this precomputed test fixture.
        iv: new Uint8Array(12),
        ciphertext: base64ToBytes(
          "BMvwBd0JIvVzAZs9XqrEEPkI/ZwIe13xRuZR6z5TY0jkWixGUeqk1XYrRQ==",
        ),
      },
      new TextEncoder().encode("siteward-derivation-test"),
    );

    expect(new TextDecoder().decode(plaintext)).toBe(
      "Siteward derivation fixture",
    );
  });

  it("derives the same keys again and restores the vault key", async () => {
    const repeated = await derivePasswordKeys(password, configuration);

    try {
      expect(repeated.authKey).toEqual(keys.authKey);

      const restored = await unwrapVaultKey(
        repeated.masterKey,
        wrapped,
        context,
      );

      const originalBytes = await crypto.subtle.exportKey("raw", vaultKey);

      const restoredBytes = await crypto.subtle.exportKey("raw", restored);

      expect(new Uint8Array(restoredBytes)).toEqual(
        new Uint8Array(originalBytes),
      );
    } finally {
      repeated.authKey.fill(0);
    }
  }, 30_000);

  it("treats removed password spaces as a different password", async () => {
    const changed = await derivePasswordKeys(password.trim(), configuration);

    try {
      expect(changed.authKey).not.toEqual(keys.authKey);

      await expect(
        unwrapVaultKey(changed.masterKey, wrapped, context),
      ).rejects.toMatchObject({
        name: "OperationError",
      });
    } finally {
      changed.authKey.fill(0);
    }
  }, 30_000);

  it("derives different keys when the salt changes", async () => {
    const changed = await derivePasswordKeys(password, {
      ...configuration,
      salt: bytesToBase64(new Uint8Array(16).fill(7)),
    });

    try {
      expect(changed.authKey).not.toEqual(keys.authKey);

      await expect(
        unwrapVaultKey(changed.masterKey, wrapped, context),
      ).rejects.toMatchObject({
        name: "OperationError",
      });
    } finally {
      changed.authKey.fill(0);
    }
  }, 30_000);

  it("rejects unsupported KDF settings", async () => {
    await expect(
      derivePasswordKeys(password, {
        ...configuration,
        memoryKiB: 8,
      }),
    ).rejects.toMatchObject({
      name: "ZodError",
    });
  });
});
