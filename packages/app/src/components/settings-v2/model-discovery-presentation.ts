import type { ProductErrorKind } from "@/product/contracts"
import type { ModelDiscoveryFeedback } from "./model-center-controller"

export type ModelDiscoveryCopyKey =
  | "settings.modelCenter.discovery.progress"
  | "settings.modelCenter.discovery.success"
  | "settings.modelCenter.discovery.empty"
  | "settings.modelCenter.discovery.invalidEndpoint"
  | "settings.modelCenter.discovery.unreachableEndpoint"
  | "settings.modelCenter.discovery.authentication"
  | "settings.modelCenter.discovery.incompatible"
  | "settings.modelCenter.discovery.timeout"
  | "settings.modelCenter.discovery.tls"
  | "settings.modelCenter.discovery.missingModel"
  | "settings.modelCenter.discovery.aborted"
  | "settings.modelCenter.discovery.unexpected"

export type ModelDiscoveryPresentation = {
  readonly key: ModelDiscoveryCopyKey
  readonly params?: Readonly<{ count: number }>
  readonly live: "polite" | "assertive"
  readonly tone: "progress" | "success" | "error"
}

const DIAGNOSTIC_KEYS = {
  "unreachable-endpoint": "settings.modelCenter.discovery.unreachableEndpoint",
  authentication: "settings.modelCenter.discovery.authentication",
  "incompatible-api": "settings.modelCenter.discovery.incompatible",
  "missing-model": "settings.modelCenter.discovery.missingModel",
  streaming: "settings.modelCenter.discovery.unexpected",
  "tool-calling": "settings.modelCenter.discovery.unexpected",
  timeout: "settings.modelCenter.discovery.timeout",
  tls: "settings.modelCenter.discovery.tls",
  "server-crash": "settings.modelCenter.discovery.unexpected",
  "model-runtime-unreconciled": "settings.modelCenter.discovery.unexpected",
  aborted: "settings.modelCenter.discovery.aborted",
  unknown: "settings.modelCenter.discovery.unexpected",
} satisfies Record<ProductErrorKind, ModelDiscoveryCopyKey>

export function modelDiscoveryPresentation(
  discovering: boolean,
  feedback: ModelDiscoveryFeedback | undefined,
): ModelDiscoveryPresentation | undefined {
  if (discovering) {
    return { key: "settings.modelCenter.discovery.progress", live: "polite", tone: "progress" }
  }
  if (!feedback) return
  if (feedback.type === "success") {
    if (feedback.count === 0) {
      return { key: "settings.modelCenter.discovery.empty", live: "polite", tone: "success" }
    }
    return {
      key: "settings.modelCenter.discovery.success",
      params: { count: feedback.count },
      live: "polite",
      tone: "success",
    }
  }
  if (feedback.type === "invalid-endpoint") {
    return { key: "settings.modelCenter.discovery.invalidEndpoint", live: "assertive", tone: "error" }
  }
  if (feedback.type === "diagnostic") {
    return { key: DIAGNOSTIC_KEYS[feedback.diagnostic.kind], live: "assertive", tone: "error" }
  }
  return { key: "settings.modelCenter.discovery.unexpected", live: "assertive", tone: "error" }
}

export function createModelDiscoveryCoordinator(options: {
  readonly discovering: () => boolean
  readonly hasFeedback: () => boolean
  readonly schedule: (callback: () => void) => void
  readonly scroll: () => void
}) {
  let generation = 0
  return async (discover: () => Promise<unknown>) => {
    const current = ++generation
    const pending = discover()
    options.schedule(() => {
      if (current !== generation || !options.discovering()) return
      options.scroll()
    })

    await pending.catch(() => undefined)
    if (current !== generation || !options.hasFeedback()) return
    options.schedule(() => {
      if (current !== generation || !options.hasFeedback()) return
      options.scroll()
    })
  }
}
