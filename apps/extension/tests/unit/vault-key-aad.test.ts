import { describe, expect, it } from "vitest";
import {
  decryptBytes,
  encryptBytes,
  generateVaultKey,
} from "../../src/crypto/aes-gcm.ts";
import { buildVaultKeyAad } from "../../src/crypto/vault-key-aad.ts";

const header = {
  wrapFormatVersion: 1,
  vaultId: "11111111-1111-4111-8111-111111111111",
  keyVersion: 1,
};

describe("vault key AAD", () => {
  it("matches the agreed wrap-format-v1 fixture", () => {
    const result = new TextDecoder().decode(buildVaultKeyAad(header));

    const expected =
      '["siteward-vault-key",1,' + '"11111111-1111-4111-8111-111111111111",1]';

    expect(result).toBe(expected);
  });

  it("rejects unsupported wrapping-format versions", () => {
    expect(() =>
      buildVaultKeyAad({
        ...header,
        wrapFormatVersion: 2,
      }),
    ).toThrow();
  });

  it.each([
    {
      label: "vault ID",
      changedHeader: {
        ...header,
        vaultId: "22222222-2222-4222-8222-222222222222",
      },
    },
    {
      label: "key version",
      changedHeader: {
        ...header,
        keyVersion: 2,
      },
    },
  ])(
    "rejects a changed $label during decryption",
    async ({ changedHeader }) => {
      const key = await generateVaultKey();
      const plaintext = crypto.getRandomValues(new Uint8Array(32));

      const encrypted = await encryptBytes(
        key,
        plaintext,
        buildVaultKeyAad(header),
      );

      await expect(
        decryptBytes(key, encrypted, buildVaultKeyAad(changedHeader)),
      ).rejects.toMatchObject({
        name: "OperationError",
      });
    },
  );
});
