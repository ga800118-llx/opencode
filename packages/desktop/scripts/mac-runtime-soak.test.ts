import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { request, type IncomingMessage } from "node:http"
import { connect, type Socket } from "node:net"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  DEFAULT_MAC_RUNTIME_SOAK_DURATION_MS,
  assertMacRuntimeSoakEvidence,
  assertMacRuntimeSoakServerEvidence,
  combineMacRuntimeSoakEvidence,
  createMacRuntimeSoakFixture,
  verifyMacRuntimeSoakEvidence,
  type MacRuntimeSoakEvidencePolicy,
  type MacRuntimeSoakServerEvidence,
} from "./mac-runtime-soak"
import { formatChecksumManifest, sha256 } from "./internal-package"

const shortPolicy: MacRuntimeSoakEvidencePolicy = {
  minimumRequestedDurationMs: 40,
  minimumChunks: 2,
  maximumActivityGapMs: 30,
  durationToleranceMs: 5,
}

const valid = (): MacRuntimeSoakServerEvidence => ({
  runID: "00000000-0000-4000-8000-000000000001",
  terminalMarker: "MAC_RUNTIME_SOAK_COMPLETE:00000000-0000-4000-8000-000000000001",
  startedAt: "2026-08-11T00:00:00.000Z",
  completedAt: "2026-08-11T00:00:00.040Z",
  requestedDurationMs: 40,
  observedDurationMs: 40,
  chunks: 3,
  activityAt: ["2026-08-11T00:00:00.000Z", "2026-08-11T00:00:00.010Z", "2026-08-11T00:00:00.020Z"],
  terminalAt: "2026-08-11T00:00:00.040Z",
  maxActivityGapMs: 20,
  clientAcknowledged: true,
  clientAbort: false,
  completed: true,
  disconnectReason: "completed",
})

