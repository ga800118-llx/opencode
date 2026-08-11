import { describe, expect, test } from "bun:test"
import { sanitizeProviderProfile, type ProductProviderProfile } from "@opencode-ai/app/product/model-center"
import type { ProductCredentialService } from "./credentials"
import { createSensitiveHeaderCredentialProxy } from "./credential-proxy"
import type { ProfileRepository } from "./profiles"

const profile = {
  id: "profile-one",
  providerID: "agent-profile-profile-one",
  name: "Private",
  kind: "openai-compatible",
  baseURL: "http://127.0.0.1:1/v1",
  credentialRef: "model-profile:profile-one",
  hasApiKey: true,
  headers: [{ name: "X-Private-Token", sensitive: true, hasValue: true }],
  models: [{ id: "coder", name: "Coder", source: "manual" }],
  settings: { contextLimit: 64_000, outputLimit: 8_000, allowInsecureTls: false },
  createdAt: 1,
  updatedAt: 2,
} satisfies ProductProviderProfile

describe("model credential proxy", () => {
  test("publishes a fresh runtime URL when the persisted port is occupied", async () => {
    const occupied = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("occupied") })
    const values = new Map<string, unknown>([["credentialProxyPort", occupied.port]])
    const warnings: unknown[] = []
    const current = { ...profile, headers: [] }
    const proxy = createSensitiveHeaderCredentialProxy({
      profiles: repository(current),
      credentials: credentials(),
      store: { get: (key) => values.get(key), set: (key, value) => values.set(key, value) },
      token: () => "fallback-port-token",
      warn: (message, meta) => warnings.push({ message, meta }),
    })
    try {
      await proxy.start()
      expect(proxy.port()).not.toBe(occupied.port)
      expect(proxy.runtimeEnvironment(current)?.baseURL).toContain(`127.0.0.1:${proxy.port()}`)
      expect(values.get("credentialProxyPort")).toBe(proxy.port())
      expect(warnings).toEqual([
        { message: "saved model credential proxy port unavailable", meta: { port: occupied.port } },
      ])
    } finally {
      await proxy.stop()
      occupied.stop(true)
    }
  })

  test("proxies profiles that contain only an API key", async () => {
    const requests: Array<{ authorization: string | null; privateHeader: string | null }> = []
    const upstream = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        requests.push({
          authorization: request.headers.get("authorization"),
          privateHeader: request.headers.get("x-private-token"),
        })
        return Response.json({ ok: true })
      },
    })
    const current = { ...profile, baseURL: `http://${upstream.hostname}:${upstream.port}/v1`, headers: [] }
    const proxy = createSensitiveHeaderCredentialProxy({
      profiles: repository(current),
      credentials: credentials(),
      store: { get: () => undefined, set: () => undefined },
      token: () => "api-key-only-token",
    })
    try {
      await proxy.start()
      const presented = proxy.presentProfile(current)
      expect(presented.runtime).toMatchObject({ credentialProxy: true })
      expect(proxy.runtimeEnvironment(current)).toEqual({
        credential: "api-key-only-token",
        baseURL: presented.runtime?.baseURL,
      })
      const result = await fetch(`${presented.runtime?.baseURL}/models`, {
        headers: { Authorization: `Bearer ${proxy.runtimeCredential(current)}` },
      }).then((response) => response.json())
      expect(result).toEqual({ ok: true })
      expect(requests).toEqual([{ authorization: "Bearer api-canary", privateHeader: null }])
    } finally {
      await proxy.stop()
      upstream.stop(true)
    }
  })

  test("authenticates the sidecar token and injects secrets only into the upstream request", async () => {
    const requests: Array<{ authorization: string | null; privateHeader: string | null }> = []
    const upstream = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        requests.push({
          authorization: request.headers.get("authorization"),
          privateHeader: request.headers.get("x-private-token"),
        })
        return Response.json({ data: [{ id: "coder" }] })
      },
    })
    const current = { ...profile, baseURL: `http://${upstream.hostname}:${upstream.port}/v1` }
    const values = new Map<string, unknown>()
    const proxy = createSensitiveHeaderCredentialProxy({
      profiles: repository(current),
      credentials: credentials(),
      store: { get: (key) => values.get(key), set: (key, value) => values.set(key, value) },
      token: () => "sidecar-only-token",
    })
    try {
      await proxy.start()
      const presented = proxy.presentProfile(current)
      expect(presented.runtime).toMatchObject({ credentialProxy: true })
      const unauthorized = await fetch(`${presented.runtime?.baseURL}/models`)
      expect(unauthorized.status).toBe(401)

      const result = await fetch(`${presented.runtime?.baseURL}/models`, {
        headers: { Authorization: `Bearer ${proxy.runtimeCredential(current)}` },
      }).then((response) => response.json())
      expect(result).toEqual({ data: [{ id: "coder" }] })
      expect(requests).toEqual([{ authorization: "Bearer api-canary", privateHeader: "header-canary" }])
      expect(JSON.stringify({ presented, result, store: Object.fromEntries(values) })).not.toContain("api-canary")
      expect(JSON.stringify({ presented, result, store: Object.fromEntries(values) })).not.toContain("header-canary")
    } finally {
      await proxy.stop()
      upstream.stop(true)
    }
  })

  test("does not disconnect a silent upstream using a legacy profile timeout", async () => {
    const upstream = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch() {
        await Bun.sleep(1_200)
        return Response.json({ ok: true })
      },
    })
    const current = sanitizeProviderProfile({
      ...profile,
      baseURL: `http://${upstream.hostname}:${upstream.port}/v1`,
      settings: { ...profile.settings, timeoutMs: 1_000 },
    })
    const proxy = createSensitiveHeaderCredentialProxy({
      profiles: repository(current),
      credentials: credentials(),
      store: { get: () => undefined, set: () => undefined },
      token: () => "silent-upstream-token",
    })
    try {
      await proxy.start()
      const presented = proxy.presentProfile(current)
      const result = await fetch(`${presented.runtime?.baseURL}/models`, {
        headers: { Authorization: `Bearer ${proxy.runtimeCredential(current)}` },
      }).then((response) => response.json())

      expect(result).toEqual({ ok: true })
    } finally {
      await proxy.stop()
      upstream.stop(true)
    }
  })
})

function repository(current: ProductProviderProfile): ProfileRepository {
  return {
    list: () => [current],
    get: (id) => (id === current.id ? current : undefined),
    save: () => current,
    remove: () => undefined,
    recordTest: () => current,
    selectDefault: () => current,
    defaultSelection: () => undefined,
  }
}

function credentials(): ProductCredentialService {
  return {
    capabilities: () => ({
      namespace: "test",
      backend: "macos-keychain",
      available: true,
      operations: { read: true, write: true, delete: true },
    }),
    has: () => true,
    read: () => ({ apiKey: "api-canary", headers: { "X-Private-Token": "header-canary" } }),
    write: () => undefined,
    delete: () => undefined,
  }
}
