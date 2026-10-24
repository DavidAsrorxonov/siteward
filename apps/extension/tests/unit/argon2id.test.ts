import { argon2id } from "hash-wasm";
import { describe, expect, it } from "vitest";

describe("Argon2id implementation", () => {
  it.each([
    {
      label: "16-byte output",
      password: "a",
      salt: "abcdefgh",
      parallelism: 1,
      iterations: 2,
      memorySize: 16,
      hashLength: 16,
      expected: "f94aa50873d67fdd589d6774b87c0634",
    },
    {
      label: "32-byte output",
      password: "text demo",
      salt: "123456789",
      parallelism: 2,
      iterations: 1,
      memorySize: 64,
      hashLength: 32,
      expected:
        "b3f9d902f65bd329cf0810c78b19c746b6f46fbb8243647a8942ab83b6850d47",
    },
  ])(
    "matches the known vector for $label",
    async ({ label: _label, expected, ...parameters }) => {
      const result = await argon2id({
        ...parameters,
        outputType: "binary",
      });

      const actualHex = Array.from(result, (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");

      expect(result).toBeInstanceOf(Uint8Array);
      expect(result.byteLength).toBe(parameters.hashLength);
      expect(actualHex).toBe(expected);
    },
  );
});
