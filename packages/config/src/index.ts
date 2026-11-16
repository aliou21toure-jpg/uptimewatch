import { z } from "zod";

const postgresUrl = z.url().refine((u) => /^postgres(ql)?:\/\//.test(u), "must be a postgres:// URL");
const redisUrl = z.url().refine((u) => /^rediss?:\/\//.test(u), "must be a redis:// URL");

/** Variables every process needs (web and worker). */
const baseSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: postgresUrl,
  REDIS_URL: redisUrl,
});

const emailFields = {
  APP_URL: z.url().default("http://localhost:3000"),
  RESEND_API_KEY: z.string().min(1).optional(),
  EMAIL_FROM: z.string().min(3).default("UptimeWatch <onboarding@resend.dev>"),
  /**
   * `console` prints emails to the server log instead of sending them. It is the default in
   * development; in production it must be chosen explicitly (e.g. for CI end-to-end runs).
   */
  EMAIL_TRANSPORT: z.enum(["resend", "console"]).optional(),
};

interface EmailInput {
  NODE_ENV: "development" | "test" | "production";
  RESEND_API_KEY?: string | undefined;
  EMAIL_TRANSPORT?: "resend" | "console" | undefined;
}

/** Resend unless told otherwise; console by default in development. */
const resolveTransport = <T extends EmailInput>(env: T) => ({
  ...env,
  EMAIL_TRANSPORT: (env.EMAIL_TRANSPORT ??
    (env.RESEND_API_KEY || env.NODE_ENV === "production" ? "resend" : "console")) as "resend" | "console",
});

const requireKeyForResend: [
  (env: { EMAIL_TRANSPORT: "resend" | "console"; RESEND_API_KEY?: string | undefined }) => boolean,
  { message: string; path: string[] },
] = [
  (env) => env.EMAIL_TRANSPORT !== "resend" || Boolean(env.RESEND_API_KEY),
  {
    message: "is required to send emails with Resend (or set EMAIL_TRANSPORT=console outside production use)",
    path: ["RESEND_API_KEY"],
  },
];

/** Every process that sends email: web (auth, invitations) and worker (incident alerts). */
const emailSchema = z
  .object({ NODE_ENV: baseSchema.shape.NODE_ENV, ...emailFields })
  .transform(resolveTransport)
  .refine(...requireKeyForResend);

/** Web application: base + authentication + email. */
const webSchema = baseSchema
  .extend({ ...emailFields, BETTER_AUTH_SECRET: z.string().min(32, "must be at least 32 characters") })
  .transform(resolveTransport)
  .refine(...requireKeyForResend);

export type Env = z.infer<typeof baseSchema>;
export type WebEnv = z.infer<typeof webSchema>;
export type EmailEnv = z.infer<typeof emailSchema>;

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

let cachedEmail: EmailEnv | undefined;

export function getEmailEnv(): EmailEnv {
  cachedEmail ??= parseWith(emailSchema, process.env);
  return cachedEmail;
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

const encryptionKeySchema = z.object({
  ENCRYPTION_KEY: z
    .string()
    .refine((v) => Buffer.from(v, "base64").length === 32, "must be 32 bytes encoded in base64"),
});

let cachedKey: Buffer | undefined;

/**
 * AES-256 key protecting monitor secrets (custom headers). Validated on its own so that only the
 * processes that touch secrets (web, check workers) need it.
 */
export function getEncryptionKey(): Buffer {
  if (!cachedKey) {
    const { ENCRYPTION_KEY } = parseWith(encryptionKeySchema, process.env);
    cachedKey = Buffer.from(ENCRYPTION_KEY, "base64");
  }
  return cachedKey;
}
