export function shouldBlockMountedApplication(input: {
  readonly platform: NodeJS.Platform
  readonly packaged: boolean
  readonly execPath: string
}) {
  if (input.platform !== "darwin" || !input.packaged) return false
  return input.execPath.startsWith("/Volumes/")
}

export function mountedApplicationMessage(name: string) {
  return `请先将 ${name} 拖到“应用程序”文件夹，再从“应用程序”中打开。不能直接在安装镜像中运行。`
}
