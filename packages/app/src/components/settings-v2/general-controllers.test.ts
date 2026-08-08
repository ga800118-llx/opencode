import { describe, expect, mock, test, vi } from "bun:test"
import { createRoot } from "solid-js"
import { createShellOptions, createSoundPreviewController } from "./general-controller-behavior"
import { createPermissionScopeController, toggleAutoMode } from "./general-controllers"

describe("settings v2 controllers", () => {
  test("toggles restricted and standard modes through auto", () => {
    expect(toggleAutoMode("restricted")).toBe("auto")
    expect(toggleAutoMode("standard")).toBe("auto")
    expect(toggleAutoMode("auto")).toBe("standard")
  })

  test("updates a V2 project default when a directory has no session", async () => {
    const requestMode = mock(async () => true)
    const mode = mock(() => "standard" as const)
    const controller = createRoot(() =>
      createPermissionScopeController({
        sessionID: () => undefined,
        directory: () => "/workspace/project",
        permission: {
          supportsModes: () => true,
          mode,
          isAutoAccepting: () => false,
          isAutoAcceptingDirectory: () => false,
          toggleAutoAcceptDirectory: () => undefined,
          enableAutoAccept: () => undefined,
          disableAutoAccept: () => undefined,
        },
        requestMode,
      }),
    )

    expect(controller.enabled()).toBe(true)
    expect(controller.accepting()).toBe(false)
    await controller.set(true)
    expect(mode).toHaveBeenCalledWith(undefined, "/workspace/project")
    expect(requestMode).toHaveBeenCalledWith({
      sessionID: undefined,
      directory: "/workspace/project",
      mode: "auto",
    })
  })

  test("keeps V1 directory auto-accept for settings without a session", () => {
    const toggleAutoAcceptDirectory = mock(() => undefined)
    const controller = createRoot(() =>
      createPermissionScopeController({
        sessionID: () => undefined,
        directory: () => "/workspace/project",
        permission: {
          supportsModes: () => false,
          mode: () => "standard",
          isAutoAccepting: () => false,
          isAutoAcceptingDirectory: () => false,
          toggleAutoAcceptDirectory,
          enableAutoAccept: () => undefined,
          disableAutoAccept: () => undefined,
        },
        requestMode: async () => true,
      }),
    )

    expect(controller.enabled()).toBe(true)
    expect(controller.accepting()).toBe(false)
    controller.set(true)
    expect(toggleAutoAcceptDirectory).toHaveBeenCalledWith("/workspace/project")
  })

  test("normalizes shell names and preserves an unavailable configured shell", () => {
    expect(
      createShellOptions({
        shells: [
          { path: "/bin/bash", name: "bash", acceptable: true },
          { path: "/opt/bash", name: "bash", acceptable: false },
          { path: "/bin/zsh", name: "zsh", acceptable: true },
        ],
        current: "fish",
      }),
    ).toEqual([
      { id: "auto", value: "", name: "", terminalOnly: false },
      { id: "/bin/bash", value: "/bin/bash", name: "/bin/bash", terminalOnly: false },
      { id: "/opt/bash", value: "/opt/bash", name: "/opt/bash", terminalOnly: true },
      { id: "/bin/zsh", value: "zsh", name: "zsh", terminalOnly: false },
      { id: "fish", value: "fish", name: "fish", terminalOnly: false },
    ])
  })

  test("debounces previews and stops owned audio on disposal", async () => {
    vi.useFakeTimers()
    try {
      const played: string[] = []
      const stopped: string[] = []
      const owned = createRoot((dispose) => ({
        dispose,
        preview: createSoundPreviewController(async (id) => {
          played.push(id ?? "")
          return () => stopped.push(id ?? "")
        }),
      }))

      owned.preview.play("first")
      vi.advanceTimersByTime(99)
      expect(played).toEqual([])

      owned.preview.play("second")
      vi.advanceTimersByTime(100)
      await Promise.resolve()
      expect(played).toEqual(["second"])

      owned.dispose()
      expect(stopped).toEqual(["second"])
    } finally {
      vi.useRealTimers()
    }
  })
})
