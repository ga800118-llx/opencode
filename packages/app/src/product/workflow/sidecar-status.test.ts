import { describe, expect, test } from "bun:test"
import { SIDECAR_PROGRESS_GRACE_MS, sidecarRecoveryState, type ProductSidecarStatus } from "./sidecar-status"

const status = (state: ProductSidecarStatus["state"], changedAt = 1_000): ProductSidecarStatus => ({
  state,
  changedAt,
})

describe("sidecarRecoveryState", () => {
  test("hides healthy and host-managed absence states", () => {
    expect(sidecarRecoveryState(undefined, 5_000)).toEqual({ kind: "hidden" })
    expect(sidecarRecoveryState(status("ready"), 5_000)).toEqual({ kind: "hidden" })
    expect(sidecarRecoveryState(status("unmanaged"), 5_000)).toEqual({ kind: "hidden" })
    expect(sidecarRecoveryState(status("unavailable"), 5_000)).toEqual({ kind: "hidden" })
    expect(sidecarRecoveryState(status("stopping"), 5_000)).toEqual({ kind: "hidden" })
  })

  test("delays starting and restarting progress for a deterministic grace period", () => {
    expect(sidecarRecoveryState(status("starting"), 1_000)).toEqual({ kind: "hidden" })
    expect(sidecarRecoveryState(status("starting"), 1_000 + SIDECAR_PROGRESS_GRACE_MS - 1)).toEqual({
      kind: "hidden",
    })
    expect(sidecarRecoveryState(status("starting"), 1_000 + SIDECAR_PROGRESS_GRACE_MS)).toEqual({
      kind: "progress",
      phase: "starting",
    })
    expect(sidecarRecoveryState(status("restarting"), 1_000 + SIDECAR_PROGRESS_GRACE_MS)).toEqual({
      kind: "progress",
      phase: "restarting",
    })
  })

  test("keeps failures and unexpected stops persistent with sanitized categories only", () => {
    expect(
      sidecarRecoveryState(
        { state: "failed", changedAt: 1_000, error: { kind: "health" } },
        20_000,
      ),
    ).toEqual({ kind: "failure", category: "health" })
    expect(sidecarRecoveryState(status("stopped"), 20_000)).toEqual({
      kind: "failure",
      category: "stopped",
    })

    const mapped = sidecarRecoveryState(
      {
        state: "failed",
        changedAt: 1_000,
        error: { kind: "exit" },
        message: "/Users/example/.agent stderr=secret",
        output: "Bearer secret",
      } as ProductSidecarStatus,
      20_000,
    )
    expect(mapped).toEqual({ kind: "failure", category: "exit" })
    expect(JSON.stringify(mapped)).not.toContain("secret")
    expect(JSON.stringify(mapped)).not.toContain("/Users")
  })
})
