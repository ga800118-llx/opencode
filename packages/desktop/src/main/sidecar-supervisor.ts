import type { HealthCheck, SidecarListener } from "./server"

export type SidecarSupervisorStatus =
  | "stopped"
  | "starting"
  | "ready"
  | "restarting"
  | "stopping"
  | "failed"

export type SidecarSupervisorError = {
  readonly kind: "start" | "health" | "readiness" | "exit"
  readonly message: string
  readonly exitCode?: number
}

export type SidecarSupervisorState = {
  readonly status: SidecarSupervisorStatus
  readonly attempt: number
  readonly changedAt: number
  readonly startedAt?: number
  readonly readyAt?: number
  readonly stoppedAt?: number
  readonly nextRetryAt?: number
  readonly error?: SidecarSupervisorError
}

export type SidecarInstance = {
  readonly listener: SidecarListener
  readonly health: HealthCheck
  readonly readiness: HealthCheck
}

export type SidecarSupervisorLogger = {
  readonly log: (message: string, meta?: Record<string, unknown>) => void
  readonly warn: (message: string, meta?: Record<string, unknown>) => void
}

export type SidecarSupervisorOptions = {
  readonly spawn: () => Promise<SidecarInstance>
  readonly delay?: (milliseconds: number) => Promise<void>
  readonly now?: () => number
  readonly logger?: SidecarSupervisorLogger
  readonly initialRestartDelayMs?: number
  readonly maximumRestartDelayMs?: number
  readonly maximumRestartAttempts?: number
}

export type SidecarSupervisor = {
  readonly start: () => Promise<void>
  readonly restart: () => Promise<void>
  readonly stop: () => Promise<void>
  readonly getState: () => SidecarSupervisorState
  readonly subscribe: (listener: (state: SidecarSupervisorState) => void) => () => void
}

const DEFAULT_INITIAL_RESTART_DELAY_MS = 250
const DEFAULT_MAXIMUM_RESTART_DELAY_MS = 4_000
const DEFAULT_MAXIMUM_RESTART_ATTEMPTS = 4

