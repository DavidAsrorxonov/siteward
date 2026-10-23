import { describe, expect, it } from "vitest";
import {
  decryptBytes,
  encryptBytes,
  generateVaultKey,
} from "../../src/crypto/aes-gcm.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

describe("AES-GCM encryption", () => {
  it("decrypts to the original text, including spaces and Unicode", async () => {
    const key = await generateVaultKey();
    const original = "  Example password 🔐 日本語  ";
    const plaintext = encoder.encode(original);
    const aad = encoder.encode("test-record-1");

    const encrypted = await encryptBytes(key, plaintext, aad);
    const decrypted = await decryptBytes(key, encrypted, aad);

    expect(decoder.decode(decrypted)).toBe(original);
  });

  it("rejects decryption with a different key", async () => {
    const key = await generateVaultKey();
    const wrongKey = await generateVaultKey();
    const aad = encoder.encode("test-record-1");

    const encrypted = await encryptBytes(
      key,
      encoder.encode("Example password"),
      aad,
    );

    await expect(decryptBytes(wrongKey, encrypted, aad)).rejects.toMatchObject({
      name: "OperationError",
    });
  });

  it("rejects modified ciphertext", async () => {
    const key = await generateVaultKey();
    const aad = encoder.encode("test-record-1");

    const encrypted = await encryptBytes(
      key,
      encoder.encode("Example password"),
      aad,
    );

    const modifiedCiphertext = encrypted.ciphertext.map((byte, index) =>
      index === 0 ? byte ^ 1 : byte,
    );

    await expect(
      decryptBytes(
        key,
        {
          iv: encrypted.iv,
          ciphertext: modifiedCiphertext,
        },
        aad,
      ),
    ).rejects.toMatchObject({
      name: "OperationError",
    });
  });

  it("rejects mismatched authenticated context", async () => {
    const key = await generateVaultKey();

    const encrypted = await encryptBytes(
      key,
      encoder.encode("Example password"),
      encoder.encode("test-record-1"),
    );

    await expect(
      decryptBytes(key, encrypted, encoder.encode("test-record-2")),
    ).rejects.toMatchObject({
      name: "OperationError",
    });
  });
});
