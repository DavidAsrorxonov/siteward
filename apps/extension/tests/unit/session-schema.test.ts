import { describe, expect, it } from "vitest";
import { bytesToBase64 } from "../../src/crypto/base64.ts";
import {
  readActiveSession,
  sessionStateSchema,
} from "../../src/background/session/session-schema.ts";

describe("session state", () => {
  const unlockedAt = 1_700_000_000_000;
  const expiresAt = unlockedAt + 60_000;

  // Dummy test bytes, not a real vault key.
  const vaultKeyBase64 = bytesToBase64(new Uint8Array(32).fill(7));

  const unlocked = {
    sessionVersion: 1 as const,
    status: "unlocked" as const,
    generation: 3,
    vaultId: "11111111-1111-4111-8111-111111111111",
    keyVersion: 1,
    unlockedAt,
    expiresAt,
    vaultKeyBase64,
  };

  const locked = {
    sessionVersion: 1 as const,
    status: "locked" as const,
    generation: 4,
  };

  it("round-trips an unlocked session through JSON", () => {
    const restored: unknown = JSON.parse(JSON.stringify(unlocked));

    expect(sessionStateSchema.parse(restored)).toEqual(unlocked);
  });

  it("accepts a locked state but rejects a key attached to it", () => {
    expect(sessionStateSchema.parse(locked)).toEqual(locked);

    expect(
      sessionStateSchema.safeParse({
        ...locked,
        vaultKeyBase64,
      }).success,
    ).toBe(false);
  });

  it("rejects a key that is not exactly 32 bytes", () => {
    expect(
      sessionStateSchema.safeParse({
        ...unlocked,
        vaultKeyBase64: bytesToBase64(new Uint8Array(31)),
      }).success,
    ).toBe(false);
  });

  it("rejects an expiration that does not follow unlock time", () => {
    for (const invalidExpiration of [unlockedAt, unlockedAt - 1]) {
      expect(
        sessionStateSchema.safeParse({
          ...unlocked,
          expiresAt: invalidExpiration,
        }).success,
      ).toBe(false);
    }
  });

  it("accepts a session within its valid time window", () => {
    expect(readActiveSession(unlocked, unlockedAt)).toEqual(unlocked);

    expect(readActiveSession(unlocked, expiresAt - 1)).toEqual(unlocked);
  });

  it("rejects a session at and after its expiration", () => {
    expect(readActiveSession(unlocked, expiresAt)).toBeUndefined();

    expect(readActiveSession(unlocked, expiresAt + 1)).toBeUndefined();
  });

  it("treats missing, malformed, and locked state as inactive", () => {
    const inactiveStates: unknown[] = [
      undefined,
      null,
      {},
      locked,
      { ...unlocked, generation: -1 },
      { ...unlocked, vaultKeyBase64: "invalid" },
    ];

    for (const state of inactiveStates) {
      expect(readActiveSession(state, unlockedAt)).toBeUndefined();
    }
  });

  it("rejects invalid time values and times before unlock", () => {
    const invalidTimes: unknown[] = [
      undefined,
      "1700000000000",
      Number.NaN,
      Number.POSITIVE_INFINITY,
      -1,
      unlockedAt - 1,
    ];

    for (const now of invalidTimes) {
      expect(readActiveSession(unlocked, now)).toBeUndefined();
    }
  });
});
