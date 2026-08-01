import { describe, expect, test } from "bun:test"
import type {
  ProductCapabilityReport,
  ProductLocalProviderCandidate,
  ProductModelDiscoveryResult,
  ProductProviderProfile,
  ProductProviderProfileInput,
} from "@/product/model-center"
import { createModelProfileFormController } from "./model-center-controller"

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

function fixture(input: { profile?: ProductProviderProfile } = {}) {
  const saves: ProductProviderProfileInput[] = []
  const defaults: Array<{ profileID: string; modelID: string }> = []
  let saveResolve: (() => void) | undefined
  let removeResolve: (() => void) | undefined
  const form = createModelProfileFormController({
    profile: input.profile,
    operations: {
      discover: async () => ({ models: [], requestID: "req-discover" }),
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
      models: [{ id: "old-coder", name: "Old coder", source: "discovered" }],
      requestID: "old",
    })
    await oldRequest

    expect(form.state.models.map((model) => model.id)).toEqual(["manual-coder", "new-coder"])
    form.removeModel("manual-coder")
    expect(form.state.models.map((model) => model.id)).toEqual(["new-coder"])
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
