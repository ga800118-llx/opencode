import { describe, expect, test } from "bun:test"
import { mountedApplicationMessage, shouldBlockMountedApplication } from "./install-location"

describe("shouldBlockMountedApplication", () => {
  test("blocks a packaged macOS app launched from a mounted image", () => {
    expect(
      shouldBlockMountedApplication({
        platform: "darwin",
        packaged: true,
        execPath: "/Volumes/Guai Code Beta/Guai Code Beta.app/Contents/MacOS/Guai Code Beta",
      }),
    ).toBe(true)
  })

  test("allows installed, development, Windows, and Linux applications", () => {
    const installed = "/Applications/Guai Code Beta.app/Contents/MacOS/Guai Code Beta"
    expect(shouldBlockMountedApplication({ platform: "darwin", packaged: true, execPath: installed })).toBe(false)
    expect(shouldBlockMountedApplication({ platform: "darwin", packaged: false, execPath: installed })).toBe(false)
    expect(
      shouldBlockMountedApplication({ platform: "win32", packaged: true, execPath: "D:\\Guai Code Beta.exe" }),
    ).toBe(false)
    expect(shouldBlockMountedApplication({ platform: "linux", packaged: true, execPath: "/mnt/Guai Code" })).toBe(
      false,
    )
  })
})

test("mountedApplicationMessage names the product and install destination", () => {
  expect(mountedApplicationMessage("Guai Code Beta")).toContain("Guai Code Beta")
  expect(mountedApplicationMessage("Guai Code Beta")).toContain("应用程序")
})
