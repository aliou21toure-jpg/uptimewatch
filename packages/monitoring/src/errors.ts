/** Stable error codes stored on checks and shown in the UI. */
export type CheckErrorCode =
  | "DNS_ERROR"
  | "BLOCKED_DESTINATION"
  | "CONNECTION_REFUSED"
  | "CONNECTION_RESET"
  | "NETWORK_UNREACHABLE"
  | "TIMEOUT"
  | "TLS_ERROR"
  | "TOO_MANY_REDIRECTS"
  | "INVALID_REDIRECT"
  | "UNEXPECTED_STATUS"
  | "KEYWORD_NOT_FOUND"
  | "PROTOCOL_ERROR";

export const ERROR_LABELS: Record<CheckErrorCode, string> = {
  DNS_ERROR: "DNS resolution failed",
  BLOCKED_DESTINATION: "Destination is a private or reserved address",
  CONNECTION_REFUSED: "Connection refused",
  CONNECTION_RESET: "Connection reset",
  NETWORK_UNREACHABLE: "Network unreachable",
  TIMEOUT: "Timed out",
  TLS_ERROR: "TLS/certificate error",
  TOO_MANY_REDIRECTS: "Too many redirects",
  INVALID_REDIRECT: "Invalid redirect",
  UNEXPECTED_STATUS: "Unexpected status code",
  KEYWORD_NOT_FOUND: "Keyword not found",
  PROTOCOL_ERROR: "Invalid HTTP response",
};

const TLS_CODES = new Set([
  "CERT_HAS_EXPIRED", "CERT_NOT_YET_VALID", "DEPTH_ZERO_SELF_SIGNED_CERT", "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "UNABLE_TO_GET_ISSUER_CERT", "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "ERR_TLS_CERT_ALTNAME_INVALID", "CERT_REVOKED", "CERT_UNTRUSTED", "HOSTNAME_MISMATCH",
]);

/** Maps a Node network/TLS error to a check error code plus a short, secret-free detail. */
export function classifyNetworkError(error: unknown): { code: CheckErrorCode; detail: string } {
  const e = error as { code?: string; name?: string; message?: string };
  const code = e?.code ?? "";
  if (code === "EBLOCKED") return { code: "BLOCKED_DESTINATION", detail: "Every resolved address is private or reserved" };
  if (code === "ENOTFOUND" || code === "EAI_AGAIN" || code === "ENODATA" || code === "ESERVFAIL") {
    return { code: "DNS_ERROR", detail: code === "ENOTFOUND" ? "Domain not found" : `DNS lookup failed (${code})` };
  }
  if (code === "ECONNREFUSED") return { code: "CONNECTION_REFUSED", detail: "The server refused the connection" };
  if (code === "ECONNRESET" || code === "EPIPE") return { code: "CONNECTION_RESET", detail: "The connection was reset" };
  if (code === "EHOSTUNREACH" || code === "ENETUNREACH") return { code: "NETWORK_UNREACHABLE", detail: code };
  if (code === "ETIMEDOUT" || code === "UND_ERR_CONNECT_TIMEOUT" || e?.name === "TimeoutError" || e?.name === "AbortError") {
    return { code: "TIMEOUT", detail: "No response within the timeout" };
  }
  if (TLS_CODES.has(code) || code.startsWith("ERR_SSL") || code.startsWith("ERR_TLS")) {
    return { code: "TLS_ERROR", detail: code };
  }
  if (code.startsWith("HPE_") || code === "ERR_INVALID_HTTP_RESPONSE") return { code: "PROTOCOL_ERROR", detail: code };
  return { code: "CONNECTION_RESET", detail: code || "Network error" };
}
