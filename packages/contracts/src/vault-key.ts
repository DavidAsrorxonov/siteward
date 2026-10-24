import { z } from "zod";

const canonicalUuidSchema = z
  .uuidv4()
  .refine((value) => value === value.toLowerCase(), {
    message: "UUIDs must use lowercase characters.",
  });

export const vaultKeyHeaderSchema = z.strictObject({
  wrapFormatVersion: z.literal(1),
  vaultId: canonicalUuidSchema,
  keyVersion: z.number().int().positive(),
});

export const wrappedVaultKeySchema = vaultKeyHeaderSchema.extend({
  iv: z.string().regex(/^[A-Za-z0-9+/]{16}$/),
  ciphertext: z.base64().regex(/^[A-Za-z0-9+/]{64}$/),
});

export const vaultKeyContextSchema = vaultKeyHeaderSchema.pick({
  vaultId: true,
  keyVersion: true,
});

export type VaultKeyHeader = z.infer<typeof vaultKeyHeaderSchema>;
export type WrappedVaultKey = z.infer<typeof wrappedVaultKeySchema>;
export type VaultKeyContext = z.infer<typeof vaultKeyContextSchema>;
