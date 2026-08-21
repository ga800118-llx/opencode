import { describe, expect, test } from "bun:test"
import type { ProductCapabilityReport, ProductProviderProfileInput } from "@opencode-ai/app/product/model-center"
import { createProfileRepository, type ProfileStore } from "./profiles"

const base = {
  name: "Private Gateway",
  kind: "openai-compatible",
  baseURL: "https://models.example.test/v1",
  headers: [
    { name: "X-Tenant", value: "alpha", sensitive: false, hasValue: true },
    { name: "X-Secret", sensitive: true, hasValue: true },
  ],
  models: [{ id: "coder", name: "Coder", source: "manual" }],
  defaultModelID: "coder",
  settings: { contextLimit: 128_000, outputLimit: 16_000, allowInsecureTls: false },
} satisfies ProductProviderProfileInput

function fixture(initial?: unknown) {
  let time = 100
  let uuid = 0
  const values = new Map<string, unknown>(initial === undefined ? [] : [["state", initial]])
  const writes: unknown[] = []
  let writeFailure: Error | undefined
  const store: ProfileStore = {
    get: (key) => values.get(key),
    set(key, value) {
      if (writeFailure) {
        const error = writeFailure
        writeFailure = undefined
        throw error
      }
      values.set(key, value)
      writes.push(value)
    },
  }
  const repository = createProfileRepository({
    store,
    now: () => time++,
    randomUUID: () => `00000000-0000-4000-8000-${String(++uuid).padStart(12, "0")}`,
  })
  return {
    repository,
    values,
    writes,
    failNextWrite: (error = new Error("store unavailable")) => (writeFailure = error),
  }
}

const report = {
  modelID: "coder",
  classification: "agent-capable",
  checks: { basicChat: true, streaming: true, toolCalling: true },
  testedAt: 200,
  requestID: "req-safe",
} satisfies ProductCapabilityReport

