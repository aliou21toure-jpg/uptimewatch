import { describe, expect, it } from "vitest";
import { EnvValidationError, parseEnv } from "./index";

const valid = {
  DATABASE_URL: "postgres://u:p@localhost:5432/db",
  REDIS_URL: "redis://localhost:6379",
};

describe("parseEnv", () => {
  it("accepts a valid environment and defaults NODE_ENV", () => {
    expect(parseEnv(valid)).toEqual({ ...valid, NODE_ENV: "development" });
  });

  it("rejects a missing DATABASE_URL", () => {
    expect(() => parseEnv({ REDIS_URL: valid.REDIS_URL })).toThrow(EnvValidationError);
  });

  it("rejects a non-postgres DATABASE_URL", () => {
    expect(() => parseEnv({ ...valid, DATABASE_URL: "mysql://localhost/db" })).toThrow(
      /DATABASE_URL/,
    );
  });

  it("never includes secret values in the error message", () => {
    try {
      parseEnv({ ...valid, DATABASE_URL: "mysql://user:supersecret@localhost/db" });
      expect.unreachable();
    } catch (error) {
      expect(String(error)).not.toContain("supersecret");
    }
  });
});
