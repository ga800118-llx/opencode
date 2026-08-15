import { describe, expect, test } from "bun:test"
import type { ProductErrorKind } from "@/product/contracts"
import type { ProductModelDiagnostic } from "@/product/model-center"
import { modelTestPresentation } from "./model-test-presentation"

const expected = {
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
} as const satisfies Record<ProductErrorKind, string>

describe("modelTestPresentation", () => {
  test.each(Object.entries(expected) as [ProductErrorKind, (typeof expected)[ProductErrorKind]][])(
    "maps %s to localized capability-test copy",
    (kind, key) => {
      const diagnostic = {
        kind,
        message: "Raw English diagnostic",
        requestID: "req-safe",
      } satisfies ProductModelDiagnostic

      expect(modelTestPresentation(diagnostic)).toEqual({ key })
    },
  )

  test("returns no presentation without a diagnostic", () => {
    expect(modelTestPresentation(undefined)).toBeUndefined()
  })
})
