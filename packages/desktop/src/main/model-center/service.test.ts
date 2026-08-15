import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rename, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type {
  ProductCapabilityReport,
  ProductLocalProviderCandidate,
  ProductProviderProfileInput,
} from "@opencode-ai/app/product/model-center"
import { createDesktopRuntimePaths, ensureDesktopRuntime } from "../runtime-environment"
import type { ProductCredentialEnvelope, ProductCredentialService } from "./credentials"
import type { LocalModelDetector } from "./local-detection"
import { MODEL_PROBE_TIMEOUT_MS, type ModelProbe, type ModelProbeTarget } from "./probe"
import { createProfileRepository } from "./profiles"
import { createProductRuntimeConfigCoordinator } from "./runtime-config"
import { createModelCenterService } from "./service"

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

const draft = {
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
  credentials: { apiKey: "sk-test-secret", headers: { "X-Secret": "Bearer secret-header" } },
} satisfies ProductProviderProfileInput

function fixture(
  input: {
    failCredentialWrite?: boolean
    classification?: ProductCapabilityReport["classification"]
    reloadCredentials?: () => Promise<void>
  } = {},
) {
  const profileValues = new Map<string, unknown>()
  let uuid = 0
  let time = 10
  const profiles = createProfileRepository({
    store: {
      get: (key) => profileValues.get(key),
      set: (key, value) => profileValues.set(key, value),
    },
    now: () => time++,
    randomUUID: () => `profile-${++uuid}`,
  })
  const credentialValues = new Map<string, ProductCredentialEnvelope>()
  const credentials: ProductCredentialService = {
    capabilities: () => ({
      namespace: "dev.agent.desktop.credentials",
      backend: "macos-keychain",
      available: true,
      operations: { read: true, write: true, delete: true },
    }),
    has: (reference) => credentialValues.has(reference),
    read: (reference) => credentialValues.get(reference),
    write(reference, value) {
      if (input.failCredentialWrite) throw new Error("raw credential write failure")
      credentialValues.set(reference, value)
    },
    delete: (reference) => {
      credentialValues.delete(reference)
    },
  }
  const targets: ModelProbeTarget[] = []
  const report = {
    modelID: "coder",
    classification: input.classification ?? "agent-capable",
    checks: { basicChat: true, streaming: true, toolCalling: input.classification !== "chat-only" },
    testedAt: 100,
    requestID: "req-test",
  } satisfies ProductCapabilityReport
  const probe: ModelProbe = {
    discover: async (target) => {
      targets.push(target)
      return { models: [{ id: "coder", name: "Coder", source: "discovered" }], requestID: "req-discover" }
    },
    test: async ({ target }) => {
      targets.push(target)
      return report
    },
  }
  const candidates: ProductLocalProviderCandidate[] = [
    {
      id: "ollama",
      kind: "ollama",
      name: "Ollama",
      baseURL: "http://127.0.0.1:11434",
      available: true,
      models: [],
    },
  ]
  const detector: LocalModelDetector = { detect: async () => candidates }
  let reloads = 0
  const service = createModelCenterService({
    profiles,
    credentials,
    probe,
    detector,
    reloadCredentials: async () => {
      reloads += 1
      await input.reloadCredentials?.()
    },
  })
  return { service, profiles, credentialValues, targets, candidates, reloads: () => reloads }
}

