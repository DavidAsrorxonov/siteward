type Bytes = Uint8Array<ArrayBuffer>;

export interface EncryptedBytes {
  iv: Bytes;
  ciphertext: Bytes;
}

const IV_LENGTH_BYTES = 12;
const AUTH_TAG_LENGTH_BITS = 128;

export function generateVaultKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(
    {
      name: "AES-GCM",
      length: 256,
    },
    true,
    ["encrypt", "decrypt"],
  );
}

export async function encryptBytes(
  key: CryptoKey,
  plaintext: Bytes,
  additionalData: Bytes,
): Promise<EncryptedBytes> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH_BYTES));

  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData,
      tagLength: AUTH_TAG_LENGTH_BITS,
    },
    key,
    plaintext,
  );

  return {
    iv,
    ciphertext: new Uint8Array(ciphertext),
  };
}

export async function decryptBytes(
  key: CryptoKey,
  encrypted: EncryptedBytes,
  additionalData: Bytes,
): Promise<Bytes> {
  if (encrypted.iv.length !== IV_LENGTH_BYTES) {
    throw new Error("Invalid AES_GCM IV length.");
  }

  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: encrypted.iv,
      additionalData,
      tagLength: AUTH_TAG_LENGTH_BITS,
    },
    key,
    encrypted.ciphertext,
  );

  return new Uint8Array(plaintext);
}
