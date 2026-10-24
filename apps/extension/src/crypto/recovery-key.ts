const RECOVERY_KEY_BYTES = 32;

const checksumDomain = new TextEncoder().encode("siteward-recovery-key:v1:");

const recoveryKeyPattern = /^SW1-(?:[0-9A-F]{8}-){8}[0-9A-F]{8}$/;

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

export async function formatRecoveryKey(
  bytes: Uint8Array<ArrayBuffer>,
): Promise<string> {
  if (bytes.length !== RECOVERY_KEY_BYTES) {
    throw new Error("Recovery keys must contain exactly 32 bytes.");
  }

  const checksumInput = new Uint8Array(checksumDomain.length + bytes.length);

  checksumInput.set(checksumDomain);
  checksumInput.set(bytes, checksumDomain.length);

  try {
    const digest = new Uint8Array(
      await crypto.subtle.digest("SHA-256", checksumInput),
    );

    const checksum = toHex(digest.subarray(0, 4));
    digest.fill(0);

    const hex = toHex(bytes);
    const groups: string[] = [];

    for (let offset = 0; offset < hex.length; offset += 8) {
      groups.push(hex.slice(offset, offset + 8));
    }

    return `SW1-${groups.join("-")}-${checksum}`;
  } finally {
    checksumInput.fill(0);
  }
}

export async function generateRecoveryKey(): Promise<string> {
  const bytes = crypto.getRandomValues(new Uint8Array(RECOVERY_KEY_BYTES));

  try {
    return await formatRecoveryKey(bytes);
  } finally {
    bytes.fill(0);
  }
}

export async function parseRecoveryKey(
  input: unknown,
): Promise<Uint8Array<ArrayBuffer>> {
  if (typeof input !== "string" || input.length > 256) {
    throw new Error("Invalid recovery key format.");
  }

  const normalized = input.trim().toUpperCase();

  if (!recoveryKeyPattern.test(normalized)) {
    throw new Error("Invalid recovery key format.");
  }

  const hex = normalized.slice(4).split("-").slice(0, 8).join("");

  const bytes = Uint8Array.from({ length: RECOVERY_KEY_BYTES }, (_, index) =>
    Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16),
  );

  try {
    const expected = await formatRecoveryKey(bytes);

    if (normalized !== expected) {
      throw new Error("Recovery key checksum mismatch.");
    }

    return bytes;
  } catch (error) {
    bytes.fill(0);
    throw error;
  }
}
