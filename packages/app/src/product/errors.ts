import type { ProductError, ProductErrorDiagnostic, ProductErrorKind } from "./contracts"

export type { ProductError, ProductErrorDiagnostic, ProductErrorKind } from "./contracts"

const MAX_ERROR_DEPTH = 8
const MAX_ERROR_RECORDS = 32
const MAX_HEADER_KEYS = 64
const MAX_SIGNAL_LENGTH = 8_192
const MAX_SIGNAL_SEGMENT_LENGTH = 256
const NESTED_ERROR_KEYS = ["cause", "data", "body", "error", "response", "status", "code"] as const
const SAFE_ERROR_NAMES = new Set([
  "APIError",
  "AbortError",
  "Error",
  "FetchError",
  "MessageAbortedError",
  "MessageOutputLengthError",
  "NetworkError",
  "ProviderAuthError",
  "ResponseError",
  "TimeoutError",
  "TypeError",
  "UnknownError",
])
const SAFE_ERROR_CODES = new Set([
  "ABORT_ERR",
  "AUTHENTICATION_ERROR",
  "CERT_HAS_EXPIRED",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ENOTFOUND",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "ETIMEDOUT",
  "FORBIDDEN",
  "INCOMPATIBLE_API",
  "MODEL_NOT_FOUND",
  "PROCESS_EXITED",
  "SERVER_CRASH",
  "SERVER_PROCESS_EXITED",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "SSE_ERROR",
  "STREAM_ERROR",
  "TIMEOUT",
  "TOOL_CALL_ERROR",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNAUTHORIZED",
  "UND_ERR_CONNECT_TIMEOUT",
  "UNKNOWN_MODEL",
])

const ERROR_DETAILS = {
  "unreachable-endpoint": {
    message: "The model endpoint could not be reached.",
    action: "Check that the service is running and the endpoint is reachable, then retry.",
    retryable: true,
  },
  authentication: {
    message: "The model service rejected the saved credentials.",
    action: "Update the saved credentials for this model, then retry.",
    retryable: false,
  },
  "incompatible-api": {
    message: "The endpoint does not provide a compatible agent API.",
    action: "Verify the endpoint API version and agent compatibility.",
    retryable: false,
  },
  "missing-model": {
    message: "The selected model is unavailable.",
    action: "Choose an available model or correct the configured model ID.",
    retryable: false,
  },
  streaming: {
    message: "The response stream ended unexpectedly.",
    action: "Retry the task; if it repeats, verify streaming support for this model.",
    retryable: true,
  },
  "tool-calling": {
    message: "The model could not complete a tool call.",
    action: "Choose a model with structured tool support or adjust its configuration.",
    retryable: false,
  },
  timeout: {
    message: "The model service did not respond in time.",
    action: "Check the service and network, then retry or increase the configured timeout.",
    retryable: true,
  },
  tls: {
    message: "A secure connection to the model service could not be established.",
    action: "Fix the endpoint certificate or trust configuration, then retry.",
    retryable: false,
  },
  "server-crash": {
    message: "The agent service stopped unexpectedly.",
    action: "Restart the service, then retry the task.",
    retryable: true,
  },
  aborted: {
    message: "The request was stopped.",
    action: "Retry when you are ready.",
    retryable: true,
  },
  unknown: {
    message: "An unexpected product error occurred.",
    action: "Retry once; if it continues, report the safe diagnostic fields.",
    retryable: true,
  },
} as const satisfies Readonly<Record<ProductErrorKind, Omit<ProductError, "kind" | "diagnostic">>>

export function normalizeProductError(input: unknown): ProductError {
  const records = collectErrorRecords(input)
  const kind = classifyProductError(records)
  const diagnostic = createDiagnostic(records)

  return Object.freeze({
    kind,
    ...ERROR_DETAILS[kind],
    ...(diagnostic ? { diagnostic } : {}),
  })
}

type ErrorRecord = Record<string, unknown>

function collectErrorRecords(input: unknown) {
  const records: ErrorRecord[] = []
  const seen = new Set<object>()
  const visit = (value: unknown, depth: number) => {
    if (!isRecord(value) || seen.has(value) || depth > MAX_ERROR_DEPTH || records.length >= MAX_ERROR_RECORDS) return
    seen.add(value)
    records.push(value)
    NESTED_ERROR_KEYS.forEach((key) => visit(value[key], depth + 1))
  }

  visit(input, 0)
  return records
}