describe("Mac runtime soak evidence", () => {
  test("uses a 65-minute packaged verification duration", () => {
    expect(DEFAULT_MAC_RUNTIME_SOAK_DURATION_MS).toBe(65 * 60_000)
  })

  test("binds a structured packaged-client export to the package manifest and valid ZIP", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "mac-runtime-soak-"))
    const artifacts = await createEvidenceArtifacts(directory)
    try {
      await Bun.write(artifacts.sourcePath, "forged handwritten evidence")
      expect(assertMacRuntimeSoakServerEvidence(valid(), shortPolicy)).toEqual(valid())
      expect(() => assertMacRuntimeSoakEvidence(valid(), shortPolicy)).toThrow("fields")
      const evidence = await combineMacRuntimeSoakEvidence(valid(), artifacts, shortPolicy)
      expect(evidence.packagedClientAcknowledgment).toMatchObject({
        runID: valid().runID,
        terminalMarker: valid().terminalMarker,
        source: "packaged-client-session-export",
        sourcePath: artifacts.sourcePath,
        manifestPath: artifacts.manifestPath,
        packagePath: artifacts.packagePath,
        packageVersion: "0.1.0-alpha.2",
        packageFormat: "zip",
      })
      expect(evidence.packagedClientAcknowledgment.sourceSha256).toMatch(/^[a-f0-9]{64}$/)
      expect(evidence.packagedClientAcknowledgment.manifestSha256).toMatch(/^[a-f0-9]{64}$/)
      expect(await Bun.file(artifacts.sourcePath).json()).toMatchObject({
        capture: {
          transport: "opencode-session-http",
          sessionID: "ses_soak",
          directory,
          endpoint: artifacts.session.endpoint,
          responseSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        },
      })
      expect(await verifyMacRuntimeSoakEvidence(evidence, shortPolicy)).toEqual(evidence)
      expect(() =>
        assertMacRuntimeSoakEvidence(
          {
            ...evidence,
            packagedClientAcknowledgment: { ...evidence.packagedClientAcknowledgment, runID: "different-run" },
          },
          shortPolicy,
        ),
      ).toThrow("runID")
    } finally {
      await artifacts.stop()
      await rm(directory, { recursive: true, force: true })
    }
  })

  test("completes server evidence only after the packaged session is captured and acknowledged", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "mac-runtime-soak-ack-flow-"))
    const fixture = await createMacRuntimeSoakFixture({
      durationMs: 40,
      intervalMs: 5,
      connectionTimeoutMs: 500,
      acknowledgmentTimeoutMs: 500,
    })
    const response = await stream(fixture.endpoint, fixture.token, fixture.model)
    expect(await response.text()).toContain(fixture.terminalMarker)
    const artifacts = await createEvidenceArtifacts(directory, [
      assistantMessage(`response\n${fixture.terminalMarker}`, Date.now()),
    ])
    try {
      const evidence = await combineMacRuntimeSoakEvidence(
        fixture.observation,
        {
          ...artifacts,
          fixture: {
            runID: fixture.runID,
            terminalMarker: fixture.terminalMarker,
            acknowledgmentEndpoint: fixture.acknowledgmentEndpoint,
            token: fixture.token,
          },
        },
        { ...shortPolicy, minimumRequestedDurationMs: 40, maximumActivityGapMs: 5_000 },
      )
      expect(evidence).toMatchObject({
        clientAcknowledged: true,
        completed: true,
        disconnectReason: "completed",
        packagedClientAcknowledgment: { runID: fixture.runID, terminalMarker: fixture.terminalMarker },
      })
    } finally {
      await artifacts.stop()
      await fixture.stop()
      await rm(directory, { recursive: true, force: true })
    }
  })

  test("rejects forged package names, manifests, and ZIP content", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "mac-runtime-soak-forged-"))
    const artifacts = await createEvidenceArtifacts(directory)
    try {
      await Bun.write(
        artifacts.manifestPath,
        `${await sha256(artifacts.packagePath)} ${path.basename(artifacts.packagePath)}`,
      )
      await expect(combineMacRuntimeSoakEvidence(valid(), artifacts, shortPolicy)).rejects.toThrow("manifest format")

      await Bun.write(
        artifacts.manifestPath,
        formatChecksumManifest([{ file: artifacts.packagePath, sha256: "0".repeat(64) }]),
      )
      await expect(combineMacRuntimeSoakEvidence(valid(), artifacts, shortPolicy)).rejects.toThrow("manifest")

      await Bun.write(
        artifacts.manifestPath,
        formatChecksumManifest([{ file: artifacts.packagePath, sha256: await sha256(artifacts.packagePath) }]),
      )
      const wrongNamePath = path.join(directory, "Guai-Code-Beta-mac-arm64.zip")
      await Bun.write(wrongNamePath, Bun.file(artifacts.packagePath))
      await expect(
        combineMacRuntimeSoakEvidence(valid(), { ...artifacts, packagePath: wrongNamePath }, shortPolicy),
      ).rejects.toThrow("name")

      const wrongManifestPath = path.join(directory, "checksums.txt")
      await Bun.write(wrongManifestPath, Bun.file(artifacts.manifestPath))
      await expect(
        combineMacRuntimeSoakEvidence(valid(), { ...artifacts, manifestPath: wrongManifestPath }, shortPolicy),
      ).rejects.toThrow("SHA256SUMS.txt")

      await Bun.write(artifacts.packagePath, "not a ZIP archive")
      const invalidHash = await sha256(artifacts.packagePath)
      await Bun.write(
        artifacts.manifestPath,
        formatChecksumManifest([{ file: artifacts.packagePath, sha256: invalidHash }]),
      )
      await expect(combineMacRuntimeSoakEvidence(valid(), artifacts, shortPolicy)).rejects.toThrow("ZIP")
    } finally {
      await artifacts.stop()
      await rm(directory, { recursive: true, force: true })
    }
  })

  test("rejects an arbitrary loopback responder that is not owned by the packaged runtime", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "mac-runtime-soak-fake-listener-"))
    const artifacts = await createEvidenceArtifacts(directory)
    const fake = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => Response.json([assistantMessage(`response\n${valid().terminalMarker}`)]),
    })
    try {
      await expect(
        combineMacRuntimeSoakEvidence(
          valid(),
          {
            ...artifacts,
            session: { ...artifacts.session, endpoint: `http://127.0.0.1:${fake.port}/session/ses_soak/message` },
          },
          shortPolicy,
        ),
      ).rejects.toThrow("not running from the packaged app")
    } finally {
      fake.stop(true)
      await artifacts.stop()
      await rm(directory, { recursive: true, force: true })
    }
  })

  test("rejects live session responses that do not exactly prove one completed assistant output", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "mac-runtime-soak-transcript-"))
    try {
      await expectInvalidSession(
        path.join(directory, "inline-marker"),
        [assistantMessage(`completed ${valid().terminalMarker} suffix`)],
        "exactly one completed assistant marker",
      )
      await expectInvalidSession(
        path.join(directory, "duplicate-marker"),
        [
          assistantMessage(valid().terminalMarker, Date.parse(valid().completedAt), "msg_assistant_one"),
          assistantMessage(valid().terminalMarker, Date.parse(valid().completedAt), "msg_assistant_two"),
        ],
        "exactly one completed assistant marker",
      )
      await expectInvalidSession(
        path.join(directory, "duplicate-marker-line"),
        [assistantMessage(`${valid().terminalMarker}\n${valid().terminalMarker}`)],
        "exactly one completed assistant marker",
      )
      await expectInvalidSession(
        path.join(directory, "early-marker"),
        [assistantMessage(valid().terminalMarker, Date.parse(valid().terminalAt) - 1)],
        "predates",
      )
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test("rejects a structurally valid DMG that does not contain the packaged app", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "mac-runtime-soak-empty-dmg-"))
    const artifacts = await createEvidenceArtifacts(path.join(directory, "session"))
    try {
      const dmg = await createEmptyDmgArtifacts(path.join(directory, "dmg"), artifacts.session, artifacts.fixture)
      await expect(combineMacRuntimeSoakEvidence(valid(), dmg, shortPolicy)).rejects.toThrow("missing a valid")
    } finally {
      await artifacts.stop()
      await rm(directory, { recursive: true, force: true })
    }
  }, 20_000)

  test("revalidates session export, manifest, and package artifacts after combination", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "mac-runtime-soak-reverify-"))
    const artifacts = await createEvidenceArtifacts(directory)
    try {
      const evidence = await combineMacRuntimeSoakEvidence(valid(), artifacts, shortPolicy)
      const source = await Bun.file(artifacts.sourcePath).text()
      const manifest = await Bun.file(artifacts.manifestPath).text()

      await Bun.write(artifacts.sourcePath, `${source} `)
      await expect(verifyMacRuntimeSoakEvidence(evidence, shortPolicy)).rejects.toThrow("no longer matches")
      await Bun.write(artifacts.sourcePath, source)

      await Bun.write(artifacts.manifestPath, `${manifest}\n`)
      await expect(verifyMacRuntimeSoakEvidence(evidence, shortPolicy)).rejects.toThrow("manifest format")
      await Bun.write(artifacts.manifestPath, manifest)

      await Bun.write(
        artifacts.packagePath,
        Buffer.concat([Buffer.from(await Bun.file(artifacts.packagePath).arrayBuffer()), Buffer.from("tampered")]),
      )
      await expect(verifyMacRuntimeSoakEvidence(evidence, shortPolicy)).rejects.toThrow("package hash")
    } finally {
      await artifacts.stop()
      await rm(directory, { recursive: true, force: true })
    }
  })

  test("rejects weak, inconsistent, aborted, and malformed server evidence", () => {
    expect(() => assertMacRuntimeSoakServerEvidence(valid())).toThrow("verification minimum")
    expect(() => assertMacRuntimeSoakServerEvidence({ ...valid(), requestedDurationMs: 39 }, shortPolicy)).toThrow(
      "verification minimum",
    )
    expect(() =>
      assertMacRuntimeSoakServerEvidence(
        { ...valid(), chunks: 1, activityAt: valid().activityAt.slice(0, 1) },
        shortPolicy,
      ),
    ).toThrow("too few")
    expect(() => assertMacRuntimeSoakServerEvidence({ ...valid(), maxActivityGapMs: 31 }, shortPolicy)).toThrow(
      "inconsistent",
    )
    expect(() =>
      assertMacRuntimeSoakServerEvidence(
        {
          ...valid(),
          activityAt: [valid().activityAt[0], valid().activityAt[1], "2026-08-11T00:00:00.035Z"],
          maxActivityGapMs: 25,
        },
        { ...shortPolicy, maximumActivityGapMs: 10 },
      ),
    ).toThrow("verification maximum")
    expect(() =>
      assertMacRuntimeSoakServerEvidence({ ...valid(), completedAt: "2026-08-11T00:00:00.001Z" }, shortPolicy),
    ).toThrow()
    expect(() => assertMacRuntimeSoakServerEvidence({ ...valid(), clientAbort: true }, shortPolicy)).toThrow("aborted")
    expect(() => assertMacRuntimeSoakServerEvidence({ ...valid(), clientAcknowledged: false }, shortPolicy)).toThrow(
      "acknowledge",
    )
    expect(() => assertMacRuntimeSoakServerEvidence({ ...valid(), completed: false }, shortPolicy)).toThrow(
      "did not complete",
    )
    expect(() => assertMacRuntimeSoakServerEvidence({ ...valid(), extra: true }, shortPolicy)).toThrow("fields")
  })
})

