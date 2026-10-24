import { passwordKdfSchema } from "@siteward/contracts";
import { describe, expect, it } from "vitest";

const configuration = {
  configVersion: 1,
  algorithm: "argon2id",
  argon2Version: 19,
  memoryKiB: 65_536,
  iterations: 3,
  parallelism: 4,
  hashLength: 32,

  // Fixed test fixture. Real accounts will receive random salts.
  salt: "AAECAwQFBgcICQoLDA0ODw==",
};

describe("password KDF configuration", () => {
  it("accepts the supported configuration", () => {
    expect(passwordKdfSchema.parse(configuration)).toEqual(configuration);
  });

  it("rejects an unsupported configuration version", () => {
    expect(() =>
      passwordKdfSchema.parse({
        ...configuration,
        configVersion: 2,
      }),
    ).toThrow();
  });

  it("rejects a weaker memory setting", () => {
    expect(() =>
      passwordKdfSchema.parse({
        ...configuration,
        memoryKiB: 8,
      }),
    ).toThrow();
  });

  it("rejects excessive processing settings", () => {
    expect(() =>
      passwordKdfSchema.parse({
        ...configuration,
        iterations: 999,
      }),
    ).toThrow();
  });

  it.each(["not-base64", "YWJjZA==", "AAECAwQFBgcICQoLDA0ODx=="])(
    "rejects an invalid salt: %s",
    (salt) => {
      expect(() =>
        passwordKdfSchema.parse({
          ...configuration,
          salt,
        }),
      ).toThrow();
    },
  );
});
