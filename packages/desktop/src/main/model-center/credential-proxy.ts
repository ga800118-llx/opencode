import { randomBytes, timingSafeEqual } from "node:crypto"
import {
  createServer,
  type IncomingHttpHeaders,
  type OutgoingHttpHeaders,
  type Server,
  type ServerResponse,
} from "node:http"
import { request as requestHTTP } from "node:http"
import { request as requestHTTPS } from "node:https"
import type { ProductProviderProfile } from "@opencode-ai/app/product/model-center"
import { sanitizeProviderProfile } from "@opencode-ai/app/product/model-center"
import type { ProductCredentialService } from "./credentials"
import type { ProfileRepository } from "./profiles"

type ProxyPortStore = {
  readonly get: (key: string) => unknown
  readonly set: (key: string, value: unknown) => void
}

type SensitiveHeaderCredentialProxyOptions = {
  readonly profiles: ProfileRepository
  readonly credentials: ProductCredentialService
  readonly store: ProxyPortStore
  readonly token?: () => string
  readonly warn?: (message: string, meta: Readonly<Record<string, unknown>>) => void
}

const PORT_KEY = "credentialProxyPort"
const ROUTE = "/model-profile/"
const HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
])

export function createSensitiveHeaderCredentialProxy(options: SensitiveHeaderCredentialProxyOptions) {
  const tokens = new Map<string, string>()
  const activeRequests = new Set<AbortController>()
  let server: Server | undefined
  let port: number | undefined

  const needsProxy = (profile: ProductProviderProfile) =>
    profile.hasApiKey || profile.headers.some((header) => header.sensitive && header.hasValue)

  const runtimeCredential = (profile: ProductProviderProfile): string | undefined => {
    if (!needsProxy(profile) || port === undefined) return undefined
    const existing = tokens.get(profile.id)
    if (existing) return existing
    const token = options.token?.() ?? randomBytes(32).toString("base64url")
    tokens.set(profile.id, token)
    return token
  }

  const presentProfile = (profile: ProductProviderProfile) => {
    if (!needsProxy(profile) || port === undefined) return profile
    return sanitizeProviderProfile({
      ...profile,
      runtime: { baseURL: runtimeBaseURL(profile, port), credentialProxy: true },
    })
  }

  const runtimeEnvironment = (profile: ProductProviderProfile) => {
    const credential = runtimeCredential(profile)
    if (!credential || port === undefined) return undefined
    return Object.freeze({ credential, baseURL: runtimeBaseURL(profile, port) })
  }

  const start = async () => {
    if (server) return
    const requested = storedPort(options.store.get(PORT_KEY))
    const listener = createServer((request, response) => {
      void forward(request, response, options, tokens, activeRequests)
    })
    try {
      port = await listen(listener, requested)
    } catch (error) {
      if (!requested) throw error
      options.warn?.("saved model credential proxy port unavailable", { port: requested })
      port = await listen(listener, undefined)
    }
    server = listener
    options.store.set(PORT_KEY, port)
  }

  const stop = async () => {
    const listener = server
    server = undefined
    port = undefined
    tokens.clear()
    if (!listener) return
    ;[...activeRequests].forEach(abortUpstream)
    await new Promise<void>((resolve) => listener.close(() => resolve()))
  }

  return Object.freeze({ start, stop, presentProfile, runtimeCredential, runtimeEnvironment, port: () => port })
}

