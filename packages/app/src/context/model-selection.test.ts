import { describe, expect, test } from "bun:test"
import { firstValidModel, parseConfigModel, pruneModelKeys, selectModelKey, type ModelKey } from "./model-selection"

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

describe("selectModelKey", () => {
  const explicit = { providerID: "explicit", modelID: "model" }
  const agent = { providerID: "agent", modelID: "model" }
  const recent = { providerID: "recent", modelID: "model" }
  const fallback = { providerID: "fallback", modelID: "model" }
  const candidates = [explicit, agent, configured, recent, fallback]
  const valid = (available: ModelKey[]) => (model: ModelKey) =>
    available.some((item) => item.providerID === model.providerID && item.modelID === model.modelID)

  test("preserves explicit, agent, config, recent, and fallback precedence", () => {
    const input = {
      explicit,
      agent,
      configured: "agent-profile-current/deepseek-v4-pro",
      recent: [stale, recent],
      fallback: [fallback],
    }

    expect(selectModelKey({ ...input, valid: valid(candidates) })).toEqual(explicit)
    expect(selectModelKey({ ...input, valid: valid(candidates.slice(1)) })).toEqual(agent)
    expect(selectModelKey({ ...input, valid: valid(candidates.slice(2)) })).toEqual(configured)
    expect(selectModelKey({ ...input, valid: valid(candidates.slice(3)) })).toEqual(recent)
    expect(selectModelKey({ ...input, valid: valid(candidates.slice(4)) })).toEqual(fallback)
  })

  test("rejects stale explicit, agent, and recent candidates for generated config", () => {
    expect(
      selectModelKey({
        explicit: stale,
        agent: stale,
        configured: "agent-profile-current/deepseek-v4-pro",
        recent: [stale],
        fallback: [],
        valid: valid([configured]),
      }),
    ).toEqual(configured)
  })

  test("returns undefined without a valid connected candidate", () => {
    expect(
      selectModelKey({
        explicit: stale,
        agent: stale,
        configured: "missing/model",
        recent: [stale],
        fallback: [],
        valid: () => false,
      }),
    ).toBeUndefined()
  })
})

test("pruneModelKeys removes invalid and duplicate entries while preserving valid order", () => {
  const second = { providerID: "anthropic", modelID: "claude" }

  expect(pruneModelKeys([configured, stale, nested, configured, second, nested], [nested, second, configured])).toEqual(
    [configured, nested, second],
  )
})
