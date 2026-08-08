import { describe, expect, mock, test } from "bun:test"
import { permissionModeDialogMethod, requestPermissionMode } from "./permission-mode-control"

describe("permissionModeDialogMethod", () => {
  test("replaces standalone dialogs and pushes nested settings dialogs", () => {
    expect(permissionModeDialogMethod()).toBe("show")
    expect(permissionModeDialogMethod(false)).toBe("show")
    expect(permissionModeDialogMethod(true)).toBe("push")
  })
})

describe("requestPermissionMode", () => {
  test("switches restricted mode without confirmation", async () => {
    const confirm = mock(async () => true)
    const markConfirmed = mock(() => undefined)
    const setMode = mock(async () => undefined)

    expect(
      await requestPermissionMode({ mode: "restricted", confirmed: false, confirm, markConfirmed, setMode }),
    ).toBe(true)
    expect(confirm).not.toHaveBeenCalled()
    expect(markConfirmed).not.toHaveBeenCalled()
    expect(setMode).toHaveBeenCalledWith("restricted")
  })

  test("leaves the mode unchanged when auto confirmation is cancelled", async () => {
    const setMode = mock(async () => undefined)

    expect(
      await requestPermissionMode({
        mode: "auto",
        confirmed: false,
        confirm: async () => false,
        markConfirmed: () => undefined,
        setMode,
      }),
    ).toBe(false)
    expect(setMode).not.toHaveBeenCalled()
  })

  test("remembers auto confirmation before switching modes", async () => {
    const calls: string[] = []

    expect(
      await requestPermissionMode({
        mode: "auto",
        confirmed: false,
        confirm: async () => true,
        markConfirmed: () => calls.push("confirmed"),
        setMode: async (mode) => {
          calls.push(mode)
        },
      }),
    ).toBe(true)
    expect(calls).toEqual(["confirmed", "auto"])
  })

  test("propagates mode switch failures", async () => {
    const error = new Error("switch failed")

    await expect(
      requestPermissionMode({
        mode: "standard",
        confirmed: true,
        confirm: async () => true,
        markConfirmed: () => undefined,
        setMode: async () => {
          throw error
        },
      }),
    ).rejects.toBe(error)
  })
})
