import { vaultKeyHeaderSchema } from "@siteward/contracts";

const encoder = new TextEncoder();

export function buildVaultKeyAad(input: unknown): Uint8Array<ArrayBuffer> {
  const header = vaultKeyHeaderSchema.parse(input);

  return encoder.encode(
    JSON.stringify([
      "siteward-vault-key",
      header.wrapFormatVersion,
      header.vaultId,
      header.keyVersion,
    ]),
  );
}
