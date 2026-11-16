import "server-only";
import { getWebEnv } from "@uptimewatch/config";
import { getDb, schema } from "@uptimewatch/db";
import { actionEmail, getEmailSender } from "@uptimewatch/email";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";

function createAuth() {
  const env = getWebEnv();
  const email = getEmailSender();

  return betterAuth({
    appName: "UptimeWatch",
    baseURL: env.APP_URL,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [env.APP_URL],
    database: drizzleAdapter(getDb(), {
      provider: "pg",
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
      },
    }),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: 10,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
      async sendResetPassword({ user, url }) {
        await email.send(
          actionEmail({
            to: user.email,
            subject: "Reset your UptimeWatch password",
            intro: "Someone asked to reset the password of your UptimeWatch account. The link is valid for one hour.",
            actionLabel: "Choose a new password",
            url,
          }),
        );
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      autoSignInAfterVerification: true,
      async sendVerificationEmail({ user, url }) {
        await email.send(
          actionEmail({
            to: user.email,
            subject: "Verify your UptimeWatch email",
            intro: `Welcome to UptimeWatch, ${user.name}. Confirm your email address to activate your account.`,
            actionLabel: "Verify my email",
            url,
          }),
        );
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
    },
    rateLimit: {
      enabled: true,
      window: 60,
      max: 100,
      customRules: {
        "/sign-in/email": { window: 60, max: 5 },
        "/sign-up/email": { window: 60, max: 5 },
        "/request-password-reset": { window: 300, max: 3 },
        "/send-verification-email": { window: 300, max: 3 },
      },
    },
    advanced: {
      // Cookies are HttpOnly + SameSite=Lax by default; force Secure whenever the app runs on HTTPS.
      useSecureCookies: env.APP_URL.startsWith("https://"),
    },
    telemetry: { enabled: false },
  });
}

let instance: ReturnType<typeof createAuth> | undefined;

/** Created lazily so `next build` does not need runtime secrets. */
export function getAuth() {
  instance ??= createAuth();
  return instance;
}
