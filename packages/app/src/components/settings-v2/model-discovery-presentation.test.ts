import { describe, expect, test } from "bun:test"
import type { ProductErrorKind } from "@/product/contracts"
import type { ModelDiscoveryFeedback } from "./model-center-controller"
import { modelDiscoveryPresentation } from "./model-discovery-presentation"

describe("model discovery presentation", () => {
  test("presents progress before completed feedback", () => {
    expect(modelDiscoveryPresentation(true, { type: "success", count: 3 })).toEqual({
      key: "settings.modelCenter.discovery.progress",
      live: "polite",
    })
  })

  test("presents successful discovery counts and the zero-model response", () => {
    expect(modelDiscoveryPresentation(false, { type: "success", count: 2 })).toEqual({
      key: "settings.modelCenter.discovery.success",
      params: { count: 2 },
      live: "polite",
    })
    expect(modelDiscoveryPresentation(false, { type: "success", count: 0 })).toEqual({
      key: "settings.modelCenter.discovery.empty",
      live: "polite",
    })
  })

  test("presents invalid endpoints without diagnostic input", () => {
    expect(modelDiscoveryPresentation(false, { type: "invalid-endpoint" })).toEqual({
      key: "settings.modelCenter.discovery.invalidEndpoint",
      live: "assertive",
    })
  })

  test.each([
    ["unreachable-endpoint", "settings.modelCenter.discovery.unreachableEndpoint"],
    ["authentication", "settings.modelCenter.discovery.authentication"],
    ["incompatible-api", "settings.modelCenter.discovery.incompatible"],
    ["timeout", "settings.modelCenter.discovery.timeout"],
    ["tls", "settings.modelCenter.discovery.tls"],
    ["missing-model", "settings.modelCenter.discovery.missingModel"],
    ["aborted", "settings.modelCenter.discovery.aborted"],
  ] as const)("maps %s diagnostics to safe localized copy", (kind, key) => {
    expect(modelDiscoveryPresentation(false, diagnostic(kind))).toEqual({ key, live: "assertive" })
  })

  test.each(["streaming", "tool-calling", "server-crash", "unknown"] as const)(
    "maps %s diagnostics to unexpected copy",
    (kind) => {
      expect(modelDiscoveryPresentation(false, diagnostic(kind))).toEqual({
        key: "settings.modelCenter.discovery.unexpected",
        live: "assertive",
      })
    },
  )

  test("presents unexpected failures and omits empty state", () => {
    expect(modelDiscoveryPresentation(false, { type: "unexpected" })).toEqual({
      key: "settings.modelCenter.discovery.unexpected",
      live: "assertive",
    })
    expect(modelDiscoveryPresentation(false, undefined)).toBeUndefined()
  })
})

function diagnostic(kind: ProductErrorKind): ModelDiscoveryFeedback {
  return {
    type: "diagnostic",
    diagnostic: {
      kind,
      message: "secret diagnostic body",
      detail: "Authorization: Bearer secret",
      requestID: "req-secret",
    },
  }
}
