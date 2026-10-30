import {
  sessionReplySchema,
  sessionRequestSchema,
} from "../shared/session-messages.ts";
import type { SessionReply } from "../shared/session-messages.ts";
import type { SessionController } from "./session/session-controller.ts";
import { createSidePanelAuthorizer } from "./sender-authorization.ts";
import type { ExtensionMessageSender } from "./sender-authorization.ts";

type SessionCommands = Pick<SessionController, "getStatus" | "lock">;

export function createSessionMessageHandler(
  extensionId: string,
  getController: () => Promise<SessionCommands>,
  onLockRequested: () => void = () => {},
) {
  const isAllowedSender = createSidePanelAuthorizer(extensionId);

  return async function handle(
    message: unknown,
    sender: ExtensionMessageSender,
  ): Promise<SessionReply> {
    if (!isAllowedSender(sender)) {
      return {
        ok: false,
        error: "UNAUTHORIZED",
      };
    }

    const request = sessionRequestSchema.safeParse(message);

    if (!request.success) {
      return {
        ok: false,
        error: "INVALID_REQUEST",
      };
    }

    try {
      if (request.data.type === "session.lock") {
        onLockRequested();
      }

      const controller = await getController();

      const session =
        request.data.type === "session.status"
          ? await controller.getStatus()
          : await controller.lock();

      return sessionReplySchema.parse({
        ok: true,
        session,
      });
    } catch {
      return {
        ok: false,
        error: "SESSION_UNAVAILABLE",
      };
    }
  };
}
