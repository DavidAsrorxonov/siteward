import { recordContextSchema } from "@siteward/contracts";
import { z } from "zod";
import { savedSiteSchema, savedSiteSummarySchema } from "./schema.ts";

export const vaultRequestSchema = z.discriminatedUnion("type", [
  z.strictObject({
    channel: z.literal("siteward"),
    type: z.literal("vault.list"),
  }),

  z.strictObject({
    channel: z.literal("siteward"),
    type: z.literal("vault.open"),
    id: recordContextSchema.shape.id,
  }),
]);

export const vaultReplySchema = z.union([
  z.strictObject({
    ok: z.literal(true),
    type: z.literal("vault.list"),
    sites: z.array(savedSiteSummarySchema),
  }),

  z.strictObject({
    ok: z.literal(true),
    type: z.literal("vault.open"),
    site: savedSiteSchema.nullable(),
  }),

  z.strictObject({
    ok: z.literal(false),
    error: z.enum([
      "UNAUTHORIZED",
      "INVALID_REQUEST",
      "VAULT_LOCKED",
      "VAULT_UNAVAILABLE",
    ]),
  }),
]);

export type VaultReply = z.infer<typeof vaultReplySchema>;
