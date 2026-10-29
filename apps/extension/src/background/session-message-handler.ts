import {
  sessionReplySchema,
  sessionRequestSchema,
} from "../shared/session-messages.ts";
import type { SessionReply } from "../shared/session-messages.ts";
import type { SessionController } from "./session/session-controller.ts";

type SessionCommands = Pick<SessionController, "getStatus" | "lock">;

type Sender = Pick<
  chrome.runtime.MessageSender,
  "id" | "url" | "origin" | "frameId" | "documentLifecycle"
> & {
  tab?: unknown;
};

export function createSessionMessageHandler(
  extensionId: string,
  getController: () => Promise<SessionCommands>,
) {
  const origin = `chrome-extension://${extensionId}`;
  const sidePanelUrl = `${origin}/src/sidepanel/index.html`;

  function isAllowedSender(sender: Sender): boolean {
    return (
      sender.id === extensionId &&
      sender.url === sidePanelUrl &&
      sender.origin === origin &&
      sender.tab === undefined &&
      (sender.frameId === undefined || sender.frameId === 0) &&
      (sender.documentLifecycle === undefined ||
        sender.documentLifecycle === "active")
    );
  }

  return async function handle(
    message: unknown,
    sender: Sender,
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
