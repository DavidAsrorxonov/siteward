import { describe, expect, it } from "vitest";
import {
  formatRecoveryKey,
  generateRecoveryKey,
  parseRecoveryKey,
} from "../../src/crypto/recovery-key.ts";

// Public test fixture, never a real recovery key.
const fixture =
  "SW1-00010203-04050607-08090A0B-0C0D0E0F-" +
  "10111213-14151617-18191A1B-1C1D1E1F-FEAE3CAA";

function fixtureBytes(): Uint8Array<ArrayBuffer> {
  return Uint8Array.from({ length: 32 }, (_, index) => index);
}

describe("recovery key text format", () => {
  it("matches the fixed format and checksum fixture", async () => {
    expect(await formatRecoveryKey(fixtureBytes())).toBe(fixture);
  });

  it("generates a key that parses and formats consistently", async () => {
    const text = await generateRecoveryKey();
    const bytes = await parseRecoveryKey(text);

    try {
      expect(bytes.byteLength).toBe(32);
      expect(await formatRecoveryKey(bytes)).toBe(text);
    } finally {
      bytes.fill(0);
    }
  });

  it("accepts lowercase and surrounding whitespace", async () => {
    const bytes = await parseRecoveryKey(` \n${fixture.toLowerCase()}\n `);

    try {
      expect(bytes).toEqual(fixtureBytes());
    } finally {
      bytes.fill(0);
    }
  });

  it("rejects a changed secret with the original checksum", async () => {
    const changed = fixture.replace("00010203", "10010203");

    await expect(parseRecoveryKey(changed)).rejects.toThrow(
      "Recovery key checksum mismatch.",
    );
  });

  it("rejects an unsupported recovery format version", async () => {
    await expect(
      parseRecoveryKey(fixture.replace("SW1-", "SW2-")),
    ).rejects.toThrow("Invalid recovery key format.");
  });

  it("rejects a source key with the wrong length", async () => {
    await expect(formatRecoveryKey(new Uint8Array(31))).rejects.toThrow(
      "Recovery keys must contain exactly 32 bytes.",
    );
  });
});
