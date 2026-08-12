import { mkdir } from "node:fs/promises"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import path from "node:path"
import { performance } from "node:perf_hooks"
import {
  DEFAULT_MAC_RUNTIME_SOAK_DURATION_MS,
  DEFAULT_MAC_RUNTIME_SOAK_INTERVAL_MS,
  assertMacRuntimeSoakServerEvidence,
  macRuntimeSoakTerminalMarker,
  type MacRuntimeSoakDisconnectReason,
  type MacRuntimeSoakObservation,
} from "./mac-runtime-soak-evidence"

export {
  DEFAULT_MAC_RUNTIME_SOAK_DURATION_MS,
  DEFAULT_MAC_RUNTIME_SOAK_INTERVAL_MS,
  assertMacRuntimeSoakEvidence,
  assertMacRuntimeSoakServerEvidence,
  combineMacRuntimeSoakEvidence,
  verifyMacRuntimeSoakEvidence,
} from "./mac-runtime-soak-evidence"
export type {
  MacRuntimeSoakDisconnectReason,
  MacRuntimeSoakEvidence,
  MacRuntimeSoakEvidencePolicy,
  MacRuntimeSoakObservation,
  MacRuntimeSoakPackagedClientAcknowledgment,
  MacRuntimeSoakSessionExport,
  MacRuntimeSoakServerEvidence,
} from "./mac-runtime-soak-evidence"

export const DEFAULT_MAC_RUNTIME_SOAK_CONNECTION_TIMEOUT_MS = 60_000
export const DEFAULT_MAC_RUNTIME_SOAK_BACKPRESSURE_TIMEOUT_MS = 30_000
export const DEFAULT_MAC_RUNTIME_SOAK_ACKNOWLEDGMENT_TIMEOUT_MS = 5 * 60_000

