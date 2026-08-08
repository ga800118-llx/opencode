import { describe, expect, test } from "bun:test"
import type {
  ProductCapabilityReport,
  ProductModelCenterAPI,
  ProductProviderProfile,
  ProductProviderProfileInput,
} from "./contracts"
import { createModelCenterController } from "./controller"

const report = {
  modelID: "coder",
  classification: "agent-capable",
  checks: { basicChat: true, streaming: true, toolCalling: true },
  testedAt: 100,
  requestID: "req-safe",
} satisfies ProductCapabilityReport

const profile = {
  id: "profile-one",
  providerID: "agent-profile-profile-one",
  name: "Private",
  kind: "openai-compatible",
  baseURL: "https://models.example.test/v1",
  hasApiKey: true,
  headers: [],
  models: [{ id: "coder", name: "Coder", source: "manual" }],
  defaultModelID: "coder",
  settings: { timeoutMs: 30_000, contextLimit: 128_000, outputLimit: 16_000, allowInsecureTls: false },
  runtime: {
    baseURL: "http://127.0.0.1:32123/model-profile/profile-one/v1",
    credentialProxy: true,
  },
  test: report,
  createdAt: 1,
  updatedAt: 2,
} satisfies ProductProviderProfile

const draft = {
  name: profile.name,
  kind: profile.kind,
  baseURL: profile.baseURL,
  headers: profile.headers,
  models: profile.models,
  defaultModelID: profile.defaultModelID,
  settings: profile.settings,
  credentials: { apiKey: "sk-test-secret" },
} satisfies ProductProviderProfileInput

function fixture(
  input: {
    updateFailure?: Error
    rollbackFailure?: Error
    selectFailure?: Error
    selectFailureAt?: number
    currentModel?: string | null
    staleCurrentModel?: boolean
  } = {},
) {
  const calls: string[] = []
  const patches: unknown[] = []
  let stored: ProductProviderProfile[] = []
  let configuredModel = input.currentModel === null ? undefined : (input.currentModel ?? `${profile.providerID}/coder`)
  let observedModel = configuredModel
  let updateCalls = 0
  let selectCalls = 0
  const host: ProductModelCenterAPI = {
    async capabilities() {
      return {
        available: true,
        credentialBackend: "macos-keychain",
        credentialOperations: { read: true, write: true, delete: true },
        localDetection: true,
      }
    },
    async list() {
      calls.push("list")
      return stored
    },
    async save(value) {
      calls.push("save")
      const next = {
        ...profile,
        ...(value.id ? { id: value.id } : {}),
        name: value.name,
        kind: value.kind,
        baseURL: value.baseURL,
        headers: value.headers,
        models: value.models,
        ...(value.defaultModelID ? { defaultModelID: value.defaultModelID } : {}),
        settings: value.settings,
      }
      stored = [next]
      return next
    },
    async remove() {
      calls.push("remove")
      stored = []
    },
    async discover() {
      return { models: [], requestID: "req" }
    },
    async test() {
      return report
    },
    async detectLocal() {
      return []
    },
    async selectDefault(value) {
      calls.push("select-default")
      selectCalls += 1
      if (input.selectFailure && (!input.selectFailureAt || input.selectFailureAt === selectCalls)) {
        throw input.selectFailure
      }
      const current = stored[0] ?? profile
      const selected = { ...current, defaultModelID: value.modelID }
      stored = [selected]
      return selected
    },
    async reloadCredentials() {
      calls.push("reload")
    },
  }
  const controller = createModelCenterController({
    modelCenter: host,
    disabledProviders: () => ["openai", profile.providerID],
    currentModel: () => observedModel,
    async updateConfig(patch) {
      calls.push("update-config")
      patches.push(patch)
      updateCalls += 1
      if (input.updateFailure) throw input.updateFailure
      if (input.rollbackFailure && updateCalls === 2) throw input.rollbackFailure
      if ("model" in patch) {
        configuredModel = patch.model || undefined
        if (!input.staleCurrentModel) observedModel = configuredModel
      }
    },
    async refreshProviders() {
      calls.push("refresh")
    },
  })
  return {
    controller,
    calls,
    patches,
    stored: () => stored,
    configuredModel: () => configuredModel,
    setStored: (value: ProductProviderProfile[]) => (stored = value),
  }
}

