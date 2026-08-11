import { describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { request, type IncomingMessage } from "node:http"
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
  clientAbort: false,
  completed: true,
  disconnectReason: "completed",
})

describe("Mac runtime soak evidence", () => {
  test("uses a 65-minute packaged verification duration", () => {
    expect(DEFAULT_MAC_RUNTIME_SOAK_DURATION_MS).toBe(65 * 60_000)
  })

  test("requires independently hashed packaged-client artifacts", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "mac-runtime-soak-"))
    const sourcePath = path.join(directory, "transcript.log")
    const packagePath = path.join(directory, "Guai-Code-Beta.dmg")
    try {
      await Bun.write(sourcePath, `run ${valid().runID}\nassistant ${valid().terminalMarker}\n`)
      await Bun.write(packagePath, "packaged-app")
      expect(assertMacRuntimeSoakServerEvidence(valid(), shortPolicy)).toEqual(valid())
      expect(() => assertMacRuntimeSoakEvidence(valid(), shortPolicy)).toThrow("fields")
      const evidence = await combineMacRuntimeSoakEvidence(
        valid(),
        { source: "packaged-client-transcript", sourcePath, packagePath },
        shortPolicy,
      )
      expect(evidence.packagedClientAcknowledgment).toMatchObject({
        runID: valid().runID,
        terminalMarker: valid().terminalMarker,
        sourcePath,
        packagePath,
      })
      expect(evidence.packagedClientAcknowledgment.sourceSha256).toMatch(/^[a-f0-9]{64}$/)
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
      await Bun.write(sourcePath, "tampered")
      await expect(verifyMacRuntimeSoakEvidence(evidence, shortPolicy)).rejects.toThrow()
      await Bun.write(sourcePath, `run ${valid().runID}\nassistant ${valid().terminalMarker}\n`)
      await Bun.write(packagePath, "tampered-package")
      await expect(verifyMacRuntimeSoakEvidence(evidence, shortPolicy)).rejects.toThrow("package hash")
    } finally {
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

      const response = await stream(fixture.endpoint, fixture.token, fixture.model)
      expect(response.status).toBe(200)
      expect(response.headers.get("x-mac-runtime-soak-run-id")).toBe(fixture.runID)
      const body = await response.text()
      expect(body).toContain(fixture.terminalMarker)
      expect(body).toContain("data: [DONE]")
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
      expect((await fixture.observation).disconnectReason).toBe("completed")
    } finally {
      await fixture.stop()
    }
  })

  test("does not treat server completion as packaged-client proof while the client is paused", async () => {
    const fixture = await createMacRuntimeSoakFixture({
      durationMs: 80,
      intervalMs: 1,
      connectionTimeoutMs: 100,
      initialSilenceMs: 10,
      chunkContent: "x".repeat(64 * 1024),
    })
    try {
      const response = await rawStream(fixture.endpoint, fixture.token, fixture.model)
      response.pause()
      const serverEvidence = await fixture.observation
      expect(serverEvidence.disconnectReason).toBe("completed")
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

  test("records a cancelled client as an invalid abort", async () => {
    const fixture = await createMacRuntimeSoakFixture({
      durationMs: 200,
      intervalMs: 10,
      connectionTimeoutMs: 100,
      backpressureTimeoutMs: 50,
    })
    try {
      const response = await rawStream(fixture.endpoint, fixture.token, fixture.model)
      await new Promise<void>((resolve) => {
        response.once("data", () => {
          response.socket.destroy()
          resolve()
        })
      })
      const evidence = await fixture.observation
      expect(evidence.clientAbort).toBe(true)
      expect(evidence.completed).toBe(false)
      expect(["client-abort", "client-unresponsive"]).toContain(evidence.disconnectReason)
      expect(() => assertMacRuntimeSoakServerEvidence(evidence, shortPolicy)).toThrow()
    } finally {
      await fixture.stop()
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

function stream(endpoint: string, token: string, model: string) {
  return post(endpoint, token, JSON.stringify({ model, messages: [{ role: "user", content: "soak" }], stream: true }))
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

function read(response: IncomingMessage) {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = []
    response.on("data", (chunk) => chunks.push(Buffer.from(chunk)))
    response.once("end", () => resolve(Buffer.concat(chunks).toString("utf8")))
    response.once("error", reject)
    response.resume()
  })
}
