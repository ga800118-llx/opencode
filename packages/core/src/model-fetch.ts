import type { Dispatcher } from "undici"

type ModelRequestInit = RequestInit & {
  dispatcher?: Dispatcher
  timeout?: false
}
type FetchCall = (input: Parameters<typeof globalThis.fetch>[0], init?: RequestInit) => Promise<Response>

const dispatchers = new WeakMap<Dispatcher, Dispatcher>()
let nodeFetch: typeof globalThis.fetch | undefined
let nodeDispatcher: { readonly key: string; readonly value: Promise<Dispatcher> } | undefined

export function createModelDispatcher(dispatcher: Dispatcher) {
  const existing = dispatchers.get(dispatcher)
  if (existing) return existing

  const composed = dispatcher.compose(
    (dispatch) => (options, handler) =>
      dispatch(
        {
          ...options,
          headersTimeout: 0,
          bodyTimeout: 0,
        },
        handler,
      ),
  )
  const result = new Proxy(composed, {
    get(target, property) {
      if (property === "dispatch") {
        return (options: Dispatcher.DispatchOptions, handler: Dispatcher.DispatchHandler) => {
          if (typeof handler.onRequestStart === "function") return target.dispatch(options, handler)
          return target.dispatch({ ...options, allowH2: false } as Dispatcher.DispatchOptions, compatibleHandler(handler))
        }
      }
      const value: unknown = Reflect.get(target, property, target)
      return typeof value === "function" ? value.bind(target) : value
    },
  })
  dispatchers.set(dispatcher, result)
  return result
}

export function createModelFetch(fetchFn?: FetchCall, dispatcher?: Dispatcher): typeof globalThis.fetch {
  if (fetchFn && fetchFn !== globalThis.fetch) {
    return withPreconnect(async (input, init) => {
      if (typeof Bun !== "undefined") return fetchFn(input, { ...init, timeout: false } as ModelRequestInit)
      const request = normalizeRequest(input, init)
      const requested = dispatcher ?? (await nodeModelDispatcher())
      return fetchFn(request.input, {
        ...request.init,
        dispatcher: createModelDispatcher(requested),
      } as ModelRequestInit)
    }, fetchFn)
  }

  return withPreconnect(async (input, init) => {
    if (typeof Bun !== "undefined") return globalThis.fetch(input, { ...init, timeout: false } as ModelRequestInit)
    return nodeModelFetch()(input, dispatcher ? ({ ...init, dispatcher } as ModelRequestInit) : init)
  }, globalThis.fetch)
}

function nodeModelFetch() {
  if (nodeFetch) return nodeFetch
  nodeFetch = withPreconnect(async (input, init) => {
    const requested = (init as ModelRequestInit | undefined)?.dispatcher
    const request = normalizeRequest(input, init)
    return globalThis.fetch(request.input, {
      ...request.init,
      dispatcher: requested ? createModelDispatcher(requested) : createModelDispatcher(await nodeModelDispatcher()),
    } as ModelRequestInit)
  }, globalThis.fetch)
  return nodeFetch
}

function nodeModelDispatcher() {
  const proxy = normalizeProxy(process.env.ALL_PROXY ?? process.env.all_proxy)
  const options = {
    httpProxy: normalizeProxy(process.env.HTTP_PROXY ?? process.env.http_proxy) ?? proxy,
    httpsProxy: normalizeProxy(process.env.HTTPS_PROXY ?? process.env.https_proxy) ?? proxy,
    noProxy: process.env.NO_PROXY ?? process.env.no_proxy,
  }
  const key = JSON.stringify(options)
  if (nodeDispatcher?.key === key) return nodeDispatcher.value

  const value = import("undici").then(({ EnvHttpProxyAgent }) => new EnvHttpProxyAgent(options))
  nodeDispatcher = { key, value }
  return value.catch((error) => {
    if (nodeDispatcher?.key === key) nodeDispatcher = undefined
    throw error
  })
}

function normalizeProxy(value: string | undefined) {
  if (!value) return value
  if (value.startsWith("socks5h://")) return `socks5://${value.slice("socks5h://".length)}`
  return value
}