describe("Mac runtime soak fixture", () => {
  test("runs an authenticated compatible stream through finish", async () => {
    const fixture = await createMacRuntimeSoakFixture({ durationMs: 45, intervalMs: 5, connectionTimeoutMs: 100 })
    try {
      expect(await fetch(`${fixture.endpoint}/models`).then((response) => response.status)).toBe(401)
      const models = await fetch(`${fixture.endpoint}/models`, {
        headers: { authorization: `Bearer ${fixture.token}` },
      }).then((response) => response.json())
      expect(models).toMatchObject({ data: [{ id: fixture.model }] })
      expect(
        await acknowledgment(fixture.acknowledgmentEndpoint, "wrong-token", fixture.runID, fixture.terminalMarker).then(
          (response) => response.status,
        ),
      ).toBe(401)
      expect(
        await acknowledgment(fixture.acknowledgmentEndpoint, fixture.token, fixture.runID, fixture.terminalMarker).then(
          (response) => response.status,
        ),
      ).toBe(409)

      const response = await stream(fixture.endpoint, fixture.token, fixture.model)
      expect(response.status).toBe(200)
      expect(response.headers.get("x-mac-runtime-soak-run-id")).toBe(fixture.runID)
      const body = await response.text()
      expect(body).toContain(fixture.terminalMarker)
      expect(body).toContain("data: [DONE]")
      expect(
        await acknowledgment(fixture.acknowledgmentEndpoint, fixture.token, fixture.runID, "wrong-marker").then(
          (response) => response.status,
        ),
      ).toBe(400)
      await fixture.acknowledgeClient()
      const evidence = assertMacRuntimeSoakServerEvidence(await fixture.observation, {
        minimumRequestedDurationMs: 45,
        minimumChunks: 4,
        maximumActivityGapMs: 20,
        durationToleranceMs: 5,
      })
      expect(evidence.disconnectReason).toBe("completed")
      expect(evidence.terminalAt).toBeString()
    } finally {
      await fixture.stop()
    }
  })

  test("rejects oversized, invalid, wrong-model, and non-streaming requests without claiming the run", async () => {
    const fixture = await createMacRuntimeSoakFixture({
      durationMs: 30,
      intervalMs: 5,
      connectionTimeoutMs: 200,
      maxRequestBodyBytes: 120,
    })
    try {
      expect(
        await post(
          fixture.endpoint,
          "wrong-token",
          JSON.stringify({ model: fixture.model, messages: [{ role: "user", content: "soak" }], stream: true }),
        ).then((response) => response.status),
      ).toBe(401)
      expect(await post(fixture.endpoint, fixture.token, "{").then((response) => response.status)).toBe(400)
      expect(
        await post(
          fixture.endpoint,
          fixture.token,
          JSON.stringify({ model: "wrong", messages: [{ role: "user", content: "soak" }], stream: true }),
        ).then((response) => response.status),
      ).toBe(400)
      expect(
        await post(
          fixture.endpoint,
          fixture.token,
          JSON.stringify({ model: fixture.model, messages: [{ role: "user", content: "soak" }], stream: false }),
        ).then((response) => response.status),
      ).toBe(400)
      expect(
        await post(fixture.endpoint, fixture.token, JSON.stringify({ padding: "x".repeat(200) })).then(
          (response) => response.status,
        ),
      ).toBe(413)
      const response = await stream(fixture.endpoint, fixture.token, fixture.model)
      expect(await response.text()).toContain("[DONE]")
      await fixture.acknowledgeClient()
      expect((await fixture.observation).disconnectReason).toBe("completed")
    } finally {
      await fixture.stop()
    }
  })

  test("validates bounded OpenAI message records and content parts", async () => {
    const fixture = await createMacRuntimeSoakFixture({
      durationMs: 30,
      intervalMs: 5,
      connectionTimeoutMs: 500,
      maxRequestBodyBytes: 100_000,
    })
    const invalidMessages = [
      [],
      [{ role: "invalid", content: "soak" }],
      [{ role: "user", content: null }],
      [{ role: "user", content: 1 }],
      [{ role: "user", content: "" }],
      [{ role: "user", content: "   " }],
      [{ role: "user", content: [] }],
      [{ role: "user", content: "soak", forged: true }],
      [{ role: "tool", content: "tool" }],
      [{ role: "tool", content: "tool", tool_call_id: 123 }],
      [{ role: "tool", content: "tool", tool_call_id: "call-1", forged: true }],
      [{ role: "assistant", content: null }],
      [{ role: "assistant", content: null, tool_calls: [] }],
      [
        {
          role: "assistant",
          content: null,
          tool_calls: [{ id: "call-1", type: "function", function: { name: "shell", arguments: "{}", forged: true } }],
        },
      ],
      [{ role: "user", content: [{ type: "text", text: "" }] }],
      [{ role: "user", content: [{ type: "image_url", image_url: { url: "https://example.com" } }] }],
      Array.from({ length: 257 }, () => ({ role: "user", content: "soak" })),
    ]
    try {
      for (const messages of invalidMessages) {
        expect(
          await completion(fixture.endpoint, fixture.token, fixture.model, messages).then((item) => item.status),
        ).toBe(400)
      }
      const response = await completion(fixture.endpoint, fixture.token, fixture.model, [
        { role: "system", content: "system" },
        { role: "developer", content: [{ type: "text", text: "developer" }] },
        { role: "user", content: [{ type: "text", text: "soak" }] },
        {
          role: "assistant",
          content: null,
          tool_calls: [{ id: "call-1", type: "function", function: { name: "shell", arguments: "{}" } }],
        },
        { role: "tool", content: [{ type: "text", text: "tool" }], tool_call_id: "call-1" },
      ])
      expect(response.status).toBe(200)
      expect(await response.text()).toContain("[DONE]")
      await fixture.acknowledgeClient()
      expect((await fixture.observation).disconnectReason).toBe("completed")
    } finally {
      await fixture.stop()
    }
  })

  test("settles an unused fixture with a connection timeout", async () => {
    const fixture = await createMacRuntimeSoakFixture({ durationMs: 100, intervalMs: 5, connectionTimeoutMs: 25 })
    const evidence = await fixture.observation
    expect(evidence).toMatchObject({
      chunks: 0,
      terminalAt: null,
      clientAbort: false,
      completed: false,
      disconnectReason: "connection-timeout",
    })
    expect(await fixture.stop()).toEqual(evidence)
  })

  test("keeps one active stream and rejects a concurrent request", async () => {
    const fixture = await createMacRuntimeSoakFixture({
      durationMs: 60,
      intervalMs: 5,
      initialSilenceMs: 20,
      connectionTimeoutMs: 100,
    })
    try {
      const first = await stream(fixture.endpoint, fixture.token, fixture.model)
      const second = await stream(fixture.endpoint, fixture.token, fixture.model)
      expect(second.status).toBe(409)
      expect(await first.text()).toContain("[DONE]")
      await fixture.acknowledgeClient()
      expect((await fixture.observation).disconnectReason).toBe("completed")
    } finally {
      await fixture.stop()
    }
  })

  test("requires an application acknowledgment after a low-volume client stops reading", async () => {
    const fixture = await createMacRuntimeSoakFixture({
      durationMs: 80,
      intervalMs: 1,
      connectionTimeoutMs: 100,
      acknowledgmentTimeoutMs: 30,
      initialSilenceMs: 10,
      chunkContent: ".",
    })
    try {
      const response = await rawStream(fixture.endpoint, fixture.token, fixture.model)
      response.pause()
      const serverEvidence = await fixture.observation
      expect(serverEvidence).toMatchObject({
        disconnectReason: "client-unresponsive",
        clientAcknowledged: false,
        completed: false,
      })
      expect(() =>
        assertMacRuntimeSoakEvidence(serverEvidence, {
          minimumRequestedDurationMs: 80,
          minimumChunks: 1,
          maximumActivityGapMs: 100,
        }),
      ).toThrow("fields")
      const body = await read(response)
      expect(body).toContain(fixture.terminalMarker)
    } finally {
      await fixture.stop()
    }
  })

  test("records initial and mid-stream silence as activity gaps without stopping", async () => {
    const fixture = await createMacRuntimeSoakFixture({
      durationMs: 110,
      intervalMs: 5,
      connectionTimeoutMs: 100,
      initialSilenceMs: 25,
      midSilence: { afterChunks: 2, durationMs: 35 },
    })
    try {
      const response = await stream(fixture.endpoint, fixture.token, fixture.model)
      expect(await response.text()).toContain("[DONE]")
      await fixture.acknowledgeClient()
      const evidence = assertMacRuntimeSoakServerEvidence(await fixture.observation, {
        minimumRequestedDurationMs: 110,
        minimumChunks: 3,
        maximumActivityGapMs: 60,
        durationToleranceMs: 5,
      })
      expect(evidence.maxActivityGapMs).toBeGreaterThanOrEqual(30)
    } finally {
      await fixture.stop()
    }
  })

  test("records a connected client that stops reading as client-unresponsive", async () => {
    const fixture = await createMacRuntimeSoakFixture({
      durationMs: 500,
      intervalMs: 1,
      connectionTimeoutMs: 100,
      backpressureTimeoutMs: 30,
      chunkContent: "x".repeat(512 * 1024),
    })
    let socket: Socket | undefined
    try {
      socket = await rawSocket(fixture.endpoint, fixture.token, fixture.model)
      socket.pause()
      const evidence = await fixture.observation
      expect(evidence).toMatchObject({
        clientAbort: true,
        completed: false,
        disconnectReason: "client-unresponsive",
      })
    } finally {
      socket?.destroy()
      await fixture.stop()
    }
  })

  test("deterministically records an actively destroyed client socket as client-abort", async () => {
    for (const index of Array.from({ length: 8 }, (_, item) => item)) {
      const fixture = await createMacRuntimeSoakFixture({
        durationMs: 300,
        intervalMs: 5,
        connectionTimeoutMs: 1_000,
        backpressureTimeoutMs: 30,
        initialSilenceMs: 250,
        runID: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      })
      try {
        await abortStream(fixture.endpoint, fixture.token, fixture.model)
        const evidence = await fixture.observation
        expect(evidence).toMatchObject({ clientAbort: true, completed: false, disconnectReason: "client-abort" })
        expect(() => assertMacRuntimeSoakServerEvidence(evidence, shortPolicy)).toThrow()
      } finally {
        await fixture.stop()
      }
    }
  })

  test("stops active and idle fixtures idempotently and records fixture-stop", async () => {
    const idle = await createMacRuntimeSoakFixture({ durationMs: 200, intervalMs: 10, connectionTimeoutMs: 500 })
    const idleStops = await Promise.all([idle.stop(), idle.stop()])
    expect(idleStops[0]).toEqual(idleStops[1])
    expect(idleStops[0].disconnectReason).toBe("fixture-stop")

    const active = await createMacRuntimeSoakFixture({ durationMs: 500, intervalMs: 10, connectionTimeoutMs: 100 })
    const response = await rawStream(active.endpoint, active.token, active.model)
    response.once("error", () => undefined)
    await new Promise<void>((resolve) => response.once("data", () => resolve()))
    const activeStops = await Promise.all([active.stop(), active.stop()])
    expect(activeStops[0]).toEqual(activeStops[1])
    expect(activeStops[0]).toMatchObject({ completed: false, clientAbort: false, disconnectReason: "fixture-stop" })
  })
})