export async function createMacRuntimeSoakFixture(input?: {
  durationMs?: number
  intervalMs?: number
  connectionTimeoutMs?: number
  backpressureTimeoutMs?: number
  acknowledgmentTimeoutMs?: number
  initialSilenceMs?: number
  midSilence?: { afterChunks: number; durationMs: number }
  maxRequestBodyBytes?: number
  chunkContent?: string
  hostname?: string
  port?: number
  token?: string
  runID?: string
  requiredPrompt?: string
}) {
  const durationMs = input?.durationMs ?? DEFAULT_MAC_RUNTIME_SOAK_DURATION_MS
  const intervalMs = input?.intervalMs ?? DEFAULT_MAC_RUNTIME_SOAK_INTERVAL_MS
  const connectionTimeoutMs = input?.connectionTimeoutMs ?? DEFAULT_MAC_RUNTIME_SOAK_CONNECTION_TIMEOUT_MS
  const backpressureTimeoutMs = input?.backpressureTimeoutMs ?? DEFAULT_MAC_RUNTIME_SOAK_BACKPRESSURE_TIMEOUT_MS
  const acknowledgmentTimeoutMs = input?.acknowledgmentTimeoutMs ?? DEFAULT_MAC_RUNTIME_SOAK_ACKNOWLEDGMENT_TIMEOUT_MS
  const initialSilenceMs = input?.initialSilenceMs ?? 0
  const maxRequestBodyBytes = input?.maxRequestBodyBytes ?? 1024 * 1024
  const chunkContent = input?.chunkContent ?? "."
  const hostname = input?.hostname ?? "127.0.0.1"
  const token = input?.token ?? `soak-${crypto.randomUUID()}`
  const runID = input?.runID ?? crypto.randomUUID()
  const model = "mac-runtime-soak"
  requirePositiveInteger(durationMs, "Soak duration")
  requirePositiveInteger(intervalMs, "Soak interval")
  requirePositiveInteger(connectionTimeoutMs, "Soak connection timeout")
  requirePositiveInteger(backpressureTimeoutMs, "Soak backpressure timeout")
  requirePositiveInteger(acknowledgmentTimeoutMs, "Soak acknowledgment timeout")
  requireNonNegativeInteger(initialSilenceMs, "Soak initial silence")
  requirePositiveInteger(maxRequestBodyBytes, "Soak maximum request body size")
  if (!/^[a-zA-Z0-9-]{1,128}$/.test(runID)) throw new Error("Soak runID is invalid")
  if (!chunkContent || Buffer.byteLength(chunkContent) > 512 * 1024) {
    throw new Error("Soak chunk content must contain between 1 and 524288 bytes")
  }
  if (
    input?.requiredPrompt !== undefined &&
    (!input.requiredPrompt.trim() || Buffer.byteLength(input.requiredPrompt) > 16 * 1024)
  ) {
    throw new Error("Soak required prompt must contain between 1 and 16384 bytes")
  }
  if (input?.midSilence) {
    requirePositiveInteger(input.midSilence.afterChunks, "Soak mid-silence chunk count")
    requirePositiveInteger(input.midSilence.durationMs, "Soak mid-silence duration")
  }

  const marker = macRuntimeSoakTerminalMarker(runID)
  const fixtureStartedAt = Date.now()
  const fixtureStartedMonotonic = performance.now()
  const deferred = Promise.withResolvers<MacRuntimeSoakObservation>()
  let settled = false
  let connectionTimer: ReturnType<typeof setTimeout> | undefined
  let closePromise: Promise<void> | undefined
  let stopPromise: Promise<MacRuntimeSoakObservation> | undefined
  let active:
    | {
        response: ServerResponse
        socket: IncomingMessage["socket"]
        localPort?: number
        remotePort?: number
        startedAt: number
        startedMonotonic: number
        activityElapsedMs: number[]
        terminalElapsedMs?: number
        finishElapsedMs?: number
        finishObserved: boolean
        clientAcknowledged: boolean
        peerDisconnected: boolean
        cancellers: Set<() => void>
      }
    | undefined

  const observation = (reason: MacRuntimeSoakDisconnectReason) => {
    const startedAt = active?.startedAt ?? fixtureStartedAt
    const startedMonotonic = active?.startedMonotonic ?? fixtureStartedMonotonic
    const observedDurationMs =
      reason === "completed" && active?.finishElapsedMs !== undefined
        ? active.finishElapsedMs
        : Math.max(0, Math.round(performance.now() - startedMonotonic))
    const activityElapsedMs = active?.activityElapsedMs ?? []
    const terminalElapsedMs = active?.terminalElapsedMs
    const timeline = [
      0,
      ...activityElapsedMs,
      ...(terminalElapsedMs === undefined ? [] : [terminalElapsedMs]),
      observedDurationMs,
    ]
    return {
      runID,
      terminalMarker: marker,
      startedAt: timestamp(startedAt, 0),
      completedAt: timestamp(startedAt, observedDurationMs),
      requestedDurationMs: durationMs,
      observedDurationMs,
      chunks: activityElapsedMs.length,
      activityAt: activityElapsedMs.map((elapsed) => timestamp(startedAt, elapsed)),
      terminalAt: terminalElapsedMs === undefined ? null : timestamp(startedAt, terminalElapsedMs),
      maxActivityGapMs: Math.max(...timeline.slice(1).map((item, index) => item - timeline[index])),
      clientAcknowledged: active?.clientAcknowledged ?? false,
      clientAbort: reason === "client-abort" || reason === "client-unresponsive",
      completed: reason === "completed",
      disconnectReason: reason,
    } satisfies MacRuntimeSoakObservation
  }

  const settle = (reason: MacRuntimeSoakDisconnectReason) => {
    if (settled) return
    settled = true
    if (connectionTimer) clearTimeout(connectionTimer)
    active?.cancellers.forEach((cancel) => cancel())
    active?.cancellers.clear()
    deferred.resolve(observation(reason))
  }

  const server = createServer((request, response) => {
    void handleRequest(request, response).catch(() => {
      if (!response.headersSent) sendJson(response, 500, { error: { message: "Soak fixture request failed" } })
      else response.destroy()
    })
  })

  const closeServer = () => {
    if (closePromise) return closePromise
    closePromise = new Promise<void>((resolve, reject) => {
      if (!server.listening) {
        resolve()
        return
      }
      server.close((error) => {
        if (error && (error as NodeJS.ErrnoException).code !== "ERR_SERVER_NOT_RUNNING") {
          reject(error)
          return
        }
        resolve()
      })
      server.closeAllConnections()
    })
    return closePromise
  }

  async function handleRequest(request: IncomingMessage, response: ServerResponse) {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? hostname}`)
    if (request.headers.authorization !== `Bearer ${token}`) {
      request.resume()
      sendJson(response, 401, { error: { message: "Unauthorized" } })
      return
    }
    if (request.method === "GET" && url.pathname === "/v1/models") {
      sendJson(response, 200, { object: "list", data: [{ id: model, object: "model", owned_by: "mac-runtime-soak" }] })
      return
    }
    if (request.method === "POST" && url.pathname === `/v1/runs/${encodeURIComponent(runID)}/acknowledgment`) {
      const body = await readRequestBody(request, 4_096)
      if (!body.ok) {
        sendJson(response, body.status, { error: { message: body.message } })
        return
      }
      const parsed = parseAcknowledgment(body.value, runID, marker)
      if (!parsed.ok) {
        sendJson(response, 400, { error: { message: parsed.message } })
        return
      }
      if (settled || !active || active.terminalElapsedMs === undefined) {
        sendJson(response, settled ? 410 : 409, {
          error: { message: settled ? "Soak run already settled" : "Soak terminal marker has not been sent" },
        })
        return
      }
      active.clientAcknowledged = true
      if (active.finishObserved) settle("completed")
      response.writeHead(204)
      response.end()
      return
    }
    if (request.method !== "POST" || url.pathname !== "/v1/chat/completions") {
      request.resume()
      sendJson(response, 404, { error: { message: "Not found" } })
      return
    }
    const body = await readRequestBody(request, maxRequestBodyBytes)
    if (!body.ok) {
      sendJson(response, body.status, { error: { message: body.message } })
      return
    }
    const parsed = parseRequest(body.value)
    if (!parsed.ok) {
      sendJson(response, 400, { error: { message: parsed.message } })
      return
    }
    if (parsed.value.model !== model) {
      sendJson(response, 400, { error: { message: `Unknown model: ${String(parsed.value.model)}` } })
      return
    }
    if (parsed.value.stream !== true) {
      sendJson(response, 400, { error: { message: "The soak fixture requires stream=true" } })
      return
    }
    const messageError = validateMessages(parsed.value.messages)
    if (messageError) {
      sendJson(response, 400, { error: { message: messageError } })
      return
    }
    if (input?.requiredPrompt && !hasExactUserPrompt(parsed.value.messages, input.requiredPrompt)) {
      sendAuxiliaryCompletion(response, runID, model)
      return
    }
    if (settled || active) {
      sendJson(response, settled ? 410 : 409, {
        error: { message: settled ? "Soak run already settled" : "Soak stream already active" },
      })
      return
    }

    if (connectionTimer) clearTimeout(connectionTimer)
    const state = {
      response,
      socket: request.socket,
      localPort: request.socket.localPort,
      remotePort: request.socket.remotePort,
      startedAt: Date.now(),
      startedMonotonic: performance.now(),
      activityElapsedMs: [],
      terminalElapsedMs: undefined,
      finishElapsedMs: undefined,
      finishObserved: false,
      clientAcknowledged: false,
      peerDisconnected: false,
      cancellers: new Set<() => void>(),
    }
    active = state
    const peerDisconnected = () =>
      state.peerDisconnected ||
      state.socket.destroyed ||
      state.socket.closed ||
      !state.socket.readable ||
      state.socket.readableEnded ||
      !state.socket.writable
    const disconnectReason = (fallback: MacRuntimeSoakDisconnectReason) =>
      peerDisconnected() ? "client-abort" : fallback
    const classifyDisconnect = async (fallback: MacRuntimeSoakDisconnectReason) => {
      if (peerDisconnected()) return "client-abort" as const
      const established = await macSocketEstablished(state.localPort, state.remotePort)
      if (established === false) {
        state.peerDisconnected = true
        return "client-abort" as const
      }
      return fallback
    }
    const markPeerDisconnected = () => {
      state.peerDisconnected = true
      if (!state.finishObserved) settle("client-abort")
    }
    state.socket.once("end", markPeerDisconnected)
    state.socket.once("close", markPeerDisconnected)
    state.socket.once("error", markPeerDisconnected)
    state.cancellers.add(() => {
      state.socket.off("end", markPeerDisconnected)
      state.socket.off("close", markPeerDisconnected)
      state.socket.off("error", markPeerDisconnected)
    })
    const disconnectPoll = setInterval(() => {
      if (peerDisconnected()) {
        state.peerDisconnected = true
        settle("client-abort")
      }
    }, 1_000)
    disconnectPoll.unref()
    state.cancellers.add(() => clearInterval(disconnectPoll))
    response.once("finish", () => {
      state.finishObserved = true
      state.finishElapsedMs = Math.max(0, Math.round(performance.now() - state.startedMonotonic))
      if (state.clientAcknowledged) {
        settle("completed")
        return
      }
      const acknowledgmentTimer = setTimeout(() => settle("client-unresponsive"), acknowledgmentTimeoutMs)
      state.cancellers.add(() => clearTimeout(acknowledgmentTimer))
    })
    response.once("close", () => {
      if (state.finishObserved) return
      state.peerDisconnected = true
      settle("client-abort")
    })
    response.once("error", () => settle(disconnectReason("response-error")))
    request.once("aborted", () => {
      state.peerDisconnected = true
      settle("client-abort")
    })
    response.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
      "x-mac-runtime-soak-run-id": runID,
    })
    response.flushHeaders()

    const wait = (milliseconds: number) =>
      new Promise<boolean>((resolve) => {
        if (settled) {
          resolve(false)
          return
        }
        let done = false
        const finish = (result: boolean) => {
          if (done) return
          done = true
          clearTimeout(timer)
          state.cancellers.delete(cancel)
          resolve(result)
        }
        const timer = setTimeout(() => finish(true), milliseconds)
        const cancel = () => finish(false)
        state.cancellers.add(cancel)
      })

    const write = (value: string) =>
      new Promise<boolean>((resolve) => {
        if (settled || response.destroyed || response.socket?.destroyed) {
          if (!settled) {
            state.peerDisconnected = true
            settle("client-abort")
          }
          resolve(false)
          return
        }
        let drainObserved = true
        let done = false
        let backpressureTimer: ReturnType<typeof setTimeout> | undefined
        const finish = (result: boolean) => {
          if (done) return
          done = true
          response.off("drain", onDrain)
          if (backpressureTimer) clearTimeout(backpressureTimer)
          state.cancellers.delete(cancel)
          resolve(result)
        }
        const onDrain = () => {
          drainObserved = true
          if (!settled && (response.destroyed || response.socket?.destroyed)) {
            state.peerDisconnected = true
            settle("client-abort")
          }
          finish(!settled && !response.destroyed && !response.socket?.destroyed)
        }
        const cancel = () => finish(false)
        state.cancellers.add(cancel)
        try {
          drainObserved = response.write(value)
          if (!drainObserved) {
            response.once("drain", onDrain)
            backpressureTimer = setTimeout(() => {
              void classifyDisconnect("client-unresponsive").then((reason) => {
                if (settled) {
                  finish(false)
                  return
                }
                settle(reason)
                response.destroy()
                finish(false)
              })
            }, backpressureTimeoutMs)
          }
          if (drainObserved) finish(true)
        } catch {
          settle(disconnectReason("response-error"))
          finish(false)
        }
      })

    const elapsed = () => Math.max(0, Math.round(performance.now() - state.startedMonotonic))
    const writeActivity = async () => {
      const written = await write(
        sse({
          id: `chatcmpl-${runID}`,
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1_000),
          model,
          choices: [{ index: 0, delta: { content: chunkContent }, finish_reason: null }],
        }),
      )
      if (written) state.activityElapsedMs.push(elapsed())
      return written
    }

    const run = async () => {
      if (initialSilenceMs > 0 && !(await wait(initialSilenceMs))) return
      let midSilenceObserved = false
      while (elapsed() < durationMs) {
        if (settled) return
        if (!(await writeActivity())) return
        if (
          !midSilenceObserved &&
          input?.midSilence &&
          state.activityElapsedMs.length >= input.midSilence.afterChunks
        ) {
          midSilenceObserved = true
          if (!(await wait(input.midSilence.durationMs))) return
        }
        const remaining = durationMs - elapsed()
        if (remaining <= 0) break
        if (!(await wait(Math.min(intervalMs, remaining)))) return
      }
      if (settled) return
      const terminalWritten = await write(
        sse({
          id: `chatcmpl-${runID}`,
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1_000),
          model,
          choices: [{ index: 0, delta: { content: `\n${marker}` }, finish_reason: null }],
        }),
      )
      if (!terminalWritten) return
      state.terminalElapsedMs = elapsed()
      response.end(
        `${sse({
          id: `chatcmpl-${runID}`,
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1_000),
          model,
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        })}data: [DONE]\n\n`,
      )
      if (!settled && !state.finishObserved) {
        const finishTimer = setTimeout(() => {
          if (state.finishObserved) return
          void classifyDisconnect("client-unresponsive").then((reason) => {
            if (settled || state.finishObserved) return
            settle(reason)
            response.destroy()
          })
        }, backpressureTimeoutMs)
        state.cancellers.add(() => clearTimeout(finishTimer))
      }
    }
    void run().catch(() => settle("response-error"))
  }

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(input?.port ?? 0, hostname, () => {
      server.off("error", reject)
      resolve()
    })
  })
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Soak server address is unavailable")
  connectionTimer = setTimeout(() => {
    settle("connection-timeout")
    void closeServer()
  }, connectionTimeoutMs)

  return {
    endpoint: `http://${hostname}:${address.port}/v1`,
    model,
    token,
    runID,
    terminalMarker: marker,
    acknowledgmentEndpoint: `http://${hostname}:${address.port}/v1/runs/${encodeURIComponent(runID)}/acknowledgment`,
    acknowledgeClient: async () => {
      const response = await fetch(
        `http://${hostname}:${address.port}/v1/runs/${encodeURIComponent(runID)}/acknowledgment`,
        {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({ runID, terminalMarker: marker }),
        },
      )
      if (!response.ok) throw new Error(`Soak client acknowledgment failed with ${response.status}`)
      await response.body?.cancel()
    },
    observation: deferred.promise,
    stop: () => {
      if (stopPromise) return stopPromise
      stopPromise = (async () => {
        if (!settled) settle("fixture-stop")
        active?.response.destroy()
        await closeServer()
        return deferred.promise
      })()
      return stopPromise
    },
  }
}

