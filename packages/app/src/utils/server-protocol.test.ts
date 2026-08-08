import { describe, expect, test } from "bun:test"
import {
  detectPermissionModeCapability,
  detectServerProtocol,
  hasPermissionModeCapability,
} from "./server-protocol"

const server = { url: "http://localhost:4096" }
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } })
const mockFetch = (run: (input: string | URL | Request) => Promise<Response>) =>
  Object.assign(run, { preconnect: globalThis.fetch.preconnect })

describe("detectServerProtocol", () => {
  test("prefers the legacy health endpoint when both API generations exist", async () => {
    const fetcher = mockFetch((input) => {
      const path = new URL(input instanceof Request ? input.url : input).pathname
      if (path === "/global/health") return Promise.resolve(json({ healthy: true, version: "1.18.4" }))
      return Promise.resolve(json({ healthy: true, version: "2.0.0", pid: 123 }))
    })

    expect(await detectServerProtocol(server, fetcher)).toBe("v1")
  })

  test("recognizes V2 health by its process identifier", async () => {
    const fetcher = mockFetch((input) => {
      const path = new URL(input instanceof Request ? input.url : input).pathname
      if (path === "/global/health") return Promise.resolve(json({}, 404))
      return Promise.resolve(json({ healthy: true, version: "2.0.0", pid: 123 }))
    })

    expect(await detectServerProtocol(server, fetcher)).toBe("v2")
  })

  test("recognizes the transitional V1 API health response", async () => {
    const fetcher = mockFetch((input) => {
      const path = new URL(input instanceof Request ? input.url : input).pathname
      if (path === "/global/health") return Promise.resolve(json({}, 404))
      return Promise.resolve(json({ healthy: true }))
    })

    expect(await detectServerProtocol(server, fetcher)).toBe("v1")
  })
})

describe("hasPermissionModeCapability", () => {
  test("recognizes only the permission-mode POST operation", () => {
    expect(
      hasPermissionModeCapability({
        paths: {
          "/api/session/{sessionID}/permission-mode": {
            post: { operationId: "v2.session.switchPermissionMode" },
          },
        },
      }),
    ).toBe(true)
    expect(
      hasPermissionModeCapability({
        paths: {
          "/api/session/{sessionID}/permission-mode": { get: {} },
        },
      }),
    ).toBe(false)
    expect(hasPermissionModeCapability({ paths: [] })).toBe(false)
  })
})

describe("detectPermissionModeCapability", () => {
  test("does not probe OpenAPI for V1 servers", async () => {
    const paths: string[] = []
    const fetcher = mockFetch((input) => {
      paths.push(new URL(input instanceof Request ? input.url : input).pathname)
      return Promise.resolve(json({}))
    })

    expect(await detectPermissionModeCapability(server, fetcher, "v1")).toBe(false)
    expect(paths).toEqual([])
  })

  test("recognizes the current V2 permission-mode operation", async () => {
    const fetcher = mockFetch(() =>
      Promise.resolve(
        json({
          paths: {
            "/api/session/{sessionID}/permission-mode": {
              post: { operationId: "v2.session.switchPermissionMode" },
            },
          },
        }),
      ),
    )

    expect(await detectPermissionModeCapability(server, fetcher, "v2")).toBe(true)
  })

  test("rejects an older V2 OpenAPI document without the POST operation", async () => {
    const fetcher = mockFetch(() =>
      Promise.resolve(
        json({
          paths: {
            "/api/session/{sessionID}/permission-mode": { get: {} },
          },
        }),
      ),
    )

    expect(await detectPermissionModeCapability(server, fetcher, "v2")).toBe(false)
  })

  test("rejects missing or malformed OpenAPI documents", async () => {
    const missing = mockFetch(() => Promise.resolve(json({}, 404)))
    const malformed = mockFetch(() => Promise.resolve(json({ paths: [] })))
    const failed = mockFetch(() => Promise.reject(new Error("offline")))

    expect(await detectPermissionModeCapability(server, missing, "v2")).toBe(false)
    expect(await detectPermissionModeCapability(server, malformed, "v2")).toBe(false)
    expect(await detectPermissionModeCapability(server, failed, "v2")).toBe(false)
  })
})
