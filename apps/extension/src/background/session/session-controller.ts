import { createSessionQueue } from "./session-queue";
import {
  lockedSessionSchema,
  readActiveSession,
  SessionState,
  sessionStateSchema,
  unlockedSessionSchema,
} from "./session-schema";
import { SessionStore } from "./session-store";
import { vaultKeyContextSchema } from "@siteward/contracts";
import type { VaultKeyContext } from "@siteward/contracts";
import { z } from "zod";
import { base64ToBytes } from "../../crypto/base64";

export type SessionStatus =
  | {
      status: "locked";
      generation: number;
    }
  | {
      status: "unlocked";
      generation: number;
      vaultId: string;
      keyVersion: number;
      expiresAt: number;
    };

const unlockDurationSchema = z
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER);

interface PendingUnlock {
  ticket: symbol;
  generation: number;
  context: VaultKeyContext;
  durationMs: number;
  lockIntent: symbol;
}

interface SessionLease extends VaultKeyContext {
  generation: number;
  lockIntent: symbol;
}

const MAX_GENERATION = Number.MAX_SAFE_INTEGER;

export async function createSessionController(
  store: SessionStore,
  now: () => number = Date.now,
) {
  const run = createSessionQueue();
  const stored = await store.read();

  let state: SessionState =
    stored === undefined
      ? lockedSessionSchema.parse({
          sessionVersion: 1,
          status: "locked",
          generation: 0,
        })
      : sessionStateSchema.parse(stored);

  let persistenceFailed = false;
  let lockIntent = Symbol("initial");
  let pendingUnlock: PendingUnlock | undefined;

  function statusSnapshot(): SessionStatus {
    if (state.status === "locked") {
      return {
        status: "locked",
        generation: state.generation,
      };
    }

    return {
      status: "unlocked",
      generation: state.generation,
      vaultId: state.vaultId,
      keyVersion: state.keyVersion,
      expiresAt: state.expiresAt,
    };
  }

  async function persistLocked(generation: number): Promise<SessionStatus> {
    state = lockedSessionSchema.parse({
      sessionVersion: 1,
      status: "locked",
      generation,
    });

    persistenceFailed = true;

    await store.write(state);

    persistenceFailed = false;
    return statusSnapshot();
  }

  async function lockCurrent(): Promise<SessionStatus> {
    pendingUnlock = undefined;
    const generation = Math.min(state.generation + 1, MAX_GENERATION);

    return persistLocked(generation);
  }

  async function checkedStatus(): Promise<SessionStatus> {
    if (persistenceFailed) {
      throw new Error("Session persistence failed. Retry locking.");
    }

    if (
      state.status === "unlocked" &&
      (state.generation === MAX_GENERATION ||
        readActiveSession(state, now()) === undefined)
    ) {
      return lockCurrent();
    }

    return statusSnapshot();
  }

  function assertCurrentLease(lease: SessionLease): void {
    if (
      persistenceFailed ||
      state.status !== "unlocked" ||
      state.generation !== lease.generation ||
      lockIntent !== lease.lockIntent ||
      state.vaultId !== lease.vaultId ||
      state.keyVersion !== lease.keyVersion ||
      readActiveSession(state, now()) === undefined
    ) {
      throw new Error("Session changed or expired.");
    }
  }

  if (stored === undefined) {
    await persistLocked(0);
  } else {
    await checkedStatus();
  }

  return {
    getStatus(): Promise<SessionStatus> {
      return run(checkedStatus);
    },

    lock(): Promise<SessionStatus> {
      // Cancel pending work immediately, before waiting for the queue.
      lockIntent = Symbol("lock");
      pendingUnlock = undefined;

      return run(lockCurrent);
    },

    async readWithVaultKey<SitewardV>(
      contextInput: unknown,
      read: (key: CryptoKey) => SitewardV | Promise<SitewardV>,
      publish: (result: SitewardV) => undefined,
    ): Promise<void> {
      const expected = vaultKeyContextSchema.parse(contextInput);

      const captured = await run(async () => {
        await checkedStatus();

        if (state.status !== "unlocked") {
          throw new Error("Vault is locked.");
        }

        if (
          state.vaultId !== expected.vaultId ||
          state.keyVersion !== expected.keyVersion
        ) {
          throw new Error("Vault key context mismatch.");
        }

        return {
          ...expected,
          generation: state.generation,
          lockIntent,
          encodedKey: state.vaultKeyBase64,
        };
      });

      const rawKey = base64ToBytes(captured.encodedKey);
      let key: CryptoKey;

      try {
        key = await crypto.subtle.importKey(
          "raw",
          rawKey,
          { name: "AES-GCM" },
          false,
          ["encrypt", "decrypt"],
        );
      } finally {
        rawKey.fill(0);
      }

      assertCurrentLease(captured);

      const result = await read(key);

      await run(async () => {
        await checkedStatus();
        assertCurrentLease(captured);

        publish(result);
      });
    },

    beginUnlock(
      contextInput: unknown,
      durationInput: unknown,
    ): Promise<symbol> {
      return run(async () => {
        const context = vaultKeyContextSchema.parse(contextInput);
        const durationMs = unlockDurationSchema.parse(durationInput);

        await checkedStatus();

        if (state.status !== "locked") {
          throw new Error("Vault is already unlocked.");
        }

        if (state.generation >= MAX_GENERATION - 1) {
          await lockCurrent();
          throw new Error("Session generation exhausted.");
        }

        const startingIntent = lockIntent;

        // Persist a new generation and invalidate any older attempt.
        await lockCurrent();

        if (startingIntent !== lockIntent) {
          throw new Error("Unlock attempt is no longer valid.");
        }

        const ticket = Symbol("unlock");

        pendingUnlock = {
          ticket,
          generation: state.generation,
          context,
          durationMs,
          lockIntent: startingIntent,
        };

        return ticket;
      });
    },

    completeUnlock(
      ticket: symbol,
      vaultKeyBase64Input: unknown,
    ): Promise<SessionStatus> {
      return run(async () => {
        await checkedStatus();

        const attempt = pendingUnlock;

        if (
          attempt === undefined ||
          attempt.ticket !== ticket ||
          attempt.generation !== state.generation ||
          attempt.lockIntent !== lockIntent ||
          state.status !== "locked"
        ) {
          throw new Error("Unlock attempt is no longer valid.");
        }

        // Consume the ticket, even if validation or persistence fails.
        pendingUnlock = undefined;

        const unlockedAt = now();

        const candidate = unlockedSessionSchema.parse({
          sessionVersion: 1,
          status: "unlocked",
          generation: attempt.generation,
          ...attempt.context,
          unlockedAt,
          expiresAt: unlockedAt + attempt.durationMs,
          vaultKeyBase64: vaultKeyBase64Input,
        });

        persistenceFailed = true;

        try {
          await store.write(candidate);
        } catch (error) {
          // Attempt cleanup because a failed write must not grant access.
          try {
            await lockCurrent();
          } catch {
            // persistenceFailed remains true if cleanup also fails.
          }

          throw error;
        }

        // Lock or expiration may have occurred during the storage write.
        if (
          attempt.lockIntent !== lockIntent ||
          readActiveSession(candidate, now()) === undefined
        ) {
          await lockCurrent();
          throw new Error("Unlock cancelled or expired.");
        }

        state = candidate;
        persistenceFailed = false;

        return statusSnapshot();
      });
    },

    cancelUnlock(ticket: symbol): Promise<void> {
      return run(async () => {
        if (pendingUnlock?.ticket === ticket) {
          await lockCurrent();
        }
      });
    },
  };
}

export type SessionController = Awaited<
  ReturnType<typeof createSessionController>
>;