async function readRequestBody(request: IncomingMessage, maximumBytes: number) {
  const contentLength = Number(request.headers["content-length"])
  if (Number.isFinite(contentLength) && contentLength > maximumBytes) {
    request.resume()
    return { ok: false as const, status: 413, message: "Request body is too large" }
  }
  const chunks: Buffer[] = []
  let bytes = 0
  let oversized = false
  for await (const value of request) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value)
    bytes += chunk.byteLength
    if (bytes > maximumBytes) {
      oversized = true
      continue
    }
    chunks.push(chunk)
  }
  if (oversized) return { ok: false as const, status: 413, message: "Request body is too large" }
  return { ok: true as const, value: Buffer.concat(chunks).toString("utf8") }
}

function validateMessages(value: unknown) {
  if (!Array.isArray(value) || value.length === 0) return "The soak fixture requires at least one message"
  if (value.length > 256) return "The soak fixture accepts at most 256 messages"
  const invalid = value.findIndex((message) => {
    if (!isRecord(message) || typeof message.role !== "string") return true
    if (message.role === "system" || message.role === "developer" || message.role === "user") {
      return (
        !hasExactFields(message, ["content", "name", "role"]) ||
        !validOptionalName(message.name) ||
        !validContent(message.content)
      )
    }
    if (message.role === "assistant") {
      if (!hasExactFields(message, ["content", "name", "role", "tool_calls"])) return true
      if (!validOptionalName(message.name)) return true
      const hasContent = message.content !== null && message.content !== undefined
      const hasToolCalls = Array.isArray(message.tool_calls) && message.tool_calls.length > 0
      if (!hasContent && !hasToolCalls) return true
      if (hasContent && !validContent(message.content)) return true
      return hasToolCalls ? !validToolCalls(message.tool_calls) : message.tool_calls !== undefined
    }
    if (message.role === "tool") {
      return (
        !hasExactFields(message, ["content", "name", "role", "tool_call_id"]) ||
        !validOptionalName(message.name) ||
        !validContent(message.content) ||
        !validIdentifier(message.tool_call_id)
      )
    }
    return true
  })
  if (invalid !== -1) return `The soak fixture message at index ${invalid} is invalid`
  return undefined
}