describe("createProfileRepository", () => {
  test("preserves the Web Crypto receiver when generating default identifiers", () => {
    const cryptoObject = globalThis.crypto
    const original = Object.getOwnPropertyDescriptor(cryptoObject, "randomUUID")
    Object.defineProperty(cryptoObject, "randomUUID", {
      configurable: true,
      value(this: Crypto) {
        if (this !== cryptoObject) throw new TypeError("invalid Crypto receiver")
        return "00000000-0000-4000-8000-000000000099"
      },
    })

    try {
      const values = new Map<string, unknown>()
      const repository = createProfileRepository({
        store: {
          get: (key) => values.get(key),
          set: (key, value) => values.set(key, value),
        },
      })
      expect(repository.save(base).id).toBe("00000000-0000-4000-8000-000000000099")
    } finally {
      if (original) Object.defineProperty(cryptoObject, "randomUUID", original)
      else Reflect.deleteProperty(cryptoObject, "randomUUID")
    }
  })

  test("starts empty and creates renderer-safe profiles with stable identifiers", () => {
    const fake = fixture()
    expect(fake.repository.list()).toEqual([])

    const profile = fake.repository.save(base, {
      hasApiKey: true,
      sensitiveHeaders: ["X-Secret"],
    })

    expect(profile).toMatchObject({
      id: "00000000-0000-4000-8000-000000000001",
      providerID: "agent-profile-00000000-0000-4000-8000-000000000001",
      credentialRef: "model-profile:00000000-0000-4000-8000-000000000001",
      hasApiKey: true,
      createdAt: 100,
      updatedAt: 100,
    })
    expect(profile.headers[1]).toEqual({ name: "X-Secret", sensitive: true, hasValue: true })
    expect(JSON.stringify(fake.values.get("state"))).not.toContain("sk-test-secret")
    expect(JSON.stringify(fake.values.get("state"))).not.toContain("Bearer secret-header")
  })

  test("selects the first model of the first usable profile even when its profile default differs", () => {
    const fake = fixture()
    fake.repository.save({ ...base, name: "Empty", models: [], defaultModelID: undefined })
    const profile = fake.repository.save({
      ...base,
      name: "Usable",
      models: [
        { id: "coder", name: "Coder", source: "manual" },
        { id: "reasoner", name: "Reasoner", source: "manual" },
      ],
      defaultModelID: "reasoner",
    })

    expect(fake.repository.defaultSelection()).toEqual({ profileID: profile.id, modelID: "coder" })
    expect(fake.values.get("state")).toMatchObject({
      default: { profileID: profile.id, modelID: "coder" },
    })
  })

  test("uses the first model when the first usable profile has no valid profile default", () => {
    const fake = fixture()
    const profile = fake.repository.save({
      ...base,
      models: [
        { id: "reasoner", name: "Reasoner", source: "manual" },
        { id: "coder", name: "Coder", source: "manual" },
      ],
      defaultModelID: undefined,
    })

    expect(fake.repository.defaultSelection()).toEqual({ profileID: profile.id, modelID: "reasoner" })
  })

  test("preserves a valid default when newer profiles are saved", () => {
    const fake = fixture()
    const first = fake.repository.save(base)
    const second = fake.repository.save({
      ...base,
      name: "Second",
      models: [{ id: "reasoner", name: "Reasoner", source: "manual" }],
      defaultModelID: "reasoner",
    })
    fake.repository.save({ ...base, id: second.id, name: "Second Updated" })

    expect(fake.repository.list()[0]?.id).toBe(second.id)
    expect(fake.repository.defaultSelection()).toEqual({ profileID: first.id, modelID: "coder" })
  })

  test("repairs an invalidated selected-profile model to its first remaining model", () => {
    const fake = fixture()
    const selected = fake.repository.save({
      ...base,
      models: [...base.models, { id: "reasoner", name: "Reasoner", source: "manual" }],
    })
    fake.repository.save({ ...base, name: "Remaining" })

    fake.repository.save({
      ...base,
      id: selected.id,
      models: [
        { id: "reasoner", name: "Reasoner", source: "manual" },
        { id: "reviewer", name: "Reviewer", source: "manual" },
      ],
      defaultModelID: "reviewer",
    })

    expect(fake.repository.list()[0]?.id).toBe(selected.id)
    expect(fake.repository.defaultSelection()).toEqual({ profileID: selected.id, modelID: "reasoner" })
    expect(fake.values.get("state")).toMatchObject({
      default: { profileID: selected.id, modelID: "reasoner" },
    })
  })

  test("falls back to the first model of the next usable profile when an edit empties the selected profile", () => {
    const fake = fixture()
    const selected = fake.repository.save(base)
    const remaining = fake.repository.save({
      ...base,
      name: "Remaining",
      models: [
        { id: "fallback", name: "Fallback", source: "manual" },
        { id: "preferred", name: "Preferred", source: "manual" },
      ],
      defaultModelID: "preferred",
    })

    fake.repository.save({ ...base, id: selected.id, models: [], defaultModelID: undefined })

    expect(fake.repository.list()[0]?.id).toBe(selected.id)
    expect(fake.repository.defaultSelection()).toEqual({ profileID: remaining.id, modelID: "fallback" })
  })

  test("updates in place, preserves creation identity, and orders by update time", () => {
    const fake = fixture()
    const first = fake.repository.save(base)
    const second = fake.repository.save({ ...base, name: "Second" })
    const updated = fake.repository.save({ ...base, id: first.id, name: "Updated" })

    expect(updated.id).toBe(first.id)
    expect(updated.providerID).toBe(first.providerID)
    expect(updated.createdAt).toBe(first.createdAt)
    expect(updated.updatedAt).toBeGreaterThan(second.updatedAt)
    expect(fake.repository.list().map((profile) => profile.name)).toEqual(["Updated", "Second"])
  })

  test("records capability reports and persists a selected default", () => {
    const fake = fixture()
    const profile = fake.repository.save(base)
    const tested = fake.repository.recordTest(profile.id, report)
    const selected = fake.repository.selectDefault({ profileID: profile.id, modelID: "coder" })

    expect(tested.test).toEqual(report)
    expect(selected.defaultModelID).toBe("coder")
    expect(fake.repository.defaultSelection()).toEqual({ profileID: profile.id, modelID: "coder" })
    expect(() => fake.repository.selectDefault({ profileID: profile.id, modelID: "missing" })).toThrow(
      "The selected model does not belong to this profile.",
    )
  })

  test("keeps memory unchanged when default persistence fails", () => {
    const fake = fixture()
    const profile = fake.repository.save({
      ...base,
      models: [...base.models, { id: "reasoner", name: "Reasoner", source: "manual" }],
    })
    fake.failNextWrite()

    expect(() => fake.repository.selectDefault({ profileID: profile.id, modelID: "reasoner" })).toThrow(
      "store unavailable",
    )
    expect(fake.repository.get(profile.id)?.defaultModelID).toBe("coder")
    expect(fake.repository.defaultSelection()).toEqual({ profileID: profile.id, modelID: "coder" })
  })

  test("keeps memory and storage empty when first-save auto-selection persistence fails", () => {
    const fake = fixture()
    fake.failNextWrite()

    expect(() => fake.repository.save(base)).toThrow("store unavailable")
    expect(fake.repository.list()).toEqual([])
    expect(fake.repository.defaultSelection()).toBeUndefined()
    expect(fake.values.has("state")).toBe(false)
    expect(fake.writes).toEqual([])
  })

  test("keeps the previous profile, default, and store when edit fallback persistence fails", () => {
    const fake = fixture()
    const selected = fake.repository.save({
      ...base,
      models: [...base.models, { id: "reasoner", name: "Reasoner", source: "manual" }],
    })
    fake.repository.save({ ...base, name: "Remaining" })
    const profiles = fake.repository.list()
    const stored = fake.values.get("state")
    fake.failNextWrite()

    expect(() =>
      fake.repository.save({
        ...base,
        id: selected.id,
        models: [{ id: "reasoner", name: "Reasoner", source: "manual" }],
        defaultModelID: undefined,
      }),
    ).toThrow("store unavailable")
    expect(fake.repository.list()).toEqual(profiles)
    expect(fake.repository.get(selected.id)?.models.map((model) => model.id)).toEqual(["coder", "reasoner"])
    expect(fake.repository.defaultSelection()).toEqual({ profileID: selected.id, modelID: "coder" })
    expect(fake.values.get("state")).toBe(stored)
    expect(fake.writes).toHaveLength(2)
  })

  test("keeps the previous profiles, default, and store when removal fallback persistence fails", () => {
    const fake = fixture()
    const selected = fake.repository.save(base)
    fake.repository.save({ ...base, name: "Remaining" })
    const profiles = fake.repository.list()
    const stored = fake.values.get("state")
    fake.failNextWrite()

    expect(() => fake.repository.remove(selected.id)).toThrow("store unavailable")
    expect(fake.repository.list()).toEqual(profiles)
    expect(fake.repository.get(selected.id)).toBeDefined()
    expect(fake.repository.defaultSelection()).toEqual({ profileID: selected.id, modelID: "coder" })
    expect(fake.values.get("state")).toBe(stored)
    expect(fake.writes).toHaveLength(2)
  })

  test("rolls explicit default selection back to the persisted auto-selected default", () => {
    const fake = fixture()
    const profile = fake.repository.save({
      ...base,
      models: [...base.models, { id: "reasoner", name: "Reasoner", source: "manual" }],
    })
    const transaction = fake.repository.selectDefaultTransaction({ profileID: profile.id, modelID: "reasoner" })

    expect(fake.repository.defaultSelection()).toEqual({ profileID: profile.id, modelID: "reasoner" })
    transaction.rollback()
    expect(fake.repository.defaultSelection()).toEqual({ profileID: profile.id, modelID: "coder" })
    expect(fake.repository.get(profile.id)?.defaultModelID).toBe("coder")
  })

  test("preserves a capability report when saving an unchanged tested profile", () => {
    const fake = fixture()
    const secrets = { hasApiKey: true, sensitiveHeaders: ["X-Secret"] }
    const profile = fake.repository.save(base, secrets)
    fake.repository.recordTest(profile.id, report)

    expect(fake.repository.save({ ...base, id: profile.id }, secrets).test).toEqual(report)
  })

  test("removes profiles and repairs the selected default", () => {
    const fake = fixture()
    const selected = fake.repository.save(base)
    const fallback = fake.repository.save({
      ...base,
      name: "Fallback",
      models: [
        { id: "first", name: "First", source: "manual" },
        { id: "second", name: "Second", source: "manual" },
      ],
      defaultModelID: undefined,
    })
    const empty = fake.repository.save({ ...base, name: "Empty", models: [], defaultModelID: undefined })

    expect(fake.repository.remove(selected.id)?.id).toBe(selected.id)
    expect(fake.repository.defaultSelection()).toEqual({ profileID: fallback.id, modelID: "first" })
    expect(fake.values.get("state")).toMatchObject({ default: { profileID: fallback.id, modelID: "first" } })
    expect(fake.repository.remove(selected.id)).toBeUndefined()
    expect(fake.repository.remove(fallback.id)?.id).toBe(fallback.id)
    expect(fake.repository.remove(empty.id)?.id).toBe(empty.id)
    expect(fake.repository.defaultSelection()).toBeUndefined()
  })

  test("migrates version zero once and drops malformed profiles independently", () => {
    const valid = {
      ...base,
      id: "legacy-one",
      providerID: "agent-profile-legacy-one",
      hasApiKey: false,
      models: [
        { id: "first", name: "First", source: "manual" },
        { id: "legacy-default", name: "Legacy Default", source: "manual" },
      ],
      defaultModelID: "legacy-default",
      settings: { ...base.settings, timeoutMs: Number.MAX_SAFE_INTEGER },
      createdAt: 10,
      updatedAt: 20,
    }
    const fake = fixture({
      profiles: [valid, { id: "broken", name: "Broken", apiKey: "sk-test-secret" }],
      defaultProfileID: "legacy-one",
    })

    expect(fake.repository.list().map((profile) => profile.id)).toEqual(["legacy-one"])
    expect(fake.repository.defaultSelection()).toEqual({ profileID: "legacy-one", modelID: "legacy-default" })
    expect(fake.writes).toHaveLength(1)
    expect(fake.values.get("state")).toMatchObject({ version: 1 })
    expect(fake.repository.list()[0]?.settings).not.toHaveProperty("timeoutMs")
    expect(JSON.stringify(fake.values.get("state"))).not.toContain("timeoutMs")
    expect(JSON.stringify(fake.values.get("state"))).not.toContain("sk-test-secret")
  })

  test("repairs and persists absent or corrupt version one defaults deterministically", () => {
    const older = {
      ...base,
      id: "older",
      providerID: "agent-profile-older",
      hasApiKey: false,
      createdAt: 10,
      updatedAt: 20,
    }
    const newer = {
      ...base,
      id: "newer",
      providerID: "agent-profile-newer",
      hasApiKey: false,
      models: [
        { id: "first", name: "First", source: "manual" },
        { id: "preferred", name: "Preferred", source: "manual" },
      ],
      defaultModelID: "preferred",
      createdAt: 20,
      updatedAt: 30,
    }

    for (const initial of [
      { version: 1, profiles: [older, newer] },
      { version: 1, profiles: [older, newer], default: { profileID: "missing", modelID: "coder" } },
    ]) {
      const fake = fixture(initial)

      expect(fake.repository.list().map((profile) => profile.id)).toEqual(["newer", "older"])
      expect(fake.repository.defaultSelection()).toEqual({ profileID: "newer", modelID: "first" })
      expect(fake.values.get("state")).toMatchObject({
        default: { profileID: "newer", modelID: "first" },
      })
      expect(fake.writes).toHaveLength(1)

      const reopened = fixture(fake.values.get("state"))
      expect(reopened.repository.defaultSelection()).toEqual({ profileID: "newer", modelID: "first" })
      expect(reopened.writes).toHaveLength(0)
    }
  })
})
