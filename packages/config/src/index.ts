import { z } from "zod";

const postgresUrl = z.url().refine((u) => /^postgres(ql)?:\/\//.test(u), "must be a postgres:// URL");
const redisUrl = z.url().refine((u) => /^rediss?:\/\//.test(u), "must be a redis:// URL");

/** Variables every process needs (web and worker). */
const baseSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: postgresUrl,
  REDIS_URL: redisUrl,
});

/** Additional variables for the web application (authentication and email). */
const webSchema = baseSchema
  .extend({
    APP_URL: z.url().default("http://localhost:3000"),
    BETTER_AUTH_SECRET: z.string().min(32, "must be at least 32 characters"),
    RESEND_API_KEY: z.string().min(1).optional(),
    EMAIL_FROM: z.string().min(3).default("UptimeWatch <onboarding@resend.dev>"),
    /**
     * `console` prints emails to the server log instead of sending them. It is the default in
     * development; in production it must be chosen explicitly (e.g. for CI end-to-end runs).
     */
    EMAIL_TRANSPORT: z.enum(["resend", "console"]).optional(),
  })
  .transform((env) => ({
    ...env,
    EMAIL_TRANSPORT:
      env.EMAIL_TRANSPORT ?? (env.RESEND_API_KEY || env.NODE_ENV === "production" ? "resend" : "console"),
  }))
  .refine((env) => env.EMAIL_TRANSPORT !== "resend" || env.RESEND_API_KEY, {
    message: "is required to send emails with Resend (or set EMAIL_TRANSPORT=console outside production use)",
    path: ["RESEND_API_KEY"],
  });

export type Env = z.infer<typeof baseSchema>;
export type WebEnv = z.infer<typeof webSchema>;

export class EnvValidationError extends Error {
  constructor(public readonly issues: string[]) {
    // Only variable names and reasons are reported — never the values, which may be secrets.
    super(`Invalid environment configuration:\n${issues.map((i) => `  - ${i}`).join("\n")}`);
    this.name = "EnvValidationError";
  }
}

function parseWith<S extends z.ZodType>(schema: S, source: Record<string, string | undefined>): z.infer<S> {
  // Treat `KEY=` (empty) like an unset variable, as .env templates leave optional keys blank.
  const cleaned = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== undefined && v !== ""));
  const result = schema.safeParse(cleaned);
  if (!result.success) {
    throw new EnvValidationError(
      result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    );
  }
  return result.data;
}

export function parseEnv(source: Record<string, string | undefined>): Env {
  return parseWith(baseSchema, source);
}

export function parseWebEnv(source: Record<string, string | undefined>): WebEnv {
  return parseWith(webSchema, source);
}

let cachedBase: Env | undefined;
let cachedWeb: WebEnv | undefined;

/** Validated environment, parsed lazily so that builds do not require runtime secrets. */
export function getEnv(): Env {
  cachedBase ??= parseEnv(process.env);
  return cachedBase;
}

export function getWebEnv(): WebEnv {
  cachedWeb ??= parseWebEnv(process.env);
  return cachedWeb;
}