function validContent(value: unknown) {
  if (typeof value === "string") return Boolean(value.trim()) && Buffer.byteLength(value) <= 1024 * 1024
  if (!Array.isArray(value) || value.length === 0 || value.length > 64) return false
  return value.every((part) => {
    if (!isRecord(part) || !hasExactFields(part, ["text", "type"])) return false
    return (
      part.type === "text" &&
      typeof part.text === "string" &&
      Boolean(part.text.trim()) &&
      Buffer.byteLength(part.text) <= 1024 * 1024
    )
  })
}

function hasExactUserPrompt(value: unknown, requiredPrompt: string) {
  if (!Array.isArray(value)) return false
  const message = value.filter((item) => isRecord(item) && item.role === "user").at(-1)
  if (!message) return false
  if (typeof message.content === "string") return message.content === requiredPrompt
  if (!Array.isArray(message.content)) return false
  return message.content.some((part) => isRecord(part) && part.type === "text" && part.text === requiredPrompt)
}

function validToolCalls(value: unknown[]) {
  if (value.length > 64) return false
  return value.every((call) => {
    if (!isRecord(call) || !hasExactFields(call, ["function", "id", "type"])) return false
    if (!validIdentifier(call.id) || call.type !== "function" || !isRecord(call.function)) return false
    if (!hasExactFields(call.function, ["arguments", "name"])) return false
    return (
      validIdentifier(call.function.name) &&
      typeof call.function.arguments === "string" &&
      Buffer.byteLength(call.function.arguments) <= 1024 * 1024
    )
  })
}

