import { vaultSetupSchema } from "@siteward/contracts";
import type { VaultSetup } from "@siteward/contracts";
import { createVault } from "../crypto/vault-setup.ts";
import type { CreatedVault } from "../crypto/vault-setup.ts";
import type { SessionStatus } from "../shared/session-messages.ts";
import {
  creationTokenSchema,
  newMasterPasswordSchema,
  preparedVaultSchema,
} from "../shared/vault-creation-messages.ts";
import type {
  PreparedVault,
  VaultCreationErrorCode,
} from "../shared/vault-creation-messages.ts";
import type { StoredVault } from "../storage/vault-database.ts";

export interface VaultCreationServices {
  getStatus(): Promise<SessionStatus>;
  discover(): Promise<string[]>;
  save(setup: VaultSetup): Promise<StoredVault>;
}

export class VaultCreationError extends Error {
  constructor(readonly code: VaultCreationErrorCode) {
    super(code);
    this.name = "VaultCreationError";
  }
}

interface PendingCreation {
  token: string;
  setup: VaultSetup;
}

interface CreationOperation {
  phase: "preparing" | "confirming" | "saving";
  cancelled: boolean;
}

export function createVaultCreationCoordinator(
  getServices: () => Promise<VaultCreationServices>,
  derive: typeof createVault = createVault,
) {
  // Only the encrypted setup and an opaque confirmation token survive prepare.
  // These are intentionally not restored after a worker restart.
  let pending: PendingCreation | undefined;
  let active: CreationOperation | undefined;

  function assertActive(operation: CreationOperation): void {
    if (operation.cancelled || active !== operation) {
      throw new VaultCreationError("CREATION_CANCELLED");
    }
  }

  async function assertLocked(services: VaultCreationServices): Promise<void> {
    if ((await services.getStatus()).status !== "locked") {
      throw new VaultCreationError("SESSION_NOT_LOCKED");
    }
  }

  function cancelPendingCreation(): boolean {
    // Confirmation has crossed its commit boundary. Never claim to cancel a
    // write that might already have committed; it still creates a locked vault.
    if (active?.phase === "saving") return false;
    if (active !== undefined) active.cancelled = true;
    pending = undefined;
    return true;
  }

  async function prepare(
    passwordInput: unknown,
    publish: (prepared: PreparedVault) => undefined,
  ): Promise<void> {
    const password = newMasterPasswordSchema.parse(passwordInput);
    if (active !== undefined || pending !== undefined) {
      throw new VaultCreationError("CREATION_BUSY");
    }

    const operation: CreationOperation = {
      phase: "preparing",
      cancelled: false,
    };
    active = operation;
    let created: CreatedVault | undefined;

    try {
      const services = await getServices();
      assertActive(operation);
      await assertLocked(services);
      assertActive(operation);
      const ids = await services.discover();
      assertActive(operation);
      if (ids.length !== 0) {
        throw new VaultCreationError("VAULT_ALREADY_EXISTS");
      }

      created = await derive(password);
      created.authKey.fill(0);
      assertActive(operation);

      const setup = vaultSetupSchema.parse(created.setup);
      const prepared = preparedVaultSchema.parse({
        token: crypto.randomUUID(),
        vaultId: setup.wrappedVaultKey.vaultId,
        recoveryKey: created.recoveryKey,
      });

      pending = { token: prepared.token, setup };
      // No await between the cancellation check and delivery of the secret.
      publish(prepared);
    } catch (error) {
      pending = undefined;
      throw error;
    } finally {
      created?.authKey.fill(0);
      if (active === operation) active = undefined;
    }
  }

  async function confirm(tokenInput: unknown): Promise<string> {
    const token = creationTokenSchema.parse(tokenInput);
    if (active !== undefined) throw new VaultCreationError("CREATION_BUSY");
    if (pending === undefined || pending.token !== token) {
      throw new VaultCreationError("CREATION_EXPIRED");
    }

    const setup = pending.setup;
    pending = undefined;
    const operation: CreationOperation = {
      phase: "confirming",
      cancelled: false,
    };
    active = operation;

    try {
      const services = await getServices();
      assertActive(operation);
      await assertLocked(services);
      assertActive(operation);

      // The repository repeats the empty-database check inside its transaction.
      operation.phase = "saving";
      await services.save(setup);
      return setup.wrappedVaultKey.vaultId;
    } finally {
      if (active === operation) active = undefined;
    }
  }

  return { prepare, confirm, cancelPendingCreation };
}

export type VaultCreationCoordinator = ReturnType<
  typeof createVaultCreationCoordinator
>;
