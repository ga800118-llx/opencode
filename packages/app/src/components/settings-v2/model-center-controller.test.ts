import { describe, expect, test } from "bun:test"
import type {
  ProductCapabilityReport,
  ProductLocalProviderCandidate,
  ProductModelDiagnostic,
  ProductModelDiscoveryResult,
  ProductProviderProfile,
  ProductProviderProfileInput,
} from "@/product/model-center"
import { createModelProfileFormController, type ModelProfileOperations } from "./model-center-controller"

const agentReport = {
  modelID: "coder",
  classification: "agent-capable",
  checks: { basicChat: true, streaming: true, toolCalling: true },
  testedAt: 100,
  requestID: "req-test",
} satisfies ProductCapabilityReport

const profile = {
  id: "private-one",
  providerID: "agent-profile-private-one",
  name: "Private coder",
  kind: "openai-compatible",
  baseURL: "https://models.example.test/v1",
  hasApiKey: true,
  headers: [
    { name: "X-Team", value: "desktop", sensitive: false, hasValue: true },
    { name: "X-Secret", sensitive: true, hasValue: true },
  ],
  models: [{ id: "coder", name: "Coder", source: "manual" }],
  defaultModelID: "coder",
  settings: { timeoutMs: 30_000, contextLimit: 128_000, outputLimit: 16_000, allowInsecureTls: false },
  test: agentReport,
  createdAt: 1,
  updatedAt: 2,
} satisfies ProductProviderProfile

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function fixture(input: { profile?: ProductProviderProfile; discover?: ModelProfileOperations["discover"] } = {}) {
  const saves: ProductProviderProfileInput[] = []
  const defaults: Array<{ profileID: string; modelID: string }> = []
  let saveResolve: (() => void) | undefined
  let removeResolve: (() => void) | undefined
  const form = createModelProfileFormController({
    profile: input.profile,
    operations: {
      discover: input.discover ?? (async () => ({ models: [], requestID: "req-discover" })),
      test: async () => agentReport,
      detectLocal: async () => [],
      save: async (value) => {
        saves.push(value)
        await new Promise<void>((resolve) => {
          saveResolve = resolve
        })
        return profile
      },
      remove: async () => {
        await new Promise<void>((resolve) => {
          removeResolve = resolve
        })
      },
      selectDefault: async (value) => {
        defaults.push(value)
        return profile
      },
    },
  })
  return { form, saves, defaults, resolveSave: () => saveResolve?.(), resolveRemove: () => removeResolve?.() }
}

