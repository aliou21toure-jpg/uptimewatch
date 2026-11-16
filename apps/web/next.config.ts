import type { NextConfig } from "next";

const config: NextConfig = {
  // Workspace packages ship TypeScript source; Next compiles them.
  transpilePackages: ["@uptimewatch/config", "@uptimewatch/db", "@uptimewatch/queue"],
  serverExternalPackages: ["pg", "ioredis"],
  poweredByHeader: false,
};

export default config;
