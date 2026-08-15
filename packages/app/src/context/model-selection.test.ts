import { describe, expect, test } from "bun:test"
import { createRecentModelPruner } from "./model-recent-pruning"
import { firstValidModel, parseConfigModel, pruneModelKeys, type ModelKey } from "./model-selection"

const stale = { providerID: "agent-profile-old", modelID: "coder" }
const configured = { providerID: "agent-profile-current", modelID: "deepseek-v4-pro" }
const nested = { providerID: "provider", modelID: "model/with/slash" }

describe("parseConfigModel", () => {
  test("splits only at the first slash", () => {
    expect(parseConfigModel("provider/model/with/slash")).toEqual(nested)
  })

  test("rejects incomplete references", () => {
    expect(parseConfigModel(undefined)).toBeUndefined()
    expect(parseConfigModel("")).toBeUndefined()
    expect(parseConfigModel("provider")).toBeUndefined()
    expect(parseConfigModel("/model")).toBeUndefined()
    expect(parseConfigModel("provider/")).toBeUndefined()
  })
})

describe("firstValidModel", () => {
  test("skips stale session and recent references in favor of valid config", () => {
    const available = [configured]
    const valid = (model: ModelKey) =>
      available.some((item) => item.providerID === model.providerID && item.modelID === model.modelID)

    expect(firstValidModel([stale, stale, parseConfigModel("agent-profile-current/deepseek-v4-pro")], valid)).toEqual(
      configured,
    )
  })

  test("returns undefined when no candidate is valid", () => {
    expect(firstValidModel([stale, undefined], () => false)).toBeUndefined()
  })
})

test("pruneModelKeys removes invalid and duplicate entries while preserving valid order", () => {
  const second = { providerID: "anthropic", modelID: "claude" }

  expect(pruneModelKeys([configured, stale, nested, configured, second, nested], [nested, second, configured])).toEqual(
    [configured, nested, second],
  )
})

test("recent pruning waits for readiness and reruns after provider refresh", () => {
  let persistedReady = false
  let catalogReady = false
  let recent: ModelKey[] = [stale, configured]
  let available: ModelKey[] = [configured, nested]
  const updates: ModelKey[][] = []

  const prune = createRecentModelPruner({
    persistedReady: () => persistedReady,
    catalogReady: () => catalogReady,
    recent: () => recent,
    available: () => available,
    limit: 5,
    setRecent(value) {
      updates.push(value)
      recent = value
    },
  })

  prune()
  expect(updates).toEqual([])

  persistedReady = true
  prune()
  expect(updates).toEqual([])

  catalogReady = true
  prune()
  expect(updates).toEqual([[configured]])

  recent = [configured, nested]
  prune()
  available = [nested]
  prune()
  expect(updates.at(-1)).toEqual([nested])
})

test("recent pruning keeps the first five valid entries", () => {
  const recent = Array.from({ length: 6 }, (_, index) => ({ providerID: "provider", modelID: `model-${index}` }))
  let result: ModelKey[] = []
  const prune = createRecentModelPruner({
    persistedReady: () => true,
    catalogReady: () => true,
    recent: () => recent,
    available: () => recent,
    limit: 5,
    setRecent(value) {
      result = value
    },
  })

  prune()
  expect(result).toEqual(recent.slice(0, 5))
})
