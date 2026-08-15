import { describe, expect, test } from "bun:test"
import {
  MODEL_RUNTIME_UNRECONCILED,
  type ProductCapabilityReport,
  type ProductModelCenterAPI,
  type ProductProviderProfile,
  type ProductProviderProfileInput,
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
  models: [
    { id: "coder", name: "Coder", source: "manual" },
    { id: "reasoner", name: "Reasoner", source: "manual" },
  ],
  defaultModelID: "coder",
  settings: { contextLimit: 128_000, outputLimit: 16_000, allowInsecureTls: false },
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

type Operation =
  | "capabilities"
  | "list"
  | "save"
  | "remove"
  | "discover"
  | "test"
  | "detectLocal"
  | "selectDefault"
  | "reloadCredentials"
  | "refreshRuntime"

function fixture(
  input: {
    failure?: { operation: Operation; error: Error }
    stored?: readonly ProductProviderProfile[]
  } = {},
) {
  const calls: unknown[][] = []
  let stored = [...(input.stored ?? [])]
  const fail = (operation: Operation) => {
    if (input.failure?.operation === operation) throw input.failure.error
  }
  const modelCenter: ProductModelCenterAPI = {
    async capabilities() {
      calls.push(["capabilities"])
      fail("capabilities")
      return {
        available: true,
        credentialBackend: "macos-keychain",
        credentialOperations: { read: true, write: true, delete: true },
        localDetection: true,
      }
    },
    async list() {
      calls.push(["list"])
      fail("list")
      return stored
    },
    async save(value) {
      calls.push(["save", value])
      fail("save")
      const saved = {
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
      stored = [saved]
      return saved
    },
    async remove(profileID) {
      calls.push(["remove", profileID])
      fail("remove")
      stored = stored.filter((item) => item.id !== profileID)
    },
    async discover(value) {
      calls.push(["discover", value])
      fail("discover")
      return { models: [], requestID: "req-discover" }
    },
    async test(value) {
      calls.push(["test", value])
      fail("test")
      return report
    },
    async detectLocal() {
      calls.push(["detectLocal"])
      fail("detectLocal")
      return []
    },
    async selectDefault(value) {
      calls.push(["selectDefault", value])
      fail("selectDefault")
      const selected = { ...(stored[0] ?? profile), defaultModelID: value.modelID }
      stored = [selected]
      return selected
    },
    async reloadCredentials() {
      calls.push(["reloadCredentials"])
      fail("reloadCredentials")
    },
  }
  const controller = createModelCenterController({
    modelCenter,
    async refreshRuntime() {
      calls.push(["refreshRuntime"])
      fail("refreshRuntime")
    },
  })
  return { controller, calls, stored: () => stored }
}

describe("createModelCenterController", () => {
  test("safe-normalizes read-only operations", async () => {
    const failure = new Error("Bearer sk-test-secret private response")

    for (const operation of ["capabilities", "list", "discover", "test", "detectLocal"] as const) {
      const fake = fixture({ failure: { operation, error: failure } })
      const result =
        operation === "capabilities"
          ? fake.controller.capabilities()
          : operation === "list"
            ? fake.controller.list()
            : operation === "discover"
              ? fake.controller.discover({ draft })
              : operation === "test"
                ? fake.controller.test({
                    draft,
                    modelID: "coder",
                  })
                : fake.controller.detectLocal()

      await expect(result).rejects.toThrow(
        "An unexpected product error occurred. Retry once; if it continues, report the safe diagnostic fields.",
      )
      await expect(result).rejects.not.toThrow("sk-test-secret")
    }
  })

  test("saves, reloads credentials, and refreshes the runtime in order", async () => {
    const fake = fixture()

    expect(await fake.controller.save(draft)).toEqual(profile)
    expect(fake.calls).toEqual([["save", draft], ["reloadCredentials"], ["refreshRuntime"]])
  })

  test("removes, reloads credentials, and refreshes the runtime without listing first", async () => {
    const fake = fixture({ stored: [profile] })

    await fake.controller.remove(profile.id)

    expect(fake.calls).toEqual([["remove", profile.id], ["reloadCredentials"], ["refreshRuntime"]])
    expect(fake.stored()).toEqual([])
  })

  test("selects the default and refreshes the runtime without reloading credentials", async () => {
    const fake = fixture({ stored: [profile] })
    const input = { profileID: profile.id, modelID: "reasoner" }

    expect(await fake.controller.selectDefault(input)).toEqual({ ...profile, defaultModelID: "reasoner" })
    expect(fake.calls).toEqual([["selectDefault", input], ["refreshRuntime"]])
  })

  test("skips reload and refresh when a host mutation fails", async () => {
    const save = fixture({ failure: { operation: "save", error: new Error("private save failure") } })
    await expect(save.controller.save(draft)).rejects.toThrow("An unexpected product error occurred.")
    expect(save.calls).toEqual([["save", draft]])

    const remove = fixture({
      failure: { operation: "remove", error: new Error("private remove failure") },
      stored: [profile],
    })
    await expect(remove.controller.remove(profile.id)).rejects.toThrow("An unexpected product error occurred.")
    expect(remove.calls).toEqual([["remove", profile.id]])

    const input = { profileID: profile.id, modelID: "reasoner" }
    const select = fixture({
      failure: { operation: "selectDefault", error: new Error("private select failure") },
      stored: [profile],
    })
    await expect(select.controller.selectDefault(input)).rejects.toThrow("An unexpected product error occurred.")
    expect(select.calls).toEqual([["selectDefault", input]])
  })

  test("skips refresh when the host credential reload fails", async () => {
    const fake = fixture({ failure: { operation: "reloadCredentials", error: new Error("private reload failure") } })

    await expect(fake.controller.save(draft)).rejects.toThrow(
      "An unexpected product error occurred. Retry once; if it continues, report the safe diagnostic fields.",
    )
    expect(fake.calls).toEqual([["save", draft], ["reloadCredentials"]])
    expect(fake.stored()).toEqual([profile])
  })

  test("normalizes refresh failures without rolling back host mutations", async () => {
    const failure = {
      operation: "refreshRuntime",
      error: new Error("Bearer sk-test-secret private refresh failure"),
    } as const

    const save = fixture({ failure })
    await expect(save.controller.save(draft)).rejects.toThrow(
      "An unexpected product error occurred. Retry once; if it continues, report the safe diagnostic fields.",
    )
    expect(save.calls).toEqual([["save", draft], ["reloadCredentials"], ["refreshRuntime"]])
    expect(save.stored()).toEqual([profile])

    const remove = fixture({ failure, stored: [profile] })
    await expect(remove.controller.remove(profile.id)).rejects.toThrow("An unexpected product error occurred.")
    expect(remove.calls).toEqual([["remove", profile.id], ["reloadCredentials"], ["refreshRuntime"]])
    expect(remove.stored()).toEqual([])

    const input = { profileID: profile.id, modelID: "reasoner" }
    const select = fixture({ failure, stored: [profile] })
    await expect(select.controller.selectDefault(input)).rejects.toThrow("An unexpected product error occurred.")
    expect(select.calls).toEqual([["selectDefault", input], ["refreshRuntime"]])
    expect(select.stored()[0]?.defaultModelID).toBe("reasoner")
    expect(JSON.stringify(select.calls)).not.toContain("sk-test-secret")
  })

  test("surfaces restart guidance for an Electron-serialized unreconciled runtime", async () => {
    const input = { profileID: profile.id, modelID: "reasoner" }
    const fake = fixture({
      failure: {
        operation: "selectDefault",
        error: new Error(
          `Error invoking remote method 'model-center-select-default': ${MODEL_RUNTIME_UNRECONCILED}: internal provider response`,
        ),
      },
      stored: [profile],
    })

    await expect(fake.controller.selectDefault(input)).rejects.toThrow(
      "The model runtime could not be restored. Restart the application before using models.",
    )
    expect(fake.calls).toEqual([["selectDefault", input]])
  })
})
