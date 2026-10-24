import { z } from "zod";
import { passwordKdfSchema } from "./kdf.ts";
import { wrappedVaultKeySchema } from "./vault-key.ts";

export const vaultSetupSchema = z.strictObject({
  setupVersion: z.literal(1),
  kdf: passwordKdfSchema,
  wrappedVaultKey: wrappedVaultKeySchema,
});

export type VaultSetup = z.infer<typeof vaultSetupSchema>;
