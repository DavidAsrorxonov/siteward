import { createSessionMessageHandler } from "./session-message-handler.ts";
import { createSessionController } from "./session/session-controller.ts";
import { createSessionStore } from "./session/session-store.ts";

const controllerReady = createSessionStore().then((store) =>
  createSessionController(store),
);

void controllerReady.catch(() => {
  console.error("Siteward session initialization failed.");
});

const handleSessionMessage = createSessionMessageHandler(
  chrome.runtime.id,
  () => controllerReady,
);

chrome.runtime.onMessage.addListener(
  (message: unknown, sender, sendResponse) => {
    if (
      typeof message !== "object" ||
      message === null ||
      !("channel" in message) ||
      message.channel !== "siteward"
    ) {
      return false;
    }

    void handleSessionMessage(message, sender)
      .then((reply) => {
        sendResponse(reply);
      })
      .catch(() => {
        console.warn("Could not deliver Siteward session response.");
      });

    return true;
  },
);

chrome.sidePanel
  .setPanelBehavior({
    openPanelOnActionClick: true,
  })
  .catch(() => {
    console.error("Failed to configure the Siteward side panel.");
  });