function post(endpoint: string, token: string, body: string) {
  return fetch(`${endpoint}/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body,
  })
}

function completion(endpoint: string, token: string, model: string, messages: unknown[]) {
  return post(endpoint, token, JSON.stringify({ model, messages, stream: true }))
}

function acknowledgment(endpoint: string, token: string, runID: string, terminalMarker: string) {
  return fetch(endpoint, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ runID, terminalMarker }),
  })
}

function stream(endpoint: string, token: string, model: string) {
  return completion(endpoint, token, model, [{ role: "user", content: "soak" }])
}

function rawStream(endpoint: string, token: string, model: string) {
  return new Promise<IncomingMessage>((resolve, reject) => {
    const client = request(`${endpoint}/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    })
    client.once("error", reject)
    client.once("response", resolve)
    client.end(JSON.stringify({ model, messages: [{ role: "user", content: "soak" }], stream: true }))
  })
}

function rawSocket(endpoint: string, token: string, model: string) {
  return new Promise<Socket>((resolve, reject) => {
    const url = new URL(endpoint)
    const body = JSON.stringify({ model, messages: [{ role: "user", content: "soak" }], stream: true })
    const socket = connect({ host: url.hostname, port: Number(url.port) })
    const onError = (error: Error) => reject(error)
    socket.once("error", onError)
    socket.once("connect", () => {
      socket.write(
        [
          `POST ${url.pathname}/chat/completions HTTP/1.1`,
          `Host: ${url.host}`,
          `Authorization: Bearer ${token}`,
          "Content-Type: application/json",
          `Content-Length: ${Buffer.byteLength(body)}`,
          "Connection: keep-alive",
          "",
          body,
        ].join("\r\n"),
      )
    })
    socket.once("data", () => {
      socket.off("error", onError)
      resolve(socket)
    })
  })
}

