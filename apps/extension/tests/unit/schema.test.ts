import { describe, expect, it } from "vitest";
import { savedSiteSchema } from "../../src/shared/schema.ts";

const validSite = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  schemaVersion: 1,
  title: "Example account",
  urls: ["https://example.com/login"],
  username: "  example-user  ",
  password: "  Example password!  ",
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
};

describe("savedSiteSchema", () => {
  it("preserves username and password characters exactly", () => {
    const result = savedSiteSchema.parse(validSite);

    expect(result.username).toBe(validSite.username);
    expect(result.password).toBe(validSite.password);
  });

  it("rejects a password with the wrong runtime type", () => {
    const result = savedSiteSchema.safeParse({
      ...validSite,
      password: 123456,
    });

    expect(result.success).toBe(false);
  });

  it("rejects an unsupported schema version", () => {
    const result = savedSiteSchema.safeParse({
      ...validSite,
      schemaVersion: 2,
    });

    expect(result.success).toBe(false);
  });

  it("rejects unrecognized fields", () => {
    const result = savedSiteSchema.safeParse({
      ...validSite,
      unexpectedField: true,
    });

    expect(result.success).toBe(false);
  });
});
