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
