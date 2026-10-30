import "fake-indexeddb/auto";
import { deleteDB } from "idb";
import type { VaultSetup } from "@siteward/contracts";
import { expect, it } from "vitest";
import { createVaultCreationCoordinator } from "../../src/background/vault-creation-coordinator.ts";
import { createSessionController } from "../../src/background/session/session-controller.ts";
import { createVaultUnlocker } from "../../src/background/session/vault-unlocker.ts";
import { sessionStateSchema } from "../../src/background/session/session-schema.ts";
import type { SessionState } from "../../src/background/session/session-schema.ts";
import type { PreparedVault } from "../../src/shared/vault-creation-messages.ts";
import { openVaultDatabase } from "../../src/storage/vault-database.ts";
import {
  listVaultIds,
  loadVault,
  saveFirstVault,
} from "../../src/storage/vault-repository.ts";

it("creates a locked vault after confirmation, then unlocks it with the entered password", async () => {
  const databaseName = `siteward-creation-flow-${crypto.randomUUID()}`;
  const database = await openVaultDatabase(databaseName);
  let savedSession: SessionState | undefined;
  const password = "Local creation flow test password";

  try {
    const controller = await createSessionController({
      async read() {
        return savedSession;
      },
      async write(input) {
        savedSession = sessionStateSchema.parse(input);
      },
    });
    const coordinator = createVaultCreationCoordinator(async () => ({
      getStatus: () => controller.getStatus(),
      discover: () => listVaultIds(database),
      save: (setup: VaultSetup) => saveFirstVault(database, setup),
    }));
    const delivered: PreparedVault[] = [];
    await coordinator.prepare(password, (result) => {
      delivered.push(result);
    });
    const prepared = delivered[0];
    if (prepared === undefined) throw new Error("Expected prepared vault");
    expect(await listVaultIds(database)).toEqual([]);
    expect(savedSession).not.toHaveProperty("vaultKeyBase64");

    await coordinator.confirm(prepared.token);
    expect(await listVaultIds(database)).toEqual([prepared.vaultId]);
    expect(await controller.getStatus()).toMatchObject({ status: "locked" });
    expect(savedSession).not.toHaveProperty("vaultKeyBase64");

    const stored = await loadVault(database, prepared.vaultId);
    if (stored === undefined) throw new Error("Expected persisted vault");
    expect(Object.keys(stored).sort()).toEqual([
      "localRevision",
      "setup",
      "vaultId",
    ]);
    const unlock = createVaultUnlocker(controller);
    await expect(
      unlock(
        password,
        stored.setup,
        {
          vaultId: stored.vaultId,
          keyVersion: stored.setup.wrappedVaultKey.keyVersion,
        },
        60_000,
      ),
    ).resolves.toMatchObject({ status: "unlocked", vaultId: prepared.vaultId });
    await controller.lock();
    expect(savedSession).not.toHaveProperty("vaultKeyBase64");
  } finally {
    database.close();
    await deleteDB(databaseName);
  }
}, 30_000);
