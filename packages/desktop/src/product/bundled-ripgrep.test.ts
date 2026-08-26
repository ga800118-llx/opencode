import { describe, expect, test } from "bun:test"
import { win32 } from "node:path"
import { createBundledRipgrepEnvironment } from "./bundled-ripgrep"

describe("bundled ripgrep environment", () => {
  const resourcesPath = String.raw`C:\Program Files\Guai Code\resources`
  const directory = win32.join(resourcesPath, "ripgrep")
  const executable = win32.join(directory, "rg.exe")

  test("prepends packaged ripgrep on Windows", () => {
    const inheritedPath = String.raw`C:\Windows\System32;C:\Windows`

    expect(
      createBundledRipgrepEnvironment({
        platform: "win32",
        packaged: true,
        resourcesPath,
        inheritedPath,
        exists: (path) => path === executable,
      }),
    ).toEqual({ directory, path: `${directory};${inheritedPath}` })
  })

  test("leaves development applications unchanged", () => {
    expect(
      createBundledRipgrepEnvironment({
        platform: "win32",
        packaged: false,
        resourcesPath,
        inheritedPath: String.raw`C:\Windows`,
        exists: () => true,
      }),
    ).toBeUndefined()
  })

  test("leaves non-Windows packaged applications unchanged", () => {
    expect(
      createBundledRipgrepEnvironment({
        platform: "darwin",
        packaged: true,
        resourcesPath: "/Applications/Guai Code Beta.app/Contents/Resources",
        inheritedPath: "/usr/bin:/bin",
        exists: () => true,
      }),
    ).toBeUndefined()
  })

  test("leaves PATH unchanged when the bundled executable is missing", () => {
    const checked: string[] = []

    expect(
      createBundledRipgrepEnvironment({
        platform: "win32",
        packaged: true,
        resourcesPath,
        inheritedPath: String.raw`C:\Windows`,
        exists: (path) => {
          checked.push(path)
          return false
        },
      }),
    ).toBeUndefined()
    expect(checked).toEqual([executable])
  })

  test("does not append a separator to an empty inherited PATH", () => {
    expect(
      createBundledRipgrepEnvironment({
        platform: "win32",
        packaged: true,
        resourcesPath,
        inheritedPath: "",
        exists: () => true,
      }),
    ).toEqual({ directory, path: directory })
  })
})
