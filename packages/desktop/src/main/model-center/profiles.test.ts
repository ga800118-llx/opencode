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
  settings: { timeoutMs: 30_000, contextLimit: 128_000, outputLimit: 16_000, allowInsecureTls: false },
} satisfies ProductProviderProfileInput

function fixture(initial?: unknown) {
  let time = 100
  let uuid = 0
  const values = new Map<string, unknown>(initial === undefined ? [] : [["state", initial]])
  const writes: unknown[] = []
  const store: ProfileStore = {
    get: (key) => values.get(key),
    set(key, value) {
      values.set(key, value)
      writes.push(value)
    },
  }
  const repository = createProfileRepository({
    store,
    now: () => time++,
    randomUUID: () => `00000000-0000-4000-8000-${String(++uuid).padStart(12, "0")}`,
  })
  return { repository, values, writes }
}

const report = {
  modelID: "coder",
  classification: "agent-capable",
  checks: { basicChat: true, streaming: true, toolCalling: true },
  testedAt: 200,
  requestID: "req-safe",
} satisfies ProductCapabilityReport

describe("createProfileRepository", () => {
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

  test("removes profiles and repairs the selected default", () => {
    const fake = fixture()
    const profile = fake.repository.save(base)
    fake.repository.selectDefault({ profileID: profile.id, modelID: "coder" })

    expect(fake.repository.remove(profile.id)?.id).toBe(profile.id)
    expect(fake.repository.remove(profile.id)).toBeUndefined()
    expect(fake.repository.defaultSelection()).toBeUndefined()
  })

  test("migrates version zero once and drops malformed profiles independently", () => {
    const valid = {
      ...base,
      id: "legacy-one",
      providerID: "agent-profile-legacy-one",
      hasApiKey: false,
      createdAt: 10,
      updatedAt: 20,
    }
    const fake = fixture({
      profiles: [valid, { id: "broken", name: "Broken", apiKey: "sk-test-secret" }],
      defaultProfileID: "legacy-one",
    })

    expect(fake.repository.list().map((profile) => profile.id)).toEqual(["legacy-one"])
    expect(fake.repository.defaultSelection()).toEqual({ profileID: "legacy-one", modelID: "coder" })
    expect(fake.writes).toHaveLength(1)
    expect(fake.values.get("state")).toMatchObject({ version: 1 })
    expect(JSON.stringify(fake.values.get("state"))).not.toContain("sk-test-secret")
  })

  test("repairs corrupt version one defaults without replacing valid profiles", () => {
    const valid = {
      ...base,
      id: "valid-one",
      providerID: "agent-profile-valid-one",
      hasApiKey: false,
      createdAt: 10,
      updatedAt: 20,
    }
    const fake = fixture({
      version: 1,
      profiles: [valid],
      default: { profileID: "missing", modelID: "coder" },
    })

    expect(fake.repository.list()).toHaveLength(1)
    expect(fake.repository.defaultSelection()).toBeUndefined()
    expect(fake.writes).toHaveLength(1)
  })
})
