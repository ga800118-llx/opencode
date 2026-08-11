import { mkdir } from "node:fs/promises"
import { createServer } from "node:http"
import path from "node:path"

export const DEFAULT_MAC_RUNTIME_SOAK_DURATION_MS = 65 * 60_000

export type MacRuntimeSoakEvidence = {
  startedAt: string
  completedAt: string
  requestedDurationMs: number
  observedDurationMs: number
  chunks: number
  clientAbort: false
  completed: true
}

type MacRuntimeSoakObservation = Omit<MacRuntimeSoakEvidence, "clientAbort" | "completed"> & {
  clientAbort: boolean
  completed: boolean
}

export function assertMacRuntimeSoakEvidence(value: unknown): MacRuntimeSoakEvidence {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Soak evidence must be an object")
  const evidence = value as Record<string, unknown>
  const keys = [
    "startedAt",
    "completedAt",
    "requestedDurationMs",
    "observedDurationMs",
    "chunks",
    "clientAbort",
    "completed",
  ]
  if (Object.keys(evidence).sort().join() !== keys.sort().join()) throw new Error("Soak evidence fields are invalid")
  if (typeof evidence.startedAt !== "string" || Number.isNaN(Date.parse(evidence.startedAt))) {
    throw new Error("Soak evidence startedAt is invalid")
  }
  if (typeof evidence.completedAt !== "string" || Number.isNaN(Date.parse(evidence.completedAt))) {
    throw new Error("Soak evidence completedAt is invalid")
  }
  if (!Number.isFinite(evidence.requestedDurationMs) || (evidence.requestedDurationMs as number) <= 0) {
    throw new Error("Soak evidence requestedDurationMs must be positive")
  }
  if (!Number.isFinite(evidence.observedDurationMs) || (evidence.observedDurationMs as number) < 0) {
    throw new Error("Soak evidence observedDurationMs is invalid")
  }
  if ((evidence.observedDurationMs as number) < (evidence.requestedDurationMs as number)) {
    throw new Error("Soak evidence ended before the requested duration")
  }
  if (!Number.isInteger(evidence.chunks) || (evidence.chunks as number) <= 0) {
    throw new Error("Soak evidence must contain activity chunks")
  }
  if (evidence.clientAbort !== false) throw new Error("Soak client aborted the response")
  if (evidence.completed !== true) throw new Error("Soak response did not complete")
  if (Date.parse(evidence.completedAt as string) < Date.parse(evidence.startedAt as string)) {
    throw new Error("Soak evidence timestamps are out of order")
  }
  return evidence as MacRuntimeSoakEvidence
}

export async function createMacRuntimeSoakFixture(input?: {
  durationMs?: number
  intervalMs?: number
  hostname?: string
  port?: number
  token?: string
}) {
  const durationMs = input?.durationMs ?? DEFAULT_MAC_RUNTIME_SOAK_DURATION_MS
  const intervalMs = input?.intervalMs ?? 15_000
  const hostname = input?.hostname ?? "127.0.0.1"
  const token = input?.token ?? `soak-${crypto.randomUUID()}`
  if (!Number.isFinite(durationMs) || durationMs <= 0) throw new Error("Soak duration must be positive")
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) throw new Error("Soak interval must be positive")

  let active = false
  let resolveObservation: (evidence: MacRuntimeSoakObservation) => void
  const observation = new Promise<MacRuntimeSoakObservation>((resolve) => {
    resolveObservation = resolve
  })
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? hostname}`)
    const json = (status: number, value: unknown) => {
      response.writeHead(status, { "content-type": "application/json" })
      response.end(JSON.stringify(value))
    }
    if (request.headers.authorization !== `Bearer ${token}`) {
      json(401, { error: { message: "Unauthorized" } })
      return
    }
    if (request.method === "GET" && url.pathname.endsWith("/models")) {
      json(200, { object: "list", data: [{ id: "mac-runtime-soak", object: "model" }] })
      return
    }
    if (request.method !== "POST" || !url.pathname.endsWith("/chat/completions")) {
      json(404, { error: { message: "Not found" } })
      return
    }
    if (active) {
      json(409, { error: { message: "Soak stream already active" } })
      return
    }
    active = true

    response.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    })
    response.flushHeaders()

    const started = Date.now()
    const startedAt = new Date(started).toISOString()
    let chunks = 0
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const record = (clientAbort: boolean) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      resolveObservation({
        startedAt,
        completedAt: new Date().toISOString(),
        requestedDurationMs: durationMs,
        observedDurationMs: Date.now() - started,
        chunks,
        clientAbort,
        completed: !clientAbort,
      })
    }

    response.on("close", () => {
      if (!settled) record(true)
    })
    response.on("error", () => record(true))

    const send = () => {
      if (settled) return
      if (response.destroyed || response.socket?.destroyed) {
        record(true)
        return
      }
      const elapsed = Date.now() - started
      if (elapsed >= durationMs) {
        response.end(
          `data: ${JSON.stringify({
            id: "chatcmpl-mac-runtime-soak",
            object: "chat.completion.chunk",
            created: Math.floor(Date.now() / 1_000),
            model: "mac-runtime-soak",
            choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          })}\n\ndata: [DONE]\n\n`,
        )
        record(false)
        return
      }
      chunks += 1
      response.write(
        `data: ${JSON.stringify({
          id: "chatcmpl-mac-runtime-soak",
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1_000),
          model: "mac-runtime-soak",
          choices: [{ index: 0, delta: { content: "." }, finish_reason: null }],
        })}\n\n`,
      )
      timer = setTimeout(send, Math.min(intervalMs, Math.max(1, durationMs - elapsed)))
    }
    send()
  })

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(input?.port ?? 0, hostname, () => {
      server.off("error", reject)
      resolve()
    })
  })
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Soak server address is unavailable")

  return {
    endpoint: `http://${hostname}:${address.port}/v1`,
    model: "mac-runtime-soak",
    token,
    observation,
    stop: () => {
      server.closeAllConnections()
      server.close()
    },
  }
}

function option(name: string) {
  const index = process.argv.indexOf(name)
  if (index === -1) return
  return process.argv[index + 1]
}

async function main() {
  const durationMs = Number(option("--duration-ms") ?? DEFAULT_MAC_RUNTIME_SOAK_DURATION_MS)
  const intervalMs = Number(option("--interval-ms") ?? 15_000)
  const port = Number(option("--port") ?? 0)
  const evidencePath = path.resolve(option("--evidence") ?? "dist/mac-runtime-soak-evidence.json")
  const fixture = await createMacRuntimeSoakFixture({ durationMs, intervalMs, port, token: option("--token") })
  console.log(
    `SOAK_READY ${JSON.stringify({ endpoint: fixture.endpoint, model: fixture.model, token: fixture.token, evidencePath })}`,
  )
  const evidence = await fixture.observation
  fixture.stop()
  await mkdir(path.dirname(evidencePath), { recursive: true })
  await Bun.write(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`)
  assertMacRuntimeSoakEvidence(evidence)
  console.log(`SOAK_COMPLETE ${evidencePath}`)
}

if (import.meta.main) await main()