describe("createModelCenterService", () => {
  test("saves renderer-safe profiles and preserves credentials across metadata edits", async () => {
    const fake = fixture()
    const profile = await fake.service.save(draft)

    const draftReport = await fake.service.test({
      draft: { ...draft, id: profile.id, credentials: undefined },
      modelID: "coder",
    })
    expect(fake.profiles.get(profile.id)?.test).toEqual(draftReport)
    expect(await fake.service.save({ ...draft, id: profile.id, credentials: undefined })).toMatchObject({
      test: draftReport,
    })

    expect(profile).toMatchObject({
      id: "profile-1",
      providerID: "agent-profile-profile-1",
      credentialRef: "model-profile:profile-1",
      hasApiKey: true,
    })
    expect(JSON.stringify(profile)).not.toContain("sk-test-secret")
    expect(JSON.stringify(profile)).not.toContain("Bearer secret-header")
    expect(fake.credentialValues.get("model-profile:profile-1")).toEqual({
      apiKey: "sk-test-secret",
      headers: { "X-Secret": "Bearer secret-header" },
    })

    const edited = await fake.service.save({ ...draft, id: profile.id, name: "Renamed", credentials: undefined })
    expect(edited.name).toBe("Renamed")
    expect(fake.credentialValues.get("model-profile:profile-1")?.apiKey).toBe("sk-test-secret")
    expect(await fake.service.list()).toEqual([edited])

    await fake.service.test({
      draft: { ...draft, id: profile.id, name: "Unsaved name", credentials: undefined },
      modelID: "coder",
    })
    expect(fake.targets.at(-1)).toMatchObject({
      apiKey: "sk-test-secret",
      headers: { "X-Secret": "Bearer secret-header" },
    })
    expect(fake.profiles.get(profile.id)?.name).toBe("Renamed")
  })

  test("uses decrypted credentials only inside discovery and test targets", async () => {
    const fake = fixture()
    const profile = await fake.service.save(draft)

    const discovery = await fake.service.discover({ profileID: profile.id })
    const tested = await fake.service.test({ profileID: profile.id, modelID: "coder" })

    expect(discovery.models).toHaveLength(1)
    expect(tested.classification).toBe("agent-capable")
    expect(fake.targets).toEqual([
      {
        kind: "openai-compatible",
        baseURL: "https://models.example.test/v1",
        apiKey: "sk-test-secret",
        headers: { "X-Tenant": "alpha", "X-Secret": "Bearer secret-header" },
        timeoutMs: MODEL_PROBE_TIMEOUT_MS,
      },
      {
        kind: "openai-compatible",
        baseURL: "https://models.example.test/v1",
        apiKey: "sk-test-secret",
        headers: { "X-Tenant": "alpha", "X-Secret": "Bearer secret-header" },
        timeoutMs: MODEL_PROBE_TIMEOUT_MS,
      },
    ])
    expect(fake.profiles.get(profile.id)?.test).toEqual(tested)
    expect(JSON.stringify(discovery)).not.toContain("secret")
    expect(JSON.stringify(tested)).not.toContain("secret")
  })

  test("invalidates capability reports when saved credentials change", async () => {
    const fake = fixture()
    const profile = await fake.service.save(draft)
    await fake.service.test({ profileID: profile.id, modelID: "coder" })

    const apiKeyChanged = await fake.service.save({
      ...draft,
      id: profile.id,
      credentials: { apiKey: "sk-replacement" },
    })
    expect(apiKeyChanged.test).toBeUndefined()

    await fake.service.test({ profileID: profile.id, modelID: "coder" })
    const headerChanged = await fake.service.save({
      ...draft,
      id: profile.id,
      credentials: { headers: { "X-Secret": "Bearer replacement" } },
    })
    expect(headerChanged.test).toBeUndefined()
  })

  test("supports inline discovery, local detection, default selection, reload, and delete", async () => {
    const fake = fixture()
    const inline = await fake.service.discover({ draft })
    expect(inline.models).toHaveLength(1)
    expect(await fake.service.detectLocal()).toEqual(fake.candidates)

    const profile = await fake.service.save(draft)
    await fake.service.test({ profileID: profile.id, modelID: "coder" })
    expect(await fake.service.selectDefault({ profileID: profile.id, modelID: "coder" })).toMatchObject({
      defaultModelID: "coder",
    })
    await fake.service.reloadCredentials()
    expect(fake.reloads()).toBe(2)

    await fake.service.remove(profile.id)
    expect(await fake.service.list()).toEqual([])
    expect(fake.credentialValues.size).toBe(0)
  })

  test("selecting a second default model updates the profile and reloads the runtime once", async () => {
    const fake = fixture()
    const profile = await fake.service.save({
      ...draft,
      models: [...draft.models, { id: "reviewer", name: "Reviewer", source: "manual" }],
    })

    const selected = await fake.service.selectDefault({ profileID: profile.id, modelID: "reviewer" })

    expect(selected.defaultModelID).toBe("reviewer")
    expect(fake.profiles.defaultSelection()).toEqual({ profileID: profile.id, modelID: "reviewer" })
    expect(fake.profiles.get(profile.id)?.defaultModelID).toBe("reviewer")
    expect(fake.reloads()).toBe(1)
  })

  test("restores the previous default and overlay when the runtime write fails", async () => {
    const paths = await serviceRuntimePaths()
    let reloadRuntime: () => Promise<void> = async () => undefined
    const fake = fixture({ reloadCredentials: () => reloadRuntime() })
    const profile = await fake.service.save({
      ...draft,
      models: [...draft.models, { id: "reviewer", name: "Reviewer", source: "manual" }],
    })
    fake.profiles.selectDefault({ profileID: profile.id, modelID: "coder" })
    let failWrite = false
    let restarts = 0
    const coordinator = createProductRuntimeConfigCoordinator({
      paths,
      profiles: fake.profiles.list,
      defaultSelection: fake.profiles.defaultSelection,
      presentProfile: (item) => item,
      fileSystem: {
        rename: async (source, destination) => {
          if (destination === paths.modelConfig && failWrite) {
            failWrite = false
            throw new Error("runtime config write failed")
          }
          await rename(source, destination)
        },
      },
    })
    await coordinator.write()
    reloadRuntime = async () => {
      await coordinator.reload(async () => {
        restarts += 1
      })
    }
    failWrite = true

    await expect(fake.service.selectDefault({ profileID: profile.id, modelID: "reviewer" })).rejects.toThrow(
      "runtime config write failed",
    )

    expect(fake.reloads()).toBe(2)
    expect(restarts).toBe(1)
    expect(fake.profiles.defaultSelection()).toEqual({ profileID: profile.id, modelID: "coder" })
    expect(fake.profiles.get(profile.id)?.defaultModelID).toBe("coder")
    expect(JSON.parse(await readFile(paths.modelConfig, "utf8")).model).toBe(`${profile.providerID}/coder`)
    expect(JSON.parse(await readFile(paths.manifest, "utf8")).selectedModel).toBe(`${profile.providerID}/coder`)
  })

  test("restores an absent default and old overlay when primary and compensating restarts fail", async () => {
    const paths = await serviceRuntimePaths()
    let reloadRuntime: () => Promise<void> = async () => undefined
    const fake = fixture({ reloadCredentials: () => reloadRuntime() })
    const profile = await fake.service.save({
      ...draft,
      models: [...draft.models, { id: "reviewer", name: "Reviewer", source: "manual" }],
    })
    const coordinator = createProductRuntimeConfigCoordinator({
      paths,
      profiles: fake.profiles.list,
      defaultSelection: fake.profiles.defaultSelection,
      presentProfile: (item) => item,
    })
    await coordinator.write()
    const observedModels: string[] = []
    reloadRuntime = async () => {
      await coordinator.reload(async () => {
        observedModels.push(JSON.parse(await readFile(paths.modelConfig, "utf8")).model)
        throw new Error(observedModels.length === 1 ? "primary restart failed" : "compensating restart failed")
      })
    }

    await expect(fake.service.selectDefault({ profileID: profile.id, modelID: "reviewer" })).rejects.toThrow(
      "primary restart failed",
    )

    expect(fake.reloads()).toBe(2)
    expect(observedModels).toEqual([`${profile.providerID}/reviewer`, `${profile.providerID}/coder`])
    expect(fake.profiles.defaultSelection()).toBeUndefined()
    expect(fake.profiles.get(profile.id)?.defaultModelID).toBe("coder")
    expect(JSON.parse(await readFile(paths.modelConfig, "utf8")).model).toBe(`${profile.providerID}/coder`)
    expect(JSON.parse(await readFile(paths.manifest, "utf8")).selectedModel).toBe(`${profile.providerID}/coder`)
  })

  test("serializes concurrent default transactions so a rollback cannot clobber a newer selection", async () => {
    const firstReloadStarted = Promise.withResolvers<void>()
    const allowFirstFailure = Promise.withResolvers<void>()
    let reloadCalls = 0
    const fake = fixture({
      reloadCredentials: async () => {
        reloadCalls += 1
        if (reloadCalls !== 1) return
        firstReloadStarted.resolve()
        await allowFirstFailure.promise
        throw new Error("first selection failed")
      },
    })
    const profile = await fake.service.save({
      ...draft,
      models: [
        ...draft.models,
        { id: "reviewer", name: "Reviewer", source: "manual" },
        { id: "analyst", name: "Analyst", source: "manual" },
      ],
    })
    fake.profiles.selectDefault({ profileID: profile.id, modelID: "coder" })

    const first = fake.service.selectDefault({ profileID: profile.id, modelID: "reviewer" })
    await firstReloadStarted.promise
    const second = fake.service.selectDefault({ profileID: profile.id, modelID: "analyst" })
    await Promise.resolve()
    expect(fake.profiles.defaultSelection()).toEqual({ profileID: profile.id, modelID: "reviewer" })

    allowFirstFailure.resolve()
    await expect(first).rejects.toThrow("first selection failed")
    const selected = await second

    expect(selected.defaultModelID).toBe("analyst")
    expect(fake.reloads()).toBe(3)
    expect(fake.profiles.defaultSelection()).toEqual({ profileID: profile.id, modelID: "analyst" })
  })

  test("allows untested and non-agent-capable models as defaults", async () => {
    const untested = fixture()
    const untestedProfile = await untested.service.save(draft)
    expect(await untested.service.selectDefault({ profileID: untestedProfile.id, modelID: "coder" })).toMatchObject({
      defaultModelID: "coder",
    })

    const partial = fixture({ classification: "chat-only" })
    const partialProfile = await partial.service.save(draft)
    await partial.service.test({ profileID: partialProfile.id, modelID: "coder" })
    expect(await partial.service.selectDefault({ profileID: partialProfile.id, modelID: "coder" })).toMatchObject({
      defaultModelID: "coder",
    })
  })

  test("rolls back unpublished profiles on credential failure", async () => {
    const failing = fixture({ failCredentialWrite: true })
    expect(failing.service.save(draft)).rejects.toThrow("The model credentials could not be saved.")
    expect(await failing.service.list()).toEqual([])
  })

  test("reports host capabilities without exposing the credential namespace", async () => {
    const fake = fixture()
    expect(await fake.service.capabilities()).toEqual({
      available: true,
      credentialBackend: "macos-keychain",
      credentialOperations: { read: true, write: true, delete: true },
      localDetection: true,
    })
  })
})

async function serviceRuntimePaths() {
  const directory = await mkdtemp(join(tmpdir(), "guai-code-service-runtime-"))
  temporaryDirectories.push(directory)
  const paths = createDesktopRuntimePaths(join(directory, "user-data"))
  await ensureDesktopRuntime(paths)
  return paths
}
