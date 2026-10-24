import { z } from "zod";

// canonical base64 encoding of exactly 16 bytes
const saltSchema = z
  .string()
  .regex(
    /^[A-Za-z0-9+/]{21}[AQgw]==$/,
    "Expected a canonical Base64-encoded 16-byte salt.",
  );

export const passwordKdfSchema = z.strictObject({
  configVersion: z.literal(1),
  algorithm: z.literal("argon2id"),
  argon2Version: z.literal(19),
  memoryKiB: z.literal(65_536),
  iterations: z.literal(3),
  parallelism: z.literal(4),
  hashLength: z.literal(32),
  salt: saltSchema,
});

export type PasswordKdf = z.infer<typeof passwordKdfSchema>;