export function createSidecarSupervisor(options: SidecarSupervisorOptions): SidecarSupervisor {
  const now = options.now ?? Date.now
  const delay = options.delay ?? ((milliseconds) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)))
  const initialRestartDelayMs = nonNegative(options.initialRestartDelayMs, DEFAULT_INITIAL_RESTART_DELAY_MS)
  const maximumRestartDelayMs = Math.max(
    initialRestartDelayMs,
    nonNegative(options.maximumRestartDelayMs, DEFAULT_MAXIMUM_RESTART_DELAY_MS),
  )
  const maximumRestartAttempts = Math.floor(
    nonNegative(options.maximumRestartAttempts, DEFAULT_MAXIMUM_RESTART_ATTEMPTS),
  )
  const subscribers = new Set<(state: SidecarSupervisorState) => void>()
  const delayInterrupts = new Set<() => void>()
  const runs = new Set<Promise<void>>()

  const initialTime = now()
  let state: SidecarSupervisorState = Object.freeze({
    status: "stopped",
    attempt: 0,
    changedAt: initialTime,
    stoppedAt: initialTime,
  })
  let desired = false
  let generation = 0
  let active: { generation: number; listener: SidecarListener } | undefined
  let startPromise: Promise<void> | undefined
  let restartPromise: Promise<void> | undefined
  let stopPromise: Promise<void> | undefined

  const publish = (next: SidecarSupervisorState) => {
    state = Object.freeze(next)
    for (const subscriber of subscribers) {
      try {
        subscriber(state)
      } catch {
        options.logger?.warn("sidecar state subscriber failed")
      }
    }
  }

  const transition = (
    status: SidecarSupervisorStatus,
    attempt: number,
    fields: Omit<SidecarSupervisorState, "status" | "attempt" | "changedAt"> = {},
  ) => publish({ status, attempt, changedAt: now(), ...fields })

  const interruptDelays = () => {
    for (const interrupt of delayInterrupts) interrupt()
    delayInterrupts.clear()
  }

  const wait = async (milliseconds: number, expectedGeneration: number) => {
    let interrupt!: () => void
    const interrupted = new Promise<void>((resolve) => {
      interrupt = resolve
    })
    delayInterrupts.add(interrupt)
    try {
      await Promise.race([delay(milliseconds), interrupted])
    } finally {
      delayInterrupts.delete(interrupt)
    }
    return desired && generation === expectedGeneration
  }

  const restartDelay = (attempt: number) =>
    Math.min(maximumRestartDelayMs, initialRestartDelayMs * 2 ** Math.max(0, attempt - 1))

  const safeError = (kind: SidecarSupervisorError["kind"], exitCode?: number): SidecarSupervisorError =>
    Object.freeze({
      kind,
      message:
        kind === "exit"
          ? "The local agent server stopped unexpectedly."
          : kind === "health"
            ? "The local agent server did not become healthy."
            : kind === "readiness"
              ? "The local agent server did not finish initializing."
            : "The local agent server could not be started.",
      ...(exitCode === undefined ? {} : { exitCode }),
    })

  const stopListener = async (listener: SidecarListener) => {
    await listener.stop().catch(() => {
      options.logger?.warn("sidecar stop failed")
    })
  }

  const track = (promise: Promise<void>) => {
    runs.add(promise)
    void promise.finally(() => runs.delete(promise)).catch(() => undefined)
    return promise
  }

  const run = async (
    expectedGeneration: number,
    initialAttempt: number,
    startedAt: number,
    initialError?: SidecarSupervisorError,
  ) => {
    let attempt = initialAttempt
    let error = initialError

    if (error) {
      const milliseconds = restartDelay(attempt)
      transition("restarting", attempt, { startedAt, nextRetryAt: now() + milliseconds, error })
      if (!(await wait(milliseconds, expectedGeneration))) return
    }

    while (true) {
      if (!desired || generation !== expectedGeneration) return
      transition(attempt === 0 ? "starting" : "restarting", attempt, { startedAt, ...(error ? { error } : {}) })
      let instance: SidecarInstance | undefined
      let stage: SidecarSupervisorError["kind"] = "start"
      try {
        instance = await options.spawn()
        if (!desired || generation !== expectedGeneration) {
          await stopListener(instance.listener)
          return
        }

        active = { generation: expectedGeneration, listener: instance.listener }
        stage = "health"
        await instance.health.wait
        stage = "readiness"
        await instance.readiness.wait
        if (!desired || generation !== expectedGeneration || active?.listener !== instance.listener) {
          await stopListener(instance.listener)
          return
        }

        const readyAt = now()
        transition("ready", attempt, { startedAt, readyAt })
        monitor(instance.listener, expectedGeneration)
        return
      } catch {
        if (instance) await stopListener(instance.listener)
        if (active?.generation === expectedGeneration) active = undefined
        if (!desired || generation !== expectedGeneration) return

        error = safeError(stage)
        options.logger?.warn("sidecar start attempt failed", { attempt, kind: error.kind })
        if (attempt >= maximumRestartAttempts) {
          transition("failed", attempt, { startedAt, error })
          throw new Error(error.message)
        }

        attempt += 1
        const milliseconds = restartDelay(attempt)
        transition("restarting", attempt, { startedAt, nextRetryAt: now() + milliseconds, error })
        if (!(await wait(milliseconds, expectedGeneration))) return
      }
    }
  }

  const monitor = (listener: SidecarListener, expectedGeneration: number) => {
    void listener.exit.then((exitCode) => {
      if (!desired || generation !== expectedGeneration || active?.listener !== listener) return
      active = undefined
      const nextGeneration = ++generation
      const error = safeError("exit", exitCode)
      options.logger?.warn("sidecar exited unexpectedly", { exitCode })
      const promise = track(run(nextGeneration, 1, now(), error))
      void promise.catch((failure) => {
        options.logger?.warn("sidecar restart attempts exhausted", {
          message: failure instanceof Error ? failure.message : "Sidecar restart failed.",
        })
      })
    })
  }

  const start = (): Promise<void> => {
    if (stopPromise) return stopPromise.then(start)
    if (restartPromise) return restartPromise
    if (desired && state.status === "ready") return Promise.resolve()
    if (startPromise) return startPromise

    desired = true
    const expectedGeneration = ++generation
    const promise = track(run(expectedGeneration, 0, now()))
    startPromise = promise
    void promise.finally(() => {
      if (startPromise === promise) startPromise = undefined
    }).catch(() => undefined)
    return promise
  }

  const restart = (): Promise<void> => {
    if (stopPromise) return stopPromise.then(restart)
    if (restartPromise) return restartPromise

    desired = true
    const expectedGeneration = ++generation
    interruptDelays()
    const previous = active
    active = undefined
    const promise = track(
      (async () => {
        if (previous) await stopListener(previous.listener)
        if (!desired || generation !== expectedGeneration) return
        await run(expectedGeneration, 0, now())
      })(),
    )
    restartPromise = promise
    void promise.finally(() => {
      if (restartPromise === promise) restartPromise = undefined
    }).catch(() => undefined)
    return promise
  }

  const stop = () => {
    if (stopPromise) return stopPromise

    desired = false
    generation += 1
    interruptDelays()
    const previous = active
    active = undefined
    transition("stopping", state.attempt, state.startedAt === undefined ? {} : { startedAt: state.startedAt })

    const promise = (async () => {
      if (previous) await stopListener(previous.listener)
      while (runs.size > 0) await Promise.allSettled(runs)
      const stoppedAt = now()
      transition("stopped", 0, { stoppedAt })
    })()
    stopPromise = promise
    void promise.finally(() => {
      if (stopPromise === promise) stopPromise = undefined
    }).catch(() => undefined)
    return promise
  }

  return {
    start,
    restart,
    stop,
    getState: () => state,
    subscribe(listener) {
      subscribers.add(listener)
      listener(state)
      return () => subscribers.delete(listener)
    },
  }
}

function nonNegative(value: number | undefined, fallback: number) {
  return value !== undefined && Number.isFinite(value) && value >= 0 ? value : fallback
}
