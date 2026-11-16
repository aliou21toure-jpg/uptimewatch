import { describe, expect, it } from "vitest";
import { createMonitorInput, headersSchema, updateMonitorInput } from "./schemas";

const valid = { name: "API", url: "https://api.example.com/health" };

describe("createMonitorInput", () => {
  it("applies the specification defaults", () => {
    expect(createMonitorInput.parse(valid)).toEqual({
      ...valid,
      method: "GET",
      intervalSeconds: 60,
      timeoutMs: 10_000,
      expectedStatusMin: 200,
      expectedStatusMax: 299,
      bodyContains: null,
      headers: [],
    });
  });

  it("only accepts the allowed intervals", () => {
    expect(() => createMonitorInput.parse({ ...valid, intervalSeconds: 45 })).toThrow(/30, 60/);
    expect(createMonitorInput.parse({ ...valid, intervalSeconds: 3600 }).intervalSeconds).toBe(3600);
  });

  it("requires the timeout to be shorter than the interval", () => {
    expect(() => createMonitorInput.parse({ ...valid, intervalSeconds: 30, timeoutMs: 30_000 })).toThrow(/shorter/);
  });

  it("rejects a keyword check with HEAD", () => {
    expect(() => createMonitorInput.parse({ ...valid, method: "HEAD", bodyContains: "ok" })).toThrow(/GET/);
  });

  it("rejects an inverted status range", () => {
    expect(() => createMonitorInput.parse({ ...valid, expectedStatusMin: 300, expectedStatusMax: 200 })).toThrow();
  });

  it("rejects internal destinations and unknown fields", () => {
    expect(() => createMonitorInput.parse({ ...valid, url: "http://169.254.169.254/" })).toThrow(/private/);
    expect(() => createMonitorInput.parse({ ...valid, state: "healthy" })).toThrow();
  });
});

describe("headersSchema", () => {
  it("accepts ordinary headers", () => {
    expect(headersSchema.parse([{ name: "Authorization", value: "Bearer x" }])).toHaveLength(1);
  });

  it.each([
    [[{ name: "Host", value: "evil.example" }], /cannot be set/],
    [[{ name: "X-A", value: "a\r\nInjected: 1" }], /line breaks/],
    [[{ name: "Bad Name", value: "x" }], /valid header name/],
    [[{ name: "X-A", value: "1" }, { name: "x-a", value: "2" }], /once/],
  ])("rejects %j", (headers, message) => expect(() => headersSchema.parse(headers)).toThrow(message));
});

describe("updateMonitorInput", () => {
  it("allows partial updates but not unknown fields", () => {
    expect(updateMonitorInput.parse({ name: "New" })).toEqual({ name: "New" });
    expect(() => updateMonitorInput.parse({ consecutiveFailures: 0 })).toThrow();
  });
});
