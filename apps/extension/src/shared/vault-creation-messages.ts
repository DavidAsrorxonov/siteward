import { vaultKeyContextSchema } from "@siteward/contracts";
import { z } from "zod";

// Creation policy only; unlocking must still accept existing passwords.
export const newMasterPasswordSchema = z.string().min(12);
export const creationTokenSchema = z.uuidv4();

const vaultIdSchema = vaultKeyContextSchema.shape.vaultId;

export const vaultCreationRequestSchema = z.discriminatedUnion("type", [
  z.strictObject({
    channel: z.literal("siteward"),
    type: z.literal("vault.create.prepare"),
    password: newMasterPasswordSchema,
  }),
  z.strictObject({
    channel: z.literal("siteward"),
    type: z.literal("vault.create.confirm"),
    token: creationTokenSchema,
    recoveryKeySaved: z.literal(true),
  }),
  z.strictObject({
    channel: z.literal("siteward"),
    type: z.literal("vault.create.cancel"),
  }),
]);

export const preparedVaultSchema = z.strictObject({
  token: creationTokenSchema,
  vaultId: vaultIdSchema,
  recoveryKey: z.string().regex(/^SW1-(?:[0-9A-F]{8}-){8}[0-9A-F]{8}$/),
});

export type PreparedVault = z.infer<typeof preparedVaultSchema>;

export const vaultCreationErrorSchema = z.enum([
  "UNAUTHORIZED",
  "INVALID_REQUEST",
  "CREATION_BUSY",
  "CREATION_CANCELLED",
  "CREATION_EXPIRED",
  "VAULT_ALREADY_EXISTS",
  "SESSION_NOT_LOCKED",
  "CREATION_FAILED",
]);

export type VaultCreationErrorCode = z.infer<typeof vaultCreationErrorSchema>;

export const vaultCreationReplySchema = z.union([
  preparedVaultSchema.extend({
    ok: z.literal(true),
    type: z.literal("vault.create.prepare"),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal("vault.create.confirm"),
    vaultId: vaultIdSchema,
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal("vault.create.cancel"),
  }),
  z.strictObject({
    ok: z.literal(false),
    error: vaultCreationErrorSchema,
  }),
]);

export type VaultCreationReply = z.infer<typeof vaultCreationReplySchema>;