async function abortStream(endpoint: string, token: string, model: string) {
  const node = Bun.which("node")
  if (!node) throw new Error("Node.js is required for the independent abort client")
  const script = `
const net = require("node:net")
const endpoint = new URL(process.argv[1])
const token = process.argv[2]
const model = process.argv[3]
const body = JSON.stringify({ model, messages: [{ role: "user", content: "soak" }], stream: true })
const socket = net.connect({ host: endpoint.hostname, port: Number(endpoint.port) })
socket.once("connect", () => socket.write([
  "POST " + endpoint.pathname + "/chat/completions HTTP/1.1",
  "Host: " + endpoint.host,
  "Authorization: Bearer " + token,
  "Content-Type: application/json",
  "Content-Length: " + Buffer.byteLength(body),
  "Connection: keep-alive",
  "",
  body,
].join("\\r\\n")))
socket.once("data", () => process.stdout.write("READY\\n"))
setInterval(() => undefined, 1_000)
`
  const child = Bun.spawn([node, "-e", script, endpoint, token, model], { stdout: "pipe", stderr: "pipe" })
  const first = await child.stdout.getReader().read()
  if (first.done || !Buffer.from(first.value).toString("utf8").includes("READY")) {
    throw new Error(await new Response(child.stderr).text())
  }
  child.kill(9)
  await child.exited
}