function hasExactFields(value: Record<string, unknown>, allowed: string[]) {
  const fields = Object.keys(value)
  return fields.every((field) => allowed.includes(field))
}

function validIdentifier(value: unknown) {
  return typeof value === "string" && Boolean(value.trim()) && Buffer.byteLength(value) <= 256
}

function validOptionalName(value: unknown) {
  return value === undefined || validIdentifier(value)
}

async function macSocketEstablished(localPort: number | undefined, remotePort: number | undefined) {
  if (process.platform !== "darwin" || localPort === undefined || remotePort === undefined) {
    return undefined
  }
  const child = Bun.spawn(["/usr/sbin/lsof", "-nP", "-a", "-p", String(process.pid), "-iTCP"], {
    stdout: "pipe",
    stderr: "pipe",
  })
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  if (stderr.trim()) return undefined
  if (exitCode !== 0 && exitCode !== 1) return undefined
  return stdout
    .split("\n")
    .some((line) => line.includes(`:${localPort}->`) && line.includes(`:${remotePort} (ESTABLISHED)`))
}

function parseRequest(value: string) {
  try {
    const parsed: unknown = JSON.parse(value)
    if (!isRecord(parsed)) {
      return { ok: false as const, message: "Request body must be a JSON object" }
    }
    return { ok: true as const, value: parsed }
  } catch {
    return { ok: false as const, message: "Request body is not valid JSON" }
  }
}

