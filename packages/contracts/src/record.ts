import { z } from "zod";

const canonicalUuidSchema = z
  .uuidv4()
  .refine((value) => value === value.toLowerCase(), {
    message: "UUIDs must use lowercase characters.",
  });

export const recordHeaderSchema = z.strictObject({
  formatVersion: z.literal(1),
  vaultId: canonicalUuidSchema,
  id: canonicalUuidSchema,
  keyVersion: z.number().int().positive(),
  mutationId: canonicalUuidSchema,
});

export type RecordHeader = z.infer<typeof recordHeaderSchema>;

export const recordContextSchema = recordHeaderSchema.pick({
  vaultId: true,
  id: true,
  keyVersion: true,
});

export const encryptedRecordSchema = recordHeaderSchema.extend({
  iv: z.string().regex(/^[A-Za-z0-9+/]{16}$/),
  ciphertext: z.base64().min(24),
});

export type RecordContext = z.infer<typeof recordContextSchema>;
export type EncryptedRecord = z.infer<typeof encryptedRecordSchema>;
