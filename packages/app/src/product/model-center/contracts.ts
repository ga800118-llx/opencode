import type { ProductErrorKind } from "../contracts"

export const MODEL_RUNTIME_UNRECONCILED = "MODEL_RUNTIME_UNRECONCILED"

export const PRODUCT_PROVIDER_KINDS = ["openai-compatible", "ollama", "lm-studio", "custom-local"] as const
export type ProductProviderKind = (typeof PRODUCT_PROVIDER_KINDS)[number]

export const PRODUCT_MODEL_CLASSIFICATIONS = [
  "agent-capable",
  "partially-compatible",
  "chat-only",
  "incompatible",
] as const
export type ProductModelClassification = (typeof PRODUCT_MODEL_CLASSIFICATIONS)[number]

export type ProductProviderModel = {
  readonly id: string
  readonly name: string
  readonly source: "discovered" | "manual"
}

export type ProductProviderHeader = {
  readonly name: string
  readonly value?: string
  readonly sensitive: boolean
  readonly hasValue: boolean
}

export type ProductProviderSettings = {
  readonly contextLimit: number
  readonly outputLimit: number
  readonly proxyURL?: string
  readonly allowInsecureTls: false
}

export type ProductProviderRuntime = {
  readonly baseURL: string
  readonly credentialProxy: true
}

export type ProductCapabilityChecks = {
  readonly basicChat: boolean
  readonly streaming: boolean
  readonly toolCalling: boolean
}

export type ProductModelDiagnostic = {
  readonly kind: ProductErrorKind
  readonly message: string
  readonly requestID: string
  readonly status?: number
  readonly detail?: string
}

export type ProductCapabilityReport = {
  readonly modelID: string
  readonly classification: ProductModelClassification
  readonly checks: ProductCapabilityChecks
  readonly testedAt: number
  readonly requestID: string
  readonly diagnostic?: ProductModelDiagnostic
}

export type ProductProviderProfile = {
  readonly id: string
  readonly providerID: string
  readonly name: string
  readonly kind: ProductProviderKind
  readonly baseURL: string
  readonly credentialRef?: string
  readonly hasApiKey: boolean
  readonly headers: readonly ProductProviderHeader[]
  readonly models: readonly ProductProviderModel[]
  readonly defaultModelID?: string
  readonly settings: ProductProviderSettings
  readonly runtime?: ProductProviderRuntime
  readonly test?: ProductCapabilityReport
  readonly createdAt: number
  readonly updatedAt: number
}

export type ProductCredentialEnvelopeInput = {
  readonly apiKey?: string | null
  readonly headers?: Readonly<Record<string, string | null>>
}

export type ProductProviderProfileInput = {
  readonly id?: string
  readonly name: string
  readonly kind: ProductProviderKind
  readonly baseURL: string
  readonly headers: readonly ProductProviderHeader[]
  readonly models: readonly ProductProviderModel[]
  readonly defaultModelID?: string
  readonly settings: ProductProviderSettings
  readonly credentials?: ProductCredentialEnvelopeInput
}

export type ProductProviderProbeInput = {
  readonly profileID?: string
  readonly draft?: ProductProviderProfileInput
}

export type ProductProviderTestInput = ProductProviderProbeInput & {
  readonly modelID: string
}

export type ProductModelDiscoveryResult = {
  readonly models: readonly ProductProviderModel[]
  readonly requestID: string
  readonly diagnostic?: ProductModelDiagnostic
}

export type ProductLocalProviderCandidate = {
  readonly id: "ollama" | "lm-studio"
  readonly kind: "ollama" | "lm-studio"
  readonly name: string
  readonly baseURL: string
  readonly available: boolean
  readonly models: readonly ProductProviderModel[]
  readonly diagnostic?: ProductModelDiagnostic
}

export type ProductDefaultModelInput = {
  readonly profileID: string
  readonly modelID: string
}

export type ProductModelCenterCapabilities = {
  readonly available: boolean
  readonly credentialBackend: "local-encrypted-file" | "macos-keychain" | "windows-credential-manager" | "unsupported"
  readonly credentialOperations: {
    readonly read: boolean
    readonly write: boolean
    readonly delete: boolean
  }
  readonly localDetection: boolean
}

export type ProductModelCenterAPI = {
  readonly capabilities: () => Promise<ProductModelCenterCapabilities>
  readonly list: () => Promise<readonly ProductProviderProfile[]>
  readonly save: (input: ProductProviderProfileInput) => Promise<ProductProviderProfile>
  readonly remove: (profileID: string) => Promise<void>
  readonly discover: (input: ProductProviderProbeInput) => Promise<ProductModelDiscoveryResult>
  readonly test: (input: ProductProviderTestInput) => Promise<ProductCapabilityReport>
  readonly detectLocal: () => Promise<readonly ProductLocalProviderCandidate[]>
  readonly selectDefault: (input: ProductDefaultModelInput) => Promise<ProductProviderProfile>
  readonly reloadCredentials: () => Promise<void>
}

const HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"])
const PROVIDER_KIND_SET = new Set<string>(PRODUCT_PROVIDER_KINDS)
const MODEL_SOURCE_SET = new Set<string>(["discovered", "manual"])

export function normalizeProviderProfileInput(input: unknown): ProductProviderProfileInput {
  const value = record(input)
  const name = requiredString(value.name, "A profile name is required.", 80)
  const kind = providerKind(value.kind)
  const baseURL = endpoint(value.baseURL)
  const url = new URL(baseURL)
  if ((kind === "ollama" || kind === "lm-studio") && !isLoopback(url.hostname)) {
    throw new Error("Local model services must use a loopback endpoint.")
  }

  const settings = normalizeSettings(value.settings)
  const headers = normalizeHeaders(value.headers)
  const models = normalizeModels(value.models)
  const defaultModelID = optionalString(value.defaultModelID, 256)
  if (defaultModelID && !models.some((model) => model.id === defaultModelID)) {
    throw new Error("The default model must belong to this profile.")
  }

  const id = optionalID(value.id)
  const credentials = normalizeCredentials(value.credentials)
  return Object.freeze({
    ...(id ? { id } : {}),
    name,
    kind,
    baseURL,
    headers: Object.freeze(headers),
    models: Object.freeze(models),
    ...(defaultModelID ? { defaultModelID } : {}),
    settings,
    ...(credentials ? { credentials } : {}),
  })
}

export function sanitizeProviderProfile(input: unknown): ProductProviderProfile {
  const value = record(input)
  const normalized = normalizeProviderProfileInput(input)
  const id = requiredID(value.id)
  const providerID = requiredID(value.providerID)
  const credentialRef = optionalID(value.credentialRef)
  const hasApiKey = value.hasApiKey === true
  const createdAt = timestamp(value.createdAt, "A valid profile creation time is required.")
  const updatedAt = timestamp(value.updatedAt, "A valid profile update time is required.")
  const test = normalizeCapabilityReport(value.test)
  const runtime = normalizeRuntime(value.runtime)

  return Object.freeze({
    id,
    providerID,
    name: normalized.name,
    kind: normalized.kind,
    baseURL: normalized.baseURL,
    ...(credentialRef ? { credentialRef } : {}),
    hasApiKey,
    headers: Object.freeze(normalized.headers.map((header) => Object.freeze({ ...header }))),
    models: Object.freeze(normalized.models.map((model) => Object.freeze({ ...model }))),
    ...(normalized.defaultModelID ? { defaultModelID: normalized.defaultModelID } : {}),
    settings: Object.freeze({ ...normalized.settings }),
    ...(runtime ? { runtime } : {}),
    ...(test ? { test } : {}),
    createdAt,
    updatedAt,
  })
}

function normalizeRuntime(input: unknown): ProductProviderRuntime | undefined {
  if (input === undefined) return undefined
  const value = record(input)
  if (value.credentialProxy !== true) return undefined
  return Object.freeze({ baseURL: endpoint(value.baseURL), credentialProxy: true as const })
}

function normalizeSettings(input: unknown): ProductProviderSettings {
  const value = record(input)
  const contextLimit = integer(value.contextLimit, 1, 10_000_000, "Context limit must be a positive integer.")
  const outputLimit = integer(value.outputLimit, 1, 1_000_000, "Output limit must be a positive integer.")
  if (value.allowInsecureTls === true) throw new Error("Insecure TLS is not supported by this desktop runtime.")
  const proxyURL = optionalString(value.proxyURL, 2_048)
  if (proxyURL) throw new Error("Per-profile proxies are not supported by this desktop runtime.")
  return Object.freeze({ contextLimit, outputLimit, allowInsecureTls: false as const })
}

function normalizeHeaders(input: unknown): ProductProviderHeader[] {
  if (!Array.isArray(input)) throw new Error("Profile headers must be a list.")
  const seen = new Set<string>()
  return input.map((entry) => {
    const value = record(entry)
    const name = requiredString(value.name, "Header names are required.", 256)
    if (!HEADER_NAME.test(name)) throw new Error("Header names must use valid HTTP token characters.")
    const key = name.toLowerCase()
    if (seen.has(key)) throw new Error("Header names must be unique.")
    seen.add(key)
    const sensitive = value.sensitive === true
    const headerValue = sensitive ? undefined : optionalString(value.value, 8_192)
    return Object.freeze({
      name,
      ...(headerValue ? { value: headerValue } : {}),
      sensitive,
      hasValue: sensitive ? value.hasValue === true : Boolean(headerValue),
    })
  })
}

