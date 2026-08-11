import { describe, expect, test } from "bun:test"
import {
  enableProviderPatch,
  profileCredentialEnvironment,
  profileCredentialProxyBaseURLEnvironment,
  profileSensitiveHeaderEnvironment,
  type ProductProviderProfileInput,
} from "@opencode-ai/app/product/model-center"
import { createDesktopProductHost, createUnmanagedSidecarStatus } from "../../product/host"
import { createCredentialService } from "./credentials"
import { createSensitiveHeaderCredentialProxy } from "./credential-proxy"
import { createModelCredentialEnvironment } from "./environment"
import { createModelProbe } from "./probe"
import { createProfileRepository } from "./profiles"
import { createModelCenterService } from "./service"

const API_CANARY = "phase2-api-key-canary"
const HEADER_CANARY = "phase2-header-canary"

const draft = {
  name: "Canary Private Gateway",
  kind: "openai-compatible",
  baseURL: "https://models.example.test/v1",
  headers: [
    { name: "X-Tenant", value: "phase-two", sensitive: false, hasValue: true },
    { name: "X-Private-Token", sensitive: true, hasValue: true },
  ],
  models: [{ id: "canary-coder", name: "Canary Coder", source: "manual" }],
  settings: { contextLimit: 64_000, outputLimit: 8_000, allowInsecureTls: false },
  credentials: { apiKey: API_CANARY, headers: { "X-Private-Token": HEADER_CANARY } },
} satisfies ProductProviderProfileInput

describe("model-center secret boundary", () => {
  test("keeps plaintext canaries out of stores, IPC responses, logs, and config patches", async () => {
    const profileValues = new Map<string, unknown>()
    const credentialValues = new Map<string, unknown>()
    const warnings: unknown[] = []
    const proxyValues = new Map<string, unknown>()
    const transportCredentials: Array<{ authorization: string | null; privateHeader: string | null }> = []

    const safeStorage = {
      isEncryptionAvailable: () => true,
      encryptString: (plainText: string) => Buffer.from(plainText).map((byte) => byte ^ 0xa5),
      decryptString: (encrypted: Buffer) => Buffer.from(encrypted).map((byte) => byte ^ 0xa5).toString(),
    }
    const credentials = createCredentialService({
      namespace: "dev.agent.desktop.credentials",
      platform: "darwin",
      safeStorage,
      store: {
        get: (key) => credentialValues.get(key),
        set: (key, value) => credentialValues.set(key, value),
        delete: (key) => credentialValues.delete(key),
      },
    })
    const profiles = createProfileRepository({
      store: {
        get: (key) => profileValues.get(key),
        set: (key, value) => profileValues.set(key, value),
      },
      now: () => 1_722_470_400_000,
      randomUUID: () => "canary-profile",
    })
    const probe = createModelProbe({
      now: () => 1_722_470_400_100,
      requestID: () => "canary-request",
      fetch: async (input, init) => {
        const request = new Request(input, init)
        transportCredentials.push({
          authorization: request.headers.get("authorization"),
          privateHeader: request.headers.get("x-private-token"),
        })
        return Response.json(
          { error: { message: `provider rejected ${API_CANARY} and ${HEADER_CANARY}` } },
          { status: 401 },
        )
      },
    })
    const credentialProxy = createSensitiveHeaderCredentialProxy({
      profiles,
      credentials,
      store: { get: (key) => proxyValues.get(key), set: (key, value) => proxyValues.set(key, value) },
      token: () => "phase2-sidecar-token",
    })
    await credentialProxy.start()
    const service = createModelCenterService({
      profiles,
      credentials,
      probe,
      detector: { detect: async () => [] },
      reloadCredentials: async () => undefined,
      presentProfile: credentialProxy.presentProfile,
    })
    const host = createDesktopProductHost({
      modelCenter: service,
      sidecar: {
        getStatus: async () => createUnmanagedSidecarStatus(1_722_470_400_200),
        subscribe: async () => () => undefined,
        restart: async () => createUnmanagedSidecarStatus(1_722_470_400_200),
      },
      credentials: { getCapabilities: async () => credentials.capabilities() },
    })

    const saved = await host.modelCenter.save(draft)
    const listed = await host.modelCenter.list()
    const discovery = await host.modelCenter.discover({ profileID: saved.id })
    const report = await host.modelCenter.test({ profileID: saved.id, modelID: "canary-coder" })
    const patch = enableProviderPatch((await host.modelCenter.list())[0], [])
    const environment = createModelCredentialEnvironment({
      profiles: await host.modelCenter.list(),
      credentials,
      warn: (warning) => warnings.push(warning),
      credentialProxy: credentialProxy.runtimeEnvironment,
    })

    expect(transportCredentials).toHaveLength(2)
    expect(
      transportCredentials.every(
        (item) => item.authorization === `Bearer ${API_CANARY}` && item.privateHeader === HEADER_CANARY,
      ),
    ).toBe(true)
    expect(environment[profileCredentialEnvironment(saved.id)]).toBe("phase2-sidecar-token")
    expect(environment[profileCredentialProxyBaseURLEnvironment(saved.id)]).toBe(saved.runtime?.baseURL)
    expect(environment[profileSensitiveHeaderEnvironment(saved.id, "X-Private-Token")]).toBeUndefined()
    expect(process.env[profileCredentialEnvironment(saved.id)]).toBeUndefined()

    const surfaces = {
      profileStore: Object.fromEntries(profileValues),
      credentialStore: Object.fromEntries(credentialValues),
      proxyStore: Object.fromEntries(proxyValues),
      ipc: { saved, listed, discovery, report },
      logs: warnings,
      config: patch,
    }
    const serialized = JSON.stringify(surfaces)
    expect(serialized).not.toContain(API_CANARY)
    expect(serialized).not.toContain(HEADER_CANARY)
    expect(serialized).not.toContain("provider rejected")
    expect(serialized).toContain('"credentialProxy":true')
    expect(JSON.stringify(patch)).not.toContain("X-Private-Token")
    expect(profileValues.get("state")).toBeDefined()
    expect(credentialValues.get("credentials")).toBeDefined()

    await host.modelCenter.remove(saved.id)
    expect(await host.modelCenter.list()).toEqual([])
    expect(credentialValues.has("credentials")).toBe(false)
    await credentialProxy.stop()
  })
})
