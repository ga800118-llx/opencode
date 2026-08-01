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

function fixture(input: { updateFailure?: Error } = {}) {
  const calls: string[] = []
  const patches: unknown[] = []
  let stored: ProductProviderProfile[] = []
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
      const next = { ...profile, ...(value.id ? { id: value.id } : {}), name: value.name }
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
    async selectDefault() {
      calls.push("select-default")
      return profile
    },
    async reloadCredentials() {
      calls.push("reload")
    },
  }
  const controller = createModelCenterController({
    modelCenter: host,
    disabledProviders: () => ["openai", profile.providerID],
    async updateConfig(patch) {
      calls.push("update-config")
      patches.push(patch)
      if (input.updateFailure) throw input.updateFailure
    },
    async refreshProviders() {
      calls.push("refresh")
    },
  })
  return { controller, calls, patches, setStored: (value: ProductProviderProfile[]) => (stored = value) }
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
    expect(selecting.calls).toEqual(["list", "select-default", "update-config", "refresh"])
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
})
