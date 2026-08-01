import { describe, expect, test } from "bun:test"
import { modelReadiness, type ProductModelReadinessInput } from "./model-readiness"

const input = (overrides: Partial<ProductModelReadinessInput> = {}): ProductModelReadinessInput => ({
  providersLoading: false,
  hasUsableSelectedModel: false,
  availableModelCount: 0,
  desktopModelCenterAvailable: true,
  ...overrides,
})

describe("modelReadiness", () => {
  test("keeps loading providers in the loading state", () => {
    expect(
      modelReadiness(
        input({
          providersLoading: true,
          hasUsableSelectedModel: true,
          availableModelCount: 1,
        }),
      ),
    ).toBe("loading")
  })

  test("accepts a usable selected or built-in model without setup", () => {
    expect(
      modelReadiness(
        input({
          hasUsableSelectedModel: true,
          desktopModelCenterAvailable: false,
        }),
      ),
    ).toBe("ready")
  })

  test("accepts connected and visible available models", () => {
    expect(modelReadiness(input({ availableModelCount: 2 }))).toBe("ready")
  })

  test("requires setup for empty or unconnected providers", () => {
    expect(modelReadiness(input())).toBe("setup-required")
  })

  test("preserves provider settings when desktop Model Center is unavailable", () => {
    expect(modelReadiness(input({ desktopModelCenterAvailable: false }))).toBe("desktop-unavailable")
  })

  test("returns only workflow readiness states", () => {
    const states = [
      modelReadiness(input({ providersLoading: true })),
      modelReadiness(input({ hasUsableSelectedModel: true })),
      modelReadiness(input()),
      modelReadiness(input({ desktopModelCenterAvailable: false })),
    ]

    expect(states).toEqual(["loading", "ready", "setup-required", "desktop-unavailable"])
  })
})