function parseAcknowledgment(value: string, runID: string, terminalMarker: string) {
  const parsed = parseRequest(value)
  if (!parsed.ok) return parsed
  if (Object.keys(parsed.value).sort().join() !== "runID,terminalMarker") {
    return { ok: false as const, message: "Soak acknowledgment fields are invalid" }
  }
  if (parsed.value.runID !== runID || parsed.value.terminalMarker !== terminalMarker) {
    return { ok: false as const, message: "Soak acknowledgment identity is invalid" }
  }
  return { ok: true as const }
}

function sendJson(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, { "content-type": "application/json" })
  response.end(JSON.stringify(value))
}

function sendAuxiliaryCompletion(response: ServerResponse, runID: string, model: string) {
  const chunk = (content: string | undefined, finish: string | null) =>
    sse({
      id: `chatcmpl-${runID}-auxiliary`,
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1_000),
      model,
      choices: [{ index: 0, delta: content ? { content } : {}, finish_reason: finish }],
    })
  response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" })
  response.end(`${chunk("Auxiliary request completed", null)}${chunk(undefined, "stop")}data: [DONE]\n\n`)
}

function sse(value: unknown) {
  return `data: ${JSON.stringify(value)}\n\n`
}

function timestamp(startedAt: number, elapsedMs: number) {
  return new Date(startedAt + elapsedMs).toISOString()
}

