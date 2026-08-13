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

  test("configures the relocatable bundled Git for packaged macOS applications", () => {
    const resourcesPath = "/Applications/Guai Code Beta.app/Contents/Resources"
    const root = `${resourcesPath}/mingit`

    expect(
      createBundledGitEnvironment({
        platform: "darwin",
        packaged: true,
        resourcesPath,
        inheritedPath: "/usr/bin:/bin",
        exists: (path) => path === `${root}/bin/git`,
      }),
    ).toEqual({
      directory: `${root}/bin`,
      path: `${root}/bin:/usr/bin:/bin`,
      gitExecPath: `${root}/libexec/git-core`,
      gitConfigSystem: `${root}/etc/gitconfig`,
      gitTemplateDir: `${root}/share/git-core/templates`,
    })
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

  test("leaves unsupported packaged platforms unchanged", () => {
    expect(
      createBundledGitEnvironment({
        platform: "linux",
        packaged: true,
        resourcesPath: "/opt/guai-code/resources",
        inheritedPath: "/usr/bin",
        exists: () => true,
      }),
    ).toBeUndefined()
  })
})
