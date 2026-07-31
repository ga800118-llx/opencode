import { describe, expect, test } from "bun:test"
import { normalizeProductError, type ProductErrorKind } from "./errors"

describe("normalizeProductError", () => {
  test.each([
    { name: "unreachable endpoint", input: { cause: { code: "ECONNREFUSED" } }, kind: "unreachable-endpoint" },
    { name: "authentication", input: { data: { status: 401 } }, kind: "authentication" },
    {
      name: "incompatible API",
      input: { status: 404, message: "Unsupported API route" },
      kind: "incompatible-api",
    },
    {
      name: "missing model",
      input: { data: { code: "MODEL_NOT_FOUND", message: "The requested model does not exist" } },
      kind: "missing-model",
    },
    {
      name: "streaming",
      input: { code: "SSE_ERROR", message: "Response stream closed" },
      kind: "streaming",
    },
    { name: "tool calling", input: { data: { code: "TOOL_CALL_ERROR" } }, kind: "tool-calling" },
    { name: "timeout", input: { cause: { code: "ETIMEDOUT" } }, kind: "timeout" },
    { name: "TLS", input: { code: "CERT_HAS_EXPIRED" }, kind: "tls" },
    { name: "server crash", input: { cause: { code: "SERVER_PROCESS_EXITED" } }, kind: "server-crash" },
    { name: "aborted", input: { name: "AbortError" }, kind: "aborted" },
    { name: "unknown", input: { message: "Something completely unexpected happened" }, kind: "unknown" },
  ] satisfies readonly { name: string; input: unknown; kind: ProductErrorKind }[])(
    "normalizes $name failures",
    ({ input, kind }) => {
      const result = normalizeProductError(input)

      expect(result.kind).toBe(kind)
      expect(result.message.length).toBeGreaterThan(0)
      expect(result.action.length).toBeGreaterThan(0)
    },
  )

  test("collects only allow-listed safe diagnostics from nested errors", () => {
    const result = normalizeProductError({
      cause: {
        name: "APIError",
        data: {
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
    "contains whitespace",
    "contains/slash",
    "https://service.test/request/123",
    "sk-example-secret",
    "token_value",
    "x".repeat(65),
  ])("rejects unsafe request IDs: %s", (requestID) => {
    expect(normalizeProductError({ requestID }).diagnostic?.requestID).toBeUndefined()
  })

  test("never copies secrets, URL userinfo, prompts, source code, or raw messages", () => {
    const result = normalizeProductError({
      name: "Error",
      code: "UNKNOWN_FAILURE",
      status: 500,
      requestID: "request-safe_123",
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
