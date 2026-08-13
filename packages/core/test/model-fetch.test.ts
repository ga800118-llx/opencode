import { describe, expect, test } from "bun:test"
import type { Dispatcher } from "undici"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createModelDispatcher, createModelFetch } from "../src/model-fetch"

describe("model fetch", () => {
  test("disables Undici response header and body inactivity timeouts", () => {
    let observed: Dispatcher.DispatchOptions | undefined
    const dispatcher = {
      compose(interceptor: Dispatcher.DispatcherComposeInterceptor) {
        const dispatch = interceptor((options) => {
          observed = options
          return true
        })
        return { dispatch }
      },
    } as unknown as Dispatcher

    const result = createModelDispatcher(dispatcher)
    result.dispatch(
      {
        origin: "https://models.example.test",
        path: "/v1/chat/completions",
        method: "POST",
        headersTimeout: 10,
        bodyTimeout: 20,
      },
      {} as Dispatcher.DispatchHandler,
    )

    expect(observed?.headersTimeout).toBe(0)
    expect(observed?.bodyTimeout).toBe(0)
    expect((observed as Dispatcher.DispatchOptions & { allowH2?: boolean })?.allowH2).toBe(false)
    expect(createModelDispatcher(dispatcher)).toBe(result)
  })

  test("keeps HTTP/2 available for current Undici handlers", () => {
    let observed: (Dispatcher.DispatchOptions & { allowH2?: boolean }) | undefined
    const dispatcher = {
      compose(interceptor: Dispatcher.DispatcherComposeInterceptor) {
        const dispatch = interceptor((options) => {
          observed = options
          return true
        })
        return { dispatch }
      },
    } as unknown as Dispatcher

    createModelDispatcher(dispatcher).dispatch(
      {
        origin: "https://models.example.test",
        path: "/v1/chat/completions",
        method: "POST",
        allowH2: true,
      } as Dispatcher.DispatchOptions,
      {
        onRequestStart() {},
        onResponseStart() {},
        onResponseError() {},
      },
    )

    expect(observed?.allowH2).toBe(true)
  })

  test("keeps the caller abort signal and Bun timeout override", async () => {
    const controller = new AbortController()
    let observed: ModelRequestInit | undefined
    const fetch = createModelFetch(async (_input, init) => {
      observed = init
      return new Response("ok")
    })

    expect(await (await fetch("https://models.example.test", { signal: controller.signal })).text()).toBe("ok")
    expect(observed?.signal).toBe(controller.signal)
    expect(observed?.timeout).toBe(false)
  })

  test("reads past an Undici body timeout and still honors abort in Node", async () => {
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "opencode-model-fetch-")))
    try {
      const entry = path.join(root, "entry.ts")
      await Bun.write(
        entry,
        nodeIntegrationSource(
          path.join(import.meta.dir, "../src/model-fetch.ts"),
          path.join(import.meta.dir, "../node_modules/undici/index.js"),
        ),
      )
      const build = await Bun.build({
        entrypoints: [entry],
        outdir: path.join(root, "dist"),
        target: "node",
        format: "esm",
      })
      expect(build.success, build.logs.map(String).join("\n")).toBeTrue()
      const output = build.outputs.find((item) => item.kind === "entry-point")
      if (!output) throw new Error("Node model-fetch bundle did not produce an entry point")
      const node = Bun.which("node")
      if (!node) throw new Error("System Node executable was not found")
      const electron = path.join(import.meta.dir, "../../desktop/node_modules/.bin/electron")
      const runtimes = [
        { name: "node", command: node, env: process.env },
        ...((await Bun.file(electron).exists())
          ? [{ name: "electron", command: electron, env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } }]
          : []),
      ]
      for (const runtime of runtimes) {
        const child = Bun.spawn([runtime.command, output.path], {
          cwd: import.meta.dir,
          env: runtime.env,
          stdout: "pipe",
          stderr: "pipe",
        })
        const [code, stdout, stderr] = await Promise.all([
          child.exited,
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
        ])

        expect({ runtime: runtime.name, code, stderr }).toEqual({ runtime: runtime.name, code: 0, stderr: "" })
        expect(JSON.parse(stdout)).toEqual({
          baseline: "UND_ERR_BODY_TIMEOUT",
          body: "first-last",
          aborted: true,
          custom: { body: "first-last", dispatcher: true },
          nativeResponse: true,
          proxyRecovered: true,
          request: {
            body: "native-request",
            header: "native-header",
            method: "POST",
          },
        })
      }
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  }, 15_000)

  test("uses environment proxies for Node model requests", async () => {
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "opencode-model-proxy-")))
    try {
      const entry = path.join(root, "entry.ts")
      await Bun.write(
        entry,
        nodeProxyIntegrationSource(
          path.join(import.meta.dir, "../src/model-fetch.ts"),
          path.join(import.meta.dir, "../node_modules/undici/index.js"),
        ),
      )
      const build = await Bun.build({
        entrypoints: [entry],
        outdir: path.join(root, "dist"),
        target: "node",
        format: "esm",
      })
      expect(build.success, build.logs.map(String).join("\n")).toBeTrue()
      const output = build.outputs.find((item) => item.kind === "entry-point")
      if (!output) throw new Error("Node proxy bundle did not produce an entry point")
      const node = Bun.which("node")
      if (!node) throw new Error("System Node executable was not found")
      const child = Bun.spawn([node, output.path], {
        cwd: import.meta.dir,
        stdout: "pipe",
        stderr: "pipe",
      })
      const [code, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ])

      expect({ code, stderr }).toEqual({ code: 0, stderr: "" })
      expect(JSON.parse(stdout)).toEqual({ body: "through-proxy", proxyHits: 1 })
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  }, 15_000)
})

