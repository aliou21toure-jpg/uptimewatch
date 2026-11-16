import { decryptMonitorHeaders } from "@uptimewatch/domain";
import { runHttpCheck, type HttpCheckOptions } from "@uptimewatch/monitoring";
import type { CheckExecutor } from "./checks";

/** Real check engine: decrypts the monitor's headers in memory only and runs the SSRF-safe client. */
export function createHttpExecutor(options: Omit<HttpCheckOptions, "signal"> = {}): CheckExecutor {
  return async (monitor, signal) => {
    const result = await runHttpCheck(
      {
        url: monitor.url,
        method: monitor.method as "GET" | "HEAD",
        timeoutMs: monitor.timeoutMs,
        expectedStatusMin: monitor.expectedStatusMin,
        expectedStatusMax: monitor.expectedStatusMax,
        bodyContains: monitor.bodyContains,
        headers: decryptMonitorHeaders(monitor),
      },
      { ...options, signal },
    );
    return {
      state: result.ok ? "up" : "down",
      httpStatus: result.httpStatus,
      latencyMs: result.latencyMs,
      errorCode: result.errorCode,
      errorMessage: result.errorMessage,
    };
  };
}
