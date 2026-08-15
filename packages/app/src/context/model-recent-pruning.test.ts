import { expect, test } from "bun:test"
import type { NormalizedProviderListResponse } from "@opencode-ai/session-ui/context"
import { batch, createMemo, createRoot, createSignal } from "solid-js"
import { ServerScope } from "@/utils/server-scope"
import { providerQueryReady, resolveProviderCatalog } from "./global-sync/provider-readiness"
import { createRecentModelPruner } from "./model-recent-pruning"
import { createRecentModelMigration, recentModelTarget } from "./model-recent-storage"
import type { ModelKey } from "./model-selection"

const stale = { providerID: "agent-profile-old", modelID: "coder" }
const configured = { providerID: "agent-profile-current", modelID: "deepseek-v4-pro" }
const nested = { providerID: "provider", modelID: "model/with/slash" }
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

test("production pruning waits through pending and failed catalogs then reacts to successful refreshes", async () => {
  const [persistedReady, setPersistedReady] = createSignal(false)
  const [query, setQuery] = createSignal<{
    isSuccess: boolean
    fetchStatus: "fetching" | "paused" | "idle"
  }>({ isSuccess: false, fetchStatus: "fetching" })
  const [recent, setRecent] = createSignal<ModelKey[]>([stale, configured])
  const [available, setAvailable] = createSignal<ModelKey[]>([])
  const dispose = createRoot((dispose) => {
    createRecentModelPruner({
      persistedReady,
      catalogReady: () => providerQueryReady(query()),
      recent,
      available,
      limit: 5,
      setRecent,
    })
    return dispose
  })

  await settle()
  setPersistedReady(true)
  await settle()
  expect(recent()).toEqual([stale, configured])

  setQuery({ isSuccess: false, fetchStatus: "idle" })
  await settle()
  expect(recent()).toEqual([stale, configured])

  batch(() => {
    setAvailable([configured, nested])
    setQuery({ isSuccess: true, fetchStatus: "idle" })
  })
  await settle()
  expect(recent()).toEqual([configured])

  setRecent([configured, nested])
  await settle()
  batch(() => {
    setQuery({ isSuccess: true, fetchStatus: "paused" })
    setAvailable([nested])
  })
  await settle()
  expect(recent()).toEqual([configured, nested])

  setQuery({ isSuccess: false, fetchStatus: "idle" })
  await settle()
  expect(recent()).toEqual([configured, nested])

  setQuery({ isSuccess: true, fetchStatus: "idle" })
  await settle()
  expect(recent()).toEqual([nested])

  dispose()
})

test("directory and server catalogs cannot prune another scope's recents", async () => {
  const first = { providerID: "first", modelID: "model" }
  const second = { providerID: "second", modelID: "model" }
  const remote = "https://remote.example" as ServerScope
  const targets = [
    recentModelTarget(ServerScope.local, "/first"),
    recentModelTarget(ServerScope.local, "/second"),
    recentModelTarget(remote, "/first"),
  ]
  const stores = targets.map(() => createSignal([first, second]))
  const dispose = createRoot((dispose) => {
    stores.forEach(([recent, setRecent], index) =>
      createRecentModelPruner({
        persistedReady: () => true,
        catalogReady: () => true,
        recent,
        available: () => (index === 1 ? [second] : [first]),
        limit: 5,
        setRecent,
      }),
    )
    return dispose
  })

  await settle()
  expect(new Set(targets.map((target) => JSON.stringify(target))).size).toBe(3)
  expect(stores[0]![0]()).toEqual([first])
  expect(stores[1]![0]()).toEqual([second])
  expect(stores[2]![0]()).toEqual([first])
  dispose()
})

test("legacy recents migrate once after both stores are ready", async () => {
  const legacy = { providerID: "legacy", modelID: "model/with/slash" }
  const [preferencesReady, setPreferencesReady] = createSignal(false)
  const [recentReady, setRecentReady] = createSignal(false)
  const [migrated, setMigrated] = createSignal(false)
  const [scoped, setScoped] = createSignal<ModelKey[]>([])
  const dispose = createRoot((dispose) => {
    createRecentModelMigration({
      preferencesReady,
      recentReady,
      migrated,
      scoped,
      legacy: () => [legacy],
      limit: 5,
      set(models) {
        batch(() => {
          setScoped(models)
          setMigrated(true)
        })
      },
    })
    return dispose
  })

  setPreferencesReady(true)
  await settle()
  expect(scoped()).toEqual([])
  setRecentReady(true)
  await settle()
  expect(scoped()).toEqual([legacy])

  setScoped([])
  await settle()
  expect(scoped()).toEqual([])
  dispose()
})

test("global fallback selection reacts only after successful idle catalogs", () => {
  const empty: NormalizedProviderListResponse = { all: new Map(), connected: [], default: {} }
  const catalog = (id: string): NormalizedProviderListResponse => ({
    all: new Map([[id, { id, name: id, source: "api", env: [], options: {}, models: {} }]]),
    connected: [id],
    default: {},
  })
  const global = catalog("global")
  const next = catalog("next")

  createRoot((dispose) => {
    const [globalQuery, setGlobalQuery] = createSignal<{
      isSuccess: boolean
      fetchStatus: "fetching" | "paused" | "idle"
    }>({ isSuccess: false, fetchStatus: "fetching" })
    const [globalCatalog, setGlobalCatalog] = createSignal(global)
    const selected = createMemo(() =>
      resolveProviderCatalog({
        directoryReady: true,
        directory: empty,
        globalReady: providerQueryReady(globalQuery()),
        global: globalCatalog(),
      }),
    )

    expect(selected()).toEqual({ ready: false, providers: empty })
    setGlobalQuery({ isSuccess: false, fetchStatus: "idle" })
    expect(selected()).toEqual({ ready: false, providers: empty })
    setGlobalQuery({ isSuccess: true, fetchStatus: "idle" })
    expect(selected()).toEqual({ ready: true, providers: global })
    setGlobalCatalog(next)
    expect(selected()).toEqual({ ready: true, providers: next })
    setGlobalQuery({ isSuccess: true, fetchStatus: "paused" })
    expect(selected()).toEqual({ ready: false, providers: empty })
    setGlobalQuery({ isSuccess: true, fetchStatus: "idle" })
    expect(selected()).toEqual({ ready: true, providers: next })
    dispose()
  })
})

test("production pruning preserves recent order and limit", async () => {
  const values = Array.from({ length: 6 }, (_, index) => ({ providerID: "provider", modelID: `model-${index}` }))
  const [recent, setRecent] = createSignal(values)
  const dispose = createRoot((dispose) => {
    createRecentModelPruner({
      persistedReady: () => true,
      catalogReady: () => true,
      recent,
      available: () => values,
      limit: 5,
      setRecent,
    })
    return dispose
  })

  await settle()
  expect(recent()).toEqual(values.slice(0, 5))
  dispose()
})
