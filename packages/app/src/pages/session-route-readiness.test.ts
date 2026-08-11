import { describe, expect, test } from "bun:test"
import { resolveSessionRouteReadiness } from "./session-route-readiness"

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe("session route readiness", () => {
  test("keeps the compatibility route pending until legacy readiness completes", async () => {
    const readiness = deferred<"degraded">()
    let settled = false
    const result = resolveSessionRouteReadiness({
      mode: "legacy",
      prepare: () => readiness.promise,
      newDraft: async () => undefined,
    }).then((value) => {
      settled = true
      return value
    })

    await Promise.resolve()
    expect(settled).toBe(false)
    readiness.resolve("degraded")
    expect(await result).toBe("ready")
  })

  test("keeps the compatibility route closed after readiness fails", async () => {
    expect(
      await resolveSessionRouteReadiness({
        mode: "legacy",
        prepare: async () => undefined,
        newDraft: async () => undefined,
      }),
    ).toBe("failed")
  })

  test("waits for draft creation to navigate and reports a retryable failure", async () => {
    const draft = { type: "draft" }
    expect(
      await resolveSessionRouteReadiness({
        mode: "draft",
        prepare: async () => undefined,
        newDraft: async () => draft,
      }),
    ).toBe("redirecting")
    expect(
      await resolveSessionRouteReadiness({
        mode: "draft",
        prepare: async () => undefined,
        newDraft: async () => undefined,
      }),
    ).toBe("failed")
  })
})
