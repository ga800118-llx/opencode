import { randomUUID } from "node:crypto"
import {
  PRODUCT_PROVIDER_KINDS,
  type ProductCapabilityReport,
  type ProductModelDiscoveryResult,
  type ProductProviderKind,
  type ProductProviderModel,
} from "@opencode-ai/app/product/model-center"
import { createProbeDiagnostic } from "./diagnostics"
import { ModelProbeHttpError, requestJSON, requestSSE, type ModelProbeFetch } from "./http"

export type ModelProbeTarget = {
  readonly kind: ProductProviderKind
  readonly baseURL: string
  readonly apiKey?: string
  readonly headers?: Readonly<Record<string, string>>
  readonly timeoutMs: number
}

export type ModelProbe = {
  readonly discover: (target: ModelProbeTarget) => Promise<ProductModelDiscoveryResult>
  readonly test: (input: { target: ModelProbeTarget; modelID: string }) => Promise<ProductCapabilityReport>
}

type ModelProbeOptions = {
  readonly fetch?: ModelProbeFetch
  readonly now?: () => number
  readonly requestID?: () => string
}

export function createModelProbe(options: ModelProbeOptions = {}): ModelProbe {
  const fetcher = options.fetch ?? fetch
  const now = options.now ?? Date.now
  const nextRequestID = options.requestID ?? randomUUID

  return Object.freeze({
    async discover(input) {
      const requestID = nextRequestID()
      try {
        const target = normalizeTarget(input)
        const result = await requestJSON({
          fetch: fetcher,
          url: discoveryURL(target),
          headers: requestHeaders(target),
          timeoutMs: target.timeoutMs,
          notFoundCode: "INCOMPATIBLE_API",
        })
        return Object.freeze({ models: Object.freeze(discoveredModels(target.kind, result)), requestID })
      } catch (error) {
        return Object.freeze({ models: Object.freeze([]), requestID, diagnostic: createProbeDiagnostic(error, requestID) })
      }
    },
    async test(input) {
      const requestID = nextRequestID()
      const testedAt = now()
      let target: ModelProbeTarget
      let modelID: string
      try {
        target = normalizeTarget(input.target)
        modelID = normalizeModelID(input.modelID)
      } catch (error) {
        return report("", "incompatible", false, false, false, testedAt, requestID, error)
      }

      try {
        const basic = await requestJSON({
          fetch: fetcher,
          url: chatURL(target),
          headers: requestHeaders(target),
          timeoutMs: target.timeoutMs,
          body: chatBody(modelID),
          notFoundCode: "MODEL_NOT_FOUND",
        })
        if (!hasAssistantMessage(basic)) throw new ModelProbeHttpError("INCOMPATIBLE_API")
      } catch (error) {
        return report(modelID, "incompatible", false, false, false, testedAt, requestID, error)
      }

      let streaming = true
      let streamingError: unknown
      try {
        const event = await requestSSE({
          fetch: fetcher,
          url: chatURL(target),
          headers: requestHeaders(target),
          timeoutMs: target.timeoutMs,
          body: { ...chatBody(modelID), stream: true },
          notFoundCode: "MODEL_NOT_FOUND",
        })
        if (!hasChoices(event)) throw new ModelProbeHttpError("SSE_ERROR")
      } catch (error) {
        streaming = false
        streamingError = error
      }

      let toolCalling = true
      let toolError: unknown
      try {
        const tool = await requestJSON({
          fetch: fetcher,
          url: chatURL(target),
          headers: requestHeaders(target),
          timeoutMs: target.timeoutMs,
          body: toolBody(modelID),
          notFoundCode: "MODEL_NOT_FOUND",
        })
        if (!hasProbeToolCall(tool)) throw new ModelProbeHttpError("TOOL_CALL_ERROR")
      } catch (error) {
        toolCalling = false
        toolError = error
      }

      const classification =
        streaming && toolCalling
          ? "agent-capable"
          : streaming || toolCalling
            ? "partially-compatible"
            : "chat-only"
      return report(
        modelID,
        classification,
        true,
        streaming,
        toolCalling,
        testedAt,
        requestID,
        toolError ?? streamingError,
        toolError ? "tool-calling" : streamingError ? "streaming" : undefined,
      )
    },
  })
}

function report(
  modelID: string,
  classification: ProductCapabilityReport["classification"],
  basicChat: boolean,
  streaming: boolean,
  toolCalling: boolean,
  testedAt: number,
  requestID: string,
  error?: unknown,
  fallbackKind?: "streaming" | "tool-calling",
): ProductCapabilityReport {
  return Object.freeze({
    modelID,
    classification,
    checks: Object.freeze({ basicChat, streaming, toolCalling }),
    testedAt,
    requestID,
    ...(error ? { diagnostic: createProbeDiagnostic(error, requestID, fallbackKind) } : {}),
  })
}