function requirePositiveInteger(value: unknown, name: string): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`)
  }
}

function requireNonNegativeInteger(value: unknown, name: string): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  if (index === -1) return undefined
  return process.argv[index + 1]
}

async function main() {
  const durationMs = Number(option("--duration-ms") ?? DEFAULT_MAC_RUNTIME_SOAK_DURATION_MS)
  const intervalMs = Number(option("--interval-ms") ?? DEFAULT_MAC_RUNTIME_SOAK_INTERVAL_MS)
  const connectionTimeoutMs = Number(
    option("--connection-timeout-ms") ?? DEFAULT_MAC_RUNTIME_SOAK_CONNECTION_TIMEOUT_MS,
  )
  const backpressureTimeoutMs = Number(
    option("--backpressure-timeout-ms") ?? DEFAULT_MAC_RUNTIME_SOAK_BACKPRESSURE_TIMEOUT_MS,
  )
  const acknowledgmentTimeoutMs = Number(
    option("--acknowledgment-timeout-ms") ?? DEFAULT_MAC_RUNTIME_SOAK_ACKNOWLEDGMENT_TIMEOUT_MS,
  )
  const initialSilenceMs = Number(option("--initial-silence-ms") ?? 0)
  const midSilenceMs = Number(option("--mid-silence-ms") ?? 0)
  const midSilenceAfterChunks = Number(option("--mid-silence-after-chunks") ?? 1)
  const port = Number(option("--port") ?? 0)
  const evidencePath = path.resolve(option("--evidence") ?? "dist/mac-runtime-soak-server-evidence.json")
  const fixture = await createMacRuntimeSoakFixture({
    durationMs,
    intervalMs,
    connectionTimeoutMs,
    backpressureTimeoutMs,
    acknowledgmentTimeoutMs,
    initialSilenceMs,
    midSilence: midSilenceMs > 0 ? { afterChunks: midSilenceAfterChunks, durationMs: midSilenceMs } : undefined,
    port,
    token: option("--token"),
    runID: option("--run-id"),
    requiredPrompt: option("--required-prompt"),
  })
  console.log(
    `SOAK_READY ${JSON.stringify({
      endpoint: fixture.endpoint,
      model: fixture.model,
      token: fixture.token,
      runID: fixture.runID,
      terminalMarker: fixture.terminalMarker,
      acknowledgmentEndpoint: fixture.acknowledgmentEndpoint,
      evidencePath,
    })}`,
  )
  const evidence = await fixture.observation
  await fixture.stop()
  await mkdir(path.dirname(evidencePath), { recursive: true })
  await Bun.write(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`)
  assertMacRuntimeSoakServerEvidence(evidence, {
    minimumRequestedDurationMs: durationMs,
    minimumChunks: initialSilenceMs > 0 || midSilenceMs > 0 ? 1 : Math.max(2, Math.floor(durationMs / intervalMs) - 1),
    maximumActivityGapMs: Math.max(intervalMs * 2, initialSilenceMs + intervalMs, midSilenceMs + intervalMs) + 2_000,
  })
  console.log(`SOAK_SERVER_COMPLETE ${evidencePath}`)
}

if (import.meta.main) await main()
