import { openVaultDatabase } from "../storage/vault-database.ts";
import { createSessionMessageHandler } from "./session-message-handler.ts";
import { createSessionController } from "./session/session-controller.ts";
import { createSessionStore } from "./session/session-store.ts";
import { createVaultMessageHandler } from "./vault-message-handler.ts";
import { createVaultReader } from "./vault-reader.ts";

const controllerReady = createSessionStore().then((store) =>
  createSessionController(store),
);

void controllerReady.catch(() => {
  console.error("Siteward session initialization failed.");
});

const vaultServicesReady = Promise.all([
  controllerReady,
  openVaultDatabase(),
]).then(([controller, database]) => ({
  controller,
  reader: createVaultReader(database, controller),
}));

void vaultServicesReady.catch(() => {
  console.error("Siteward vault initialization failed.");
});

const handleSessionMessage = createSessionMessageHandler(
  chrome.runtime.id,
  () => controllerReady,
);

const handleVaultMessage = createVaultMessageHandler(
  chrome.runtime.id,
  () => vaultServicesReady,
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

    if (
      "type" in message &&
      (message.type === "vault.list" || message.type === "vault.open")
    ) {
      void handleVaultMessage(message, sender, sendResponse).catch(() => {
        console.warn("Could not deliver Siteward vault response.");
      });
    } else {
      void handleSessionMessage(message, sender)
        .then(sendResponse)
        .catch(() => {
          console.warn("Could not deliver Siteward session response.");
        });
    }

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
