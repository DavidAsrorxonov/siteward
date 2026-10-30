import { vaultKeyContextSchema } from "@siteward/contracts";
import z from "zod";
import { sessionStatusSchema } from "./session-messages";

const vaultIdSchema = vaultKeyContextSchema.shape.vaultId;

export const vaultAccessRequestSchema = z.discriminatedUnion("type", [
  z.strictObject({
    channel: z.literal("siteward"),
    type: z.literal("vault.discover"),
  }),

  z.strictObject({
    channel: z.literal("siteward"),
    type: z.literal("vault.unlock"),
    vaultId: vaultIdSchema,
    password: z.string().min(1),
  }),
]);

export const vaultAccessReplySchema = z.union([
  z.strictObject({
    ok: z.literal(true),
    type: z.literal("vault.discover"),
    vaultIds: z.array(vaultIdSchema),
  }),

  z.strictObject({
    ok: z.literal(true),
    type: z.literal("vault.unlock"),
    session: sessionStatusSchema,
  }),

  z.strictObject({
    ok: z.literal(false),
    error: z.enum([
      "UNAUTHORIZED",
      "INVALID_REQUEST",
      "VAULT_UNAVAILABLE",
      "UNLOCK_FAILED",
      "UNLOCK_BUSY",
    ]),
  }),
]);

export type VaultAccessReply = z.infer<typeof vaultAccessReplySchema>;
