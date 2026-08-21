import type { SessionTab } from "./tabs"
import { isLocalSessionNotFoundError, isSessionNotFoundError } from "@/utils/server-errors"

export type SessionTabProbeResult = "present" | "missing" | "unavailable"

export function probeSessionTab(
  sessionID: string,
  resolve: (signal: AbortSignal) => Promise<unknown>,
  signal = new AbortController().signal,
): Promise<SessionTabProbeResult> {
  return Promise.resolve()
    .then(() => resolve(signal))
    .then(
      () => "present",
      (error): SessionTabProbeResult =>
        isSessionNotFoundError(error, sessionID) || isLocalSessionNotFoundError(error, sessionID)
          ? "missing"
          : "unavailable",
    )
}

export function createSessionTabReconciler(input: {
  probe: (tab: SessionTab, signal: AbortSignal) => Promise<SessionTabProbeResult>
  remove: (server: SessionTab["server"], sessionIDs: string[]) => void | Promise<void>
  concurrency?: number
  maxUnavailableAttempts?: number
  retryCycleDelayMs?: number
  retryDelayMs?: number
  timeoutMs?: number
}) {
  const concurrency = Math.max(1, Math.floor(input.concurrency ?? 4))
  const maxUnavailableAttempts = Math.max(1, Math.floor(input.maxUnavailableAttempts ?? 3))
  const retryCycleDelayMs = Math.max(1, input.retryCycleDelayMs ?? 60_000)
  const retryDelayMs = Math.max(1, input.retryDelayMs ?? 2_000)
  const timeoutMs = Math.max(1, input.timeoutMs ?? 10_000)
  const settled = new Map<string, Exclude<SessionTabProbeResult, "unavailable">>()
  const unavailableAttempts = new Map<string, number>()
  const pending = new Map<string, Promise<SessionTabProbeResult>>()
  const controllers = new Map<string, AbortController>()
  const removed = new Set<string>()
  let disposed = false
  let active: Promise<{ retryDelay?: number; resetUnavailable?: boolean }> | undefined
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  let retryResetUnavailable = false
  let retrySnapshot: SessionTab[] | undefined
  let retrySnapshotKey: string | undefined
  let queued:
    | {
        snapshot: SessionTab[]
        promise: Promise<void>
        resolve: () => void
        reject: (error: unknown) => void
      }
    | undefined

  function runProbe(tab: SessionTab) {
    if (disposed) return Promise.resolve("unavailable" as const)
    const key = sessionTabKey(tab)
    const result = settled.get(key)
    if (result) return Promise.resolve(result)
    if ((unavailableAttempts.get(key) ?? 0) >= maxUnavailableAttempts) {
      return Promise.resolve("unavailable" as const)
    }

    const existing = pending.get(key)
    if (existing) return existing

    const controller = new AbortController()
    controllers.set(key, controller)
    let resolveUnavailable!: () => void
    const unavailable = new Promise<SessionTabProbeResult>((resolve) => {
      resolveUnavailable = () => resolve("unavailable")
      controller.signal.addEventListener("abort", resolveUnavailable, { once: true })
    })
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    const request = Promise.resolve()
      .then(() => input.probe(tab, controller.signal))
      .catch(() => "unavailable" as const)
    const promise = Promise.race([request, unavailable])
      .then((next) => {
        if (next === "unavailable") {
          unavailableAttempts.set(key, (unavailableAttempts.get(key) ?? 0) + 1)
          return next
        }
        unavailableAttempts.delete(key)
        settled.set(key, next)
        return next
      })
      .finally(() => {
        clearTimeout(timeout)
        controller.signal.removeEventListener("abort", resolveUnavailable)
        pending.delete(key)
        controllers.delete(key)
      })
    pending.set(key, promise)
    return promise
  }

  async function probeTabs(tabs: SessionTab[]) {
    const queue = tabs.map((tab, index) => ({ tab, index }))
    const results: Array<{ tab: SessionTab; result: SessionTabProbeResult } | undefined> = []
    const worker = async (): Promise<void> => {
      const item = queue.shift()
      if (!item) return
      results[item.index] = { tab: item.tab, result: await runProbe(item.tab) }
      await worker()
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, tabs.length) }, worker))
    return results.filter((item): item is NonNullable<typeof item> => item !== undefined)
  }

  async function run(tabs: readonly SessionTab[]) {
    const unique = [...new Map(tabs.map((tab) => [sessionTabKey(tab), tab])).values()]
    const candidates = new Set(unique.map(sessionTabKey))
    settled.forEach((_, key) => {
      if (!candidates.has(key)) settled.delete(key)
    })
    unavailableAttempts.forEach((_, key) => {
      if (!candidates.has(key)) unavailableAttempts.delete(key)
    })
    removed.forEach((key) => {
      if (!candidates.has(key)) removed.delete(key)
    })

    const results = await probeTabs(unique)
    if (disposed) return {}
    const unavailable = results.filter((item) => item.result === "unavailable")
    const resetUnavailable =
      unavailable.length > 0 &&
      unavailable.every((item) => (unavailableAttempts.get(sessionTabKey(item.tab)) ?? 0) >= maxUnavailableAttempts)
    const missing = results.reduce((groups, item) => {
      if (item.result !== "missing" || removed.has(sessionTabKey(item.tab))) return groups

      groups.set(item.tab.server, [...(groups.get(item.tab.server) ?? []), item.tab])
      return groups
    }, new Map<SessionTab["server"], SessionTab[]>())

    await Promise.all(
      [...missing].map(([server, group]) =>
        Promise.resolve()
          .then(() => {
            if (disposed) return
            return input.remove(
              server,
              group.map((tab) => tab.sessionId),
            )
          })
          .then(
            () => {
              if (!disposed) group.forEach((tab) => removed.add(sessionTabKey(tab)))
            },
            () => undefined,
          ),
      ),
    )
    return {
      retryDelay: unavailable.length > 0 ? (resetUnavailable ? retryCycleDelayMs : retryDelayMs) : undefined,
      resetUnavailable,
    }
  }

  function start(snapshot: readonly SessionTab[]) {
    if (disposed) return Promise.resolve()
    const operation = run(snapshot)
    active = operation
    void operation.then(
      (result) => advance(operation, snapshot, result),
      () => advance(operation, snapshot, {}),
    )
    return operation.then(() => undefined)
  }

  function advance(
    operation: Promise<{ retryDelay?: number; resetUnavailable?: boolean }>,
    snapshot: readonly SessionTab[],
    result: { retryDelay?: number; resetUnavailable?: boolean },
  ) {
    if (active !== operation) return
    active = undefined

    const next = queued
    if (next) {
      queued = undefined
      void start(next.snapshot).then(next.resolve, next.reject)
      return
    }
    if (result.retryDelay === undefined || disposed) return
    retrySnapshot = [...snapshot]
    retrySnapshotKey = sessionTabSnapshotKey(snapshot)
    retryResetUnavailable = result.resetUnavailable === true
    retryTimer = setTimeout(() => {
      retryTimer = undefined
      const next = retrySnapshot ?? []
      const resetUnavailable = retryResetUnavailable
      retryResetUnavailable = false
      retrySnapshot = undefined
      retrySnapshotKey = undefined
      if (resetUnavailable) next.forEach((tab) => unavailableAttempts.delete(sessionTabKey(tab)))
      void start(next)
    }, result.retryDelay)
  }

  return {
    reconcile: (tabs: readonly SessionTab[]) => {
      if (disposed) return Promise.resolve()
      const snapshot = [...tabs]
      const snapshotKey = sessionTabSnapshotKey(snapshot)
      const resetUnavailable = retryTimer && retryResetUnavailable && retrySnapshotKey === snapshotKey
      if (retryTimer) clearTimeout(retryTimer)
      retryTimer = undefined
      retryResetUnavailable = false
      retrySnapshot = undefined
      retrySnapshotKey = undefined
      if (resetUnavailable) snapshot.forEach((tab) => unavailableAttempts.delete(sessionTabKey(tab)))
      if (!active) return start(snapshot)
      if (queued) {
        queued.snapshot = snapshot
        return queued.promise
      }

      let resolve!: () => void
      let reject!: (error: unknown) => void
      const promise = new Promise<void>((done, fail) => {
        resolve = () => done()
        reject = (error) => fail(error)
      })
      queued = { snapshot, promise, resolve, reject }
      return promise
    },
    dispose: () => {
      disposed = true
      if (retryTimer) clearTimeout(retryTimer)
      retryTimer = undefined
      retryResetUnavailable = false
      retrySnapshot = undefined
      retrySnapshotKey = undefined
      controllers.forEach((controller) => controller.abort())
      controllers.clear()
      settled.clear()
      unavailableAttempts.clear()
      removed.clear()
      const next = queued
      queued = undefined
      next?.resolve()
    },
  }
}

function sessionTabKey(tab: SessionTab) {
  return JSON.stringify([tab.server, tab.sessionId])
}

function sessionTabSnapshotKey(tabs: readonly SessionTab[]) {
  return JSON.stringify([...new Set(tabs.map(sessionTabKey))].sort())
}
