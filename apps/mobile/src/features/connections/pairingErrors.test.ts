import { describe, expect, it } from "vitest";

import { SynaraHttpError } from "@/transport/errors";
import { diagnosePairingError } from "./pairingErrors";

describe("diagnosePairingError", () => {
  it("explains a used or expired pairing credential", () => {
    const diagnosis = diagnosePairingError(new SynaraHttpError("boom", 401, ""));
    expect(diagnosis.message).toMatch(/rejected this pairing credential/i);
    expect(diagnosis.hint).toMatch(/single-use/i);
  });

  it("calls out the wrong port on a 404", () => {
    const diagnosis = diagnosePairingError(
      new SynaraHttpError("boom", 404, ""),
      "http://10.0.0.2:3774",
    );
    expect(diagnosis.message).toContain("http://10.0.0.2:3774");
    expect(diagnosis.hint).toMatch(/3775/);
  });

  it("explains an unreachable host", () => {
    const diagnosis = diagnosePairingError(new TypeError("Network request failed"));
    expect(diagnosis.message).toMatch(/Could not reach/i);
    expect(diagnosis.hint).toMatch(/same network/i);
  });

  it("surfaces the App Transport Security hint", () => {
    const diagnosis = diagnosePairingError(
      new Error("The resource could not be loaded because the App Transport Security policy..."),
    );
    expect(diagnosis.hint).toMatch(/NSAllowsArbitraryLoads/);
  });

  it("teaches the pairing link shape", () => {
    const diagnosis = diagnosePairingError(
      new Error("Pairing link is missing its #token=... fragment."),
    );
    expect(diagnosis.hint).toMatch(/pair#token/);
  });

  it("falls through to the raw message", () => {
    expect(diagnosePairingError(new Error("something odd"))).toEqual({
      message: "something odd",
      hint: null,
    });
  });
});