function read(response: IncomingMessage) {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = []
    response.on("data", (chunk) => chunks.push(Buffer.from(chunk)))
    response.once("end", () => resolve(Buffer.concat(chunks).toString("utf8")))
    response.once("error", reject)
    response.resume()
  })
}

async function createEvidenceArtifacts(
  directory: string,
  sessionResponse: unknown = [assistantMessage(`response\n${valid().terminalMarker}`)],
) {
  const packagePath = path.join(directory, "Guai-Code-Beta-0.1.0-alpha.2-mac-arm64.zip")
  const sourcePath = path.join(directory, "packaged-client-session.json")
  const manifestPath = path.join(directory, "SHA256SUMS.txt")
  const contents = path.join(directory, "Guai Code Beta.app", "Contents")
  await mkdir(path.join(contents, "MacOS"), { recursive: true })
  await Bun.write(
    path.join(contents, "Info.plist"),
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key><string>Guai Code Beta</string>
  <key>CFBundleIdentifier</key><string>com.guaicode.desktop.beta</string>
  <key>CFBundleName</key><string>Guai Code Beta</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>0.1.0-alpha.2</string>
  <key>CFBundleVersion</key><string>1</string>
</dict>
</plist>
`,
  )
  const source = path.join(directory, "main.c")
  const executable = path.join(contents, "MacOS", "Guai Code Beta")
  const responsePath = path.join(directory, "session-response.json")
  await Bun.write(responsePath, JSON.stringify(sessionResponse))
  await Bun.write(
    source,
    `#include <arpa/inet.h>
#include <netinet/in.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <unistd.h>

static void send_all(int socket, const char *value, size_t length) {
  size_t sent = 0;
  while (sent < length) {
    ssize_t next = send(socket, value + sent, length - sent, 0);
    if (next <= 0) return;
    sent += (size_t)next;
  }
}

int main(int argc, char **argv) {
  if (argc != 2) return 2;
  FILE *file = fopen(argv[1], "rb");
  if (!file) return 3;
  fseek(file, 0, SEEK_END);
  long length = ftell(file);
  rewind(file);
  char *body = malloc((size_t)length + 1);
  if (!body || fread(body, 1, (size_t)length, file) != (size_t)length) return 4;
  fclose(file);
  body[length] = '\\0';

  int listener = socket(AF_INET, SOCK_STREAM, 0);
  int enabled = 1;
  setsockopt(listener, SOL_SOCKET, SO_REUSEADDR, &enabled, sizeof(enabled));
  struct sockaddr_in address = {0};
  address.sin_family = AF_INET;
  address.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
  address.sin_port = 0;
  if (bind(listener, (struct sockaddr *)&address, sizeof(address)) != 0 || listen(listener, 16) != 0) return 5;
  socklen_t address_length = sizeof(address);
  if (getsockname(listener, (struct sockaddr *)&address, &address_length) != 0) return 6;
  printf("%u\\n", ntohs(address.sin_port));
  fflush(stdout);

  for (;;) {
    int client = accept(listener, NULL, NULL);
    if (client < 0) continue;
    char request[8192];
    recv(client, request, sizeof(request), 0);
    char header[256];
    int header_length = snprintf(
      header,
      sizeof(header),
      "HTTP/1.1 200 OK\\r\\nContent-Type: application/json\\r\\nContent-Length: %ld\\r\\nConnection: close\\r\\n\\r\\n",
      length
    );
    send_all(client, header, (size_t)header_length);
    send_all(client, body, (size_t)length);
    close(client);
  }
}
`,
  )
  await run(["/usr/bin/clang", "-arch", "arm64", source, "-o", executable])
  await run(["/usr/bin/codesign", "--force", "--deep", "--sign", "-", path.join(directory, "Guai Code Beta.app")])
  const zip = Bun.spawn(["/usr/bin/zip", "-qry", packagePath, "Guai Code Beta.app"], {
    cwd: directory,
    stdout: "pipe",
    stderr: "pipe",
  })
  if ((await zip.exited) !== 0) throw new Error(await new Response(zip.stderr).text())
  const packageSha256 = await sha256(packagePath)
  await Bun.write(manifestPath, formatChecksumManifest([{ file: packagePath, sha256: packageSha256 }]))
  const runtime = Bun.spawn([executable, responsePath], { stdout: "pipe", stderr: "pipe" })
  const port = await readPort(runtime.stdout)
  const acknowledgment = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      if (new URL(request.url).pathname !== `/v1/runs/${valid().runID}/acknowledgment`) {
        return new Response(null, { status: 404 })
      }
      if (request.headers.get("authorization") !== "Bearer soak-test-token") {
        return new Response(null, { status: 401 })
      }
      if ((await request.json<{ runID: string; terminalMarker: string }>()).terminalMarker !== valid().terminalMarker) {
        return new Response(null, { status: 400 })
      }
      return new Response(null, { status: 204 })
    },
  })
  return {
    sourcePath,
    manifestPath,
    packagePath,
    session: {
      endpoint: `http://127.0.0.1:${port}/session/ses_soak/message`,
      sessionID: "ses_soak",
      directory,
      runtimeAppPath: path.join(directory, "Guai Code Beta.app"),
    },
    fixture: {
      runID: valid().runID,
      terminalMarker: valid().terminalMarker,
      acknowledgmentEndpoint: `http://127.0.0.1:${acknowledgment.port}/v1/runs/${valid().runID}/acknowledgment`,
      token: "soak-test-token",
    },
    stop: async () => {
      acknowledgment.stop(true)
      runtime.kill()
      await runtime.exited
    },
  }
}