describe("createModelProfileFormController", () => {
  test("applies provider defaults and a detected local service", () => {
    const { form } = fixture()
    expect(form.state.kind).toBe("openai-compatible")
    expect(form.canSave()).toBe(false)

    form.setKind("ollama")
    expect(form.state.name).toBe("Ollama")
    expect(form.state.baseURL).toBe("http://127.0.0.1:11434")

    const candidate = {
      id: "lm-studio",
      kind: "lm-studio",
      name: "LM Studio",
      baseURL: "http://127.0.0.1:1234/v1",
      available: true,
      models: [{ id: "local-coder", name: "Local Coder", source: "discovered" }],
    } satisfies ProductLocalProviderCandidate
    form.applyLocalCandidate(candidate)
    expect(form.state.kind).toBe("lm-studio")
    expect(form.state.models.map((model) => model.id)).toEqual(["local-coder"])
    expect(form.canSave()).toBe(true)
  })

  test("edits safe profile fields without reading back secrets", () => {
    const { form } = fixture({ profile })
    expect(form.state.mode).toBe("edit")
    expect(form.state.apiKey).toBe("")
    expect(form.state.apiKeyPresent).toBe(true)
    expect(form.state.headers[1]).toEqual({
      name: "X-Secret",
      value: "",
      sensitive: true,
      hasValue: true,
    })

    form.setApiKey("replacement-key")
    form.setHeader(1, { value: "replacement-header" })
    const input = form.input()
    expect(input.credentials).toEqual({
      apiKey: "replacement-key",
      headers: { "X-Secret": "replacement-header" },
    })
    expect(JSON.stringify(form.state)).not.toContain("replacement-key")
  })

  test("records successful discovery feedback while reconciling manual models", async () => {
    const { form } = fixture({
      profile,
      discover: async () => ({
        models: [
          { id: "coder", name: "Discovered coder", source: "discovered" },
          { id: "reasoner", name: "Reasoner", source: "discovered" },
        ],
        requestID: "req-success",
      }),
    })

    await form.discover()

    expect(form.state.models).toEqual([
      { id: "coder", name: "Coder", source: "manual" },
      { id: "reasoner", name: "Reasoner", source: "discovered" },
    ])
    expect(form.state.selectedModelID).toBe("coder")
    expect(form.state.discoveryFeedback).toEqual({ type: "success", count: 2 })
  })

  test("selects the first reconciled model when discovery removes the previous selection", async () => {
    const fallbackProfile = {
      ...profile,
      models: [
        { id: "manual-coder", name: "Manual coder", source: "manual" },
        { id: "obsolete", name: "Obsolete", source: "discovered" },
      ],
      defaultModelID: "obsolete",
    } satisfies ProductProviderProfile
    const { form } = fixture({
      profile: fallbackProfile,
      discover: async () => ({
        models: [{ id: "new-coder", name: "New coder", source: "discovered" }],
        requestID: "req-fallback",
      }),
    })

    await form.discover()

    expect(form.state.models.map((model) => model.id)).toEqual(["manual-coder", "new-coder"])
    expect(form.state.selectedModelID).toBe("manual-coder")
  })

  test("filters models by name or ID without changing discovery feedback", async () => {
    const searchableProfile = {
      ...profile,
      models: [
        { id: "coder", name: "Code Pro", source: "manual" },
        { id: "reasoner-v2", name: "Thinker", source: "manual" },
      ],
    } satisfies ProductProviderProfile
    const { form } = fixture({ profile: searchableProfile })
    await form.discover()
    expect(form.state.discoveryFeedback).toEqual({ type: "success", count: 0 })

    form.setModelQuery("  cOdE pRo  ")
    expect(form.filteredModels().map((model) => model.id)).toEqual(["coder"])
    expect(form.state.discoveryFeedback).toEqual({ type: "success", count: 0 })

    form.setModelQuery("REASONER-V2")
    expect(form.filteredModels().map((model) => model.id)).toEqual(["reasoner-v2"])

    form.setModelQuery("   ")
    expect(form.filteredModels().map((model) => model.id)).toEqual(["coder", "reasoner-v2"])
  })

  test("preserves the complete model transaction when discovery returns a diagnostic", async () => {
    const report = { ...agentReport, modelID: "reasoner" } satisfies ProductCapabilityReport
    const diagnostic = {
      kind: "authentication",
      message: "Authentication failed.",
      requestID: "req-diagnostic",
      status: 401,
    } satisfies ProductModelDiagnostic
    const diagnosticProfile = {
      ...profile,
      models: [
        { id: "coder", name: "Coder", source: "manual" },
        { id: "reasoner", name: "Reasoner", source: "discovered" },
      ],
      defaultModelID: "reasoner",
      test: report,
    } satisfies ProductProviderProfile
    const { form } = fixture({
      profile: diagnosticProfile,
      discover: async () => ({
        models: [{ id: "replacement", name: "Replacement", source: "discovered" }],
        requestID: "req-diagnostic",
        diagnostic,
      }),
    })
    const models = form.state.models
    const selectedModelID = form.state.selectedModelID
    const capabilityReport = form.state.report

    await form.discover()

    expect(form.state.models).toBe(models)
    expect(form.state.models).toEqual(diagnosticProfile.models)
    expect(form.state.selectedModelID).toBe(selectedModelID)
    expect(form.state.report).toBe(capabilityReport)
    expect(form.state.report).toEqual(report)
    expect(form.state.discoveryFeedback).toEqual({ type: "diagnostic", diagnostic })
    expect(form.state.error).toBeUndefined()
    expect(form.state.diagnostic).toBeUndefined()
  })

  test("rejects incomplete, non-HTTP, and credential-bearing discovery endpoints", async () => {
    let calls = 0
    const { form } = fixture({
      discover: async () => {
        calls += 1
        return { models: [], requestID: "unexpected-call" }
      },
    })

    for (const baseURL of [
      "models.example.test/v1",
      "ftp://models.example.test/v1",
      "https:/models.example.test/v1",
      "https:models.example.test/v1",
      "https://user:secret@models.example.test/v1",
    ]) {
      form.setField("baseURL", baseURL)
      await expect(form.discover()).resolves.toBeUndefined()
      expect(form.state.discoveryFeedback).toEqual({ type: "invalid-endpoint" })
      expect(form.state.discovering).toBe(false)
    }
    expect(calls).toBe(0)
  })

  test("clears discovery feedback for provider inputs but not model search", async () => {
    const { form } = fixture()
    await form.discover()

    form.setModelQuery("coder")
    expect(form.state.discoveryFeedback).toEqual({ type: "success", count: 0 })

    form.setApiKey("sk-private")
    expect(form.state.discoveryFeedback).toBeUndefined()
    await form.discover()
    form.setField("baseURL", "https://other.example.test/v1")
    expect(form.state.discoveryFeedback).toBeUndefined()
    await form.discover()
    form.setKind("ollama")
    expect(form.state.discoveryFeedback).toBeUndefined()
  })

  test("invalidates in-flight discovery when provider inputs change", async () => {
    const requests = [
      deferred<ProductModelDiscoveryResult>(),
      deferred<ProductModelDiscoveryResult>(),
      deferred<ProductModelDiscoveryResult>(),
    ]
    let request = 0
    const { form } = fixture({
      profile,
      discover: () => requests[request++]!.promise,
    })

    const baseURLRequest = form.discover()
    expect(form.state.discovering).toBe(true)
    form.setField("baseURL", "https://other.example.test/v1")
    expect(form.state.discovering).toBe(false)
    requests[0].resolve({
      models: [{ id: "stale-base-url", name: "Stale base URL", source: "discovered" }],
      requestID: "stale-base-url",
    })
    await baseURLRequest
    expect(form.state.models.map((model) => model.id)).toEqual(["coder"])
    expect(form.state.discoveryFeedback).toBeUndefined()

    const apiKeyRequest = form.discover()
    expect(form.state.discovering).toBe(true)
    form.setApiKey("replacement-key")
    expect(form.state.discovering).toBe(false)
    requests[1].resolve({
      models: [{ id: "stale-api-key", name: "Stale API key", source: "discovered" }],
      requestID: "stale-api-key",
    })
    await apiKeyRequest
    expect(form.state.models.map((model) => model.id)).toEqual(["coder"])
    expect(form.state.discoveryFeedback).toBeUndefined()

    const kindRequest = form.discover()
    expect(form.state.discovering).toBe(true)
    form.setKind("ollama")
    expect(form.state.discovering).toBe(false)
    requests[2].resolve({
      models: [{ id: "stale-kind", name: "Stale kind", source: "discovered" }],
      requestID: "stale-kind",
    })
    await kindRequest
    expect(form.state.models).toEqual([])
    expect(form.state.discoveryFeedback).toBeUndefined()
  })

  test("merges discovery with manual models and ignores a stale response", async () => {
    const first = deferred<ProductModelDiscoveryResult>()
    const second = deferred<ProductModelDiscoveryResult>()
    let count = 0
    const form = createModelProfileFormController({
      operations: {
        discover: () => (++count === 1 ? first.promise : second.promise),
        test: async () => agentReport,
        detectLocal: async () => [],
        save: async () => profile,
        remove: async () => undefined,
        selectDefault: async () => profile,
      },
    })
    form.setField("name", "Private")
    form.setField("baseURL", "https://models.example.test/v1")
    form.addManualModel("manual-coder", "Manual coder")

    const oldRequest = form.discover()
    const newRequest = form.discover()
    second.resolve({
      models: [{ id: "new-coder", name: "New coder", source: "discovered" }],
      requestID: "new",
    })
    await newRequest
    first.resolve({
      models: [
        { id: "old-coder", name: "Old coder", source: "discovered" },
        { id: "old-reasoner", name: "Old reasoner", source: "discovered" },
      ],
      requestID: "old",
    })
    await oldRequest

    expect(form.state.models.map((model) => model.id)).toEqual(["manual-coder", "new-coder"])
    expect(form.state.discoveryFeedback).toEqual({ type: "success", count: 1 })
    form.removeModel("manual-coder")
    expect(form.state.models.map((model) => model.id)).toEqual(["new-coder"])
  })

  test("records unexpected discovery failures without exposing credentials", async () => {
    const { form } = fixture({
      discover: async () => {
        throw new Error("failed with sk-private")
      },
    })
    form.setApiKey("sk-private")

    await expect(form.discover()).rejects.toThrow("failed with [redacted]")

    expect(form.state.discoveryFeedback).toEqual({ type: "unexpected" })
    expect(form.state.error).toBeUndefined()
    expect(form.state.diagnostic).toBeUndefined()
    expect(JSON.stringify(form.state)).not.toContain("sk-private")
  })

  test("tests capabilities and only exposes an agent-capable model as a default", async () => {
    const { form, defaults } = fixture({ profile })
    form.selectModel("coder")
    expect(form.canSelectDefault()).toBe(true)
    await form.selectDefault()
    expect(defaults).toEqual([{ profileID: profile.id, modelID: "coder" }])

    form.setTestReport({
      ...agentReport,
      classification: "chat-only",
      checks: { basicChat: true, streaming: false, toolCalling: false },
    })
    expect(form.canSelectDefault()).toBe(false)
    await expect(form.selectDefault()).rejects.toThrow("agent-capable")
  })

  test("prevents duplicate save and delete operations and requires delete confirmation", async () => {
    const saving = fixture({ profile })
    const firstSave = saving.form.save()
    const secondSave = saving.form.save()
    expect(saving.saves).toHaveLength(1)
    expect(secondSave).toBe(firstSave)
    saving.resolveSave()
    await firstSave

    saving.form.requestDelete()
    expect(saving.form.state.deleteConfirmation).toBe(true)
    const firstDelete = saving.form.confirmDelete()
    const secondDelete = saving.form.confirmDelete()
    expect(secondDelete).toBe(firstDelete)
    saving.resolveRemove()
    await firstDelete
    expect(saving.form.state.deleteConfirmation).toBe(false)
  })

  test("cancels pending responses and redacts typed credentials from errors", async () => {
    const discovery = deferred<ProductModelDiscoveryResult>()
    const form = createModelProfileFormController({
      operations: {
        discover: () => discovery.promise,
        test: async () => agentReport,
        detectLocal: async () => [],
        save: async () => {
          throw new Error("failed with sk-private replacement-header")
        },
        remove: async () => undefined,
        selectDefault: async () => profile,
      },
    })
    form.setField("name", "Private")
    form.setField("baseURL", "https://models.example.test/v1")
    form.addManualModel("coder", "Coder")
    form.setApiKey("sk-private")
    form.addHeader({ name: "X-Secret", value: "replacement-header", sensitive: true })

    const pending = form.discover()
    form.cancel()
    discovery.resolve({
      models: [{ id: "ignored", name: "Ignored", source: "discovered" }],
      requestID: "ignored",
    })
    await pending
    expect(form.state.models.map((model) => model.id)).toEqual(["coder"])

    await expect(form.save()).rejects.toThrow("failed with [redacted] [redacted]")
    expect(form.state.error).toBe("failed with [redacted] [redacted]")
  })
})
