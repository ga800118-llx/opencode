import { describe, expect, test } from "bun:test"
import type { NormalizedProviderListResponse } from "@opencode-ai/session-ui/context"
import { providerQueryReady, resolveProviderCatalog } from "./provider-readiness"

const empty: NormalizedProviderListResponse = { all: new Map(), connected: [], default: {} }
const catalog = (id: string): NormalizedProviderListResponse => ({
  all: new Map([[id, { id, name: id, source: "api", env: [], options: {}, models: {} }]]),
  connected: [id],
  default: { [id]: `${id}-model` },
})

describe("providerQueryReady", () => {
  test("rejects pending and failed initial catalogs", () => {
    expect(providerQueryReady({ isSuccess: false, fetchStatus: "fetching" })).toBe(false)
    expect(providerQueryReady({ isSuccess: false, fetchStatus: "paused" })).toBe(false)
    expect(providerQueryReady({ isSuccess: false, fetchStatus: "idle" })).toBe(false)
  })

  test("rejects active and paused refreshes until the latest catalog succeeds idle", () => {
    expect(providerQueryReady({ isSuccess: true, fetchStatus: "idle" })).toBe(true)
    expect(providerQueryReady({ isSuccess: true, fetchStatus: "fetching" })).toBe(false)
    expect(providerQueryReady({ isSuccess: true, fetchStatus: "paused" })).toBe(false)
    expect(providerQueryReady({ isSuccess: false, fetchStatus: "idle" })).toBe(false)
    expect(providerQueryReady({ isSuccess: true, fetchStatus: "idle" })).toBe(true)
  })
})

describe("resolveProviderCatalog", () => {
  test("uses an authoritative nonempty directory catalog without global readiness", () => {
    const directory = catalog("directory")
    expect(
      resolveProviderCatalog({ directoryReady: true, directory, globalReady: false, global: catalog("global") }),
    ).toEqual({ ready: true, providers: directory })
  })

  test("waits for an authoritative global fallback when the directory catalog is empty", () => {
    const global = catalog("global")
    expect(resolveProviderCatalog({ directoryReady: true, directory: empty, globalReady: false, global })).toEqual({
      ready: false,
      providers: empty,
    })
    expect(resolveProviderCatalog({ directoryReady: true, directory: empty, globalReady: true, global })).toEqual({
      ready: true,
      providers: global,
    })
  })

  test("does not treat a pending or failed directory catalog as authoritative", () => {
    expect(
      resolveProviderCatalog({
        directoryReady: false,
        directory: catalog("stale"),
        globalReady: true,
        global: catalog("global"),
      }),
    ).toEqual({ ready: false, providers: empty })
  })
})