type LegacyDispatchHandler = {
  onConnect?: (abort: (reason: Error) => void, context: unknown) => void
  onUpgrade?: (statusCode: number, headers: string[], socket: unknown) => void
  onHeaders?: (statusCode: number, headers: string[], resume: () => void, statusMessage?: string) => boolean | void
  onData?: (chunk: Uint8Array) => boolean | void
  onComplete?: (trailers: string[]) => void
  onError?: (error: Error) => void
  onBodySent?: (chunk: Uint8Array) => void
  onRequestSent?: () => void
  onResponseStarted?: () => void
}

function compatibleHandler(handler: Dispatcher.DispatchHandler) {
  if (typeof handler.onRequestStart === "function") return handler
  const legacy = handler as unknown as LegacyDispatchHandler
  return {
    onRequestStart(controller: Dispatcher.DispatchController, context: unknown) {
      legacy.onConnect?.((reason) => controller.abort(reason), context)
    },
    onRequestUpgrade(
      controller: Dispatcher.DispatchController,
      statusCode: number,
      headers: Record<string, string | string[] | undefined>,
      socket: unknown,
    ) {
      legacy.onUpgrade?.(statusCode, rawHeaders(controller.rawHeaders, headers), socket)
    },
    onResponseStart(
      controller: Dispatcher.DispatchController,
      statusCode: number,
      headers: Record<string, string | string[] | undefined>,
      statusMessage?: string,
    ) {
      if (legacy.onHeaders?.(statusCode, rawHeaders(controller.rawHeaders, headers), () => controller.resume(), statusMessage) === false) {
        controller.pause()
      }
    },
    onResponseData(controller: Dispatcher.DispatchController, chunk: Uint8Array) {
      if (legacy.onData?.(chunk) === false) controller.pause()
    },
    onResponseEnd(
      controller: Dispatcher.DispatchController,
      trailers: Record<string, string | string[] | undefined>,
    ) {
      legacy.onComplete?.(rawHeaders(controller.rawTrailers, trailers))
    },
    onResponseError(_controller: Dispatcher.DispatchController, error: Error) {
      if (legacy.onError) {
        legacy.onError(error)
        return
      }
      throw error
    },
    onBodySent(chunk: Uint8Array) {
      legacy.onBodySent?.(chunk)
    },
    onRequestSent() {
      legacy.onRequestSent?.()
    },
    onResponseStarted() {
      legacy.onResponseStarted?.()
    },
  } satisfies Dispatcher.DispatchHandler
}

function rawHeaders(
  raw: string[] | Uint8Array[] | Record<string, string | string[] | undefined> | null | undefined,
  headers: Record<string, string | string[] | undefined>,
) {
  if (Array.isArray(raw)) return raw.map(String)
  const source = raw ?? headers
  return Object.entries(source).flatMap(([name, value]) =>
    Array.isArray(value) ? value.flatMap((item) => [name, item]) : value === undefined ? [] : [name, value],
  )
}

function normalizeRequest(input: Parameters<typeof globalThis.fetch>[0], init?: RequestInit) {
  if (!isRequest(input)) return { input, init }
  if (input.bodyUsed) throw new TypeError("Cannot reuse a consumed Request body")

  const method = init?.method ?? input.method
  const body = method === "GET" || method === "HEAD" ? undefined : init?.body !== undefined ? init.body : input.body
  return {
    input: input.url,
    init: {
      cache: input.cache,
      credentials: input.credentials,
      integrity: input.integrity,
      keepalive: input.keepalive,
      mode: input.mode,
      redirect: input.redirect,
      referrer: input.referrer,
      referrerPolicy: input.referrerPolicy,
      ...init,
      method,
      headers: init?.headers ?? input.headers,
      body,
      signal: init?.signal !== undefined ? init.signal : input.signal,
      ...(body ? { duplex: "half" as const } : {}),
    },
  }
}

function isRequest(input: Parameters<typeof globalThis.fetch>[0]): input is Request {
  return (
    typeof input === "object" &&
    input !== null &&
    "url" in input &&
    typeof input.url === "string" &&
    "method" in input &&
    typeof input.method === "string" &&
    "headers" in input
  )
}

function withPreconnect(fetchFn: FetchCall, upstream: FetchCall): typeof globalThis.fetch {
  const preconnect = (upstream as typeof globalThis.fetch).preconnect
  return Object.assign(fetchFn, {
    preconnect(...args: Parameters<typeof globalThis.fetch.preconnect>) {
      preconnect?.(...args)
    },
  })
}
