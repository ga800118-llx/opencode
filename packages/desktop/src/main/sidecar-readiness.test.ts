import { expect, test } from "bun:test"
import { waitForSidecarReadiness } from "./sidecar-readiness"

test("waitForSidecarReadiness retries until the authenticated provider catalog is available", async () => {
  let attempts = 0
  let authorization = ""
  let directory = ""
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      attempts += 1
      const url = new URL(request.url)
      authorization = request.headers.get("authorization") ?? ""
      directory = url.searchParams.get("directory") ?? ""
      if (url.pathname !== "/provider") return new Response("missing", { status: 404 })
      if (attempts === 1) return new Response("starting", { status: 503 })
      return Response.json({ all: [], default: {}, connected: [] })
    },
  })

  try {
    await waitForSidecarReadiness(`http://${server.hostname}:${server.port}`, "secret", {
      directory: "/isolated/readiness",
      timeoutMs: 1_000,
      requestTimeoutMs: 100,
      retryDelayMs: 1,
    })
  } finally {
    server.stop(true)
  }

  expect(attempts).toBe(2)
  expect(authorization).toBe(`Basic ${Buffer.from("opencode:secret").toString("base64")}`)
  expect(directory).toBe("/isolated/readiness")
})

test("waitForSidecarReadiness rejects malformed provider responses", async () => {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => Response.json({ healthy: true }),
  })

  try {
    await expect(
      waitForSidecarReadiness(`http://${server.hostname}:${server.port}`, null, {
        timeoutMs: 30,
        requestTimeoutMs: 10,
        retryDelayMs: 1,
      }),
    ).rejects.toThrow("provider catalog")
  } finally {
    server.stop(true)
  }
})
