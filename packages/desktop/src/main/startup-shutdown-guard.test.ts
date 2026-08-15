import { describe, expect, test } from "bun:test"
import { createWindowsStartupShutdownGuard } from "./startup-shutdown-guard"

describe("Windows startup shutdown guard", () => {
  test("does not create a guard on non-Windows platforms", () => {
    const calls: string[] = []
    const guard = createWindowsStartupShutdownGuard({
      platform: "darwin",
      createWindow: () => guardWindow(calls),
      wireWindow: () => calls.push("wire"),
    })

    guard.dispose()

    expect(calls).toEqual([])
  })

  test("wires shutdown events before returning without registry or persistence work", () => {
    const calls: string[] = []
    const listeners = new Map<string, () => void>()
    const guard = createWindowsStartupShutdownGuard({
      platform: "win32",
      createWindow: () => ({
        ...guardWindow(calls),
        on(event: string, listener: () => void) {
          calls.push(`on ${event}`)
          listeners.set(event, listener)
        },
      }),
      wireWindow: (window) => {
        calls.push("wire")
        window.on("query-session-end", () => calls.push("query"))
        window.on("session-end", () => calls.push("session"))
      },
    })

    expect(calls).toEqual(["create", "wire", "on query-session-end", "on session-end"])
    expect(calls).not.toContain("register")
    expect(calls).not.toContain("persist")

    listeners.get("query-session-end")?.()
    listeners.get("session-end")?.()
    expect(calls.slice(-2)).toEqual(["query", "session"])
    guard.dispose()
  })

  test("disposes after normal windows are restored during handoff", () => {
    const calls: string[] = []
    const guard = createWindowsStartupShutdownGuard({
      platform: "win32",
      createWindow: () => guardWindow(calls),
      wireWindow: () => calls.push("wire"),
    })

    const windows = guard.handoff(() => {
      calls.push("restore")
      return ["main-window"]
    })
    guard.dispose()

    expect(windows).toEqual(["main-window"])
    expect(calls).toEqual(["create", "wire", "restore", "destroy"])
  })

  test("cleanup disposes an early guard exactly once", () => {
    const calls: string[] = []
    const guard = createWindowsStartupShutdownGuard({
      platform: "win32",
      createWindow: () => guardWindow(calls),
      wireWindow: () => calls.push("wire"),
    })

    guard.dispose()
    guard.dispose()

    expect(calls).toEqual(["create", "wire", "destroy"])
  })
})

function guardWindow(calls: string[]) {
  let destroyed = false
  calls.push("create")
  return {
    destroy() {
      destroyed = true
      calls.push("destroy")
    },
    isDestroyed: () => destroyed,
  }
}
