import { lookup as dnsLookup } from "node:dns/promises";
import http, { type IncomingMessage } from "node:http";
import https from "node:https";
import type { LookupFunction } from "node:net";
import { classifyNetworkError, type CheckErrorCode } from "./errors";
import { isBlockedAddress, staticDestinationProblem } from "./ssrf";

export const MAX_REDIRECTS = 3;
/** Only read when a keyword must be found; the rest of the body is never downloaded. */
export const MAX_BODY_BYTES = 1024 * 1024;
export const USER_AGENT = "UptimeWatch/1.0 (uptime monitor)";

export interface HttpCheckRequest {
  url: string;
  method: "GET" | "HEAD";
  timeoutMs: number;
  expectedStatusMin: number;
  expectedStatusMax: number;
  bodyContains: string | null;
  headers: { name: string; value: string }[];
}

export interface HttpCheckResult {
  ok: boolean;
  httpStatus: number | null;
  latencyMs: number;
  errorCode: CheckErrorCode | null;
  errorMessage: string | null;
  redirects: number;
}

export type Resolver = (hostname: string) => Promise<{ address: string; family: number }[]>;

export interface HttpCheckOptions {
  signal?: AbortSignal;
  /** DNS resolution; replaceable in tests. */
  resolve?: Resolver;
  /** Address policy; replaceable in tests only (to reach local test servers). */
  isBlocked?: (ip: string) => boolean;
  /** TLS trust roots; tests pass their own CA. */
  ca?: string | Buffer;
}

const defaultResolve: Resolver = (hostname) => dnsLookup(hostname, { all: true, verbatim: true });

class CheckFailure extends Error {
  constructor(public readonly code: CheckErrorCode, public readonly detail: string, public readonly status: number | null = null) {
    super(detail);
  }
}

/**
 * DNS lookup used by the socket itself: it resolves the host, drops every private/reserved
 * address and hands only validated addresses to the connection. Because validation and connection
 * use the same answer, a DNS rebinding between "check" and "connect" is impossible.
 */
function guardedLookup(resolve: Resolver, isBlocked: (ip: string) => boolean): LookupFunction {
  return (hostname, options, callback) => {
    resolve(hostname)
      .then((addresses) => {
        const allowed = addresses.filter((a) => !isBlocked(a.address));
        if (allowed.length === 0) {
          throw Object.assign(new Error("Destination resolves only to blocked addresses"), { code: "EBLOCKED" });
        }
        if ((options as { all?: boolean }).all) {
          (callback as unknown as (e: null, a: { address: string; family: number }[]) => void)(null, allowed);
        } else {
          callback(null, allowed[0]!.address, allowed[0]!.family);
        }
      })
      .catch((error: NodeJS.ErrnoException) => callback(error, "", 0));
  };
}

const sameOrigin = (a: URL, b: URL) => a.protocol === b.protocol && a.hostname === b.hostname && a.port === b.port;

function request(
  url: URL,
  method: string,
  headers: Record<string, string>,
  lookup: LookupFunction,
  signal: AbortSignal,
  ca: string | Buffer | undefined,
): Promise<IncomingMessage> {
  return new Promise((resolvePromise, reject) => {
    const client = url.protocol === "https:" ? https : http;
    const req = client.request(
      {
        protocol: url.protocol,
        hostname: url.hostname.replace(/^\[|\]$/g, ""),
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method,
        headers,
        lookup,
        agent: false, // no connection reuse: every check validates its own destination
        signal,
        ...(ca ? { ca } : {}),
      },
      resolvePromise,
    );
    req.on("error", reject);
    req.end();
  });
}

async function readUntil(res: IncomingMessage, keyword: string, signal: AbortSignal): Promise<boolean> {
  const needle = Buffer.from(keyword, "utf8");
  let buffered = Buffer.alloc(0);
  let total = 0;
  for await (const raw of res as AsyncIterable<Buffer>) {
    if (signal.aborted) break;
    // Never look past the limit, even when a single chunk crosses it.
    const chunk = raw.subarray(0, MAX_BODY_BYTES - total);
    total += chunk.length;
    // Keep only the tail needed to match a keyword split across chunks.
    buffered = Buffer.concat([buffered, chunk]);
    if (buffered.includes(needle)) return true;
    if (total >= MAX_BODY_BYTES) break;
    buffered = buffered.subarray(Math.max(0, buffered.length - needle.length + 1));
  }
  return false;
}

