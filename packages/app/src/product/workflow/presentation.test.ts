import { describe, expect, test } from "bun:test"
import { createPresentationState, normalizePresentationMode, type ProductPresentationState } from "./presentation"

describe("normalizePresentationMode", () => {
  test("accepts only simple and advanced", () => {
    expect(normalizePresentationMode("simple")).toBe("simple")
    expect(normalizePresentationMode("advanced")).toBe("advanced")
  })

  test("defaults missing and corrupt values to simple", () => {
    expect([undefined, null, "", "Simple", "expert", false, 1, {}, []].map(normalizePresentationMode)).toEqual(
      Array.from({ length: 9 }, () => "simple"),
    )
  })
})

describe("createPresentationState", () => {
  test("returns immutable flags for each mode", () => {
    const simple = createPresentationState(undefined)
    const advanced = createPresentationState("advanced")

    expect(simple).toEqual({ mode: "simple", simple: true, advanced: false })
    expect(advanced).toEqual({ mode: "advanced", simple: false, advanced: true })
    expect(Object.isFrozen(simple)).toBe(true)
    expect(Object.isFrozen(advanced)).toBe(true)
  })

  test("returns stable values without mutating input", () => {
    const input = { mode: "advanced" }

    expect(createPresentationState("advanced")).toBe(createPresentationState("advanced"))
    expect(createPresentationState(input)).toBe(createPresentationState("simple"))
    expect(input).toEqual({ mode: "advanced" })
  })

  test("narrows flags from the presentation mode", () => {
    const flags = (state: ProductPresentationState) => {
      if (state.mode === "simple") {
        const value: readonly [true, false] = [state.simple, state.advanced]
        return value
      }
      const value: readonly [false, true] = [state.simple, state.advanced]
      return value
    }

    expect(flags(createPresentationState("simple"))).toEqual([true, false])
    expect(flags(createPresentationState("advanced"))).toEqual([false, true])
  })
})
