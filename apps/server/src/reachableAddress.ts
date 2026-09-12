/**
 * reachableAddress - Picks a dialable IPv4 address for wildcard binds.
 *
 * When the server binds 0.0.0.0/:: without --public-url, the startup pairing
 * URL cannot literally say "0.0.0.0" — a phone needs a concrete address.
 * Selection prefers Tailscale's CGNAT range (100.64.0.0/10), then RFC 1918
 * private ranges, then the first non-internal IPv4, so the printed link is
 * reachable in the common Tailscale and LAN cases.
 *
 * @module ReachableAddress
 */
import type { NetworkInterfaceInfo } from "node:os";

const ipv4Octets = (address: string): readonly [number, number, number, number] | null => {
  const parts = address.split(".").map(Number);
  const [a, b, c, d] = parts;
  if (
    a === undefined ||
    b === undefined ||
    c === undefined ||
    d === undefined ||
    parts.length !== 4
  ) {
    return null;
  }
  return [a, b, c, d].every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255)
    ? [a, b, c, d]
    : null;
};

const isTailscaleCgnatAddress = (address: string): boolean => {
  const octets = ipv4Octets(address);
  return octets !== null && octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127;
};

const isPrivateAddress = (address: string): boolean => {
  const octets = ipv4Octets(address);
  if (octets === null) return false;
  const [a, b] = octets;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
};

const isIpv4Info = (info: NetworkInterfaceInfo): boolean =>
  info.family === "IPv4" || (info.family as unknown) === 4;

/**
 * Returns the best non-loopback IPv4 address from `os.networkInterfaces()`,
 * or null when no external IPv4 interface exists (caller falls back to
 * localhost and keeps the "replace localhost" hint).
 */
export const selectReachableIpv4Address = (
  interfaces: NodeJS.Dict<ReadonlyArray<NetworkInterfaceInfo>>,
): string | null => {
  let privateAddress: string | null = null;
  let otherAddress: string | null = null;
  for (const infos of Object.values(interfaces)) {
    for (const info of infos ?? []) {
      if (!isIpv4Info(info) || info.internal) continue;
      if (isTailscaleCgnatAddress(info.address)) return info.address;
      if (privateAddress === null && isPrivateAddress(info.address)) {
        privateAddress = info.address;
      }
      otherAddress ??= info.address;
    }
  }
  return privateAddress ?? otherAddress;
};
