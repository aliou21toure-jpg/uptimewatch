import { randomBytes } from "node:crypto";

// A throwaway key per test run; production keys come from the environment.
process.env.ENCRYPTION_KEY ??= randomBytes(32).toString("base64");
