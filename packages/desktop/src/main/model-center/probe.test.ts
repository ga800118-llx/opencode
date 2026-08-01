import { describe, expect, test } from "bun:test"
import { createModelProbe, type ModelProbeTarget } from "./probe"
import { startMockModelServer, type MockModelServerMode } from "./mock-openai-server.fixture.test"

function target(baseURL: string, kind: ModelProbeTarget["kind"] = "openai-compatible"): ModelProbeTarget {
  return {
    kind,
    baseURL,
    apiKey: "fixture-secret",
    headers: { "X-Private-Token": "fixture-private-header" },
    timeoutMs: 2_000,
  }
}

async function withServer<T>(mode: MockModelServerMode, run: (baseURL: string, ollamaURL: string) => Promise<T>) {
  const server = startMockModelServer(mode)
  try {
    return await run(server.baseURL, server.ollamaURL)
  } finally {
    server.stop()
  }
}

describe("createModelProbe discovery", () => {
  test("discovers OpenAI-compatible models with safe display names", async () => {
    await withServer("agent", async (baseURL) => {
      const result = await createModelProbe({ requestID: () => "req-models" }).discover(target(baseURL))
      expect(result).toEqual({
        requestID: "req-models",
        models: [
          { id: "coder", name: "coder", source: "discovered" },
          { id: "reasoner", name: "Reasoner", source: "discovered" },
        ],
      })
    })
  })

  test("discovers Ollama tags through its native endpoint", async () => {
    await withServer("ollama", async (_baseURL, ollamaURL) => {
      const result = await createModelProbe({ requestID: () => "req-ollama" }).discover(
        target(ollamaURL, "ollama"),
      )
      expect(result.models).toEqual([
        { id: "qwen2.5-coder:7b", name: "qwen2.5-coder:7b", source: "discovered" },
        { id: "deepseek-coder:latest", name: "deepseek-coder:latest", source: "discovered" },
      ])
    })
  })

  test("maps authentication and malformed APIs without copying raw bodies", async () => {
    await withServer("agent", async (baseURL) => {
      const result = await createModelProbe({ requestID: () => "req-auth" }).discover({
        ...target(baseURL),
        apiKey: "wrong-secret",
      })
      expect(result.models).toEqual([])
      expect(result.diagnostic).toMatchObject({ kind: "authentication", requestID: "req-auth", status: 401 })
      expect(JSON.stringify(result)).not.toContain("wrong-secret")
      expect(JSON.stringify(result)).not.toContain("raw credential rejection")
    })

    await withServer("malformed-models", async (baseURL) => {
      const result = await createModelProbe({ requestID: () => "req-json" }).discover(target(baseURL))
      expect(result.diagnostic).toMatchObject({ kind: "incompatible-api", requestID: "req-json" })
      expect(JSON.stringify(result)).not.toContain("not-json")
    })
  })

  test("maps unreachable, TLS, and timeout failures", async () => {
    for (const item of [
      { error: Object.assign(new Error("private host"), { code: "ECONNREFUSED" }), kind: "unreachable-endpoint" },
      { error: Object.assign(new Error("private cert"), { code: "CERT_HAS_EXPIRED" }), kind: "tls" },
      { error: Object.assign(new Error("private timeout"), { name: "TimeoutError" }), kind: "timeout" },
    ] as const) {
      const probe = createModelProbe({
        requestID: () => `req-${item.kind}`,
        fetch: async () => Promise.reject(item.error),
      })
      const result = await probe.discover(target("https://private.example.test/v1"))
      expect(result.diagnostic?.kind).toBe(item.kind)
      expect(JSON.stringify(result)).not.toContain(item.error.message)
    }

    await withServer("delayed", async (baseURL) => {
      const result = await createModelProbe({ requestID: () => "req-real-timeout" }).discover({
        ...target(baseURL),
        timeoutMs: 5,
      })
      expect(result.diagnostic?.kind).toBe("timeout")
    })
  })
})

describe("createModelProbe capability classification", () => {
  test.each([
    { mode: "agent", classification: "agent-capable", streaming: true, toolCalling: true },
    { mode: "partial", classification: "partially-compatible", streaming: true, toolCalling: false },
    { mode: "chat-only", classification: "chat-only", streaming: false, toolCalling: false },
    { mode: "incompatible", classification: "incompatible", streaming: false, toolCalling: false },
  ] as const)("classifies $mode endpoints", async ({ mode, classification, streaming, toolCalling }) => {
    await withServer(mode, async (baseURL) => {
      const result = await createModelProbe({ now: () => 123, requestID: () => `req-${mode}` }).test({
        target: target(baseURL),
        modelID: "coder",
      })
      expect(result).toMatchObject({
        modelID: "coder",
        classification,
        checks: { basicChat: mode !== "incompatible", streaming, toolCalling },
        testedAt: 123,
        requestID: `req-${mode}`,
      })
    })
  })

  test("classifies a missing model and redacts the provider response", async () => {
    await withServer("agent", async (baseURL) => {
      const result = await createModelProbe({ requestID: () => "req-missing" }).test({
        target: target(baseURL),
        modelID: "missing",
      })
      expect(result.classification).toBe("incompatible")
      expect(result.diagnostic).toMatchObject({ kind: "missing-model", status: 404 })
      expect(JSON.stringify(result)).not.toContain("raw missing detail")
    })
  })
})
