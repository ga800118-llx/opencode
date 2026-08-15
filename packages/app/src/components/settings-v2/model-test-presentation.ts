import type { ProductErrorKind } from "@/product/contracts"
import type { ProductModelDiagnostic } from "@/product/model-center"

export type ModelTestCopyKey =
  | "settings.modelCenter.test.unreachableEndpoint"
  | "settings.modelCenter.test.authentication"
  | "settings.modelCenter.test.incompatible"
  | "settings.modelCenter.test.missingModel"
  | "settings.modelCenter.test.streaming"
  | "settings.modelCenter.test.toolCalling"
  | "settings.modelCenter.test.timeout"
  | "settings.modelCenter.test.tls"
  | "settings.modelCenter.test.serverCrash"
  | "settings.modelCenter.test.aborted"
  | "settings.modelCenter.test.unexpected"

const DIAGNOSTIC_KEYS = {
  "unreachable-endpoint": "settings.modelCenter.test.unreachableEndpoint",
  authentication: "settings.modelCenter.test.authentication",
  "incompatible-api": "settings.modelCenter.test.incompatible",
  "missing-model": "settings.modelCenter.test.missingModel",
  streaming: "settings.modelCenter.test.streaming",
  "tool-calling": "settings.modelCenter.test.toolCalling",
  timeout: "settings.modelCenter.test.timeout",
  tls: "settings.modelCenter.test.tls",
  "server-crash": "settings.modelCenter.test.serverCrash",
  "model-runtime-unreconciled": "settings.modelCenter.test.unexpected",
  aborted: "settings.modelCenter.test.aborted",
  unknown: "settings.modelCenter.test.unexpected",
} satisfies Record<ProductErrorKind, ModelTestCopyKey>

export function modelTestPresentation(diagnostic: ProductModelDiagnostic | undefined) {
  if (!diagnostic) return
  return { key: DIAGNOSTIC_KEYS[diagnostic.kind] } as const
}
