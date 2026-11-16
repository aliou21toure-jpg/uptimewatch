import { describe, expect, it } from "vitest";
import { isBlockedAddress, staticDestinationProblem } from "./destination";

describe("isBlockedAddress", () => {
  it.each([
    "127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254",
    "100.64.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255", "::1", "::", "fe80::1", "fd00::1",
    "::ffff:127.0.0.1", "::ffff:10.0.0.1", "::ffff:7f00:1",
  ])("blocks %s", (ip) => expect(isBlockedAddress(ip)).toBe(true));

  it.each(["93.184.216.34", "1.1.1.1", "172.32.0.1", "::ffff:1.1.1.1", "2606:4700:4700::1111"])("allows %s", (ip) =>
    expect(isBlockedAddress(ip)).toBe(false),
  );
});

describe("staticDestinationProblem", () => {
  it("accepts public URLs", () => {
    expect(staticDestinationProblem("https://example.com/health")).toBeNull();
    expect(staticDestinationProblem("http://1.1.1.1:8080/")).toBeNull();
  });

  it.each([
    ["ftp://example.com", /http/],
    ["file:///etc/passwd", /http/],
    ["https://user:pass@example.com", /credentials/],
    ["http://localhost:3000", /internal/],
    ["http://api.localhost", /internal/],
    ["http://db.internal", /internal/],
    ["http://intranet", /fully qualified/],
    ["http://127.0.0.1", /private/],
    ["http://[::1]/", /private/],
    ["http://169.254.169.254/latest/meta-data", /private/],
    ["http://2130706433/", /private/], // 127.0.0.1 in decimal
    ["http://0x7f.0.0.1/", /private/], // 127.0.0.1 in hex
    ["http://[::ffff:7f00:1]/", /private/], // IPv4-mapped loopback
    ["not a url", /valid URL/],
  ])("rejects %s", (url, reason) => expect(staticDestinationProblem(url)).toMatch(reason));
});
