import { vaultKeyContextSchema } from "@siteward/contracts";
import { z } from "zod";

const safeIntegerSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);

const vaultKeyBase64Schema = z
  .string()
  .regex(/^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]=$/);

export const lockedSessionSchema = z.strictObject({
  sessionVersion: z.literal(1),
  status: z.literal("locked"),
  generation: safeIntegerSchema,
});

export const unlockedSessionSchema = vaultKeyContextSchema
  .extend({
    sessionVersion: z.literal(1),
    status: z.literal("unlocked"),
    generation: safeIntegerSchema,
    unlockedAt: safeIntegerSchema,
    expiresAt: safeIntegerSchema,
    vaultKeyBase64: vaultKeyBase64Schema,
  })
  .refine((session) => session.expiresAt > session.unlockedAt, {
    message: "Session expiration must follow unlock time.",
    path: ["expiresAt"],
  });

export const sessionStateSchema = z.discriminatedUnion("status", [
  lockedSessionSchema,
  unlockedSessionSchema,
]);

export type LockedSession = z.infer<typeof lockedSessionSchema>;
export type UnlockedSession = z.infer<typeof unlockedSessionSchema>;
export type SessionState = z.infer<typeof sessionStateSchema>;

export function readActiveSession(
  input: unknown,
  nowInput: unknown,
): UnlockedSession | undefined {
  const parsedTime = safeIntegerSchema.safeParse(nowInput);
  const parsedSession = sessionStateSchema.safeParse(input);

  if (!parsedTime.success || !parsedSession.success) {
    return undefined;
  }

  const session = parsedSession.data;
  const now = parsedTime.data;

  if (session.status === "locked") {
    return undefined;
  }

  if (now < session.unlockedAt || now >= session.expiresAt) {
    return undefined;
  }

  return session;
}
