import { describe, expect, it } from "vitest";

import { encryptBytes, generateVaultKey } from "../../src/crypto/aes-gcm.ts";

import { encryptRecord, decryptRecord } from "../../src/crypto/record.ts";

import { bytesToBase64 } from "../../src/crypto/base64.ts";
import { buildRecordAad } from "../../src/crypto/record-aad.ts";

const context = {
  vaultId: "11111111-1111-4111-8111-111111111111",
  id: "22222222-2222-4222-8222-222222222222",
  keyVersion: 1,
};

const header = {
  ...context,
  formatVersion: 1,
  mutationId: "33333333-3333-4333-8333-333333333333",
};

const sitePayload = {
  kind: "site",
  baseRevision: null,
  site: {
    id: context.id,
    schemaVersion: 1,
    title: "Example account",
    urls: ["https://example.com/login"],
    username: "  example-user  ",
    password: "  Example 🔐 日本語  ",
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
  },
};

// Creates authenticated but potentially invalid payloads for testing.
async function sealUnchecked(key: CryptoKey, payload: unknown) {
  const encrypted = await encryptBytes(
    key,
    new TextEncoder().encode(JSON.stringify(payload)),
    buildRecordAad(header),
  );

  return {
    ...header,
    iv: bytesToBase64(encrypted.iv),
    ciphertext: bytesToBase64(encrypted.ciphertext),
  };
}

describe("encrypted records", () => {
  it("round-trips a saved site through a JSON envelope", async () => {
    const key = await generateVaultKey();
    const envelope = await encryptRecord(key, header, sitePayload);

    const transported: unknown = JSON.parse(JSON.stringify(envelope));

    const result = await decryptRecord(key, transported, context);

    expect(result).toEqual(sitePayload);
  });

  it("round-trips an authenticated tombstone", async () => {
    const key = await generateVaultKey();

    const tombstone = {
      kind: "tombstone",
      schemaVersion: 1,
      baseRevision: 3,
      deletedAt: 1_700_000_000_001,
    };

    const envelope = await encryptRecord(key, header, tombstone);

    const result = await decryptRecord(key, envelope, context);

    expect(result).toEqual(tombstone);
  });

  it("rejects a valid envelope for a different requested record", async () => {
    const key = await generateVaultKey();
    const envelope = await encryptRecord(key, header, sitePayload);

    await expect(
      decryptRecord(key, envelope, {
        ...context,
        id: "44444444-4444-4444-8444-444444444444",
      }),
    ).rejects.toThrow("Record context mismatch.");
  });

  it("rejects an unsupported schema inside authenticated ciphertext", async () => {
    const key = await generateVaultKey();

    const envelope = await sealUnchecked(key, {
      ...sitePayload,
      site: {
        ...sitePayload.site,
        schemaVersion: 2,
      },
    });

    await expect(decryptRecord(key, envelope, context)).rejects.toThrow();
  });

  it("rejects an inner record ID that differs from its header", async () => {
    const key = await generateVaultKey();

    const envelope = await sealUnchecked(key, {
      ...sitePayload,
      site: {
        ...sitePayload.site,
        id: "44444444-4444-4444-8444-444444444444",
      },
    });

    await expect(decryptRecord(key, envelope, context)).rejects.toThrow(
      "Payload record ID does not match its header.",
    );
  });
});
