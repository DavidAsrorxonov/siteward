import { describe, expect, it } from "vitest";
import {
  decryptBytes,
  encryptBytes,
  generateVaultKey,
} from "../../src/crypto/aes-gcm.ts";
import { base64ToBytes, bytesToBase64 } from "../../src/crypto/base64.ts";
import { unwrapVaultKey, wrapVaultKey } from "../../src/crypto/vault-key.ts";

const header = {
  wrapFormatVersion: 1,
  vaultId: "11111111-1111-4111-8111-111111111111",
  keyVersion: 1,
};

const context = {
  vaultId: header.vaultId,
  keyVersion: header.keyVersion,
};

const encoder = new TextEncoder();

describe("vault key wrapping", () => {
  it("restores a usable vault key through a JSON envelope", async () => {
    const masterKey = await generateVaultKey();
    const vaultKey = await generateVaultKey();
    const plaintext = encoder.encode("Example saved-site data");
    const aad = encoder.encode("test-record");

    const encrypted = await encryptBytes(vaultKey, plaintext, aad);
    const wrapped = await wrapVaultKey(masterKey, vaultKey, header);
    const stored: unknown = JSON.parse(JSON.stringify(wrapped));

    const restoredKey = await unwrapVaultKey(masterKey, stored, context);

    const decrypted = await decryptBytes(restoredKey, encrypted, aad);

    expect(decrypted).toEqual(plaintext);
  });

  it("rejects a different master key", async () => {
    const masterKey = await generateVaultKey();
    const wrongMasterKey = await generateVaultKey();
    const vaultKey = await generateVaultKey();

    const wrapped = await wrapVaultKey(masterKey, vaultKey, header);

    await expect(
      unwrapVaultKey(wrongMasterKey, wrapped, context),
    ).rejects.toMatchObject({
      name: "OperationError",
    });
  });

  it("rejects modified wrapped-key ciphertext", async () => {
    const masterKey = await generateVaultKey();
    const vaultKey = await generateVaultKey();
    const wrapped = await wrapVaultKey(masterKey, vaultKey, header);

    const modified = base64ToBytes(wrapped.ciphertext).map((byte, index) =>
      index === 0 ? byte ^ 1 : byte,
    );

    await expect(
      unwrapVaultKey(
        masterKey,
        {
          ...wrapped,
          ciphertext: bytesToBase64(modified),
        },
        context,
      ),
    ).rejects.toMatchObject({
      name: "OperationError",
    });
  });

  it.each([
    {
      label: "vault ID",
      expectedContext: {
        ...context,
        vaultId: "22222222-2222-4222-8222-222222222222",
      },
    },
    {
      label: "key version",
      expectedContext: {
        ...context,
        keyVersion: 2,
      },
    },
  ])("rejects an unexpected $label", async ({ expectedContext }) => {
    const masterKey = await generateVaultKey();
    const vaultKey = await generateVaultKey();
    const wrapped = await wrapVaultKey(masterKey, vaultKey, header);

    await expect(
      unwrapVaultKey(masterKey, wrapped, expectedContext),
    ).rejects.toThrow("Vault key context mismatch.");
  });

  it("rewraps under a new master key without changing record encryption", async () => {
    const oldMasterKey = await generateVaultKey();
    const newMasterKey = await generateVaultKey();
    const vaultKey = await generateVaultKey();
    const plaintext = encoder.encode("Existing saved-site data");
    const aad = encoder.encode("existing-record");

    const encrypted = await encryptBytes(vaultKey, plaintext, aad);

    const oldEnvelope = await wrapVaultKey(oldMasterKey, vaultKey, header);

    const restoredKey = await unwrapVaultKey(
      oldMasterKey,
      oldEnvelope,
      context,
    );

    const newEnvelope = await wrapVaultKey(newMasterKey, restoredKey, header);

    const rewrappedKey = await unwrapVaultKey(
      newMasterKey,
      newEnvelope,
      context,
    );

    expect(await decryptBytes(rewrappedKey, encrypted, aad)).toEqual(plaintext);

    await expect(
      unwrapVaultKey(oldMasterKey, newEnvelope, context),
    ).rejects.toMatchObject({
      name: "OperationError",
    });
  });
});
