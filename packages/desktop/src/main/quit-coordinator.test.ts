import { describe, expect, test } from "bun:test"
import { createQuitCoordinator } from "./quit-coordinator"

describe("quit coordinator", () => {
  test("before-quit awaits cleanup once and releases the recursive quit", async () => {
    const cleanup = Promise.withResolvers<void>()
    const calls: string[] = []
    const coordinator = createQuitCoordinator({
      markQuitting: () => calls.push("mark"),
      cleanup: async () => {
        calls.push("cleanup")
        await cleanup.promise
      },
      quit: () => calls.push("quit"),
    })
    const first = quitEvent()
    const repeated = quitEvent()

    coordinator.beforeQuit(first)
    coordinator.beforeQuit(repeated)
    await flush()

    expect(first.prevented()).toBe(1)
    expect(repeated.prevented()).toBe(1)
    expect(calls).toEqual(["mark", "mark", "cleanup"])

    cleanup.resolve()
    await eventually(() => calls.includes("quit"))

    const released = quitEvent()
    coordinator.beforeQuit(released)
    expect(released.prevented()).toBe(0)
    expect(calls.filter((call) => call === "cleanup")).toHaveLength(1)
    expect(calls.filter((call) => call === "quit")).toHaveLength(1)
  })

  test("Windows session-end marks quitting and shares cleanup with before-quit", async () => {
    const cleanup = Promise.withResolvers<void>()
    const calls: string[] = []
    const coordinator = createQuitCoordinator({
      markQuitting: () => calls.push("mark"),
      cleanup: async () => {
        calls.push("cleanup")
        await cleanup.promise
      },
      quit: () => calls.push("quit"),
    })

    coordinator.sessionEnd()
    expect(calls).toEqual(["mark"])
    await flush()
    expect(calls).toEqual(["mark", "cleanup"])

    const beforeQuit = quitEvent()
    coordinator.beforeQuit(beforeQuit)
    expect(beforeQuit.prevented()).toBe(1)

    cleanup.resolve()
    await eventually(() => calls.includes("quit"))
    expect(calls.filter((call) => call === "cleanup")).toHaveLength(1)
  })

  test("allows updater quit to proceed after cleanup already completed", async () => {
    const calls: string[] = []
    const coordinator = createQuitCoordinator({
      markQuitting: () => calls.push("mark"),
      cleanup: async () => {
        calls.push("cleanup")
      },
      quit: () => calls.push("quit"),
    })

    await coordinator.cleanup()
    const event = quitEvent()
    coordinator.beforeQuit(event)

    expect(event.prevented()).toBe(0)
    expect(calls).toEqual(["cleanup", "mark"])
  })
})

function quitEvent() {
  let count = 0
  return {
    preventDefault() {
      count += 1
    },
    prevented: () => count,
  }
}

async function eventually(predicate: () => boolean) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return
    await flush()
  }
  throw new Error("Condition was not reached")
}

async function flush() {
  await Promise.resolve()
  await Promise.resolve()
}
