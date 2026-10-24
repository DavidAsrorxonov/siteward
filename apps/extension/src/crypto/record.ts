import {
  encryptedRecordSchema,
  recordContextSchema,
  recordHeaderSchema,
} from "@siteward/contracts";

import type { EncryptedRecord, RecordHeader } from "@siteward/contracts";

import { recordPayloadSchema } from "../shared/schema.ts";

import type { RecordPayload } from "../shared/schema.ts";

import { encryptBytes, decryptBytes } from "./aes-gcm.ts";
import { bytesToBase64, base64ToBytes } from "./base64.ts";
import { buildRecordAad } from "./record-aad.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

function assertPayloadIdentity(
  header: RecordHeader,
  payload: RecordPayload,
): void {
  if (payload.kind === "site" && payload.site.id !== header.id) {
    throw new Error("Payload record ID does not match its header.");
  }
}

export async function encryptRecord(
  key: CryptoKey,
  headerInput: unknown,
  payloadInput: unknown,
): Promise<EncryptedRecord> {
  const header = recordHeaderSchema.parse(headerInput);
  const payload = recordPayloadSchema.parse(payloadInput);

  assertPayloadIdentity(header, payload);

  const plaintext = encoder.encode(JSON.stringify(payload));

  const encrypted = await encryptBytes(key, plaintext, buildRecordAad(header));

  return encryptedRecordSchema.parse({
    ...header,
    iv: bytesToBase64(encrypted.iv),
    ciphertext: bytesToBase64(encrypted.ciphertext),
  });
}

export async function decryptRecord(
  key: CryptoKey,
  envelopeInput: unknown,
  expectedContextInput: unknown,
): Promise<RecordPayload> {
  const envelope = encryptedRecordSchema.parse(envelopeInput);
  const expected = recordContextSchema.parse(expectedContextInput);

  const { iv, ciphertext, ...header } = envelope;

  if (
    header.vaultId !== expected.vaultId ||
    header.id !== expected.id ||
    header.keyVersion !== expected.keyVersion
  ) {
    throw new Error("Record context mismatch.");
  }

  const plaintext = await decryptBytes(
    key,
    {
      iv: base64ToBytes(iv),
      ciphertext: base64ToBytes(ciphertext),
    },
    buildRecordAad(header),
  );

  const decoded: unknown = JSON.parse(decoder.decode(plaintext));
  const payload = recordPayloadSchema.parse(decoded);

  assertPayloadIdentity(header, payload);

  return payload;
}
