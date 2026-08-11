import { describe, expect, test } from "bun:test"
import { request } from "node:http"
import {
  DEFAULT_MAC_RUNTIME_SOAK_DURATION_MS,
  assertMacRuntimeSoakEvidence,
  createMacRuntimeSoakFixture,
  type MacRuntimeSoakEvidence,
} from "./mac-runtime-soak"

const valid = (): MacRuntimeSoakEvidence => ({
  startedAt: "2026-08-11T00:00:00.000Z",
  completedAt: "2026-08-11T01:05:00.000Z",
  requestedDurationMs: DEFAULT_MAC_RUNTIME_SOAK_DURATION_MS,
  observedDurationMs: DEFAULT_MAC_RUNTIME_SOAK_DURATION_MS,
  chunks: 260,
  clientAbort: false,
  completed: true,
})

describe("Mac runtime soak evidence", () => {
  test("uses a 65-minute packaged verification duration", () => {
    expect(DEFAULT_MAC_RUNTIME_SOAK_DURATION_MS).toBe(65 * 60_000)
  })

  test("accepts exact valid evidence", () => {
    expect(assertMacRuntimeSoakEvidence(valid())).toEqual(valid())
  })

  test("rejects short, inactive, aborted, incomplete, and malformed evidence", () => {
    expect(() => assertMacRuntimeSoakEvidence({ ...valid(), observedDurationMs: 1 })).toThrow("requested duration")
    expect(() => assertMacRuntimeSoakEvidence({ ...valid(), chunks: 0 })).toThrow("activity chunks")
    expect(() => assertMacRuntimeSoakEvidence({ ...valid(), clientAbort: true })).toThrow("aborted")
    expect(() => assertMacRuntimeSoakEvidence({ ...valid(), completed: false })).toThrow("did not complete")
    expect(() => assertMacRuntimeSoakEvidence({ ...valid(), extra: true })).toThrow("fields")
  })

  test("runs a short authenticated streaming fixture", async () => {
    const fixture = await createMacRuntimeSoakFixture({ durationMs: 40, intervalMs: 5 })
    try {
      const response = await fetch(`${fixture.endpoint}/chat/completions`, {
        method: "POST",
        headers: { authorization: `Bearer ${fixture.token}`, "content-type": "application/json" },
        body: JSON.stringify({ model: fixture.model, messages: [{ role: "user", content: "soak" }], stream: true }),
      })
      expect(response.status).toBe(200)
      const body = await response.text()
      expect(body).toContain("[DONE]")
      const evidence = assertMacRuntimeSoakEvidence(await fixture.observation)
      expect(evidence.requestedDurationMs).toBe(40)
      expect(evidence.observedDurationMs).toBeGreaterThanOrEqual(40)
      expect(evidence.chunks).toBeGreaterThan(0)
    } finally {
      fixture.stop()
    }
  })

  test("records a cancelled client as an invalid abort", async () => {
    const fixture = await createMacRuntimeSoakFixture({ durationMs: 200, intervalMs: 10 })
    try {
      await new Promise<void>((resolve, reject) => {
        const client = request(`${fixture.endpoint}/chat/completions`, {
          method: "POST",
          headers: { authorization: `Bearer ${fixture.token}`, "content-type": "application/json" },
        })
        client.once("error", (error) => {
          if ((error as NodeJS.ErrnoException).code === "ECONNRESET") return
          reject(error)
        })
        client.once("response", (response) => {
          response.once("data", () => {
            response.socket.destroy()
            resolve()
          })
        })
        client.end(
          JSON.stringify({ model: fixture.model, messages: [{ role: "user", content: "abort" }], stream: true }),
        )
      })
      const observation = await fixture.observation
      expect(observation.clientAbort).toBe(true)
      expect(observation.completed).toBe(false)
      expect(() => assertMacRuntimeSoakEvidence(observation)).toThrow()
    } finally {
      fixture.stop()
    }
  })
})
