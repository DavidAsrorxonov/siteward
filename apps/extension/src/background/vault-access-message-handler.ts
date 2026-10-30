import {
  vaultAccessReplySchema,
  vaultAccessRequestSchema,
} from "../shared/vault-access-messages";
import type { VaultAccessReply } from "../shared/vault-access-messages";
import type { StoredVault } from "../storage/vault-database";
import { createSidePanelAuthorizer } from "./sender-authorization";
import type { ExtensionMessageSender } from "./sender-authorization";
import type { createVaultUnlocker } from "./session/vault-unlocker";

export interface VaultAccessServices {
  discover(): Promise<string[]>;
  load(vaultId: string): Promise<StoredVault | undefined>;
  unlock: ReturnType<typeof createVaultUnlocker>;
}

export function createVaultAccessMessageHandler(
  extensionId: string,
  getServices: () => Promise<VaultAccessServices>,
  durationMs: number,
) {
  const isAllowedSender = createSidePanelAuthorizer(extensionId);

  let activeAttempt: AbortController | undefined;

  function cancelPendingUnlock(): void {
    activeAttempt?.abort();
  }

  async function handle(
    message: unknown,
    sender: ExtensionMessageSender,
  ): Promise<VaultAccessReply> {
    if (!isAllowedSender(sender)) {
      return { ok: false, error: "UNAUTHORIZED" };
    }

    const parsed = vaultAccessRequestSchema.safeParse(message);

    if (!parsed.success) {
      return { ok: false, error: "INVALID_REQUEST" };
    }

    const request = parsed.data;

    if (request.type === "vault.discover") {
      try {
        const services = await getServices();
        const vaultIds = await services.discover();

        return vaultAccessReplySchema.parse({
          ok: true,
          type: "vault.discover",
          vaultIds,
        });
      } catch {
        return { ok: false, error: "VAULT_UNAVAILABLE" };
      }
    }

    if (activeAttempt !== undefined) {
      return { ok: false, error: "UNLOCK_BUSY" };
    }

    // Register before the first await, including service initialization.
    const attempt = new AbortController();
    activeAttempt = attempt;

    try {
      const services = await getServices();
      attempt.signal.throwIfAborted();

      const stored = await services.load(request.vaultId);
      attempt.signal.throwIfAborted();

      if (stored === undefined) {
        return { ok: false, error: "UNLOCK_FAILED" };
      }

      const session = await services.unlock(
        request.password,
        stored.setup,
        {
          vaultId: stored.vaultId,
          keyVersion: stored.setup.wrappedVaultKey.keyVersion,
        },
        durationMs,
        attempt.signal,
      );

      attempt.signal.throwIfAborted();

      return vaultAccessReplySchema.parse({
        ok: true,
        type: "vault.unlock",
        session,
      });
    } catch {
      return { ok: false, error: "UNLOCK_FAILED" };
    } finally {
      if (activeAttempt === attempt) {
        activeAttempt = undefined;
      }
    }
  }

  return { handle, cancelPendingUnlock };
}
