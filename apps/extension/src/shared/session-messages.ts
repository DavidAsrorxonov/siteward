import { vaultKeyContextSchema } from "@siteward/contracts";
import { z } from "zod";

const safeIntegerSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);

export const sessionStatusSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("locked"),
    generation: safeIntegerSchema,
  }),

  vaultKeyContextSchema.extend({
    status: z.literal("unlocked"),
    generation: safeIntegerSchema,
    expiresAt: safeIntegerSchema,
  }),
]);

export type SessionStatus = z.infer<typeof sessionStatusSchema>;

export const sessionRequestSchema = z.discriminatedUnion("type", [
  z.strictObject({
    channel: z.literal("siteward"),
    type: z.literal("session.status"),
  }),

  z.strictObject({
    channel: z.literal("siteward"),
    type: z.literal("session.lock"),
  }),
]);

export const sessionReplySchema = z.discriminatedUnion("ok", [
  z.strictObject({
    ok: z.literal(true),
    session: sessionStatusSchema,
  }),

  z.strictObject({
    ok: z.literal(false),
    error: z.enum(["UNAUTHORIZED", "INVALID_REQUEST", "SESSION_UNAVAILABLE"]),
  }),
]);

export type SessionReply = z.infer<typeof sessionReplySchema>;
