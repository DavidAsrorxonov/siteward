import { z } from "zod";
import { passwordKdfSchema } from "./kdf.ts";
import { wrappedVaultKeySchema } from "./vault-key.ts";

export const vaultSetupSchema = z
  .strictObject({
    setupVersion: z.literal(2),
    kdf: passwordKdfSchema,
    wrappedVaultKey: wrappedVaultKeySchema,
    recovery: z.strictObject({
      recoveryVersion: z.literal(1),
      wrappedVaultKey: wrappedVaultKeySchema,
    }),
  })
  .refine(
    (setup) =>
      setup.wrappedVaultKey.vaultId ===
        setup.recovery.wrappedVaultKey.vaultId &&
      setup.wrappedVaultKey.keyVersion ===
        setup.recovery.wrappedVaultKey.keyVersion,
    {
      message: "Recovery envelope context mismatch.",
      path: ["recovery", "wrappedVaultKey"],
    },
  );

export type VaultSetup = z.infer<typeof vaultSetupSchema>;
