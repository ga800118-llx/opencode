import { describe, expect, test } from "bun:test"
import { providerQueryReady } from "./provider-readiness"

describe("providerQueryReady", () => {
  test("rejects pending and failed initial catalogs", () => {
    expect(providerQueryReady({ isSuccess: false, isFetching: true })).toBe(false)
    expect(providerQueryReady({ isSuccess: false, isFetching: false })).toBe(false)
  })

  test("rejects refreshes until the latest catalog succeeds", () => {
    expect(providerQueryReady({ isSuccess: true, isFetching: false })).toBe(true)
    expect(providerQueryReady({ isSuccess: true, isFetching: true })).toBe(false)
    expect(providerQueryReady({ isSuccess: false, isFetching: false })).toBe(false)
    expect(providerQueryReady({ isSuccess: true, isFetching: false })).toBe(true)
  })
})
