import type { VaultSetup } from "@siteward/contracts";
import { openVaultDatabase } from "../storage/vault-database.ts";
import {
  listVaultIds,
  loadVault,
  saveFirstVault,
} from "../storage/vault-repository.ts";
import { createSessionMessageHandler } from "./session-message-handler.ts";
import { createSessionController } from "./session/session-controller.ts";
import { createSessionStore } from "./session/session-store.ts";
import { createVaultUnlocker } from "./session/vault-unlocker.ts";
import { createVaultAccessMessageHandler } from "./vault-access-message-handler.ts";
import { createVaultMessageHandler } from "./vault-message-handler.ts";
import { createVaultReader } from "./vault-reader.ts";
import { createVaultCreationCoordinator } from "./vault-creation-coordinator.ts";
import { createVaultCreationMessageHandler } from "./vault-creation-message-handler.ts";

// Development setting; the production timeout is still undecided.
const DEVELOPMENT_UNLOCK_DURATION_MS = 60_000;

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
  database,
  reader: createVaultReader(database, controller),
  discover: () => listVaultIds(database),
  load: (vaultId: string) => loadVault(database, vaultId),
  unlock: createVaultUnlocker(controller),
}));

void vaultServicesReady.catch(() => {
  console.error("Siteward vault initialization failed.");
});

const vaultAccess = createVaultAccessMessageHandler(
  chrome.runtime.id,
  () => vaultServicesReady,
  DEVELOPMENT_UNLOCK_DURATION_MS,
);

const vaultCreation = createVaultCreationCoordinator(async () => {
  const { controller, database, discover } = await vaultServicesReady;
  return {
    getStatus: () => controller.getStatus(),
    discover,
    save: (setup: VaultSetup) => saveFirstVault(database, setup),
  };
});

const handleVaultCreation = createVaultCreationMessageHandler(
  chrome.runtime.id,
  vaultCreation,
);

const handleSessionMessage = createSessionMessageHandler(
  chrome.runtime.id,
  () => controllerReady,
  () => {
    vaultAccess.cancelPendingUnlock();
    vaultCreation.cancelPendingCreation();
  },
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
      (message.type === "vault.create.prepare" ||
        message.type === "vault.create.confirm" ||
        message.type === "vault.create.cancel")
    ) {
      void handleVaultCreation(message, sender, sendResponse).catch(() => {
        console.warn("Could not deliver Siteward creation response.");
      });
    } else if (
      "type" in message &&
      (message.type === "vault.discover" || message.type === "vault.unlock")
    ) {
      void vaultAccess
        .handle(message, sender)
        .then(sendResponse)
        .catch(() => {
          console.warn("Could not deliver Siteward access response.");
        });
    } else if (
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
