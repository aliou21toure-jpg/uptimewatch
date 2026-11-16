import { describe, expect, it } from "vitest";
import { EnvValidationError, parseEnv, parseWebEnv } from "./index";

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

describe("parseWebEnv", () => {
  const web = { ...valid, BETTER_AUTH_SECRET: "x".repeat(32) };

  it("applies defaults for the app URL and sender", () => {
    const env = parseWebEnv(web);
    expect(env.APP_URL).toBe("http://localhost:3000");
    expect(env.EMAIL_FROM).toContain("@");
  });

  it("rejects a short auth secret", () => {
    expect(() => parseWebEnv({ ...web, BETTER_AUTH_SECRET: "short" })).toThrow(/BETTER_AUTH_SECRET/);
  });

  it("prints emails to the console in development by default", () => {
    expect(parseWebEnv(web).EMAIL_TRANSPORT).toBe("console");
    expect(parseWebEnv({ ...web, EMAIL_TRANSPORT: "", RESEND_API_KEY: "" }).EMAIL_TRANSPORT).toBe("console");
  });

  it("requires an email provider key in production unless console is chosen explicitly", () => {
    expect(() => parseWebEnv({ ...web, NODE_ENV: "production" })).toThrow(/RESEND_API_KEY/);
    expect(parseWebEnv({ ...web, NODE_ENV: "production", RESEND_API_KEY: "re_test" }).EMAIL_TRANSPORT).toBe(
      "resend",
    );
    expect(parseWebEnv({ ...web, NODE_ENV: "production", EMAIL_TRANSPORT: "console" }).EMAIL_TRANSPORT).toBe(
      "console",
    );
  });
});
