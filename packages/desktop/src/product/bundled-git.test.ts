import { describe, expect, test } from "bun:test"
import { win32 } from "node:path"
import { createBundledGitEnvironment } from "./bundled-git"

describe("bundled Git environment", () => {
  const resourcesPath = String.raw`C:\Program Files\Guai Code\resources`
  const directory = win32.join(resourcesPath, "mingit", "cmd")
  const executable = win32.join(directory, "git.exe")

  test("prepends bundled Git for a packaged Windows application", () => {
    const inheritedPath = String.raw`C:\Windows\System32;C:\Windows`

    expect(
      createBundledGitEnvironment({
        platform: "win32",
        packaged: true,
        resourcesPath,
        inheritedPath,
        exists: (path) => path === executable,
      }),
    ).toEqual({
      directory,
      path: `${directory};${inheritedPath}`,
    })
  })

  test("leaves development applications unchanged", () => {
    expect(
      createBundledGitEnvironment({
        platform: "win32",
        packaged: false,
        resourcesPath,
        inheritedPath: String.raw`C:\Windows`,
        exists: () => true,
      }),
    ).toBeUndefined()
  })

  test("leaves macOS applications unchanged", () => {
    expect(
      createBundledGitEnvironment({
        platform: "darwin",
        packaged: true,
        resourcesPath: "/Applications/Guai Code.app/Contents/Resources",
        inheritedPath: "/usr/bin:/bin",
        exists: () => true,
      }),
    ).toBeUndefined()
  })

  test("leaves PATH unchanged when the bundled executable is missing", () => {
    const checked: string[] = []

    expect(
      createBundledGitEnvironment({
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
      createBundledGitEnvironment({
        platform: "win32",
        packaged: true,
        resourcesPath,
        inheritedPath: "",
        exists: () => true,
      }),
    ).toEqual({ directory, path: directory })
  })
})
