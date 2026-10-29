import {
  recordContextSchema,
  vaultKeyContextSchema,
} from "@siteward/contracts";
import { SavedSite, SavedSiteSummary } from "../shared/schema";
import { VaultDatabase } from "../storage/vault-database";
import { SessionController } from "./session/session-controller";
import { listRecords, loadRecord } from "../storage/record-repository";
import { decryptRecord } from "../crypto/record";

function summarizeSite(site: SavedSite): SavedSiteSummary {
  return {
    id: site.id,
    title: site.title,
    urls: site.urls,
    username: site.username,
    favorite: site.favorite ?? false,
    tags: site.tags ?? [],
  };
}

export function createVaultReader(
  database: VaultDatabase,
  controller: SessionController,
) {
  return {
    async list(
      contextInput: unknown,
      publish: (sites: SavedSiteSummary[]) => undefined,
    ): Promise<void> {
      const context = vaultKeyContextSchema.parse(contextInput);

      return controller.readWithVaultKey(
        context,
        async (key) => {
          const records = await listRecords(database, context);
          const summaries: SavedSiteSummary[] = [];

          for (const stored of records) {
            const payload = await decryptRecord(key, stored.envelope, {
              ...context,
              id: stored.envelope.id,
            });

            if (payload.kind === "site") {
              summaries.push(summarizeSite(payload.site));
            }
          }

          return summaries;
        },
        publish,
      );
    },

    async open(
      contextInput: unknown,
      publish: (site: SavedSite | undefined) => undefined,
    ): Promise<void> {
      const context = recordContextSchema.parse(contextInput);

      return controller.readWithVaultKey(
        {
          vaultId: context.vaultId,
          keyVersion: context.keyVersion,
        },
        async (key) => {
          const stored = await loadRecord(database, context);

          if (stored === undefined) {
            return undefined;
          }

          const payload = await decryptRecord(key, stored.envelope, context);

          return payload.kind === "site" ? payload.site : undefined;
        },
        publish,
      );
    },
  };
}
