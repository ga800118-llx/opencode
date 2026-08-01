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

    await settle()
    expect(gets).toBe(0)
    expect(subscribes).toBe(1)
    disposeRoot()
    subscription.resolve(() => unsubscribes++)
    await settle()
    expect(gets).toBe(1)
    initial.resolve(failed)
    await settle()
    expect(unsubscribes).toBe(1)

    listener?.(failed)
    expect(controller.state()).toEqual({ kind: "hidden" })
  })

  test("keeps an equal-timestamp subscription event over an in-flight snapshot", async () => {
    const snapshot = deferred<ProductSidecarStatus>()
    let listener: ((status: ProductSidecarStatus) => void) | undefined
    const calls: string[] = []

    await new Promise<void>((done) => {
      createRoot((dispose) => {
        const controller = createSidecarRecoveryController({
          now: () => 20_000,
          sidecar: {
            async subscribe(next) {
              calls.push("subscribe")
              listener = next
              return () => undefined
            },
            getStatus() {
              calls.push("get")
              return snapshot.promise
            },
            async restart() {
              return ready
            },
          },
        })

        void settle().then(async () => {
          expect(calls).toEqual(["subscribe", "get"])
          listener?.({ state: "failed", changedAt: 50, error: { kind: "health" } })
          snapshot.resolve({ state: "ready", changedAt: 50 })
          await settle()
          expect(controller.state()).toEqual({ kind: "failure", category: "health" })
          dispose()
          done()
        })
      })
    })
  })

  test("does not let a late snapshot regress a newer subscription event", async () => {
    const snapshot = deferred<ProductSidecarStatus>()
    let listener: ((status: ProductSidecarStatus) => void) | undefined

    await new Promise<void>((done) => {
      createRoot((dispose) => {
        const controller = createSidecarRecoveryController({
          now: () => 20_000,
          sidecar: {
            async subscribe(next) {
              listener = next
              return () => undefined
            },
            getStatus() {
              return snapshot.promise
            },
            async restart() {
              return ready
            },
          },
        })

        void settle().then(async () => {
          listener?.({ state: "failed", changedAt: 100, error: { kind: "exit" } })
          snapshot.resolve({ state: "ready", changedAt: 200 })
          await settle()
          expect(controller.state()).toEqual({ kind: "failure", category: "exit" })
          dispose()
          done()
        })
      })
    })
  })

  test("allows a subscription event to replace an equal-timestamp snapshot", async () => {
    let listener: ((status: ProductSidecarStatus) => void) | undefined

    await new Promise<void>((done) => {
      createRoot((dispose) => {
        const controller = createSidecarRecoveryController({
          now: () => 20_000,
          sidecar: {
            async subscribe(next) {
              listener = next
              return () => undefined
            },
            async getStatus() {
              return { state: "failed", changedAt: 50, error: { kind: "start" } }
            },
            async restart() {
              return ready
            },
          },
        })

        void settle().then(() => {
          expect(controller.state()).toEqual({ kind: "failure", category: "start" })
          listener?.({ state: "failed", changedAt: 50, error: { kind: "health" } })
          expect(controller.state()).toEqual({ kind: "failure", category: "health" })
          dispose()
          done()
        })
      })
    })
  })

  test("handles synchronous subscription and snapshot throws without escaping", async () => {
    let subscribes = 0
    let gets = 0

    await new Promise<void>((done) => {
      createRoot((dispose) => {
        const controller = createSidecarRecoveryController({
          sidecar: {
            subscribe() {
              subscribes++
              throw new Error("subscribe sync throw")
            },
            getStatus() {
              gets++
              throw new Error("snapshot sync throw")
            },
            async restart() {
              return ready
            },
          },
        })

        void settle().then(() => {
          expect(subscribes).toBe(1)
          expect(gets).toBe(1)
          expect(controller.state()).toEqual({ kind: "hidden" })
          dispose()
          done()
        })
      })
    })
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
          await settle()
          expect(calls).toBe(1)
          expect(controller.restartState()).toBe("pending")

          attempts[0].reject(new Error("raw /tmp/private.log"))
          await first
          expect(controller.restartState()).toBe("failed")
          expect(JSON.stringify(controller.state())).not.toContain("private.log")

          const retry = controller.restart()
          await settle()
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
        void settle().then(async () => {
          expect(calls).toBe(1)
          expect(controller.diagnosticsState()).toBe("pending")

          attempts[0].reject(new Error("/Users/example/private-debug.zip"))
          await first
          expect(controller.diagnosticsState()).toBe("failed")
          expect(JSON.stringify(controller.diagnostics)).not.toContain("private-debug.zip")

          const retry = controller.exportDiagnostics()
          await settle()
          expect(calls).toBe(2)
          attempts[1].resolve("/Users/example/exported-debug.zip")
          await retry
          expect(controller.diagnosticsState()).toBe("idle")
          expect(JSON.stringify(controller.diagnostics)).not.toContain("exported-debug.zip")
          dispose()
          done()
        })
      })
    })
  })

  test("turns synchronous restart throws into serialized failed promises and retries", async () => {
    let calls = 0
    let shouldThrow = true

    await new Promise<void>((done) => {
      createRoot((dispose) => {
        const controller = createSidecarRecoveryController({
          sidecar: sidecar(failed, () => {
            calls++
            if (shouldThrow) throw new Error("restart sync throw /private/path")
            return Promise.resolve(ready)
          }),
        })

        void settle().then(async () => {
          const first = controller.restart()
          const duplicate = controller.restart()
          expect(first).toBeInstanceOf(Promise)
          expect(duplicate).toBe(first)
          await first
          expect(calls).toBe(1)
          expect(controller.restartState()).toBe("failed")

          shouldThrow = false
          const retry = controller.restart()
          expect(retry).toBeInstanceOf(Promise)
          await retry
          expect(calls).toBe(2)
          expect(controller.restartState()).toBe("idle")
          expect(controller.state()).toEqual({ kind: "hidden" })
          dispose()
          done()
        })
      })
    })
  })

  test("turns synchronous export throws into serialized failed promises and retries", async () => {
    let calls = 0
    let shouldThrow = true

    await new Promise<void>((done) => {
      createRoot((dispose) => {
        const controller = createSidecarRecoveryController({
          exportDebugLogs() {
            calls++
            if (shouldThrow) throw new Error("export sync throw /private/path")
            return Promise.resolve("/private/export.zip")
          },
        })

        const first = controller.exportDiagnostics()
        const duplicate = controller.exportDiagnostics()
        expect(first).toBeInstanceOf(Promise)
        expect(duplicate).toBe(first)
        void first?.then(async () => {
          expect(calls).toBe(1)
          expect(controller.diagnosticsState()).toBe("failed")

          shouldThrow = false
          const retry = controller.exportDiagnostics()
          expect(retry).toBeInstanceOf(Promise)
          await retry
          expect(calls).toBe(2)
          expect(controller.diagnosticsState()).toBe("idle")
          dispose()
          done()
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
