export type MockModelServerMode =
  | "agent"
  | "partial"
  | "chat-only"
  | "stream-http-error"
  | "tool-http-error"
  | "incompatible"
  | "malformed-models"
  | "delayed"
  | "ollama"

type MockModelServerOptions = {
  readonly port?: number
  readonly requireAuthentication?: boolean
}

function bodyField(input: unknown, key: string): unknown {
  if (typeof input !== "object" || input === null) return undefined
  return Reflect.get(input, key)
}

export function startMockModelServer(mode: MockModelServerMode = "agent", options: MockModelServerOptions = {}) {
  const requests: Array<{ path: string; authorization?: string; privateHeader?: string }> = []
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: options.port ?? 0,
    async fetch(request) {
      const url = new URL(request.url)
      requests.push({
        path: url.pathname,
        authorization: request.headers.get("authorization") ?? undefined,
        privateHeader: request.headers.get("x-private-token") ?? undefined,
      })

      const requireAuthentication = options.requireAuthentication ?? true
      if (requireAuthentication && request.headers.get("authorization") !== "Bearer fixture-secret") {
        return Response.json({ error: { message: "raw credential rejection" } }, { status: 401 })
      }
      if (requireAuthentication && request.headers.get("x-private-token") !== "fixture-private-header") {
        return Response.json({ error: { message: "raw header rejection" } }, { status: 403 })
      }
      if (mode === "delayed") await Bun.sleep(50)

      if (url.pathname === "/api/tags") {
        return Response.json({ models: [{ name: "qwen2.5-coder:7b" }, { name: "deepseek-coder:latest" }] })
      }
      if (url.pathname === "/v1/models") {
        if (mode === "malformed-models") return new Response("not-json", { status: 200 })
        return Response.json({ data: [{ id: "coder" }, { id: "reasoner", name: "Reasoner" }] })
      }
      if (url.pathname !== "/v1/chat/completions") return new Response(null, { status: 404 })

      const body: unknown = await request.json()
      if (bodyField(body, "model") === "missing") {
        return Response.json({ error: { message: "raw missing detail" } }, { status: 404 })
      }
      if (mode === "incompatible") return Response.json({ result: "unexpected" })
      if (bodyField(body, "stream") === true) {
        if (mode === "stream-http-error") {
          return Response.json({ error: "private fixture detail" }, { status: 400 })
        }
        if (mode === "chat-only") return Response.json({ choices: [{ message: { content: "OK" } }] })
        const stream = [
          `data: ${JSON.stringify({ choices: [{ delta: { content: "OK" } }] })}\n\n`,
          "data: [DONE]\n\n",
        ].join("")
        return new Response(stream, { headers: { "content-type": "text/event-stream" } })
      }
      const tools = bodyField(body, "tools")
      if (Array.isArray(tools) && tools.length) {
        if (mode === "tool-http-error") {
          return Response.json({ error: "private fixture detail" }, { status: 400 })
        }
        if (mode === "agent" || mode === "stream-http-error") {
          return Response.json({
            choices: [
              {
                message: {
                  tool_calls: [
                    { id: "call-safe", type: "function", function: { name: "report_probe", arguments: "{}" } },
                  ],
                },
              },
            ],
          })
        }
        return Response.json({ choices: [{ message: { content: "I cannot call tools." } }] })
      }
      return Response.json({ choices: [{ message: { content: "OK" } }] })
    },
  })
  return {
    baseURL: `http://${server.hostname}:${server.port}/v1`,
    ollamaURL: `http://${server.hostname}:${server.port}`,
    requests,
    stop: () => server.stop(true),
  }
}
