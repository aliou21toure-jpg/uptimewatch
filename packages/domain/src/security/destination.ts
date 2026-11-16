import { BlockList, isIP } from "node:net";

/**
 * Address ranges a monitor must never reach (SSRF). Used now to reject obviously internal URLs at
 * creation time, and in Phase 4 to validate every resolved IP right before each request — a
 * creation-time check alone is not enough (DNS can change, redirects can point inward).
 */
const blocked = new BlockList();
const v4: [string, number][] = [
  ["0.0.0.0", 8], // "this" network
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, incl. cloud metadata 169.254.169.254
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // documentation
  ["192.88.99.0", 24], // 6to4 relay
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // documentation
  ["203.0.113.0", 24], // documentation
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved + broadcast
];
for (const [net, prefix] of v4) blocked.addSubnet(net, prefix, "ipv4");
const v6: [string, number][] = [
  ["::", 128], // unspecified
  ["::1", 128], // loopback
  ["64:ff9b::", 96], // NAT64
  ["100::", 64], // discard
  ["2001:db8::", 32], // documentation
  ["fc00::", 7], // unique local
  ["fe80::", 10], // link-local
  ["ff00::", 8], // multicast
];
for (const [net, prefix] of v6) blocked.addSubnet(net, prefix, "ipv6");

export function isBlockedAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 0) return true;
  if (family === 6) {
    // IPv4-mapped IPv6 (::ffff:a.b.c.d or ::ffff:hhhh:hhhh) is judged by its IPv4 address.
    // (Not done with a ::ffff:0:0/96 rule: Node's BlockList would then match every IPv4 address.)
    const dotted = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
    if (dotted) return isBlockedAddress(dotted[1]!);
    const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(ip);
    if (hex) {
      const hi = parseInt(hex[1]!, 16);
      const lo = parseInt(hex[2]!, 16);
      return isBlockedAddress(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
    }
    return blocked.check(ip, "ipv6");
  }
  return blocked.check(ip, "ipv4");
}

const BLOCKED_HOST_SUFFIXES = [".localhost", ".local", ".internal", ".localdomain", ".home.arpa"];

/** Static checks that need no DNS: scheme, credentials, internal host names and IP literals. */
export function staticDestinationProblem(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "must be a valid URL";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return "must use http or https";
  if (url.username || url.password) return "must not contain credentials";
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host) return "must include a host";
  const bare = host.startsWith("[") ? host.slice(1, -1) : host;
  if (isIP(bare)) return isBlockedAddress(bare) ? "points to a private or reserved address" : null;
  // Numeric forms such as http://2130706433 or http://0x7f.1 are normalized by WHATWG URL to dotted IPv4,
  // so they are caught above. Single-label names resolve inside the host network.
  if (host === "localhost" || BLOCKED_HOST_SUFFIXES.some((s) => host.endsWith(s))) {
    return "points to an internal host name";
  }
  if (!host.includes(".")) return "must be a fully qualified domain name";
  return null;
}