function normalizeModels(input: unknown): ProductProviderModel[] {
  if (!Array.isArray(input)) throw new Error("Profile models must be a list.")
  const seen = new Set<string>()
  return input.map((entry) => {
    const value = record(entry)
    const id = requiredString(value.id, "Model IDs are required.", 256)
    if (seen.has(id)) throw new Error("Model IDs must be unique.")
    seen.add(id)
    const name = requiredString(value.name, "Model names are required.", 256)
    if (typeof value.source !== "string" || !MODEL_SOURCE_SET.has(value.source)) {
      throw new Error("Model source is invalid.")
    }
    return Object.freeze({ id, name, source: value.source as ProductProviderModel["source"] })
  })
}

function normalizeCredentials(input: unknown): ProductCredentialEnvelopeInput | undefined {
  if (input === undefined) return
  const value = record(input)
  const apiKey = nullableSecret(value.apiKey)
  const headersValue = value.headers
  let headers: Record<string, string | null> | undefined
  if (headersValue !== undefined) {
    const source = record(headersValue)
    headers = Object.fromEntries(
      Object.entries(source).flatMap(([name, secret]) => {
        if (!HEADER_NAME.test(name)) throw new Error("Credential header names are invalid.")
        const normalized = nullableSecret(secret)
        return normalized === undefined ? [] : [[name, normalized]]
      }),
    )
  }
  return Object.freeze({ ...(apiKey !== undefined ? { apiKey } : {}), ...(headers ? { headers } : {}) })
}

function normalizeCapabilityReport(input: unknown): ProductCapabilityReport | undefined {
  if (input === undefined) return
  const value = record(input)
  if (
    typeof value.classification !== "string" ||
    !PRODUCT_MODEL_CLASSIFICATIONS.includes(value.classification as never)
  ) {
    return
  }
  const checks = record(value.checks)
  const modelID = optionalString(value.modelID, 256)
  const requestID = optionalString(value.requestID, 256)
  if (!modelID || !requestID) return
  return Object.freeze({
    modelID,
    classification: value.classification as ProductModelClassification,
    checks: Object.freeze({
      basicChat: checks.basicChat === true,
      streaming: checks.streaming === true,
      toolCalling: checks.toolCalling === true,
    }),
    testedAt: timestamp(value.testedAt, "A valid model test time is required."),
    requestID,
  })
}

function endpoint(input: unknown) {
  if (typeof input !== "string") throw new Error("A valid HTTP or HTTPS endpoint is required.")
  try {
    const url = new URL(input.trim())
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error()
    if (url.username || url.password) throw new Error()
    url.hash = ""
    url.search = ""
    return url.toString().replace(/\/$/, "")
  } catch {
    throw new Error("A valid HTTP or HTTPS endpoint is required.")
  }
}

function providerKind(input: unknown): ProductProviderKind {
  if (typeof input !== "string" || !PROVIDER_KIND_SET.has(input)) throw new Error("Provider kind is invalid.")
  return input as ProductProviderKind
}

function isLoopback(hostname: string) {
  return LOOPBACK_HOSTS.has(hostname.toLowerCase()) || /^127(?:\.\d{1,3}){3}$/.test(hostname)
}

function integer(input: unknown, minimum: number, maximum: number, message: string) {
  if (!Number.isSafeInteger(input) || (input as number) < minimum || (input as number) > maximum)
    throw new Error(message)
  return input as number
}

function timestamp(input: unknown, message: string) {
  if (typeof input !== "number" || !Number.isFinite(input) || input < 0) throw new Error(message)
  return input
}

function requiredString(input: unknown, message: string, maximum: number) {
  const value = optionalString(input, maximum)
  if (!value) throw new Error(message)
  return value
}

function optionalString(input: unknown, maximum: number) {
  if (input === undefined || input === null || input === "") return undefined
  if (typeof input !== "string") throw new Error("A text field is invalid.")
  const value = input.trim()
  if (!value || value.length > maximum) throw new Error("A text field is invalid.")
  return value
}

function nullableSecret(input: unknown) {
  if (input === undefined) return undefined
  if (input === null) return null
  if (typeof input !== "string" || input.length > 32_768) throw new Error("A credential value is invalid.")
  return input
}

function optionalID(input: unknown) {
  const value = optionalString(input, 256)
  if (!value) return
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)) throw new Error("A profile identifier is invalid.")
  return value
}

function requiredID(input: unknown) {
  const value = optionalID(input)
  if (!value) throw new Error("A profile identifier is required.")
  return value
}

function record(input: unknown): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) throw new Error("Profile data is invalid.")
  return input as Record<string, unknown>
}
