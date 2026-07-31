import { describe, expect, test } from "bun:test"
import { normalizeProductError, type ProductErrorDiagnostic, type ProductErrorKind } from "./errors"

const expectations = {
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
} satisfies Readonly<Record<ProductErrorKind, { message: string; action: string; retryable: boolean }>>

describe("normalizeProductError", () => {
  test.each([
    {
      name: "unreachable endpoint",
      input: { cause: { code: "ECONNREFUSED" } },
      kind: "unreachable-endpoint",
      diagnostic: { code: "ECONNREFUSED" },
    },
    {
      name: "authentication",
      input: { cause: { body: { status: 401 } } },
      kind: "authentication",
      diagnostic: { status: 401 },
    },
    {
      name: "incompatible API",
      input: { status: 404, message: "Unsupported API route" },
      kind: "incompatible-api",
      diagnostic: { status: 404 },
    },
    {
      name: "missing model",
      input: { cause: { body: { status: 404, code: "MODEL_NOT_FOUND" } } },
      kind: "missing-model",
      diagnostic: { code: "MODEL_NOT_FOUND", status: 404 },
    },
    {
      name: "streaming",
      input: { code: "SSE_ERROR", message: "Response stream closed" },
      kind: "streaming",
      diagnostic: { code: "SSE_ERROR" },
    },
    {
      name: "tool calling",
      input: { data: { code: "TOOL_CALL_ERROR" } },
      kind: "tool-calling",
      diagnostic: { code: "TOOL_CALL_ERROR" },
    },
    {
      name: "timeout",
      input: { cause: { code: "ETIMEDOUT" } },
      kind: "timeout",
      diagnostic: { code: "ETIMEDOUT" },
    },
    {
      name: "TLS",
      input: { code: "CERT_HAS_EXPIRED" },
      kind: "tls",
      diagnostic: { code: "CERT_HAS_EXPIRED" },
    },
    {
      name: "server crash",
      input: { error: { code: "SERVER_PROCESS_EXITED" } },
      kind: "server-crash",
      diagnostic: { code: "SERVER_PROCESS_EXITED" },
    },
    { name: "aborted", input: { name: "AbortError" }, kind: "aborted", diagnostic: { name: "AbortError" } },
    {
      name: "unknown",
      input: { message: "Something completely unexpected happened" },
      kind: "unknown",
      diagnostic: undefined,
    },
  ] satisfies readonly {
    name: string
    input: unknown
    kind: ProductErrorKind
    diagnostic?: ProductErrorDiagnostic
  }[])(
    "normalizes $name failures",
    ({ input, kind, diagnostic }) => {
      expect(normalizeProductError(input)).toEqual({
        kind,
        ...expectations[kind],
        ...(diagnostic ? { diagnostic } : {}),
      })
    },
  )

  test.each([
    { name: "status-only 404", input: { status: 404 }, kind: "unknown", diagnostic: { status: 404 } },
    {
      name: "provider 503",
      input: { status: 503, message: "Provider overloaded" },
      kind: "unknown",
      diagnostic: { status: 503 },
    },
    {
      name: "method not allowed",
      input: { status: 405 },
      kind: "incompatible-api",
      diagnostic: { status: 405 },
    },
    {
      name: "connection reset",
      input: { code: "ECONNRESET" },
      kind: "unreachable-endpoint",
      diagnostic: { code: "ECONNRESET" },
    },
    {
      name: "socket hang up",
      input: { message: "socket hang up" },
      kind: "unreachable-endpoint",
      diagnostic: undefined,
    },
    {
      name: "stream reset",
      input: { code: "ECONNRESET", message: "stream failed" },
      kind: "streaming",
      diagnostic: { code: "ECONNRESET" },
    },
  ] satisfies readonly {
    name: string
    input: unknown
    kind: ProductErrorKind
    diagnostic?: ProductErrorDiagnostic
  }[])(
    "keeps $name classification narrow",
    ({ input, kind, diagnostic }) => {
      expect(normalizeProductError(input)).toEqual({
        kind,
        ...expectations[kind],
        ...(diagnostic ? { diagnostic } : {}),
      })
    },
  )

  test("collects only allow-listed safe diagnostics from nested errors", () => {
    const result = normalizeProductError({
      cause: {
        body: {
          name: "APIError",
          code: "MODEL_NOT_FOUND",
          status: 404,
          requestID: "req_7F-2",
          message: "private raw detail",
          responseBody: "private response body",
        },
      },
    })

    expect(result.diagnostic).toEqual({
      name: "APIError",
      code: "MODEL_NOT_FOUND",
      status: 404,
      requestID: "req_7F-2",
    })
    expect(Object.keys(result.diagnostic ?? {})).toEqual(["name", "code", "status", "requestID"])
  })

  test.each([
    {
      name: "responseHeaders",
      input: { error: { responseHeaders: { "X-Request-ID": "request_header-1", authorization: "private" } } },
      requestID: "request_header-1",
    },
    {
      name: "headers",
      input: { response: { headers: { "request-id": "trace_header-2", cookie: "private" } } },
      requestID: "trace_header-2",
    },
  ])("reads a safe request ID from $name", ({ input, requestID }) => {
    expect(normalizeProductError(input).diagnostic).toEqual({ requestID })
  })

  test("accepts a UUID request ID", () => {
    const requestID = "123e4567-e89b-12d3-a456-426614174000"
    expect(normalizeProductError({ requestID }).diagnostic).toEqual({ requestID })
  })

  test.each([
    "contains whitespace",
    "contains/slash",
    "https://service.test/request/123",
    "sk-example-secret",
    "ghp_0123456789abcdefghijklmnopqrstuvwxyz",
    "xoxb-0123456789-secret",
    "AIzaSy0123456789abcdefghijklmnopqrstuvwxyz",
    "req_sk-example-secret",
    "token_value",
    "x".repeat(65),
  ])("rejects unsafe request IDs: %s", (requestID) => {
    expect(normalizeProductError({ requestID }).diagnostic?.requestID).toBeUndefined()
  })

  test("handles cyclic and oversized errors without copying their content", () => {
    const input: { message: string; cause?: unknown; data?: unknown } = { message: "x".repeat(100_000) }
    input.cause = input
    input.data = { cause: { code: "ETIMEDOUT" } }
    const result = normalizeProductError(input)

    expect(result.kind).toBe("timeout")
    expect(JSON.stringify(result).length).toBeLessThan(1_000)
  })

  test("never copies secrets, URL userinfo, prompts, source code, or raw messages", () => {
    const result = normalizeProductError({
      name: "Error",
      code: "UNKNOWN_FAILURE",
      status: 500,
      requestID: "request_safe-123",
      message:
        "Authorization: Bearer bearer-secret; Basic basic-secret; sk-example-secret; apiKey=key-secret; token=token-secret; https://user:pass@example.test; prompt=private prompt; sourceCode=const privateValue = 1",
      data: {
        prompt: "private prompt",
        sourceCode: "const privateValue = 1",
      },
    })
    const output = JSON.stringify(result)

    for (const secret of [
      "bearer-secret",
      "basic-secret",
      "sk-example-secret",
      "key-secret",
      "token-secret",
      "user:pass",
      "private prompt",
      "const privateValue = 1",
      "UNKNOWN_FAILURE",
    ]) {
      expect(output).not.toContain(secret)
    }
  })

  test("returns a runtime-immutable plain object", () => {
    const result = normalizeProductError({
      name: "APIError",
      data: { code: "MODEL_NOT_FOUND", requestID: "req_123" },
    })
    const mutable = result as unknown as {
      action: string
      diagnostic: { requestID: string }
    }

    expect(result).not.toBeInstanceOf(Error)
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.diagnostic)).toBe(true)
    expect(() => {
      mutable.action = "changed"
    }).toThrow()
    expect(() => {
      mutable.diagnostic.requestID = "changed"
    }).toThrow()
  })
})
