import { recordHeaderSchema } from "@siteward/contracts";

const encoder = new TextEncoder();

export function buildRecordAad(input: unknown): Uint8Array<ArrayBuffer> {
  const header = recordHeaderSchema.parse(input);

  const serialized = JSON.stringify([
    "siteward-record",
    header.formatVersion,
    header.vaultId,
    header.id,
    header.keyVersion,
    header.mutationId,
  ]);

  return encoder.encode(serialized);
}
