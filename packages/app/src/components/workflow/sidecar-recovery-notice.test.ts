import { describe, expect, test } from "bun:test"
import { sidecarRecoveryNoticeViewModel } from "./sidecar-recovery-notice"

describe("sidecarRecoveryNoticeViewModel", () => {
  test("renders no notice for hidden states", () => {
    expect(
      sidecarRecoveryNoticeViewModel({
        state: { kind: "hidden" },
        restartState: "idle",
        diagnosticsAvailable: true,
        diagnosticsState: "idle",
      }),
    ).toBeUndefined()
  })

  test("uses polite status semantics for delayed progress", () => {
    expect(
      sidecarRecoveryNoticeViewModel({
        state: { kind: "progress", phase: "restarting" },
        restartState: "idle",
        diagnosticsAvailable: true,
        diagnosticsState: "idle",
      }),
    ).toEqual({
      kind: "progress",
      role: "status",
      live: "polite",
      description: "workflow.sidecar.progress.restarting",
    })
  })

  test("uses alert semantics and retry actions for persistent failures", () => {
    expect(
      sidecarRecoveryNoticeViewModel({
        state: { kind: "failure", category: "health" },
        restartState: "failed",
        diagnosticsAvailable: true,
        diagnosticsState: "failed",
      }),
    ).toEqual({
      kind: "failure",
      role: "alert",
      description: "workflow.sidecar.failure.health",
      restart: { label: "workflow.sidecar.action.restartRetry", pending: false },
      diagnostics: { label: "workflow.sidecar.action.diagnosticsRetry", pending: false },
    })
  })

  test("exposes pending controls without raw status or action errors", () => {
    const view = sidecarRecoveryNoticeViewModel({
      state: {
        kind: "failure",
        category: "exit",
        message: "/Users/example/private.log Bearer secret",
      } as never,
      restartState: "pending",
      diagnosticsAvailable: true,
      diagnosticsState: "pending",
    })

    expect(view).toEqual({
      kind: "failure",
      role: "alert",
      description: "workflow.sidecar.failure.exit",
      restart: { label: "workflow.sidecar.action.restarting", pending: true },
      diagnostics: { label: "workflow.sidecar.action.exporting", pending: true },
    })
    expect(JSON.stringify(view)).not.toContain("private.log")
    expect(JSON.stringify(view)).not.toContain("secret")
  })

  test("omits diagnostics when the platform cannot export logs", () => {
    expect(
      sidecarRecoveryNoticeViewModel({
        state: { kind: "failure", category: "stopped" },
        restartState: "idle",
        diagnosticsAvailable: false,
        diagnosticsState: "idle",
      }),
    ).toMatchObject({
      description: "workflow.sidecar.failure.stopped",
      diagnostics: undefined,
    })
  })
})