/**
 * Performs one check. Every hop (initial URL and each redirect) is validated statically and at
 * connection time; custom headers are only ever sent to the monitor's own origin.
 */
export async function runHttpCheck(input: HttpCheckRequest, options: HttpCheckOptions = {}): Promise<HttpCheckResult> {
  const started = performance.now();
  const timeout = AbortSignal.timeout(input.timeoutMs);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  const isBlocked = options.isBlocked ?? isBlockedAddress;
  const lookup = guardedLookup(options.resolve ?? defaultResolve, isBlocked);
  const origin = new URL(input.url);
  const elapsed = () => Math.round(performance.now() - started);

  let url = origin;
  let method: string = input.method;
  let redirects = 0;
  try {
    for (;;) {
      // IP literals never reach the DNS hook, so they are judged here; names are judged at connect time.
      const problem = staticDestinationProblem(url.toString());
      if (problem) throw new CheckFailure("BLOCKED_DESTINATION", `URL ${problem}`);

      const headers: Record<string, string> = {
        "user-agent": USER_AGENT,
        accept: "*/*",
        "accept-encoding": "identity",
      };
      if (sameOrigin(url, origin)) {
        for (const h of input.headers) headers[h.name.toLowerCase()] = h.value;
      }

      const res = await request(url, method, headers, lookup, signal, options.ca);
      const status = res.statusCode ?? 0;
      const location = res.headers.location;

      if (status >= 300 && status < 400 && status !== 304 && location) {
        res.resume();
        if (redirects >= MAX_REDIRECTS) {
          throw new CheckFailure("TOO_MANY_REDIRECTS", `More than ${MAX_REDIRECTS} redirects`, status);
        }
        let next: URL;
        try {
          next = new URL(location, url);
        } catch {
          throw new CheckFailure("INVALID_REDIRECT", "Redirect target is not a valid URL", status);
        }
        const redirectProblem = staticDestinationProblem(next.toString());
        if (redirectProblem) throw new CheckFailure("BLOCKED_DESTINATION", `Redirect target ${redirectProblem}`, status);
        if (status === 303 && method !== "HEAD") method = "GET";
        url = next;
        redirects++;
        continue;
      }

      const latencyMs = elapsed();
      if (status < input.expectedStatusMin || status > input.expectedStatusMax) {
        res.resume();
        return fail("UNEXPECTED_STATUS", `Expected ${input.expectedStatusMin}–${input.expectedStatusMax}, got ${status}`, status, latencyMs, redirects);
      }
      if (input.bodyContains && method === "GET") {
        const found = await readUntil(res, input.bodyContains, signal);
        res.destroy();
        if (!found) {
          return fail("KEYWORD_NOT_FOUND", `Keyword not found in the first ${MAX_BODY_BYTES / 1024} KiB of the response`, status, latencyMs, redirects);
        }
      } else {
        res.destroy();
      }
      return { ok: true, httpStatus: status, latencyMs, errorCode: null, errorMessage: null, redirects };
    }
  } catch (error) {
    if (error instanceof CheckFailure) return fail(error.code, error.detail, error.status, elapsed(), redirects);
    if (timeout.aborted) return fail("TIMEOUT", `No complete response within ${input.timeoutMs / 1000}s`, null, elapsed(), redirects);
    const { code, detail } = classifyNetworkError(error);
    return fail(code, detail, null, elapsed(), redirects);
  }
}

function fail(code: CheckErrorCode, message: string, status: number | null, latencyMs: number, redirects: number): HttpCheckResult {
  return { ok: false, httpStatus: status, latencyMs, errorCode: code, errorMessage: message.slice(0, 500), redirects };
}
