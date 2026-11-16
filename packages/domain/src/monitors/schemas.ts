import { z } from "zod";
import { staticDestinationProblem } from "../security/destination";

import { MAX_HEADERS, MONITOR_INTERVALS } from "./constants";

export { MAX_HEADERS, MONITOR_INTERVALS };

/** Headers the HTTP client controls itself, or that would alter routing/framing. */
const FORBIDDEN_HEADERS = new Set([
  "host", "content-length", "transfer-encoding", "connection", "keep-alive", "upgrade",
  "proxy-authorization", "proxy-connection", "te", "trailer", "expect",
]);

const headerName = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/, "is not a valid header name")
  .refine((n) => !FORBIDDEN_HEADERS.has(n.toLowerCase()), "cannot be set on a monitor");

const headerValue = z
  .string()
  .max(1024)
  .regex(/^[^\r\n\0]*$/, "must not contain line breaks");

export const headersSchema = z
  .array(z.object({ name: headerName, value: headerValue }))
  .max(MAX_HEADERS)
  .refine(
    (list) => new Set(list.map((h) => h.name.toLowerCase())).size === list.length,
    "each header can only be set once",
  );

export const monitorUrlSchema = z
  .string()
  .trim()
  .max(2048)
  .superRefine((url, ctx) => {
    const problem = staticDestinationProblem(url);
    if (problem) ctx.addIssue({ code: "custom", message: `URL ${problem}` });
  });

const fields = {
  name: z.string().trim().min(1).max(120),
  url: monitorUrlSchema,
  method: z.enum(["GET", "HEAD"]),
  intervalSeconds: z
    .number()
    .int()
    .refine((v) => (MONITOR_INTERVALS as readonly number[]).includes(v), {
      message: `must be one of ${MONITOR_INTERVALS.join(", ")} seconds`,
    }),
  timeoutMs: z.number().int().min(1000).max(30000),
  expectedStatusMin: z.number().int().min(100).max(599),
  expectedStatusMax: z.number().int().min(100).max(599),
  bodyContains: z.string().trim().min(1).max(200).nullable(),
  headers: headersSchema,
};

export interface CheckSettings {
  method: "GET" | "HEAD";
  intervalSeconds: number;
  timeoutMs: number;
  expectedStatusMin: number;
  expectedStatusMax: number;
  bodyContains: string | null;
}

/** Cross-field rules, shared by create and update (update checks the merged result). */
export function crossFieldIssues(m: CheckSettings): { path: string; message: string }[] {
  const issues: { path: string; message: string }[] = [];
  if (m.timeoutMs >= m.intervalSeconds * 1000) {
    issues.push({ path: "timeoutMs", message: "must be shorter than the check interval" });
  }
  if (m.expectedStatusMax < m.expectedStatusMin) {
    issues.push({ path: "expectedStatusMax", message: "must be greater than or equal to the minimum" });
  }
  if (m.method === "HEAD" && m.bodyContains) {
    issues.push({ path: "bodyContains", message: "keyword checks need GET (HEAD responses have no body)" });
  }
  return issues;
}

/** Defaults from the specification (§2.2). */
export const createMonitorInput = z
  .object({
    name: fields.name,
    url: fields.url,
    method: fields.method.default("GET"),
    intervalSeconds: fields.intervalSeconds.default(60),
    timeoutMs: fields.timeoutMs.default(10_000),
    expectedStatusMin: fields.expectedStatusMin.default(200),
    expectedStatusMax: fields.expectedStatusMax.default(299),
    bodyContains: fields.bodyContains.default(null),
    headers: fields.headers.default([]),
  })
  .strict()
  .superRefine((m, ctx) => {
    for (const issue of crossFieldIssues(m)) ctx.addIssue({ code: "custom", path: [issue.path], message: issue.message });
  });

/** All fields optional. `headers` replaces the whole set when present; omit it to keep the current headers. */
export const updateMonitorInput = z.object(fields).partial().strict();

export const listMonitorsQuery = z.object({
  q: z.string().trim().max(200).optional(),
  state: z.enum(["unknown", "healthy", "degraded", "down", "recovering", "paused"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(200).optional(),
});

export type CreateMonitorInput = z.input<typeof createMonitorInput>;
export type UpdateMonitorInput = z.input<typeof updateMonitorInput>;
