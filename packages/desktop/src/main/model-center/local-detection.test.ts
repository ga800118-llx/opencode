import { describe, expect, test } from "bun:test"
import type { ProductModelDiscoveryResult } from "@opencode-ai/app/product/model-center"
import { createLocalModelDetector } from "./local-detection"

const success = (requestID: string, modelID?: string): ProductModelDiscoveryResult => ({
  requestID,
  models: modelID ? [{ id: modelID, name: modelID, source: "discovered" }] : [],
})

describe("createLocalModelDetector", () => {
  test("probes only Ollama and LM Studio concurrently with bounded targets", async () => {
    const calls: unknown[] = []
    const releases: Array<() => void> = []
    const detector = createLocalModelDetector({
      discover(target) {
        calls.push(target)
        return new Promise((resolve) => {
          releases.push(() => resolve(success(`req-${target.kind}`, target.kind)))
        })
      },
    })

    const pending = detector.detect()
    await Promise.resolve()
    expect(calls).toEqual([
      { kind: "ollama", baseURL: "http://127.0.0.1:11434", timeoutMs: 1_500 },
      { kind: "lm-studio", baseURL: "http://127.0.0.1:1234/v1", timeoutMs: 1_500 },
    ])
    releases.forEach((release) => release())

    expect(await pending).toEqual([
      {
        id: "ollama",
        kind: "ollama",
        name: "Ollama",
        baseURL: "http://127.0.0.1:11434",
        available: true,
        models: [{ id: "ollama", name: "ollama", source: "discovered" }],
      },
      {
        id: "lm-studio",
        kind: "lm-studio",
        name: "LM Studio",
        baseURL: "http://127.0.0.1:1234/v1",
        available: true,
        models: [{ id: "lm-studio", name: "lm-studio", source: "discovered" }],
      },
    ])
  })

  test("keeps an available empty service distinct from an unavailable service", async () => {
    const detector = createLocalModelDetector({
      discover(target) {
        if (target.kind === "ollama") return Promise.resolve(success("req-empty"))
        return Promise.resolve({
          requestID: "req-down",
          models: [],
          diagnostic: {
            kind: "unreachable-endpoint",
            message: "The model endpoint could not be reached.",
            requestID: "req-down",
          },
        })
      },
    })

    const result = await detector.detect()
    expect(result[0]).toMatchObject({ id: "ollama", available: true, models: [] })
    expect(result[1]).toMatchObject({
      id: "lm-studio",
      available: false,
      diagnostic: { kind: "unreachable-endpoint", requestID: "req-down" },
    })
  })

  test("contains a rejected candidate without hiding the other result", async () => {
    const detector = createLocalModelDetector({
      requestID: () => "req-contained",
      discover(target) {
        if (target.kind === "ollama") return Promise.reject(Object.assign(new Error("private"), { code: "ETIMEDOUT" }))
        return Promise.resolve(success("req-lm", "local-coder"))
      },
    })

    const result = await detector.detect()
    expect(result[0]).toMatchObject({ available: false, diagnostic: { kind: "timeout", requestID: "req-contained" } })
    expect(result[1]).toMatchObject({ available: true, models: [{ id: "local-coder" }] })
    expect(JSON.stringify(result)).not.toContain("private")
  })
})
