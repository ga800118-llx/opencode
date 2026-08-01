import { describe, expect, test } from "bun:test"
import { createRoot } from "solid-js"
import type { ProductSidecarHost, ProductSidecarStatus } from "./sidecar-status"
import { createSidecarRecoveryController } from "./use-sidecar-recovery"

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
const ready = { state: "ready", changedAt: 10 } as const satisfies ProductSidecarStatus
const failed = {
  state: "failed",
  changedAt: 10,
  error: { kind: "start" },
} as const satisfies ProductSidecarStatus

describe("createSidecarRecoveryController", () => {
  test("does nothing when the browser host has no sidecar or diagnostics exporter", async () => {
    createRoot((dispose) => {
      const controller = createSidecarRecoveryController({})

      expect(controller.state()).toEqual({ kind: "hidden" })
      expect(controller.restartState()).toBe("idle")
      expect(controller.diagnostics.available).toBe(false)
      expect(controller.diagnosticsState()).toBe("idle")
      expect(controller.restart()).toBeUndefined()
      expect(controller.exportDiagnostics()).toBeUndefined()
      dispose()
    })
  })

  test("loads and subscribes once, releases a late subscription, and ignores late callbacks", async () => {
    const subscription = deferred<() => void>()
    const initial = deferred<ProductSidecarStatus>()
    let listener: ((status: ProductSidecarStatus) => void) | undefined
    let gets = 0
    let subscribes = 0
    let unsubscribes = 0

    let disposeRoot!: () => void
    const controller = createRoot((dispose) => {
      disposeRoot = dispose
      return createSidecarRecoveryController({
        now: () => 20_000,
        sidecar: {
          getStatus() {
            gets++
            return initial.promise
          },
          subscribe(next) {
            subscribes++
            listener = next
            return subscription.promise
          },
          async restart() {
            return ready
          },
        },
      })
    })

    expect(gets).toBe(1)
    expect(subscribes).toBe(1)
    disposeRoot()
    subscription.resolve(() => unsubscribes++)
    initial.resolve(failed)
    await settle()
    expect(unsubscribes).toBe(1)

    listener?.(failed)
    expect(controller.state()).toEqual({ kind: "hidden" })
  })

  test("cleans the transitional grace timer on disposal", async () => {
    const timers: Array<() => void> = []
    const cleared: number[] = []

    await new Promise<void>((done) => {
      createRoot((dispose) => {
        createSidecarRecoveryController({
          now: () => 1_000,
          sidecar: sidecar({ state: "starting", changedAt: 1_000 }),
          setTimer(callback) {
            timers.push(callback)
            return timers.length
          },
          clearTimer(timer) {
            cleared.push(timer)
          },
        })

        void settle().then(() => {
          expect(timers).toHaveLength(1)
          dispose()
          expect(cleared).toEqual([1])
          timers[0]?.()
          done()
        })
      })
    })
  })

  test("serializes restart calls, reports pending failure, and allows a successful retry", async () => {
    const attempts = [deferred<ProductSidecarStatus>(), deferred<ProductSidecarStatus>()]
    let calls = 0

    await new Promise<void>((done) => {
      createRoot((dispose) => {
        const controller = createSidecarRecoveryController({
          now: () => 20_000,
          sidecar: sidecar(failed, () => attempts[calls++].promise),
        })

        void settle().then(async () => {
          expect(controller.state()).toEqual({ kind: "failure", category: "start" })
          const first = controller.restart()
          const duplicate = controller.restart()
          expect(first).toBe(duplicate)
          expect(calls).toBe(1)
          expect(controller.restartState()).toBe("pending")

          attempts[0].reject(new Error("raw /tmp/private.log"))
          await first
          expect(controller.restartState()).toBe("failed")
          expect(JSON.stringify(controller.state())).not.toContain("private.log")

          const retry = controller.restart()
          expect(calls).toBe(2)
          expect(controller.restartState()).toBe("pending")
          attempts[1].resolve(ready)
          await retry
          expect(controller.restartState()).toBe("idle")
          expect(controller.state()).toEqual({ kind: "hidden" })
          dispose()
          done()
        })
      })
    })
  })

  test("offers diagnostics only when supported and serializes export retries without exposing paths", async () => {
    const attempts = [deferred<string>(), deferred<string>()]
    let calls = 0

    await new Promise<void>((done) => {
      createRoot((dispose) => {
        const controller = createSidecarRecoveryController({
          exportDebugLogs: () => attempts[calls++].promise,
        })

        expect(controller.diagnostics.available).toBe(true)
        const first = controller.exportDiagnostics()
        expect(controller.exportDiagnostics()).toBe(first)
        expect(calls).toBe(1)
        expect(controller.diagnosticsState()).toBe("pending")

        attempts[0].reject(new Error("/Users/example/private-debug.zip"))
        void first?.then(() => {
          expect(controller.diagnosticsState()).toBe("failed")
          expect(JSON.stringify(controller.diagnostics)).not.toContain("private-debug.zip")

          const retry = controller.exportDiagnostics()
          expect(calls).toBe(2)
          attempts[1].resolve("/Users/example/exported-debug.zip")
          void retry?.then(() => {
            expect(controller.diagnosticsState()).toBe("idle")
            expect(JSON.stringify(controller.diagnostics)).not.toContain("exported-debug.zip")
            dispose()
            done()
          })
        })
      })
    })
  })
})

function sidecar(
  initial: ProductSidecarStatus,
  restart: ProductSidecarHost["restart"] = async () => ready,
): ProductSidecarHost {
  return {
    async getStatus() {
      return initial
    },
    async subscribe() {
      return () => undefined
    },
    restart,
  }
}
