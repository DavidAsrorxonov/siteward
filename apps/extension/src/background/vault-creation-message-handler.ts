import {
  vaultCreationReplySchema,
  vaultCreationRequestSchema,
} from "../shared/vault-creation-messages.ts";
import type { VaultCreationReply } from "../shared/vault-creation-messages.ts";
import { VaultAlreadyExistsError } from "../storage/vault-repository.ts";
import { createSidePanelAuthorizer } from "./sender-authorization.ts";
import type { ExtensionMessageSender } from "./sender-authorization.ts";
import { VaultCreationError } from "./vault-creation-coordinator.ts";
import type { VaultCreationCoordinator } from "./vault-creation-coordinator.ts";

export function createVaultCreationMessageHandler(
  extensionId: string,
  coordinator: VaultCreationCoordinator,
) {
  const isAllowedSender = createSidePanelAuthorizer(extensionId);

  return async function handle(
    message: unknown,
    sender: ExtensionMessageSender,
    sendReply: (reply: VaultCreationReply) => void,
  ): Promise<void> {
    let replied = false;
    function respond(input: VaultCreationReply): undefined {
      if (!replied) {
        const reply = vaultCreationReplySchema.parse(input);
        replied = true;
        sendReply(reply);
      }
      return undefined;
    }

    if (!isAllowedSender(sender)) {
      respond({ ok: false, error: "UNAUTHORIZED" });
      return;
    }

    const parsed = vaultCreationRequestSchema.safeParse(message);
    if (!parsed.success) {
      respond({ ok: false, error: "INVALID_REQUEST" });
      return;
    }

    try {
      const request = parsed.data;
      switch (request.type) {
        case "vault.create.prepare":
          await coordinator.prepare(request.password, (prepared) =>
            respond({ ok: true, type: request.type, ...prepared }),
          );
          break;
        case "vault.create.confirm": {
          const vaultId = await coordinator.confirm(request.token);
          respond({ ok: true, type: request.type, vaultId });
          break;
        }
        case "vault.create.cancel":
          if (!coordinator.cancelPendingCreation()) {
            respond({ ok: false, error: "CREATION_BUSY" });
          } else {
            respond({ ok: true, type: request.type });
          }
          break;
      }
    } catch (error) {
      respond({
        ok: false,
        error:
          error instanceof VaultCreationError
            ? error.code
            : error instanceof VaultAlreadyExistsError
              ? "VAULT_ALREADY_EXISTS"
              : "CREATION_FAILED",
      });
    }
  };
}
