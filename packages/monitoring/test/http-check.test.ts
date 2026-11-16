import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import http, { type IncomingHttpHeaders } from "node:http";
import https from "node:https";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MAX_BODY_BYTES, runHttpCheck, type HttpCheckRequest, type Resolver } from "../src/http-check";
import { isBlockedAddress } from "../src/ssrf";

// Test servers listen on 127.0.0.1, which the real policy blocks. The tests use public-looking
// host names resolved by a fake DNS, and a policy that allows exactly that one loopback address —
// everything else goes through the production rules.
const DNS: Record<string, string[]> = {
  "app.example.test": ["127.0.0.1"],
  "other.example.test": ["127.0.0.1"],
  "secure.example.test": ["127.0.0.1"],
  "wrong-name.example.test": ["127.0.0.1"],
  "rebind.example.test": ["10.0.0.7"],
  "metadata.example.test": ["169.254.169.254"],
  "mixed.example.test": ["10.0.0.7", "127.0.0.1"],
  "loopback6.example.test": ["::1"],
};
const resolve: Resolver = async (host) => {
  const ips = DNS[host];
  if (!ips) throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), { code: "ENOTFOUND" });
  return ips.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
};
const isBlocked = (ip: string) => ip !== "127.0.0.1" && isBlockedAddress(ip);
const opts = { resolve, isBlocked };

let port: number;
let tlsPort: number;
let closedPort: number;
let ca: Buffer;
const received: IncomingHttpHeaders[] = [];
const servers: { close(): void }[] = [];

beforeAll(async () => {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url!, "http://x");
    received.push(req.headers);
    const go = (status: number, location: string) => res.writeHead(status, { location }).end();
    switch (url.pathname) {
      case "/ok": return res.end("hello, the service status is OK");
      case "/503": return res.writeHead(503).end("maintenance");
      case "/slow": return setTimeout(() => res.end("late"), 3000);
      case "/reset": return req.socket.destroy();
      case "/garbage": return req.socket.end("NOT HTTP AT ALL\r\n\r\n");
      case "/redirect-ok": return go(301, "/ok");
      case "/redirect-loop": return go(302, "/redirect-loop");
      case "/redirect-literal-internal": return go(302, `http://127.0.0.1:${port}/ok`);
      case "/redirect-metadata-ip": return go(302, "http://169.254.169.254/latest/meta-data/");
      case "/redirect-rebind": return go(302, `http://rebind.example.test:${port}/ok`);
      case "/redirect-file": return go(302, "file:///etc/passwd");
      case "/redirect-other-origin": return go(302, `http://other.example.test:${port}/echo`);
      case "/redirect-same-origin": return go(307, "/echo");
      case "/echo": return res.end("echo");
      case "/big": {
        res.write(Buffer.alloc(MAX_BODY_BYTES + 10, "a"));
        return res.end("NEEDLE");
      }
      case "/split": {
        res.write("....NEE");
        return setTimeout(() => res.end("DLE...."), 20);
      }
      default: return res.writeHead(404).end();
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
  servers.push(server);

  const closed = http.createServer();
  await new Promise<void>((r) => closed.listen(0, "127.0.0.1", r));
  closedPort = (closed.address() as AddressInfo).port;
  closed.close();

  const dir = mkdtempSync(join(tmpdir(), "uw-tls-"));
  execFileSync("openssl", [
    "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=secure.example.test",
    "-addext", "subjectAltName=DNS:secure.example.test",
    "-keyout", join(dir, "key.pem"), "-out", join(dir, "cert.pem"),
  ], { stdio: "ignore" });
  ca = readFileSync(join(dir, "cert.pem"));
  const tls = https.createServer({ key: readFileSync(join(dir, "key.pem")), cert: ca }, (_req, res) => res.end("secure ok"));
  await new Promise<void>((r) => tls.listen(0, "127.0.0.1", r));
  tlsPort = (tls.address() as AddressInfo).port;
  servers.push(tls);
});
afterAll(() => servers.forEach((s) => s.close()));

const check = (path: string, extra: Partial<HttpCheckRequest> = {}, host = "app.example.test") =>
  runHttpCheck(
    {
      url: `http://${host}:${port}${path}`,
      method: "GET",
      timeoutMs: 1500,
      expectedStatusMin: 200,
      expectedStatusMax: 299,
      bodyContains: null,
      headers: [],
      ...extra,
    },
    opts,
  );

