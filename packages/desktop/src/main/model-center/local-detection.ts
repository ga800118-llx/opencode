import { randomUUID } from "node:crypto"
import type { ProductLocalProviderCandidate, ProductModelDiscoveryResult } from "@opencode-ai/app/product/model-center"
import { createProbeDiagnostic } from "./diagnostics"
import type { ModelProbeTarget } from "./probe"

type LocalModelDetectorOptions = {
  readonly discover: (target: ModelProbeTarget) => Promise<ProductModelDiscoveryResult>
  readonly requestID?: () => string
}

export type LocalModelDetector = {
  readonly detect: () => Promise<readonly ProductLocalProviderCandidate[]>
}

const CANDIDATES = Object.freeze([
  Object.freeze({
    id: "ollama" as const,
    kind: "ollama" as const,
    name: "Ollama",
    baseURL: "http://127.0.0.1:11434",
  }),
  Object.freeze({
    id: "lm-studio" as const,
    kind: "lm-studio" as const,
    name: "LM Studio",
    baseURL: "http://127.0.0.1:1234/v1",
  }),
])

export function createLocalModelDetector(options: LocalModelDetectorOptions): LocalModelDetector {
  const nextRequestID = options.requestID ?? randomUUID
  return Object.freeze({
    async detect() {
      const candidates = await Promise.all(
        CANDIDATES.map(async (candidate): Promise<ProductLocalProviderCandidate> => {
          try {
            const result = await options.discover({
              kind: candidate.kind,
              baseURL: candidate.baseURL,
              timeoutMs: 1_500,
            })
            return Object.freeze({
              ...candidate,
              available: !result.diagnostic,
              models: Object.freeze([...result.models]),
              ...(result.diagnostic ? { diagnostic: result.diagnostic } : {}),
            })
          } catch (error) {
            const requestID = nextRequestID()
            return Object.freeze({
              ...candidate,
              available: false,
              models: Object.freeze([]),
              diagnostic: createProbeDiagnostic(error, requestID),
            })
          }
        }),
      )
      return Object.freeze(candidates)
    },
  })
}
