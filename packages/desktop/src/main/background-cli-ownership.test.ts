import { describe, expect, test } from "bun:test"
import { createBackgroundCliOwnership } from "./background-cli-ownership"

describe("background CLI ownership", () => {
  test("stops a controller that finishes starting after shutdown begins", async () => {
    const startup = Promise.withResolvers<{ stop: () => Promise<void> }>()
    const calls: string[] = []
    const ownership = createBackgroundCliOwnership()
    const starting = ownership.start(() => startup.promise)

    const stopping = ownership.stop()
    expect(calls).toEqual([])

    startup.resolve({
      async stop() {
        calls.push("stop")
      },
    })

    await stopping
    await expect(starting).rejects.toThrow("V2 sidecar startup completed after shutdown began")
    expect(calls).toEqual(["stop"])
    expect(ownership.current()).toBeUndefined()
  })

  test("shares cleanup after startup failure and rejects later startup", async () => {
    const failure = new Error("startup failed")
    const ownership = createBackgroundCliOwnership()
    const starting = ownership.start(() => Promise.reject(failure))

    await expect(starting).rejects.toBe(failure)
    await expect(Promise.all([ownership.stop(), ownership.stop()])).resolves.toEqual([false, false])
    await expect(ownership.start(async () => ({ stop: async () => undefined }))).rejects.toThrow(
      "V2 sidecar startup cannot begin after shutdown",
    )
  })
})