function assistantMessage(text: string, completed = Date.parse(valid().completedAt), messageID = "msg_assistant_soak") {
  return {
    info: {
      id: messageID,
      sessionID: "ses_soak",
      role: "assistant",
      time: { created: completed - 1, completed },
      parentID: "msg_user_soak",
      modelID: "mac-runtime-soak",
      providerID: "private-openai",
      mode: "build",
      agent: "build",
      path: { cwd: "/tmp/guai-code-soak", root: "/tmp/guai-code-soak" },
      cost: 0,
      tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
      finish: "stop",
    },
    parts: [{ id: `prt_${messageID}`, sessionID: "ses_soak", messageID, type: "text", text }],
  }
}

async function readPort(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  while (true) {
    const item = await reader.read()
    if (item.done) throw new Error("Packaged runtime listener exited before publishing its port")
    chunks.push(item.value)
    const value = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8")
    const match = /^(\d+)\n/.exec(value)
    if (!match) continue
    reader.releaseLock()
    return Number(match[1])
  }
}

async function expectInvalidSession(directory: string, response: unknown, message: string) {
  const artifacts = await createEvidenceArtifacts(directory, response)
  try {
    await expect(combineMacRuntimeSoakEvidence(valid(), artifacts, shortPolicy)).rejects.toThrow(message)
  } finally {
    await artifacts.stop()
  }
}

async function createEmptyDmgArtifacts(
  directory: string,
  session: { endpoint: string; sessionID: string; directory: string; runtimeAppPath: string },
  fixture: {
    runID: string
    terminalMarker: string
    acknowledgmentEndpoint: string
    token: string
  },
) {
  const empty = path.join(directory, "empty")
  const packagePath = path.join(directory, "Guai-Code-Beta-0.1.0-alpha.2-mac-arm64.dmg")
  const sourcePath = path.join(directory, "packaged-client-session.json")
  const manifestPath = path.join(directory, "SHA256SUMS.txt")
  await mkdir(empty, { recursive: true })
  await run(["/usr/bin/hdiutil", "create", "-quiet", "-srcfolder", empty, "-format", "UDZO", packagePath])
  await Bun.write(manifestPath, formatChecksumManifest([{ file: packagePath, sha256: await sha256(packagePath) }]))
  return { sourcePath, manifestPath, packagePath, session, fixture }
}

async function run(command: string[]) {
  const child = Bun.spawn(command, { stdout: "pipe", stderr: "pipe" })
  const [exitCode, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()])
  if (exitCode !== 0) throw new Error(`${command.join(" ")} failed: ${stderr}`)
}
