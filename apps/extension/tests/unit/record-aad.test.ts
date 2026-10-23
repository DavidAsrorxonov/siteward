import { describe, expect, it } from "vitest";
import {
  decryptBytes,
  encryptBytes,
  generateVaultKey,
} from "../../src/crypto/aes-gcm.ts";
import { buildRecordAad } from "../../src/crypto/record-aad.ts";

const header = {
  formatVersion: 1,
  vaultId: "11111111-1111-4111-8111-111111111111",
  id: "22222222-2222-4222-8222-222222222222",
  keyVersion: 1,
  mutationId: "33333333-3333-4333-8333-333333333333",
};

describe("record AAD", () => {
  it("matches the agreed format-v1 fixture", () => {
    const result = new TextDecoder().decode(buildRecordAad(header));

    const expected =
      '["siteward-record",1,' +
      '"11111111-1111-4111-8111-111111111111",' +
      '"22222222-2222-4222-8222-222222222222",1,' +
      '"33333333-3333-4333-8333-333333333333"]';

    expect(result).toBe(expected);
  });

  it("rejects unsupported encryption-format versions", () => {
    expect(() =>
      buildRecordAad({
        ...header,
        formatVersion: 2,
      }),
    ).toThrow();
  });

  it("rejects noncanonical UUID spelling", () => {
    expect(() =>
      buildRecordAad({
        ...header,
        id: "550E8400-E29B-41D4-A716-446655440000",
      }),
    ).toThrow();
  });

  it("prevents ciphertext from being assigned to a different record", async () => {
    const key = await generateVaultKey();

    const encrypted = await encryptBytes(
      key,
      new TextEncoder().encode("Example record"),
      buildRecordAad(header),
    );

    const changedHeader = {
      ...header,
      id: "44444444-4444-4444-8444-444444444444",
    };

    await expect(
      decryptBytes(key, encrypted, buildRecordAad(changedHeader)),
    ).rejects.toMatchObject({
      name: "OperationError",
    });
  });
});
