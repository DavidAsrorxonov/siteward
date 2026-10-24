import { vaultKeyContextSchema } from "@siteward/contracts";
import { parseRecoveryKey } from "./recovery-key";

const encoder = new TextEncoder();

export async function deriveRecoveryWrappingKey(
  recoveryKeyInput: unknown,
  contextInput: unknown,
): Promise<CryptoKey> {
  const context = vaultKeyContextSchema.parse(contextInput);
  const secretBytes = await parseRecoveryKey(recoveryKeyInput);

  try {
    const rootKey = await crypto.subtle.importKey(
      "raw",
      secretBytes,
      "HKDF",
      false,
      ["deriveKey"],
    );

    return await crypto.subtle.deriveKey(
      {
        name: "HKDF",
        hash: "SHA-256",
        salt: encoder.encode(context.vaultId),
        info: encoder.encode(
          JSON.stringify([
            "siteward",
            1,
            "recovery-wrapping-key",
            context.keyVersion,
          ]),
        ),
      },
      rootKey,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
  } finally {
    secretBytes.fill(0);
  }
}
