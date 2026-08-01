export const SIDECAR_PROGRESS_GRACE_MS = 1_500

export type ProductSidecarStateName =
  | "unavailable"
  | "unmanaged"
  | "stopped"
  | "starting"
  | "ready"
  | "restarting"
  | "stopping"
  | "failed"

export type ProductSidecarErrorKind = "start" | "health" | "exit"

export type ProductSidecarStatus = {
  readonly state: ProductSidecarStateName
  readonly changedAt: number
  readonly error?: {
    readonly kind: ProductSidecarErrorKind
  }
}

export type ProductSidecarHost = {
  readonly getStatus: () => Promise<ProductSidecarStatus>
  readonly subscribe: (listener: (status: ProductSidecarStatus) => void) => Promise<() => void>
  readonly restart: () => Promise<ProductSidecarStatus>
}

export type SidecarRecoveryState =
  | { readonly kind: "hidden" }
  | { readonly kind: "progress"; readonly phase: "starting" | "restarting" }
  | {
      readonly kind: "failure"
      readonly category: ProductSidecarErrorKind | "stopped" | "unknown"
    }

export function sidecarRecoveryState(
  status: ProductSidecarStatus | undefined,
  now: number,
  grace = SIDECAR_PROGRESS_GRACE_MS,
): SidecarRecoveryState {
  if (!status) return { kind: "hidden" }
  if (status.state === "failed") return { kind: "failure", category: status.error?.kind ?? "unknown" }
  if (status.state === "stopped") return { kind: "failure", category: status.error?.kind ?? "stopped" }
  if (status.state !== "starting" && status.state !== "restarting") return { kind: "hidden" }
  if (Math.max(0, now - status.changedAt) < grace) return { kind: "hidden" }
  return { kind: "progress", phase: status.state }
}