function classifyProductError(records: readonly ErrorRecord[]): ProductErrorKind {
  const signal = records
    .flatMap((record) => [record.name, record.code, record.message, record.body])
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.slice(0, MAX_SIGNAL_SEGMENT_LENGTH))
    .join(" ")
    .slice(0, MAX_SIGNAL_LENGTH)
    .toLowerCase()
  const statuses = records.flatMap((record) => [record.status, record.statusCode]).filter(isSafeStatus)

  if (/\babort(?:ed|error)?\b|\bcancel(?:led|ed)\b|abort_err/.test(signal)) return "aborted"
  if (
    statuses.some((status) => status === 401 || status === 403) ||
    /providerautherror|authentication[_ -]?(?:error|failed)|unauthori[sz]ed|forbidden|invalid[_ -]?(?:credential|api[_ -]?key)/.test(
      signal,
    )
  )
    return "authentication"
  if (
    /model[_ -]?(?:not[_ -]?found|missing|unavailable)|unknown[_ -]?model|no such model|model does not exist|requested model does not exist/.test(
      signal,
    )
  )
    return "missing-model"
  if (
    /cert(?:ificate)?[_ -]?(?:has[_ -]?)?expired|self[_ -]?signed|unable[_ -]?to[_ -]?verify|tls|ssl|cert_altname/.test(
      signal,
    )
  )
    return "tls"
  if (/\btimeout(?:error)?\b|timed[_ -]?out|etimedout|und_err_connect_timeout/.test(signal)) return "timeout"
  if (/\bsse(?:[_ -]?error)?\b|stream(?:ing)?[_ -]?(?:error|failed|failure|closed|ended)/.test(signal))
    return "streaming"
  if (
    /tool[_ -]?call(?:ing)?[_ -]?(?:error|failed|failure)?|function[_ -]?call(?:ing)?[_ -]?(?:error|failed)/.test(
      signal,
    )
  )
    return "tool-calling"
  if (
    statuses.some((status) => [405, 406, 415, 426].includes(status)) ||
    /incompatible[_ -]?api|unsupported[_ -]?(?:api|route|protocol)|(?:api|route)(?:[_ -]?endpoint)?[_ -]?not[_ -]?found|api[_ -]?version[_ -]?(?:mismatch|unsupported)/.test(
      signal,
    )
  )
    return "incompatible-api"
  if (
    /server[_ -]?crash|server[_ -]?process[_ -]?(?:exit|exited)|sidecar[_ -]?(?:crash|exit|exited)|\bprocess[_ -]?exited\b/.test(
      signal,
    )
  )
    return "server-crash"
  if (
    /econnrefused|econnreset|enotfound|ehostunreach|enetunreach|eai_again|failed to fetch|fetch failed|network error|endpoint unreachable|socket hang up|connection closed unexpectedly/.test(
      signal,
    )
  )
    return "unreachable-endpoint"
  return "unknown"
}

function createDiagnostic(records: readonly ErrorRecord[]): ProductErrorDiagnostic | undefined {
  const name = records.map((record) => record.name).find(isSafeErrorName)
  const code = records.flatMap((record) => [record.code, record.errno]).find(isSafeErrorCode)
  const status = records.flatMap((record) => [record.status, record.statusCode]).find(isSafeStatus)
  const requestID = records
    .flatMap((record) => [
      record.requestID,
      record.requestId,
      record.request_id,
      readHeaderRequestID(record.responseHeaders),
      readHeaderRequestID(record.headers),
    ])
    .find(isSafeRequestID)
  if (!name && !code && !status && !requestID) return

  return Object.freeze({
    ...(name ? { name } : {}),
    ...(code ? { code } : {}),
    ...(status ? { status } : {}),
    ...(requestID ? { requestID } : {}),
  })
}

function readHeaderRequestID(value: unknown) {
  if (!isRecord(value)) return

  try {
    const get = value.get
    if (typeof get === "function") {
      const requestID = get.call(value, "x-request-id")
      if (isSafeRequestID(requestID)) return requestID
      const fallback = get.call(value, "request-id")
      if (isSafeRequestID(fallback)) return fallback
    }

    let inspected = 0
    for (const key in value) {
      inspected++
      if (inspected > MAX_HEADER_KEYS) return
      if (!Object.prototype.hasOwnProperty.call(value, key)) continue
      const normalized = key.toLowerCase()
      if (normalized !== "x-request-id" && normalized !== "request-id") continue
      const requestID = value[key]
      if (isSafeRequestID(requestID)) return requestID
    }
  } catch {
    return
  }
}

function isRecord(value: unknown): value is ErrorRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isSafeErrorName(value: unknown): value is string {
  return typeof value === "string" && SAFE_ERROR_NAMES.has(value)
}

function isSafeErrorCode(value: unknown): value is string {
  return typeof value === "string" && SAFE_ERROR_CODES.has(value)
}

function isSafeStatus(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 100 && value <= 599
}

function isSafeRequestID(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 64) return false
  const prefixed = /^(?:req|request|trace|rid)_[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  if (!prefixed && !uuid) return false
  return !/authorization|bearer|basic|api[_-]?key|token|prompt|source|sk-|gh[pousr]_|xox[baprs]-|AIza/i.test(value)
}
