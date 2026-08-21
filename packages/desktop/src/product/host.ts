import type { ProductModelCenterAPI } from "@opencode-ai/app/product/model-center"

export const PRODUCT_HOST_CHANNELS = Object.freeze({
  sidecarGetStatus: "product-sidecar-get-status",
  sidecarSubscribe: "product-sidecar-subscribe",
  sidecarUnsubscribe: "product-sidecar-unsubscribe",
  sidecarState: "product-sidecar-state",
  sidecarRestart: "product-sidecar-restart",
  credentialGetCapabilities: "product-credential-get-capabilities",
  modelCenterCapabilities: "product-model-center-capabilities",
  modelCenterList: "product-model-center-list",
  modelCenterSave: "product-model-center-save",
  modelCenterRemove: "product-model-center-remove",
  modelCenterDiscover: "product-model-center-discover",
  modelCenterTest: "product-model-center-test",
  modelCenterDetectLocal: "product-model-center-detect-local",
  modelCenterSelectDefault: "product-model-center-select-default",
  modelCenterReloadCredentials: "product-model-center-reload-credentials",
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

export type ProductCredentialBackend =
  | "local-encrypted-file"
  | "macos-keychain"
  | "windows-credential-manager"
  | "unsupported"

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
  readonly modelCenter: ProductModelCenterAPI
}

export type DesktopProductHost = DesktopProductHostAPI & {
  readonly kind: "desktop"
  readonly modelCenter: ProductModelCenterAPI
}

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
  override?: ProductCredentialBackend,
): ProductCredentialCapabilities {
  const backend =
    override ??
    (platform === "darwin" ? "macos-keychain" : platform === "win32" ? "windows-credential-manager" : "unsupported")
  const enabled = backend !== "unsupported" && available
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
    modelCenter: Object.freeze({
      capabilities: () => api.modelCenter.capabilities(),
      list: () => api.modelCenter.list(),
      save: (input: Parameters<ProductModelCenterAPI["save"]>[0]) => api.modelCenter.save(input),
      remove: (profileID: Parameters<ProductModelCenterAPI["remove"]>[0]) => api.modelCenter.remove(profileID),
      discover: (input: Parameters<ProductModelCenterAPI["discover"]>[0]) => api.modelCenter.discover(input),
      test: (input: Parameters<ProductModelCenterAPI["test"]>[0]) => api.modelCenter.test(input),
      detectLocal: () => api.modelCenter.detectLocal(),
      selectDefault: (input: Parameters<ProductModelCenterAPI["selectDefault"]>[0]) =>
        api.modelCenter.selectDefault(input),
      reloadCredentials: () => api.modelCenter.reloadCredentials(),
    }),
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
