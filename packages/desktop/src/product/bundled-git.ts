import { posix, win32 } from "node:path"

export function createBundledGitEnvironment(input: {
  platform: NodeJS.Platform
  packaged: boolean
  resourcesPath: string
  inheritedPath: string | undefined
  exists: (path: string) => boolean
}) {
  if (!input.packaged) return
  if (input.platform !== "win32" && input.platform !== "darwin") return

  if (input.platform === "win32") {
    const directory = win32.join(input.resourcesPath, "mingit", "cmd")
    if (!input.exists(win32.join(directory, "git.exe"))) return

    return {
      directory,
      path: input.inheritedPath ? `${directory}${win32.delimiter}${input.inheritedPath}` : directory,
    }
  }

  const root = posix.join(input.resourcesPath, "mingit")
  const directory = posix.join(root, "bin")
  if (!input.exists(posix.join(directory, "git"))) return

  return {
    directory,
    path: input.inheritedPath ? `${directory}${posix.delimiter}${input.inheritedPath}` : directory,
    gitExecPath: posix.join(root, "libexec", "git-core"),
    gitConfigSystem: posix.join(root, "etc", "gitconfig"),
    gitTemplateDir: posix.join(root, "share", "git-core", "templates"),
  }
}
