import { createSignal, onCleanup } from "solid-js"
import { usePlatform } from "@/context/platform"
import { useProductRuntime } from "@/product/context"
import {
  SIDECAR_PROGRESS_GRACE_MS,
  sidecarRecoveryState,
  type ProductSidecarHost,
  type ProductSidecarStatus,
} from "./sidecar-status"

export type SidecarRecoveryActionState = "idle" | "pending" | "failed"

export type SidecarRecoveryControllerInput = {
  readonly sidecar?: ProductSidecarHost
  readonly exportDebugLogs?: () => Promise<string>
  readonly now?: () => number
  readonly setTimer?: (callback: () => void, delay: number) => number
  readonly clearTimer?: (timer: number) => void
}

export function createSidecarRecoveryController(input: SidecarRecoveryControllerInput) {
  const now = input.now ?? Date.now
  const setTimer = input.setTimer ?? ((callback, delay) => window.setTimeout(callback, delay))
  const clearTimer = input.clearTimer ?? window.clearTimeout
  const [status, setStatus] = createSignal<ProductSidecarStatus>()
  const [clock, setClock] = createSignal(now())
  const [restartState, setRestartState] = createSignal<SidecarRecoveryActionState>("idle")
  const [diagnosticsState, setDiagnosticsState] = createSignal<SidecarRecoveryActionState>("idle")
  let disposed = false
  let unsubscribe: (() => void) | undefined
  let graceTimer: number | undefined
  let restartPromise: Promise<void> | undefined
  let diagnosticsPromise: Promise<void> | undefined
  let eventRevision = 0

  const clearGraceTimer = () => {
    if (graceTimer === undefined) return
    clearTimer(graceTimer)
    graceTimer = undefined
  }

  const updateStatus = (next: ProductSidecarStatus) => {
    if (disposed) return
    const current = status()
    if (current && next.changedAt < current.changedAt) return
    clearGraceTimer()
    setStatus(next)
    setClock(now())
    if (next.state !== "starting" && next.state !== "restarting") return
    const remaining = SIDECAR_PROGRESS_GRACE_MS - Math.max(0, now() - next.changedAt)
    if (remaining <= 0) return
    const reveal = () => {
      graceTimer = undefined
      if (disposed) return
      const current = now()
      const delay = SIDECAR_PROGRESS_GRACE_MS - Math.max(0, current - next.changedAt)
      if (delay > 0) {
        graceTimer = setTimer(reveal, delay)
        return
      }
      setClock(current)
    }
    graceTimer = setTimer(reveal, remaining)
  }

  const updateEvent = (next: ProductSidecarStatus) => {
    if (disposed) return
    eventRevision++
    updateStatus(next)
  }

  const updateSnapshot = (next: ProductSidecarStatus, revision: number) => {
    if (disposed || eventRevision !== revision) return
    const current = status()
    if (current && next.changedAt <= current.changedAt) return
    updateStatus(next)
  }

  if (input.sidecar) {
    const sidecar = input.sidecar
    void Promise.resolve()
      .then(() => sidecar.subscribe(updateEvent))
      .then(
        (release) => {
          if (!disposed) {
            unsubscribe = release
            return
          }
          void Promise.resolve()
            .then(() => release())
            .catch(() => undefined)
        },
        () => undefined,
      )
      .then(() => {
        const revision = eventRevision
        return Promise.resolve()
          .then(() => sidecar.getStatus())
          .then((next) => updateSnapshot(next, revision), () => undefined)
      })
  }

  onCleanup(() => {
    disposed = true
    clearGraceTimer()
    unsubscribe?.()
    unsubscribe = undefined
  })

  const restart = () => {
    if (!input.sidecar) return
    if (restartPromise) return restartPromise
    const sidecar = input.sidecar
    setRestartState("pending")
    const task = Promise.resolve()
      .then(() => sidecar.restart())
      .then(
        (next) => {
          if (disposed) return
          updateEvent(next)
          setRestartState("idle")
        },
        () => {
          if (!disposed) setRestartState("failed")
        },
      )
    restartPromise = task.finally(() => {
      restartPromise = undefined
    })
    return restartPromise
  }

  const exportDiagnostics = () => {
    if (!input.exportDebugLogs) return
    if (diagnosticsPromise) return diagnosticsPromise
    const exportDebugLogs = input.exportDebugLogs
    setDiagnosticsState("pending")
    const task = Promise.resolve()
      .then(() => exportDebugLogs())
      .then(
        () => {
          if (!disposed) setDiagnosticsState("idle")
        },
        () => {
          if (!disposed) setDiagnosticsState("failed")
        },
      )
    diagnosticsPromise = task.finally(() => {
      diagnosticsPromise = undefined
    })
    return diagnosticsPromise
  }

  return {
    state: () => sidecarRecoveryState(status(), clock()),
    restartState,
    restart,
    diagnostics: Object.freeze({ available: !!input.exportDebugLogs }),
    diagnosticsState,
    exportDiagnostics,
  }
}

export function useSidecarRecovery() {
  const runtime = useProductRuntime()
  const platform = usePlatform()
  return createSidecarRecoveryController({
    sidecar: "sidecar" in runtime.host ? runtime.host.sidecar : undefined,
    exportDebugLogs: platform.exportDebugLogs ? () => platform.exportDebugLogs!() : undefined,
  })
}