describe("createModelCenterController", () => {
  test("saves a profile, applies a non-secret config patch, reloads, and refreshes in order", async () => {
    const fake = fixture()
    const result = await fake.controller.save(draft)

    expect(result).toEqual(profile)
    expect(fake.calls).toEqual(["save", "update-config", "reload", "refresh"])
    expect(fake.patches).toEqual([
      {
        provider: {
          [profile.providerID]: {
            npm: "@ai-sdk/openai-compatible",
            name: "Private",
            env: ["AGENT_PROFILE_PROFILE_ONE_API_KEY"],
            options: { baseURL: "{env:AGENT_PROFILE_PROFILE_ONE_PROXY_BASE_URL}", timeout: 30_000 },
            models: {
              coder: { name: "Coder", tool_call: true, limit: { context: 128_000, output: 16_000 } },
            },
          },
        },
        disabled_providers: ["openai"],
      },
    ])
    expect(JSON.stringify(fake.patches)).not.toContain("sk-test-secret")
  })

  test("disables before delete and updates the OpenCode default model", async () => {
    const removing = fixture()
    removing.setStored([profile])
    await removing.controller.remove(profile.id)
    expect(removing.calls).toEqual(["list", "update-config", "remove", "reload", "refresh"])
    expect(removing.patches[0]).toEqual({ disabled_providers: ["openai", profile.providerID] })

    const selecting = fixture()
    selecting.setStored([profile])
    expect(await selecting.controller.selectDefault({ profileID: profile.id, modelID: "coder" })).toEqual(profile)
    expect(selecting.calls).toEqual(["list", "update-config", "select-default"])
    expect(selecting.patches).toEqual([{ model: `${profile.providerID}/coder` }])
  })

  test("removes an unpublished profile and redacts config update failures", async () => {
    const fake = fixture({ updateFailure: new Error("Bearer sk-test-secret private config body") })
    await expect(fake.controller.save(draft)).rejects.toThrow("An unexpected product error occurred.")
    expect(fake.calls).toEqual(["save", "update-config", "remove"])
  })

  test("restores an existing profile's metadata when an edit cannot be applied", async () => {
    const fake = fixture({ updateFailure: new Error("private config error") })
    fake.setStored([profile])
    await expect(fake.controller.save({ ...draft, id: profile.id, name: "Renamed" })).rejects.toThrow(
      "An unexpected product error occurred.",
    )
    expect(fake.calls).toEqual(["list", "save", "update-config", "save"])
  })

  test("does not change the stored default when the global config update fails", async () => {
    const previous = {
      ...profile,
      models: [...profile.models, { id: "reasoner", name: "Reasoner", source: "manual" as const }],
    } satisfies ProductProviderProfile
    const fake = fixture({ updateFailure: new Error("private config error") })
    fake.setStored([previous])

    await expect(fake.controller.selectDefault({ profileID: profile.id, modelID: "reasoner" })).rejects.toThrow(
      "An unexpected product error occurred.",
    )

    expect(fake.calls).toEqual(["list", "update-config"])
    expect(fake.stored()[0]?.defaultModelID).toBe("coder")
    expect(fake.configuredModel()).toBe(`${profile.providerID}/coder`)
  })

  test("restores the global config when desktop default persistence fails", async () => {
    const previous = {
      ...profile,
      models: [...profile.models, { id: "reasoner", name: "Reasoner", source: "manual" as const }],
    } satisfies ProductProviderProfile
    const fake = fixture({ selectFailure: new Error("desktop storage error") })
    fake.setStored([previous])

    await expect(fake.controller.selectDefault({ profileID: profile.id, modelID: "reasoner" })).rejects.toThrow(
      "An unexpected product error occurred.",
    )

    expect(fake.calls).toEqual(["list", "update-config", "select-default", "update-config"])
    expect(fake.patches).toEqual([
      { model: `${profile.providerID}/reasoner` },
      { model: `${profile.providerID}/coder` },
    ])
    expect(fake.stored()[0]?.defaultModelID).toBe("coder")
    expect(fake.configuredModel()).toBe(`${profile.providerID}/coder`)
  })

  test("clears the global model when the first desktop default cannot be persisted", async () => {
    const fake = fixture({ selectFailure: new Error("desktop storage error"), currentModel: null })
    fake.setStored([profile])

    await expect(fake.controller.selectDefault({ profileID: profile.id, modelID: "coder" })).rejects.toThrow(
      "An unexpected product error occurred.",
    )

    expect(fake.patches).toEqual([{ model: `${profile.providerID}/coder` }, { model: "" }])
    expect(fake.configuredModel()).toBeUndefined()
  })

  test("uses the last confirmed model when server sync has not refreshed yet", async () => {
    const source = {
      ...profile,
      models: [...profile.models, { id: "reasoner", name: "Reasoner", source: "manual" as const }],
    } satisfies ProductProviderProfile
    const fake = fixture({
      selectFailure: new Error("desktop storage error"),
      selectFailureAt: 2,
      staleCurrentModel: true,
    })
    fake.setStored([source])

    await fake.controller.selectDefault({ profileID: profile.id, modelID: "reasoner" })
    await expect(fake.controller.selectDefault({ profileID: profile.id, modelID: "coder" })).rejects.toThrow(
      "An unexpected product error occurred.",
    )

    expect(fake.patches).toEqual([
      { model: `${profile.providerID}/reasoner` },
      { model: `${profile.providerID}/coder` },
      { model: `${profile.providerID}/reasoner` },
    ])
    expect(fake.configuredModel()).toBe(`${profile.providerID}/reasoner`)
  })

  test("surfaces a failed config rollback", async () => {
    const source = {
      ...profile,
      models: [...profile.models, { id: "reasoner", name: "Reasoner", source: "manual" as const }],
    } satisfies ProductProviderProfile
    const fake = fixture({
      selectFailure: new Error("desktop storage error"),
      rollbackFailure: new Error("rollback error"),
    })
    fake.setStored([source])

    await expect(fake.controller.selectDefault({ profileID: profile.id, modelID: "reasoner" })).rejects.toThrow(
      "An unexpected product error occurred.",
    )
    expect(fake.calls).toEqual(["list", "update-config", "select-default", "update-config"])
  })
})
