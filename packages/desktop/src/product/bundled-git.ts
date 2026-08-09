import { win32 } from "node:path"

export function createBundledGitEnvironment(input: {
  platform: NodeJS.Platform
  packaged: boolean
  resourcesPath: string
  inheritedPath: string | undefined
  exists: (path: string) => boolean
}) {
  if (input.platform !== "win32" || !input.packaged) return

  const directory = win32.join(input.resourcesPath, "mingit", "cmd")
  if (!input.exists(win32.join(directory, "git.exe"))) return

  return {
    directory,
    path: input.inheritedPath ? `${directory}${win32.delimiter}${input.inheritedPath}` : directory,
  }
}
