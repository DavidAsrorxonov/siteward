export function bytesToBase64(bytes: Uint8Array<ArrayBuffer>): string {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}

export function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);

  if (btoa(binary) !== value) {
    throw new Error("Noncanonical base64 value.");
  }

  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
