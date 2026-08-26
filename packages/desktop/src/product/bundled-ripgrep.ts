import { win32 } from "node:path"

export function createBundledRipgrepEnvironment(input: {
  platform: NodeJS.Platform
  packaged: boolean
  resourcesPath: string
  inheritedPath: string | undefined
  exists: (path: string) => boolean
}) {
  if (!input.packaged || input.platform !== "win32") return
  const directory = win32.join(input.resourcesPath, "ripgrep")
  if (!input.exists(win32.join(directory, "rg.exe"))) return

  return {
    directory,
    path: input.inheritedPath ? `${directory}${win32.delimiter}${input.inheritedPath}` : directory,
  }
}