async function forward(
  request: import("node:http").IncomingMessage,
  response: ServerResponse,
  options: SensitiveHeaderCredentialProxyOptions,
  tokens: ReadonlyMap<string, string>,
  active: Set<AbortController>,
) {
  const route = parseRoute(request.url)
  if (!route) return fixed(response, 404, "Model route not found.")
  const profile = options.profiles.get(route.profileID)
  const token = tokens.get(route.profileID)
  if (!profile || !token || !authorized(request.headers.authorization, token)) {
    return fixed(response, 401, "Model route authorization failed.")
  }
  const reference = profile.credentialRef
  if (!reference) return fixed(response, 503, "Model credentials are unavailable.")

  let envelope
  try {
    envelope = options.credentials.read(reference)
  } catch {
    return fixed(response, 503, "Model credentials are unavailable.")
  }
  if (!envelope) return fixed(response, 503, "Model credentials are unavailable.")

  const target = new URL(profile.baseURL)
  target.pathname = route.upstreamPath
  target.search = route.search
  const headers = outboundHeaders(request.headers)
  if (envelope.apiKey) headers.authorization = `Bearer ${envelope.apiKey}`
  else delete headers.authorization
  const secrets = new Map(Object.entries(envelope.headers ?? {}).map(([name, value]) => [name.toLowerCase(), value]))
  for (const header of profile.headers) {
    if (!header.sensitive || !header.hasValue) continue
    const value = secrets.get(header.name.toLowerCase())
    if (value) headers[header.name] = value
  }

  const send = target.protocol === "https:" ? requestHTTPS : requestHTTP
  const controller = new AbortController()
  const socket = request.socket
  let result: import("node:http").IncomingMessage | undefined
  let upstream: import("node:http").ClientRequest | undefined
  let cleaned = false
  const abort = () => abortUpstream(controller)
  const onDownstreamClose = () => {
    if (!response.writableFinished) return abort()
    cleanup()
  }
  const onUpstreamError = () => {
    if (!response.destroyed) {
      if (controller.signal.aborted || response.headersSent) response.destroy()
      else fixed(response, 502, "Model service unavailable.")
    }
    cleanup()
  }
  const onUpstreamClose = () => {
    if (!result?.complete) onUpstreamError()
  }
  const cleanup = () => {
    if (cleaned) return
    cleaned = true
    request.off("aborted", abort)
    response.off("close", onDownstreamClose)
    response.off("finish", cleanup)
    socket.off("end", onDownstreamClose)
    socket.off("close", onDownstreamClose)
    upstream?.off("error", onUpstreamError)
    result?.off("error", onUpstreamError)
    result?.off("close", onUpstreamClose)
    active.delete(controller)
  }
  upstream = send(target, { method: request.method, headers, signal: controller.signal }, (incoming) => {
    result = incoming
    incoming.once("error", onUpstreamError)
    incoming.once("close", onUpstreamClose)
    response.writeHead(incoming.statusCode ?? 502, responseHeaders(incoming.headers))
    incoming.pipe(response)
  })
  active.add(controller)
  request.once("aborted", abort)
  request.once("error", abort)
  response.once("close", onDownstreamClose)
  response.once("error", abort)
  response.once("finish", cleanup)
  socket.once("end", onDownstreamClose)
  socket.once("close", onDownstreamClose)
  socket.once("error", abort)
  upstream.once("error", onUpstreamError)
  request.pipe(upstream)
}

function abortUpstream(controller: AbortController) {
  if (controller.signal.aborted) return
  controller.abort()
}

function parseRoute(
  input: string | undefined,
): { profileID: string; upstreamPath: string; search: string } | undefined {
  if (!input) return undefined
  const url = new URL(input, "http://127.0.0.1")
  if (!url.pathname.startsWith(ROUTE)) return undefined
  const rest = url.pathname.slice(ROUTE.length)
  const slash = rest.indexOf("/")
  if (slash <= 0) return undefined
  try {
    return {
      profileID: decodeURIComponent(rest.slice(0, slash)),
      upstreamPath: rest.slice(slash),
      search: url.search,
    }
  } catch {
    return undefined
  }
}

function outboundHeaders(input: IncomingHttpHeaders): OutgoingHttpHeaders {
  const result: OutgoingHttpHeaders = {}
  for (const [name, value] of Object.entries(input)) {
    if (value === undefined || name === "host" || HOP_HEADERS.has(name)) continue
    result[name] = value
  }
  return result
}

function responseHeaders(input: IncomingHttpHeaders): OutgoingHttpHeaders {
  const result: OutgoingHttpHeaders = {}
  for (const [name, value] of Object.entries(input)) {
    if (value === undefined || HOP_HEADERS.has(name)) continue
    result[name] = value
  }
  return result
}

function authorized(input: string | undefined, token: string) {
  if (!input?.startsWith("Bearer ")) return false
  const received = Buffer.from(input.slice(7))
  const expected = Buffer.from(token)
  return received.length === expected.length && timingSafeEqual(received, expected)
}

function fixed(response: ServerResponse, status: number, message: string) {
  response.writeHead(status, { "content-type": "application/json" })
  response.end(JSON.stringify({ error: { message } }))
}

function storedPort(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= 65_535 ? value : undefined
}

function listen(server: Server, requested: number | undefined) {
  return new Promise<number>((resolve, reject) => {
    const onError = (error: Error) => reject(error)
    server.once("error", onError)
    server.listen(requested ?? 0, "127.0.0.1", () => {
      server.off("error", onError)
      const address = server.address()
      if (!address || typeof address === "string") return reject(new Error("Model proxy address is unavailable."))
      resolve(address.port)
    })
  })
}

function origin(port: number) {
  return `http://127.0.0.1:${port}`
}

function runtimeBaseURL(profile: ProductProviderProfile, port: number) {
  const source = new URL(profile.baseURL)
  let path = source.pathname.replace(/\/$/, "")
  if (profile.kind === "ollama" && !path.endsWith("/v1")) path = `${path}/v1`
  return `${origin(port)}${ROUTE}${encodeURIComponent(profile.id)}${path || "/"}`
}
