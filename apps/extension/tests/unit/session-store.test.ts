import { beforeEach, describe, expect, it, vi } from "vitest";
import { bytesToBase64 } from "../../src/crypto/base64.ts";
import {
  createSessionStore,
  SESSION_STORAGE_KEY,
} from "../../src/background/session/session-store.ts";
import type {
  SessionStorageArea,
  SessionStore,
} from "../../src/background/session/session-store.ts";

function makeFakeArea() {
  const data: Record<string, unknown> = {};

  const area = {
    get: vi.fn(async (key: string) => {
      return {
        [key]: structuredClone(data[key]),
      };
    }),

    set: vi.fn(async (items: Record<string, unknown>) => {
      Object.assign(data, structuredClone(items));
    }),

    setAccessLevel: vi.fn(
      async (_options: {
        accessLevel: "TRUSTED_CONTEXTS";
      }): Promise<void> => {},
    ),
  } satisfies SessionStorageArea;

  return { data, area };
}

describe("session store", () => {
  let fake: ReturnType<typeof makeFakeArea>;
  let store: SessionStore;

  const unlocked = {
    sessionVersion: 1 as const,
    status: "unlocked" as const,
    generation: 3,
    vaultId: "11111111-1111-4111-8111-111111111111",
    keyVersion: 1,
    unlockedAt: 1_700_000_000_000,
    expiresAt: 1_700_000_060_000,
    vaultKeyBase64: bytesToBase64(new Uint8Array(32).fill(7)),
  };

  const locked = {
    sessionVersion: 1 as const,
    status: "locked" as const,
    generation: 4,
  };

  beforeEach(async () => {
    fake = makeFakeArea();
    store = await createSessionStore(fake.area);
  });

  it("restricts access and returns undefined for missing state", async () => {
    expect(fake.area.setAccessLevel).toHaveBeenCalledWith({
      accessLevel: "TRUSTED_CONTEXTS",
    });

    expect(await store.read()).toBeUndefined();
  });

  it("restores an unlocked state through a new adapter instance", async () => {
    await store.write(unlocked);

    const reopened = await createSessionStore(fake.area);

    expect(await reopened.read()).toEqual(unlocked);
  });

  it("replaces unlocked state with a key-free locked state", async () => {
    fake.data["unrelated-setting"] = "keep";

    await store.write(unlocked);
    await store.write(locked);

    expect(await store.read()).toEqual(locked);

    expect(fake.data[SESSION_STORAGE_KEY]).not.toHaveProperty("vaultKeyBase64");

    expect(fake.data["unrelated-setting"]).toBe("keep");
  });

  it("returns undefined for malformed stored state", async () => {
    fake.data[SESSION_STORAGE_KEY] = {
      ...unlocked,
      generation: -1,
    };

    expect(await store.read()).toBeUndefined();
  });

  it("rejects invalid writes without replacing stored state", async () => {
    await store.write(locked);

    await expect(
      store.write({
        ...unlocked,
        password: "This must not enter session storage",
      }),
    ).rejects.toMatchObject({
      name: "ZodError",
    });

    expect(await store.read()).toEqual(locked);
    expect(fake.area.set).toHaveBeenCalledTimes(1);
  });

  it("rejects initialization when access restriction fails", async () => {
    const failing = makeFakeArea();

    failing.area.setAccessLevel.mockRejectedValueOnce(
      new Error("Access restriction failed"),
    );

    await expect(createSessionStore(failing.area)).rejects.toThrow(
      "Access restriction failed",
    );

    expect(failing.area.get).not.toHaveBeenCalled();
    expect(failing.area.set).not.toHaveBeenCalled();
  });

  it("propagates storage read and write failures", async () => {
    fake.area.get.mockRejectedValueOnce(new Error("Read failed"));

    await expect(store.read()).rejects.toThrow("Read failed");

    fake.area.set.mockRejectedValueOnce(new Error("Write failed"));

    await expect(store.write(locked)).rejects.toThrow("Write failed");
  });
});
