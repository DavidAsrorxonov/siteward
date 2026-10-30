import { vaultKeyContextSchema, vaultSetupSchema } from "@siteward/contracts";
import { UnlockedVault, unlockVault } from "../../crypto/vault-setup";
import { SessionController, SessionStatus } from "./session-controller";
import { bytesToBase64 } from "../../crypto/base64";

export function createVaultUnlocker(
  controller: SessionController,
  derive: typeof unlockVault = unlockVault,
) {
  return async function unlock(
    passwordInput: unknown,
    setupInput: unknown,
    contextInput: unknown,
    durationInput: unknown,
    signal?: AbortSignal,
  ): Promise<SessionStatus> {
    signal?.throwIfAborted();

    const setup = vaultSetupSchema.parse(setupInput);
    const context = vaultKeyContextSchema.parse(contextInput);

    const ticket = await controller.beginUnlock(context, durationInput);

    let keys: UnlockedVault | undefined;
    let rawKey: Uint8Array<ArrayBuffer> | undefined;

    try {
      signal?.throwIfAborted();

      keys = await derive(passwordInput, setup, context);
      keys.authKey.fill(0);

      signal?.throwIfAborted();

      rawKey = new Uint8Array(
        await crypto.subtle.exportKey("raw", keys.vaultKey),
      );

      signal?.throwIfAborted();

      const encodedKey = bytesToBase64(rawKey);

      rawKey.fill(0);
      rawKey = undefined;

      return await controller.completeUnlock(ticket, encodedKey, signal);
    } catch (error) {
      await controller.cancelUnlock(ticket);
      throw error;
    } finally {
      keys?.authKey.fill(0);
      rawKey?.fill(0);
    }
  };
}
