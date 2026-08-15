type QuitEvent = {
  preventDefault(): void
}

type QuitCoordinatorOptions = {
  readonly markQuitting: () => void
  readonly cleanup: () => Promise<void>
  readonly quit: () => void
  readonly onCleanupError?: (error: unknown) => void
}

export function createQuitCoordinator(options: QuitCoordinatorOptions) {
  let cleanupPromise: Promise<void> | undefined
  let cleanupSettled = false
  let resumePending = false
  let released = false

  const cleanup = () => {
    if (cleanupPromise) return cleanupPromise
    cleanupPromise = Promise.resolve()
      .then(options.cleanup)
      .finally(() => {
        cleanupSettled = true
      })
    return cleanupPromise
  }

  const reportCleanupError = (error: unknown) => {
    options.onCleanupError?.(error)
  }

  const deferQuit = (event: QuitEvent) => {
    options.markQuitting()
    if (released || cleanupSettled) return
    event.preventDefault()
    if (resumePending) return
    resumePending = true
    void cleanup()
      .catch(reportCleanupError)
      .finally(() => {
        released = true
        options.quit()
      })
      .catch(() => undefined)
  }

  return {
    cleanup,
    beforeQuit: deferQuit,
    querySessionEnd: deferQuit,
    sessionEnd() {
      options.markQuitting()
      void cleanup()
        .catch(reportCleanupError)
        .catch(() => undefined)
    },
  }
}
