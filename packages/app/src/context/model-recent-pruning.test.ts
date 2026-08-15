import { expect, test } from "bun:test"
import { batch, createRoot, createSignal } from "solid-js"
import { providerQueryReady } from "./global-sync/provider-readiness"
import { createRecentModelPruner } from "./model-recent-pruning"
import type { ModelKey } from "./model-selection"

const stale = { providerID: "agent-profile-old", modelID: "coder" }
const configured = { providerID: "agent-profile-current", modelID: "deepseek-v4-pro" }
const nested = { providerID: "provider", modelID: "model/with/slash" }
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

test("production pruning waits through pending and failed catalogs then reacts to successful refreshes", async () => {
  const [persistedReady, setPersistedReady] = createSignal(false)
  const [query, setQuery] = createSignal({ isSuccess: false, isFetching: true })
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

  setQuery({ isSuccess: false, isFetching: false })
  await settle()
  expect(recent()).toEqual([stale, configured])

  batch(() => {
    setAvailable([configured, nested])
    setQuery({ isSuccess: true, isFetching: false })
  })
  await settle()
  expect(recent()).toEqual([configured])

  setRecent([configured, nested])
  await settle()
  batch(() => {
    setQuery({ isSuccess: true, isFetching: true })
    setAvailable([nested])
  })
  await settle()
  expect(recent()).toEqual([configured, nested])

  setQuery({ isSuccess: false, isFetching: false })
  await settle()
  expect(recent()).toEqual([configured, nested])

  setQuery({ isSuccess: true, isFetching: false })
  await settle()
  expect(recent()).toEqual([nested])

  dispose()
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
