import { describe, expect, test } from "bun:test"
import { createSidecarSupervisor, type SidecarInstance, type SidecarSupervisorState } from "./sidecar-supervisor"

describe("createSidecarSupervisor", () => {
  test("publishes starting and ready for one healthy process", async () => {
    const child = sidecar({ healthy: true })
    const states: SidecarSupervisorState[] = []
    const supervisor = createSidecarSupervisor({ spawn: async () => child.instance, now: clock() })
    const unsubscribe = supervisor.subscribe((state) => states.push(state))

    await supervisor.start()
    unsubscribe()

    expect(states.map((state) => state.status)).toEqual(["stopped", "starting", "ready"])
    expect(supervisor.getState()).toMatchObject({ status: "ready", attempt: 0 })
    expect(child.stops()).toBe(0)
  })

  test("restarts after unexpected exit with bounded exponential delay", async () => {
    const first = sidecar({ healthy: true })
    const second = sidecar({ healthy: true })
    const gates: Array<ReturnType<typeof deferred<void>>> = []
    const delays: number[] = []
    let spawns = 0
    const supervisor = createSidecarSupervisor({
      spawn: async () => (++spawns === 1 ? first.instance : second.instance),
      delay: (milliseconds) => {
        delays.push(milliseconds)
        const gate = deferred<void>()
        gates.push(gate)
        return gate.promise
      },
      initialRestartDelayMs: 100,
      maximumRestartDelayMs: 400,
      now: clock(),
    })

    await supervisor.start()
    first.exit.resolve(9)
    await eventually(() => supervisor.getState().status === "restarting")

    expect(supervisor.getState()).toMatchObject({ status: "restarting", attempt: 1 })
    expect(delays).toEqual([100])
    gates[0]?.resolve()
    await eventually(() => supervisor.getState().status === "ready" && spawns === 2)
    expect(second.stops()).toBe(0)
  })

  test("stops retrying after the configured maximum", async () => {
    const first = sidecar({ healthy: true })
    const delays: number[] = []
    let spawns = 0
    const supervisor = createSidecarSupervisor({
      spawn: async () => {
        spawns += 1
        if (spawns === 1) return first.instance
        throw new Error("spawn failed")
      },
      delay: async (milliseconds) => {
        delays.push(milliseconds)
      },
      initialRestartDelayMs: 100,
      maximumRestartDelayMs: 400,
      maximumRestartAttempts: 3,
      now: clock(),
    })

    await supervisor.start()
    first.exit.resolve(17)
    await eventually(() => supervisor.getState().status === "failed")

    expect(spawns).toBe(4)
    expect(delays).toEqual([100, 200, 400])
    expect(supervisor.getState()).toMatchObject({
      status: "failed",
      attempt: 3,
      error: { kind: "start", message: "The local agent server could not be started." },
    })
  })

  test("rejects initial startup after bounded retries", async () => {
    const delays: number[] = []
    let spawns = 0
    const supervisor = createSidecarSupervisor({
      spawn: async () => {
        spawns += 1
        throw new Error("spawn failed")
      },
      delay: async (milliseconds) => {
        delays.push(milliseconds)
      },
      initialRestartDelayMs: 50,
      maximumRestartAttempts: 2,
      now: clock(),
    })

    const failure = await captureFailure(supervisor.start())

    expect(failure?.message).toBe("The local agent server could not be started.")
    expect(spawns).toBe(3)
    expect(delays).toEqual([50, 100])
    expect(supervisor.getState()).toMatchObject({ status: "failed", attempt: 2 })
  })

  test("retries a failed health check", async () => {
    const unhealthy = sidecar({ healthy: false })
    const healthy = sidecar({ healthy: true })
    let spawns = 0
    const supervisor = createSidecarSupervisor({
      spawn: async () => (++spawns === 1 ? unhealthy.instance : healthy.instance),
      delay: async () => undefined,
      now: clock(),
    })

    await supervisor.start()

    expect(spawns).toBe(2)
    expect(unhealthy.stops()).toBe(1)
    expect(supervisor.getState()).toMatchObject({ status: "ready", attempt: 1 })
  })

  test("manually restarts immediately and stops the prior process", async () => {
    const first = sidecar({ healthy: true })
    const second = sidecar({ healthy: true })
    const delays: number[] = []
    let spawns = 0
    const supervisor = createSidecarSupervisor({
      spawn: async () => (++spawns === 1 ? first.instance : second.instance),
      delay: async (milliseconds) => {
        delays.push(milliseconds)
      },
      now: clock(),
    })

    await supervisor.start()
    await supervisor.restart()

    expect(first.stops()).toBe(1)
    expect(spawns).toBe(2)
    expect(delays).toEqual([])
    expect(supervisor.getState()).toMatchObject({ status: "ready", attempt: 0 })
  })

  test("reuses caller-allocated connection values across automatic restart", async () => {
    const first = sidecar({ healthy: true })
    const second = sidecar({ healthy: true })
    const connection = Object.freeze({
      hostname: "127.0.0.1",
      port: 41_337,
      username: "opencode",
      password: "stable-password",
    })
    const seen: typeof connection[] = []
    let spawns = 0
    const launch = async (input: typeof connection) => {
      seen.push(input)
      return ++spawns === 1 ? first.instance : second.instance
    }
    const supervisor = createSidecarSupervisor({
      spawn: () => launch(connection),
      delay: async () => undefined,
      now: clock(),
    })

    await supervisor.start()
    first.exit.resolve(1)
    await eventually(() => supervisor.getState().status === "ready" && spawns === 2)

    expect(seen).toEqual([connection, connection])
    expect(seen[0]).toBe(connection)
    expect(seen[1]).toBe(connection)
    expect(JSON.stringify(supervisor.getState())).not.toContain("stable-password")
  })

  test("deduplicates concurrent lifecycle calls", async () => {
    const first = sidecar({ healthy: true })
    const second = sidecar({ healthy: true })
    let spawns = 0
    const supervisor = createSidecarSupervisor({
      spawn: async () => (++spawns === 1 ? first.instance : second.instance),
      now: clock(),
    })

    const starting = supervisor.start()
    expect(supervisor.start()).toBe(starting)
    await starting

    const restarting = supervisor.restart()
    expect(supervisor.restart()).toBe(restarting)
    await restarting

    const stopping = supervisor.stop()
    expect(supervisor.stop()).toBe(stopping)
    await stopping
    expect(spawns).toBe(2)
  })

  test("gracefully stops without restarting after app quit", async () => {
    const child = sidecar({ healthy: true })
    let spawns = 0
    const supervisor = createSidecarSupervisor({
      spawn: async () => {
        spawns += 1
        return child.instance
      },
      delay: async () => undefined,
      now: clock(),
    })

    await supervisor.start()
    await supervisor.stop()
    child.exit.resolve(0)
    await flush()

    expect(child.stops()).toBe(1)
    expect(spawns).toBe(1)
    expect(supervisor.getState()).toMatchObject({ status: "stopped", attempt: 0 })
  })

  test("interrupts restart backoff during shutdown", async () => {
    const child = sidecar({ healthy: true })
    let spawns = 0
    const supervisor = createSidecarSupervisor({
      spawn: async () => {
        spawns += 1
        return child.instance
      },
      delay: () => new Promise<void>(() => undefined),
      initialRestartDelayMs: 10_000,
      now: clock(),
    })

    await supervisor.start()
    child.exit.resolve(1)
    await eventually(() => supervisor.getState().status === "restarting")
    await supervisor.stop()

    expect(spawns).toBe(1)
    expect(supervisor.getState().status).toBe("stopped")
  })

  test("never publishes raw startup errors or credentials", async () => {
    const supervisor = createSidecarSupervisor({
      spawn: async () => {
        throw new Error("Authorization: Bearer raw-secret https://user:password@example.test?api_key=raw-secret")
      },
      maximumRestartAttempts: 0,
      now: clock(),
    })

    await captureFailure(supervisor.start())
    const serialized = JSON.stringify(supervisor.getState())

    expect(serialized).not.toContain("raw-secret")
    expect(serialized).not.toContain("password")
    expect(serialized).not.toContain("Authorization")
    expect(supervisor.getState()).toMatchObject({
      status: "failed",
      error: { kind: "start", message: "The local agent server could not be started." },
    })
  })

  test("unsubscribes state listeners", async () => {
    const child = sidecar({ healthy: true })
    const states: string[] = []
    const supervisor = createSidecarSupervisor({ spawn: async () => child.instance, now: clock() })
    const unsubscribe = supervisor.subscribe((state) => states.push(state.status))
    unsubscribe()

    await supervisor.start()

    expect(states).toEqual(["stopped"])
  })
})

function sidecar(options: { healthy: boolean }) {
  const exit = deferred<number>()
  let stopCount = 0
  const instance: SidecarInstance = {
    listener: {
      exit: exit.promise,
      async stop() {
        stopCount += 1
        exit.resolve(0)
      },
    },
    health: {
      wait: options.healthy ? Promise.resolve() : Promise.reject(new Error("unhealthy")),
    },
  }
  return { instance, exit, stops: () => stopCount }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, resolve, reject }
}

function clock() {
  let value = 1_725_000_000_000
  return () => value++
}

async function captureFailure(promise: Promise<void>) {
  try {
    await promise
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error))
  }
  return undefined
}

async function eventually(predicate: () => boolean) {
  for (let index = 0; index < 100; index += 1) {
    if (predicate()) return
    await flush()
  }
  throw new Error("Condition was not reached")
}

async function flush() {
  await Promise.resolve()
  await Promise.resolve()
}