function normalizeTarget(input: ModelProbeTarget): ModelProbeTarget {
  if (!PRODUCT_PROVIDER_KINDS.includes(input.kind)) throw new ModelProbeHttpError("INCOMPATIBLE_API")
  let url: URL
  try {
    url = new URL(input.baseURL)
  } catch {
    throw new ModelProbeHttpError("INCOMPATIBLE_API")
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
    throw new ModelProbeHttpError("INCOMPATIBLE_API")
  }
  if (!Number.isSafeInteger(input.timeoutMs) || input.timeoutMs <= 0) throw new ModelProbeHttpError("TIMEOUT")
  return input
}

function requestHeaders(target: ModelProbeTarget) {
  const headers = new Headers(target.headers)
  if (target.apiKey && !headers.has("authorization")) headers.set("authorization", `Bearer ${target.apiKey}`)
  return headers
}

function discoveryURL(target: ModelProbeTarget) {
  if (target.kind === "ollama") {
    const url = new URL(target.baseURL)
    url.pathname = "/api/tags"
    url.search = ""
    url.hash = ""
    return url
  }
  return appendPath(target.baseURL, "models")
}

function chatURL(target: ModelProbeTarget) {
  const base = target.kind === "ollama" ? ollamaOpenAIBase(target.baseURL) : target.baseURL
  return appendPath(base, "chat/completions")
}

function ollamaOpenAIBase(input: string) {
  const url = new URL(input)
  const path = url.pathname.replace(/\/$/, "")
  url.pathname = path.endsWith("/v1") ? path : `${path}/v1`
  return url.toString().replace(/\/$/, "")
}

function appendPath(baseURL: string, path: string) {
  return new URL(`${baseURL.replace(/\/$/, "")}/${path}`)
}

function discoveredModels(kind: ProductProviderKind, input: unknown): ProductProviderModel[] {
  if (!isRecord(input)) throw new ModelProbeHttpError("INCOMPATIBLE_API")
  const entries = kind === "ollama" ? input.models : input.data
  if (!Array.isArray(entries)) throw new ModelProbeHttpError("INCOMPATIBLE_API")
  const seen = new Set<string>()
  return entries.flatMap((entry) => {
    if (!isRecord(entry)) return []
    const rawID = kind === "ollama" ? entry.name : entry.id
    if (typeof rawID !== "string") return []
    const id = rawID.trim()
    if (!id || id.length > 256 || seen.has(id)) return []
    seen.add(id)
    const rawName = kind === "ollama" ? entry.name : entry.name
    const name = typeof rawName === "string" && rawName.trim() ? rawName.trim().slice(0, 256) : id
    return [Object.freeze({ id, name, source: "discovered" as const })]
  })
}

function chatBody(modelID: string) {
  return {
    model: modelID,
    messages: [{ role: "user", content: "Reply with OK." }],
    max_tokens: 8,
    stream: false,
  }
}

function toolBody(modelID: string) {
  return {
    model: modelID,
    messages: [{ role: "user", content: "Call report_probe once." }],
    max_tokens: 32,
    stream: false,
    tools: [
      {
        type: "function",
        function: {
          name: "report_probe",
          description: "Report a deterministic compatibility probe.",
          parameters: { type: "object", properties: {}, additionalProperties: false },
        },
      },
    ],
    tool_choice: { type: "function", function: { name: "report_probe" } },
  }
}

function hasAssistantMessage(input: unknown) {
  if (!isRecord(input) || !Array.isArray(input.choices)) return false
  const first = input.choices[0]
  if (!isRecord(first) || !isRecord(first.message)) return false
  return typeof first.message.content === "string"
}

function hasChoices(input: unknown) {
  return isRecord(input) && Array.isArray(input.choices) && input.choices.length > 0
}

function hasProbeToolCall(input: unknown) {
  if (!isRecord(input) || !Array.isArray(input.choices)) return false
  const first = input.choices[0]
  if (!isRecord(first) || !isRecord(first.message) || !Array.isArray(first.message.tool_calls)) return false
  return first.message.tool_calls.some((call) => {
    if (!isRecord(call) || !isRecord(call.function)) return false
    return call.function.name === "report_probe"
  })
}

function normalizeModelID(input: unknown) {
  if (typeof input !== "string") throw new ModelProbeHttpError("MODEL_NOT_FOUND")
  const value = input.trim()
  if (!value || value.length > 256) throw new ModelProbeHttpError("MODEL_NOT_FOUND")
  return value
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input)
}