describe("results", () => {
  it("succeeds and measures latency", async () => {
    const r = await check("/ok");
    expect(r).toMatchObject({ ok: true, httpStatus: 200, errorCode: null });
    expect(r.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("fails on an unexpected status, unless the range accepts it", async () => {
    expect(await check("/503")).toMatchObject({ ok: false, httpStatus: 503, errorCode: "UNEXPECTED_STATUS" });
    expect(await check("/503", { expectedStatusMin: 500, expectedStatusMax: 503 })).toMatchObject({ ok: true });
  });

  it("checks for a keyword, including across chunks", async () => {
    expect(await check("/ok", { bodyContains: "status is OK" })).toMatchObject({ ok: true });
    expect(await check("/ok", { bodyContains: "missing" })).toMatchObject({ ok: false, errorCode: "KEYWORD_NOT_FOUND" });
    expect(await check("/split", { bodyContains: "NEEDLE" })).toMatchObject({ ok: true });
  });

  it("stops reading after the body limit", async () => {
    expect(await check("/big", { bodyContains: "NEEDLE" })).toMatchObject({ ok: false, errorCode: "KEYWORD_NOT_FOUND" });
  });

  it("supports HEAD", async () => {
    expect(await check("/ok", { method: "HEAD" })).toMatchObject({ ok: true, httpStatus: 200 });
  });
});

describe("network failures", () => {
  it("times out", async () => {
    const r = await check("/slow", { timeoutMs: 300 });
    expect(r).toMatchObject({ ok: false, errorCode: "TIMEOUT" });
    expect(r.latencyMs).toBeLessThan(1500);
  });

  it("classifies DNS, refused, reset and protocol errors", async () => {
    expect(await check("/ok", {}, "nowhere.example.test")).toMatchObject({ errorCode: "DNS_ERROR" });
    const refused = await runHttpCheck(
      { url: `http://app.example.test:${closedPort}/`, method: "GET", timeoutMs: 1000, expectedStatusMin: 200, expectedStatusMax: 299, bodyContains: null, headers: [] },
      opts,
    );
    expect(refused).toMatchObject({ errorCode: "CONNECTION_REFUSED" });
    expect(await check("/reset")).toMatchObject({ errorCode: "CONNECTION_RESET" });
    expect(await check("/garbage")).toMatchObject({ errorCode: "PROTOCOL_ERROR" });
  });

  it("classifies TLS errors and accepts a trusted certificate", async () => {
    const tls = (host: string, withCa: boolean) =>
      runHttpCheck(
        { url: `https://${host}:${tlsPort}/`, method: "GET", timeoutMs: 1500, expectedStatusMin: 200, expectedStatusMax: 299, bodyContains: null, headers: [] },
        { ...opts, ...(withCa ? { ca } : {}) },
      );
    expect(await tls("secure.example.test", false)).toMatchObject({ ok: false, errorCode: "TLS_ERROR" });
    expect(await tls("secure.example.test", true)).toMatchObject({ ok: true, httpStatus: 200 });
    expect(await tls("wrong-name.example.test", true)).toMatchObject({ ok: false, errorCode: "TLS_ERROR" });
  });
});

describe("SSRF protection at request time", () => {
  it.each([
    ["http://localhost/", "internal"],
    ["http://127.0.0.1/", "private"],
    ["http://[::1]/", "private"],
    ["http://169.254.169.254/latest/meta-data/", "private"],
    ["http://10.1.2.3/", "private"],
  ])("refuses %s", async (url, reason) => {
    const r = await runHttpCheck(
      { url, method: "GET", timeoutMs: 1000, expectedStatusMin: 200, expectedStatusMax: 299, bodyContains: null, headers: [] },
      opts,
    );
    expect(r).toMatchObject({ ok: false, errorCode: "BLOCKED_DESTINATION" });
    expect(r.errorMessage).toMatch(reason);
  });

  it("refuses names that resolve to private, metadata or loopback addresses (DNS rebinding)", async () => {
    expect(await check("/ok", {}, "rebind.example.test")).toMatchObject({ errorCode: "BLOCKED_DESTINATION" });
    expect(await check("/ok", {}, "metadata.example.test")).toMatchObject({ errorCode: "BLOCKED_DESTINATION" });
    expect(await check("/ok", {}, "loopback6.example.test")).toMatchObject({ errorCode: "BLOCKED_DESTINATION" });
  });

  it("connects only to the validated address when a name has mixed answers", async () => {
    // 10.0.0.7 is dropped; the request goes to the allowed address and succeeds.
    expect(await check("/ok", {}, "mixed.example.test")).toMatchObject({ ok: true });
  });

  it("re-validates every redirect", async () => {
    expect(await check("/redirect-ok")).toMatchObject({ ok: true, redirects: 1 });
    expect(await check("/redirect-literal-internal")).toMatchObject({ ok: false, errorCode: "BLOCKED_DESTINATION" });
    expect(await check("/redirect-metadata-ip")).toMatchObject({ ok: false, errorCode: "BLOCKED_DESTINATION" });
    expect(await check("/redirect-rebind")).toMatchObject({ ok: false, errorCode: "BLOCKED_DESTINATION" });
    expect(await check("/redirect-file")).toMatchObject({ ok: false, errorCode: "BLOCKED_DESTINATION" });
  });

  it("stops after three redirects", async () => {
    expect(await check("/redirect-loop")).toMatchObject({ ok: false, errorCode: "TOO_MANY_REDIRECTS", redirects: 3 });
  });
});

describe("secret headers", () => {
  const secret = [{ name: "Authorization", value: "Bearer sk_live_123" }];

  it("are sent to the monitor's own origin, including same-origin redirects", async () => {
    received.length = 0;
    await check("/redirect-same-origin", { headers: secret });
    expect(received.map((h) => h.authorization)).toEqual(["Bearer sk_live_123", "Bearer sk_live_123"]);
  });

  it("are never forwarded to another origin after a redirect", async () => {
    received.length = 0;
    const r = await check("/redirect-other-origin", { headers: secret });
    expect(r).toMatchObject({ ok: true, redirects: 1 });
    expect(received[0]!.authorization).toBe("Bearer sk_live_123");
    expect(received[1]!.authorization).toBeUndefined();
    expect(received[1]!.host).toContain("other.example.test");
  });

  it("never appear in results", async () => {
    const r = await check("/503", { headers: secret });
    expect(JSON.stringify(r)).not.toContain("sk_live");
  });
});
