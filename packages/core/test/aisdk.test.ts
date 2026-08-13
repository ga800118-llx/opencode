import { describe, expect } from "bun:test"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { AISDK } from "@opencode-ai/core/aisdk"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { Effect } from "effect"
import { testEffect } from "./lib/effect"

const it = testEffect(AISDK.locationLayer)

describe("AISDK", () => {
  it.live("ignores legacy model timeouts across delayed headers and streamed chunks", () =>
    Effect.gen(function* () {
      const aisdk = yield* AISDK.Service
      const encoder = new TextEncoder()
      let observed: (RequestInit & { timeout?: boolean }) | undefined
      let observedOptions: Record<string, unknown> | undefined

      yield* aisdk.hook.sdk((event) => {
        observedOptions = event.options
        event.sdk = createOpenAICompatible(event.options as unknown as Parameters<typeof createOpenAICompatible>[0])
      })

      const model = ModelV2.Info.make({
        ...ModelV2.Info.empty(ProviderV2.ID.make("test"), ModelV2.ID.make("model")),
        api: {
          id: ModelV2.ID.make("model"),
          type: "aisdk",
          package: "@ai-sdk/openai-compatible",
          url: "https://models.example.test/v1",
          settings: {
            timeout: 10,
            timeoutMs: 40,
            headerTimeout: 20,
            chunkTimeout: 30,
            apiKey: "test-key",
            fetch: async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
              observed = init
              await Bun.sleep(75)
              if (init?.signal?.aborted) throw init.signal.reason
              return new Response(
                new ReadableStream<Uint8Array>({
                  async start(controller) {
                    controller.enqueue(
                      encoder.encode(
                        'data: {"id":"chatcmpl-test","object":"chat.completion.chunk","created":1,"model":"model","choices":[{"index":0,"delta":{"role":"assistant","content":"first"},"finish_reason":null}]}\n\n',
                      ),
                    )
                    await Bun.sleep(75)
                    controller.enqueue(
                      encoder.encode(
                        'data: {"id":"chatcmpl-test","object":"chat.completion.chunk","created":1,"model":"model","choices":[{"index":0,"delta":{"content":"-last"},"finish_reason":null}]}\n\ndata: {"id":"chatcmpl-test","object":"chat.completion.chunk","created":1,"model":"model","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
                      ),
                    )
                    controller.close()
                  },
                }),
                { headers: { "content-type": "text/event-stream" } },
              )
            },
          },
        },
        request: {
          headers: {},
          body: { timeout: 1, headerTimeout: 2, chunkTimeout: 3, timeoutMs: 4 },
        },
      })

      const language = yield* aisdk.language(model)
      const result = yield* Effect.promise(() =>
        language.doStream({ prompt: [{ role: "user", content: [{ type: "text", text: "hello" }] }] }),
      )
      const output = yield* Effect.promise(async () => {
        const chunks: string[] = []
        for await (const event of result.stream) {
          if (event.type === "text-delta") chunks.push(event.delta)
          if (event.type === "error") throw event.error
        }
        return chunks.join("")
      })

      expect(output).toBe("first-last")
      expect(observedOptions).not.toHaveProperty("timeout")
      expect(observedOptions).not.toHaveProperty("timeoutMs")
      expect(observedOptions).not.toHaveProperty("headerTimeout")
      expect(observedOptions).not.toHaveProperty("chunkTimeout")
      expect(observed?.timeout).toBe(false)
      expect(observed?.signal).toBeUndefined()
    }),
  )

  it.live("preserves an explicit request abort signal", () =>
    Effect.gen(function* () {
      const aisdk = yield* AISDK.Service
      const started = Promise.withResolvers<void>()
      let observed: RequestInit | undefined

      yield* aisdk.hook.sdk((event) => {
        event.sdk = createOpenAICompatible(event.options as unknown as Parameters<typeof createOpenAICompatible>[0])
      })

      const model = ModelV2.Info.make({
        ...ModelV2.Info.empty(ProviderV2.ID.make("abort-test"), ModelV2.ID.make("model")),
        api: {
          id: ModelV2.ID.make("model"),
          type: "aisdk",
          package: "@ai-sdk/openai-compatible",
          url: "https://models.example.test/v1",
          settings: {
            timeout: 1,
            timeoutMs: 4,
            headerTimeout: 2,
            chunkTimeout: 3,
            apiKey: "test-key",
            fetch: async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
              observed = init
              started.resolve()
              return new Promise<Response>((_resolve, reject) => {
                if (init?.signal?.aborted) return reject(init.signal.reason)
                init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true })
              })
            },
          },
        },
      })

      const language = yield* aisdk.language(model)
      const controller = new AbortController()
      const running = language.doStream({
        prompt: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
        abortSignal: controller.signal,
      })
      yield* Effect.promise(() => started.promise)
      controller.abort(new Error("stopped by user"))
      const outcome = yield* Effect.promise(() =>
        running.then(
          () => "resolved",
          () => "rejected",
        ),
      )

      expect(outcome).toBe("rejected")
      expect(observed?.signal).toBe(controller.signal)
    }),
  )
})
