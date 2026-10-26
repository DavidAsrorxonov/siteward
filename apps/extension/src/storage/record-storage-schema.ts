import { encryptedRecordSchema } from "@siteward/contracts";
import z from "zod";

const revisionSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

export const storedRecordSchema = z.strictObject({
  envelope: encryptedRecordSchema,
  localRevision: revisionSchema,
  serverRevision: revisionSchema.nullable(),
});

export const pendingWriteSchema = z.strictObject({
  envelope: encryptedRecordSchema,
  baseRevision: revisionSchema.nullable(),
});

export type StoredRecord = z.infer<typeof storedRecordSchema>;
export type PendingWrite = z.infer<typeof pendingWriteSchema>;