type ModelRequestInit = RequestInit & { timeout?: false }

function nodeIntegrationSource(source: string, undici: string) {
  return `
import { createServer } from "node:http"
import { Agent, fetch as undiciFetch } from ${JSON.stringify(undici)}
import { createModelFetch } from ${JSON.stringify(source)}

process.env.NO_PROXY = "127.0.0.1,localhost"
process.env.no_proxy = "127.0.0.1,localhost"

const server = createServer(async (request, response) => {
  if (request.url === "/request") {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    response.writeHead(200, { "content-type": "application/json" })
    response.end(JSON.stringify({
      body: Buffer.concat(chunks).toString("utf8"),
      header: request.headers["x-model-request"],
      method: request.method,
    }))
    return
  }
  response.writeHead(200, { "content-type": "text/plain" })
  response.write("first")
  if (request.url === "/abort") return
  setTimeout(() => response.end("-last"), 1_250)
})
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
const address = server.address()
if (!address || typeof address === "string") throw new Error("test server did not bind")
const url = "http://127.0.0.1:" + address.port
const baselineDispatcher = new Agent({ bodyTimeout: 100 })

try {
  const baseline = await undiciFetch(url + "/baseline", { dispatcher: baselineDispatcher })
    .then((response) => response.text())
    .then(() => "resolved", (error) => error.cause?.code)
  const fetch = createModelFetch()
  const streamResponse = await fetch(url + "/stream")
  const nativeResponse = streamResponse instanceof Response
  const body = await streamResponse.text()
  let customDispatcher = false
  const customFetch = createModelFetch((input, init) => {
    customDispatcher = Boolean(init?.dispatcher)
    return globalThis.fetch(input, init)
  })
  const custom = {
    body: await (await customFetch(url + "/stream")).text(),
    dispatcher: customDispatcher,
  }
  const controller = new AbortController()
  const response = await fetch(url + "/abort", { signal: controller.signal })
  const text = response.text()
  controller.abort(new Error("stopped by user"))
  const aborted = await text.then(() => false, () => true)
  const request = await (await fetch(new Request(url + "/request", {
    method: "POST",
    headers: { "x-model-request": "native-header" },
    body: "native-request",
  }))).json()
  delete process.env.NO_PROXY
  delete process.env.no_proxy
  process.env.HTTP_PROXY = "://invalid"
  process.env.HTTPS_PROXY = process.env.HTTP_PROXY
  await fetch(url + "/recovery").then(() => undefined, () => undefined)
  delete process.env.HTTP_PROXY
  delete process.env.HTTPS_PROXY
  process.env.NO_PROXY = "127.0.0.1,localhost"
  const proxyRecovered = await (await fetch(url + "/recovery")).text() === "first-last"
  process.stdout.write(JSON.stringify({ baseline, body, aborted, custom, nativeResponse, proxyRecovered, request }))
} finally {
  await baselineDispatcher.close()
  server.closeAllConnections()
  server.close()
}
`
}

function nodeProxyIntegrationSource(source: string, undici: string) {
  return `
import { createServer } from "node:http"
import { connect } from "node:net"
import ${JSON.stringify(undici)}
import { createModelFetch } from ${JSON.stringify(source)}

const target = createServer((_request, response) => response.end("through-proxy"))
await new Promise((resolve) => target.listen(0, "127.0.0.1", resolve))
const targetAddress = target.address()
if (!targetAddress || typeof targetAddress === "string") throw new Error("target server did not bind")

let proxyHits = 0
const proxy = createServer()
proxy.on("connect", (request, client, head) => {
  proxyHits += 1
  const [hostname, port] = request.url.split(":")
  const upstream = connect(Number(port), hostname, () => {
    client.write("HTTP/1.1 200 Connection Established\\r\\n\\r\\n")
    if (head.length > 0) upstream.write(head)
    upstream.pipe(client)
    client.pipe(upstream)
  })
})
await new Promise((resolve) => proxy.listen(0, "127.0.0.1", resolve))
const proxyAddress = proxy.address()
if (!proxyAddress || typeof proxyAddress === "string") throw new Error("proxy server did not bind")

delete process.env.ALL_PROXY
delete process.env.all_proxy
delete process.env.NO_PROXY
delete process.env.no_proxy
process.env.HTTP_PROXY = "http://127.0.0.1:" + proxyAddress.port
process.env.HTTPS_PROXY = process.env.HTTP_PROXY

try {
  const response = await createModelFetch()("http://127.0.0.1:" + targetAddress.port)
  process.stdout.write(JSON.stringify({ body: await response.text(), proxyHits }))
} finally {
  proxy.closeAllConnections()
  proxy.close()
  target.closeAllConnections()
  target.close()
}
`
}
