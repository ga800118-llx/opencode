import { describe, expect, test } from "bun:test"
import { spawn } from "node:child_process"
import { once } from "node:events"
import { createServer } from "node:http"
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

  test("closes the upstream socket and stops streaming when the client aborts", async () => {
    const upstream = await streamingUpstream()
    const current = { ...profile, baseURL: `${upstream.origin}/v1`, headers: [] }
    const proxy = createSensitiveHeaderCredentialProxy({
      profiles: repository(current),
      credentials: credentials(),
      store: { get: () => undefined, set: () => undefined },
      token: () => "client-abort-token",
    })
    try {
      await proxy.start()
      await within(
        cancelStreamingRequest(
          `${proxy.runtimeEnvironment(current)?.baseURL}/stream`,
          `Bearer ${proxy.runtimeCredential(current)}`,
        ),
        1_000,
        "client did not cancel its streaming response",
      )
      await within(upstream.socketClosed, 500, "upstream socket did not close after client cancellation")
      const chunksAfterClose = upstream.chunks()
      await Bun.sleep(80)

      expect(upstream.prematureClose()).toBe(true)
      expect(upstream.chunks()).toBe(chunksAfterClose)
    } finally {
      await proxy.stop()
      await upstream.stop()
    }
  })

  test("allows a normal streaming response to finish without cancelling upstream", async () => {
    const upstream = await streamingUpstream(4)
    const current = { ...profile, baseURL: `${upstream.origin}/v1`, headers: [] }
    const proxy = createSensitiveHeaderCredentialProxy({
      profiles: repository(current),
      credentials: credentials(),
      store: { get: () => undefined, set: () => undefined },
      token: () => "normal-stream-token",
    })
    try {
      await proxy.start()
      const result = await fetch(`${proxy.runtimeEnvironment(current)?.baseURL}/stream`, {
        headers: { Authorization: `Bearer ${proxy.runtimeCredential(current)}` },
      })

      expect(await result.text()).toBe("chunk-1\nchunk-2\nchunk-3\nchunk-4\n")
      await within(upstream.responseClosed, 500, "upstream response did not close after completing")
      expect(upstream.completed()).toBe(true)
      expect(upstream.prematureClose()).toBe(false)
      expect(upstream.chunks()).toBe(4)
    } finally {
      await proxy.stop()
      await upstream.stop()
    }
  })

  test("closes the upstream socket and stops streaming when the proxy stops", async () => {
    const upstream = await streamingUpstream()
    const current = { ...profile, baseURL: `${upstream.origin}/v1`, headers: [] }
    const proxy = createSensitiveHeaderCredentialProxy({
      profiles: repository(current),
      credentials: credentials(),
      store: { get: () => undefined, set: () => undefined },
      token: () => "proxy-stop-token",
    })
    await proxy.start()
    const result = await fetch(`${proxy.runtimeEnvironment(current)?.baseURL}/stream`, {
      headers: { Authorization: `Bearer ${proxy.runtimeCredential(current)}` },
    })
    expect((await result.body?.getReader().read())?.done).toBe(false)

    const stopping = proxy.stop()
    try {
      await within(upstream.socketClosed, 500, "upstream socket did not close when the proxy stopped")
      await within(stopping, 500, "credential proxy did not stop after cancelling upstream")
      const chunksAfterClose = upstream.chunks()
      await Bun.sleep(80)

      expect(upstream.prematureClose()).toBe(true)
      expect(upstream.chunks()).toBe(chunksAfterClose)
    } finally {
      await upstream.stop()
      await stopping
    }
  })
})

async function streamingUpstream(limit?: number) {
  let chunks = 0
  let completed = false
  let prematureClose = false
  let resolveSocketClosed: (() => void) | undefined
  let resolveResponseClosed: (() => void) | undefined
  const socketClosed = new Promise<void>((resolve) => {
    resolveSocketClosed = resolve
  })
  const responseClosed = new Promise<void>((resolve) => {
    resolveResponseClosed = resolve
  })
  const server = createServer((request, response) => {
    request.on("error", () => undefined)
    response.writeHead(200, { "content-type": "text/plain" })
    chunks++
    response.write(`chunk-${chunks}\n`)
    const interval = setInterval(() => {
      chunks++
      response.write(`chunk-${chunks}\n`)
      if (chunks !== limit) return
      clearInterval(interval)
      completed = true
      response.end()
    }, 20)
    response.once("close", () => {
      prematureClose ||= !response.writableFinished
      resolveResponseClosed?.()
    })
    request.socket.once("close", () => {
      clearInterval(interval)
      prematureClose ||= !completed
      resolveSocketClosed?.()
    })
  })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Streaming upstream address is unavailable.")

  return {
    origin: `http://127.0.0.1:${address.port}`,
    socketClosed,
    responseClosed,
    chunks: () => chunks,
    completed: () => completed,
    prematureClose: () => prematureClose,
    stop: async () => {
      const closing = new Promise<void>((resolve) => server.close(() => resolve()))
      server.closeAllConnections()
      await closing
    },
  }
}

function cancelStreamingRequest(url: string, authorization: string) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(
      "node",
      [
        "--input-type=module",
        "--eval",
        `import { request } from "node:http"
const controller = new AbortController()
await new Promise((resolve, reject) => {
  let cancelled = false
  const client = request(process.argv[1], {
    method: "POST",
    headers: { authorization: process.argv[2] },
    signal: controller.signal,
  }, (response) => {
    response.once("error", () => undefined)
    response.once("data", () => {
      cancelled = true
      controller.abort()
    })
  })
  client.once("error", (error) => {
    if (error.name !== "AbortError") reject(error)
  })
  client.once("close", () => {
    if (!cancelled) return reject(new Error("HTTP request closed before the streaming response arrived"))
    resolve()
  })
  client.write("x")
})`,
        url,
        authorization,
      ],
      { stdio: ["ignore", "ignore", "pipe"] },
    )
    let stderr = ""
    child.stderr?.setEncoding("utf8")
    child.stderr?.on("data", (chunk) => {
      stderr += chunk
    })
    child.once("error", reject)
    child.once("close", (code) => {
      if (code === 0) return resolve()
      reject(new Error(`Streaming client exited with code ${code}: ${stderr}`))
    })
  })
}

async function within<T>(promise: Promise<T>, timeout: number, message: string) {
  return await new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeout)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

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
