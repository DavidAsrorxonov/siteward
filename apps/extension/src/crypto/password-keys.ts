import { passwordKdfSchema } from "@siteward/contracts";
import z from "zod";
import { base64ToBytes } from "./base64";
import { argon2id } from "hash-wasm";

export interface PasswordKeys {
  masterKey: CryptoKey;
  authKey: Uint8Array<ArrayBuffer>;
}

const encoder = new TextEncoder();

export async function derivePasswordKeys(
  passwordInput: unknown,
  configurationInput: unknown,
): Promise<PasswordKeys> {
  const configuration = passwordKdfSchema.parse(configurationInput);
  const password = z.string().min(1).parse(passwordInput);

  const salt = base64ToBytes(configuration.salt);
  const passwordBytes = encoder.encode(password);

  let seed: Uint8Array<ArrayBuffer> | undefined;

  try {
    const argonOutput = await argon2id({
      password: passwordBytes,
      salt,
      memorySize: configuration.memoryKiB,
      iterations: configuration.iterations,
      parallelism: configuration.parallelism,
      hashLength: configuration.hashLength,
      outputType: "binary",
    });

    seed = Uint8Array.from(argonOutput);
    argonOutput.fill(0);

    const rootKey = await crypto.subtle.importKey("raw", seed, "HKDF", false, [
      "deriveKey",
      "deriveBits",
    ]);

    const masterKey = await crypto.subtle.deriveKey(
      {
        name: "HKDF",
        hash: "SHA-256",
        salt,
        info: encoder.encode(
          JSON.stringify([
            "siteward",
            configuration.configVersion,
            "master-key",
          ]),
        ),
      },
      rootKey,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );

    const authBits = await crypto.subtle.deriveBits(
      {
        name: "HKDF",
        hash: "SHA-256",
        salt,
        info: encoder.encode(
          JSON.stringify(["siteward", configuration.configVersion, "auth-key"]),
        ),
      },
      rootKey,
      256,
    );

    return {
      masterKey,
      authKey: new Uint8Array(authBits),
    };
  } finally {
    passwordBytes.fill(0);
    seed?.fill(0);
  }
}
