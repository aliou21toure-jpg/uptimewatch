# 0006 — HTTP check engine and SSRF protection at request time

**Status:** accepted · 2026-11-16

## What a check does
1. Validate the URL statically (scheme, credentials, internal names, IP literals).
2. Resolve the host **inside the socket's own `lookup` hook**, drop every private/reserved address
   and hand only validated addresses to the connection. Validation and connection use the same DNS
   answer, so DNS rebinding between "check" and "connect" is impossible. A name whose answers are all
   blocked fails with `BLOCKED_DESTINATION`; mixed answers connect only to an allowed address.
3. Send the request with `agent: false` (no connection reuse across destinations), `Accept-Encoding:
   identity` (no decompression bombs) and the monitor's custom headers **only while the request stays
   on the monitor's origin** (scheme + host + port).
4. Follow at most 3 redirects manually; each hop goes through steps 1–2 again. Redirects to `file:`,
   internal names, private IPs or metadata endpoints are refused. 303 switches to GET.
5. Compare the final status with the accepted range; if a keyword is set (GET only), stream at most
   1 MiB of body looking for it, then close the connection. Bodies are never stored.
6. The whole check, redirects included, is bounded by the monitor's timeout.

Latency is the time until the final response's headers are received.

## Error classification
| Code | Cause |
|---|---|
| `DNS_ERROR` | Name does not resolve |
| `BLOCKED_DESTINATION` | Private/reserved/metadata destination, directly or via redirect |
| `CONNECTION_REFUSED` / `CONNECTION_RESET` / `NETWORK_UNREACHABLE` | TCP-level failures |
| `TIMEOUT` | No complete response within the timeout |
| `TLS_ERROR` | Expired, self-signed, untrusted or wrong-host certificate (Node code kept as detail) |
| `TOO_MANY_REDIRECTS` / `INVALID_REDIRECT` | Redirect policy |
| `UNEXPECTED_STATUS` / `KEYWORD_NOT_FOUND` | Response did not meet the monitor's expectations |
| `PROTOCOL_ERROR` | Not a valid HTTP response |

All of these mean **the monitored service failed** (`down`). Platform problems are recorded separately
as `error` (`ENGINE_ERROR`, `LEASE_EXPIRED`) or `skipped` (`STALE`) and never move a monitor's state.

## Monitor state machine
`HEALTHY → DEGRADED → DOWN → RECOVERING → HEALTHY`, thresholds 2/2, implemented as a pure function
(`applyCheckResult`) and applied in the same transaction that records the result, with the monitor
row locked. Results for a slot older than the last applied one (`last_result_slot`) are recorded but
do not move state, so a late retry cannot overwrite a newer verdict. The transition
(`incident_opened` / `incident_resolved`) is returned to the caller for the incident engine (Phase 5).

## Testing
The tests run the production client against local HTTP and HTTPS servers (self-signed certificate
generated with OpenSSL per run). They inject a fake DNS and a policy that allows exactly the test
server's loopback address; every other rule is the production one.
