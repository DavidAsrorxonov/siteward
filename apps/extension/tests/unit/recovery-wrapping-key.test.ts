import type { WrappedVaultKey } from "@siteward/contracts";
import { beforeAll, describe, expect, it } from "vitest";
import {
  decryptBytes,
  encryptBytes,
  generateVaultKey,
} from "../../src/crypto/aes-gcm.ts";
import { base64ToBytes } from "../../src/crypto/base64.ts";
import { generateRecoveryKey } from "../../src/crypto/recovery-key.ts";
import { deriveRecoveryWrappingKey } from "../../src/crypto/recovery-wrapping-key.ts";
import { unwrapVaultKey, wrapVaultKey } from "../../src/crypto/vault-key.ts";

// Public fixture, never a real recovery key.
const recoveryKey =
  "SW1-00010203-04050607-08090A0B-0C0D0E0F-" +
  "10111213-14151617-18191A1B-1C1D1E1F-FEAE3CAA";

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

describe("recovery key wrapping", () => {
  let vaultKey: CryptoKey;
  let wrappingKey: CryptoKey;
  let envelope: WrappedVaultKey;

  beforeAll(async () => {
    vaultKey = await generateVaultKey();

    wrappingKey = await deriveRecoveryWrappingKey(recoveryKey, context);

    envelope = await wrapVaultKey(wrappingKey, vaultKey, header);
  });

  it("matches the fixed recovery derivation fixture", async () => {
    expect(wrappingKey.extractable).toBe(false);

    const plaintext = await decryptBytes(
      wrappingKey,
      {
        // Fixed IV belongs only to this precomputed fixture.
        iv: new Uint8Array(12),
        ciphertext: base64ToBytes(
          "oHS81fW0Uvb1bdCnXPhakyNw03drKombn+PVDEhtO7z3S0UhogX/R6SzG1JstRK5FE7ckQ==",
        ),
      },
      encoder.encode("siteward-recovery-derivation-test"),
    );

    expect(new TextDecoder().decode(plaintext)).toBe(
      "Siteward recovery derivation fixture",
    );
  });

  it("restores the vault key without a master password", async () => {
    const plaintext = encoder.encode("Existing vault data");
    const aad = encoder.encode("recovery-round-trip");

    const encrypted = await encryptBytes(vaultKey, plaintext, aad);

    const stored: unknown = JSON.parse(JSON.stringify(envelope));

    const restoredWrappingKey = await deriveRecoveryWrappingKey(
      recoveryKey,
      context,
    );

    const restoredVaultKey = await unwrapVaultKey(
      restoredWrappingKey,
      stored,
      context,
    );

    expect(await decryptBytes(restoredVaultKey, encrypted, aad)).toEqual(
      plaintext,
    );
  });

  it("rejects a different recovery key with a valid checksum", async () => {
    const differentRecoveryKey = await generateRecoveryKey();

    const wrongWrappingKey = await deriveRecoveryWrappingKey(
      differentRecoveryKey,
      context,
    );

    await expect(
      unwrapVaultKey(wrongWrappingKey, envelope, context),
    ).rejects.toMatchObject({
      name: "OperationError",
    });
  });

  it.each([
    {
      label: "vault ID",
      changedContext: {
        ...context,
        vaultId: "22222222-2222-4222-8222-222222222222",
      },
    },
    {
      label: "key version",
      changedContext: {
        ...context,
        keyVersion: 2,
      },
    },
  ])("rejects relabeling the envelope's $label", async ({ changedContext }) => {
    const changedWrappingKey = await deriveRecoveryWrappingKey(
      recoveryKey,
      changedContext,
    );

    await expect(
      unwrapVaultKey(
        changedWrappingKey,
        {
          ...envelope,
          ...changedContext,
        },
        changedContext,
      ),
    ).rejects.toMatchObject({
      name: "OperationError",
    });
  });
});
