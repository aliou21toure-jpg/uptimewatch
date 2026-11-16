import type { NextConfig } from "next";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

// One .env at the monorepo root serves the web app, the worker and the scripts.
// Real environment variables (CI, production) always take precedence over the file.
const rootEnv = resolve(process.cwd(), "../../.env");
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const config: NextConfig = {
  // Workspace packages ship TypeScript source; Next compiles them.
  transpilePackages: [
    "@uptimewatch/config",
    "@uptimewatch/db",
    "@uptimewatch/domain",
    "@uptimewatch/email",
    "@uptimewatch/monitoring",
    "@uptimewatch/queue",
  ],
  serverExternalPackages: ["pg", "ioredis"],
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Invitation and reset links carry tokens in the URL; never leak them via Referer.
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default config;
