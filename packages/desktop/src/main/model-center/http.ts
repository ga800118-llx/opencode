export type ModelProbeFetch = (input: string | URL, init?: RequestInit) => Promise<Response>

export class ModelProbeHttpError extends Error {
  readonly code: string
  readonly status?: number

  constructor(code: string, status?: number) {
    super(safeMessage(code))
    this.name = "ModelProbeHttpError"
    this.code = code
    this.status = status
  }
}

type RequestOptions = {
  readonly fetch: ModelProbeFetch
  readonly url: URL
  readonly headers: Headers
  readonly timeoutMs: number
  readonly body?: unknown
  readonly notFoundCode?: "INCOMPATIBLE_API" | "MODEL_NOT_FOUND"
}

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024
const MAX_REDIRECTS = 3

export async function requestJSON(options: RequestOptions): Promise<unknown> {
  const response = await request(options)
  const text = await boundedText(response)
  try {
    return JSON.parse(text)
  } catch {
    throw new ModelProbeHttpError("INCOMPATIBLE_API", response.status)
  }
}

export async function requestSSE(options: RequestOptions): Promise<unknown> {
  const response = await request(options)
  if (!response.body || !response.headers.get("content-type")?.toLowerCase().includes("text/event-stream")) {
    throw new ModelProbeHttpError("SSE_ERROR", response.status)
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let text = ""
  let size = 0
  try {
    while (true) {
      const part = await reader.read()
      if (part.done) break
      size += part.value.byteLength
      if (size > MAX_RESPONSE_BYTES) throw new ModelProbeHttpError("SSE_ERROR", response.status)
      text += decoder.decode(part.value, { stream: true })
      const match = /(?:^|\n)data:\s*([^\r\n]+)/.exec(text)
      if (!match) continue
      const data = match[1]?.trim()
      if (!data || data === "[DONE]") continue
      try {
        return JSON.parse(data)
      } catch {
        throw new ModelProbeHttpError("SSE_ERROR", response.status)
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined)
  }
  throw new ModelProbeHttpError("SSE_ERROR", response.status)
}

async function request(options: RequestOptions) {
  let url = options.url
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    const headers = new Headers(options.headers)
    if (options.body !== undefined) headers.set("content-type", "application/json")
    const response = await options.fetch(url, {
      method: options.body === undefined ? "GET" : "POST",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      redirect: "manual",
      signal: AbortSignal.timeout(options.timeoutMs),
    })
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location")
      if (!location || redirect === MAX_REDIRECTS) throw new ModelProbeHttpError("INCOMPATIBLE_API", response.status)
      url = new URL(location, url)
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new ModelProbeHttpError("INCOMPATIBLE_API", response.status)
      }
      continue
    }
    if (!response.ok) throw statusError(response.status, options.notFoundCode)
    return response
  }
  throw new ModelProbeHttpError("INCOMPATIBLE_API")
}

async function boundedText(response: Response) {
  const length = Number(response.headers.get("content-length"))
  if (Number.isFinite(length) && length > MAX_RESPONSE_BYTES) {
    throw new ModelProbeHttpError("INCOMPATIBLE_API", response.status)
  }
  const buffer = await response.arrayBuffer()
  if (buffer.byteLength > MAX_RESPONSE_BYTES) throw new ModelProbeHttpError("INCOMPATIBLE_API", response.status)
  return new TextDecoder().decode(buffer)
}

function statusError(
  status: number,
  notFoundCode: "INCOMPATIBLE_API" | "MODEL_NOT_FOUND" = "INCOMPATIBLE_API",
) {
  if (status === 401 || status === 403) return new ModelProbeHttpError("AUTHENTICATION_ERROR", status)
  if (status === 404) return new ModelProbeHttpError(notFoundCode, status)
  if (status === 405) return new ModelProbeHttpError("INCOMPATIBLE_API", status)
  return new ModelProbeHttpError("PROVIDER_REQUEST_FAILED", status)
}

function safeMessage(code: string) {
  if (code === "AUTHENTICATION_ERROR") return "The model service rejected the credentials."
  if (code === "MODEL_NOT_FOUND") return "The selected model is unavailable."
  if (code === "SSE_ERROR") return "The model response stream is incompatible."
  if (code === "TOOL_CALL_ERROR") return "The model did not produce the required tool call."
  if (code === "INCOMPATIBLE_API") return "The model endpoint returned an incompatible response."
  return "The model endpoint request failed."
}
