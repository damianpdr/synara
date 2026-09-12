import type { NetworkInterfaceInfo } from "node:os";
import { describe, expect, it } from "vitest";

import { selectReachableIpv4Address } from "./reachableAddress";

const ipv4 = (address: string, internal = false): NetworkInterfaceInfo => ({
  address,
  netmask: "255.255.255.0",
  family: "IPv4",
  mac: "00:00:00:00:00:00",
  internal,
  cidr: `${address}/24`,
});

const ipv6 = (address: string): NetworkInterfaceInfo => ({
  address,
  netmask: "ffff:ffff:ffff:ffff::",
  family: "IPv6",
  mac: "00:00:00:00:00:00",
  internal: false,
  scopeid: 0,
  cidr: `${address}/64`,
});

describe("selectReachableIpv4Address", () => {
  it("returns null when no non-internal IPv4 interface exists", () => {
    expect(
      selectReachableIpv4Address({
        lo0: [ipv4("127.0.0.1", true), ipv6("::1")],
      }),
    ).toBeNull();
    expect(selectReachableIpv4Address({})).toBeNull();
  });

  it("prefers a Tailscale CGNAT address over private and public addresses", () => {
    expect(
      selectReachableIpv4Address({
        en0: [ipv4("192.168.1.42")],
        utun9: [ipv4("100.101.102.103")],
        en1: [ipv4("203.0.113.7")],
      }),
    ).toBe("100.101.102.103");
  });

  it("prefers a private RFC 1918 address over a public one", () => {
    expect(
      selectReachableIpv4Address({
        en0: [ipv4("203.0.113.7")],
        en1: [ipv4("10.0.0.5")],
      }),
    ).toBe("10.0.0.5");
    expect(
      selectReachableIpv4Address({
        en0: [ipv4("172.16.4.2")],
        en1: [ipv4("192.168.0.10")],
      }),
    ).toBe("172.16.4.2");
  });

  it("falls back to the first non-internal IPv4 when nothing is private", () => {
    expect(
      selectReachableIpv4Address({
        en0: [ipv6("fd00::1"), ipv4("203.0.113.7")],
        en1: [ipv4("198.51.100.9")],
      }),
    ).toBe("203.0.113.7");
  });

  it("skips IPv6 and internal addresses entirely", () => {
    expect(
      selectReachableIpv4Address({
        lo0: [ipv4("127.0.0.1", true)],
        en0: [ipv6("fe80::1"), ipv4("192.168.1.42")],
      }),
    ).toBe("192.168.1.42");
  });

  it("does not treat lookalike addresses as Tailscale or private", () => {
    expect(
      selectReachableIpv4Address({
        en0: [ipv4("100.128.0.1")],
        en1: [ipv4("172.32.0.1")],
      }),
    ).toBe("100.128.0.1");
  });
});
