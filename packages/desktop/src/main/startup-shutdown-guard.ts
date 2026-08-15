type StartupShutdownGuardWindow = {
  readonly destroy: () => void
  readonly isDestroyed: () => boolean
}

type StartupShutdownGuardOptions<T extends StartupShutdownGuardWindow> = {
  readonly platform: NodeJS.Platform
  readonly createWindow: () => T
  readonly wireWindow: (window: T) => void
}

export function createWindowsStartupShutdownGuard<T extends StartupShutdownGuardWindow>(
  options: StartupShutdownGuardOptions<T>,
) {
  const window = options.platform === "win32" ? options.createWindow() : undefined
  if (window) options.wireWindow(window)
  let disposed = false

  const dispose = () => {
    if (!window || disposed) return
    disposed = true
    if (!window.isDestroyed()) window.destroy()
  }

  return {
    dispose,
    handoff<R>(restore: () => R) {
      try {
        return restore()
      } finally {
        dispose()
      }
    },
  }
}
