import type { ProductModelCenterAPI } from "@opencode-ai/app/product/model-center"

export const PRODUCT_HOST_CHANNELS = Object.freeze({
  sidecarGetStatus: "product-sidecar-get-status",
  sidecarSubscribe: "product-sidecar-subscribe",
  sidecarUnsubscribe: "product-sidecar-unsubscribe",
  sidecarState: "product-sidecar-state",
  sidecarRestart: "product-sidecar-restart",
  credentialGetCapabilities: "product-credential-get-capabilities",
} as const)

export type ProductSidecarStateName =
  | "unavailable"
  | "unmanaged"
  | "stopped"
  | "starting"
  | "ready"
  | "restarting"
  | "stopping"
  | "failed"

export type ProductSidecarError = {
  readonly kind: "start" | "health" | "exit"
  readonly message: string
  readonly exitCode?: number
}

export type ProductSidecarStatus = {
  readonly state: ProductSidecarStateName
  readonly attempt: number
  readonly changedAt: number
  readonly startedAt?: number
  readonly readyAt?: number
  readonly stoppedAt?: number
  readonly nextRetryAt?: number
  readonly error?: ProductSidecarError
}

export type ProductCredentialBackend = "macos-keychain" | "windows-credential-manager" | "unsupported"

export type ProductCredentialCapabilities = {
  readonly namespace: string
  readonly backend: ProductCredentialBackend
  readonly available: boolean
  readonly operations: {
    readonly read: boolean
    readonly write: boolean
    readonly delete: boolean
  }
}

export type DesktopProductHostAPI = {
  readonly sidecar: {
    readonly getStatus: () => Promise<ProductSidecarStatus>
    readonly subscribe: (listener: (status: ProductSidecarStatus) => void) => Promise<() => void>
    readonly restart: () => Promise<ProductSidecarStatus>
  }
  readonly credentials: {
    readonly getCapabilities: () => Promise<ProductCredentialCapabilities>
  }
}

export type DesktopProductHost = DesktopProductHostAPI & {
  readonly kind: "desktop"
  readonly modelCenter: ProductModelCenterAPI
}

const unavailableModelCenter = Object.freeze({
  capabilities: async () => ({
    available: false,
    credentialBackend: "unsupported" as const,
    credentialOperations: Object.freeze({ read: false, write: false, delete: false }),
    localDetection: false,
  }),
  list: async () => [],
  save: async () => Promise.reject(new Error("The visual model center is not available.")),
  remove: async () => Promise.reject(new Error("The visual model center is not available.")),
  discover: async () => Promise.reject(new Error("The visual model center is not available.")),
  test: async () => Promise.reject(new Error("The visual model center is not available.")),
  detectLocal: async () => [],
  selectDefault: async () => Promise.reject(new Error("The visual model center is not available.")),
  reloadCredentials: async () => Promise.reject(new Error("The visual model center is not available.")),
}) satisfies ProductModelCenterAPI

const SIDE_CAR_STATES: readonly string[] = [
  "unavailable",
  "unmanaged",
  "stopped",
  "starting",
  "ready",
  "restarting",
  "stopping",
  "failed",
]
const ERROR_KINDS: readonly string[] = ["start", "health", "exit"]
const ERROR_MESSAGES = Object.freeze({
  start: "The local agent server could not be started.",
  health: "The local agent server did not become healthy.",
  exit: "The local agent server stopped unexpectedly.",
}) satisfies Readonly<Record<ProductSidecarError["kind"], string>>

export function sanitizeProductSidecarStatus(input: unknown, fallbackTime = Date.now()): ProductSidecarStatus {
  const source = record(input)
  const state = sidecarState(source.status) ?? sidecarState(source.state) ?? "unavailable"
  const attempt = safeInteger(source.attempt) ?? 0
  const changedAt = safeTimestamp(source.changedAt) ?? safeTimestamp(fallbackTime) ?? 0
  const startedAt = safeTimestamp(source.startedAt)
  const readyAt = safeTimestamp(source.readyAt)
  const stoppedAt = safeTimestamp(source.stoppedAt)
  const nextRetryAt = safeTimestamp(source.nextRetryAt)
  const error = sanitizeError(source.error)

  return Object.freeze({
    state,
    attempt,
    changedAt,
    ...(startedAt === undefined ? {} : { startedAt }),
    ...(readyAt === undefined ? {} : { readyAt }),
    ...(stoppedAt === undefined ? {} : { stoppedAt }),
    ...(nextRetryAt === undefined ? {} : { nextRetryAt }),
    ...(error ? { error } : {}),
  })
}

export function createUnmanagedSidecarStatus(time = Date.now()): ProductSidecarStatus {
  return sanitizeProductSidecarStatus({ state: "unmanaged", changedAt: time }, time)
}

export function createUnavailableSidecarStatus(time = Date.now()): ProductSidecarStatus {
  return sanitizeProductSidecarStatus({ state: "unavailable", changedAt: time }, time)
}

export function createProductCredentialCapabilities(
  namespace: string,
  platform: NodeJS.Platform,
  available = false,
): ProductCredentialCapabilities {
  const backend =
    platform === "darwin"
      ? "macos-keychain"
      : platform === "win32"
        ? "windows-credential-manager"
        : "unsupported"
  const enabled = platform === "darwin" && available
  return Object.freeze({
    namespace,
    backend,
    available: enabled,
    operations: Object.freeze({ read: enabled, write: enabled, delete: enabled }),
  })
}

export function createDesktopProductHost(api: DesktopProductHostAPI): DesktopProductHost {
  return Object.freeze({
    kind: "desktop" as const,
    modelCenter: unavailableModelCenter,
    sidecar: Object.freeze({
      getStatus: () => api.sidecar.getStatus(),
      subscribe: (listener: (status: ProductSidecarStatus) => void) => api.sidecar.subscribe(listener),
      restart: () => api.sidecar.restart(),
    }),
    credentials: Object.freeze({
      getCapabilities: () => api.credentials.getCapabilities(),
    }),
  })
}

function sanitizeError(value: unknown): ProductSidecarError | undefined {
  const source = record(value)
  const kind = errorKind(source.kind)
  if (!kind) return undefined
  const exitCode = safeExitCode(source.exitCode)
  return Object.freeze({
    kind,
    message: ERROR_MESSAGES[kind],
    ...(exitCode === undefined ? {} : { exitCode }),
  })
}

function sidecarState(value: unknown): ProductSidecarStateName | undefined {
  if (typeof value !== "string" || !SIDE_CAR_STATES.includes(value)) return undefined
  switch (value) {
    case "unavailable":
    case "unmanaged":
    case "stopped":
    case "starting":
    case "ready":
    case "restarting":
    case "stopping":
    case "failed":
      return value
  }
  return undefined
}

function errorKind(value: unknown): ProductSidecarError["kind"] | undefined {
  if (typeof value !== "string" || !ERROR_KINDS.includes(value)) return undefined
  if (value === "start" || value === "health" || value === "exit") return value
  return undefined
}

function safeTimestamp(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined
}

function safeInteger(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

function safeExitCode(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : undefined
}

function record(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
