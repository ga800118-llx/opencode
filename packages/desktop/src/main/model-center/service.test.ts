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
  let profileWriteFailure: Error | undefined
  let uuid = 0
  let time = 10
  const profiles = createProfileRepository({
    store: {
      get: (key) => profileValues.get(key),
      set(key, value) {
        if (profileWriteFailure) {
          const error = profileWriteFailure
          profileWriteFailure = undefined
          throw error
        }
        profileValues.set(key, value)
      },
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
  return {
    service,
    profiles,
    credentialValues,
    targets,
    candidates,
    reloads: () => reloads,
    failNextProfileWrite: (error = new Error("profile store unavailable")) => (profileWriteFailure = error),
  }
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

  test("restores an absent default after retrying a failed compensating restart", async () => {
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
        if (observedModels.length === 1) throw new Error("primary restart failed")
        if (observedModels.length === 2) throw new Error("compensating restart failed")
      })
    }

    await expect(fake.service.selectDefault({ profileID: profile.id, modelID: "reviewer" })).rejects.toThrow(
      "primary restart failed",
    )

    expect(fake.reloads()).toBe(3)
    expect(observedModels).toEqual([
      `${profile.providerID}/reviewer`,
      `${profile.providerID}/coder`,
      `${profile.providerID}/coder`,
    ])
    expect(fake.profiles.defaultSelection()).toBeUndefined()
    expect(fake.profiles.get(profile.id)?.defaultModelID).toBe("coder")
    expect(JSON.parse(await readFile(paths.modelConfig, "utf8")).model).toBe(`${profile.providerID}/coder`)
    expect(JSON.parse(await readFile(paths.manifest, "utf8")).selectedModel).toBe(`${profile.providerID}/coder`)
  })

  test("retries a transient compensating write failure and preserves the primary restart error", async () => {
    const paths = await serviceRuntimePaths()
    let reloadRuntime: () => Promise<void> = async () => undefined
    const fake = fixture({ reloadCredentials: () => reloadRuntime() })
    const profile = await fake.service.save({
      ...draft,
      models: [...draft.models, { id: "reviewer", name: "Reviewer", source: "manual" }],
    })
    fake.profiles.selectDefault({ profileID: profile.id, modelID: "coder" })
    let failCompensationWrite = false
    let restarts = 0
    const primary = new Error("primary restart failed")
    const coordinator = createProductRuntimeConfigCoordinator({
      paths,
      profiles: fake.profiles.list,
      defaultSelection: fake.profiles.defaultSelection,
      presentProfile: (item) => item,
      fileSystem: {
        rename: async (source, destination) => {
          if (destination === paths.modelConfig && failCompensationWrite) {
            failCompensationWrite = false
            throw new Error("transient compensation write failed")
          }
          await rename(source, destination)
        },
      },
    })
    await coordinator.write()
    reloadRuntime = async () => {
      await coordinator.reload(async () => {
        restarts += 1
        if (restarts !== 1) return
        failCompensationWrite = true
        throw primary
      })
    }

    const failure = await fake.service.selectDefault({ profileID: profile.id, modelID: "reviewer" }).then(
      () => undefined,
      (error: unknown) => error,
    )

    expect(failure).toBe(primary)
    expect(fake.reloads()).toBe(3)
    expect(restarts).toBe(2)
    expect(fake.profiles.defaultSelection()).toEqual({ profileID: profile.id, modelID: "coder" })
    expect(JSON.parse(await readFile(paths.modelConfig, "utf8")).model).toBe(`${profile.providerID}/coder`)
    expect(JSON.parse(await readFile(paths.manifest, "utf8")).selectedModel).toBe(`${profile.providerID}/coder`)
  })

  test("reports an unreconciled runtime after persistent compensation failures", async () => {
    const paths = await serviceRuntimePaths()
    let reloadRuntime: () => Promise<void> = async () => undefined
    const fake = fixture({ reloadCredentials: () => reloadRuntime() })
    const profile = await fake.service.save({
      ...draft,
      models: [...draft.models, { id: "reviewer", name: "Reviewer", source: "manual" }],
    })
    fake.profiles.selectDefault({ profileID: profile.id, modelID: "coder" })
    let compensation = false
    let compensationFailures = 0
    const primary = new Error("primary restart failed")
    const coordinator = createProductRuntimeConfigCoordinator({
      paths,
      profiles: fake.profiles.list,
      defaultSelection: fake.profiles.defaultSelection,
      presentProfile: (item) => item,
      fileSystem: {
        rename: async (source, destination) => {
          if (destination === paths.modelConfig && compensation) {
            compensationFailures += 1
            throw new Error(`compensation write failed ${compensationFailures}`)
          }
          await rename(source, destination)
        },
      },
    })
    await coordinator.write()
    reloadRuntime = async () => {
      await coordinator.reload(async () => {
        compensation = true
        throw primary
      })
    }

    const failure = await fake.service.selectDefault({ profileID: profile.id, modelID: "reviewer" }).then(
      () => undefined,
      (error: unknown) => error,
    )

    expect(failure).toBeInstanceOf(AggregateError)
    if (!(failure instanceof AggregateError)) throw new Error("aggregate error required")
    expect(failure.message).toBe(
      "The model selection rollback could not be reconciled with the model runtime. Restart the application before using models.",
    )
    expect(failure.cause).toBe(primary)
    expect(failure.errors[0]).toBe(primary)
    expect(failure.errors.slice(1).map((error) => (error instanceof Error ? error.message : String(error)))).toEqual([
      "compensation write failed 1",
      "compensation write failed 2",
    ])
    expect(fake.reloads()).toBe(3)
    expect(fake.profiles.defaultSelection()).toEqual({ profileID: profile.id, modelID: "coder" })
    expect(JSON.parse(await readFile(paths.modelConfig, "utf8")).model).toBe(`${profile.providerID}/reviewer`)
    expect(JSON.parse(await readFile(paths.manifest, "utf8")).selectedModel).toBe(`${profile.providerID}/reviewer`)
  })

  test("continues reconciliation when the first repository rollback write fails", async () => {
    const paths = await serviceRuntimePaths()
    let reloadRuntime: () => Promise<void> = async () => undefined
    const fake = fixture({ reloadCredentials: () => reloadRuntime() })
    const profile = await fake.service.save({
      ...draft,
      models: [...draft.models, { id: "reviewer", name: "Reviewer", source: "manual" }],
    })
    fake.profiles.selectDefault({ profileID: profile.id, modelID: "coder" })
    const observedModels: string[] = []
    const primary = new Error("primary restart failed")
    const coordinator = createProductRuntimeConfigCoordinator({
      paths,
      profiles: fake.profiles.list,
      defaultSelection: fake.profiles.defaultSelection,
      presentProfile: (item) => item,
    })
    await coordinator.write()
    reloadRuntime = async () => {
      await coordinator.reload(async () => {
        observedModels.push(JSON.parse(await readFile(paths.modelConfig, "utf8")).model)
        if (observedModels.length !== 1) return
        fake.failNextProfileWrite()
        throw primary
      })
    }

    const failure = await fake.service.selectDefault({ profileID: profile.id, modelID: "reviewer" }).then(
      () => undefined,
      (error: unknown) => error,
    )

    expect(failure).toBe(primary)
    expect(observedModels).toEqual([
      `${profile.providerID}/reviewer`,
      `${profile.providerID}/reviewer`,
      `${profile.providerID}/coder`,
    ])
    expect(fake.profiles.defaultSelection()).toEqual({ profileID: profile.id, modelID: "coder" })
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

  test("serializes save, remove, and test mutations behind default rollback", async () => {
    const paths = await serviceRuntimePaths()
    let reloadRuntime: () => Promise<void> = async () => undefined
    const fake = fixture({ reloadCredentials: () => reloadRuntime() })
    const selected = await fake.service.save({
      ...draft,
      name: "Selected",
      models: [...draft.models, { id: "reviewer", name: "Reviewer", source: "manual" }],
    })
    const removed = await fake.service.save({ ...draft, name: "Removed" })
    const tested = await fake.service.save({ ...draft, name: "Tested" })
    fake.profiles.selectDefault({ profileID: selected.id, modelID: "coder" })
    const restartStarted = Promise.withResolvers<void>()
    const allowRestartFailure = Promise.withResolvers<void>()
    let restarts = 0
    const primary = new Error("delayed restart failed")
    const coordinator = createProductRuntimeConfigCoordinator({
      paths,
      profiles: fake.profiles.list,
      defaultSelection: fake.profiles.defaultSelection,
      presentProfile: (item) => item,
    })
    await coordinator.write()
    reloadRuntime = async () => {
      await coordinator.reload(async () => {
        restarts += 1
        if (restarts !== 1) return
        restartStarted.resolve()
        await allowRestartFailure.promise
        throw primary
      })
    }

    const selection = fake.service.selectDefault({ profileID: selected.id, modelID: "reviewer" })
    await restartStarted.promise
    const saving = fake.service.save({ ...draft, name: "Queued Save" })
    const removing = fake.service.remove(removed.id)
    const testing = fake.service.test({ profileID: tested.id, modelID: "coder" })
    await Promise.resolve()
    const reloading = fake.service.reloadCredentials()

    expect(fake.profiles.list().some((profile) => profile.name === "Queued Save")).toBeFalse()
    expect(fake.profiles.get(removed.id)).toBeDefined()
    expect(fake.profiles.get(tested.id)?.test).toBeUndefined()
    expect(restarts).toBe(1)

    allowRestartFailure.resolve()
    expect(
      await selection.then(
        () => undefined,
        (error: unknown) => error,
      ),
    ).toBe(primary)
    const [saved, , report] = await Promise.all([saving, removing, testing])
    await reloading

    expect(fake.profiles.defaultSelection()).toEqual({ profileID: selected.id, modelID: "coder" })
    expect(fake.profiles.get(selected.id)?.defaultModelID).toBe("coder")
    expect(fake.profiles.get(saved.id)).toEqual(saved)
    expect(fake.profiles.get(removed.id)).toBeUndefined()
    expect(fake.profiles.get(tested.id)?.test).toEqual(report)
    const overlay = JSON.parse(await readFile(paths.modelConfig, "utf8"))
    expect(Object.keys(overlay.provider).sort()).toEqual(
      [selected.providerID, saved.providerID, tested.providerID].sort(),
    )
    expect(overlay.model).toBe(`${selected.providerID}/coder`)
    expect(JSON.parse(await readFile(paths.manifest, "utf8"))).toMatchObject({
      counts: { profiles: 3, providers: 3, models: 4 },
      selectedModel: `${selected.providerID}/coder`,
    })
    expect(restarts).toBe(3)
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
