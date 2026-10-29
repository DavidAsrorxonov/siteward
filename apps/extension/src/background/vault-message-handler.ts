import { vaultRequestSchema } from "../shared/vault-messages.ts";
import type { VaultReply } from "../shared/vault-messages.ts";
import { createSidePanelAuthorizer } from "./sender-authorization.ts";
import type { ExtensionMessageSender } from "./sender-authorization.ts";
import type { SessionController } from "./session/session-controller.ts";
import type { createVaultReader } from "./vault-reader.ts";

interface VaultServices {
  controller: Pick<SessionController, "getStatus">;
  reader: ReturnType<typeof createVaultReader>;
}

export function createVaultMessageHandler(
  extensionId: string,
  getServices: () => Promise<VaultServices>,
) {
  const isAllowedSender = createSidePanelAuthorizer(extensionId);

  return async function handle(
    message: unknown,
    sender: ExtensionMessageSender,
    sendReply: (reply: VaultReply) => void,
  ): Promise<void> {
    let replied = false;

    function respond(reply: VaultReply): undefined {
      if (!replied) {
        replied = true;
        sendReply(reply);
      }

      return undefined;
    }

    if (!isAllowedSender(sender)) {
      respond({ ok: false, error: "UNAUTHORIZED" });
      return;
    }

    const request = vaultRequestSchema.safeParse(message);

    if (!request.success) {
      respond({ ok: false, error: "INVALID_REQUEST" });
      return;
    }

    try {
      const { controller, reader } = await getServices();
      const session = await controller.getStatus();

      if (session.status === "locked") {
        respond({ ok: false, error: "VAULT_LOCKED" });
        return;
      }

      const context = {
        vaultId: session.vaultId,
        keyVersion: session.keyVersion,
      };

      if (request.data.type === "vault.list") {
        await reader.list(context, (sites) =>
          respond({
            ok: true,
            type: "vault.list",
            sites,
          }),
        );
      } else {
        await reader.open({ ...context, id: request.data.id }, (site) =>
          respond({
            ok: true,
            type: "vault.open",
            site: site ?? null,
          }),
        );
      }
    } catch {
      respond({ ok: false, error: "VAULT_UNAVAILABLE" });
    }
  };
}
